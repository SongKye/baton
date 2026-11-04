// Registry of supported coding-agent CLIs: how to find, install, sign in and check each one.
// Install commands are the vendors' official one-liners (or npm packages) for each OS.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { which, runCli, IS_WIN } from './platform.js';
import { CLAUDE_HOME, CODEX_HOME } from './env.js';

const HOME = os.homedir();
const XDG_DATA = process.env.XDG_DATA_HOME || path.join(HOME, '.local', 'share');
const exists = (p) => { try { fs.statSync(p); return true; } catch { return false; } };

export const TOOL_IDS = ['claude', 'codex', 'agy', 'opencode', 'cursor'];

export const TOOLS = {
  claude: {
    id: 'claude', name: 'Claude Code', short: 'C', vendor: 'Anthropic',
    bins: ['claude'],
    docs: 'https://docs.claude.com/en/docs/claude-code/overview',
    install: {
      unix: 'curl -fsSL https://claude.ai/install.sh | bash',
      windows: 'irm https://claude.ai/install.ps1 | iex',
      npm: '@anthropic-ai/claude-code',
    },
    login: { args: ['auth', 'login'], kind: 'url+code' },
    loggedIn: async (bin) => {
      if (exists(path.join(CLAUDE_HOME, '.credentials.json'))) return true;
      const r = await runCli(bin, ['auth', 'status'], { timeout: 15000 });
      return /"loggedIn":\s*true/.test(r.stdout);
    },
    note: { ko: 'Claude Pro/Max 구독 또는 Anthropic API 키가 필요해요.', en: 'Needs a Claude Pro/Max subscription or an Anthropic API key.' },
  },
  codex: {
    id: 'codex', name: 'Codex', short: 'X', vendor: 'OpenAI',
    bins: ['codex'],
    docs: 'https://developers.openai.com/codex/cli',
    install: { npm: '@openai/codex' },
    login: { args: ['login', '--device-auth'], kind: 'device' },
    loggedIn: async (bin) => {
      if (exists(path.join(CODEX_HOME, 'auth.json'))) return true;
      const r = await runCli(bin, ['login', 'status'], { timeout: 15000 });
      return /logged in/i.test(r.stdout + r.stderr);
    },
    note: { ko: 'ChatGPT Plus/Pro 계정 또는 OpenAI API 키로 로그인해요.', en: 'Sign in with a ChatGPT Plus/Pro account or an OpenAI API key.' },
  },
  agy: {
    id: 'agy', name: 'Antigravity', short: 'A', vendor: 'Google',
    bins: ['agy'],
    docs: 'https://antigravity.google/docs/cli/features',
    install: { unix: 'curl -fsSL https://antigravity.google/cli/install.sh | bash' },
    login: { args: ['-p=/usage', '--output-format', 'json'], kind: 'browser' }, // any command triggers the Google sign-in flow
    loggedIn: async () => exists(path.join(HOME, '.gemini', 'antigravity-cli', 'antigravity-oauth-token')),
    note: { ko: 'Google 계정으로 로그인해요. Windows는 WSL에서 쓰는 걸 권장해요.', en: 'Signs in with a Google account. On Windows, WSL is recommended.' },
  },
  opencode: {
    id: 'opencode', name: 'OpenCode', short: 'O', vendor: 'SST',
    bins: ['opencode'],
    docs: 'https://opencode.ai/docs/',
    install: { unix: 'curl -fsSL https://opencode.ai/install | bash', npm: 'opencode-ai' },
    login: { args: ['auth', 'login'], kind: 'terminal' }, // interactive provider picker -> terminal
    loggedIn: async () => exists(path.join(XDG_DATA, 'opencode', 'auth.json')),
    optionalLogin: true,
    note: { ko: '무료 모델은 로그인 없이 바로 쓸 수 있어요. 다른 모델은 공급자 키를 연결해요.', en: 'Free models work without signing in; connect a provider key for others.' },
  },
  cursor: {
    id: 'cursor', name: 'Cursor', short: 'U', vendor: 'Cursor',
    bins: ['cursor-agent', 'agent'],
    docs: 'https://cursor.com/docs/cli/overview',
    install: { unix: 'curl https://cursor.com/install -fsS | bash', windows: "irm 'https://cursor.com/install?win32=true' | iex" },
    login: { args: ['login'], kind: 'url' },
    loggedIn: async (bin) => {
      const r = await runCli(bin, ['status'], { timeout: 15000 });
      return /logged in|authenticated/i.test(r.stdout + r.stderr) && !/not logged in|not authenticated/i.test(r.stdout + r.stderr);
    },
    note: { ko: 'Cursor 계정이 필요해요.', en: 'Needs a Cursor account.' },
  },
};

/** The executable for a tool, or null if not installed. */
export function binFor(id) {
  for (const b of TOOLS[id]?.bins || []) { const p = which(b); if (p) return p; }
  return null;
}

/** How we'd install this tool on this OS: { kind: 'shell'|'npm', cmd } (null if no known way). */
export function installPlan(id) {
  const t = TOOLS[id];
  if (!t) return null;
  if (IS_WIN) {
    if (t.install.windows) return { kind: 'powershell', cmd: t.install.windows };
    if (t.install.npm) return { kind: 'npm', cmd: `npm install -g ${t.install.npm}` };
    return null;
  }
  if (t.install.unix) return { kind: 'shell', cmd: t.install.unix };
  if (t.install.npm) return { kind: 'npm', cmd: `npm install -g ${t.install.npm}` };
  return null;
}

/** Public metadata for the UI. */
export function toolsMeta() {
  return TOOL_IDS.map((id) => ({ id, name: TOOLS[id].name, short: TOOLS[id].short, vendor: TOOLS[id].vendor, docs: TOOLS[id].docs }));
}
