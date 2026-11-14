// Regression: OpenCode has no per-session registry, so Baton reads "still replying" from opencode.db (the newest
// message is an assistant reply with no time.completed) and pairs it with a running `opencode` process.
// Covers a one-shot `opencode run` (background), the TUI (terminal), an abandoned run, and a server-style run
// with no process of its own. Runs the real modules in a throwaway copy with a fake HOME.
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
    const { DatabaseSync } = await import('node:sqlite');
    const base = path.join(process.env.XDG_DATA_HOME, 'opencode');
    await fs.mkdir(base, { recursive: true });
    const now = Date.now();
    const db = new DatabaseSync(path.join(base, 'opencode.db'));
    db.exec(`CREATE TABLE session (id text PRIMARY KEY, project_id text, parent_id text, directory text, title text, time_created integer, time_updated integer, time_archived integer);
      CREATE TABLE message (id text PRIMARY KEY, session_id text, time_created integer, time_updated integer, data text);
      CREATE TABLE part (id text PRIMARY KEY, message_id text, session_id text, time_created integer, time_updated integer, data text);`);
    const dirs = {};
    // id -> [directory name, last assistant message, db last touched ms ago, archived]
    const cases = {
      run_working: ['d_run', { role: 'assistant', time: { created: now - 90_000 } }, 90_000],            // process: `opencode run`
      tui_working: ['d_tui', { role: 'assistant', time: { created: now - 90_000 } }, 90_000],            // process: the TUI
      abandoned: ['d_gone', { role: 'assistant', time: { created: now - 90_000 } }, 90_000],             // crashed: nothing is left to finish it
      server_style: ['d_srv', { role: 'assistant', time: { created: now - 5_000 } }, 5_000],             // no process in its folder, db just touched
      finished: ['d_done', { role: 'assistant', time: { created: now - 9_000, completed: now - 3_000 }, finish: 'stop' }, 3_000],
      errored: ['d_err', { role: 'assistant', time: { created: now - 9_000 }, error: { name: 'APIError' } }, 3_000],
      archived: ['d_arch', { role: 'assistant', time: { created: now - 9_000 } }, 3_000, true],
      waiting_for_reply: ['d_wait', { role: 'user', time: { created: now - 3_000 } }, 3_000],
    };
    for (const [id, [dn, asst, ago, archived]] of Object.entries(cases)) {
      const dir = path.join(process.env.CHECK_TMP, dn);
      await fs.mkdir(dir, { recursive: true });
      dirs[id] = dir;
      db.prepare('INSERT INTO session VALUES (?, ?, NULL, ?, ?, ?, ?, ?)').run(id, 'p', dir, id, now - 100_000, now - ago, archived ? now : null);
      db.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)').run(`${id}_m`, id, now - 100_000, now - ago, JSON.stringify(asst));
    }
    // a normal project folder, finished: a person's session
    db.prepare('INSERT INTO session VALUES (?, ?, NULL, ?, ?, ?, ?, NULL)').run('human', 'p', '/home/dev/project', 'human', now - 100_000, now - 3_000);
    db.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)').run('human_m', 'human', now - 100_000, now - 3_000, JSON.stringify({ role: 'assistant', time: { created: now - 9_000, completed: now - 3_000 }, finish: 'stop' }));
    db.close();

    const { opencodeInflight, listOpencode } = await import('../server/sources/opencode.js');
    const inflight = opencodeInflight();
    const rows = new Map((await listOpencode()).map((r) => [r.id, r]));
    assert.equal(rows.get('human').automated, false, 'a session in a project folder is not automated');
    assert.equal(rows.get('finished').automated, true, 'a session run from /tmp is tagged automated, like Claude / Codex / Antigravity');
    assert.deepEqual([...inflight.keys()].sort(), ['abandoned', 'run_working', 'server_style', 'tui_working'], 'only unfinished assistant replies count');

    if (process.platform !== 'linux') { console.log('PASS: OpenCode in-flight reply detection (process matching is Linux-only)'); process.exit(0); }

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
      assert.equal(st('abandoned'), undefined, 'unfinished reply with no process and a quiet db is not live');
      assert.equal(st('server_style')?.background, true, 'no process of its own but a fresh db: treated as background');
      for (const id of ['finished', 'errored', 'archived', 'waiting_for_reply']) assert.equal(st(id), undefined, `${id} is not working`);
    } finally { for (const p of procs) p.kill(); }
    console.log('PASS: OpenCode working state from opencode.db + running process (run / TUI / abandoned / server-style)');
    process.exit(0);
  }
} finally {
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
}
