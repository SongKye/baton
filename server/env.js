// Loaded FIRST (before any other Baton module) so every CLI Baton launches sees the same environment
// the user's own terminal has. This matters for company setups:
//   - Claude Code on Amazon Bedrock / Google Vertex / Microsoft Foundry / an LLM gateway is configured
//     with env vars (CLAUDE_CODE_USE_BEDROCK, AWS_PROFILE, ANTHROPIC_BASE_URL, ANTHROPIC_MODEL, …)
//   - Codex with a company provider reads its API key from an env var named in config.toml
//   - corporate proxies / CAs (HTTPS_PROXY, NODE_EXTRA_CA_CERTS, …)
//   - relocated config dirs (CLAUDE_CONFIG_DIR, CODEX_HOME)
// Those usually live in ~/.bashrc / ~/.zshrc, which a background service (systemd, launchd) never reads.
// So on macOS/Linux we ask the user's login shell for its environment once at startup, then apply the
// extra variables saved in Settings → CLI environment. On Windows, user env vars already come from the
// registry, so only the Settings variables are applied.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SKIP = new Set(['PWD', 'OLDPWD', 'SHLVL', '_', 'PS1', 'PS2', 'PROMPT_COMMAND', 'TERM', 'TERM_PROGRAM', 'COLUMNS', 'LINES', 'BATON_PORT', 'BATON_ALLOWED_LOGINS', 'SSH_TTY', 'SSH_CONNECTION', 'SSH_CLIENT']);
export const envInfo = { shell: null, imported: [], extra: [], error: null };

function loginShellEnv() {
  if (process.platform === 'win32' || process.env.BATON_NO_SHELL_ENV) return {};
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  envInfo.shell = shell;
  try {
    // -i so ~/.bashrc / ~/.zshrc run too (that's where people put exports); marker skips any banner output
    const out = execFileSync(shell, ['-ilc', 'printf "__BATON_ENV__"; env -0'], {
      encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, BATON_SHELL_PROBE: '1' },
    });
    const body = out.slice(out.indexOf('__BATON_ENV__') + '__BATON_ENV__'.length);
    const env = {};
    for (const entry of body.split('\0')) {
      const i = entry.indexOf('=');
      if (i > 0) env[entry.slice(0, i)] = entry.slice(i + 1);
    }
    return env;
  } catch (e) { envInfo.error = e.message.split('\n')[0]; return {}; }
}

/** KEY=VALUE pairs the user saved in Settings (stored in Baton's own DB). */
export function savedExtraEnv() {
  const file = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'data', 'baton.db');
  if (!fs.existsSync(file)) return {};
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const row = db.prepare("SELECT v FROM kv WHERE k = 'extra_env'").get();
    return row ? JSON.parse(row.v) || {} : {};
  } catch { return {}; } finally { try { db?.close(); } catch { /* ignore */ } }
}

const shellEnv = loginShellEnv();
for (const [k, v] of Object.entries(shellEnv)) {
  if (SKIP.has(k) || k.startsWith('BASH_FUNC_') || k === 'BATON_SHELL_PROBE') continue;
  if (k === 'PATH') { // keep the service's PATH entries too
    const parts = new Set([...v.split(path.delimiter), ...(process.env.PATH || '').split(path.delimiter)].filter(Boolean));
    process.env.PATH = [...parts].join(path.delimiter);
    continue;
  }
  if (process.env[k] !== v) { process.env[k] = v; envInfo.imported.push(k); }
}
for (const [k, v] of Object.entries(savedExtraEnv())) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
  process.env[k] = String(v);
  envInfo.extra.push(k);
}

// Baton's own outbound requests (usage limits, web push) should use the corporate proxy too
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) process.env.NODE_USE_ENV_PROXY = '1';

export const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR.replace(/^~(?=$|[\\/])/, os.homedir())) : path.join(os.homedir(), '.claude');
export const CODEX_HOME = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME.replace(/^~(?=$|[\\/])/, os.homedir())) : path.join(os.homedir(), '.codex');
