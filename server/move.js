// Move a session to a different working folder (e.g. a session started in ~/workspace that really
// works on ~/workspace/my-app). All CLIs resume a session by id from any folder, and the process cwd
// becomes the session's working folder, so the move is:
//   1. Baton: remember the new folder (session_meta.cwd_override) -> grouping, briefs and every run
//      from Baton use it; the next prompt tells the agent its folder changed.
//   2. Claude Code (optional, not while it's running): move the transcript into the new folder's
//      ~/.claude/projects/<encoded>/ so `claude --resume` in that folder lists it too.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getKV, setKV, patchSessionMeta } from './store.js';
import { findSession, readMessages, forceRefresh } from './indexer.js';
import { projectRoot } from './projects.js';
import { shortHome } from './util.js';
import { isInside } from './platform.js';
import { tr } from './i18n.js';

const HOME = os.homedir();

/** Folders the session actually edited, grouped by project root, most-edited first. */
export async function folderSuggestions(s) {
  const msgs = await readMessages(s);
  const counts = new Map();
  for (const m of msgs) {
    if (m.role !== 'tool' || !m.tool) continue;
    let input = m.tool.input;
    if (typeof input === 'string') { try { input = JSON.parse(input); } catch { /* raw */ } }
    const paths = [];
    const p = input && typeof input === 'object' ? (input.file_path || input.path || input.filePath || input.TargetFile) : null;
    if (p) paths.push(p);
    const cmd = typeof input === 'object' ? String(input?.command || input?.cmd || '') : String(input || '');
    for (const mm of cmd.matchAll(/(?:^|\s|&&\s*)cd\s+([~/][^\s;&|]+)/g)) paths.push(mm[1]);
    for (let x of paths) {
      if (x.startsWith('~')) x = path.join(HOME, x.slice(1));
      if (!path.isAbsolute(x)) x = path.resolve(s.origCwd || s.cwd || HOME, x);
      if (x.includes(`${path.sep}.claude${path.sep}`) || x.includes(`${path.sep}tmp`)) continue;
      const dir = fs.existsSync(x) && fs.statSync(x).isDirectory() ? x : path.dirname(x);
      const root = projectRoot(dir);
      if (!root || root === HOME || path.relative(HOME, root).split(path.sep)[0].startsWith('.')) continue; // skip ~/.claude, ~/.codex …
      counts.set(root, (counts.get(root) || 0) + 1);
    }
  }
  return [...counts.entries()].filter(([r]) => fs.existsSync(r)).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([p, n]) => ({ path: p, short: shortHome(p), uses: n }));
}

const encodeClaude = (dir) => dir.replace(/[^a-zA-Z0-9]/g, '-');

// ---------------------------------------------------------------- terminal-side moves
// Only where it's safe: Claude Code keeps transcripts in ~/.claude/projects/<encoded folder>/, and
// `claude --resume` lists that folder's files -> moving the file is all it takes (verified).
// Codex (state_5.sqlite threads.cwd) and Antigravity (conversation_summaries.db) index sessions in their
// own databases; editing another app's live DB could corrupt it, and OpenCode/Cursor formats aren't
// verified here. For those, the Baton-level move is what we do — they still resume in the new folder
// from Baton, and their own CLIs can still open the session by id from any folder.
export const TERMINAL_MOVE = new Set(['claude']);

async function moveClaudeFile(s, target) {
  const destDir = path.join(HOME, '.claude', 'projects', encodeClaude(target));
  const dest = path.join(destDir, path.basename(s.file));
  if (path.resolve(dest) === path.resolve(s.file)) return null;
  await fsp.mkdir(destDir, { recursive: true });
  await fsp.rename(s.file, dest); // same filesystem: instant, keeps mtime
  const sub = s.file.replace(/\.jsonl$/, '');
  if (fs.existsSync(sub)) await fsp.rename(sub, dest.replace(/\.jsonl$/, '')).catch(() => {});
  return dest;
}

async function terminalMove(key, target) {
  const [tool, ...rest] = key.split(':');
  const s = await findSession(tool, rest.join(':'));
  if (!s?.file) return null;
  if (tool === 'claude') return moveClaudeFile(s, target);
  return null;
}

/** Terminal-side moves waiting for a running session to finish: key -> target folder. */
const pendingMoves = () => getKV('pending_moves', {}) || {};

/**
 * Move a session. Always moves it in Baton; also moves it in the CLI's own resume list when that CLI
 * supports it — right away if the session is idle, otherwise automatically as soon as it finishes.
 * Returns { cwd, terminal: 'moved' | 'pending' | 'unsupported' | 'same' }.
 */
export async function moveSession({ tool, id, cwd, live = false }) {
  const s = await findSession(tool, id);
  if (!s) throw new Error(tr('세션을 찾을 수 없어요'));
  let target = String(cwd || '').trim();
  if (target.startsWith('~')) target = path.join(HOME, target.slice(1));
  target = path.resolve(target);
  if (!isInside(target, HOME)) throw new Error(tr('홈 디렉터리 밖은 열 수 없어요'));
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new Error(tr('폴더가 없어요: {p}', { p: shortHome(target) }));
  const original = s.origCwd || s.cwd;
  const key = `${tool}:${id}`;
  patchSessionMeta(key, { cwd_override: target === original ? null : target });
  // tell the agent once, on the next message, that its folder changed
  if (target !== (s.cwd || original)) setKV(`moved_note:${key}`, { from: s.cwd || original, to: target });

  let terminal = 'unsupported';
  if (TERMINAL_MOVE.has(tool)) {
    const pend = pendingMoves();
    if (live) { pend[key] = target; setKV('pending_moves', pend); terminal = 'pending'; }
    else {
      delete pend[key]; setKV('pending_moves', pend);
      terminal = (await terminalMove(key, target)) ? 'moved' : 'same';
    }
  }
  await forceRefresh();
  return { cwd: target, terminal };
}

/** Finishes terminal-side moves for sessions that were running when they were moved. */
export function startPendingMoves(isLive) {
  const tick = async () => {
    const pend = pendingMoves();
    const keys = Object.keys(pend);
    if (!keys.length) return;
    for (const key of keys) {
      try {
        if (await isLive(key)) continue;
        await terminalMove(key, pend[key]);
        const cur = pendingMoves(); delete cur[key]; setKV('pending_moves', cur);
        await forceRefresh();
      } catch (e) { console.warn('[move]', key, e.message); }
    }
  };
  setInterval(() => { tick().catch(() => {}); }, 20_000).unref();
}

/** If the session was moved since the last message, prefix the prompt with a one-time note. */
export function consumeMoveNote(key, prompt) {
  const n = getKV(`moved_note:${key}`, null);
  if (!n) return prompt;
  setKV(`moved_note:${key}`, null);
  return `(Note from Baton: this session's working folder is now \`${n.to}\` — it was \`${n.from}\`. Resolve relative paths from the new folder.)\n\n${prompt}`;
}
