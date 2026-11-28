// "This session finished" pings for sessions running anywhere (PC terminal or Baton). On for every session by
// default; muted per session or per project (store.notifyAllowed). Only recently active sessions are followed.
// Every few seconds, for each followed session: the transcript file growing = working;
// Claude's own registry says idle (or the file has been quiet for a while) after work = finished.
import fsp from 'node:fs/promises';
import { notifyAllowed, getSettings, addEvent } from './store.js';
import { getSnapshot, forceRefresh } from './indexer.js';
import { liveSessions } from './live.js';
import { activeRunFor, bus } from './runner.js';
import { notify } from './push.js';
import { fromLine } from './models.js';
import { isOpencodeDbRef } from './sources/opencode.js';
import { clip } from './util.js';
import { tr } from './i18n.js';

const TICK = 4000;
const QUIET_MS = { claude: 6000, codex: 15000, agy: 15000, opencode: 15000, cursor: 15000 };
const RECENT_MS = 3 * 3600_000; // follow sessions touched in the last 3 hours (plus anything live)
// Keyed by session key + file: the same session id can exist in several files (e.g. leftover fixtures
// in different project folders), and sharing one entry made their mtimes look like fresh activity.
const state = new Map(); // `${key}\0${file}` -> { mtime, working, lastChange, startedAt, seen }
const batonEnded = new Map(); // key -> ts of last Baton run end (Baton already notifies those)

bus.on('run_end', (run) => { if (run.sessionId) batonEnded.set(`${run.tool}:${run.sessionId}`, Date.now()); });

export async function mtimeOf(s) {
  if (isOpencodeDbRef(s.file)) return s.updated; // a db row, not a file: there is nothing to stat
  let m = 0;
  try { m = (await fsp.stat(s.file)).mtimeMs; } catch { /* gone */ }
  if (s.tool === 'agy' || s.tool === 'cursor') {
    // Merely opening a WAL-mode SQLite db (the CLI starting up, Baton or a test reading it) touches the
    // empty -wal file. Only a WAL holding data means something was written.
    try {
      const w = await fsp.stat(`${s.file}-wal`);
      if (w.size > 0) m = Math.max(m, w.mtimeMs);
    } catch { /* no wal */ }
  }
  return m;
}

/**
 * One watcher step for one session file. Pure so it can be tested.
 * obs: { now, mtime, updated, busy, quietMs }. Returns 'finished' when a work burst just ended, else null.
 * `seen` is the newest transcript time observed while idle; a burst only counts as work if the
 * transcript itself moved past it (checked by the caller with fresh data), so a file that was only
 * touched never produces a "finished" ping.
 */
export function watchStep(st, { now, mtime, updated = 0, busy = false, quietMs }) {
  if (mtime > st.mtime) {
    st.mtime = mtime; st.lastChange = now;
    if (!st.working) { st.working = true; st.startedAt = now; }
  } else if (!st.working) {
    st.seen = Math.max(st.seen || 0, updated || 0);
  }
  if (!st.working || busy) return null;
  if (now - st.lastChange < quietMs) return null;
  st.working = false;
  return 'finished';
}

/**
 * What the "did new messages arrive" check compares. Sources set `progress` from conversation records only
 * (Claude/Codex: newest user/assistant message time, Cursor: newest message rowid), so usage events, title
 * changes and other bookkeeping don't count. Sources without it fall back to `updated`.
 */
export function progressOf(s) {
  return Number(s?.progress ?? s?.updated) || 0;
}

/** Did the transcript really get new content since the session was last idle? */
export function transcriptAdvanced(st, updated) {
  const advanced = (updated || 0) > (st.seen || 0);
  st.seen = Math.max(st.seen || 0, updated || 0);
  return advanced;
}

async function tick() {
  if (getSettings().notifyOnRunDone === false) { state.clear(); return; }
  const snap = await getSnapshot(10_000);
  const live = await liveSessions(snap.byFile);
  const now = Date.now();
  const watched = snap.sessions.filter((s) => s.file && !s.automated && (now - s.updated < RECENT_MS || live.has(s.key)));
  for (const s of watched) {
    const key = s.key;
    const sk = `${key}\0${s.file}`;
    const m = await mtimeOf(s);
    const st = state.get(sk);
    if (!st) { state.set(sk, { mtime: m, working: false, lastChange: 0, seen: progressOf(s) }); continue; } // baseline, don't fire on start
    const lv = live.get(key);
    const busy = lv?.status === 'busy' || Boolean(activeRunFor(key));
    const idleConfirmed = s.tool === 'claude' && lv?.status === 'idle';
    const quietMs = idleConfirmed ? 2500 : QUIET_MS[s.tool] || 15000;
    if (watchStep(st, { now, mtime: m, updated: progressOf(s), busy, quietMs }) !== 'finished') continue;
    // Look up by file, not key: the same session id can live in several files and byKey keeps only one.
    const fresh = (await forceRefresh()).byFile.get(s.file) || s;
    if (now - (batonEnded.get(key) || 0) < 60_000) { transcriptAdvanced(st, progressOf(fresh)); continue; } // Baton's own run_end push already covered it
    if (!transcriptAdvanced(st, progressOf(fresh))) continue; // file touched, no new messages
    const allowed = notifyAllowed(key, { project: s.project, cwd: s.cwd });
    const body = clip(String(fresh.lastReply || tr('응답이 끝났어요')).replace(/\s+/g, ' '), 140);
    if (!allowed) { addEvent('watch_done', fromLine(s.tool, fresh.model), `✅ ${clip(fresh.title || tr('세션'), 40)}\n${body}`, `/#/s/${s.tool}/${encodeURIComponent(s.id)}`, { quiet: true }); continue; }
    notify({ kind: 'watch_done', title: fromLine(s.tool, fresh.model), body: `✅ ${clip(fresh.title || tr('세션'), 40)}\n${body}`, url: `/#/s/${s.tool}/${encodeURIComponent(s.id)}`, tag: `watch-${key}` }).catch(() => {});
  }
  const keep = new Set(watched.map((s) => `${s.key}\0${s.file}`));
  for (const k of state.keys()) if (!keep.has(k)) state.delete(k);
}

export function startWatcher() {
  let busy = false;
  setInterval(async () => {
    if (busy || !getSettings) return;
    busy = true;
    try { await tick(); } catch (e) { console.warn('[watch]', e.message); } finally { busy = false; }
  }, TICK).unref();
}
