#!/usr/bin/env node
// Live compatibility test: drives each coding CLI through Baton's own code, the way a user would, and
// reports what broke. Uses the CLIs' real subscriptions, but in a separate home folder
// (~/.baton-compat/home) so test sessions, configs and sign-in tokens never touch the everyday ones.
//
//   npm run compat:smoke                         every supported CLI that is installed
//   npm run compat:smoke -- codex                just one
//   npm run compat:smoke -- --bin codex=/dir     test the CLI binary in /dir instead of the one on PATH
//   npm run compat:smoke -- --expect codex=0.156.0  require an exact executable version
//   npm run compat:smoke -- --strict             fail if any requested CLI is skipped
//   npm run compat:smoke -- --json out.json      also write the full report
//   npm run compat:smoke -- --update-fixtures    store the current event shapes as the new baseline
//   npm run compat:smoke -- --login              one-time sign-in for the test home (run in a terminal)
//   npm run compat:smoke -- --report             maintainers on Windows / macOS: install each CLI's verified version
//                                                into ~/.baton-compat/versions (off PATH), test it, and record what
//                                                passed on this OS in server/compat.json (a PR merged once CI is green)
//   npm run compat:smoke -- --install            the same install step without recording
//   npm run compat:smoke -- --report --installed record the CLIs installed on this computer instead
//
// Per CLI: new session -> resume it -> it shows up in the session list with a readable transcript ->
// one-shot (briefs/drafts) -> live limits -> model list. Plus a shape diff (L3): every key path of the
// streamed events and the session file is compared with scripts/compat-fixtures/<tool>.json, so a renamed
// field shows up even when the test still passes.
// Exit code 1 if any step failed.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { requireContract, checkVersion, checkResume, checkTranscript, failureCategory, collectShape, compareShapes } from './lib-compat-contracts.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_HOME = path.resolve((process.env.BATON_COMPAT_HOME || path.join(os.homedir(), '.baton-compat', 'home')).replace(/^~(?=$|\/)/, os.homedir()));
const FIXTURES = path.join(REPO, 'scripts', 'compat-fixtures');
const SMOKE_TOOLS = ['claude', 'codex', 'agy', 'opencode']; // Cursor is unverified and not supported
const HAS_LIMITS = new Set(['claude', 'codex', 'agy']); // OpenCode has no subscription limits
const MARK = '__BATON_SMOKE_REPORT__';
const NPM_PKG = { claude: '@anthropic-ai/claude-code', codex: '@openai/codex', opencode: 'opencode-ai' };

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const optAll = (n) => argv.flatMap((a, i) => (a === n ? [argv[i + 1]] : []));

if (flag('--child')) await child(opt('--child'));
else if (flag('--login')) await login();
else await parent();

