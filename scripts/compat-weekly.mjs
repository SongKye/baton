#!/usr/bin/env node
// Weekly CLI auto-verification (run by the baton-compat systemd timer, Saturday 00:00; see compat-schedule.mjs).
//
// For each supported CLI: find its newest stable release -> install and test it (including unchanged versions)
// into ~/.baton-compat/versions (never on PATH, the everyday CLI is untouched) -> run compat:check + compat:smoke
// against it ->
//   passed, no schema drift    -> PR that bumps server/compat.json + docs + shape baselines, merged once CI is green
//   passed, schema review     -> the same PR, left open for review
//   failed                     -> Claude Code tries to fix Baton on a branch; the result is re-tested and opened
//                                 as a PR for review (never merged automatically), or an issue if nothing worked
// The summary goes to ~/.baton-compat/last-run.json, which Baton shows in Settings and turns into a push
// notification when something needs a look.
//
// All git work happens in a separate worktree (~/.baton-compat/work) checked out at origin/main, never in the
// folder Baton runs from.
//   node scripts/compat-weekly.mjs              the real run
//   node scripts/compat-weekly.mjs --dry-run    test and edit, but no push / PR / merge / issue
//   node scripts/compat-weekly.mjs --only codex limit to some CLIs
//   node scripts/compat-weekly.mjs --ref feat/x run from that pushed branch instead of main (testing this script)
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { osKey, OS_NAMES, recordVersion, writeDocsTable } from './lib-compat-table.mjs';
import { shouldAttemptFix, needsReview, reportPassed, reportMatchesCheckout } from './lib-compat-contracts.mjs';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = path.join(os.homedir(), '.baton-compat');
const WORK = path.join(BASE, 'work');
const VERSIONS = path.join(BASE, 'versions');
const LOGS = path.join(BASE, 'logs');
const STATE = path.join(BASE, 'last-run.json');
const LOCK = path.join(BASE, 'weekly.lock');
const REPO_SLUG = 'SongKye/baton';
const FIX_MODEL = process.env.BATON_COMPAT_FIX_MODEL || 'claude-opus-5-5'; // writes the fix PRs

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const ONLY = argv.flatMap((a, i) => (argv[i - 1] === '--only' ? a.split(',') : []));
const REF = `origin/${argv.includes('--ref') ? argv[argv.indexOf('--ref') + 1] : 'main'}`; // test a pushed branch before merging

const NAMES = { claude: 'Claude Code', codex: 'Codex', agy: 'Antigravity', opencode: 'OpenCode' };
const NPM = { claude: ['@anthropic-ai/claude-code', 'stable'], codex: ['@openai/codex', 'latest'], opencode: ['opencode-ai', 'latest'] };

// ------------------------------------------------------------------ helpers
let logFile = null;
const log = (...a) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`;
  console.log(line);
  if (logFile) fs.appendFileSync(logFile, line + '\n');
};
/** Run a command; resolves { code, out } (stdout+stderr), never rejects. */
function sh(cmd, args, { cwd = WORK, env, input, timeout = 20 * 60_000, quiet = false } = {}) {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' && /^(npm|npx|claude)$/.test(cmd); // .cmd shims; their args here are simple
    const c = spawn(cmd, args, { cwd, env: env || process.env, shell, stdio: [input != null ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let out = '';
    const add = (b) => { out += b; if (out.length > 400_000) out = out.slice(-200_000); };
    c.stdout.on('data', add); c.stderr.on('data', add);
    const timer = setTimeout(() => c.kill('SIGKILL'), timeout);
    c.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: String(e.message) }); });
    c.on('close', (code) => {
      clearTimeout(timer);
      if (!quiet && code !== 0) log(`  ↳ ${cmd} ${args.slice(0, 4).join(' ')} exited ${code}: ${out.trim().slice(-400)}`);
      resolve({ code, out });
    });
    if (input != null) c.stdin.end(input);
  });
}
const must = async (cmd, args, opts) => { const r = await sh(cmd, args, opts); if (r.code !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.out.trim().slice(-600)}`); return r.out; };
const cmp = (a, b) => {
  const p = (v) => String(v).replace(/^v/, '').split('-')[0].split('.').map((x) => Number(x) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
  return 0;
};
const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD, local time
/** Environment for child CLIs: not "inside" a Claude Code session (this script may be started from one). */
const cleanEnv = (extra = {}) => {
  const env = { ...process.env, ...extra };
  for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k === 'BATON_RUN') delete env[k];
  return env;
};

// ------------------------------------------------------------------ bootstrap: lock, worktree at origin/main, re-exec
/**
 * Maintainers only: this job opens PRs, merges and files issues on REPO_SLUG. On anyone else's install
 * (another origin, or a GitHub account without push access) it does nothing.
 */
