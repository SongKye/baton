// Unified session index across all CLIs, with project grouping and live state.
import path from 'node:path';
import { listClaude, readClaude } from './sources/claude.js';
import { listCodex, readCodex } from './sources/codex.js';
import { listAgy, readAgy } from './sources/agy.js';
import { listOpencode, readOpencode } from './sources/opencode.js';
import { listCursor, readCursor, noteCursorDirs } from './sources/cursor.js';
import { liveSessions } from './live.js';
import { projectRoot, groupProjects } from './projects.js';
import { allSessionMeta, allProjectMeta, allBriefs, cwdOverrides } from './store.js';
import { activeRunFor, childPids } from './runner.js';
import { trashedKeys } from './trash.js';
import { isInternalCwd } from './util.js';

let snapshot = { at: 0, sessions: [], byKey: new Map(), byFile: new Map() };
let refreshing = null;

async function rebuild() {
  const [cl, cx, ag, oc] = await Promise.all([
    listClaude().catch((e) => { console.warn('[claude]', e.message); return []; }),
    listCodex().catch((e) => { console.warn('[codex]', e.message); return []; }),
    listAgy().catch((e) => { console.warn('[agy]', e.message); return []; }),
    listOpencode().catch((e) => { console.warn('[opencode]', e.message); return []; }),
  ]);
  noteCursorDirs([...cl, ...cx, ...ag, ...oc].map((s) => s.cwd));
  const cu = await listCursor().catch((e) => { console.warn('[cursor]', e.message); return []; });
  const moved = cwdOverrides(); // sessions the user moved to another folder in Baton
  // Baton's own one-shot calls (and their older copies under data/) are not the user's sessions: never list them.
  const sessions = [...cl, ...cx, ...ag, ...oc, ...cu].filter((s) => !isInternalCwd(s.cwd)).map((s) => {
    const key = `${s.tool}:${s.id}`;
    const cwd = moved.get(key) || s.cwd;
    return { ...s, key, cwd, origCwd: s.cwd, moved: moved.has(key), project: projectRoot(cwd) };
  });
  const byKey = new Map(sessions.map((s) => [s.key, s]));
  const byFile = new Map(sessions.map((s) => [s.file, s]));
  snapshot = { at: Date.now(), sessions, byKey, byFile };
  return snapshot;
}

/** Returns the latest snapshot; rebuilds if older than maxAgeMs. */
export async function getSnapshot(maxAgeMs = 3000) {
  if (Date.now() - snapshot.at > maxAgeMs) {
    if (!refreshing) refreshing = rebuild().finally(() => { refreshing = null; });
    if (!snapshot.at) await refreshing; // first load: wait
    else if (Date.now() - snapshot.at > 60_000) await refreshing; // very stale: wait
  }
  return snapshot;
}

export async function forceRefresh() {
  if (!refreshing) refreshing = rebuild().finally(() => { refreshing = null; });
  return refreshing;
}

/** Sessions decorated with user meta, live/terminal state and running Baton runs. */
export async function decoratedSessions({ includeHidden } = {}) {
  const snap = await getSnapshot();
  const meta = allSessionMeta();
  const liveMap = await liveSessions(snap.byFile);
  const trashed = trashedKeys();
  const out = [];
  for (const s of snap.sessions) {
    if (trashed.has(s.key)) continue;
    const m = meta.get(s.key);
    const hidden = Boolean(m?.hidden);
    if (hidden && !includeHidden) continue;
    // Automated sessions (scripts, `codex exec`, another tool's `claude -p`) are listed like any other, tagged
    // "Auto"; the user hides the ones they don't want (one by one or in bulk).
    const lv = liveMap.get(s.key);
    const run = activeRunFor(s.key);
    const terminal = lv && !run && !childPids.has(lv.pid) ? lv : null; // Baton's own child processes are shown as runs instead
    out.push({
      ...s,
      file: undefined,
      title: m?.title || s.title,
      pinned: Boolean(m?.pinned),
      hidden,
      lastSeen: m?.last_seen || null,
      notify: m?.notify || 0,
      terminal: terminal ? terminal.status : null,
      background: Boolean(s.background || terminal?.background), // run by another tool with no terminal of its own
      running: run ? run.id : null,
      live: Boolean(terminal || run || (s.tool === 'agy' && s.busy && Date.now() - s.updated < 10 * 60_000)),
      unseen: Boolean(m?.last_seen && s.updated > m.last_seen + 2000),
    });
  }
  out.sort((a, b) => b.updated - a.updated);
  return out;
}

export async function projectsList() {
  const sessions = await decoratedSessions();
  return groupProjects(sessions, allProjectMeta(), allBriefs());
}

export async function findSession(tool, id) {
  let snap = await getSnapshot();
  let s = snap.byKey.get(`${tool}:${id}`);
  if (!s) { snap = await forceRefresh(); s = snap.byKey.get(`${tool}:${id}`); }
  return s || null;
}

export async function readMessages(s) {
  if (!s?.file) return [];
  if (s.tool === 'claude') return readClaude(s.file);
  if (s.tool === 'codex') return readCodex(s.file);
  if (s.tool === 'agy') return readAgy(s.file);
  if (s.tool === 'opencode') return readOpencode(s.file);
  if (s.tool === 'cursor') return readCursor(s.file);
  return [];
}

export function sessionsOfProject(sessions, root) {
  return sessions.filter((s) => s.project === root);
}

export { path };
