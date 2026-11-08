// Regression: OpenCode 1.x keeps sessions in opencode.db; older installs used storage/*.json, and a
// migrated machine can have both. The session list and the usage report must count each session once.
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
      env: { ...process.env, HOME: home, USERPROFILE: home, XDG_DATA_HOME: path.join(home, 'data'), BATON_NO_SHELL_ENV: '1', PATH: path.dirname(process.execPath) },
    });
  } else {
    const { DatabaseSync } = await import('node:sqlite');
    const base = path.join(process.env.XDG_DATA_HOME, 'opencode');
    await fs.mkdir(base, { recursive: true });
    const now = Date.now();
    const sid = 'ses_shared', mid = 'msg_user', aid = 'msg_asst';
    const user = { role: 'user', time: { created: now - 2000 } };
    const asst = { role: 'assistant', time: { created: now - 1000 }, modelID: 'beam-free', providerID: 'opencode', tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 0, write: 0 } } };

    // the db (OpenCode 1.x)
    const db = new DatabaseSync(path.join(base, 'opencode.db'));
    db.exec(`CREATE TABLE session (id text PRIMARY KEY, project_id text, parent_id text, directory text, title text, time_created integer, time_updated integer, time_archived integer);
      CREATE TABLE message (id text PRIMARY KEY, session_id text, time_created integer, time_updated integer, data text);
      CREATE TABLE part (id text PRIMARY KEY, message_id text, session_id text, time_created integer, time_updated integer, data text);`);
    db.prepare('INSERT INTO session VALUES (?, ?, NULL, ?, ?, ?, ?, NULL)').run(sid, 'p', '/project', 'Shared session', now - 3000, now - 1000);
    db.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)').run(mid, sid, now - 2000, now - 2000, JSON.stringify(user));
    db.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)').run(aid, sid, now - 1000, now - 1000, JSON.stringify(asst));
    db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)').run('prt_1', mid, sid, now - 2000, now - 2000, JSON.stringify({ type: 'text', text: 'hello' }));
    db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)').run('prt_2', aid, sid, now - 1000, now - 1000, JSON.stringify({ type: 'text', text: 'hi!' }));
    db.close();

    // the same session left behind in the legacy JSON storage, plus one JSON-only session
    const st = path.join(base, 'storage');
    const legacy = async (id, title) => {
      await fs.mkdir(path.join(st, 'session', 'p'), { recursive: true });
      await fs.mkdir(path.join(st, 'message', id), { recursive: true });
      await fs.mkdir(path.join(st, 'part', `${id}_u`), { recursive: true });
      await fs.writeFile(path.join(st, 'session', 'p', `${id}.json`), JSON.stringify({ id, title, directory: '/project', time: { created: now - 3000, updated: now - 1000 } }));
      await fs.writeFile(path.join(st, 'message', id, `${id}_u.json`), JSON.stringify({ id: `${id}_u`, ...user }));
      await fs.writeFile(path.join(st, 'message', id, `${id}_a.json`), JSON.stringify({ id: `${id}_a`, ...asst }));
      await fs.writeFile(path.join(st, 'part', `${id}_u`, 'p.json'), JSON.stringify({ id: 'p', type: 'text', text: 'hello' }));
    };
    await legacy(sid, 'Shared session');
    await legacy('ses_legacy_only', 'Legacy only');

    const { listOpencode, readOpencode } = await import(pathToFileURL(path.join(process.cwd(), 'server', 'sources', 'opencode.js')).href);
    const { usageReport } = await import(pathToFileURL(path.join(process.cwd(), 'server', 'usage.js')).href);

    const rows = await listOpencode();
    assert.deepEqual(rows.map((r) => r.id).sort(), ['ses_legacy_only', sid], 'each session listed once');
    const shared = rows.find((r) => r.id === sid);
    assert.ok(shared.file.includes('opencode.db#'), 'the db copy wins over the legacy JSON');
    assert.deepEqual((await readOpencode(shared.file)).map((m) => [m.role, m.text]), [['user', 'hello'], ['assistant', 'hi!']]);

    const today = (await usageReport()).tools.opencode.periods.today;
    // two sessions x (100 in, 20 out) = 200 / 40; counting the shared one twice would give 300 / 60
    assert.equal(today.input, 200, 'input tokens counted once per session');
    assert.equal(today.output, 40, 'output tokens counted once per session');

    const { trashSession, restoreSession, emptyTrash, listTrash } = await import(pathToFileURL(path.join(process.cwd(), 'server', 'trash.js')).href);
    const session = { ...shared, key: `opencode:${sid}` };
    const transcript = await readOpencode(shared.file);
    await trashSession(session);
    await trashSession(session); // repeat requests must preserve the original restore state
    assert.equal(listTrash().length, 1);
    assert.deepEqual((await listOpencode()).map((r) => r.id), ['ses_legacy_only'], 'DB session and migrated JSON disappear');
    assert.deepEqual(await readOpencode(shared.file), transcript, 'archive preserves the complete conversation');
    await restoreSession(session.key);
    assert.equal(listTrash().length, 0);
    assert.equal((await listOpencode()).length, 2);
    assert.deepEqual(await readOpencode(shared.file), transcript, 'restore preserves messages and parts');

    // No migrated files: the DB reference alone must support trash and restore.
    await fs.rm(path.join(st, 'session', 'p', `${sid}.json`));
    await fs.rm(path.join(st, 'message', sid), { recursive: true });
    await trashSession(session);
    await restoreSession(session.key);
    assert.equal((await listOpencode()).length, 2);
    await legacy(sid, 'Shared session');
    await trashSession(session);
    assert.equal(await emptyTrash(), 1);
    assert.deepEqual((await listOpencode()).map((r) => r.id), ['ses_legacy_only'], 'purge cannot resurrect migrated JSON');
    const check = new DatabaseSync(path.join(base, 'opencode.db'));
    for (const table of ['session', 'message', 'part']) assert.equal(check.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, `${table} purged`);
    check.close();
    const legacyRow = (await listOpencode())[0];
    await trashSession({ ...legacyRow, key: `opencode:${legacyRow.id}` });
    assert.equal((await listOpencode()).length, 0);
    await restoreSession(`opencode:${legacyRow.id}`);
    assert.equal((await listOpencode()).length, 1, 'legacy restore still works');

    console.log('PASS: OpenCode DB/JSON deduplication, trash, restore and permanent deletion');
    process.exit(0);
  }
} finally {
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
}
