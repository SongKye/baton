#!/usr/bin/env node
// The same offline suite runs in CI and before accepting an automated compatibility fix.
// Use an isolated installation and home so local runs never open the user's Baton database.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'baton-check-'));
let failed = false;
try {
  const app = path.join(tmp, 'app'), home = path.join(tmp, 'home');
  await fs.mkdir(app); await fs.mkdir(home);
  for (const dir of ['server', 'scripts', 'public']) await fs.cp(path.join(root, dir), path.join(app, dir), { recursive: true });
  for (const f of ['package.json', 'package-lock.json']) await fs.copyFile(path.join(root, f), path.join(app, f));
  await fs.symlink(path.join(root, 'node_modules'), path.join(app, 'node_modules'), 'junction');
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), BATON_NO_SHELL_ENV: '1' };
  if (process.platform === 'win32') {
    // Shell special-folder APIs return empty strings when these profile folders do not exist.
    for (const dir of [path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), env.LOCALAPPDATA, path.join(home, 'Desktop')]) await fs.mkdir(dir, { recursive: true });
  }
  for (const key of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'BATON_PORT', 'BATON_HOST', 'BATON_ALLOWED_LOGINS']) delete env[key];
  // Endpoint checks must not discover a real CLI and use the maintainer's account.
  const bin = path.join(tmp, 'bin');
  await fs.mkdir(bin);
  for (const name of ['claude', 'codex', 'agy', 'opencode', 'cursor-agent', 'agent']) {
    await fs.writeFile(path.join(bin, name + (process.platform === 'win32' ? '.cmd' : '')), process.platform === 'win32' ? '@exit /b 1\r\n' : '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  }
  const inheritedPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
  env.PATH = bin + path.delimiter + inheritedPath;
  for (const key of Object.keys(env)) if (/^(ANTHROPIC_|OPENAI_|AZURE_OPENAI_|CLAUDE_CODE_USE_|AWS_|GOOGLE_API_KEY$|GEMINI_API_KEY$|GH_TOKEN$|GITHUB_TOKEN$)/.test(key)) delete env[key];
  const run = (args) => {
    const result = spawnSync(process.execPath, args, { cwd: app, env, stdio: 'inherit', timeout: 180000 });
    if (result.status !== 0 || result.error) { failed = true; console.error(`FAILED: ${args.join(' ')}${result.error ? `: ${result.error.message}` : ''}`); }
  };
  for (const dir of ['server', 'server/sources', 'public', 'scripts']) {
    for (const file of await fs.readdir(path.join(app, dir))) if (/\.(?:m?js|cjs)$/.test(file)) run(['--check', path.join(dir, file)]);
  }
  const checks = ['i18n', 'update-alerts', 'windows-install', 'chat-images', 'opencode-storage', 'opencode-live', 'live-cache', 'opencode-models', 'codex-fallback', 'access', 'codex-index', 'skill-create', 'mcp-install', 'listener', 'compat-remote', 'compat-contracts', 'compat-weekly', 'session-restore', 'runner'];
  if (process.platform !== 'win32') checks.push('mention', 'folder'); // creating symlinks requires Windows privileges
  for (const name of checks) run(['--no-warnings', `scripts/${name}-check.mjs`]);
  run(['--no-warnings', 'scripts/ci-boot.mjs']);
} finally { await fs.rm(tmp, { recursive: true, force: true }); }
process.exitCode = failed ? 1 : 0;
