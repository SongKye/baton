// Exercise pipeline decisions with local fixtures. Never runs git, gh, installers or an AI.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { needsReview, shouldAttemptFix, reportPassed, reportMatchesCheckout } from './lib-compat-contracts.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await fs.readFile(path.join(root, 'scripts', 'compat-weekly.mjs'), 'utf8');
const smoke = await fs.readFile(path.join(root, 'scripts', 'compat-smoke.mjs'), 'utf8');
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'baton-weekly-check-'));
const drift = { baseline: '1.0.0', removed: [], added: [], changed: [], missingKinds: [] };
const result = (ok = true) => ({ checkOk: true, smokeOk: ok, report: { tool: 'codex', ok, version: '1.0.0', drift, steps: [{ name: 'resume', ok, category: ok ? undefined : 'contract', detail: 'context mismatch' }] }, smokeOut: 'test output' });
const context = (extra) => vm.createContext({ console, process, path, os, fs: { existsSync: () => true }, fsp: fs, Date, JSON, needsReview, shouldAttemptFix, reportPassed, reportMatchesCheckout, setTimeout, clearTimeout, ...extra });
try {
  await fs.mkdir(path.join(tmp, 'server')); await fs.mkdir(path.join(tmp, 'scripts')); await fs.mkdir(path.join(tmp, 'logs'));
  await fs.writeFile(path.join(tmp, 'server', 'compat.json'), JSON.stringify({ codex: { verified: '1.0.0', level: 'supported' } }));
  const validReport = { tool: 'codex', ok: true, version: '1.1.0', expectedVersion: '1.1.0', revision: 'commit-under-test', dirty: false, platform: process.platform, arch: process.arch, drift,
    steps: ['CLI flags', 'new session', 'resume session', 'session list', 'transcript', 'trash and restore', 'plan preserves files', 'file edit', 'command execution', 'one-shot', 'limits', 'model list'].map(name => ({ name, ok: true })) };
  for (const patch of [{}, { dirty: true }, { revision: 'different-commit' }, { platform: 'different-os' }, { arch: 'different-arch' }, { dirty: undefined }]) {
    let edits = 0;
    const file = path.join(tmp, 'manual-report.json'); await fs.writeFile(file, JSON.stringify([{ ...validReport, ...patch }]));
    const ctx = context({ WORK: tmp, osKey: () => 'test-os', OS_NAMES: { 'test-os': 'Test OS' }, NAMES: { codex: 'Codex' }, log() {},
      cmp: (a, b) => a.localeCompare(b), must: async () => 'commit-under-test', bumpFiles: async () => { edits++; },
      repoChecks: async () => null, today: () => 'test-date', commitAndPr: async () => null });
    vm.runInContext(source.slice(source.indexOf('async function recordOs('), source.indexOf('async function main()')), ctx);
    if (Object.keys(patch).length) { await assert.rejects(ctx.recordOs(file), /Cannot record/); assert.equal(edits, 0); }
    else { await ctx.recordOs(file); assert.equal(edits, 1); }
  }
  // Same version is tested too; environment failures must never request an automatic fix.
  for (const mode of ['current', 'auth', 'new-pass', 'new-contract', 'drift', 'preflight-fails']) {
    let tested = 0, fixes = 0, merges = 0;
    const t = result(!['auth', 'new-contract'].includes(mode));
    t.expectedVersion = mode === 'current' ? '1.0.0' : '1.1.0';
    t.report.version = t.expectedVersion;
    if (mode === 'auth') t.report.steps[0].category = 'auth';
    if (mode === 'drift') t.report.drift = { ...drift, changed: ['count: number -> string'] };
    const stateFile = path.join(tmp, 'state.json');
    const ctx = context({
      WORK: tmp, LOGS: path.join(tmp, 'logs'), STATE: stateFile, logFile: null, argv: [], ONLY: [], DRY: true, REF: 'origin/main', NAMES: { codex: 'Codex' },
      today: () => '2026-01-01', log() {}, bootstrap: async () => {}, sh: async () => ({ code: 0, out: 'commit' }),
      cmp: (a, b) => a.localeCompare(b), latestRelease: async () => ({ version: t.expectedVersion }), install: async () => '/fake/bin',
      test: async () => { tested++; return t; }, saveShapes: async () => {}, bumpFiles: async () => {}, repoChecks: async () => mode === 'preflight-fails' ? 'fixture regression' : null,
      commitAndPr: async () => 'https://example.invalid/pr', mergeWhenGreen: async () => { merges++; return 'merged'; },
      tryFix: async () => { fixes++; return { outcome: 'partial' }; },
    });
    vm.runInContext(source.slice(source.indexOf('async function main()'), source.indexOf("if (argv.includes('--maintainer-check'))")), ctx);
    await ctx.main();
    const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
    assert.equal(tested, mode === 'preflight-fails' ? 0 : 1, mode);
    if (mode === 'preflight-fails') assert.equal(state.needsAttention, true);
    assert.equal(fixes, mode === 'new-contract' ? 1 : 0, mode);
    assert.equal(merges, mode === 'new-pass' ? 1 : 0, mode);
    if (mode === 'current') assert.equal(state.prs.length, 0);
    if (mode === 'auth') assert.equal(state.results[0].status, 'error');
    if (mode === 'drift') assert.equal(state.needsAttention, true);
  }
  // A passing new version alone cannot mark a fix ready; old binaries and original tests are mandatory.
  for (const mode of ['both-pass', 'old-fails', 'modified-verifier', 'only-verifier', 'old-unavailable']) {
    await fs.writeFile(path.join(tmp, 'package.json'), '{"version":"0.9.0"}');
    await fs.writeFile(path.join(tmp, 'scripts', 'assert.mjs'), 'original verifier');
    const tested = []; let draft, bumps = 0, statusCalls = 0;
    const ctx = context({
      WORK: tmp, REF: 'origin/main', FIX_MODEL: 'fixture', NAMES: { codex: 'Codex' }, log() {}, cleanEnv: () => ({}), fixPrompt: () => 'fixture',
      install: async () => { if (mode === 'old-unavailable') throw new Error('download unavailable'); return '/old/bin'; },
      must: async (cmd, args) => args.includes('ls-files') && !args.includes('--others') ? 'scripts/assert.mjs\0package.json\0' : '',
      sh: async (cmd, args) => {
        if (cmd === 'claude') {
          assert.equal(args[args.indexOf('--effort') + 1], 'medium');
          if (['modified-verifier', 'only-verifier'].includes(mode)) await fs.writeFile(path.join(tmp, 'scripts', 'assert.mjs'), 'weakened test');
          return { out: '{"result":"fixed"}' };
        }
        return { out: mode === 'only-verifier' && ++statusCalls > 1 ? '' : ' M server/runner.js' };
      },
      test: async (tool, bin, version) => {
        assert.equal(await fs.readFile(path.join(tmp, 'scripts', 'assert.mjs'), 'utf8'), 'original verifier');
        tested.push([bin, version]); return result(!(mode === 'old-fails' && version === '1.0.0'));
      },
      repoChecks: async () => null, saveShapes: async () => {}, bumpFiles: async () => { bumps++; },
      commitAndPr: async (opts) => { draft = opts.draft; return 'https://example.invalid/pr'; },
    });
    vm.runInContext(source.slice(source.indexOf('async function tryFix('), source.indexOf('// ------------------------------------------------------------------', source.indexOf('async function tryFix('))), ctx);
    const r = await ctx.tryFix({ tool: 'codex', from: '1.0.0', to: '1.1.0', binDir: '/new/bin', test: result(false) });
    if (mode === 'only-verifier') {
      assert.equal(r.outcome, 'no-change'); assert.equal(draft, undefined); assert.equal(tested.length, 0);
      assert.equal(await fs.readFile(path.join(tmp, 'scripts', 'assert.mjs'), 'utf8'), 'original verifier');
      continue;
    }
    assert.equal(r.outcome, mode === 'both-pass' ? 'fixed' : 'partial', mode);
    assert.equal(draft, mode !== 'both-pass', mode);
    assert.equal(bumps, mode === 'both-pass' ? 1 : 0, mode);
    assert.deepEqual(tested, mode === 'old-unavailable' ? [['/new/bin', '1.1.0']] : [['/new/bin', '1.1.0'], ['/old/bin', '1.0.0']]);
  }
  // A > pipe-buffer report must survive even though the child exits immediately after producing it.
  const large = { tool: 'codex', ok: true, steps: [], shapes: { stream: ['x'.repeat(250000)] } };
  for (const mode of ['large', 'missing', 'bad-exit']) {
    const ctx = context({ REPO: root, TEST_HOME: path.join(tmp, 'home'),
      spawn: (bin, args, opts) => {
        const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stdout.resume = () => {}; child.stderr = new EventEmitter(); child.kill = () => {};
        setTimeout(async () => {
          if (mode !== 'missing') await fs.writeFile(opts.env.BATON_SMOKE_REPORT_FILE, JSON.stringify(large));
          child.emit('close', mode === 'bad-exit' ? 1 : 0);
        }, 0);
        return child;
      },
    });
    vm.runInContext(smoke.slice(smoke.indexOf('async function runChild('), smoke.indexOf('/** npm install')), ctx);
    const r = await ctx.runChild('codex', '/fake/bin', '1.0.0');
    assert.equal(r.ok, mode === 'large');
    if (mode === 'large') assert.equal(r.shapes.stream[0].length, 250000);
  }
  console.log('PASS: scheduled health checks, failure routing, drift review, pinned old/new versions, frozen verifier, large/missing reports');
} finally { await fs.rm(tmp, { recursive: true, force: true }); }
