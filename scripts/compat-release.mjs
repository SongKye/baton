#!/usr/bin/env node
// Before a release: re-verify every supported CLI's verified version with the code that is about to ship.
// The weekly job verifies main as it was that Saturday; a release can contain later changes. compat.json ships
// inside the release and is what users see as "verified", so it must hold for exactly this code.
//
//   npm run compat:release      (maintainer machine, test home signed in: npm run compat:smoke -- --login)
//
// Installs each CLI's verified version off PATH (Antigravity: the copy the weekly job downloaded, or the installed
// one if it is that exact version), runs compat:smoke --strict, and on success writes a stamp that
// `npm run release:check` requires: ~/.baton-compat/release-verified.json { serverTree, version, results }.
// serverTree is the git tree of server/ (code + compat.json), so a version bump commit doesn't invalidate it but
// any server change does.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STAMP = path.join(os.homedir(), '.baton-compat', 'release-verified.json');
const git = (...a) => spawnSync('git', a, { cwd: REPO, encoding: 'utf8' });

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dirty = git('status', '--porcelain', '--', 'server', 'scripts').stdout.trim();
  if (dirty) { console.log(`Commit or stash the changes in server/ and scripts/ first:\n${dirty}`); process.exit(1); }
  const serverTree = git('rev-parse', 'HEAD:server').stdout.trim();
  const table = JSON.parse(fs.readFileSync(path.join(REPO, 'server', 'compat.json'), 'utf8'));
  const tools = Object.entries(table).filter(([, e]) => e.level === 'supported' && e.verified).map(([id]) => id);

  // Antigravity has no versioned installer: use the weekly job's download of the verified version if there is one
  const args = ['--no-warnings', path.join(REPO, 'scripts', 'compat-smoke.mjs'), ...tools, '--install', '--strict'];
  const agyDir = table.agy?.verified && path.join(os.homedir(), '.baton-compat', 'versions', 'agy', table.agy.verified, 'bin');
  if (agyDir && fs.existsSync(path.join(agyDir, 'agy'))) args.push('--bin', `agy=${agyDir}`);
  const json = path.join(os.tmpdir(), `baton-release-verify-${process.pid}.json`);
  args.push('--json', json);

  console.log(`Re-verifying ${tools.map((t) => `${t} ${table[t].verified}`).join(', ')} with server tree ${serverTree.slice(0, 10)}…`);
  const r = spawnSync(process.execPath, args, { cwd: REPO, stdio: 'inherit' });
  let reports = [];
  try { reports = JSON.parse(fs.readFileSync(json, 'utf8')); } catch { /* crashed */ }
  fs.rmSync(json, { force: true });

  const results = tools.map((id) => {
    const rep = reports.find((x) => x.tool === id);
    return { tool: id, expected: table[id].verified, version: rep?.version || null, ok: Boolean(rep?.ok), skipped: rep?.skipped || null };
  });
  const mismatched = results.filter((x) => x.ok && x.version !== x.expected);
  const ok = r.status === 0 && results.every((x) => x.ok) && !mismatched.length;
  for (const m of mismatched) console.log(`✗ ${m.tool}: tested ${m.version}, but compat.json says ${m.expected}`);
  if (!ok) { console.log('\nRelease verification FAILED: fix it (or run the weekly job) before releasing.'); process.exit(1); }
  const version = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
  fs.mkdirSync(path.dirname(STAMP), { recursive: true });
  fs.writeFileSync(STAMP, JSON.stringify({ serverTree, version, at: new Date().toISOString(), results }, null, 2));
  console.log(`\nRelease verification passed. Stamp written for server tree ${serverTree.slice(0, 10)}.`);
}
