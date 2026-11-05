// Quick MCP setup: add a well-known server (or your own) to several CLIs at once, copy a server
// from one CLI to the others, and remove one. Writes each CLI's OWN config, so terminals see it too.
//   Claude Code  `claude mcp add-json -s user …` / `claude mcp remove` (the CLI owns ~/.claude.json)
//   Codex        ~/.codex/config.toml  [mcp_servers.<name>]
//   Antigravity  ~/.gemini/config/mcp_config.json  mcpServers
//   OpenCode     ~/.config/opencode/opencode.json  mcp
//   Cursor       ~/.cursor/mcp.json  mcpServers
// Every file is backed up (<file>.baton-backup) before it is changed.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { HOME } from './util.js';
import { CLAUDE_HOME, CODEX_HOME } from './env.js';
import { binFor } from './tools.js';
import { runCli, which } from './platform.js';
import { childEnv } from './runner.js';
import { tr, lang } from './i18n.js';
import { invalidateMcp, rawServer, serverLocation, parseToml } from './mcp.js';

const XDG_CONFIG = process.env.XDG_CONFIG_HOME || path.join(HOME, '.config');
const FILES = {
  codex: path.join(CODEX_HOME, 'config.toml'),
  agy: path.join(HOME, '.gemini', 'config', 'mcp_config.json'),
  opencode: path.join(XDG_CONFIG, 'opencode', 'opencode.json'),
  cursor: path.join(HOME, '.cursor', 'mcp.json'),
};
export const MCP_TOOLS = ['claude', 'codex', 'agy', 'opencode', 'cursor'];
void CLAUDE_HOME;

