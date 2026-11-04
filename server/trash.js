// Session trash: deleting from Baton *moves* the session's files into data/trash so it can be restored.
// Items older than TRASH_DAYS are purged for good.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, HOME, DAY } from './util.js';
import { db } from './store.js';

const TRASH_DIR = path.join(DATA_DIR, 'trash');
const TRASH_DAYS = 30;

db.exec(`CREATE TABLE IF NOT EXISTS trash (
  key TEXT PRIMARY KEY, tool TEXT NOT NULL, id TEXT NOT NULL, title TEXT, project TEXT,
  deleted_at INTEGER NOT NULL, dir TEXT NOT NULL, files TEXT NOT NULL
)`);

export function trashedKeys() {
  return new Set(db.prepare('SELECT key FROM trash').all().map((r) => r.key));
}

/** Every file/dir that belongs to a session. */
function sessionFiles(s) {
  const out = [];
  const add = (p) => { if (p && fs.existsSync(p)) out.push(p); };
  add(s.file);
  if (s.tool === 'claude') add(s.file.replace(/\.jsonl$/, '')); // subagent transcripts live in <id>/
  if (s.tool === 'opencode') {
    const storage = path.resolve(path.dirname(s.file), '..', '..'); // storage/session/<proj>/<id>.json
    add(path.join(storage, 'message', s.id)); // parts stay (keyed by message id) — harmless orphans
  }
  if (s.tool === 'cursor') { out.length = 0; add(path.dirname(s.file)); } // whole chat folder
  if (s.tool === 'agy') {
    add(`${s.file}-wal`); add(`${s.file}-shm`);
    add(path.join(HOME, '.gemini', 'antigravity-cli', 'brain', s.id)); // plan/artifact files
  }
  return out;
}

async function move(from, to) {
  await fsp.mkdir(path.dirname(to), { recursive: true });
  try { await fsp.rename(from, to); } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fsp.cp(from, to, { recursive: true });
    await fsp.rm(from, { recursive: true, force: true });
  }
}

export async function trashSession(s) {
  const files = sessionFiles(s);
  if (!files.length) throw new Error('세션 파일을 찾을 수 없어요');
  const dir = path.join(TRASH_DIR, `${Date.now()}-${s.tool}-${s.id}`.replace(/[^\w.-]/g, '_'));
  const moved = [];
  for (const [i, f] of files.entries()) {
    const to = path.join(dir, `${i}-${path.basename(f)}`);
    await move(f, to);
    moved.push({ from: f, to });
  }
  db.prepare(`INSERT OR REPLACE INTO trash (key, tool, id, title, project, deleted_at, dir, files) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(s.key, s.tool, s.id, s.title || null, s.project || null, Date.now(), dir, JSON.stringify(moved));
}

export async function restoreSession(key) {
  const r = db.prepare('SELECT * FROM trash WHERE key = ?').get(key);
  if (!r) throw new Error('휴지통에 없어요');
  for (const { from, to } of JSON.parse(r.files)) {
    if (fs.existsSync(from) || !fs.existsSync(to)) continue;
    await move(to, from);
  }
  await fsp.rm(r.dir, { recursive: true, force: true });
  db.prepare('DELETE FROM trash WHERE key = ?').run(key);
}

export function listTrash() {
  return db.prepare('SELECT key, tool, id, title, project, deleted_at FROM trash ORDER BY deleted_at DESC').all()
    .map((r) => ({ key: r.key, tool: r.tool, id: r.id, title: r.title, project: r.project, deletedAt: r.deleted_at }));
}

export async function emptyTrash(olderThanMs = 0) {
  const cutoff = Date.now() - olderThanMs;
  const rows = db.prepare('SELECT key, dir FROM trash WHERE deleted_at <= ?').all(cutoff);
  for (const r of rows) {
    await fsp.rm(r.dir, { recursive: true, force: true });
    db.prepare('DELETE FROM trash WHERE key = ?').run(r.key);
  }
  return rows.length;
}

export function startTrashPurge() {
  const run = () => emptyTrash(TRASH_DAYS * DAY).catch(() => {});
  run();
  setInterval(run, DAY / 4).unref();
}

/** Sessions that look like throwaway: automated runs, test folders, one-line "hi" chats. */
export function cleanupReason(s) {
  if (s.pinned || s.live) return null;
  const first = String(s.firstPrompt || '').trim();
  const last = String(s.lastPrompt || '').trim();
  // "small" = barely any conversation happened (a real working session is far bigger)
  const small = s.tool === 'agy' ? (s.steps || 0) <= 8 : (s.size || 0) < 60_000;
  if (s.automated) return '자동 실행';
  if (/\/(tmp|tmp_|temp|scratch)(\/|$)|baton-test/.test(s.cwd || '')) return '테스트 폴더';
  if (!small) return null;
  if (!first && !last) return '빈 대화';
  if ((!last || last === first) && first.length <= 24) return '짧은 한마디';
  if (/^(say exactly|reply with just|reply only|test|테스트)\b/i.test(first) && first.length < 80) return '테스트 메시지';
  return null;
}
