// Exercise actual spawning/parsing/control and the production SSE handler against local fake CLIs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv.includes('--child')) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'baton-runner-'));
  try {
    const app = path.join(tmp, 'app'), home = path.join(tmp, 'home'), bin = path.join(tmp, 'bin');
    await fs.mkdir(path.join(app, 'public'), { recursive: true });
    await fs.mkdir(home); await fs.mkdir(bin);
    for (const d of ['server', 'scripts', 'public/locales']) await fs.cp(path.join(root, d), path.join(app, d), { recursive: true });
    await fs.copyFile(path.join(root, 'public/app.js'), path.join(app, 'public/app.js'));
    await fs.copyFile(path.join(root, 'package.json'), path.join(app, 'package.json'));
    await fs.symlink(path.join(root, 'node_modules'), path.join(app, 'node_modules'), 'junction');
    const fixture = path.join(app, 'scripts', 'runner-fixture.mjs');
    const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
    for (const tool of ['claude', 'codex', 'agy', 'opencode']) {
      const win = process.platform === 'win32';
      await fs.writeFile(path.join(bin, tool + (win ? '.cmd' : '')), win
        ? `@echo off\r\n"${process.execPath}" "${fixture}" ${tool} %*\r\n`
        : `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fixture)} ${tool} "$@"\n`, { mode: 0o755 });
    }
    const env = { ...process.env, HOME: home, USERPROFILE: home, BATON_NO_SHELL_ENV: '1', PATH: bin + path.delimiter + process.env.PATH };
    for (const key of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']) delete env[key];
    execFileSync(process.execPath, ['--no-warnings', path.join(app, 'scripts', 'runner-check.mjs'), '--child', ...process.argv.slice(2)], { cwd: app, env, stdio: 'inherit', timeout: 120000 });
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
} else {
  const runner = await import('../server/runner.js');
  const util = await import('../server/util.js');
  const finished = (run, onEvent) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { runner.stopRun(run.id); reject(new Error(`fixture timed out: ${run.tool} ${run.prompt}; ${run.stderr}`)); }, 15000);
    const listener = (ev) => {
      try {
        onEvent?.(ev);
        if (ev.t === 'done') { clearTimeout(timer); run.listeners.delete(listener); resolve(ev); }
      } catch (e) { clearTimeout(timer); run.listeners.delete(listener); runner.stopRun(run.id); reject(e); }
    };
    run.listeners.add(listener);
  });
  const start = (tool, name, extra = {}, opts = {}) => runner.startRun({ tool, cwd: os.homedir(), prompt: JSON.stringify({ name, ...extra }), perm: 'plan', ...opts });
  const project = path.join(os.homedir(), '프로젝트 with spaces');
  await fs.mkdir(project);
  for (const tool of ['claude', 'codex', 'agy', 'opencode']) {
    const cwdFile = path.join(os.homedir(), `${tool}-cwd.json`);
    assert((await finished(start(tool, 'tools', { cwdFile }, { cwd: project }))).ok);
    const location = JSON.parse(await fs.readFile(cwdFile, 'utf8'));
    assert.equal(await fs.realpath(location.cwd), await fs.realpath(project));
    assert.equal(await fs.realpath(location.pwd), await fs.realpath(project));
    for (const name of ['tools', 'no-newline', 'incomplete', 'error', 'nonzero']) {
      const run = start(tool, name);
      const end = await finished(run);
      assert.equal(end.ok, ['tools', 'no-newline'].includes(name), `${tool}/${name}: ${end.error}`);
      assert(run.events.some((e) => e.t === 'text' && e.text.includes('한글 😀')));
      if (name === 'tools') {
        assert(run.events.some((e) => e.t === 'tool'));
        assert(run.events.some((e) => e.t === 'tool_done' && !e.error));
      }
      if (name === 'error') assert.equal(end.limited, true);
      assert.equal(runner.activeRunFor(`${tool}:${run.sessionId}`), null);
    }
    for (const perm of ['plan', 'auto', 'full']) {
      const argsFile = path.join(os.homedir(), 'args.json');
      const run = start(tool, 'tools', { argsFile }, { perm, sessionId: `${tool}-test`, model: 'fixture-model', effort: 'low' });
      assert((await finished(run)).ok);
      const args = JSON.parse(await fs.readFile(argsFile, 'utf8'));
      assert(args.includes('fixture-model') && args.includes(`${tool}-test`));
      const has = (...xs) => xs.every((x) => args.some((a) => a.includes(x)));
      const lacks = (...xs) => xs.every((x) => !args.some((a) => a.includes(x)));
      // the same meaning for every CLI: plan = read only, auto = everyday project work, full = no limits
      const ok = {
        claude: { plan: () => has('plan') && lacks('--dangerously'), auto: () => has('auto') && lacks('--dangerously'), full: () => has('--dangerously-skip-permissions') },
        codex: {
          plan: () => has('sandbox_mode="read-only"') && lacks('network_access', '--dangerously'),
          auto: () => has('sandbox_mode="workspace-write"', 'sandbox_workspace_write.network_access=true', 'sandbox_workspace_write.writable_roots=') && lacks('--dangerously'),
          full: () => has('--dangerously-bypass-approvals-and-sandbox') && lacks('sandbox_mode'),
        },
        agy: {
          plan: () => has('plan') && lacks('--settings', '--dangerously'),
          auto: () => { const i = args.indexOf('--settings'); const allow = i > 0 ? JSON.parse(args[i + 1]).permissions.allow : []; return has('accept-edits') && ['command(git)', 'command(npm)', 'command(node)'].every((r) => allow.includes(r)) && !allow.includes('command(rm)') && !allow.includes('command(*)') && lacks('--dangerously'); },
          full: () => has('--dangerously-skip-permissions') && lacks('accept-edits'),
        },
        opencode: { plan: () => has('plan') && lacks('--auto'), auto: () => has('build') && lacks('--auto'), full: () => has('build', '--auto') },
      };
      assert(ok[tool][perm](), `${tool}/${perm} args: ${JSON.stringify(args)}`);
    }
  }
  {
    // Codex sandbox refusals arrive as failed commands; in auto they are reported as blocked, in full they are not
    const blocked = await finished(start('codex', 'sandboxed', {}, { perm: 'auto' }));
    assert.deepEqual(blocked.denied, ['shell: git commit'], JSON.stringify(blocked.denied));
    assert.deepEqual((await finished(start('codex', 'sandboxed', {}, { perm: 'full' }))).denied, []);
    // a git repository's folder becomes writable for Codex in auto, found from a subfolder too
    const repo = path.join(os.homedir(), 'repo'), sub = path.join(repo, 'src', 'deep');
    await fs.mkdir(path.join(repo, '.git'), { recursive: true }); await fs.mkdir(sub, { recursive: true });
    const argsFile = path.join(os.homedir(), 'args-repo.json');
    assert((await finished(start('codex', 'tools', { argsFile }, { perm: 'auto', cwd: sub }))).ok);
    const roots = JSON.parse(await fs.readFile(argsFile, 'utf8')).find((a) => a.startsWith('sandbox_workspace_write.writable_roots='));
    assert(roots.includes(JSON.stringify(path.join(repo, '.git'))), roots);
  }
  for (const answer of [{ 'Pick?': 'Yes' }, { 'Pick?': 'free text' }, null]) {
    const run = start('claude', 'ask');
    const end = await finished(run, (ev) => {
      if (ev.t !== 'ask') return;
      assert.equal(runner.answerRun(run.id, 'wrong-id', answer), false);
      assert.equal(runner.answerRun(run.id, ev.requestId, answer), true);
      assert.equal(runner.answerRun(run.id, ev.requestId, answer), false);
    });
    assert(end.ok);
    const text = run.events.filter((e) => e.t === 'text').map((e) => e.text).join('');
    assert(text.includes(answer ? 'updatedInput' : 'deny'));
    assert.equal(runner.answerRun(run.id, 'question-1', answer), false);
  }
  const denied = start('claude', 'deny');
  assert((await finished(denied)).ok);
  assert(denied.events.some((e) => e.t === 'text' && e.text.includes('deny')));
  const pidFile = path.join(os.homedir(), 'child.pid');
  const stopped = start('codex', 'hang', { pidFile }, { sessionId: 'busy' });
  assert.throws(() => start('codex', 'tools', {}, { sessionId: 'busy' }), (e) => e.code === 'BUSY');
  const other = start('claude', 'tools');
  const otherDone = finished(other);
  const end = await finished(stopped, (ev) => { if (ev.t === 'text') runner.stopRun(stopped.id); });
  assert.equal(end.ok, false);
  assert.equal(stopped.stopped, true);
  assert((await otherDone).ok, 'stopping one session must not stop another');
  assert.equal(runner.activeRunFor('codex:busy'), null);
  assert((await finished(start('codex', 'tools', {}, { sessionId: 'busy' }))).ok);

  if (process.platform !== 'win32') {
    // Runs are detached into their own process group; Baton exiting must still end them and their tools.
    const orphanPid = path.join(os.homedir(), 'orphan.pid');
    const script = `const r = await import(${JSON.stringify(new URL('../server/runner.js', import.meta.url).href)});
      r.startRun({ tool: 'codex', cwd: process.env.HOME, perm: 'plan', prompt: JSON.stringify({ name: 'hang', pidFile: ${JSON.stringify(orphanPid)} }) });
      const fs = await import('node:fs');
      const wait = setInterval(() => { if (fs.existsSync(${JSON.stringify(orphanPid)})) { clearInterval(wait); process.exit(0); } }, 50);`;
    execFileSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], { timeout: 20000 });
    const pid = Number(await fs.readFile(orphanPid, 'utf8'));
    const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
    for (let i = 0; i < 50 && alive(); i++) await new Promise((r) => setTimeout(r, 100));
    assert(!alive(), 'a run\'s tool process must not outlive Baton');
  }

  for (const tool of ['claude', 'codex', 'opencode']) {
    const oneShotArgs = path.join(os.homedir(), `oneshot-${tool}.json`);
    await assert.rejects(runner.oneShot({ tool, model: 'fixture-model', effort: 'low', prompt: JSON.stringify({ name: 'error', argsFile: oneShotArgs }) }));
    const args = JSON.parse(await fs.readFile(oneShotArgs, 'utf8'));
    assert(args.includes('fixture-model'));
    assert(args.includes(tool === 'codex' ? 'model_reasoning_effort="low"' : 'low'));

    // One-shot calls always run in Baton's own folder, outside every project (CLIs that keep one-shot sessions
    // would otherwise file them under whatever folder the caller passed, e.g. ~/baton/data -> the "baton" project)
    const where = path.join(os.homedir(), `oneshot-${tool}-cwd.json`);
    await assert.rejects(runner.oneShot({ tool, cwd: os.homedir(), prompt: JSON.stringify({ name: 'error', cwdFile: where }) }));
    const loc = JSON.parse(await fs.readFile(where, 'utf8'));
    assert.equal(await fs.realpath(loc.cwd), await fs.realpath(util.ONESHOT_DIR), `${tool}: one-shot ran in ${loc.cwd}`);
    assert.equal(path.resolve(loc.pwd), path.resolve(util.ONESHOT_DIR), `${tool}: one-shot $PWD`);
  }
  // The session a one-shot call leaves behind is found from the CLI's JSON output, however the event is named
  assert.equal(runner.oneShotSessionId('opencode', '{"type":"step_start","sessionID":"ses_a","part":{}}\n{"type":"text","sessionID":"ses_a"}'), 'ses_a');
  assert.equal(runner.oneShotSessionId('opencode', 'not json\n{"type":"x","part":{"sessionID":"ses_b"}}'), 'ses_b');
  assert.equal(runner.oneShotSessionId('agy', '{"conversation_id":"c-1","status":"SUCCESS","response":"OK"}'), 'c-1');
  assert.equal(runner.oneShotSessionId('cursor', '{"type":"result","session_id":"s-9"}'), 's-9');
  assert.equal(runner.oneShotSessionId('claude', '{"session_id":"x"}'), null, 'claude/codex do not keep one-shot sessions');
  assert.equal(runner.oneShotSessionId('opencode', 'garbage'), null);
  // Sessions recorded in Baton's own folders are never listed
  assert(util.isInternalCwd(util.ONESHOT_DIR) && util.isInternalCwd(path.join(util.ONESHOT_DIR, '/')) && util.isInternalCwd(util.DATA_DIR));
  assert(!util.isInternalCwd(path.join(util.DATA_DIR, 'skill-backups')) && !util.isInternalCwd(util.ROOT) && !util.isInternalCwd(os.homedir()) && !util.isInternalCwd(null));
  // Run the actual SSE route function with the real run object, over HTTP.
  const source = await fs.readFile(path.join(root, 'server', 'index.js'), 'utf8');
  const code = source.slice(source.indexOf('function streamRun('), source.indexOf('// ---------- the agent asked'));
  const ctx = vm.createContext({ getRun: runner.getRun, publicRun: runner.publicRun, setInterval, clearInterval, send: (res, status, body) => { res.writeHead(status); res.end(JSON.stringify(body)); } });
  vm.runInContext(code, ctx);
  if (process.argv.includes('--browser')) {
    const { checkBrowser } = await import('./browser-run-check.mjs');
    await checkBrowser({ root, runner, streamRun: ctx.streamRun, start, finished, home: os.homedir() });
  }
  const many = start('claude', 'many');
  assert((await finished(many)).ok);
  const server = http.createServer((req, res) => {
    const params = new URL(req.url, 'http://local').searchParams;
    ctx.streamRun(req, res, params.get('run') || many.id, Number(params.get('from')));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    for (const from of [0, 5000, 20000]) {
      const response = await fetch(`${url}?from=${from}`);
      const events = (await response.text()).split('\n\n').filter((s) => s.startsWith('data: ')).map((s) => JSON.parse(s.slice(6)));
      assert.equal(events.filter((e) => e.t === 'text').map((e) => e.text).join(''), [...many.eventLog.replay(from)].filter((e) => e.t === 'text').map((e) => e.text).join(''));
      assert.equal(events.at(-1).t, 'done');
      assert.equal(events.at(-1).ok, true);
    }
    const releaseFile = path.join(os.homedir(), 'release-slow');
    const slow = start('claude', 'slow', { releaseFile });
    const slowDone = finished(slow);
    const response = await fetch(`${url}?run=${slow.id}`);
    const reader = response.body.getReader();
    let received = '', last = -1;
    while (!received.slice(0, received.lastIndexOf('\n\n')).includes('first')) received += new TextDecoder().decode((await reader.read()).value);
    for (const frame of received.slice(0, received.lastIndexOf('\n\n')).split('\n\n')) if (frame.startsWith('data: ')) last = JSON.parse(frame.slice(6)).i;
    await reader.cancel(); // phone disconnects while the run continues
    await fs.writeFile(releaseFile, 'continue');
    assert((await slowDone).ok);
    const remaining = await (await fetch(`${url}?run=${slow.id}&from=${last + 1}`)).text();
    const replayed = remaining.split('\n\n').filter((s) => s.startsWith('data: ')).map((s) => JSON.parse(s.slice(6)));
    assert(!replayed.some((e) => e.t === 'text' && e.text.includes('first')));
    assert(replayed.some((e) => e.t === 'text' && e.text.includes('second')));
    assert.equal(replayed.at(-1).t, 'done');
  } finally { await new Promise((resolve) => server.close(resolve)); many.eventLog.dispose(); }
  console.log('PASS: four CLI parsers, permissions, incomplete/nonzero exits, questions, cancellation/concurrency, one-shot failures, HTTP SSE replay');
}
