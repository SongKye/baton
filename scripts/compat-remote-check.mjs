// Regression: Settings reads the latest compatibility table from GitHub (server/compat.js compatInfo) and offers
// "update the CLI" / "update Baton" at the right times. Serves fake tables from a local HTTP server and checks
// the decision for each case. Runs the real module in a throwaway copy (its own data/).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.argv[2] === '--child') {
  const m = await import(pathToFileURL(path.join(repo, 'server', 'compat.js')).href);
  const local = m.COMPAT.codex.verified; // e.g. 0.156.0
  const B = m.BATON_VERSION;
  const bump = (v, i = 1) => v.split('.').map((x, k) => (k === 1 ? Number(x) + i : k === 2 ? 0 : x)).join('.');
  const newer = bump(local, 10);
  const cases = JSON.parse(process.argv[3]);
  const results = {};
  for (const [name, table] of Object.entries(cases)) {
    await fetch(`${process.env.BATON_COMPAT_URL}?set=${encodeURIComponent(JSON.stringify(table).replaceAll('NEWER', newer).replaceAll('LOCAL', local).replaceAll('BATON', B))}`);
    await m.refreshRemote({ force: true });
    results[name] = {
      older: m.compatInfo('codex', bump(local, -1)),
      same: m.compatInfo('codex', local),
      newer: m.compatInfo('codex', newer),
      newerReleased: m.compatInfo('codex', newer, { latestBaton: bump(B, 1) }),
    };
  }
  console.log(JSON.stringify({ local, newer, B, results }));
  process.exit(0);
}

let table = '{}';
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.searchParams.has('set')) { table = u.searchParams.get('set'); res.end('ok'); return; }
  res.setHeader('content-type', 'application/json'); res.end(table);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/compat.json`;
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'baton-compat-remote-'));
try {
  const app = path.join(tmp, 'app');
  for (const d of ['server', 'scripts']) await fs.cp(path.join(repo, d), path.join(app, d), { recursive: true });
  await fs.copyFile(path.join(repo, 'package.json'), path.join(app, 'package.json'));
  await fs.symlink(path.join(repo, 'node_modules'), path.join(app, 'node_modules'), 'junction').catch(() => {});
  const cases = {
    unreachable: 'not json',
    dataOnly: { codex: { level: 'supported', verified: 'NEWER', verifiedAt: '2099-01-01' } },
    needsRelease: { codex: { level: 'supported', verified: 'NEWER', verifiedAt: '2099-01-01', needsBatonAfter: 'BATON' } },
    alreadyHasFix: { codex: { level: 'supported', verified: 'NEWER', verifiedAt: '2099-01-01', needsBatonAfter: '0.0.1' } },
  };
  const out = await new Promise((resolve, reject) => {
    // async: the parent's HTTP server has to keep answering while the child runs
    import('node:child_process').then(({ execFile }) => execFile(process.execPath, ['--no-warnings', path.join(app, 'scripts', 'compat-remote-check.mjs'), '--child', JSON.stringify(cases)],
      { encoding: 'utf8', env: { ...process.env, BATON_COMPAT_URL: url } }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout))));
  });
  const { local, newer, results: r } = JSON.parse(out.trim().split('\n').pop());

  // no usable table: this Baton's own table decides
  assert.equal(r.unreachable.same.state, 'verified');
  assert.equal(r.unreachable.older.action, 'cli-update');
  assert.equal(r.unreachable.older.target, local);
  assert.equal(r.unreachable.newer.state, 'newer');
  assert.equal(r.unreachable.newer.action, null);

  // newer version verified without code changes: this Baton supports it too
  assert.equal(r.dataOnly.newer.state, 'verified');
  assert.equal(r.dataOnly.newer.verified, newer);
  assert.equal(r.dataOnly.newer.source, 'github');
  assert.equal(r.dataOnly.same.action, 'cli-update'); // installed is now older than supported
  assert.equal(r.dataOnly.same.target, newer);

  // newer version needs a Baton release after this one
  assert.equal(r.needsRelease.same.state, 'verified'); // own table still applies
  assert.equal(r.needsRelease.same.action, null);
  assert.equal(r.needsRelease.newer.action, 'baton-next'); // not released yet
  assert.equal(r.needsRelease.newerReleased.action, 'baton-update'); // released: update Baton

  // the fix is already in this Baton
  assert.equal(r.alreadyHasFix.newer.state, 'verified');
  assert.equal(r.alreadyHasFix.newer.action, null);

  console.log('compat-remote-check: ok');
} finally {
  server.close();
  await fs.rm(tmp, { recursive: true, force: true });
}
