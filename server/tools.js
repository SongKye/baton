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

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

// auth.json only proves someone signed in once: ChatGPT tokens go stale (say, a file from last year)
// and then Codex runs and the limits call fail with 401 while `codex login status` still says
// "Logged in". Ask the same usage endpoint the limits panel uses; network trouble counts as signed in.
async function codexTokenOk(tokens) {
  try {
    const r = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      headers: { Authorization: `Bearer ${tokens.access_token}`, 'ChatGPT-Account-Id': tokens.account_id || '', 'User-Agent': 'baton/1.0' },
      signal: AbortSignal.timeout(6000),
    });
    return r.status !== 401;
  } catch { return true; }
}

// Same story for Claude: .credentials.json outlives the login (a file from an install months ago), and
// it can also exist holding only MCP OAuth entries. A live access token is checked against the usage
// endpoint. An expired one we can't test without refreshing it ourselves, which would rotate the CLI's
// refresh token, so: a recently expired token is fine (the CLI refreshes it on next use), but one
// that's been dead for a week usually means the refresh token is gone too ("OAuth session expired and
// could not be refreshed"), so ask for a fresh sign-in.
const CLAUDE_STALE_MS = 7 * 24 * 3600 * 1000;
async function claudeTokenState(cred) {
  if (cred.expiresAt && cred.expiresAt < Date.now()) return Date.now() - cred.expiresAt > CLAUDE_STALE_MS ? 'expired' : true;
  try {
    const r = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${cred.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'baton/1.0' },
      signal: AbortSignal.timeout(6000),
    });
    return r.status === 401 ? 'expired' : true;
  } catch { return true; }
}

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
      const cred = readJson(path.join(CLAUDE_HOME, '.credentials.json'))?.claudeAiOauth;
      if (cred?.accessToken) return claudeTokenState(cred);
      const r = await runCli(bin, ['auth', 'status'], { timeout: 15000 });
      return /"loggedIn":\s*true/.test(r.stdout);
    },
    note: { ko: 'Claude 구독, Anthropic API 키, Amazon Bedrock, Google Vertex, LLM 게이트웨이·내 서버 중 하나로 쓸 수 있어요.', en: 'Works with a Claude subscription, an Anthropic API key, Amazon Bedrock, Google Vertex, or an LLM gateway / your own server.' },
  },
  codex: {
    id: 'codex', name: 'Codex', short: 'X', vendor: 'OpenAI',
    bins: ['codex'],
    docs: 'https://developers.openai.com/codex/cli',
    install: { npm: '@openai/codex' },
    login: { args: ['login', '--device-auth'], kind: 'device' },
    loggedIn: async (bin) => {
      const auth = readJson(path.join(CODEX_HOME, 'auth.json'));
      if (auth?.tokens?.access_token && !auth.OPENAI_API_KEY) return (await codexTokenOk(auth.tokens)) ? true : 'expired';
      if (auth) return true;
      const r = await runCli(bin, ['login', 'status'], { timeout: 15000 });
      return /logged in/i.test(r.stdout + r.stderr);
    },
    note: { ko: 'ChatGPT 계정, OpenAI API 키, Azure OpenAI·사내 게이트웨이·내 서버(Responses API) 중 하나로 쓸 수 있어요.', en: 'Works with a ChatGPT account, an OpenAI API key, or Azure OpenAI / a company gateway / your own server (Responses API).' },
  },
  agy: {
    id: 'agy', name: 'Antigravity', short: 'A', vendor: 'Google',
    bins: ['agy'],
    docs: 'https://antigravity.google/docs/cli/features',
    install: { unix: 'curl -fsSL https://antigravity.google/cli/install.sh | bash' },
    login: { args: [], kind: 'terminal' }, // print mode (-p) now refuses unauthenticated; sign-in only runs in interactive `agy`
    loggedIn: async () => exists(path.join(HOME, '.gemini', 'antigravity-cli', 'antigravity-oauth-token')),
    note: { ko: 'Google 계정 전용이에요 (외부 LLM 연결은 지원하지 않아요). Windows는 WSL에서 쓰는 걸 권장해요.', en: 'Google account only (no external LLMs). On Windows, WSL is recommended.' },
  },
  opencode: {
    id: 'opencode', name: 'OpenCode', short: 'O', vendor: 'SST',
    bins: ['opencode'],
    docs: 'https://opencode.ai/docs/',
    install: { unix: 'curl -fsSL https://opencode.ai/install | bash', npm: 'opencode-ai' },
    login: { args: ['auth', 'login'], kind: 'terminal' }, // interactive provider picker -> terminal
    loggedIn: async () => exists(path.join(XDG_DATA, 'opencode', 'auth.json')),
    optionalLogin: true,
    note: { ko: '무료 모델은 로그인 없이 바로 쓸 수 있어요. Ollama·vLLM 같은 OpenAI 호환 서버도 연결할 수 있어서 자체 서빙 모델에 가장 잘 맞아요.', en: 'Free models work without signing in. Also connects to any OpenAI-compatible server (Ollama, vLLM…) — the best fit for self-hosted models.' },
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
    note: { ko: 'Cursor 계정 전용이에요 (외부 LLM 연결은 지원하지 않아요).', en: 'Cursor account only (no external LLMs).' },
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
