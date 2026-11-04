#!/usr/bin/env node
// CI smoke test: boot the real server on this OS and check the main API endpoints answer.
// Works on Linux, macOS and Windows (no CLIs need to be installed).
//   node scripts/ci-boot.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 7499;
const BASE = `http://127.0.0.1:${PORT}`;
const ENDPOINTS = ['/api/state', '/api/home', '/api/sessions', '/api/projects', '/api/setup', '/api/ports', '/api/skills', '/api/usage', '/api/limits', '/api/settings', '/api/env', '/api/trash', '/api/cleanup', '/i18n.js', '/'];

const server = spawn(process.execPath, ['--no-warnings', 'server/index.js'], {
  cwd: ROOT, env: { ...process.env, BATON_PORT: String(PORT), BATON_NO_SHELL_ENV: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (c) => { log += c; });
server.stderr.on('data', (c) => { log += c; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await sleep(500);
    try { up = (await fetch(`${BASE}/api/auth/status`)).ok; } catch { /* not yet */ }
  }
  if (!up) throw new Error('server did not start');
  for (const ep of ENDPOINTS) {
    const t0 = Date.now();
    let status = 0;
    try { status = (await fetch(BASE + ep, { signal: AbortSignal.timeout(90_000) })).status; } catch (e) { status = `ERR ${e.message}`; }
    const ok = status === 200;
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${ep} ${status} ${Date.now() - t0}ms`);
  }
} catch (e) {
  failed++;
  console.log(`✗ ${e.message}`);
} finally {
  server.kill();
}
if (failed) { console.log('\n--- server log ---\n' + log.slice(-4000)); process.exit(1); }
console.log('\nall endpoints OK');
