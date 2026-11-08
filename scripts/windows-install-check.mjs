// Exercise the public installer with local release tags and a minimal server.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
for (const file of readdirSync(path.join(root, 'scripts')).filter(f => f.endsWith('.ps1'))) {
  assert.ok(readFileSync(path.join(root, 'scripts', file)).every(b => b < 128), `${file} must be ASCII`);
}
console.log('PowerShell scripts are ASCII');
if (process.platform !== 'win32') {
  console.log('Windows installation scenarios require Windows PowerShell 5.1');
  process.exit(0);
}

const temp = mkdtempSync(path.join(tmpdir(), 'baton windows install '));
const repo = path.join(temp, 'releases');
const dest = path.join(temp, 'user install');
const marker = path.join(temp, 'server-started');
const env = { ...process.env, BATON_REPO: repo, BATON_DIR: dest, BATON_TEST_MARKER: marker,
  BATON_TEST_INSTALLER: path.join(root, 'scripts/install.ps1') };
function run(exe, args, options = {}) {
  const result = spawnSync(exe, args, { cwd: repo, env, encoding: 'utf8', timeout: 120_000, ...options });
  if (result.error) throw result.error;
  return { ...result, output: result.stdout + result.stderr };
}
function git(...args) {
  const result = run('git', args);
  assert.equal(result.status, 0, result.output);
  return result.stdout.trim();
}
function install(overrides = {}) {
  rmSync(marker, { force: true });
  return run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    'Invoke-Expression ([IO.File]::ReadAllText($env:BATON_TEST_INSTALLER))'], { env: { ...env, ...overrides } });
}
function success(label) {
  const result = install();
  assert.equal(result.status, 0, result.output);
  assert.ok(existsSync(marker), result.output);
  assert.doesNotMatch(result.output, /already installed/);
  console.log(`PASS ${label}`);
}
try {
  mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  mkdirSync(path.join(repo, 'server'));
  copyFileSync(path.join(root, 'scripts/setup.ps1'), path.join(repo, 'scripts/setup.ps1'));
  writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'baton-installer-fixture', version: '0.0.1', private: true }));
  writeFileSync(path.join(repo, 'server/index.js'), "require('node:fs').writeFileSync(process.env.BATON_TEST_MARKER, 'started'); process.exit(Number(process.env.BATON_TEST_SERVER_EXIT || 0));\n");
  git('init');
  git('add', '.');
  git('-c', 'user.name=Installer Test', '-c', 'user.email=installer@example.invalid', 'commit', '-m', 'Fixture release');
  git('tag', 'v0.0.1');
  success('fresh install via Invoke-Expression, including real npm.cmd');
  {
    // the Start menu shortcut (found by Start search) points at this install and opens the dashboard
    const lnk = run('powershell.exe', ['-NoProfile', '-Command',
      "$l = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'Baton.lnk')); $l.TargetPath; $l.Arguments; $l.WorkingDirectory"]);
    assert.equal(lnk.status, 0, lnk.output);
    const [target, args, cwd] = lnk.stdout.split(/\r?\n/).filter(Boolean);
    assert.match(target, /node\.exe$/i, lnk.output);
    assert.ok(args.includes(path.join(dest, 'server', 'index.js')) && args.endsWith('--open'), lnk.output);
    assert.equal(path.resolve(cwd), path.resolve(dest), lnk.output);
    console.log('PASS Start menu shortcut starts this installation');
  }
  success('repeat installation');
  git('-c', 'user.name=Installer Test', '-c', 'user.email=installer@example.invalid', 'commit', '--allow-empty', '-m', 'Next release');
  git('tag', 'v0.0.2');
  success('upgrade existing release');
  assert.equal(git('-C', dest, 'describe', '--tags', '--exact-match'), 'v0.0.2');

  const stubs = path.join(temp, 'failed npm');
  mkdirSync(stubs);
  writeFileSync(path.join(stubs, 'npm.cmd'), '@echo off\r\nexit /b 23\r\n');
  const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'Path';
  const failedNpm = install({ [pathKey]: stubs + path.delimiter + env[pathKey] });
  assert.notEqual(failedNpm.status, 0, failedNpm.output);
  assert.match(failedNpm.output, /Dependency installation failed/);
  assert.match(failedNpm.output, /Baton setup failed/);
  assert.doesNotMatch(failedNpm.output, /Dependencies installed/);
  assert.ok(!existsSync(marker), 'Server must not start after npm failure');
  console.log('PASS dependency failure reaches installer and stops startup');

  const failedServer = install({ BATON_TEST_SERVER_EXIT: '19' });
  assert.notEqual(failedServer.status, 0, failedServer.output);
  assert.match(failedServer.output, /Baton exited with an error/);
  assert.match(failedServer.output, /Baton setup failed/);
  console.log('PASS server failure reaches installer');

  writeFileSync(path.join(dest, 'scripts/setup.ps1'), '"unterminated\r\n');
  const failedParse = install();
  assert.notEqual(failedParse.status, 0, failedParse.output);
  assert.match(failedParse.output, /Baton setup failed/);
  assert.ok(!existsSync(marker));
  console.log('PASS setup parse failure reaches installer');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