// ------------------------------------------------------------------ parent
async function parent() {
  const valueOf = new Set(['--bin', '--json', '--expect']);
  const named = argv.filter((a, i) => !a.startsWith('-') && !valueOf.has(argv[i - 1]));
  const tools = named.length ? named : SMOKE_TOOLS;
  const pairs = (name) => optAll(name).map((s) => { const i = s.indexOf('='); if (i < 1 || i === s.length - 1) throw new Error(`${name} requires tool=value`); return [s.slice(0, i), s.slice(i + 1)]; });
  const bins = Object.fromEntries(pairs('--bin').map(([tool, dir]) => [tool, path.resolve(dir)]));
  const expected = Object.fromEntries(pairs('--expect'));
  const installErrors = {};
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).stdout?.trim() || null;
  const dirty = Boolean(spawnSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' }).stdout?.trim());
  // --report / --install: test exactly the verified version of each CLI, installed off PATH, so the OS columns
  // compare like with like and a CLI that isn't installed on this computer still gets tested
  if ((flag('--report') || flag('--install')) && !flag('--installed')) {
    const table = JSON.parse(await fsp.readFile(path.join(REPO, 'server', 'compat.json'), 'utf8'));
    for (const tool of tools) {
      if (bins[tool]) continue;
      const v = table[tool]?.verified;
      if (!v) continue;
      if (!NPM_PKG[tool]) { console.log(`${tool}: no versioned installer on this OS, testing the installed one (if any)`); continue; }
      expected[tool] = v;
      process.stdout.write(`installing ${tool} ${v} into the test folder… `);
      try { bins[tool] = await installVersion(tool, v); console.log('ok'); } catch (e) { installErrors[tool] = e.message; console.log(`failed: ${e.message}`); }
    }
  }
  const reports = [];
  for (const tool of tools) {
    process.stdout.write(`\n${tool}: `);
    const r = installErrors[tool]
      ? { tool, ok: false, steps: [{ name: 'install', ok: false, category: 'environment', ms: 0, detail: installErrors[tool] }] }
      : await runChild(tool, bins[tool], expected[tool]);
    Object.assign(r, { revision, dirty, platform: process.platform, arch: process.arch, node: process.version, checkedAt: new Date().toISOString(), expectedVersion: expected[tool] || null });
    reports.push(r);
    if (r.skipped) { console.log(`skipped — ${r.skipped}`); continue; }
    console.log(`v${r.version || '?'} ${r.ok ? 'PASS' : 'FAIL'}`);
    for (const s of r.steps) console.log(`  ${s.ok ? '✓' : '✗'} ${s.name} (${(s.ms / 1000).toFixed(1)}s)${s.ok ? '' : ` — ${s.detail}`}`);
    const d = r.drift;
    if (d) {
      if (d.untypedBaseline) console.log('  ! baseline has no value types yet — review required');
      if (!d.baseline) console.log('  · no stored shapes yet (run with --update-fixtures)');
      else if (!d.added.length && !d.removed.length && !d.changed.length && !d.missingKinds.length) console.log(`  ✓ shapes unchanged since v${d.baseline}`);
      else {
        console.log(`  ! shapes changed since v${d.baseline}: ${d.removed.length} gone, ${d.added.length} new`);
        for (const p of d.removed.slice(0, 15)) console.log(`      - ${p}`);
        for (const p of d.added.slice(0, 15)) console.log(`      + ${p}`);
        for (const p of d.changed.slice(0, 15)) console.log(`      ! ${p}`);
        for (const k of d.missingKinds) console.log(`      ? event kind not observed: ${k}`);
      }
    }
    if (flag('--update-fixtures') && !flag('--report') && r.ok && r.shapes) {
      await fsp.mkdir(FIXTURES, { recursive: true });
      await fsp.writeFile(path.join(FIXTURES, `${tool}.json`), JSON.stringify({ version: r.version, ...r.shapes }, null, 1) + '\n');
      console.log(`  · stored shapes for v${r.version}`);
    }
  }
  const out = opt('--json');
  if (out) await fsp.writeFile(out, JSON.stringify(reports, null, 2));
  let recordingFailed = false;
  if (flag('--report')) {
    // hand the results to compat-weekly: it checks maintainer access, edits a separate worktree and opens the PR
    const file = path.join(os.tmpdir(), `baton-smoke-report-${process.pid}.json`);
    await fsp.writeFile(file, JSON.stringify(reports));
    console.log('\nRecording the results for this OS…');
    const code = await new Promise((resolve) => spawn(process.execPath, ['--no-warnings', path.join(REPO, 'scripts', 'compat-weekly.mjs'), '--record-os', file], { stdio: 'inherit' }).on('close', resolve));
    await fsp.rm(file, { force: true });
    if (code) { recordingFailed = true; console.log('Recording failed (see above). The test results themselves are listed above.'); }
  }
  const failed = reports.filter((r) => !r.skipped && !r.ok);
  const skipped = reports.filter((r) => r.skipped);
  const passed = reports.filter((r) => !r.skipped && r.ok);
  console.log(`\n${passed.length} passed${failed.length ? `, FAILED: ${failed.map((r) => r.tool).join(', ')}` : ''}${skipped.length ? `, skipped: ${skipped.map((r) => r.tool).join(', ')}` : ''}`);
  process.exit(failed.length || recordingFailed || !passed.length || (flag('--strict') && skipped.length) ? 1 : 0);
}

