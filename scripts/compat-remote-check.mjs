// Regression: what Settings says about each CLI (server/compat.js compatInfo).
// - "Verified" always comes from this release's own compat.json, per OS.
// - The newest Baton release's table (from GitHub at that release tag) is advice only: "update Baton" when it
//   supports an installed CLI version this release doesn't. Nothing is read from main.
// Serves fake tables from a local HTTP server and runs the real module in a throwaway copy (its own data/).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.argv[2] === '--child') {
  const m = await import(pathToFileURL(path.join(repo, 'server', 'compat.js')).href);
  const local = m.COMPAT.codex.verified;
  const B = m.BATON_VERSION;
  const bump = (v, i = 1) => v.split('.').map((x, k) => (k === 1 ? Number(x) + i : k === 2 ? 0 : x)).join('.');
  const newer = bump(local, 10), nextBaton = bump(B, 1);
  const cases = JSON.parse(process.argv[3]);
  const out = {};
  for (const [name, { table, latest }] of Object.entries(cases)) {
    const body = JSON.stringify(table).replaceAll('NEWER', newer).replaceAll('LOCAL', local);
    await fetch(`${process.env.BATON_COMPAT_URL}?set=${encodeURIComponent(body)}`);
    const latestBaton = latest === 'next' ? nextBaton : latest === 'same' ? B : null;
    await m.refreshRemote({ latestBaton, force: true });
    out[name] = {
      older: m.compatInfo('codex', bump(local, -1), { latestBaton }),
      same: m.compatInfo('codex', local, { latestBaton }),
      newer: m.compatInfo('codex', newer, { latestBaton }),
    };
  }
  console.log(JSON.stringify({ local, newer, nextBaton, out }));
  process.exit(0);
}

let table = '{}';
let hits = 0;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.searchParams.has('set')) { table = u.searchParams.get('set'); res.end('ok'); return; }
  hits++;
  res.setHeader('content-type', 'application/json'); res.end(table);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/compat.json`;
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'baton-compat-remote-'));
const run = (env) => new Promise((resolve, reject) => execFile(process.execPath,
  ['--no-warnings', path.join(tmp, 'app', 'scripts', 'compat-remote-check.mjs'), '--child', JSON.stringify(cases)],
  { encoding: 'utf8', env: { ...process.env, BATON_COMPAT_URL: url, ...env } }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(JSON.parse(stdout.trim().split('\n').pop())))));
const covers = { codex: { level: 'supported', verified: 'NEWER', verifiedAt: '2099-01-01', os: { linux: { verified: 'NEWER', verifiedAt: '2099-01-01' } } } };
const cases = {
  thisIsNewest: { table: covers, latest: 'same' }, // a newer table on main must not matter: only releases count
  noReleaseInfo: { table: covers, latest: null },
  nextCovers: { table: covers, latest: 'next' },
  nextDoesNot: { table: { codex: { level: 'supported', verified: 'LOCAL', verifiedAt: '2099-01-01', os: { linux: { verified: 'LOCAL', verifiedAt: '2099-01-01' } } } }, latest: 'next' },
  unreachable: { table: 'not json', latest: 'next' },
};
try {
  const app = path.join(tmp, 'app');
  for (const d of ['server', 'scripts']) await fs.cp(path.join(repo, d), path.join(app, d), { recursive: true });
  await fs.copyFile(path.join(repo, 'package.json'), path.join(app, 'package.json'));
  await fs.symlink(path.join(repo, 'node_modules'), path.join(app, 'node_modules'), 'junction').catch(() => {});

  const { local, newer, nextBaton, out: r } = await run({ BATON_COMPAT_OS: 'linux' });
  for (const [name, c] of Object.entries(r)) {
    // "verified" is always this release's own table
    assert.equal(c.same.state, 'verified', `${name}: own table decides`);
    assert.equal(c.same.hereVerified, local, `${name}: hereVerified is local`);
    assert.equal(c.newer.state, 'newer', `${name}: a newer CLI is never "verified" from GitHub`);
    assert.equal(c.older.action, 'cli-update', `${name}: older -> update the CLI`);
    assert.equal(c.older.target, local, `${name}: to this release's verified version`);
  }
  assert.equal(r.thisIsNewest.newer.action, null);
  assert.equal(r.noReleaseInfo.newer.action, null);
  assert.equal(r.nextCovers.newer.action, 'baton-update');
  assert.equal(r.nextCovers.newer.target, nextBaton);
  assert.equal(r.nextDoesNot.newer.action, null);
  assert.equal(r.unreachable.newer.action, null);
  assert.ok(newer);

  // verified only on another OS: not "verified" here
  const win = await run({ BATON_COMPAT_OS: 'windows' });
  assert.equal(win.out.thisIsNewest.same.hereVerified, null);
  assert.equal(win.out.thisIsNewest.same.platforms.linux, local);

  console.log(`compat-remote-check: ok (${hits} table fetches, only for a newer release)`);
} finally {
  server.close();
  await fs.rm(tmp, { recursive: true, force: true });
}
