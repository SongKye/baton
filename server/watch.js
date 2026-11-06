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
import { clip } from './util.js';
import { tr } from './i18n.js';

const TICK = 4000;
const QUIET_MS = { claude: 6000, codex: 15000, agy: 15000, opencode: 15000, cursor: 15000 };
const RECENT_MS = 3 * 3600_000; // follow sessions touched in the last 3 hours (plus anything live)
const state = new Map(); // key -> { mtime, working, lastChange, startedAt }
const batonEnded = new Map(); // key -> ts of last Baton run end (Baton already notifies those)

bus.on('run_end', (run) => { if (run.sessionId) batonEnded.set(`${run.tool}:${run.sessionId}`, Date.now()); });

async function mtimeOf(s) {
  let m = 0;
  for (const f of s.tool === 'agy' || s.tool === 'cursor' ? [s.file, `${s.file}-wal`] : [s.file]) {
    try { m = Math.max(m, (await fsp.stat(f)).mtimeMs); } catch { /* gone */ }
  }
  return m;
}

async function tick() {
  if (getSettings().notifyOnRunDone === false) { state.clear(); return; }
  const snap = await getSnapshot(10_000);
  const live = await liveSessions(snap.byFile);
  const now = Date.now();
  const watched = snap.sessions.filter((s) => s.file && !s.automated && (now - s.updated < RECENT_MS || live.has(s.key)));
  for (const s of watched) {
    const key = s.key;
    const m = await mtimeOf(s);
    let st = state.get(key);
    if (!st) { state.set(key, { mtime: m, working: false, lastChange: 0 }); continue; } // baseline, don't fire on start
    const lv = live.get(key);
    const busyFlag = lv?.status === 'busy' || Boolean(activeRunFor(key));
    if (m > st.mtime) {
      st.mtime = m; st.lastChange = now;
      if (!st.working) { st.working = true; st.startedAt = now; }
    }
    if (!st.working || busyFlag) continue;
    const quiet = now - st.lastChange;
    const idleConfirmed = s.tool === 'claude' && lv?.status === 'idle';
    if (quiet < (idleConfirmed ? 2500 : QUIET_MS[s.tool] || 15000)) continue;
    st.working = false;
    if (now - (batonEnded.get(key) || 0) < 60_000) continue; // Baton's own run_end push already covered it
    const allowed = notifyAllowed(key, { project: s.project, cwd: s.cwd });
    const fresh = (await forceRefresh()).byKey.get(key) || s;
    const body = clip(String(fresh.lastReply || tr('응답이 끝났어요')).replace(/\s+/g, ' '), 140);
    if (!allowed) { addEvent('watch_done', fromLine(s.tool, fresh.model), `✅ ${clip(fresh.title || tr('세션'), 40)}\n${body}`, `/#/s/${s.tool}/${encodeURIComponent(s.id)}`, { quiet: true }); continue; }
    notify({ kind: 'watch_done', title: fromLine(s.tool, fresh.model), body: `✅ ${clip(fresh.title || tr('세션'), 40)}\n${body}`, url: `/#/s/${s.tool}/${encodeURIComponent(s.id)}`, tag: `watch-${key}` }).catch(() => {});
  }
  const keep = new Set(watched.map((s) => s.key));
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
