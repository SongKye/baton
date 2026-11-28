#!/usr/bin/env node
// End-to-end tests for Baton's non-blocking stdio MCP `ask_user` server, Codex per-run injection
// (including default_tools_approval_mode="approve"), bearer token auth, single-ask-per-turn guard,
// IPv6 loopback support, stale requestId rejection, and pending_ask persistence on 4xx errors.
// Self-isolates into a temp copy when run standalone so the repo's real data/baton.db is never touched.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Self-isolation guard when invoked directly (`node scripts/ask-mcp-check.mjs`) outside `scripts/check.mjs`:
if (process.env.BATON_ASK_TEST_ISOLATED !== '1' && !ROOT.startsWith(os.tmpdir())) {
  const iso = await fs.mkdtemp(path.join(os.tmpdir(), 'baton-ask-iso-'));
  try {
    const app = path.join(iso, 'app');
    const home = path.join(iso, 'home');
    await fs.mkdir(app);
    await fs.mkdir(home);
    for (const dir of ['server', 'public']) await fs.cp(path.join(ROOT, dir), path.join(app, dir), { recursive: true });
    await fs.mkdir(path.join(app, 'scripts'));
    await fs.copyFile(path.join(ROOT, 'scripts', 'ask-mcp-check.mjs'), path.join(app, 'scripts', 'ask-mcp-check.mjs'));
    await fs.copyFile(path.join(ROOT, 'package.json'), path.join(app, 'package.json'));
    await fs.symlink(path.join(ROOT, 'node_modules'), path.join(app, 'node_modules'), 'junction');
    const r = spawnSync(process.execPath, ['--no-warnings', path.join(app, 'scripts', 'ask-mcp-check.mjs')], {
      cwd: app,
      env: { ...process.env, HOME: home, USERPROFILE: home, BATON_NO_SHELL_ENV: '1', BATON_ASK_TEST_ISOLATED: '1' },
      stdio: 'inherit',
      timeout: 60000,
    });
    process.exit(r.status ?? 1);
  } finally {
    await fs.rm(iso, { recursive: true, force: true });
  }
}

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