// ---------------------------------------------------------------- presets
// fields: to = 'env:NAME' | 'header:Name' | 'header:Name:Prefix ' | 'arg'
const P = (o) => o;
const PRESETS = [
  P({ id: 'context7', name: 'Context7', icon: '📚', url: 'https://mcp.context7.com/mcp', docs: 'https://github.com/upstash/context7',
    desc: { ko: '라이브러리·프레임워크의 최신 문서를 찾아서 AI에게 알려줘요. 옛날 API로 코드를 짜는 실수가 줄어요.', en: 'Looks up current docs for libraries and frameworks so the AI stops using outdated APIs.' },
    fields: [{ k: 'key', label: { ko: 'API 키 (선택 · 무료 한도 늘리기)', en: 'API key (optional · higher free limits)' }, secret: true, optional: true, to: 'header:CONTEXT7_API_KEY' }] }),
  P({ id: 'playwright', name: 'Playwright', icon: '🎭', command: 'npx', args: ['-y', '@playwright/mcp@latest'], needs: 'npx', docs: 'https://github.com/microsoft/playwright-mcp',
    desc: { ko: 'AI가 브라우저를 직접 열고 클릭·입력·스크린샷을 해요. 웹 화면 테스트에 좋아요.', en: 'Lets the AI drive a real browser — click, type, take screenshots. Great for testing web UIs.' } }),
  P({ id: 'chrome-devtools', name: 'Chrome DevTools', icon: '🛠', command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'], needs: 'npx', docs: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
    desc: { ko: '크롬 개발자 도구를 AI가 써요. 콘솔 오류·네트워크·성능을 직접 확인해요.', en: 'Gives the AI Chrome DevTools: console errors, network requests and performance traces.' } }),
  P({ id: 'github', name: 'GitHub', icon: '🐙', url: 'https://api.githubcopilot.com/mcp/', docs: 'https://github.com/github/github-mcp-server',
    desc: { ko: '이슈·PR·코드 검색을 AI가 해요. GitHub 개인 액세스 토큰이 필요해요.', en: 'Issues, pull requests and code search. Needs a GitHub personal access token.' },
    fields: [{ k: 'token', label: { ko: 'GitHub 토큰 (github.com/settings/tokens)', en: 'GitHub token (github.com/settings/tokens)' }, secret: true, ph: 'github_pat_…', to: 'header:Authorization:Bearer ' }] }),
  P({ id: 'filesystem', name: 'Filesystem', icon: '🗂', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'], needs: 'npx', docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    desc: { ko: '정한 폴더 안의 파일을 읽고 쓸 수 있게 해요. 파일 도구가 없는 CLI에 유용해요.', en: 'Read and write files inside the folder you choose. Handy for CLIs without file tools.' },
    fields: [{ k: 'dir', label: { ko: '허용할 폴더', en: 'Allowed folder' }, ph: '~/workspace', value: '~/workspace', to: 'arg' }] }),
  P({ id: 'memory', name: 'Memory', icon: '🧠', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], needs: 'npx', docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    desc: { ko: '세션이 바뀌어도 기억할 내용을 지식 그래프로 저장해요.', en: 'A knowledge-graph memory that persists across sessions.' } }),
  P({ id: 'sequential-thinking', name: 'Sequential Thinking', icon: '🧩', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'], needs: 'npx', docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    desc: { ko: '복잡한 문제를 단계별로 나눠 생각하게 도와줘요.', en: 'Helps the AI break hard problems into steps.' } }),
  P({ id: 'fetch', name: 'Fetch', icon: '🌐', command: 'uvx', args: ['mcp-server-fetch'], needs: 'uvx', docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    desc: { ko: '웹 페이지를 가져와 읽기 좋은 글로 바꿔줘요. uv(파이썬 도구)가 필요해요.', en: 'Fetches web pages as readable text. Needs uv (Python tool runner).' } }),
  P({ id: 'notion', name: 'Notion', icon: '📝', url: 'https://mcp.notion.com/mcp', oauth: true, docs: 'https://developers.notion.com/docs/mcp',
    desc: { ko: '노션 페이지·데이터베이스를 읽고 써요. 처음 쓸 때 노션 로그인 창이 떠요.', en: 'Read and write Notion pages and databases. Signs in with Notion the first time.' } }),
  P({ id: 'linear', name: 'Linear', icon: '📐', url: 'https://mcp.linear.app/mcp', oauth: true, docs: 'https://linear.app/docs/mcp',
    desc: { ko: 'Linear 이슈를 찾고 만들고 업데이트해요. 처음 쓸 때 로그인해요.', en: 'Find, create and update Linear issues. Signs in the first time.' } }),
  P({ id: 'sentry', name: 'Sentry', icon: '🚨', url: 'https://mcp.sentry.dev/mcp', oauth: true, docs: 'https://docs.sentry.io/product/sentry-mcp/',
    desc: { ko: '에러 리포트를 AI가 보고 원인을 찾아요. 처음 쓸 때 로그인해요.', en: 'Lets the AI read error reports and find root causes. Signs in the first time.' } }),
  P({ id: 'supabase', name: 'Supabase', icon: '🟩', url: 'https://mcp.supabase.com/mcp', oauth: true, docs: 'https://supabase.com/docs/guides/getting-started/mcp',
    desc: { ko: 'Supabase DB 테이블·쿼리·마이그레이션을 다뤄요. 처음 쓸 때 로그인해요.', en: 'Work with Supabase tables, queries and migrations. Signs in the first time.' } }),
  P({ id: 'figma', name: 'Figma (desktop)', icon: '🎨', url: 'http://127.0.0.1:3845/mcp', docs: 'https://help.figma.com/hc/en-us/articles/32132100833559',
    desc: { ko: '피그마 데스크톱 앱의 Dev Mode MCP를 켜두면 선택한 디자인을 코드로 옮겨요.', en: 'With Figma desktop’s Dev Mode MCP on, turns the selected design into code.' } }),
];

export function presets() {
  const L = lang();
  const has = { npx: Boolean(which('npx')), uvx: Boolean(which('uvx')) };
  return PRESETS.map((p) => ({
    id: p.id, name: p.name, icon: p.icon, docs: p.docs, oauth: Boolean(p.oauth), transport: p.url ? 'http' : 'stdio',
    target: p.url || [p.command, ...p.args].join(' '), desc: p.desc[L] || p.desc.en,
    needs: p.needs || null, missing: p.needs && !has[p.needs] ? p.needs : null,
    fields: (p.fields || []).map((f) => ({ k: f.k, label: f.label[L] || f.label.en, secret: Boolean(f.secret), optional: Boolean(f.optional), ph: f.ph || '', value: f.value || '' })),
  }));
}

const expandHome = (p) => String(p).replace(/^~(?=$|[\\/])/, HOME);

/** Build a server spec from a preset + the user's answers. */
function presetSpec(id, values = {}) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error('unknown preset');
  const spec = p.url ? { transport: 'http', url: p.url, headers: {} } : { transport: 'stdio', command: p.command, args: [...p.args], env: {} };
  for (const f of p.fields || []) {
    const v = String(values[f.k] ?? f.value ?? '').trim();
    if (!v) { if (f.optional) continue; throw new Error(tr('{name}을(를) 입력해주세요', { name: f.label[lang()] || f.label.en })); }
    const [kind, name, prefix = ''] = f.to.split(':');
    if (kind === 'env') spec.env[name] = v;
    else if (kind === 'header') spec.headers[name] = prefix + v;
    else if (kind === 'arg') spec.args.push(expandHome(v));
  }
  return { name: p.id, spec };
}

