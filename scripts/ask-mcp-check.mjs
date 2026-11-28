#!/usr/bin/env node
// End-to-end tests for Baton's non-blocking stdio MCP `ask_user` server, Codex per-run injection,
// bearer token auth, pending_ask persistence, and tool definition size measurement.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MCP_SCRIPT = path.join(ROOT, 'server', 'mcp-ask.js');

const { ASK_USER_TOOL, normalizeAskQuestions } = await import('../server/mcp-ask.js');

// 1. Measure exact tool definition size (bytes & rough ~4 chars/token estimate)
const toolJson = JSON.stringify(ASK_USER_TOOL);
const estTokens = Math.ceil(toolJson.length / 4);
assert(toolJson.length < 1500, `ASK_USER_TOOL schema unexpectedly large: ${toolJson.length} bytes`);

// 2. Unit tests for question normalization
assert.equal(normalizeAskQuestions(null), null);
assert.equal(normalizeAskQuestions([]), null);
assert.equal(normalizeAskQuestions([{ question: 'Only one?', options: [{ label: 'A' }] }]), null);
const norm = normalizeAskQuestions([
  { header: 'DB', question: 'Which database?', multiSelect: false, options: [{ label: 'Postgres', description: 'Managed' }, { label: 'SQLite' }] },
  { header: 'Auth', question: 'Select providers', multiSelect: true, options: ['Google', 'GitHub'] },
]);
assert.equal(norm.length, 2);
assert.equal(norm[0].options[1].description, '');
assert.equal(norm[1].multiSelect, true);
assert.deepEqual(norm[1].options.map((o) => o.label), ['Google', 'GitHub']);

