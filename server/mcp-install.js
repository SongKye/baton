// Add an MCP server to several CLIs at once — globally (every folder) or for one project only — copy a
// server to other CLIs, and remove one. Writes each CLI's OWN config, so terminals see it too.
//                 global (every folder)                         one project only
//   Claude Code   `claude mcp add-json -s user`                 `-s local` (private, ~/.claude.json) or `-s project` (.mcp.json, shared)
//   Codex         ~/.codex/config.toml [mcp_servers.<name>]     <project>/.codex/config.toml (Codex reads it only in trusted folders)
//   Antigravity   ~/.gemini/config/mcp_config.json              <project>/.agents/plugins/baton-mcp/{plugin.json,mcp_config.json}
//   OpenCode      ~/.config/opencode/opencode.json "mcp"        <project>/opencode.json "mcp"
//   Cursor        ~/.cursor/mcp.json                            <project>/.cursor/mcp.json
// Every file is backed up (<file>.baton-backup) before it is changed.
// A server is described by a template: { name, transport, command, args, url, env, headers, inputs } where
// values may hold {{KEY}} placeholders that the user's answers (inputs) fill in — presets, the AI and
// hand-written servers all use the same shape.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { HOME, shortHome } from './util.js';
import { CODEX_HOME } from './env.js';
import { binFor } from './tools.js';
import { runCli, which } from './platform.js';
import { childEnv } from './runner.js';
import { tr, lang } from './i18n.js';
import { invalidateMcp, rawServer, serverLocation, parseToml, CLAUDE_JSON, readJson, readJsonc, serversOfMcpJson, opencodeServers, opencodeV2 } from './mcp.js';
import { checkRoot } from './skill-create.js';

const XDG_CONFIG = process.env.XDG_CONFIG_HOME || path.join(HOME, '.config');
const FILES = {
  codex: path.join(CODEX_HOME, 'config.toml'),
  agy: path.join(HOME, '.gemini', 'config', 'mcp_config.json'),
  opencode: path.join(XDG_CONFIG, 'opencode', 'opencode.json'),
  cursor: path.join(HOME, '.cursor', 'mcp.json'),
};
export const MCP_TOOLS = ['claude', 'codex', 'agy', 'opencode', 'cursor'];
export const AGY_PLUGIN = 'baton-mcp'; // the workspace plugin Baton keeps a project's Antigravity servers in
const fail = (msg, code) => Object.assign(new Error(msg), code ? { code } : {});