/** A custom server typed by the user: a command line or a URL. */
function customSpec(c = {}) {
  const name = String(c.name || '').trim();
  const target = String(c.target || '').trim();
  if (!name || !target) throw new Error(tr('이름과 실행 명령(또는 URL)을 입력해주세요'));
  const pairs = (txt) => Object.fromEntries(String(txt || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.search(/[=:]/);
    return i < 0 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }).filter(([k]) => k));
  if (/^https?:\/\//i.test(target)) return { name, spec: { transport: 'http', url: target, headers: pairs(c.headers) } };
  const parts = target.match(/"[^"]*"|'[^']*'|\S+/g).map((x) => x.replace(/^(["'])(.*)\1$/, '$2'));
  return { name, spec: { transport: 'stdio', command: parts[0], args: parts.slice(1).map(expandHome), env: pairs(c.env) } };
}

// ---------------------------------------------------------------- writers
const safeName = (n) => String(n).trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'server';
const readJsonFile = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw new Error(tr('{file}을(를) 읽지 못했어요 (JSON 형식 오류). 직접 고쳐주세요', { file: f })); } };
async function backup(file) { if (fs.existsSync(file)) await fsp.copyFile(file, `${file}.baton-backup`); }
async function writeJson(file, obj) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await backup(file);
  await fsp.writeFile(file, JSON.stringify(obj, null, 2) + '\n');
}
const nonEmpty = (o) => (o && Object.keys(o).length ? o : undefined);