// 4. Full integration: fake Codex CLI parses `-c mcp_servers.baton_ask.*`, calls ask_user TWICE
//    (1st succeeds, 2nd is rejected with 409 so Q1 is preserved), verifies approval flag & token revocation
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'baton-ask-mcp-'));
let httpServer = null;
let v6Server = null;
try {
  const binDir = path.join(tmp, 'bin');
  await fs.mkdir(binDir, { recursive: true });

  const fakeCodexScript = path.join(tmp, 'fake-codex.mjs');
  await fs.writeFile(fakeCodexScript, `
    import fs from 'node:fs';
    import { spawn } from 'node:child_process';
    const args = process.argv.slice(2);
    if (process.env.FAKE_ARGS_OUT) fs.writeFileSync(process.env.FAKE_ARGS_OUT, JSON.stringify(args));
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
      const results = {};
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
              results.first = m.result;
              // Attempt a second ask_user in the same turn — must be rejected (409) without overwriting Q1
              child.stdin.write(JSON.stringify({
                jsonrpc: '2.0', id: 3, method: 'tools/call',
                params: {
                  name: 'ask_user',
                  arguments: {
                    questions: [{ header: 'Second', question: 'Should overwrite?', options: [{ label: 'Yes' }, { label: 'No' }] }],
                  },
                },
              }) + '\\n');
            } else if (m.id === 3) {
              results.second = m.result;
              if (process.env.FAKE_RESULTS_OUT) fs.writeFileSync(process.env.FAKE_RESULTS_OUT, JSON.stringify(results));
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

  const makeAskServer = () => http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    const m = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(String(req.headers.authorization || ''));
    const out = runner.submitMcpAsk(m?.[1] || '', body?.questions);
    res.writeHead(out.ok ? 200 : (out.status || 400), { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  });

  httpServer = makeAskServer();
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  runner.setAskEndpoint(`http://127.0.0.1:${httpServer.address().port}/api/internal/ask`);

  const argsOut = path.join(tmp, 'codex-args.json');
  const resultsOut = path.join(tmp, 'codex-results.json');
  process.env.FAKE_ARGS_OUT = argsOut;
  process.env.FAKE_RESULTS_OUT = resultsOut;
  let busAskCount = 0;
  const onAsk = () => { busAskCount++; };
  runner.bus.on('run_ask', onAsk);

  const run = runner.startRun({ tool: 'codex', cwd: tmp, prompt: 'deploy please', perm: 'auto' });
  const doneEv = await new Promise((resolve) => {
    const listener = (ev) => { if (ev.t === 'done') { run.listeners.delete(listener); resolve(ev); } };
    run.listeners.add(listener);
  });
  runner.bus.off('run_ask', onAsk);

  assert.equal(doneEv.ok, true, `codex run failed: ${doneEv.error}`);
  assert.equal(doneEv.hasMcpAsk, true);
  assert.equal(busAskCount, 1, 'only the first ask_user call should emit run_ask');
  assert.equal(run.pendingAsk, undefined, 'non-blocking MCP ask must not touch blocking run.pendingAsk');
  const askEvs = run.events.filter((e) => e.t === 'ask');
  assert.equal(askEvs.length, 1);
  assert.equal(askEvs[0].mode, 'turn');
  assert.equal(askEvs[0].questions[0].question, 'Which environment?');
  assert.deepEqual(askEvs[0].questions[0].options.map((o) => o.label), ['Staging', 'Production']);

  // Verify 2nd call in the same turn was rejected cleanly (409) without overwriting Q1
  const callResults = JSON.parse(await fs.readFile(resultsOut, 'utf8'));
  assert(!callResults.first.isError);
  assert.equal(callResults.second.isError, true);
  assert.match(callResults.second.content[0].text, /409/);

  // Verify Codex `-c` args include auto-approval (`default_tools_approval_mode="approve"`) & post-run token revocation
  const recordedArgs = JSON.parse(await fs.readFile(argsOut, 'utf8'));
  assert(recordedArgs.includes('mcp_servers.baton_ask.default_tools_approval_mode="approve"'), `missing approval override: ${JSON.stringify(recordedArgs)}`);
  assert(recordedArgs.some((a) => a.startsWith('mcp_servers.baton_ask.command=')));
  assert(recordedArgs.some((a) => a.includes('mcp-ask.js')));
  assert(recordedArgs.some((a) => a.includes('BATON_ASK_TOKEN=')));
  assert.equal(runner.submitMcpAsk(run.askToken, norm).ok, false, 'ask token must expire after run finishes');

  // Verify stale requestId rejection on clearPendingAsk (old Q1 card must NOT delete newer Q2)
  const key = 'codex:codex-ask-session-1';
  store.setPendingAsk(key, { requestId: 'req-q2', questions: norm });
  const stale = store.clearPendingAsk(key, 'req-q1');
  assert.equal(stale.ok, false);
  assert.equal(stale.stale, true);
  assert.equal(store.getPendingAsk(key)?.requestId, 'req-q2', 'stale dismiss must preserve Q2');
  const cleared = store.clearPendingAsk(key, 'req-q2');
  assert.equal(cleared.ok, true);
  assert.equal(cleared.cleared, true);
  assert.equal(store.getPendingAsk(key), null);

  // 5. Verify IPv6 loopback (`::1`) delivery works end-to-end when IPv6 is available
  v6Server = makeAskServer();
  const v6Ready = await new Promise((resolve) => {
    v6Server.once('error', () => resolve(false));
    v6Server.listen(0, '::1', () => resolve(true));
  });
  if (v6Ready) {
    runner.setAskEndpoint(`http://[::1]:${v6Server.address().port}/api/internal/ask`);
    const v6Run = runner.startRun({ tool: 'codex', cwd: tmp, prompt: 'ipv6 check', perm: 'plan' });
    const v6Done = await new Promise((resolve) => {
      const listener = (ev) => { if (ev.t === 'done') { v6Run.listeners.delete(listener); resolve(ev); } };
      v6Run.listeners.add(listener);
    });
    assert.equal(v6Done.ok, true);
    assert.equal(v6Done.hasMcpAsk, true, 'IPv6 [::1] callback must succeed');
  }

  // 5b. OpenCode per-run OPENCODE_CONFIG_CONTENT injection (preserves existing user config + allows baton_ask_*)
  const fakeOcScript = path.join(tmp, 'fake-opencode.mjs');
  await fs.writeFile(fakeOcScript, `
    import fs from 'node:fs';
    import { spawn } from 'node:child_process';
    const rawCfg = process.env.OPENCODE_CONFIG_CONTENT || '';
    if (process.env.FAKE_OC_CFG_OUT) fs.writeFileSync(process.env.FAKE_OC_CFG_OUT, rawCfg);
    const cfg = rawCfg ? JSON.parse(rawCfg) : {};
    const srv = cfg?.mcp?.servers?.baton_ask;
    console.log(JSON.stringify({ type: 'step_start', sessionID: 'ses_oc_ask_1' }));
    if (srv?.command?.length >= 2 && srv?.environment?.BATON_ASK_URL && srv?.environment?.BATON_ASK_TOKEN) {
      const child = spawn(srv.command[0], srv.command.slice(1), {
        env: { ...process.env, ...srv.environment },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
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
                    questions: [{ header: 'Runtime', question: 'Node or Bun?', options: [{ label: 'Node' }, { label: 'Bun' }] }],
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
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'opencode', version: '2' } } }) + '\\n');
      });
    }
    console.log(JSON.stringify({ type: 'text', sessionID: 'ses_oc_ask_1', part: { text: 'Question sent.' } }));
    console.log(JSON.stringify({ type: 'step_finish', sessionID: 'ses_oc_ask_1', part: { reason: 'stop', tokens: { input: 10, output: 5 } } }));
  `);
  const ocShim = process.platform === 'win32' ? path.join(binDir, 'opencode.cmd') : path.join(binDir, 'opencode');
  await fs.writeFile(
    ocShim,
    process.platform === 'win32'
      ? `@"${process.execPath}" "${fakeOcScript}" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${fakeOcScript}" "$@"\n`,
    { mode: 0o755 },
  );
  const ocCfgOut = path.join(tmp, 'oc-cfg.json');
  process.env.FAKE_OC_CFG_OUT = ocCfgOut;
  const prevOcCfg = process.env.OPENCODE_CONFIG_CONTENT;
  process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ theme: 'dark', mcp: { servers: { user_srv: { type: 'remote', url: 'https://example.com' } } } });
  runner.setAskEndpoint(`http://127.0.0.1:${httpServer.address().port}/api/internal/ask`);
  const ocRun = runner.startRun({ tool: 'opencode', cwd: tmp, prompt: 'pick runtime', perm: 'auto' });
  const ocDone = await new Promise((resolve) => {
    const listener = (ev) => { if (ev.t === 'done') { ocRun.listeners.delete(listener); resolve(ev); } };
    ocRun.listeners.add(listener);
  });
  if (prevOcCfg === undefined) delete process.env.OPENCODE_CONFIG_CONTENT;
  else process.env.OPENCODE_CONFIG_CONTENT = prevOcCfg;
  assert.equal(ocDone.ok, true, `opencode run failed: ${ocDone.error}`);
  assert.equal(ocDone.hasMcpAsk, true, 'opencode run must receive ask_user via OPENCODE_CONFIG_CONTENT');
  const injectedOcCfg = JSON.parse(await fs.readFile(ocCfgOut, 'utf8'));
  assert.equal(injectedOcCfg.theme, 'dark', 'existing OPENCODE_CONFIG_CONTENT keys must be preserved');
  assert.equal(injectedOcCfg.mcp.servers.user_srv.url, 'https://example.com', 'existing user MCP servers must be preserved');
  assert.equal(injectedOcCfg.permission['baton_ask_*'], 'allow');
  assert.equal(ocRun.deferredAsk.questions[0].question, 'Node or Bun?');
  assert.equal(runner.submitMcpAsk(ocRun.askToken, norm).ok, false, 'opencode ask token must expire after run finishes');

  runner.setAskEndpoint(null);

  // 6. Real Baton HTTP server regression checks:
  //    - stale DELETE /ask?requestId=old -> 409 (Q2 preserved)
  //    - failed POST /api/run (400 empty prompt) -> Q2 preserved
  //    - stale POST /api/run with askRequestId=old -> 409 STALE_ASK (Q2 preserved)
  //    - matching DELETE /ask?requestId=req-q2 -> 200 (cleared)
  const sid = '019a0000-0000-7000-8000-000000000126';
  const sessDir = path.join(os.homedir(), '.codex', 'sessions', '2026', '11', '28');
  await fs.mkdir(sessDir, { recursive: true });
  const nowIso = new Date().toISOString();
  await fs.writeFile(path.join(sessDir, `rollout-2026-11-28T00-00-00-${sid}.jsonl`), [
    JSON.stringify({ timestamp: nowIso, type: 'session_meta', payload: { id: sid, timestamp: nowIso, cwd: tmp } }),
    JSON.stringify({ timestamp: nowIso, type: 'event_msg', payload: { type: 'user_message', message: 'hello' } }),
    JSON.stringify({ timestamp: nowIso, type: 'event_msg', payload: { type: 'agent_message', message: 'Waiting for your choice.' } }),
  ].join('\n') + '\n');
  store.setPendingAsk(`codex:${sid}`, { requestId: 'req-q2', questions: norm });

  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const srvPort = probe.address().port;
  probe.close();
  const base = `http://127.0.0.1:${srvPort}`;
  const batonSrv = spawn(process.execPath, ['--no-warnings', 'server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, BATON_PORT: String(srvPort), BATON_HOST: '127.0.0.1', BATON_NO_SHELL_ENV: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvLog = '';
  batonSrv.stdout.on('data', (c) => { srvLog += c; });
  batonSrv.stderr.on('data', (c) => { srvLog += c; });
  try {
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      await new Promise((r) => setTimeout(r, 200));
      try { up = (await fetch(`${base}/api/settings`)).ok; } catch { /* booting */ }
    }
    assert(up, `isolated Baton server did not start:\n${srvLog.slice(-1500)}`);
    const getSess = async () => (await fetch(`${base}/api/sessions/codex/${sid}`)).json();
    assert.equal((await getSess()).pendingAsk?.requestId, 'req-q2');

    // Stale DELETE must 409 and preserve Q2
    const staleDel = await fetch(`${base}/api/sessions/codex/${sid}/ask?requestId=req-q1`, { method: 'DELETE' });
    assert.equal(staleDel.status, 409);
    assert.equal((await getSess()).pendingAsk?.requestId, 'req-q2');

    // 400 empty prompt on POST /api/run must preserve Q2
    const emptyRun = await fetch(`${base}/api/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'codex', sessionId: sid, prompt: '   ' }),
    });
    assert.equal(emptyRun.status, 400);
    assert.equal((await getSess()).pendingAsk?.requestId, 'req-q2', '400 POST /api/run must not clear pendingAsk');

    // Stale askRequestId on POST /api/run must 409 STALE_ASK and preserve Q2
    const staleRun = await fetch(`${base}/api/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'codex', sessionId: sid, prompt: 'Postgres', askRequestId: 'req-q1' }),
    });
    assert.equal(staleRun.status, 409);
    assert.equal((await staleRun.json()).code, 'STALE_ASK');
    assert.equal((await getSess()).pendingAsk?.requestId, 'req-q2');

    // Matching DELETE clears Q2 cleanly
    const okDel = await fetch(`${base}/api/sessions/codex/${sid}/ask?requestId=req-q2`, { method: 'DELETE' });
    assert.equal(okDel.status, 200);
    assert.equal((await getSess()).pendingAsk, null);

    // askMcpStrict: true when ask_mcp_at is fresh (run came from Baton with ask tooling), false when session was updated later outside Baton
    store.patchSessionMeta(`codex:${sid}`, { ask_mcp_at: Date.now() + 60_000 });
    assert.equal((await getSess()).askMcpStrict, true);
    store.patchSessionMeta(`codex:${sid}`, { ask_mcp_at: Date.now() - 60_000 });
    assert.equal((await getSess()).askMcpStrict, false);
  } finally {
    batonSrv.kill();
  }

  console.log(`PASS: ask_user MCP stdio server, Codex approval override, stale-ID guard, HTTP 4xx preservation & IPv6 callback (schema: ${toolJson.length} bytes, ~${estTokens} tokens)`);
} finally {
  httpServer?.close();
  v6Server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
}