export async function maintainerCheck(cwd = HERE) {
  const origin = (await sh('git', ['remote', 'get-url', 'origin'], { cwd, quiet: true })).out.trim();
  if (!new RegExp(`github\\.com[:/]${REPO_SLUG.replace('/', '\\/')}(\\.git)?$`, 'i').test(origin)) return `this checkout's origin is not ${REPO_SLUG} (${origin || 'none'})`;
  const r = await sh('gh', ['api', `repos/${REPO_SLUG}`, '--jq', '.permissions.push'], { cwd, quiet: true, timeout: 60_000 });
  if (r.code !== 0) return `GitHub CLI isn't signed in or can't reach ${REPO_SLUG}`;
  if (r.out.trim() !== 'true') return `the signed-in GitHub account has no push access to ${REPO_SLUG}`;
  return null;
}

async function bootstrap() {
  await fsp.mkdir(LOGS, { recursive: true });
  if (path.resolve(HERE) !== path.resolve(WORK)) {
    const why = await maintainerCheck();
    if (why) { console.log(`Weekly auto-check is for Baton's maintainers only: ${why}. Nothing to do.`); process.exit(0); }
  }
  if (path.resolve(HERE) === path.resolve(WORK)) return; // already running from the worktree
  try {
    const fd = fs.openSync(LOCK, 'wx');
    fs.writeSync(fd, String(process.pid)); fs.closeSync(fd);
  } catch {
    const pid = Number(fs.readFileSync(LOCK, 'utf8'));
    try { process.kill(pid, 0); console.log(`another run is in progress (pid ${pid})`); process.exit(0); } catch { fs.writeFileSync(LOCK, String(process.pid)); }
  }
  const unlock = () => { try { fs.unlinkSync(LOCK); } catch { /* gone */ } };
  process.on('exit', unlock);
  await must('git', ['fetch', '--quiet', 'origin'], { cwd: HERE });
  if (!fs.existsSync(path.join(WORK, '.git'))) {
    await sh('git', ['worktree', 'prune'], { cwd: HERE, quiet: true });
    await must('git', ['worktree', 'add', '--detach', WORK, REF], { cwd: HERE });
  }
  await must('git', ['checkout', '--quiet', '--detach', '--force', REF], { cwd: WORK });
  await must('git', ['clean', '-fdq', '-e', 'node_modules'], { cwd: WORK });
  await must('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--silent'], { cwd: WORK, timeout: 10 * 60_000 });
  const child = spawn(process.execPath, ['--no-warnings', path.join(WORK, 'scripts', 'compat-weekly.mjs'), ...argv], { stdio: 'inherit', env: process.env });
  child.on('close', (code) => { unlock(); process.exit(code ?? 1); });
  await new Promise(() => {}); // the worktree copy does the rest
}

// ------------------------------------------------------------------ newest stable release per CLI
async function latestRelease(tool) {
  if (NPM[tool]) {
    const [pkg, tag] = NPM[tool];
    const r = await sh('npm', ['view', pkg, `dist-tags.${tag}`], { cwd: BASE, quiet: true, timeout: 60_000 });
    const v = r.out.trim().split('\n').pop();
    return /^\d+\.\d+\.\d+$/.test(v) ? { version: v } : null;
  }
  if (tool === 'agy') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    const plat = process.platform === 'darwin' ? `darwin_${arch}` : `linux_${arch}`;
    const res = await fetch(`https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/${plat}.json`, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    const j = res?.ok ? await res.json().catch(() => null) : null;
    return j?.version ? { version: j.version, url: j.url, sha512: j.sha512 } : null;
  }
  return null;
}

/** Install a release into ~/.baton-compat/versions/<tool>/<version>; returns the folder holding its binary. */
async function install(tool, rel) {
  const dir = path.join(VERSIONS, tool, rel.version);
  if (NPM[tool]) {
    const bin = path.join(dir, 'node_modules', '.bin');
    if (!fs.existsSync(path.join(bin, tool === 'claude' ? 'claude' : tool))) {
      await fsp.mkdir(dir, { recursive: true });
      await must('npm', ['install', '--prefix', dir, '--no-audit', '--no-fund', '--silent', `${NPM[tool][0]}@${rel.version}`], { cwd: dir, timeout: 15 * 60_000 });
    }
    return bin;
  }
  if (tool === 'agy') {
    const bin = path.join(dir, 'bin');
    if (fs.existsSync(path.join(bin, 'agy'))) return bin;
    await fsp.mkdir(bin, { recursive: true });
    const res = await fetch(rel.url, { signal: AbortSignal.timeout(10 * 60_000) });
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (crypto.createHash('sha512').update(buf).digest('hex') !== rel.sha512) throw new Error('downloaded Antigravity does not match the manifest checksum');
    const archive = path.join(dir, 'cli.tar.gz');
    await fsp.writeFile(archive, buf);
    await must('tar', ['-xzf', archive, '-C', dir], { cwd: dir });
    const found = ['antigravity', 'agy'].map((n) => path.join(dir, n)).find((p) => fs.existsSync(p));
    if (!found) throw new Error('no antigravity binary in the downloaded archive');
    await fsp.rename(found, path.join(bin, 'agy'));
    await fsp.chmod(path.join(bin, 'agy'), 0o755);
    await fsp.rm(archive, { force: true });
    return bin;
  }
  throw new Error(`don't know how to install ${tool}`);
}