// TOML helpers for [mcp_servers.<name>] (and any [mcp_servers.<name>.*] sub-tables)
const tKey = (k) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k));
const tStr = (s) => JSON.stringify(String(s));
const tInline = (o) => `{ ${Object.entries(o).map(([k, v]) => `${tKey(k)} = ${tStr(v)}`).join(', ')} }`;
function dropTomlServer(toml, name) {
  const lines = toml.split('\n');
  const out = [];
  let skip = false;
  const mine = (h) => { const p = h.replace(/\s+/g, ''); return p === `mcp_servers.${tKey(name)}` || p.startsWith(`mcp_servers.${tKey(name)}.`); };
  for (const l of lines) {
    const h = l.match(/^\s*\[{1,2}([^\]]+)\]{1,2}\s*(#.*)?$/);
    if (h) skip = mine(h[1]);
    if (!skip) out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

async function addOne(tool, name, spec) {
  const http = spec.transport === 'http';
  if (tool === 'claude') {
    const bin = binFor('claude');
    if (!bin) throw new Error(tr('먼저 설치해주세요'));
    const cfg = http ? { type: 'http', url: spec.url, ...(nonEmpty(spec.headers) ? { headers: spec.headers } : {}) }
      : { type: 'stdio', command: spec.command, args: spec.args || [], ...(nonEmpty(spec.env) ? { env: spec.env } : {}) };
    await runCli(bin, ['mcp', 'remove', '-s', 'user', name], { timeout: 30000, cwd: HOME, env: childEnv() });
    const r = await runCli(bin, ['mcp', 'add-json', '-s', 'user', name, JSON.stringify(cfg)], { timeout: 30000, cwd: HOME, env: childEnv() });
    if (r.code !== 0) throw new Error((r.stderr || r.stdout || 'claude mcp add-json failed').trim().split('\n').pop());
    return '~/.claude.json';
  }
  if (tool === 'codex') {
    const file = FILES.codex;
    let toml = '';
    try { toml = await fsp.readFile(file, 'utf8'); } catch { /* new file */ }
    const body = http
      ? [`url = ${tStr(spec.url)}`, ...(nonEmpty(spec.headers) ? [`http_headers = ${tInline(spec.headers)}`] : [])]
      : [`command = ${tStr(spec.command)}`, `args = [${(spec.args || []).map(tStr).join(', ')}]`, ...(nonEmpty(spec.env) ? [`env = ${tInline(spec.env)}`] : [])];
    const next = `${dropTomlServer(toml, name).replace(/\s*$/, '')}\n\n[mcp_servers.${tKey(name)}]\n${body.join('\n')}\n`.replace(/^\n+/, '');
    parseToml(next); // throws if we produced something unreadable
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await backup(file);
    await fsp.writeFile(file, next);
    return file;
  }
  if (tool === 'opencode') {
    const file = FILES.opencode;
    if (!fs.existsSync(file) && fs.existsSync(`${file}c`)) throw new Error(tr('opencode.jsonc를 쓰고 있어서 자동으로 바꾸지 않았어요. 직접 추가해주세요'));
    const cur = readJsonFile(file) || { $schema: 'https://opencode.ai/config.json' };
    cur.mcp = { ...(cur.mcp || {}), [name]: http
      ? { type: 'remote', url: spec.url, enabled: true, ...(nonEmpty(spec.headers) ? { headers: spec.headers } : {}) }
      : { type: 'local', command: [spec.command, ...(spec.args || [])], enabled: true, ...(nonEmpty(spec.env) ? { environment: spec.env } : {}) } };
    await writeJson(file, cur);
    return file;
  }
  if (tool === 'agy' || tool === 'cursor') {
    const file = FILES[tool];
    const cur = readJsonFile(file) || {};
    cur.mcpServers = { ...(cur.mcpServers || {}), [name]: http
      ? { [tool === 'agy' ? 'serverUrl' : 'url']: spec.url, ...(nonEmpty(spec.headers) ? { headers: spec.headers } : {}) }
      : { command: spec.command, args: spec.args || [], ...(nonEmpty(spec.env) ? { env: spec.env } : {}) } };
    await writeJson(file, cur);
    return file;
  }
  throw new Error('unsupported tool');
}

async function addEverywhere(name, spec, tools) {
  name = safeName(name);
  const list = [...new Set(tools || [])].filter((t) => MCP_TOOLS.includes(t));
  if (!list.length) throw new Error(tr('추가할 CLI를 하나 이상 골라주세요'));
  const results = [];
  for (const tool of list) {
    try { results.push({ tool, ok: true, file: await addOne(tool, name, spec) }); }
    catch (e) { results.push({ tool, ok: false, error: e.message }); }
  }
  invalidateMcp();
  return { name, results };
}

/** body: { preset, values, tools } | { custom: { name, target, env, headers }, tools } */
export async function addMcp(b = {}) {
  const { name, spec } = b.preset ? presetSpec(b.preset, b.values) : customSpec(b.custom);
  return addEverywhere(name, spec, b.tools);
}

/** Copy an existing server (by inventory id) to other CLIs, secrets included (they never reach the browser). */
export async function copyMcp(id, tools) {
  const raw = await rawServer(id);
  if (!raw) throw new Error(tr('이 서버는 복사할 수 없어요 (플러그인·회사 관리·커넥터는 원래 위치에서 관리돼요)'));
  return addEverywhere(raw.name, raw.spec, (tools || []).filter((t) => t !== raw.tool || raw.scope !== 'user'));
}

/** Remove a server from the scope it lives in (global scopes for every CLI; local/project for Claude Code). */
export async function removeMcp(id) {
  const s = await serverLocation(id);
  if (!s) throw new Error(tr('MCP 서버를 찾을 수 없어요'));
  if (s.tool === 'claude' && ['user', 'local', 'project'].includes(s.scope)) {
    const bin = binFor('claude');
    if (!bin) throw new Error(tr('먼저 설치해주세요'));
    const r = await runCli(bin, ['mcp', 'remove', '-s', s.scope, s.name], { timeout: 30000, cwd: s.project || HOME, env: childEnv() });
    if (r.code !== 0) throw new Error((r.stderr || r.stdout || 'claude mcp remove failed').trim().split('\n').pop());
  } else if (s.scope === 'user' && s.tool === 'codex') {
    const toml = await fsp.readFile(s.file, 'utf8');
    await backup(s.file);
    await fsp.writeFile(s.file, dropTomlServer(toml, s.name));
  } else if (s.scope === 'user' && ['agy', 'cursor', 'opencode'].includes(s.tool) && /\.json$/.test(s.file)) {
    const cur = readJsonFile(s.file) || {};
    const key = s.tool === 'opencode' ? 'mcp' : 'mcpServers';
    if (cur[key]) delete cur[key][s.name];
    await writeJson(s.file, cur);
  } else throw new Error(tr('이 위치의 서버는 여기서 지울 수 없어요. 설정 파일에서 직접 지워주세요'));
  invalidateMcp();
  return { ok: true };
}
