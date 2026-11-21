// Regression: OpenCode has no per-session registry, so Baton reads "still working" from opencode.db (OpenCode 2:
// session_v2.time_busy after the last time_idle) and pairs it with a running `opencode` process in that folder.
// Covers a one-shot `opencode run` (background), the TUI (terminal), an abandoned run, and a run inside OpenCode's
// background service (no process of its own). Runs the real modules in a throwaway copy with a fake HOME.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const child = process.argv[2] === '--child';
const tmp = child ? null : await fs.mkdtemp(path.join(os.tmpdir(), 'baton-opencode-live-'));
try {
  if (!child) {
    const app = path.join(tmp, 'app');
    await fs.mkdir(path.join(app, 'public'), { recursive: true });
    for (const d of ['server', 'scripts', path.join('public', 'locales')]) await fs.cp(path.join(repo, d), path.join(app, d), { recursive: true });
    await fs.copyFile(path.join(repo, 'package.json'), path.join(app, 'package.json'));
    await fs.symlink(path.join(repo, 'node_modules'), path.join(app, 'node_modules'), 'junction').catch(() => {});
    const home = path.join(tmp, 'home');
    await fs.mkdir(home, { recursive: true });
    execFileSync(process.execPath, ['--no-warnings', path.join(app, 'scripts', 'opencode-live-check.mjs'), '--child'], {
      stdio: 'inherit', cwd: app,
      env: { ...process.env, HOME: home, USERPROFILE: home, XDG_DATA_HOME: path.join(home, 'data'), BATON_NO_SHELL_ENV: '1', PATH: path.dirname(process.execPath) + path.delimiter + '/usr/bin:/bin', CHECK_TMP: tmp },
    });
  } else {
    const { opencodeFixture } = await import('./lib-opencode-fixture.mjs');
    const base = path.join(process.env.XDG_DATA_HOME, 'opencode');
    await fs.mkdir(base, { recursive: true });
    const now = Date.now();
    const f = opencodeFixture(path.join(base, 'opencode.db'));
    const dirs = {};
    // id -> [directory name, { busy, idle, updated } ms ago (null idle = never idle yet), archived]
    const cases = {
      run_working: ['d_run', { busy: 90_000, idle: null, updated: 90_000 }],          // process: `opencode run`
      tui_working: ['d_tui', { busy: 90_000, idle: 200_000, updated: 90_000 }],       // process: the TUI; an earlier turn finished
      abandoned: ['d_gone', { busy: 90_000, idle: null, updated: 90_000 }],           // killed hard: nothing is left to finish it
      service_run: ['d_srv', { busy: 5_000, idle: null, updated: 5_000 }],            // inside the background service, db just touched
      finished: ['d_done', { busy: 9_000, idle: 3_000, updated: 3_000 }],
      failed: ['d_err', { busy: 9_000, idle: 3_000, updated: 3_000 }],
      archived: ['d_arch', { busy: 9_000, idle: null, updated: 3_000 }, true],
      stale: ['d_old', { busy: 13 * 3600_000, idle: null, updated: 13 * 3600_000 }], // older than the 12 h window
    };
    for (const [id, [dn, t, archived]] of Object.entries(cases)) {
      const dir = path.join(process.env.CHECK_TMP, dn);
      await fs.mkdir(dir, { recursive: true });
      dirs[id] = dir;
      f.session(id, { directory: dir, title: id, t: { created: now - 14 * 3600_000, busy: now - t.busy, idle: t.idle == null ? null : now - t.idle, updated: now - t.updated, archived: archived ? now : null } });
      f.entry(id, 'user', { text: id }, now - t.busy);
    }
    // a normal project folder, finished: a person's session
    f.session('human', { directory: '/home/dev/project', title: 'human' });
    f.entry('human', 'user', { text: 'hi' });
    // a literal /tmp folder (the rule is on the path text; os.tmpdir() is not /tmp on macOS or Windows)
    f.session('scratch', { directory: '/tmp/scratch', title: 'scratch' });
    f.entry('scratch', 'user', { text: 'hi' });
    f.close();

    const { opencodeInflight, listOpencode } = await import('../server/sources/opencode.js');
    const inflight = opencodeInflight();
    const rows = new Map((await listOpencode()).map((r) => [r.id, r]));
    assert.equal(rows.get('human').automated, false, 'a session in a project folder is not automated');
    assert.equal(rows.get('scratch').automated, true, 'a session run from /tmp is tagged automated, like Claude / Codex / Antigravity');
    assert.deepEqual([...inflight.keys()].sort(), ['abandoned', 'run_working', 'service_run', 'tui_working'], 'only runs still in progress count');

    if (process.platform !== 'linux') { console.log('PASS: OpenCode in-progress run detection (process matching is Linux-only)'); process.exit(0); }

    // Fake `opencode` processes: bash under that name (node renames its main thread, bash keeps comm = "opencode"),
    // started in the session's folder; `opencode run` makes bash run the file ./run, so the argument is the subcommand.
    const fake = path.join(process.env.CHECK_TMP, 'opencode');
    await fs.symlink('/bin/bash', fake);
    const procs = [];
    for (const [id, sub] of [['run_working', 'run'], ['tui_working', 'tui']]) {
      await fs.writeFile(path.join(dirs[id], sub), 'sleep 20\n');
      procs.push(spawn(fake, [sub], { cwd: dirs[id], stdio: 'ignore' }));
    }
    await new Promise((r) => setTimeout(r, 600));
    try {
      const { liveSessions } = await import('../server/live.js');
      const live = await liveSessions(new Map());
      const st = (id) => live.get(`opencode:${id}`);
      assert.equal(st('run_working')?.status, 'busy', '`opencode run` is working');
      assert.equal(st('run_working').background, true, '...and was started by something else: background');
      assert.equal(st('run_working').pid, procs[0].pid);
      assert.equal(st('tui_working')?.status, 'busy');
      assert.equal(st('tui_working').background, false, 'a terminal UI is not a background run');
      assert.equal(st('abandoned'), undefined, 'a run with no process and a quiet db is not live');
      assert.equal(st('service_run')?.background, true, 'no process of its own but a fresh db: treated as background');
      for (const id of ['finished', 'failed', 'archived', 'stale']) assert.equal(st(id), undefined, `${id} is not working`);
    } finally { for (const p of procs) p.kill(); }
    console.log('PASS: OpenCode working state from opencode.db + running process (run / TUI / abandoned / background service)');
    process.exit(0);
  }
} finally {
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
}
