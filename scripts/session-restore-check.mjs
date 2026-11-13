// Real source readers and trash storage, synthetic histories only; never touches account data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { unavailableCliPath } from './lib-check-clis.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv.includes('--child')) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'baton-restore-'));
  try {
    const app = path.join(tmp, 'app'), home = path.join(tmp, 'home');
    await fs.mkdir(app); await fs.mkdir(home);
    for (const d of ['server', 'scripts', 'public']) await fs.cp(path.join(root, d), path.join(app, d), { recursive: true });
    await fs.copyFile(path.join(root, 'package.json'), path.join(app, 'package.json'));
    await fs.symlink(path.join(root, 'node_modules'), path.join(app, 'node_modules'), 'junction');
    const env = { ...process.env, HOME: home, USERPROFILE: home, BATON_NO_SHELL_ENV: '1',
      PATH: await unavailableCliPath(tmp, ['claude', 'codex', 'agy', 'opencode', 'cursor-agent', 'agent']) };
    for (const k of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']) delete env[k];
    execFileSync(process.execPath, ['--no-warnings', path.join(app, 'scripts/session-restore-check.mjs'), '--child'], { cwd: app, env, stdio: 'inherit', timeout: 60000 });
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
} else {
  const { DatabaseSync } = await import('node:sqlite');
  const { trashSession, restoreSession, listTrash, emptyTrash } = await import('../server/trash.js');
  const indexer = await import('../server/indexer.js');
  const { db: batonDb } = await import('../server/store.js');
  const cwd = path.join(os.homedir(), '프로젝트 with spaces'); await fs.mkdir(cwd);
  const stamp = '2026-11-13T00:00:00.000Z';
  const write = async (file, data) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, data); };
  const jsonl = (events) => events.map((e) => JSON.stringify({ timestamp: stamp, ...e })).join('\n') + '\n';
  const fixtures = [];
  for (const legacy of [true, false]) {
    const id = `claude-${legacy ? 'legacy' : 'current'}`;
    const file = path.join(os.homedir(), '.claude', 'projects', 'fixture', `${id}.jsonl`);
    const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'fixture-image' } };
    await write(file, jsonl([{ type: 'user', cwd, isSidechain: false, message: { content: legacy ? '원문 question' : [{ type: 'text', text: '원문 question' }, image] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: '원문 answer' }] } }]));
    const companion = file.replace(/\.jsonl$/, '') + '/subagents/agent.jsonl'; await write(companion, 'subagent history');
    fixtures.push({ tool: 'claude', id, file, companion });
  }
  for (const legacy of [true, false]) {
    const id = `codex-${legacy ? 'legacy' : 'current'}`;
    const file = path.join(os.homedir(), '.codex', 'sessions', '2026', '11', '13', `rollout-${id}.jsonl`);
    const payload = legacy ? { type: 'user_message', message: '원문 question', images: ['image'] }
      : { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: '원문 question' }, { type: 'image', url: 'fixture' }] } };
    await write(file, jsonl([{ type: 'session_meta', payload: { id, cwd, source: 'cli' } }, { type: 'event_msg', payload },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '원문 answer' }] } }]));
    fixtures.push({ tool: 'codex', id, file });
  }
  const agyRoot = path.join(os.homedir(), '.gemini', 'antigravity-cli'); await fs.mkdir(path.join(agyRoot, 'conversations'), { recursive: true });
  const summary = new DatabaseSync(path.join(agyRoot, 'conversation_summaries.db'));
  summary.exec('CREATE TABLE conversation_summaries (conversation_id TEXT, title TEXT, preview TEXT, step_count INTEGER, last_modified_time TEXT, workspace_uris TEXT, status TEXT, source TEXT, agent_name TEXT, nesting_depth INTEGER, parent_conversation_id TEXT, last_user_input_time TEXT, not_fully_idle INTEGER)');
  const varint = (n) => { const b = []; do { b.push((n & 127) | (n > 127 ? 128 : 0)); n >>>= 7; } while (n); return Buffer.from(b); };
  const field = (n, data) => { const b = Buffer.isBuffer(data) ? data : Buffer.from(data); return Buffer.concat([varint(n * 8 + 2), varint(b.length), b]); };
  for (const legacy of [true, false]) {
    const id = `agy-${legacy ? 'legacy' : 'current'}`, file = path.join(agyRoot, 'conversations', `${id}.db`);
    summary.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?, 2, ?, ?, ?, ?, NULL, 0, NULL, ?, 0)').run(id, 'title', '원문 question', stamp, JSON.stringify([pathToFileURL(cwd).href]), 'IDLE', 'cli', stamp);
    const conv = new DatabaseSync(file); conv.exec('CREATE TABLE steps (idx INTEGER, step_type INTEGER, step_payload BLOB)');
    const user = '원문 question\n[Baton 첨부 이미지 1장] fixture.png';
    conv.prepare('INSERT INTO steps VALUES (0, 14, ?)').run(field(19, legacy ? field(3, field(1, user)) : field(2, user)));
    conv.prepare('INSERT INTO steps VALUES (1, 15, ?)').run(field(20, field(legacy ? 8 : 1, '원문 answer'))); conv.close();
    const companion = path.join(agyRoot, 'brain', id, 'artifact.md'); await write(companion, 'artifact');
    fixtures.push({ tool: 'agy', id, file, companion });
  }
  summary.close();
  for (const f of fixtures) {
    await indexer.forceRefresh();
    const s = await indexer.findSession(f.tool, f.id); assert(s, `${f.id} is indexed`);
    const before = await indexer.readMessages(s), original = await fs.readFile(f.file);
    assert(before.some((m) => m.role === 'user' && m.text.includes('원문 question')));
    assert(before.some((m) => m.role === 'assistant' && m.text.includes('원문 answer')));
    const companion = f.companion && await fs.readFile(f.companion);
    await trashSession(s); await trashSession(s);
    await indexer.forceRefresh();
    assert(!(await indexer.decoratedSessions()).some((row) => row.key === s.key));
    assert.equal(listTrash().filter((row) => row.key === s.key).length, 1);
    // A newly recreated file must survive and the old backup must remain recoverable.
    await write(f.file, 'new CLI data');
    await assert.rejects(restoreSession(s.key), (e) => e.code === 'RESTORE_CONFLICT');
    assert.equal(await fs.readFile(f.file, 'utf8'), 'new CLI data'); assert(listTrash().some((row) => row.key === s.key));
    await fs.unlink(f.file);
    // A missing companion/backup must not cause silent successful deletion of trash metadata.
    const row = batonDb.prepare('SELECT files FROM trash WHERE key = ?').get(s.key);
    const backup = JSON.parse(row.files)[0].to;
    await fs.rename(backup, backup + '.held');
    await assert.rejects(restoreSession(s.key), (e) => e.code === 'RESTORE_MISSING');
    assert(listTrash().some((row) => row.key === s.key)); await fs.rename(backup + '.held', backup);
    if (companion) {
      const rename = fs.rename; let moves = 0;
      try {
        fs.rename = async (...args) => {
          if (++moves === 2) throw Object.assign(new Error('simulated restore failure'), { code: 'EACCES' });
          return rename(...args);
        };
        await assert.rejects(restoreSession(s.key), /simulated restore failure/);
      } finally { fs.rename = rename; }
      await assert.rejects(fs.stat(f.file), { code: 'ENOENT' });
      assert.deepEqual(await fs.readFile(backup), original);
      assert(listTrash().some((row) => row.key === s.key));
    }
    const remove = fs.rm;
    try {
      if (f === fixtures[0]) fs.rm = async () => { throw Object.assign(new Error('cleanup denied'), { code: 'EACCES' }); };
      await restoreSession(s.key);
    } finally { fs.rm = remove; }
    await indexer.forceRefresh();
    const restored = await indexer.findSession(f.tool, f.id);
    assert.equal(restored.cwd, cwd); assert.deepEqual(await indexer.readMessages(restored), before);
    assert.deepEqual(await fs.readFile(f.file), original);
    if (companion) assert.deepEqual(await fs.readFile(f.companion), companion);
    assert((await indexer.decoratedSessions()).some((row) => row.key === s.key));
    assert.equal(listTrash().length, 0);
    await trashSession(restored); assert.equal(await emptyTrash(), 1);
    await assert.rejects(fs.stat(f.file), { code: 'ENOENT' });
    await indexer.forceRefresh();
    assert(!(await indexer.decoratedSessions()).some((row) => row.key === s.key), `${f.id} must not reappear after permanent deletion`);
  }
  console.log('PASS: Claude/Codex/Antigravity old/new histories, transcript/project/attachments, trash/restore/purge, destination conflicts and missing backups');
}