/** Check an exact binary without changing the stored schema baseline. */
async function test(tool, binDir, expectedVersion) {
  const env = cleanEnv({ PATH: `${binDir}${path.delimiter}${process.env.PATH}`, BATON_NO_SHELL_ENV: '1' });
  const check = await sh(process.execPath, ['--no-warnings', 'scripts/compat-check.mjs', tool], { env, quiet: true, timeout: 5 * 60_000 });
  const json = path.join(os.tmpdir(), `baton-weekly-${tool}-${process.pid}.json`);
  const smoke = await sh(process.execPath, ['--no-warnings', 'scripts/compat-smoke.mjs', tool, '--bin', `${tool}=${binDir}`, '--expect', `${tool}=${expectedVersion}`, '--strict', '--json', json], { env: cleanEnv(), quiet: true, timeout: 30 * 60_000 });
  let report = null;
  try { report = JSON.parse(await fsp.readFile(json, 'utf8'))[0]; } catch { /* crashed */ }
  await fsp.rm(json, { force: true });
  return { expectedVersion, checkOk: check.code === 0, checkOut: check.out.trim(), smokeOk: smoke.code === 0 && reportPassed(report, expectedVersion), report, smokeOut: smoke.out.trim() };
}

async function saveShapes(report) {
  if (report?.ok && report.shapes) await fsp.writeFile(path.join(WORK, 'scripts', 'compat-fixtures', `${report.tool}.json`), JSON.stringify({ version: report.version, ...report.shapes }, null, 1) + '\n');
}

// ------------------------------------------------------------------ editing the repo for a bump
async function bumpFiles(bumps, { os = osKey(), changelog = 'weekly automatic check' } = {}) {
  const date = today();
  const tableFile = path.join(WORK, 'server', 'compat.json');
  const table = JSON.parse(await fsp.readFile(tableFile, 'utf8'));
  for (const b of bumps) {
    recordVersion(table, b.tool, os, b.to, date);
    // needsBatonAfter: set by a code fix (only Baton releases after that version have it); a later data-only bump keeps it
    if (b.needsBatonAfter) table[b.tool].needsBatonAfter = b.needsBatonAfter;
  }
  await fsp.writeFile(tableFile, JSON.stringify(table, null, 2) + '\n');
  writeDocsTable(path.join(WORK, 'docs', 'compatibility.md'), table);

  const edit = async (rel, fn) => { const f = path.join(WORK, rel); await fsp.writeFile(f, fn(await fsp.readFile(f, 'utf8'))); };
  await edit('CHANGELOG.md', (s) => {
    const line = `- Verified with ${bumps.map((b) => `${NAMES[b.tool]} ${b.to}`).join(', ')} on ${OS_NAMES[os]} (${changelog}).`;
    const start = s.indexOf('## [Unreleased]');
    if (start < 0) return s;
    const next = s.indexOf('\n## [', start + 1);
    const section = s.slice(start, next < 0 ? undefined : next);
    const changed = section.indexOf('### Changed\n');
    if (changed >= 0) { const at = start + changed + '### Changed\n'.length; return s.slice(0, at) + line + '\n' + s.slice(at); }
    const at = start + '## [Unreleased]\n'.length;
    return s.slice(0, at) + `\n### Changed\n${line}\n` + s.slice(at);
  });
}

/** The repo's own checks (what CI runs that doesn't need a browser). */
async function repoChecks() {
  const files = [...['server', 'server/sources', 'public', 'scripts'].flatMap((d) => fs.readdirSync(path.join(WORK, d)).filter((f) => /\.(m?js)$/.test(f)).map((f) => path.join(d, f)))];
  for (const f of files) { const r = await sh(process.execPath, ['--check', f], { quiet: true }); if (r.code) return `syntax error in ${f}: ${r.out.slice(0, 400)}`; }
  const r = await sh(process.execPath, ['--no-warnings', 'scripts/check.mjs'], { quiet: true, timeout: 15 * 60_000 });
  if (r.code) return `regression checks failed: ${r.out.trim().slice(-1200)}`;
  return null;
}

