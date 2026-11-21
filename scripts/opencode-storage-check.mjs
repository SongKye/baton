// Regression: OpenCode 2 sessions in opencode.db (session_v2 + session_message), including sessions OpenCode 2
// migrated from OpenCode 1 (still present in the old session / message / part tables). The session list,
// transcript, usage report, trash, restore and permanent deletion must see each session exactly once.
// Runs the real modules in a throwaway copy (Baton's data/ is ROOT/data) with a fake HOME.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const child = process.argv[2] === '--child';
const tmp = child ? null : await fs.mkdtemp(path.join(os.tmpdir(), 'baton-opencode-storage-'));
try {
  if (!child) {
    const app = path.join(tmp, 'app');
    await fs.mkdir(path.join(app, 'public'), { recursive: true });
    for (const d of ['server', 'scripts', path.join('public', 'locales')]) await fs.cp(path.join(repo, d), path.join(app, d), { recursive: true });
    await fs.copyFile(path.join(repo, 'package.json'), path.join(app, 'package.json'));
    await fs.symlink(path.join(repo, 'node_modules'), path.join(app, 'node_modules'), 'junction').catch(() => {});
    const home = path.join(tmp, 'home');
    await fs.mkdir(home, { recursive: true });
    execFileSync(process.execPath, ['--no-warnings', path.join(app, 'scripts', 'opencode-storage-check.mjs'), '--child'], {
      stdio: 'inherit', cwd: app,
      env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), XDG_DATA_HOME: path.join(home, 'data'), BATON_NO_SHELL_ENV: '1', PATH: path.dirname(process.execPath) },
    });
  } else {
    const { DatabaseSync } = await import('node:sqlite');
    const { opencodeFixture, assistant } = await import('./lib-opencode-fixture.mjs');
    const base = path.join(process.env.XDG_DATA_HOME, 'opencode');
    await fs.mkdir(base, { recursive: true });
    const dbFile = path.join(base, 'opencode.db');
    const now = Date.now();
    const f = opencodeFixture(dbFile);

    // 1) migrated from OpenCode 1: in session_v2 *and* in the old tables (which must not count twice)
    f.session('ses_shared', { directory: '/project', title: 'New session - 2026-11-21T00:54:39.264Z', version: '1.19.5', t: { created: now - 9000, updated: now - 1000 } });
    f.entry('ses_shared', 'user', { text: 'hello\n' }, now - 8000);
    f.entry('ses_shared', 'system', { text: 'The `bash` tool is now `shell`.' }, now - 7900); // a note to the model
    f.entry('ses_shared', 'assistant', assistant([
      { type: 'reasoning', text: 'thinking it over' },
      { type: 'tool', name: 'read', state: { status: 'completed', input: { path: '/project/a.txt' }, content: [{ type: 'text', text: 'file body' }] } },
      { type: 'tool', name: 'shell', state: { status: 'error', input: { command: 'rm -rf /' }, error: { type: 'tool.execution', message: 'The user rejected permission' } } },
    ]), now - 7000);
    f.entry('ses_shared', 'assistant', assistant([{ type: 'text', text: 'hi!' }]), now - 6000);
    f.entry('ses_shared', 'idle', { outcome: 'succeeded' }, now - 5900);
    const v1 = f.db;
    v1.prepare("INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('ses_shared', 'global', 's', '/project', 'old', '1.19.5', ?, ?)").run(now - 9000, now - 1000);
    v1.prepare("INSERT INTO message VALUES ('m1', 'ses_shared', ?, ?, ?)").run(now - 8000, now - 8000, JSON.stringify({ role: 'assistant', tokens: { input: 999, output: 999 } }));
    v1.prepare("INSERT INTO part VALUES ('p1', 'm1', 'ses_shared', ?, ?, ?)").run(now - 8000, now - 8000, JSON.stringify({ type: 'text', text: 'old copy' }));
    // an attachment reference (cascades with the session)
    v1.prepare("INSERT INTO blob VALUES ('h1', 'image/png', 3, 1, 1, X'010203', ?)").run(now);
    v1.prepare("INSERT INTO blob_ref VALUES ('ses_shared', 'msg_ses_shared_1', 'h1', 1)").run();

    // 2) created by OpenCode 2: an image, a reasoning variant, two model steps, a failed turn
    f.session('ses_v2', { directory: '/project', title: 'Image color identification', t: { created: now - 4000, updated: now - 2000 } });
    f.entry('ses_v2', 'agent-switched', { agent: 'build', previous: 'build' }, now - 3990);
    f.entry('ses_v2', 'user', { text: 'What color is this?\n', files: [{ mime: 'image/png', name: 'red.png', data: 'iVBORw0KGgo=', source: { type: 'inline' } }] }, now - 3900);
    f.entry('ses_v2', 'assistant', { ...assistant([{ type: 'text', text: 'Red.' }], { tokens: { input: 50, output: 5, reasoning: 5, cache: { read: 10, write: 0 } } }), model: { id: 'deepseek-v4.1-flash-free', providerID: 'opencode', variant: 'low' } }, now - 3800);
    f.entry('ses_v2', 'assistant', assistant([{ type: 'text', text: 'Anything else?' }], { tokens: { input: 50, output: 10, reasoning: 0, cache: { read: 0, write: 0 } } }), now - 3700);
    f.entry('ses_v2', 'idle', { outcome: 'succeeded' }, now - 3600);
    f.entry('ses_v2', 'user', { text: 'again', files: [] }, now - 3000);
    f.entry('ses_v2', 'idle', { outcome: 'failed', error: { type: 'provider.no-route', message: 'Model unavailable: nope/x' } }, now - 2900);

    // 3) not listed or tagged
    f.session('ses_archived', { directory: '/project', title: 'Archived', t: { archived: now - 100 } });
    f.entry('ses_archived', 'user', { text: 'old' }, now - 500);
    f.session('ses_child', { directory: '/project', title: 'Subtask', parent: 'ses_v2' });
    f.entry('ses_child', 'user', { text: 'sub' }, now - 400);
    f.session('ses_untitled', { directory: '/tmp/scratch', title: null });
    f.entry('ses_untitled', 'user', { text: 'Fix the flaky test please' }, now - 300);
    f.close();

    const { listOpencode, readOpencode } = await import(pathToFileURL(path.join(process.cwd(), 'server', 'sources', 'opencode.js')).href);
    const { usageReport } = await import(pathToFileURL(path.join(process.cwd(), 'server', 'usage.js')).href);

    const rows = new Map((await listOpencode()).map((r) => [r.id, r]));
    assert.deepEqual([...rows.keys()].sort(), ['ses_child', 'ses_shared', 'ses_untitled', 'ses_v2'], 'each session once; archived ones hidden');
    const shared = rows.get('ses_shared');
    assert.ok(shared.file.includes('opencode.db#'));
    assert.equal(shared.title, 'hello', "OpenCode 1's placeholder title falls back to the first prompt");
    assert.equal(shared.cwd, '/project');
    assert.equal(shared.lastReply, 'hi!');
    assert.equal(shared.model, 'opencode/beam-free');
    assert.equal(rows.get('ses_untitled').title, 'Fix the flaky test please', 'a null title falls back to the first prompt');
    assert.equal(rows.get('ses_untitled').automated, true, 'a /tmp run is automated');
    assert.equal(rows.get('ses_child').automated, true, 'a sub-session is automated');
    assert.equal(rows.get('ses_v2').automated, false);
    assert.equal(rows.get('ses_v2').lastPrompt, 'again');
    assert.equal(rows.get('ses_v2').lastReply, 'Anything else?', 'the last step with text, not the failed turn');
    assert.ok(shared.size > 0);

    const sharedMsgs = await readOpencode(shared.file);
    assert.deepEqual(sharedMsgs.map((m) => [m.role, m.text ?? m.tool?.name]), [
      ['user', 'hello'], ['thinking', 'thinking it over'], ['tool', 'read'], ['tool', 'shell'], ['assistant', 'hi!'],
    ], 'system notes and the idle marker are not part of the transcript');
    const [read, shell] = sharedMsgs.filter((m) => m.role === 'tool').map((m) => m.tool);
    assert.equal(read.summary.endsWith('a.txt'), true);
    assert.equal(read.output, 'file body');
    assert.equal(read.error, false);
    assert.equal(shell.summary, 'rm -rf /');
    assert.equal(shell.error, true);
    assert.equal(shell.output, 'The user rejected permission');
    const v2Msgs = await readOpencode(rows.get('ses_v2').file);
    assert.deepEqual(v2Msgs.map((m) => [m.role, m.text]), [
      ['user', 'What color is this?'], ['assistant', 'Red.'], ['assistant', 'Anything else?'], ['user', 'again'], ['system', 'Model unavailable: nope/x'],
    ]);
    assert.equal(v2Msgs[0].images, 1, 'the image attachment is counted');
    assert.equal(v2Msgs[1].model, 'deepseek-v4.1-flash-free');

    // usage: shared 2 steps x (100 in, 20 out); v2 (50 in, 5+5 out) + (50 in, 10 out); never the old tables' 999s
    const today = (await usageReport()).tools.opencode.periods.today;
    assert.equal(today.input, 300, 'input tokens: every step once, old tables ignored');
    assert.equal(today.output, 60, 'output tokens include reasoning');

    // trash -> hidden, conversation intact; restore -> back; empty trash -> gone everywhere
    const { trashSession, restoreSession, emptyTrash, listTrash } = await import(pathToFileURL(path.join(process.cwd(), 'server', 'trash.js')).href);
    const session = { ...shared, key: 'opencode:ses_shared' };
    await trashSession(session);
    await trashSession(session); // repeat requests must preserve the original restore state
    assert.equal(listTrash().length, 1);
    assert.ok(!(await listOpencode()).some((r) => r.id === 'ses_shared'), 'trashed session is hidden');
    assert.deepEqual(await readOpencode(shared.file), sharedMsgs, 'archive preserves the complete conversation');
    await restoreSession(session.key);
    assert.equal(listTrash().length, 0);
    assert.ok((await listOpencode()).some((r) => r.id === 'ses_shared'), 'restored');
    assert.deepEqual(await readOpencode(shared.file), sharedMsgs, 'restore preserves the conversation');
    const check = () => new DatabaseSync(dbFile, { readOnly: true });
    let c = check();
    assert.equal(c.prepare("SELECT time_archived FROM session_v2 WHERE id = 'ses_shared'").get().time_archived, null, 'restore clears the archive mark');
    c.close();

    await trashSession(session);
    assert.equal(await emptyTrash(), 1);
    c = check();
    for (const [table, col] of [['session_v2', 'id'], ['session_message', 'session_id'], ['blob_ref', 'session_id'], ['session', 'id'], ['message', 'session_id'], ['part', 'session_id']]) {
      assert.equal(c.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${col} = 'ses_shared'`).get().n, 0, `${table} purged`);
    }
    assert.ok(c.prepare("SELECT count(*) AS n FROM session_message WHERE session_id = 'ses_v2'").get().n > 0, 'other sessions untouched');
    c.close();
    assert.deepEqual((await listOpencode()).map((r) => r.id).sort(), ['ses_child', 'ses_untitled', 'ses_v2']);

    // trash records keep their format ({ kind: 'opencode-db', id, previous }) and OpenCode 2 carries time_archived over
    // when it migrates, so a session trashed by an earlier Baton on OpenCode 1 restores the same way as this one
    await trashSession({ ...rows.get('ses_v2'), key: 'opencode:ses_v2' });
    await restoreSession('opencode:ses_v2');
    assert.ok((await listOpencode()).some((r) => r.id === 'ses_v2'));

    console.log('PASS: OpenCode 2 sessions (migrated + new): list, transcript, usage, trash, restore and permanent deletion');
    process.exit(0);
  }
} finally {
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
}
