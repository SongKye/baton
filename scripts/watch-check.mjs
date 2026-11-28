// "Session finished" watcher: only real new messages may produce a ping.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Point every CLI's home at a throwaway folder before the source modules read their paths.
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-watch-home-'));
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.CODEX_HOME;
const { watchStep, transcriptAdvanced, mtimeOf, progressOf } = await import('../server/watch.js');
const { listClaude } = await import('../server/sources/claude.js');
const { listCodex } = await import('../server/sources/codex.js');
const { listCursor } = await import('../server/sources/cursor.js');

const QUIET = 15000;
const fresh = (updated) => ({ mtime: 1000, working: false, lastChange: 0, seen: updated, startedAt: 0 });

// 1. A real turn: file grows, transcript moves forward, then goes quiet -> one ping
{
  const st = fresh(500);
  assert.equal(watchStep(st, { now: 10_000, mtime: 1000, updated: 500, quietMs: QUIET }), null, 'idle, unchanged');
  assert.equal(watchStep(st, { now: 14_000, mtime: 2000, updated: 500, quietMs: QUIET }), null, 'change starts work');
  assert.equal(st.working, true);
  assert.equal(watchStep(st, { now: 18_000, mtime: 2000, updated: 1900, quietMs: QUIET }), null, 'still within quiet window');
  assert.equal(st.seen, 500, 'seen is frozen while working');
  assert.equal(watchStep(st, { now: 30_000, mtime: 2000, updated: 1900, quietMs: QUIET }), 'finished', 'quiet after work -> finished');
  assert.equal(transcriptAdvanced(st, 1900), true, 'new messages -> notify');
  assert.equal(st.seen, 1900);
}

// 2. Touch only (db opened, -wal mtime bumped): finished burst but transcript did not move -> no ping
{
  const st = fresh(500);
  watchStep(st, { now: 14_000, mtime: 2000, updated: 500, quietMs: QUIET });
  assert.equal(watchStep(st, { now: 30_000, mtime: 2000, updated: 500, quietMs: QUIET }), 'finished');
  assert.equal(transcriptAdvanced(st, 500), false, 'no new messages -> silent');
}

// 3. Busy (live registry / active Baton run) holds the ping until it is idle again
{
  const st = fresh(500);
  watchStep(st, { now: 14_000, mtime: 2000, updated: 500, quietMs: QUIET });
  assert.equal(watchStep(st, { now: 40_000, mtime: 2000, updated: 900, busy: true, quietMs: QUIET }), null, 'busy -> wait');
  assert.equal(watchStep(st, { now: 41_000, mtime: 2000, updated: 900, quietMs: QUIET }), 'finished');
}

// 4. Idle ticks keep `seen` current so an older snapshot can't fake progress later
{
  const st = fresh(500);
  watchStep(st, { now: 10_000, mtime: 1000, updated: 800, quietMs: QUIET });
  assert.equal(st.seen, 800, 'idle tick absorbs the newest transcript time');
}

// 5. Antigravity/Cursor: an empty -wal being touched is not activity; a WAL with data is
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-watch-'));
  try {
    const db = path.join(dir, 'conv.db');
    fs.writeFileSync(db, 'x');
    fs.writeFileSync(`${db}-wal`, '');
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(db, past, past);
    const s = { tool: 'agy', file: db, updated: 0 };
    const base = await mtimeOf(s);
    fs.utimesSync(`${db}-wal`, new Date(), new Date());
    assert.equal(await mtimeOf(s), base, 'touching an empty -wal does not count');
    fs.writeFileSync(`${db}-wal`, 'frames');
    assert.ok(await mtimeOf(s) > base, 'a -wal with data counts as a write');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 6. Claude: a small file with more than 300 short records still shows the newest reply/time
{
  const dir = path.join(fakeHome, '.claude', 'projects', '-tmp-proj');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'long-short.jsonl');
  const t = (i) => new Date(Date.UTC(2026, 10, 28, 0, 0, i)).toISOString();
  const lines = [JSON.stringify({ type: 'user', cwd: '/home/x/proj', timestamp: t(0), isSidechain: false, message: { role: 'user', content: 'hello' } })];
  for (let i = 1; i < 300; i++) lines.push(JSON.stringify({ type: 'system', timestamp: t(i), isSidechain: false }));
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const before = (await listClaude()).find((x) => x.id === 'long-short');
  assert.ok(before && fs.statSync(file).size < 96 * 1024, 'fixture is a small file');
  fs.appendFileSync(file, JSON.stringify({ type: 'assistant', timestamp: t(400), isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text: 'line 301 reply' }] } }) + '\n');
  const after = (await listClaude()).find((x) => x.id === 'long-short');
  assert.equal(after.lastReply, 'line 301 reply', 'Claude reply on line 301 is read');
  assert.ok(progressOf(after) > progressOf(before), 'Claude progress moves with line 301');
}