async function commitAndPr({ branch, title, body, message, draft = false }) {
  await must('git', ['checkout', '--quiet', '-B', branch]);
  await must('git', ['add', '-A']);
  await must('git', ['-c', 'user.name=Baton compat bot', '-c', `user.email=${(await sh('git', ['config', 'user.email'], { quiet: true })).out.trim() || 'baton@localhost'}`, 'commit', '--quiet', '-m', message]);
  if (DRY) { log(`  (dry run) would push ${branch} and open PR "${title}"`); return null; }
  await must('git', ['push', '--quiet', '--force', '-u', 'origin', branch]);
  const args = ['pr', 'create', '--repo', REPO_SLUG, '--base', 'main', '--head', branch, '--title', title, '--body', body];
  if (draft) args.push('--draft');
  const out = await must('gh', args);
  return out.trim().split('\n').pop();
}

/** Wait for the PR's checks, then merge it. Returns 'merged' | 'checks failed' | 'timed out'. */
async function mergeWhenGreen(url) {
  await new Promise((r) => setTimeout(r, 30_000)); // let the checks register
  const r = await sh('gh', ['pr', 'checks', url, '--watch', '--interval', '30'], { timeout: 45 * 60_000, quiet: true });
  if (r.code !== 0) return /timed out|SIGKILL/.test(r.out) ? 'timed out' : 'checks failed';
  const m = await sh('gh', ['pr', 'merge', url, '--merge', '--delete-branch']);
  return m.code === 0 ? 'merged' : 'merge failed';
}