/** Run the test for one CLI in a throwaway copy of Baton (its own data/), with HOME = the test home. */
async function runChild(tool, binDir, expectedVersion) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), `baton-smoke-${tool}-`));
  try {
    const app = path.join(tmp, 'app');
    await fsp.mkdir(path.join(app, 'public'), { recursive: true });
    for (const d of ['server', 'scripts', path.join('public', 'locales')]) await fsp.cp(path.join(REPO, d), path.join(app, d), { recursive: true });
    await fsp.copyFile(path.join(REPO, 'package.json'), path.join(app, 'package.json'));
    await fsp.symlink(path.join(REPO, 'node_modules'), path.join(app, 'node_modules'), 'junction').catch(() => {});
    await fsp.mkdir(TEST_HOME, { recursive: true });
    const env = {
      ...process.env, HOME: TEST_HOME, USERPROFILE: TEST_HOME, BATON_NO_SHELL_ENV: '1', // Windows: USERPROFILE is the home folder
      PATH: [binDir, path.dirname(process.execPath), process.env.PATH].filter(Boolean).join(path.delimiter),
      BATON_EXPECT_VERSION: expectedVersion || '', BATON_EXPECT_BIN_DIR: binDir ? path.resolve(binDir) : '',
      BATON_SMOKE_REPORT_FILE: path.join(tmp, 'report.json'),
    };
    for (const k of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME']) delete env[k];
    const out = await new Promise((resolve) => {
      const c = spawn(process.execPath, ['--no-warnings', path.join(app, 'scripts', 'compat-smoke.mjs'), '--child', tool], { cwd: TEST_HOME, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let se = '';
      c.stdout.resume();
      c.stderr.on('data', (b) => { se = (se + b).slice(-4000); });
      const timer = setTimeout(() => c.kill('SIGKILL'), 15 * 60_000);
      c.on('close', (code) => { clearTimeout(timer); resolve({ se, code }); });
      c.on('error', (e) => { clearTimeout(timer); resolve({ se: e.message, code: -1 }); });
    });
    let report;
    try { report = JSON.parse(await fsp.readFile(env.BATON_SMOKE_REPORT_FILE, 'utf8')); }
    catch { return { tool, ok: false, steps: [{ name: 'test run', ok: false, category: 'environment', ms: 0, detail: `test process exited ${out.code} without a complete report: ${out.se.trim().slice(-800)}` }] }; }
    if (out.code !== 0) { report.ok = false; report.steps.push({ name: 'test process', ok: false, category: 'environment', ms: 0, detail: `exit ${out.code}` }); }
    return report;
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** npm install <pkg>@<version> into ~/.baton-compat/versions/<tool>/<version>; returns the folder with its binary. */
async function installVersion(tool, version) {
  const dir = path.join(os.homedir(), '.baton-compat', 'versions', tool, version);
  const bin = path.join(dir, 'node_modules', '.bin');
  const exe = path.join(bin, process.platform === 'win32' ? `${tool}.cmd` : tool);
  if (fs.existsSync(exe)) return bin;
  await fsp.mkdir(dir, { recursive: true });
  const code = await new Promise((resolve) => spawn('npm', ['install', '--prefix', dir, '--no-audit', '--no-fund', '--silent', `${NPM_PKG[tool]}@${version}`],
    { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' }).on('close', resolve).on('error', () => resolve(1)));
  if (code !== 0 || !fs.existsSync(exe)) throw new Error(`npm install ${NPM_PKG[tool]}@${version} failed`);
  return bin;
}

/** One-time sign-in for the test home. Separate tokens from the everyday CLIs, so neither logs the other out. */
async function login() {
  await fsp.mkdir(TEST_HOME, { recursive: true });
  const win = process.platform === 'win32';
  const table = JSON.parse(await fsp.readFile(path.join(REPO, 'server', 'compat.json'), 'utf8'));
  const onPath = (tool) => spawnSync(win ? 'where' : 'which', [tool], { stdio: 'ignore' }).status === 0;
  // a CLI that isn't installed on this computer: sign in with the verified version from the test folder
  const cmdFor = async (tool) => {
    if (onPath(tool)) return tool;
    console.log(`${tool} isn't installed here: installing ${tool} ${table[tool].verified} into the test folder for the sign-in…`);
    return path.join(await installVersion(tool, table[tool].verified), win ? `${tool}.cmd` : tool);
  };
  const run = (cmd, args) => new Promise((resolve) => {
    console.log(`\n$ ${cmd} ${args.join(' ')}   (home: ${TEST_HOME})`);
    // shell on Windows: npm-installed CLIs are .cmd shims that Node only starts through one (quoted: paths may have spaces)
    spawn(win && cmd.includes(path.sep) ? `"${cmd}"` : cmd, args, { cwd: TEST_HOME, stdio: 'inherit', shell: win, env: { ...process.env, HOME: TEST_HOME, USERPROFILE: TEST_HOME } })
      .on('close', resolve).on('error', (e) => { console.log(e.message); resolve(1); });
  });
  console.log(`Signing in the test copies of Claude Code and Codex (test home: ${TEST_HOME}).\nUse the same accounts as usual; your everyday sign-ins are not touched. Antigravity needs nothing.`);
  const a = await run(await cmdFor('claude'), ['auth', 'login']);
  const b = await run(await cmdFor('codex'), ['login', '--device-auth']);
  const ok = fs.existsSync(path.join(TEST_HOME, '.claude', '.credentials.json')) && fs.existsSync(path.join(TEST_HOME, '.codex', 'auth.json'));
  console.log(ok ? '\nDone: both are signed in.' : `\nNot finished (claude exit ${a}, codex exit ${b}). Run the same command again.`);
}

// ------------------------------------------------------------------ child (inside the copy, HOME = test home)
async function child(tool) {
  const R = { tool, ok: false, version: null, steps: [], drift: null, shapes: null };
  const done = (extra = {}) => {
    Object.assign(R, extra);
    // Large schema reports exceed a pipe's buffer; process.exit after console.log truncates them.
    if (process.env.BATON_SMOKE_REPORT_FILE) {
      fs.writeFileSync(process.env.BATON_SMOKE_REPORT_FILE, JSON.stringify(R));
      process.exit(0);
    }
    process.stdout.write(MARK + JSON.stringify(R) + '\n', () => process.exit(0));
  };
  try {
    await import(pathToFileURL(path.join(REPO, 'server', 'env.js')).href);
    const { binFor } = await import(pathToFileURL(path.join(REPO, 'server', 'tools.js')).href);
    const { runCli } = await import(pathToFileURL(path.join(REPO, 'server', 'platform.js')).href);
    const runner = await import(pathToFileURL(path.join(REPO, 'server', 'runner.js')).href);
    const indexer = await import(pathToFileURL(path.join(REPO, 'server', 'indexer.js')).href);

    const bin = binFor(tool);
    if (!bin) return done({ skipped: 'not installed' });
    R.binary = bin;
    if (process.env.BATON_EXPECT_BIN_DIR && path.resolve(path.dirname(bin)) !== path.resolve(process.env.BATON_EXPECT_BIN_DIR)) {
      throw Object.assign(new Error('requested binary was not found in the supplied --bin directory'), { category: 'environment' });
    }
    const vr = await runCli(bin, ['--version'], { timeout: 15000 });
    R.version = checkVersion(vr, process.env.BATON_EXPECT_VERSION);
    const home = os.homedir();
    if (tool === 'claude' && !fs.existsSync(path.join(home, '.claude', '.credentials.json'))) return done({ skipped: 'test home not signed in — run: npm run compat:smoke -- --login' });
    if (tool === 'codex' && !fs.existsSync(path.join(home, '.codex', 'auth.json'))) return done({ skipped: 'test home not signed in — run: npm run compat:smoke -- --login' });

    // L3: every key path of every raw streamed event, grouped by event kind
    const stream = new Set(), types = {};
    runner.rawTap.fn = (t, e) => { if (t === tool) collectShape(e, kindOf(t, e), stream, types); };

    const cwd = await fsp.mkdtemp(path.join(home, 'project-'));
    R.project = cwd;
    R.profile = 'isolated-default-account';
    // Use the light model verified against every required scenario; other vendors retain account defaults.
    const model = process.env[`BATON_SMOKE_${tool.toUpperCase()}_MODEL`] || (tool === 'claude' ? 'claude-haiku-5-5' : undefined);
    const effort = ['claude', 'codex', 'agy'].includes(tool) ? 'low' : undefined;
    R.generation = { model: model || 'account-default', effort: effort || 'account-default' };
    let blocked = null;
    const allowGeneration = () => { if (blocked) throw Object.assign(new Error(`generation stopped after ${blocked.name}: ${blocked.detail}`), { category: blocked.category }); };

    const step = async (name, fn) => {
      const t0 = Date.now();
      try { const detail = await fn(); R.steps.push({ name, ok: true, ms: Date.now() - t0, detail: detail || '' }); return true; }
      catch (e) {
        const failure = { name, ok: false, category: failureCategory(e), ms: Date.now() - t0, detail: String(e?.message || e).slice(0, 1500) };
        R.steps.push(failure);
        if (!blocked && (name === 'CLI flags' || ['auth', 'quota', 'network', 'environment'].includes(failure.category))) blocked = failure;
        return false;
      }
    };
    const chat = (prompt, sessionId, options = {}) => new Promise((resolve, reject) => {
      allowGeneration();
      const run = runner.startRun({ tool, sessionId, cwd, prompt, model, effort, perm: options.perm || 'plan' });
      let text = '', tools = 0, completed = 0, questions = 0;
      const toolNames = [];
      const timer = setTimeout(() => { runner.stopRun(run.id); reject(new Error('no reply within 4 minutes')); }, 240_000);
      run.listeners.add((ev) => {
        if (ev.t === 'text') text += ev.text;
        if (ev.t === 'tool') { tools++; toolNames.push(ev.name); }
        if (ev.t === 'tool_done') completed++;
        if (ev.t === 'ask' && options.answer) {
          questions++;
          runner.answerRun(run.id, ev.requestId, Object.fromEntries(ev.questions.map((q) => [q.question, options.answer])));
        }
        if (ev.t !== 'done') return;
        clearTimeout(timer);
        if (!ev.ok) return reject(new Error(`run failed: ${ev.error || 'unknown'}${run.stderr ? `\nstderr: ${run.stderr.slice(-600)}` : ''}`));
        resolve({ sessionId: run.sessionId, text: text || ev.result || '', tools, completed, questions, toolNames });
      });
    });
    const expect = (text, word) => requireContract(String(text).includes(word), `expected "${word}" in the reply, got: ${String(text).slice(0, 300) || '(empty)'}`);

    await step('CLI flags', async () => {
      const { COMPAT } = await import(pathToFileURL(path.join(REPO, 'server', 'compat.js')).href);
      for (const check of COMPAT[tool]?.checks || []) {
        const help = await runCli(bin, check.args, { timeout: 20000 });
        if (help.code !== 0) throw new Error(`help command failed (${help.code}): ${help.stderr}`);
        requireContract(check.expect.every((x) => (help.stdout + help.stderr).includes(x)), `missing flags in ${check.args.join(' ')}`);
      }
    });

    const secret = `BATON-${crypto.randomBytes(12).toString('hex')}`;
    const first = `Remember this value for the next turn: ${secret}. Reply with exactly BATONSMOKEONE. Do not use tools or save the value to a file.`;
    const second = 'Return the value I asked you to remember in the previous turn, followed by BATONSMOKETWO. Do not use tools.';

    let sid = null, projectVerified = false;
    await step('new session', async () => {
      const r = await chat(first);
      requireContract(r.sessionId, 'the CLI never reported a session id');
      expect(r.text, 'BATONSMOKEONE');
      sid = r.sessionId;
      return `session ${sid}`;
    });
    if (sid) {
      await step('resume session', async () => {
        const r = await chat(second, sid);
        expect(r.text, 'BATONSMOKETWO');
        checkResume(r, sid, secret);
      });
      let s = null;
      await step('session list', async () => {
        for (let i = 0; i < 10 && !s; i++) { s = await indexer.findSession(tool, sid); if (!s) await new Promise((r) => setTimeout(r, 1500)); }
        requireContract(s, `session ${sid} does not appear in Baton's session list (session files moved or changed format?)`);
        requireContract(s.cwd && fs.existsSync(s.cwd) && fs.realpathSync(s.cwd) === fs.realpathSync(cwd), `session uses the wrong project: expected ${cwd}, got ${s.cwd || '(missing)'}`);
        projectVerified = true;
        return s.title ? `title "${String(s.title).slice(0, 60)}"` : 'listed without a title';
      });
      if (s) {
        await step('transcript', async () => {
          const msgs = await indexer.readMessages(s);
          checkTranscript(msgs, first, second, secret);
          return `${msgs.length} messages`;
        });
        await step('trash and restore', async () => {
          requireContract(projectVerified, 'restore check blocked: session project was not verified');
          const { trashSession, restoreSession, trashedKeys } = await import(pathToFileURL(path.join(REPO, 'server', 'trash.js')).href);
          const before = await indexer.readMessages(s);
          const key = `${tool}:${sid}`;
          try {
            await trashSession({ ...s, key });
            await indexer.forceRefresh();
            requireContract(!(await indexer.decoratedSessions()).some((row) => row.key === key), 'trashed session is still visible');
          } finally {
            if (trashedKeys().has(key)) await restoreSession(key);
            await indexer.forceRefresh();
          }
          const restored = await indexer.findSession(tool, sid);
          requireContract(restored && restored.cwd === s.cwd, 'restored session lost its project');
          requireContract(JSON.stringify(await indexer.readMessages(restored)) === JSON.stringify(before), 'restored transcript differs from the original');
          requireContract((await indexer.decoratedSessions()).some((row) => row.key === key), 'restored session is not visible');
          return 'hidden while trashed; project and full transcript restored';
        });
        if (/\.jsonl$/.test(s.file || '')) {
          const file = new Set();
          for (const line of (await fsp.readFile(s.file, 'utf8')).split('\n')) {
            let e; try { e = JSON.parse(line); } catch { continue; }
            collectShape(e, fileKindOf(tool, e), file, types);
          }
          R.fileShapes = [...file].sort();
        }
      }
    }

    const fixture = path.join(cwd, 'baton-fixture.txt');
    const original = crypto.randomBytes(12).toString('hex');
    const edited = original.toUpperCase();
    await fsp.writeFile(fixture, original + '\n');
    await step('plan preserves files', async () => {
      requireContract(projectVerified, 'file check blocked: session project was not verified');
      const r = await chat('Read baton-fixture.txt in the current directory. Describe how to uppercase its contents, but do not modify any file. If missing, stop; do not search other directories.', null);
      expect(r.text.toLowerCase(), original);
      requireContract(r.tools > 0 && r.completed > 0, 'file read did not emit tool progress/completion');
      requireContract(await fsp.readFile(fixture, 'utf8') === original + '\n', 'plan mode changed the fixture');
    });
    await step('file edit', async () => {
      requireContract(projectVerified, 'file check blocked: session project was not verified');
      const r = await chat('Read baton-fixture.txt in the current directory and use a file editing tool to replace its contents with the uppercase value and one trailing newline. Do not execute unrelated commands. If missing, stop; do not search other directories.', null, { perm: 'auto' });
      requireContract(await fsp.readFile(fixture, 'utf8') === edited + '\n', 'file edit did not produce the expected contents');
      requireContract(r.tools > 0 && r.completed > 0, 'file edit tool events are missing');
    });
    await step('command execution', async () => {
      requireContract(projectVerified, 'command check blocked: session project was not verified');
      const marker = `BATONCOMMAND-${crypto.randomBytes(12).toString('hex')}`;
      const r = await chat(`Run a shell command in the current directory to create baton-command.txt containing exactly ${marker} and one trailing newline. Use the command execution tool, not a file write/edit tool. Reply with the command result. Do not access other directories.`, null, { perm: 'full' });
      requireContract(fs.existsSync(path.join(cwd, 'baton-command.txt')) && await fsp.readFile(path.join(cwd, 'baton-command.txt'), 'utf8') === marker + '\n', 'command did not create the expected marker file');
      requireContract(r.tools > 0 && r.completed > 0, 'command tool events are missing');
      requireContract(r.toolNames.some((name) => /bash|shell|terminal|command|exec/i.test(name)), `no command execution tool observed: ${r.toolNames.join(', ')}`);
      return `tools: ${r.toolNames.join(', ')}`;
    });
    if (tool === 'claude') await step('question and answer', async () => {
      const r = await chat('Use AskUserQuestion to ask me to choose between BATONANSWER and OTHER. Wait for my selection, then reply with my selection. Do not choose for me.', null, { answer: 'BATONANSWER' });
      requireContract(r.questions > 0, 'AskUserQuestion control request was not received');
      expect(r.text, 'BATONANSWER');
    });
    runner.rawTap.fn = null;

    await step('one-shot', async () => {
      allowGeneration();
      const text = await runner.oneShot({ tool, model, effort, prompt: 'Reply with exactly the word BATONSMOKETHREE and nothing else.', timeoutMs: 240_000 });
      expect(text, 'BATONSMOKETHREE');
    });
    if (HAS_LIMITS.has(tool)) await step('limits', async () => {
      const { allLimits } = await import(pathToFileURL(path.join(REPO, 'server', 'limits.js')).href);
      const l = (await allLimits({ force: true }))[tool];
      if (!l || l.error) throw Object.assign(new Error(`no limits: ${l?.error || 'nothing returned'}`), { code: l?.errorCode });
      if (l.noLimits) throw Object.assign(new Error('this connection has no subscription limits; use a subscription test profile'), { category: 'environment' });
      requireContract(l.windows?.length, 'limits came back without any usage window');
      for (const w of l.windows) requireContract(Number.isFinite(w.usedPercent) && w.usedPercent >= 0 && w.usedPercent <= 100 && (Number.isFinite(w.resetsAt) || (w.usedPercent === 0 && w.resetsAt === null)), 'invalid usage percentage or reset timestamp');
      return l.windows.map((w) => `${w.id} ${w.usedPercent ?? '?'}%`).join(', ');
    });
    await step('model list', async () => {
      const { catalogs, modelCatalogStatus } = await import(pathToFileURL(path.join(REPO, 'server', 'models.js')).href);
      let models = [], status;
      for (let i = 0; i < 45; i++) {
        models = (catalogs()[tool]?.models || []).filter((m) => m.id);
        status = modelCatalogStatus(tool);
        if (models.length && status.ok) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (!status.ok) throw new Error('live model list unavailable (cached/default models do not verify the CLI)');
      requireContract(models.length > 0, 'only the default placeholder is listed');
      R.modelCatalog = status;
      return `${models.length} concrete models (${status.source})`;
    });

    R.shapes = { stream: [...stream].sort(), file: R.fileShapes || [], types };
    delete R.fileShapes;
    R.drift = drift(tool, R.shapes);
    R.ok = R.steps.every((s) => s.ok);
    done();
  } catch (e) {
    R.steps.push({ name: 'setup', ok: false, category: failureCategory(e), ms: 0, detail: String(e?.message || e).slice(0, 1500) });
    done();
  }
}

// ------------------------------------------------------------------ shapes (L3)
function kindOf(tool, e) {
  if (tool === 'claude') return [e.type, e.subtype, e.type === 'stream_event' ? e.event?.type : null].filter(Boolean).join('/');
  if (tool === 'codex') return [e.type, e.item?.type].filter(Boolean).join('/');
  if (tool === 'agy') return [e.event, e.step_update?.step_type].filter(Boolean).join('/');
  return [e.type, e.subtype].filter(Boolean).join('/');
}
function fileKindOf(tool, e) {
  if (tool === 'codex') return `file:${[e.type, e.payload?.type].filter(Boolean).join('/')}`;
  return `file:${[e.type, e.subtype].filter(Boolean).join('/')}`;
}
/** Compare with the stored baseline: which key paths disappeared or appeared. */
function drift(tool, shapes) {
  let base = null;
  try { base = JSON.parse(fs.readFileSync(path.join(FIXTURES, `${tool}.json`), 'utf8')); } catch { return compareShapes(null, shapes); }
  return compareShapes(base, shapes);
}
