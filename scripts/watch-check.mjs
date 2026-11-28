// "Session finished" watcher: only real new messages may produce a ping.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { watchStep, transcriptAdvanced, mtimeOf } from '../server/watch.js';

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

console.log('watch-check: OK');
process.exit(0);