// Helper to drive server/mcp-ask.js over real stdio (newline-delimited JSON-RPC)
function spawnMcp(env = {}) {
  const child = spawn(process.execPath, [MCP_SCRIPT], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      const res = pending.get(msg.id);
      if (res) { pending.delete(msg.id); res(msg); }
    }
  });
  let idSeq = 0;
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++idSeq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timeout: ${method}`)); }, 5000);
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const notify = (method, params = {}) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  const close = () => { child.stdin.end(); child.kill(); };
  return { child, call, notify, close };
}

// 3. Stdio MCP handshake + graceful fallback when Baton env vars are absent
{
  const mcp = spawnMcp({ BATON_ASK_URL: '', BATON_ASK_TOKEN: '' });
  try {
    const init = await mcp.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.result.serverInfo.name, 'baton-ask');
    mcp.notify('notifications/initialized');
    const pong = await mcp.call('ping');
    assert.deepEqual(pong.result, {});
    const listed = await mcp.call('tools/list');
    assert.equal(listed.result.tools.length, 1);
    assert.equal(listed.result.tools[0].name, 'ask_user');
    const noEnv = await mcp.call('tools/call', { name: 'ask_user', arguments: { questions: norm } });
    assert(!noEnv.result.isError);
    assert.match(noEnv.result.content[0].text, /not attached/i);
    const badArgs = await mcp.call('tools/call', { name: 'ask_user', arguments: { questions: [] } });
    assert.equal(badArgs.result.isError, true);
  } finally {
    mcp.close();
  }
}

// 4. Full integration: isolated HOME + fake Codex CLI that parses `-c mcp_servers.baton_ask.*`,
//    spawns server/mcp-ask.js, invokes `ask_user` over stdio -> HTTP localhost -> runner.submitMcpAsk -> store.pending_ask
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'baton-ask-mcp-'));
let httpServer = null;
try {
  const binDir = path.join(tmp, 'bin');
  const dataDir = path.join(tmp, 'data');
  await fs.mkdir(binDir, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  process.env.BATON_DATA_DIR = dataDir;

  // Fake codex binary: records args, extracts baton_ask env from `-c`, spawns mcp-ask.js, calls ask_user, then emits Codex turn completion
  const fakeCodexScript = path.join(tmp, 'fake-codex.mjs');
  await fs.writeFile(fakeCodexScript, `
    import fs from 'node:fs';
    import { spawn } from 'node:child_process';
    const args = process.argv.slice(2);
    const argsOut = process.env.FAKE_ARGS_OUT;
    if (argsOut) fs.writeFileSync(argsOut, JSON.stringify(args));
    const envArg = args.find((a) => a.startsWith('mcp_servers.baton_ask.env='));
    const scriptArg = args.find((a) => a.startsWith('mcp_servers.baton_ask.args='));
    const cmdArg = args.find((a) => a.startsWith('mcp_servers.baton_ask.command='));
    const urlM = envArg?.match(/BATON_ASK_URL="([^"]+)"/);
    const tokM = envArg?.match(/BATON_ASK_TOKEN="([^"]+)"/);
    const script = scriptArg ? JSON.parse(scriptArg.slice('mcp_servers.baton_ask.args='.length))[0] : null;
    const cmd = cmdArg ? JSON.parse(cmdArg.slice('mcp_servers.baton_ask.command='.length)) : process.execPath;
    console.log(JSON.stringify({ type: 'thread.started', thread_id: 'codex-ask-session-1' }));
    if (urlM && tokM && script) {
      const child = spawn(cmd, [script], { env: { ...process.env, BATON_ASK_URL: urlM[1], BATON_ASK_TOKEN: tokM[1] }, stdio: ['pipe', 'pipe', 'pipe'] });
      let b = '';
      await new Promise((resolve, reject) => {
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (c) => {
          b += c;
          for (const line of b.split('\\n')) {
            if (!line.trim()) continue;
            const m = JSON.parse(line);
            if (m.id === 1) {
              child.stdin.write(JSON.stringify({
                jsonrpc: '2.0', id: 2, method: 'tools/call',
                params: {
                  name: 'ask_user',
                  arguments: {
                    questions: [{ header: 'Deploy', question: 'Which environment?', options: [{ label: 'Staging' }, { label: 'Production' }] }],
                  },
                },
              }) + '\\n');
            } else if (m.id === 2) {
              child.stdin.end();
              child.kill();
              resolve(m);
            }
          }
          b = b.endsWith('\\n') ? '' : b.slice(b.lastIndexOf('\\n') + 1);
        });
        child.on('error', reject);
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex', version: '1' } } }) + '\\n');
      });
    }
    console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Waiting for your choice.' } }));
    console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } }));
  `);
  const shim = process.platform === 'win32'
    ? path.join(binDir, 'codex.cmd')
    : path.join(binDir, 'codex');
  await fs.writeFile(
    shim,
    process.platform === 'win32'
      ? `@"${process.execPath}" "${fakeCodexScript}" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${fakeCodexScript}" "$@"\n`,
    { mode: 0o755 },
  );
  process.env.PATH = binDir + path.delimiter + (process.env.PATH || '');

  const runner = await import('../server/runner.js');
  const store = await import('../server/store.js');

  // Local HTTP callback server mirroring server/index.js `/api/internal/ask`
  httpServer = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    const m = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(String(req.headers.authorization || ''));
    const out = runner.submitMcpAsk(m?.[1] || '', body?.questions);
    res.writeHead(out.ok ? 200 : (out.status || 400), { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  });
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  const askUrl = `http://127.0.0.1:${httpServer.address().port}/api/internal/ask`;
  runner.setAskEndpoint(askUrl);

  const argsOut = path.join(tmp, 'codex-args.json');
  process.env.FAKE_ARGS_OUT = argsOut;
  let busAskFired = false;
  const onAsk = () => { busAskFired = true; };
  runner.bus.on('run_ask', onAsk);

  const run = runner.startRun({ tool: 'codex', cwd: tmp, prompt: 'deploy please', perm: 'auto' });
  const doneEv = await new Promise((resolve) => {
    const listener = (ev) => { if (ev.t === 'done') { run.listeners.delete(listener); resolve(ev); } };
    run.listeners.add(listener);
  });
  runner.bus.off('run_ask', onAsk);

  assert.equal(doneEv.ok, true, `codex run failed: ${doneEv.error}`);
  assert.equal(doneEv.hasMcpAsk, true, 'done event must report hasMcpAsk=true');
  assert.equal(busAskFired, true, 'bus run_ask event must fire');
  const askEv = run.events.find((e) => e.t === 'ask');
  assert(askEv, 'run events must include ask');
  assert.equal(askEv.mode, 'turn');
  assert.equal(askEv.questions[0].question, 'Which environment?');
  assert.deepEqual(askEv.questions[0].options.map((o) => o.label), ['Staging', 'Production']);

  // Verify injected Codex `-c` args and post-run token revocation
  const recordedArgs = JSON.parse(await fs.readFile(argsOut, 'utf8'));
  assert(recordedArgs.some((a) => a.startsWith('mcp_servers.baton_ask.command=')));
  assert(recordedArgs.some((a) => a.includes('mcp-ask.js')));
  assert(recordedArgs.some((a) => a.includes('BATON_ASK_TOKEN=')));
  assert.equal(runner.submitMcpAsk(run.askToken, norm).ok, false, 'ask token must expire after run finishes');

  // Verify store pending_ask persistence round-trip
  store.setPendingAsk('codex:codex-ask-session-1', run.deferredAsk);
  const saved = store.getPendingAsk('codex:codex-ask-session-1');
  assert.equal(saved.requestId, askEv.requestId);
  assert.equal(saved.questions.length, 1);
  store.clearPendingAsk('codex:codex-ask-session-1');
  assert.equal(store.getPendingAsk('codex:codex-ask-session-1'), null);

  runner.setAskEndpoint(null);
  console.log(`PASS: ask_user MCP stdio server, Codex per-run injection & persistence (schema: ${toolJson.length} bytes, ~${estTokens} tokens)`);
} finally {
  httpServer?.close();
  await fs.rm(tmp, { recursive: true, force: true });
}
