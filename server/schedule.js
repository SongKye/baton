// Scheduled messages: "send this to the session when my limit resets" (or at a set time).
// When a CLI hits its usage limit the session just stops; instead of waiting up, the user queues the
// next message and Baton sends it as soon as the limit window resets (re-checking live limits first,
// and postponing again if it's still exhausted).
import crypto from 'node:crypto';
import { db } from './store.js';
import { startRun, activeRunFor, bus } from './runner.js';
import { findSession } from './indexer.js';
import { allLimits } from './limits.js';
import { notify } from './push.js';
import { clip } from './util.js';
import { tr } from './i18n.js';
import fs from 'node:fs';

db.exec(`CREATE TABLE IF NOT EXISTS scheduled (
  id TEXT PRIMARY KEY, tool TEXT NOT NULL, session_id TEXT NOT NULL, prompt TEXT NOT NULL,
  model TEXT, effort TEXT, perm TEXT, when_type TEXT NOT NULL, run_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL, run_id TEXT, error TEXT, title TEXT
)`);

const BUFFER_MS = 90_000; // send a little after the reset so the provider's counter has rolled over
const pub = (r) => ({ id: r.id, tool: r.tool, sessionId: r.session_id, prompt: r.prompt, whenType: r.when_type, runAt: r.run_at, status: r.status, attempts: r.attempts, created: r.created, runId: r.run_id, error: r.error, title: r.title });

/**
 * When does `tool` have room again? The latest reset among windows that are (nearly) exhausted;
 * if none look exhausted (stale numbers), the soonest reset. null if the tool has no limit info.
 */
export async function nextReset(tool, { force = false } = {}) {
  const lim = (await allLimits({ force }))[tool];
  const ws = (lim?.windows || []).filter((w) => w.resetsAt && w.resetsAt > Date.now());
  if (!ws.length) return null;
  const full = ws.filter((w) => (w.usedPercent ?? 0) >= 95);
  const pick = full.length ? full.reduce((a, b) => (b.resetsAt > a.resetsAt ? b : a)) : ws.reduce((a, b) => (b.resetsAt < a.resetsAt ? b : a));
  return { at: pick.resetsAt, label: pick.label, exhausted: full.length > 0 };
}

export async function schedule({ tool, sessionId, prompt, model, effort, perm, when = 'reset', at = null }) {
  if (!String(prompt || '').trim()) throw new Error('empty prompt');
  const s = await findSession(tool, sessionId);
  if (!s) throw new Error(tr('세션을 찾을 수 없어요'));
  let runAt;
  if (when === 'time') {
    runAt = Number(at);
    if (!runAt || runAt < Date.now() - 60_000) throw new Error(tr('미래 시각을 골라주세요'));
  } else {
    const r = await nextReset(tool, { force: true });
    if (!r) throw new Error(tr('이 CLI는 한도 초기화 시각을 알 수 없어요. 시간을 직접 정해주세요'));
    runAt = r.at + BUFFER_MS;
  }
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO scheduled (id, tool, session_id, prompt, model, effort, perm, when_type, run_at, created, title)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, tool, sessionId, String(prompt), model || null, effort || null, perm || 'auto', when, runAt, Date.now(), s.title || null);
  return pub(db.prepare('SELECT * FROM scheduled WHERE id = ?').get(id));
}

export function listScheduled({ key = null, all = false } = {}) {
  const rows = key
    ? db.prepare('SELECT * FROM scheduled WHERE tool || \':\' || session_id = ? ORDER BY run_at').all(key)
    : db.prepare(`SELECT * FROM scheduled ${all ? '' : "WHERE status = 'pending'"} ORDER BY run_at`).all();
  return rows.filter((r) => all || key ? true : r.status === 'pending').map(pub);
}

export function cancelScheduled(id) {
  db.prepare("UPDATE scheduled SET status = 'canceled' WHERE id = ? AND status = 'pending'").run(id);
}

const set = (id, patch) => {
  const keys = Object.keys(patch);
  db.prepare(`UPDATE scheduled SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => patch[k]), id);
};

async function fire(r) {
  const key = `${r.tool}:${r.session_id}`;
  if (activeRunFor(key)) { set(r.id, { run_at: Date.now() + 60_000 }); return; } // busy: try again in a minute
  if (r.when_type === 'reset') {
    // limits may have moved (weekly window, stale numbers): if still exhausted, wait for the new reset
    const nr = await nextReset(r.tool, { force: true }).catch(() => null);
    if (nr?.exhausted && nr.at > Date.now()) { set(r.id, { run_at: nr.at + BUFFER_MS }); return; }
  }
  const s = await findSession(r.tool, r.session_id);
  if (!s) { set(r.id, { status: 'failed', error: tr('세션을 찾을 수 없어요') }); return; }
  const cwd = s.cwd && fs.existsSync(s.cwd) ? s.cwd : s.project;
  try {
    const run = startRun({ tool: r.tool, sessionId: r.session_id, cwd, prompt: r.prompt, model: r.model, effort: r.effort, perm: r.perm, title: s.title });
    set(r.id, { status: 'sent', run_id: run.id, attempts: r.attempts + 1 });
    notify({ kind: 'scheduled', title: tr('⏰ 예약 메시지를 보냈어요'), body: `${clip(s.title || '', 40)} · ${clip(r.prompt, 80)}`, url: `/#/s/${r.tool}/${encodeURIComponent(r.session_id)}`, tag: `sched-${r.id}` }).catch(() => {});
  } catch (e) {
    set(r.id, { status: 'failed', error: e.message, attempts: r.attempts + 1 });
  }
}

// a scheduled run that hits the limit again goes back into the queue (up to 3 tries)
bus.on('run_end', (run) => {
  if (!run.limited) return;
  const r = db.prepare("SELECT * FROM scheduled WHERE run_id = ? AND status = 'sent'").get(run.id);
  if (!r || r.attempts >= 3) return;
  nextReset(r.tool, { force: true }).then((nr) => {
    if (nr) set(r.id, { status: 'pending', run_at: nr.at + BUFFER_MS, run_id: null });
  }).catch(() => {});
});

export function startScheduler() {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      for (const r of db.prepare("SELECT * FROM scheduled WHERE status = 'pending' AND run_at <= ?").all(Date.now())) await fire(r);
    } catch (e) { console.warn('[schedule]', e.message); } finally { busy = false; }
  }, 30_000).unref();
}