// ---------------------------------------------------------------- presets
// fields: to = 'env:NAME' | 'header:Name' | 'header:Name:Prefix ' | 'arg'
const P = (o) => o;
const PRESETS = [
  P({ id: 'context7', name: 'Context7', icon: 'book', url: 'https://mcp.context7.com/mcp', docs: 'https://github.com/upstash/context7',
    desc: { ko: '라이브러리·프레임워크의 최신 문서를 찾아서 AI에게 알려줘요. 옛날 API로 코드를 짜는 실수가 줄어요.', en: 'Looks up current docs for libraries and frameworks so the AI stops using outdated APIs.' },
    fields: [{ k: 'key', label: { ko: 'API 키 (선택 · 무료 한도 늘리기)', en: 'API key (optional · higher free limits)' }, secret: true, optional: true, to: 'header:CONTEXT7_API_KEY' }] }),
  P({ id: 'playwright', name: 'Playwright', icon: 'browser', command: 'npx', args: ['-y', '@playwright/mcp@latest'], needs: 'npx', docs: 'https://github.com/microsoft/playwright-mcp',
    desc: { ko: 'AI가 브라우저를 직접 열고 클릭·입력·스크린샷을 해요. 웹 화면 테스트에 좋아요.', en: 'Lets the AI drive a real browser — click, type, take screenshots. Great for testing web UIs.' } }),
  P({ id: 'chrome-devtools', name: 'Chrome DevTools', icon: 'wrench', command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'], needs: 'npx', docs: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
    desc: { ko: '크롬 개발자 도구를 AI가 써요. 콘솔 오류·네트워크·성능을 직접 확인해요.', en: 'Gives the AI Chrome DevTools: console errors, network requests and performance traces.' } }),
  P({ id: 'github', name: 'GitHub', icon: 'branch', url: 'https://api.githubcopilot.com/mcp/', docs: 'https://github.com/github/github-mcp-server',
    desc: { ko: '이슈·PR·코드 검색을 AI가 해요. GitHub 개인 액세스 토큰이 필요해요.', en: 'Issues, pull requests and code search. Needs a GitHub personal access token.' },
    fields: [{ k: 'token', label: { ko: 'GitHub 토큰 (github.com/settings/tokens)', en: 'GitHub token (github.com/settings/tokens)' }, secret: true, ph: 'github_pat_…', to: 'header:Authorization:Bearer ' }] }),
  P({ id: 'filesystem', name: 'Filesystem', icon: 'folder', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'], needs: 'npx', docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    desc: { ko: '정한 폴더 안의 파일을 읽고 쓸 수 있게 해요. 파일 도구가 없는 CLI에 유용해요.', en: 'Read and write files inside the folder you choose. Handy for CLIs without file tools.' },
    fields: [{ k: 'dir', label: { ko: '허용할 폴더', en: 'Allowed folder' }, ph: '~/workspace', value: '~/workspace', to: 'arg' }] }),
  P({ id: 'memory', name: 'Memory', icon: 'database', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], needs: 'npx', docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    desc: { ko: '세션이 바뀌어도 기억할 내용을 지식 그래프로 저장해요.', en: 'A knowledge-graph memory that persists across sessions.' } }),
  P({ id: 'sequential-thinking', name: 'Sequential Thinking', icon: 'steps', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'], needs: 'npx', docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    desc: { ko: '복잡한 문제를 단계별로 나눠 생각하게 도와줘요.', en: 'Helps the AI break hard problems into steps.' } }),
  P({ id: 'fetch', name: 'Fetch', icon: 'globe', command: 'uvx', args: ['mcp-server-fetch'], needs: 'uvx', docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    desc: { ko: '웹 페이지를 가져와 읽기 좋은 글로 바꿔줘요. uv(파이썬 도구)가 필요해요.', en: 'Fetches web pages as readable text. Needs uv (Python tool runner).' } }),
  P({ id: 'notion', name: 'Notion', icon: 'doc', url: 'https://mcp.notion.com/mcp', oauth: true, docs: 'https://developers.notion.com/docs/mcp',
    desc: { ko: '노션 페이지·데이터베이스를 읽고 써요. 처음 쓸 때 노션 로그인 창이 떠요.', en: 'Read and write Notion pages and databases. Signs in with Notion the first time.' } }),
  P({ id: 'linear', name: 'Linear', icon: 'ruler', url: 'https://mcp.linear.app/mcp', oauth: true, docs: 'https://linear.app/docs/mcp',
    desc: { ko: 'Linear 이슈를 찾고 만들고 업데이트해요. 처음 쓸 때 로그인해요.', en: 'Find, create and update Linear issues. Signs in the first time.' } }),
  P({ id: 'sentry', name: 'Sentry', icon: 'alert', url: 'https://mcp.sentry.dev/mcp', oauth: true, docs: 'https://docs.sentry.io/product/sentry-mcp/',
    desc: { ko: '에러 리포트를 AI가 보고 원인을 찾아요. 처음 쓸 때 로그인해요.', en: 'Lets the AI read error reports and find root causes. Signs in the first time.' } }),
  P({ id: 'supabase', name: 'Supabase', icon: 'database', url: 'https://mcp.supabase.com/mcp', oauth: true, docs: 'https://supabase.com/docs/guides/getting-started/mcp',
    desc: { ko: 'Supabase DB 테이블·쿼리·마이그레이션을 다뤄요. 처음 쓸 때 로그인해요.', en: 'Work with Supabase tables, queries and migrations. Signs in the first time.' } }),
  P({ id: 'figma', name: 'Figma (desktop)', icon: 'pen', url: 'http://127.0.0.1:3845/mcp', docs: 'https://help.figma.com/hc/en-us/articles/32132100833559',
    desc: { ko: '피그마 데스크톱 앱의 Dev Mode MCP를 켜두면 선택한 디자인을 코드로 옮겨요.', en: 'With Figma desktop’s Dev Mode MCP on, turns the selected design into code.' } }),
];

// ~/x -> <home>/x with this OS's separators ("~/w" on Windows must not become C:\\Users\\me/w)
const expandHome = (p) => { const m = String(p).match(/^~(?:[\\/](.*))?$/s); return m ? (m[1] ? path.join(HOME, m[1]) : HOME) : String(p); };
const safeName = (n) => String(n).trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

// ---------------------------------------------------------------- templates (the editable form)
// The browser edits a server as { name, transport, target, pairs, inputs }: `target` is a command line or a URL,
// `pairs` the env vars (KEY=value) or HTTP headers (Name: value), one per line. Both may hold {{KEY}} placeholders.
const quoteArg = (a) => (a === '' || /[\s"']/.test(a) ? (a.includes('"') ? `'${a}'` : `"${a}"`) : a);
const clipText = (v, n) => { const t = String(v || '').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const PH = /\{\{\s*([A-Za-z][A-Za-z0-9_.-]{0,63})\s*\}\}/g;
const keysIn = (s) => [...String(s ?? '').matchAll(PH)].map((m) => m[1]);

export function cleanInputs(list) {
  const out = [];
  for (const x of [].concat(list || []).slice(0, 12)) {
    const key = String(x?.key || '').trim();
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) || out.some((i) => i.key === key)) continue;
    out.push({
      key, label: String(x.label || key).trim().slice(0, 120), help: clipText(x.help, 600),
      secret: Boolean(x.secret), required: x.required !== false, default: String(x.default ?? '').slice(0, 500), ph: String(x.ph || x.example || '').slice(0, 120),
    });
  }
  return out;
}

/** A template (command/args/url/env/headers…) -> the form the browser edits. */
export function toForm(t = {}) {
  const http = t.transport === 'http' || t.transport === 'sse' || (!t.command && t.url);
  const pairs = Object.entries((http ? t.headers : t.env) || {}).map(([k, v]) => `${k}${http ? ': ' : '='}${v}`).join('\n');
  return {
    name: safeName(t.name || ''), transport: http ? (t.transport === 'sse' ? 'sse' : 'http') : 'stdio',
    target: http ? String(t.url || '') : [t.command, ...(t.args || [])].filter((x) => x != null && x !== '').map((x) => quoteArg(String(x))).join(' '),
    pairs, inputs: cleanInputs(t.inputs), oauth: Boolean(t.oauth),
  };
}

const parsePairs = (txt) => Object.fromEntries(String(txt || '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
  const i = l.search(/[=:]/);
  return i < 0 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
}).filter(([k]) => k));

/** The browser's form -> a template (still with placeholders). Throws a readable error. */
export function formToTemplate(f = {}) {
  const name = safeName(f.name || '');
  if (!name) throw fail(tr('서버 이름을 입력해주세요 (영어·숫자·-·_)'));
  const target = String(f.target || '').trim();
  if (!target) throw fail(tr('실행 명령 또는 URL을 입력해주세요'));
  const inputs = cleanInputs(f.inputs);
  if (/^https?:\/\//i.test(target) || (/^\{\{[^}]+\}\}/.test(target) && f.transport !== 'stdio')) {
    return { name, transport: f.transport === 'sse' ? 'sse' : 'http', url: target, headers: parsePairs(f.pairs), inputs, oauth: Boolean(f.oauth) };
  }
  if (f.transport === 'http' || f.transport === 'sse') throw fail(tr('URL이 올바르지 않아요'));
  const parts = (target.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((x) => x.replace(/^(["'])(.*)\1$/, '$2'));
  return { name, transport: 'stdio', command: parts[0], args: parts.slice(1), env: parsePairs(f.pairs), inputs, oauth: false };
}

/**
 * Fill the placeholders with the user's answers -> { name, spec, secrets }. An optional answer left empty
 * drops what uses it (the env var / header, the argument and a `--flag` right before it).
 */
export function resolveTemplate(tpl, values = {}, { preview = false } = {}) {
  const vals = {};
  for (const i of tpl.inputs || []) {
    let v = String(values?.[i.key] ?? '').trim() || String(i.default || '').trim();
    // preview: never show a secret, and show a still-empty required value as its name
    if (preview && ((i.secret && v) || (!v && i.required))) v = `‹${i.key}›`;
    if (!v && i.required) throw fail(tr('{name}을(를) 입력해주세요', { name: i.label || i.key }));
    vals[i.key] = v;
  }
  const strings = [tpl.command, tpl.url, ...(tpl.args || []), ...Object.values(tpl.env || {}), ...Object.values(tpl.headers || {}), ...Object.keys(tpl.env || {}), ...Object.keys(tpl.headers || {})];
  const unknown = [...new Set(strings.flatMap(keysIn))].filter((k) => !(k in vals));
  if (unknown.length) throw fail(tr('채울 칸이 없는 값이 있어요: {list}', { list: unknown.map((k) => `{{${k}}}`).join(', ') }));
  const empty = (s) => keysIn(s).some((k) => !vals[k]);
  const sub = (s) => String(s ?? '').replace(PH, (m, k) => vals[k]);
  const secrets = (tpl.inputs || []).filter((i) => i.secret && vals[i.key]).map((i) => vals[i.key]);
  if (tpl.transport === 'stdio') {
    if (!tpl.command || empty(tpl.command)) throw fail(tr('실행 명령 또는 URL을 입력해주세요'));
    const args = [];
    for (const a of tpl.args || []) {
      if (empty(a)) { if (/^\s*\{\{[^}]+\}\}\s*$/.test(a) && /^--[A-Za-z0-9][\w-]*$/.test(args[args.length - 1] || '')) args.pop(); continue; }
      args.push(expandHome(sub(a)));
    }
    const env = Object.fromEntries(Object.entries(tpl.env || {}).filter(([, v]) => !empty(v)).map(([k, v]) => [k, sub(v)]));
    return { name: tpl.name, spec: { transport: 'stdio', command: expandHome(sub(tpl.command)), args, env }, secrets };
  }
  if (!tpl.url || empty(tpl.url)) throw fail(tr('실행 명령 또는 URL을 입력해주세요'));
  const url = sub(tpl.url);
  if (!/^https?:\/\/[^\s/]+/i.test(url)) throw fail(tr('URL이 올바르지 않아요'));
  const headers = Object.fromEntries(Object.entries(tpl.headers || {}).filter(([, v]) => !empty(v)).map(([k, v]) => [k, sub(v)]));
  return { name: tpl.name, spec: { transport: tpl.transport === 'sse' ? 'sse' : 'http', url, headers }, secrets };
}

/** A preset as the same template the AI writes (fields become inputs). */
function presetTemplate(p) {
  const L = lang();
  const t = p.url ? { name: p.id, transport: 'http', url: p.url, headers: {} } : { name: p.id, transport: 'stdio', command: p.command, args: [...p.args], env: {} };
  t.inputs = (p.fields || []).map((f) => ({ key: f.k, label: f.label[L] || f.label.en, secret: Boolean(f.secret), required: !f.optional, default: f.value || '', ph: f.ph || '' }));
  for (const f of p.fields || []) {
    const [kind, name, prefix = ''] = f.to.split(':');
    if (kind === 'env') t.env[name] = `{{${f.k}}}`;
    else if (kind === 'header') t.headers[name] = `${prefix}{{${f.k}}}`;
    else if (kind === 'arg') t.args.push(`{{${f.k}}}`);
  }
  t.oauth = Boolean(p.oauth);
  return t;
}

export function presets() {
  const L = lang();
  const has = { npx: Boolean(which('npx')), uvx: Boolean(which('uvx')) };
  return PRESETS.map((p) => ({
    id: p.id, name: p.name, icon: p.icon, docs: p.docs, oauth: Boolean(p.oauth), transport: p.url ? 'http' : 'stdio',
    target: p.url || [p.command, ...p.args].join(' '), desc: p.desc[L] || p.desc.en,
    needs: p.needs || null, missing: p.needs && !has[p.needs] ? p.needs : null,
    fields: (p.fields || []).map((f) => ({ k: f.k, label: f.label[L] || f.label.en, secret: Boolean(f.secret), optional: Boolean(f.optional), ph: f.ph || '', value: f.value || '' })),
    form: toForm(presetTemplate(p)),
  }));
}
/** id -> target strings, for the AI prompt (known-good servers). */
export const presetCatalog = () => PRESETS.map((p) => `${p.id}: ${p.url || [p.command, ...p.args].join(' ')}`).join('\n');

// ---------------------------------------------------------------- where it goes
/** body -> { scope: 'global' } | { scope: 'project', root, share } (share: Claude Code's team-shared .mcp.json). */
export function parseWhere(b = {}) {
  if (b.scope !== 'project') return { scope: 'global', root: null, share: false };
  return { scope: 'project', root: checkRoot(b.project), share: Boolean(b.share) };
}

function targetFile(tool, w) {
  const g = w.scope === 'global';
  if (tool === 'claude') return g || !w.share ? CLAUDE_JSON : path.join(w.root, '.mcp.json');
  if (g) return FILES[tool];
  if (tool === 'codex') return path.join(w.root, '.codex', 'config.toml');
  if (tool === 'agy') return path.join(w.root, '.agents', 'plugins', AGY_PLUGIN, 'mcp_config.json');
  if (tool === 'opencode') return path.join(w.root, 'opencode.json');
  if (tool === 'cursor') return path.join(w.root, '.cursor', 'mcp.json');
  throw fail('unsupported tool');
}

const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

/** Is `name` already configured in the exact place we'd write it? */
function existsAt(tool, w, name) {
  const file = targetFile(tool, w);
  if (tool === 'claude') {
    if (w.scope === 'global') return Boolean(readJson(CLAUDE_JSON)?.mcpServers?.[name]);
    if (!w.share) return Boolean(readJson(CLAUDE_JSON)?.projects?.[w.root]?.mcpServers?.[name]);
    return Boolean(serversOfMcpJson(readJson(file))?.[name]);
  }
  if (tool === 'codex') { const t = readText(file); try { return Boolean(t && parseToml(t).mcp_servers?.[name]); } catch { return false; } }
  if (tool === 'opencode') return Boolean(opencodeServers(readJsonc(file))[name]);
  return Boolean(serversOfMcpJson(readJson(file))?.[name]);
}

/** Nearest folder at or above `dir` (inside home) that holds .git. */
function gitRoot(dir) {
  for (let d = dir; d && d.startsWith(HOME) && d !== HOME; d = path.dirname(d)) if (fs.existsSync(path.join(d, '.git'))) return d;
  return null;
}

/** Codex loads <project>/.codex/config.toml only when the folder (or its git root) is trusted. */
export function codexTrusted(root) {
  let projects = {};
  try { projects = parseToml(readText(FILES.codex) || '').projects || {}; } catch { /* unreadable */ }
  return [root, gitRoot(root)].filter(Boolean).some((p) => projects[p]?.trust_level === 'trusted');
}

/** Mark `root` trusted in ~/.codex/config.toml (what Codex's own "trust this folder?" prompt does). */
async function setCodexTrust(root) {
  const file = FILES.codex;
  const toml = readText(file) || '';
  const lines = toml.split('\n');
  const hdr = /^\s*\[\s*projects\s*\.\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*\]\s*(#.*)?$/;
  const key = (q) => (q.startsWith('"') ? JSON.parse(q) : q.slice(1, -1));
  const at = lines.findIndex((l) => { const m = l.match(hdr); try { return m && key(m[1]) === root; } catch { return false; } });
  if (at >= 0) {
    let end = lines.findIndex((l, i) => i > at && /^\s*\[/.test(l));
    if (end < 0) end = lines.length;
    const tl = lines.findIndex((l, i) => i > at && i < end && /^\s*trust_level\s*=/.test(l));
    if (tl >= 0) lines[tl] = 'trust_level = "trusted"'; else lines.splice(at + 1, 0, 'trust_level = "trusted"');
  } else lines.push(...(toml.trim() ? [''] : []), `[projects.${JSON.stringify(root)}]`, 'trust_level = "trusted"', '');
  const next = lines.join('\n').replace(/^\n+/, '');
  if (parseToml(next).projects?.[root]?.trust_level !== 'trusted') throw fail(tr('Codex 설정에 신뢰 표시를 하지 못했어요'));
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await backup(file);
  await fsp.writeFile(file, next);
}

/** Would git pick this file up (not ignored)? -> { repo, ignored } or null when not a repo / no git. */
async function gitState(root, file) {
  if (!root || !which('git') || !gitRoot(root)) return null;
  const r = await runCli('git', ['-C', root, 'check-ignore', '-q', '--', file], { timeout: 8000 });
  return r.code === 0 ? { repo: true, ignored: true } : r.code === 1 ? { repo: true, ignored: false } : null;
}

const SHARE_NOTE = () => tr('git에 올리면 팀원도 같이 써요. Claude Code는 이 폴더에서 처음 열 때 승인할지 물어봐요');
/**
 * What adding `name` would change, per CLI. q: { tools, scope, project, share, name }
 * -> { scope, root, targets: [{ tool, file, how, note, replaces, git, trusted, error }] }
 */
export async function planInstall(q = {}) {
  const w = parseWhere(q);
  const tools = [...new Set(String(q.tools || '').split(',').concat(q.toolList || []))].filter((t) => MCP_TOOLS.includes(t));
  const name = safeName(q.name || '');
  const targets = [];
  for (const tool of tools) {
    const file = targetFile(tool, w);
    const t = { tool, file: shortHome(file), how: tool === 'claude' ? 'cli' : 'file', note: '', replaces: false, git: null, trusted: null, error: null };
    if (tool === 'claude') t.note = w.scope === 'global' ? tr('모든 폴더 (user)') : w.share ? SHARE_NOTE() : tr('이 프로젝트에서만, 나에게만 (local · git에 안 올라가요)');
    if (tool === 'claude' && !binFor('claude')) t.error = tr('Claude Code가 설치되어 있지 않아요');
    if (tool === 'opencode' && !fs.existsSync(file) && fs.existsSync(`${file}c`)) t.error = tr('opencode.jsonc를 쓰고 있어서 자동으로 바꾸지 않았어요. 직접 추가해주세요');
    if (tool === 'codex' && w.scope === 'project') {
      t.trusted = codexTrusted(w.root);
      if (!t.trusted) t.note = tr('Codex는 신뢰한 폴더에서만 프로젝트 설정을 읽어요');
    }
    if (tool === 'agy' && w.scope === 'project') t.note = tr('Antigravity 작업 공간 플러그인({name})으로 넣어요', { name: AGY_PLUGIN });
    if (name) t.replaces = existsAt(tool, w, name);
    if (w.scope === 'project' && file.startsWith(w.root + path.sep)) t.git = await gitState(w.root, file);
    targets.push(t);
  }
  return { scope: w.scope, root: w.root ? shortHome(w.root) : null, share: w.share, targets };
}

// ---------------------------------------------------------------- writers
const readJsonFile = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw fail(tr('{file}을(를) 읽지 못했어요 (JSON 형식 오류). 직접 고쳐주세요', { file: shortHome(f) })); } };
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

async function claudeCli(args, cwd) {
  const bin = binFor('claude');
  if (!bin) throw fail(tr('Claude Code가 설치되어 있지 않아요'));
  return runCli(bin, args, { timeout: 30000, cwd, env: childEnv() });
}

// ---- one server entry in each CLI's own format (the preview shows exactly what addOne writes)
const claudeScope = (w) => (w.scope === 'global' ? 'user' : w.share ? 'project' : 'local');
/** The value stored under the server's name in that CLI's config. */
export function entryFor(tool, spec, w = { scope: 'global' }) {
  const http = spec.transport !== 'stdio';
  const env = nonEmpty(spec.env), headers = nonEmpty(spec.headers);
  if (tool === 'claude') return http ? { type: spec.transport, url: spec.url, ...(headers ? { headers } : {}) } : { type: 'stdio', command: spec.command, args: spec.args || [], ...(env ? { env } : {}) };
  if (tool === 'codex') {
    if (spec.transport === 'sse') throw fail(tr('Codex는 예전 SSE 방식 서버를 지원하지 않아요 (HTTP만 돼요)'));
    return http ? { url: spec.url, ...(headers ? { http_headers: headers } : {}) } : { command: spec.command, args: spec.args || [], ...(env ? { env } : {}) };
  }
  if (tool === 'opencode') {
    // V2 files ("mcp": { "servers": … }) switch servers off with "disabled"; the older layout used "enabled".
    // Remote servers try OAuth unless told not to, which a header / key server must say.
    const v2 = opencodeV2(readJsonc(targetFile('opencode', w)));
    const on = v2 ? {} : { enabled: true };
    return http ? { type: 'remote', url: spec.url, ...on, ...(headers ? { headers, oauth: false } : {}) } : { type: 'local', command: [spec.command, ...(spec.args || [])], ...on, ...(env ? { environment: env } : {}) };
  }
  if (tool === 'agy') return http ? { serverUrl: spec.url, ...(headers ? { headers } : {}) } : { command: spec.command, args: spec.args || [], ...(env ? { env } : {}) };
  if (tool === 'cursor') return http ? { url: spec.url, ...(headers ? { headers } : {}) } : { type: 'stdio', command: spec.command, args: spec.args || [], ...(env ? { env } : {}) };
  throw fail('unsupported tool');
}
const tomlSection = (name, e) => [`[mcp_servers.${tKey(name)}]`, ...Object.entries(e).map(([k, v]) => `${k} = ${Array.isArray(v) ? `[${v.map(tStr).join(', ')}]` : typeof v === 'object' ? tInline(v) : tStr(v)}`)].join('\n');

/** What adding `name` writes for `tool`: { file, lang: 'json'|'toml', text, command? } (text is the part Baton adds). */
export function renderFor(tool, name, spec, w = { scope: 'global' }) {
  const e = entryFor(tool, spec, w);
  const file = shortHome(targetFile(tool, w));
  if (tool === 'claude') return { file, lang: 'json', text: JSON.stringify({ [name]: e }, null, 2), command: `claude mcp add-json -s ${claudeScope(w)} ${name} '${JSON.stringify(e)}'` };
  if (tool === 'codex') return { file, lang: 'toml', text: tomlSection(name, e) };
  if (tool === 'opencode') return { file, lang: 'json', text: JSON.stringify({ mcp: opencodeV2(readJsonc(targetFile('opencode', w))) ? { servers: { [name]: e } } : { [name]: e } }, null, 2) };
  return { file, lang: 'json', text: JSON.stringify({ mcpServers: { [name]: e } }, null, 2) };
}

/** Re-read a rendered entry the way that CLI's config is read and check the fields it needs. -> [problem] */
export function checkRendered(tool, r) {
  const bad = [];
  let e;
  try { e = r.lang === 'toml' ? Object.values(parseToml(r.text).mcp_servers || {})[0] : tool === 'claude' ? Object.values(JSON.parse(r.text))[0] : tool === 'opencode' ? Object.values(opencodeServers(JSON.parse(r.text)))[0] : Object.values(JSON.parse(r.text).mcpServers || {})[0]; }
  catch (x) { return [`${tool}: ${x.message}`]; }
  if (!e) return [`${tool}: empty`];
  const isUrl = (u) => /^https?:\/\/\S+$/.test(String(u || '').replace(/‹[^›]*›/g, 'x'));
  const strs = (a) => Array.isArray(a) && a.every((x) => typeof x === 'string');
  const map = (m) => m == null || (typeof m === 'object' && !Array.isArray(m) && Object.values(m).every((v) => typeof v === 'string'));
  if (tool === 'claude') {
    if (!['stdio', 'http', 'sse'].includes(e.type)) bad.push('type');
    if (e.type === 'stdio' ? !e.command || !strs(e.args) || !map(e.env) : !isUrl(e.url) || !map(e.headers)) bad.push('fields');
  } else if (tool === 'codex') {
    if (e.url ? !isUrl(e.url) || !map(e.http_headers) : !e.command || !strs(e.args) || !map(e.env)) bad.push('fields');
  } else if (tool === 'opencode') {
    if (e.type === 'local' ? !strs(e.command) || !e.command.length || !map(e.environment) : e.type !== 'remote' || !isUrl(e.url) || !map(e.headers)) bad.push('fields');
  } else {
    const url = tool === 'agy' ? e.serverUrl : e.url;
    if (url ? !isUrl(url) || !map(e.headers) : !e.command || !strs(e.args) || !map(e.env)) bad.push('fields');
  }
  return bad.map((x) => `${tool}: ${x}`);
}

async function addOne(tool, name, spec, w, { trustCodex = false } = {}) {
  const file = targetFile(tool, w);
  const e = entryFor(tool, spec, w);
  const problems = checkRendered(tool, renderFor(tool, name, spec, w));
  if (problems.length) throw fail(tr('만든 설정이 이 CLI 형식에 맞지 않아요: {list}', { list: problems.join(', ') }));
  if (tool === 'claude') {
    const scope = claudeScope(w);
    const cwd = w.root || HOME;
    if (existsAt('claude', w, name)) await claudeCli(['mcp', 'remove', '-s', scope, name], cwd);
    const r = await claudeCli(['mcp', 'add-json', '-s', scope, name, JSON.stringify(e)], cwd);
    if (r.code !== 0) throw fail((r.stderr || r.stdout || 'claude mcp add-json failed').trim().split('\n').pop());
    return file;
  }
  if (tool === 'codex') {
    const toml = readText(file) || '';
    const next = `${dropTomlServer(toml, name).replace(/\s*$/, '')}\n\n${tomlSection(name, e)}\n`.replace(/^\n+/, '');
    if (JSON.stringify(parseToml(next).mcp_servers?.[name]) !== JSON.stringify(e)) throw fail(tr('Codex 설정 파일을 안전하게 고치지 못했어요. 직접 확인해주세요'));
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await backup(file);
    await fsp.writeFile(file, next);
    if (w.scope === 'project' && trustCodex && !codexTrusted(w.root)) await setCodexTrust(w.root);
    return file;
  }
  if (tool === 'opencode') {
    if (!fs.existsSync(file) && fs.existsSync(`${file}c`)) throw fail(tr('opencode.jsonc를 쓰고 있어서 자동으로 바꾸지 않았어요. 직접 추가해주세요'));
    const cur = readJsonFile(file) || { $schema: 'https://opencode.ai/config.json' };
    if (opencodeV2(cur)) cur.mcp.servers[name] = e;
    else cur.mcp = { ...(cur.mcp || {}), [name]: e };
    await writeJson(file, cur);
    return file;
  }
  if (tool === 'agy' && w.scope === 'project') {
    const manifest = path.join(path.dirname(file), 'plugin.json');
    if (!fs.existsSync(manifest)) { await fsp.mkdir(path.dirname(manifest), { recursive: true }); await fsp.writeFile(manifest, `${JSON.stringify({ name: AGY_PLUGIN }, null, 2)}\n`); }
  }
  const cur = readJsonFile(file) || {};
  cur.mcpServers = { ...(cur.mcpServers || {}), [name]: e };
  await writeJson(file, cur);
  return file;
}

/** Write one server into every chosen CLI. -> [{ tool, ok, file, replaced, error }] */
export async function writeServer(name, spec, tools, w, opts = {}) {
  name = safeName(name);
  if (!name) throw fail(tr('서버 이름을 입력해주세요 (영어·숫자·-·_)'));
  const list = [...new Set(tools || [])].filter((t) => MCP_TOOLS.includes(t));
  if (!list.length) throw fail(tr('추가할 CLI를 하나 이상 골라주세요'));
  const results = [];
  for (const tool of list) {
    const replaced = existsAt(tool, w, name);
    try { results.push({ tool, ok: true, replaced, file: shortHome(await addOne(tool, name, spec, w, opts)) }); }
    catch (e) { results.push({ tool, ok: false, replaced, error: e.message }); }
  }
  invalidateMcp();
  return results;
}

/** Old one-shot endpoint (global only): body { preset, values, tools } | { custom: { name, target, env, headers }, tools } */
export async function addMcp(b = {}) {
  let tpl;
  if (b.preset) {
    const p = PRESETS.find((x) => x.id === b.preset);
    if (!p) throw fail('unknown preset');
    tpl = presetTemplate(p);
  } else tpl = formToTemplate({ name: b.custom?.name, target: b.custom?.target, pairs: b.custom?.env || b.custom?.headers });
  const { name, spec } = resolveTemplate(tpl, b.values);
  return { name: safeName(name), results: await writeServer(name, spec, b.tools, parseWhere({ scope: 'global' })) };
}

/**
 * Copy an existing server (by inventory id) to other CLIs, secrets included (they never reach the browser).
 * Stays in the same place as the original (a project's server is copied into the same project) unless scope='global'.
 */
export async function copyMcp(id, tools, scope = '') {
  const raw = await rawServer(id);
  if (!raw) throw fail(tr('이 서버는 복사할 수 없어요 (플러그인·회사 관리·커넥터는 원래 위치에서 관리돼요)'));
  const inProject = ['project', 'local'].includes(raw.scope) && raw.project;
  const w = inProject && scope !== 'global'
    ? { scope: 'project', root: raw.project, share: raw.tool === 'claude' && raw.scope === 'project' }
    : { scope: 'global', root: null, share: false };
  const same = (w.scope === 'global') === (raw.scope === 'user');
  const list = (tools || []).filter((t) => !(t === raw.tool && same));
  return { name: raw.name, scope: w.scope, project: w.root ? shortHome(w.root) : null, results: await writeServer(raw.name, raw.spec, list, w) };
}

/** Remove a server from the file it lives in (global or one project; Claude Code through its CLI). */
export async function removeMcp(id) {
  const s = await serverLocation(id);
  if (!s) throw fail(tr('MCP 서버를 찾을 수 없어요'));
  const mine = ['user', 'project'].includes(s.scope) && s.file;
  if (s.tool === 'claude' && ['user', 'local', 'project'].includes(s.scope)) {
    const r = await claudeCli(['mcp', 'remove', '-s', s.scope, s.name], s.project || HOME);
    if (r.code !== 0) throw fail((r.stderr || r.stdout || 'claude mcp remove failed').trim().split('\n').pop());
  } else if (mine && s.tool === 'codex' && /\.toml$/.test(s.file)) {
    const toml = await fsp.readFile(s.file, 'utf8');
    await backup(s.file);
    await fsp.writeFile(s.file, dropTomlServer(toml, s.name));
  } else if (mine && ['agy', 'cursor', 'opencode'].includes(s.tool) && /\.json$/.test(s.file)) {
    const cur = readJsonFile(s.file) || {};
    if (s.tool === 'opencode' && opencodeV2(cur)) delete cur.mcp.servers[s.name];
    else { const key = s.tool === 'opencode' ? 'mcp' : 'mcpServers'; if (cur[key]) delete cur[key][s.name]; }
    await writeJson(s.file, cur);
  } else throw fail(tr('이 위치의 서버는 여기서 지울 수 없어요. 설정 파일에서 직접 지워주세요'));
  invalidateMcp();
  return { ok: true };
}

/** body: { form, values, tools, scope, project, share } -> { name, items: [{ tool, file, lang, text, command?, problems, error }] } (secrets masked) */
export function previewInstall(b = {}) {
  const w = parseWhere(b);
  const tpl = formToTemplate(b.form);
  const { name, spec } = resolveTemplate(tpl, b.values || {}, { preview: true });
  // a secret typed straight into the env / header lines is masked too
  const mask = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, /(token|secret|password|passwd|api[-_]?key|apikey|authorization|credential|cookie)/i.test(k) && !/‹/.test(v) ? '•••' : v]));
  const shown = spec.transport === 'stdio' ? { ...spec, env: mask(spec.env) } : { ...spec, headers: mask(spec.headers) };
  const tools = [...new Set([].concat(b.tools || []))].filter((t) => MCP_TOOLS.includes(t));
  return {
    name, items: tools.map((tool) => {
      try { const r = renderFor(tool, name, shown, w); return { tool, ...r, problems: checkRendered(tool, r), error: null }; }
      catch (e) { return { tool, file: null, error: e.message, problems: [] }; }
    }),
  };
}