// ------------------------------------------------------------------ fix attempt with Claude Code
function fixPrompt(r) {
  const steps = (r.test.report?.steps || []).map((s) => `- ${s.ok ? 'PASS' : 'FAIL'} ${s.name}${s.ok ? '' : `: ${s.detail}`}`).join('\n');
  const d = r.test.report?.drift;
  return `You are maintaining Baton (this repository), a dashboard that drives coding-agent CLIs headlessly.
A new stable release of ${NAMES[r.tool]} breaks Baton: verified ${r.from}, new ${r.to}.
The new binary is installed at ${r.binDir} (not on PATH).

Live test result for ${r.to} (npm run compat:smoke):
${steps || '(the test did not produce a report)'}
${d?.removed?.length ? `\nFields that disappeared from the CLI's output/session files since ${d.baseline}:\n${d.removed.slice(0, 60).join('\n')}` : ''}
${d?.added?.length ? `\nNew fields:\n${d.added.slice(0, 60).join('\n')}` : ''}
${r.test.checkOk ? '' : `\nFlag check (npm run compat:check):\n${r.test.checkOut.slice(-1500)}`}
${r.test.report ? '' : `\nTest output:\n${r.test.smokeOut.slice(-3000)}`}

docs/compatibility.md lists every flag, event, file and endpoint Baton relies on and the code that uses each.
Find what changed in the new CLI and fix Baton's code so it works with ${r.to}. Users may still have the old
version, so keep ${r.from} working too where the two differ (accept both shapes).

Test the new version with:  npm run compat:smoke -- ${r.tool} --bin ${r.tool}=${r.binDir}
Test the old one with:      npm run compat:smoke -- ${r.tool} --bin ${r.tool}=${r.oldBin || '(previous version unavailable)'} --expect ${r.tool}=${r.from}
You may run the new binary directly from ${r.binDir} to inspect its --help, output and files (use a
throwaway folder and HOME=$HOME/.baton-compat/home so nothing touches the user's real sessions).

Rules: change only what the fix needs. Do not edit scripts/, .github/, package.json, package-lock.json or
server/compat.json. The pipeline owns its tests and compatibility records; changing them cannot make a fix pass.
Do not commit, push or open PRs. Finish with a short plain-English summary:
what changed in ${NAMES[r.tool]} ${r.to}, what you changed in Baton, and the final test results.`;
}

async function tryFix(r) {
  const branch = `compat/fix-${r.tool}-${r.to}`;
  await must('git', ['checkout', '--quiet', '--detach', '--force', REF]);
  await must('git', ['clean', '-fdq', '-e', 'node_modules']);
  let oldError = null;
  try { r.oldBin = await install(r.tool, { version: r.from }); }
  catch (e) { oldError = `previous version unavailable: ${e.message}`; }
  // Snapshot the verifier before the agent edits anything. Restore it before re-testing.
  const protectedPaths = ['scripts', '.github', 'package.json', 'package-lock.json', 'server/compat.json'];
  const protectedFiles = (await must('git', ['ls-files', '-z', '--', ...protectedPaths])).split('\0').filter(Boolean);
  const originals = new Map(await Promise.all(protectedFiles.map(async (f) => [f, await fsp.readFile(path.join(WORK, f))])));
  log(`  asking Claude Code to fix ${NAMES[r.tool]} ${r.to} (up to 45 min)…`);
  const res = await sh('claude', ['-p', '--output-format', 'json', '--model', FIX_MODEL, '--effort', 'medium', '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(npm run compat:smoke:*)', 'Bash(npm run compat:check:*)', 'Bash(node:*)', `Bash(${r.binDir}/*)`, 'Bash(git diff:*)', 'Bash(git status:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(mkdir:*)'],
  { input: fixPrompt(r), env: cleanEnv(), timeout: 45 * 60_000, quiet: true });
  let summary = '';
  try { summary = JSON.parse(res.out.trim().split('\n').filter(Boolean).pop()).result || ''; } catch { summary = res.out.trim().slice(-2000); }
  const changed = (await sh('git', ['status', '--porcelain'], { quiet: true })).out.trim();
  if (!changed) return { outcome: 'no-change', summary };
  const altered = [];
  for (const [f, original] of originals) {
    const current = await fsp.readFile(path.join(WORK, f)).catch(() => null);
    if (!current?.equals(original)) {
      altered.push(f);
      await fsp.mkdir(path.dirname(path.join(WORK, f)), { recursive: true });
      await fsp.writeFile(path.join(WORK, f), original);
    }
  }
  const added = (await must('git', ['ls-files', '--others', '--exclude-standard', '-z', '--', ...protectedPaths])).split('\0').filter(Boolean);
  for (const f of added) { altered.push(f); await fsp.rm(path.join(WORK, f), { force: true }); }
  if (!(await sh('git', ['status', '--porcelain'], { quiet: true })).out.trim()) {
    return { outcome: 'no-change', summary: `${summary}\nOnly verifier changes were made and restored: ${altered.join(', ')}` };
  }
  const again = await test(r.tool, r.binDir, r.to);
  const previous = r.oldBin ? await test(r.tool, r.oldBin, r.from) : null;
  const problem = [oldError, altered.length ? `verifier changes restored; review required: ${altered.join(', ')}` : null, await repoChecks()].filter(Boolean).join('\n');
  const fixed = again.smokeOk && again.checkOk && previous?.smokeOk && previous?.checkOk && !problem;
  // the fix is code: installs need the next Baton release, so record the current version as the one that lacks it
  const batonNow = JSON.parse(await fsp.readFile(path.join(WORK, 'package.json'), 'utf8')).version;
  if (fixed) { await saveShapes(again.report); await bumpFiles([{ tool: r.tool, to: r.to, needsBatonAfter: batonNow }]); }
  const title = fixed ? `Fix ${NAMES[r.tool]} ${r.to} compatibility` : `[needs help] ${NAMES[r.tool]} ${r.to} breaks Baton (automatic fix incomplete)`;
  const body = `${NAMES[r.tool]} **${r.to}** (verified until now: ${r.from}) failed Baton's weekly live test. Claude Code attempted a fix.

## Test before the fix
${(r.test.report?.steps || []).map((s) => `- ${s.ok ? '✅' : '❌'} ${s.name}${s.ok ? '' : ` — ${s.detail.replace(/\n/g, ' ').slice(0, 300)}`}`).join('\n') || r.test.smokeOut.slice(-1500)}

## Test after the fix
${(again.report?.steps || []).map((s) => `- ${s.ok ? '✅' : '❌'} ${s.name}${s.ok ? '' : ` — ${s.detail.replace(/\n/g, ' ').slice(0, 300)}`}`).join('\n') || again.smokeOut.slice(-1500)}
${problem ? `\nRepo checks: ❌ ${problem}` : ''}

## Previous supported version (${r.from})
${previous ? (previous.smokeOk && previous.checkOk ? '✅ exact previous binary passed the same checks' : `❌ ${previous.smokeOut.slice(-1500)}`) : `Not verified: ${oldError}`}

## What Claude Code says
${summary.slice(0, 6000) || '(no summary)'}

${fixed ? `This PR also marks ${NAMES[r.tool]} ${r.to} as verified, for Baton releases after ${batonNow} (\`needsBatonAfter\`): users on ${batonNow} or older are told to update Baton once a newer release exists. **Not merged automatically: please review, then cut a release so users get the fix.**` : '**The fix is incomplete.** Kept as a draft so the work isn\'t lost.'}

🤖 Generated by Baton's weekly compatibility check (scripts/compat-weekly.mjs) with [Claude Code](https://claude.com/claude-code)`;
  const url = await commitAndPr({ branch, title, body, draft: !fixed, message: `${fixed ? 'fix' : 'wip'}: ${NAMES[r.tool]} ${r.to} compatibility\n\n${summary.slice(0, 1500)}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` });
  return { outcome: fixed ? 'fixed' : 'partial', summary, url };
}

// ------------------------------------------------------------------ main
/** Record a compat:smoke --report run (this OS) in compat.json via a PR, merged once CI is green. */
async function recordOs(file) {
  const reports = JSON.parse(await fsp.readFile(file, 'utf8'));
  const os = osKey();
  const table = JSON.parse(await fsp.readFile(path.join(WORK, 'server', 'compat.json'), 'utf8'));
  const cmpVer = (a, b) => cmp(a, b);
  const passed = reports.filter((r) => table[r.tool] && reportPassed(r, r.expectedVersion));
  const checkout = { revision: (await must('git', ['rev-parse', 'HEAD'])).trim(), platform: process.platform, arch: process.arch };
  const mismatched = passed.filter((r) => !reportMatchesCheckout(r, checkout));
  if (mismatched.length) throw new Error(`Cannot record ${mismatched.map((r) => r.tool).join(', ')}: report must come from a clean checkout of ${checkout.revision} on ${checkout.platform}/${checkout.arch}. Re-run compat:smoke from that checkout.`);
  const fresh = passed.filter((r) => !table[r.tool].os?.[os]?.verified || cmpVer(r.version, table[r.tool].os[os].verified) > 0);
  for (const r of reports.filter((x) => !x.skipped && !x.ok)) log(`${NAMES[r.tool] || r.tool} ${r.version || ''} FAILED on ${OS_NAMES[os]}: not recorded`);
  if (!fresh.length) { log(`nothing new to record for ${OS_NAMES[os]} (${passed.map((r) => `${NAMES[r.tool]} ${r.version}`).join(', ') || 'no passes'})`); return; }
  await bumpFiles(fresh.map((r) => ({ tool: r.tool, to: r.version })), { os, changelog: 'manual check' });
  const problem = await repoChecks();
  if (problem) throw new Error(`repo checks failed: ${problem}`);
  const names = fresh.map((r) => `${NAMES[r.tool]} ${r.version}`).join(', ');
  const failed = reports.filter((x) => !x.skipped && !x.ok);
  const review = fresh.some((r) => needsReview(r.drift));
  const body = `Manual compatibility run on **${OS_NAMES[os]}** (\`npm run compat:smoke -- --report\`).

| CLI | Version | Result |
|---|---|---|
${reports.map((r) => `| ${NAMES[r.tool] || r.tool} | ${r.version || '—'} | ${r.skipped ? `skipped (${r.skipped})` : r.ok ? `✅ ${r.steps.length}/${r.steps.length} steps${fresh.includes(r) ? ' — **recorded**' : ' — already recorded'}` : `❌ ${r.steps.filter((x) => !x.ok).map((x) => x.name).join(', ')}`} |`).join('\n')}
${failed.length ? `\n### Failures (not recorded)\n${failed.map((r) => `**${NAMES[r.tool]} ${r.version}**\n${r.steps.filter((x) => !x.ok).map((x) => `- ${x.name}: ${x.detail.replace(/\n/g, ' ').slice(0, 300)}`).join('\n')}`).join('\n\n')}\n` : ''}
Updates the ${OS_NAMES[os]} column of \`server/compat.json\` and docs/compatibility.md. ${review ? 'Left open for review: missing baseline or output schema drift.' : 'Merged automatically once CI is green.'}

🤖 Generated by \`npm run compat:smoke -- --report\``;
  const url = await commitAndPr({ branch: `compat/${os}-${today()}`, title: `Verified on ${OS_NAMES[os]}: ${names}`, body, message: `chore: verified on ${OS_NAMES[os]}: ${names}\n\nManual compat:smoke --report run.` });
  if (url) log(`PR ${url}: ${review ? 'review required' : await mergeWhenGreen(url)}`);
}

async function main() {
  await bootstrap();
  logFile = path.join(LOGS, `${today()}.log`);
  const recordFile = argv.includes('--record-os') ? argv[argv.indexOf('--record-os') + 1] : null;
  if (recordFile) { await recordOs(recordFile); await sh('git', ['checkout', '--quiet', '--detach', '--force', REF], { quiet: true }); return; }
  const compat = JSON.parse(await fsp.readFile(path.join(WORK, 'server', 'compat.json'), 'utf8'));
  const tools = Object.keys(NAMES).filter((t) => compat[t]?.level === 'supported' && (!ONLY.length || ONLY.includes(t)));
  log(`weekly compat run${DRY ? ' (dry run)' : ''} at ${(await sh('git', ['rev-parse', '--short', 'HEAD'], { quiet: true })).out.trim()} for ${tools.join(', ')}`);
  const state = { runAt: new Date().toISOString(), dryRun: DRY, results: [], prs: [], needsAttention: false, log: logFile };

  const preflight = await repoChecks();
  if (preflight) {
    state.needsAttention = true;
    state.results.push({ tool: 'preflight', status: 'error', note: preflight });
    state.finishedAt = new Date().toISOString();
    await fsp.writeFile(STATE, JSON.stringify(state, null, 2));
    log(`offline checks failed; no live AI verification started: ${preflight}`);
    return;
  }

  for (const tool of tools) {
    const r = { tool, from: compat[tool].verified, to: null, status: 'error', note: '' };
    state.results.push(r);
    try {
      const rel = await latestRelease(tool);
      if (!rel) { r.note = 'could not read the latest release'; log(`${tool}: ${r.note}`); state.needsAttention = true; continue; }
      r.to = rel.version;
      r.newRelease = cmp(rel.version, r.from) > 0;
      if (cmp(rel.version, r.from) < 0) { r.status = 'error'; r.note = 'release feed is older than the verified version'; state.needsAttention = true; continue; }
      log(`${tool}: ${r.newRelease ? 'new release' : 'scheduled health check'} ${rel.version} (verified ${r.from}) — installing`);
      r.binDir = await install(tool, rel);
      log(`${tool}: testing ${rel.version}…`);
      r.test = await test(tool, r.binDir, r.to);
      if (!r.test.smokeOk && r.test.report?.steps?.some((s) => !s.ok && s.category === 'network')) {
        log(`${tool}: transient failure — retrying once`);
        r.test = await test(tool, r.binDir, r.to);
      }
      await fsp.writeFile(path.join(LOGS, `${today()}-${tool}-${Date.now()}.json`), JSON.stringify(r.test, null, 2));
      const rep = r.test.report;
      if (rep?.skipped) { r.status = 'skipped'; r.note = rep.skipped; state.needsAttention = true; log(`${tool}: skipped — ${rep.skipped}`); continue; }
      for (const s of rep?.steps || []) log(`  ${s.ok ? '✓' : '✗'} ${s.name}${s.ok ? '' : ` — ${s.detail.split('\n')[0]}`}`);
      if (r.test.smokeOk && r.test.checkOk) {
        r.status = needsReview(rep.drift) ? 'passed-drift' : 'passed';
        if (r.status === 'passed-drift') state.needsAttention = true;
        log(`${tool}: ${rel.version} passed${r.status === 'passed-drift' ? ` (schema/baseline needs review)` : ''}`);
      } else {
        r.status = shouldAttemptFix(r.test) && r.newRelease ? 'failed' : 'error';
        r.note = (rep?.steps || []).filter((s) => !s.ok).map((s) => `${s.name}: ${s.category || 'unknown'} — ${s.detail}`).join('; ') || 'verification did not produce a valid report';
        state.needsAttention = true;
        if (!r.test.checkOk) log(`  ✗ flag check: ${r.test.checkOut.split('\n').filter((l) => l.includes('✗')).join('; ')}`);
        log(`${tool}: ${rel.version} FAILED`);
      }
    } catch (e) { r.status = 'error'; r.note = e.message; state.needsAttention = true; log(`${tool}: error — ${e.message}`); }
  }

  // 1) new versions that passed -> one bump PR (auto-merge only without schema drift)
  const passed = state.results.filter((r) => r.newRelease && (r.status === 'passed' || r.status === 'passed-drift'));
  if (passed.length) {
    try {
      for (const r of passed) await saveShapes(r.test.report);
      await bumpFiles(passed.map((r) => ({ tool: r.tool, to: r.to })));
      const problem = await repoChecks();
      if (problem) throw new Error(`repo checks failed after the bump: ${problem}`);
      const drift = passed.filter((r) => r.status === 'passed-drift');
      const names = passed.map((r) => `${NAMES[r.tool]} ${r.to}`).join(', ');
      const body = `Weekly automatic check: new stable releases passed Baton's live test.

| CLI | Verified until now | New | Result |
|---|---|---|---|
${passed.map((r) => `| ${NAMES[r.tool]} | ${r.from} | **${r.to}** | ${(r.test.report.steps || []).filter((s) => s.ok).length}/${(r.test.report.steps || []).length} steps pass${r.status === 'passed-drift' ? ', **schema review required**' : ''} |`).join('\n')}

Steps: context-preserving resume, ordered transcript, plan/read, file edit and command, Claude question/answer, one-shot, limits, concrete model list; plus \`compat:check\` (flags).
${drift.length ? `\n## Schema changes (review before merging)\nEvery step passes, but fields, types or observed event kinds changed (or the baseline is missing). Review the report before accepting a new baseline.\n${drift.map((r) => `\n**${NAMES[r.tool]}** (since ${r.test.report.drift.baseline}):\n${[...r.test.report.drift.removed, ...(r.test.report.drift.changed || []), ...(r.test.report.drift.missingKinds || []).map((k) => `unobserved kind: ${k}`)].slice(0, 40).map((p) => `- \`${p}\``).join('\n')}`).join('\n')}\n` : ''}
${passed.some((r) => r.test.report.drift?.added?.length) ? `\n<details><summary>New fields</summary>\n\n${passed.map((r) => (r.test.report.drift?.added || []).slice(0, 40).map((p) => `- ${NAMES[r.tool]}: \`${p}\``).join('\n')).join('\n')}\n</details>\n` : ''}
Updates \`server/compat.json\`, the shape baselines, docs and CHANGELOG. ${drift.length ? '**Left open for review** because the schema needs review.' : 'Merged automatically once CI is green.'}

🤖 Generated by Baton's weekly compatibility check (scripts/compat-weekly.mjs)`;
      const url = await commitAndPr({ branch: `compat/verify-${today()}`, title: `Verified with ${names}`, body, message: `chore: verified with ${names}\n\nWeekly automatic check (scripts/compat-weekly.mjs): compat:check and compat:smoke pass.` });
      const pr = { kind: 'verify', url, tools: passed.map((r) => r.tool), merged: false };
      state.prs.push(pr);
      if (url && !drift.length) {
        pr.result = await mergeWhenGreen(url);
        pr.merged = pr.result === 'merged';
        log(`verify PR ${url}: ${pr.result}`);
        if (!pr.merged) state.needsAttention = true;
      } else if (drift.length) { log(`verify PR ${url || '(dry run)'}: left open for review (schema/baseline)`); state.needsAttention = true; }
    } catch (e) { log(`bump PR: error — ${e.message}`); state.needsAttention = true; state.results.push({ tool: 'bump', status: 'error', note: e.message }); }
  }

  // 2) failed -> one fix attempt per CLI, always reviewed by a human
  for (const r of state.results.filter((x) => x.status === 'failed')) {
    state.needsAttention = true;
    try {
      const f = await tryFix(r);
      r.fix = { outcome: f.outcome, url: f.url || null };
      if (f.url) state.prs.push({ kind: f.outcome === 'fixed' ? 'fix' : 'fix-draft', url: f.url, tools: [r.tool], merged: false });
      if (f.outcome === 'no-change' && !DRY) {
        const out = await must('gh', ['issue', 'create', '--repo', REPO_SLUG, '--title', `${NAMES[r.tool]} ${r.to} breaks Baton`, '--body',
          `Baton's weekly live test failed for ${NAMES[r.tool]} ${r.to} (verified: ${r.from}) and Claude Code could not change anything to fix it.\n\n${(r.test.report?.steps || []).map((s) => `- ${s.ok ? '✅' : '❌'} ${s.name}${s.ok ? '' : ` — ${s.detail.slice(0, 400)}`}`).join('\n')}\n\nClaude Code's notes:\n\n${(f.summary || '').slice(0, 4000)}\n\n🤖 Baton weekly compatibility check`]);
        r.fix.issue = out.trim().split('\n').pop();
      }
      log(`${r.tool}: fix ${f.outcome}${f.url ? ` → ${f.url}` : ''}${r.fix.issue ? ` → issue ${r.fix.issue}` : ''}`);
    } catch (e) { log(`${r.tool}: fix attempt error — ${e.message}`); r.fix = { outcome: 'error', note: e.message }; }
  }

  for (const r of state.results) {
    if (r.test?.report) r.verification = { version: r.test.report.version, revision: r.test.report.revision, dirty: r.test.report.dirty, platform: r.test.report.platform, checkedAt: r.test.report.checkedAt, generation: r.test.report.generation, steps: r.test.report.steps, drift: r.test.report.drift };
    delete r.test; delete r.binDir; delete r.oldBin;
  }
  state.finishedAt = new Date().toISOString();
  await fsp.writeFile(STATE, JSON.stringify(state, null, 2));
  log(`done${state.needsAttention ? ' — needs attention' : ''}`);
  // back to a clean origin/main so the worktree never holds stray work
  await sh('git', ['checkout', '--quiet', '--detach', '--force', REF], { quiet: true });
}

if (argv.includes('--maintainer-check')) { // used by compat-schedule.mjs
  const why = await maintainerCheck();
  console.log(why || 'ok');
  process.exit(why ? 1 : 0);
}

main().catch(async (e) => {
  log(`fatal: ${e.stack || e.message}`);
  if (argv.includes('--record-os')) process.exit(1);
  await fsp.writeFile(STATE, JSON.stringify({ runAt: new Date().toISOString(), finishedAt: new Date().toISOString(), dryRun: DRY, results: [], prs: [], needsAttention: true, fatal: e.message, log: logFile }, null, 2)).catch(() => {});
  process.exit(1);
});
