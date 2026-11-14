// Regression: liveSessions() caches for 4s. A Baton run that ends inside that window is no longer in childPids, so
// its stale "busy" entry showed the session as "working in a PC terminal" for a moment. Dead pids must drop out.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const child = process.argv[2] === '--child';
const tmp = child ? null : await fs.mkdtemp(path.join(os.tmpdir(), 'baton-live-cache-'));
try {
  if (!child) {
    const app = path.join(tmp, 'app');
    await fs.mkdir(path.join(app, 'public'), { recursive: true });
    for (const d of ['server', 'scripts', path.join('public', 'locales')]) await fs.cp(path.join(repo, d), path.join(app, d), { recursive: true });
    await fs.copyFile(path.join(repo, 'package.json'), path.join(app, 'package.json'));
    await fs.symlink(path.join(repo, 'node_modules'), path.join(app, 'node_modules'), 'junction').catch(() => {});
    const home = path.join(tmp, 'home');
    await fs.mkdir(path.join(home, '.claude', 'sessions'), { recursive: true });
    execFileSync(process.execPath, ['--no-warnings', path.join(app, 'scripts', 'live-cache-check.mjs'), '--child'], {
      stdio: 'inherit', cwd: app,
      env: { ...process.env, HOME: home, USERPROFILE: home, XDG_DATA_HOME: path.join(home, 'data'), CLAUDE_CONFIG_DIR: path.join(home, '.claude'), BATON_NO_SHELL_ENV: '1', PATH: path.dirname(process.execPath) },
    });
  } else {
    const proc = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    const dir = path.join(process.env.HOME, '.claude', 'sessions');
    await fs.writeFile(path.join(dir, `${proc.pid}.json`), JSON.stringify({ pid: proc.pid, sessionId: 'sess-1', status: 'busy', kind: 'interactive', startedAt: Date.now() }));
    const { liveSessions } = await import('../server/live.js');
    assert.equal((await liveSessions(new Map())).get('claude:sess-1')?.status, 'busy', 'a running process is live');
    const exited = new Promise((r) => proc.on('exit', r));
    proc.kill('SIGKILL');
    await exited;
    assert.equal((await liveSessions(new Map())).get('claude:sess-1'), undefined, 'an exited process drops out at once, not after the cache expires');
    console.log('PASS: live state ignores a process that exited inside the cache window');
    process.exit(0);
  }
} finally {
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
}