// 7. Codex: same for a small file past the 200-line head window
{
  const dir = path.join(fakeHome, '.codex', 'sessions', '2026', '11', '28');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'rollout-2026-11-28T00-00-00-abc.jsonl');
  const t = (i) => new Date(Date.UTC(2026, 10, 28, 0, 0, i)).toISOString();
  const lines = [
    JSON.stringify({ type: 'session_meta', timestamp: t(0), payload: { id: 'codex-long', cwd: '/home/x/proj', timestamp: t(0), source: 'cli' } }),
    JSON.stringify({ type: 'event_msg', timestamp: t(1), payload: { type: 'user_message', message: 'hello' } }),
  ];
  for (let i = 2; i < 200; i++) lines.push(JSON.stringify({ type: 'event_msg', timestamp: t(i), payload: { type: 'token_count' } }));
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const before = (await listCodex()).find((x) => x.id === 'codex-long');
  assert.ok(before && fs.statSync(file).size < 64 * 1024, 'codex fixture is a small file');
  fs.appendFileSync(file, JSON.stringify({ type: 'event_msg', timestamp: t(400), payload: { type: 'task_complete', last_agent_message: 'line 201 reply' } }) + '\n');
  const after = (await listCodex()).find((x) => x.id === 'codex-long');
  assert.equal(after.lastReply, 'line 201 reply', 'Codex reply on line 201 is read');
  assert.ok(progressOf(after) > progressOf(before), 'Codex progress moves with line 201');
}

// 8. Cursor: renaming a chat is not progress; a new message is, even with the same text as before
{
  const dir = path.join(fakeHome, '.cursor', 'chats', 'hash1', 'chat1');
  fs.mkdirSync(dir, { recursive: true });
  const dbFile = path.join(dir, 'store.db');
  const db = new DatabaseSync(dbFile);
  db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE blobs (id TEXT, data BLOB);');
  const setName = (name) => db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('0', ?)").run(JSON.stringify({ name, createdAt: 1 }));
  const addMsg = (role, text) => db.prepare('INSERT INTO blobs (id, data) VALUES (?, ?)').run(String(Math.random()), Buffer.from(JSON.stringify({ role, content: text })));
  setName('first');
  addMsg('user', 'hi');
  addMsg('assistant', 'same answer');
  const base = (await listCursor()).find((x) => x.id === 'chat1');
  const st = { seen: progressOf(base) };
  setName('renamed');
  const renamed = (await listCursor()).find((x) => x.id === 'chat1');
  assert.equal(renamed.title, 'renamed', 'rename is visible');
  assert.equal(transcriptAdvanced(st, progressOf(renamed)), false, 'rename only -> no ping');
  addMsg('user', 'again');
  addMsg('assistant', 'same answer');
  const replied = (await listCursor()).find((x) => x.id === 'chat1');
  assert.equal(transcriptAdvanced(st, progressOf(replied)), true, 'same text, new message -> ping');
  db.close();
}

fs.rmSync(fakeHome, { recursive: true, force: true });
console.log('watch-check: OK');
process.exit(0);
