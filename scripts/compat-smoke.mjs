#!/usr/bin/env node
// Live compatibility test: drives each coding CLI through Baton's own code, the way a user would, and
// reports what broke. Uses the CLIs' real subscriptions, but in a separate home folder
// (~/.baton-compat/home) so test sessions, configs and sign-in tokens never touch the everyday ones.
//
//   npm run compat:smoke                         every supported CLI that is installed
//   npm run compat:smoke -- codex                just one
//   npm run compat:smoke -- --bin codex=/dir     test the CLI binary in /dir instead of the one on PATH
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
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  const valueOf = new Set(['--bin', '--json']);
  const named = argv.filter((a, i) => !a.startsWith('-') && !valueOf.has(argv[i - 1]));
  const tools = named.length ? named : SMOKE_TOOLS;
  const bins = Object.fromEntries(optAll('--bin').map((s) => s.split('=')));
  // --report / --install: test exactly the verified version of each CLI, installed off PATH, so the OS columns
  // compare like with like and a CLI that isn't installed on this computer still gets tested
  if ((flag('--report') || flag('--install')) && !flag('--installed')) {
    const table = JSON.parse(await fsp.readFile(path.join(REPO, 'server', 'compat.json'), 'utf8'));
    for (const tool of tools) {
      if (bins[tool]) continue;
      const v = table[tool]?.verified;
      if (!v) continue;
      if (!NPM_PKG[tool]) { console.log(`${tool}: no versioned installer on this OS, testing the installed one (if any)`); continue; }
      process.stdout.write(`installing ${tool} ${v} into the test folder… `);
      try { bins[tool] = await installVersion(tool, v); console.log('ok'); } catch (e) { console.log(`failed: ${e.message}`); }
    }
  }
  const reports = [];
  for (const tool of tools) {
    process.stdout.write(`\n${tool}: `);
    const r = await runChild(tool, bins[tool]);
    reports.push(r);
    if (r.skipped) { console.log(`skipped — ${r.skipped}`); continue; }
    console.log(`v${r.version || '?'} ${r.ok ? 'PASS' : 'FAIL'}`);
    for (const s of r.steps) console.log(`  ${s.ok ? '✓' : '✗'} ${s.name} (${(s.ms / 1000).toFixed(1)}s)${s.ok ? '' : ` — ${s.detail}`}`);
    const d = r.drift;
    if (d) {
      if (!d.baseline) console.log('  · no stored shapes yet (run with --update-fixtures)');
      else if (!d.added.length && !d.removed.length) console.log(`  ✓ shapes unchanged since v${d.baseline}`);
      else {
        console.log(`  ! shapes changed since v${d.baseline}: ${d.removed.length} gone, ${d.added.length} new`);
        for (const p of d.removed.slice(0, 15)) console.log(`      - ${p}`);
        for (const p of d.added.slice(0, 15)) console.log(`      + ${p}`);
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
  if (flag('--report')) {
    // hand the results to compat-weekly: it checks maintainer access, edits a separate worktree and opens the PR
    const file = path.join(os.tmpdir(), `baton-smoke-report-${process.pid}.json`);
    await fsp.writeFile(file, JSON.stringify(reports));
    console.log('\nRecording the results for this OS…');
    const code = await new Promise((resolve) => spawn(process.execPath, ['--no-warnings', path.join(REPO, 'scripts', 'compat-weekly.mjs'), '--record-os', file], { stdio: 'inherit' }).on('close', resolve));
    await fsp.rm(file, { force: true });
    if (code) console.log('Recording failed (see above). The test results themselves are listed above.');
  }
  const failed = reports.filter((r) => !r.skipped && !r.ok);
  const skipped = reports.filter((r) => r.skipped);
  const passed = reports.filter((r) => !r.skipped && r.ok);
  console.log(`\n${passed.length} passed${failed.length ? `, FAILED: ${failed.map((r) => r.tool).join(', ')}` : ''}${skipped.length ? `, skipped: ${skipped.map((r) => r.tool).join(', ')}` : ''}`);
  process.exit(failed.length ? 1 : 0);
}

/** Run the test for one CLI in a throwaway copy of Baton (its own data/), with HOME = the test home. */
async function runChild(tool, binDir) {
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
    };
    for (const k of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME']) delete env[k];
    const out = await new Promise((resolve) => {
      const c = spawn(process.execPath, ['--no-warnings', path.join(app, 'scripts', 'compat-smoke.mjs'), '--child', tool], { cwd: TEST_HOME, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let so = '', se = '';
      c.stdout.on('data', (b) => { so += b; });
      c.stderr.on('data', (b) => { se = (se + b).slice(-4000); });
      const timer = setTimeout(() => c.kill('SIGKILL'), 15 * 60_000);
      c.on('close', (code) => { clearTimeout(timer); resolve({ so, se, code }); });
    });
    const line = out.so.split('\n').find((l) => l.startsWith(MARK));
    if (!line) return { tool, ok: false, steps: [{ name: 'test run', ok: false, ms: 0, detail: `test process exited ${out.code}: ${out.se.trim().slice(-800)}` }] };
    return JSON.parse(line.slice(MARK.length));
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
  const done = (extra = {}) => { Object.assign(R, extra); console.log(MARK + JSON.stringify(R)); process.exit(0); };
  try {
    await import(pathToFileURL(path.join(REPO, 'server', 'env.js')).href);
    const { binFor } = await import(pathToFileURL(path.join(REPO, 'server', 'tools.js')).href);
    const { runCli } = await import(pathToFileURL(path.join(REPO, 'server', 'platform.js')).href);
    const runner = await import(pathToFileURL(path.join(REPO, 'server', 'runner.js')).href);
    const indexer = await import(pathToFileURL(path.join(REPO, 'server', 'indexer.js')).href);

    const bin = binFor(tool);
    if (!bin) return done({ skipped: 'not installed' });
    const vr = await runCli(bin, ['--version'], { timeout: 15000 });
    R.version = (vr.stdout + ' ' + vr.stderr).match(/\d+\.\d+(\.\d+)?([-.\w]*)?/)?.[0] || null;
    const home = os.homedir();
    if (tool === 'claude' && !fs.existsSync(path.join(home, '.claude', '.credentials.json'))) return done({ skipped: 'test home not signed in — run: npm run compat:smoke -- --login' });
    if (tool === 'codex' && !fs.existsSync(path.join(home, '.codex', 'auth.json'))) return done({ skipped: 'test home not signed in — run: npm run compat:smoke -- --login' });

    // L3: every key path of every raw streamed event, grouped by event kind
    const stream = new Set();
    runner.rawTap.fn = (t, e) => { if (t === tool) for (const p of shapeOf(e)) stream.add(`${kindOf(t, e)} ${p}`); };

    const cwd = path.join(home, 'project');
    await fsp.mkdir(cwd, { recursive: true });
    // Claude Code: Sonnet 5.5 (maintainer's choice). The other CLIs can only use their own vendor's models: account default.
    const model = tool === 'claude' ? (process.env.BATON_SMOKE_CLAUDE_MODEL || 'claude-sonnet-5-5') : undefined;
    const effort = tool === 'codex' ? 'low' : undefined;

    const step = async (name, fn) => {
      const t0 = Date.now();
      try { const detail = await fn(); R.steps.push({ name, ok: true, ms: Date.now() - t0, detail: detail || '' }); return true; }
      catch (e) { R.steps.push({ name, ok: false, ms: Date.now() - t0, detail: String(e?.message || e).slice(0, 1500) }); return false; }
    };
    const chat = (prompt, sessionId) => new Promise((resolve, reject) => {
      const run = runner.startRun({ tool, sessionId, cwd, prompt, model, effort, perm: 'plan' });
      let text = '';
      const timer = setTimeout(() => { runner.stopRun(run.id); reject(new Error('no reply within 4 minutes')); }, 240_000);
      run.listeners.add((ev) => {
        if (ev.t === 'text') text += ev.text;
        if (ev.t !== 'done') return;
        clearTimeout(timer);
        if (!ev.ok) return reject(new Error(`run failed: ${ev.error || 'unknown'}${run.stderr ? `\nstderr: ${run.stderr.slice(-600)}` : ''}`));
        resolve({ sessionId: run.sessionId, text: text || ev.result || '' });
      });
    });
    const expect = (text, word) => { if (!String(text).includes(word)) throw new Error(`expected "${word}" in the reply, got: ${String(text).slice(0, 300) || '(empty)'}`); };

    let sid = null;
    await step('new session', async () => {
      const r = await chat('Reply with exactly the word BATONSMOKEONE and nothing else.');
      if (!r.sessionId) throw new Error('the CLI never reported a session id');
      expect(r.text, 'BATONSMOKEONE');
      sid = r.sessionId;
      return `session ${sid}`;
    });
    if (sid) {
      await step('resume session', async () => {
        const r = await chat('Reply with exactly the word BATONSMOKETWO and nothing else.', sid);
        expect(r.text, 'BATONSMOKETWO');
        if (r.sessionId !== sid) return `resumed as a new id ${r.sessionId}`;
      });
      let s = null;
      await step('session list', async () => {
        for (let i = 0; i < 10 && !s; i++) { s = await indexer.findSession(tool, sid); if (!s) await new Promise((r) => setTimeout(r, 1500)); }
        if (!s) throw new Error(`session ${sid} does not appear in Baton's session list (session files moved or changed format?)`);
        return s.title ? `title "${String(s.title).slice(0, 60)}"` : 'listed without a title';
      });
      if (s) {
        await step('transcript', async () => {
          const msgs = await indexer.readMessages(s);
          const all = msgs.map((m) => `${m.role}: ${m.text || ''}`).join('\n');
          if (!msgs.some((m) => m.role === 'user' && /BATONSMOKEONE/.test(m.text || ''))) throw new Error(`the first prompt is missing from the transcript (${msgs.length} messages read)`);
          if (!msgs.some((m) => m.role === 'assistant' && /BATONSMOKETWO/.test(m.text || ''))) throw new Error(`the resumed reply is missing from the transcript:\n${all.slice(-600)}`);
          return `${msgs.length} messages`;
        });
        if (/\.jsonl$/.test(s.file || '')) {
          const file = new Set();
          for (const line of (await fsp.readFile(s.file, 'utf8')).split('\n')) {
            let e; try { e = JSON.parse(line); } catch { continue; }
            for (const p of shapeOf(e)) file.add(`${fileKindOf(tool, e)} ${p}`);
          }
          R.fileShapes = [...file].sort();
        }
      }
    }
    runner.rawTap.fn = null;

    await step('one-shot', async () => {
      const text = await runner.oneShot({ tool, model, cwd, prompt: 'Reply with exactly the word BATONSMOKETHREE and nothing else.', timeoutMs: 240_000 });
      expect(text, 'BATONSMOKETHREE');
    });
    if (HAS_LIMITS.has(tool)) await step('limits', async () => {
      const { allLimits } = await import(pathToFileURL(path.join(REPO, 'server', 'limits.js')).href);
      const l = (await allLimits({ force: true }))[tool];
      if (!l || l.error) throw new Error(`no limits: ${l?.error || 'nothing returned'}`);
      if (!l.windows?.length) throw new Error('limits came back without any usage window');
      return l.windows.map((w) => `${w.id} ${w.usedPercent ?? '?'}%`).join(', ');
    });
    await step('model list', async () => {
      const { catalogs } = await import(pathToFileURL(path.join(REPO, 'server', 'models.js')).href);
      let n = 0;
      for (let i = 0; i < 40; i++) { n = catalogs()[tool]?.models?.length || 0; if (n > 1) break; await new Promise((r) => setTimeout(r, 1500)); }
      if (n < 1) throw new Error('no models listed');
      return `${n} models`;
    });

    R.shapes = { stream: [...stream].sort(), file: R.fileShapes || [] };
    delete R.fileShapes;
    R.drift = drift(tool, R.shapes);
    R.ok = R.steps.every((s) => s.ok);
    done();
  } catch (e) {
    R.steps.push({ name: 'setup', ok: false, ms: 0, detail: String(e?.stack || e).slice(0, 1500) });
    done();
  }
}

// ------------------------------------------------------------------ shapes (L3)
// function declarations, not consts: child() runs from a top-level await above, before consts down here exist
function dynamicKey(k) { return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(k) || (/\d/.test(k) && /[-_.]/.test(k) && k.length > 6) || /^\d+$/.test(k); }
/** Key paths of a JSON value ("message.content[].type"), 4 levels deep, ids/model names collapsed to *. */
function shapeOf(v, prefix = '', out = new Set(), depth = 0) {
  if (depth > 4 || v === null || typeof v !== 'object') return out;
  if (Array.isArray(v)) { for (const x of v.slice(0, 50)) shapeOf(x, `${prefix}[]`, out, depth + 1); return out; }
  for (const [k, x] of Object.entries(v)) {
    const p = prefix ? `${prefix}.${dynamicKey(k) ? '*' : k}` : (dynamicKey(k) ? '*' : k);
    out.add(p);
    shapeOf(x, p, out, depth + 1);
  }
  return out;
}
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
  try { base = JSON.parse(fs.readFileSync(path.join(FIXTURES, `${tool}.json`), 'utf8')); } catch { return { baseline: null, added: [], removed: [] }; }
  const now = new Set([...shapes.stream, ...shapes.file]);
  const before = new Set([...(base.stream || []), ...(base.file || [])]);
  // only kinds seen this time: a reply without a thinking block isn't a removed field
  const kinds = new Set([...now].map((p) => p.split(' ')[0]));
  return {
    baseline: base.version,
    removed: [...before].filter((p) => !now.has(p) && kinds.has(p.split(' ')[0]) && arraysFilled(p, now)),
    added: [...now].filter((p) => !before.has(p)),
  };
}
/** A field inside a list counts as gone only if that list had items this run (an empty list shows no fields). */
function arraysFilled(p, now) {
  for (let i = p.indexOf('[]'); i >= 0; i = p.indexOf('[]', i + 2)) {
    const prefix = p.slice(0, i + 2);
    if (![...now].some((x) => x.startsWith(prefix))) return false;
  }
  return true;
}
