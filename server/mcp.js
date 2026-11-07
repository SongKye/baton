// MCP servers each CLI can see — where they are configured (global / project / local / plugin / managed),
// whether they are on, and which ones agents actually called (usage records come from usage.js).
//   Claude Code  ~/.claude.json mcpServers (user) · projects[path].mcpServers (local) · <dir>/.mcp.json (project)
//                plugins' .mcp.json / plugin.json · managed-mcp.json · claude.ai connectors (seen via `claude mcp list`)
//   Codex        ~/.codex/config.toml [mcp_servers.*] · <dir>/.codex/config.toml
//   Antigravity  ~/.gemini/config/mcp_config.json · plugins/<name>/mcp_config.json
//   OpenCode     ~/.config/opencode/opencode.json(c) "mcp" · <dir>/opencode.json(c)
//   Cursor       ~/.cursor/mcp.json · <dir>/.cursor/mcp.json
// Secrets never leave this module: env / header values are dropped (keys only) and token-looking args/URL params are masked.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HOME, shortHome } from './util.js';
import { projectsList } from './indexer.js';
import { mcpUses } from './usage.js';
import { tr } from './i18n.js';
import { CLAUDE_HOME, CODEX_HOME } from './env.js';
import { getKV, setKV } from './store.js';
import { runCli, IS_WIN, IS_MAC } from './platform.js';
import { binFor } from './tools.js';
import { childEnv } from './runner.js';

const XDG_CONFIG = process.env.XDG_CONFIG_HOME || path.join(HOME, '.config');
const CLAUDE_JSON = process.env.CLAUDE_CONFIG_DIR ? path.join(CLAUDE_HOME, '.claude.json') : path.join(HOME, '.claude.json');
const MANAGED = IS_WIN ? 'C:\\Program Files\\ClaudeCode\\managed-mcp.json'
  : IS_MAC ? '/Library/Application Support/ClaudeCode/managed-mcp.json' : '/etc/claude-code/managed-mcp.json';
const AGY_CONFIG = path.join(HOME, '.gemini', 'config');

// ---------------------------------------------------------------- file readers (mtime-cached)
const fileCache = new Map();
function cached(file, parse) {
  let st;
  try { st = fs.statSync(file); } catch { fileCache.delete(file); return null; }
  const hit = fileCache.get(file);
  if (hit && hit.m === st.mtimeMs && hit.s === st.size) return hit.v;
  let v = null;
  try { v = parse(fs.readFileSync(file, 'utf8')); } catch { v = null; }
  fileCache.set(file, { m: st.mtimeMs, s: st.size, v });
  return v;
}
const readJson = (f) => cached(f, (t) => JSON.parse(t));
/** JSON with comments / trailing commas (opencode.jsonc, VS Code-style files). */
const readJsonc = (f) => cached(f, (t) => JSON.parse(stripJsonc(t)));
function stripJsonc(t) {
  let out = '', i = 0, str = false;
  while (i < t.length) {
    const c = t[i];
    if (str) { out += c; if (c === '\\') { out += t[i + 1] || ''; i += 2; continue; } if (c === '"') str = false; i++; continue; }
    if (c === '"') { str = true; out += c; i++; continue; }
    if (c === '/' && t[i + 1] === '/') { while (i < t.length && t[i] !== '\n') i++; continue; }
    if (c === '/' && t[i + 1] === '*') { i = t.indexOf('*/', i + 2); i = i < 0 ? t.length : i + 2; continue; }
    out += c; i++;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}
const readToml = (f) => cached(f, parseToml);

/** Small TOML reader: tables, dotted/quoted keys, strings, numbers, booleans, (multi-line) arrays, inline tables. */
export function parseToml(text) {
  const root = {};
  let cur = root;
  let i = 0;
  const n = text.length;
  const ws = () => { while (i < n && (text[i] === ' ' || text[i] === '\t')) i++; };
  const wsnl = () => {
    for (;;) {
      while (i < n && /\s/.test(text[i])) i++;
      if (text[i] === '#') { while (i < n && text[i] !== '\n') i++; continue; }
      break;
    }
  };
  const str = () => {
    const q = text[i];
    if (text.startsWith(q.repeat(3), i)) {
      i += 3;
      if (text[i] === '\n') i++;
      const end = text.indexOf(q.repeat(3), i);
      const raw = text.slice(i, end < 0 ? n : end);
      i = end < 0 ? n : end + 3;
      return q === '"' ? unescape(raw) : raw;
    }
    i++;
    let s = '';
    while (i < n && text[i] !== q && text[i] !== '\n') {
      if (q === '"' && text[i] === '\\') { s += text.slice(i, i + 2); i += 2; continue; }
      s += text[i++];
    }
    i++;
    return q === '"' ? unescape(s) : s;
  };
  const unescape = (s) => s.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (m, e) => {
    if (e[0] === 'u' || e[0] === 'U') return String.fromCodePoint(parseInt(e.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', b: '\b', f: '\f' }[e] ?? e;
  });
  const key = () => {
    const parts = [];
    for (;;) {
      ws();
      if (text[i] === '"' || text[i] === "'") parts.push(str());
      else { const m = /^[A-Za-z0-9_-]+/.exec(text.slice(i, i + 200)); if (!m) break; parts.push(m[0]); i += m[0].length; }
      ws();
      if (text[i] === '.') { i++; continue; }
      break;
    }
    return parts;
  };
  const value = () => {
    ws();
    const c = text[i];
    if (c === '"' || c === "'") return str();
    if (c === '[') {
      i++;
      const arr = [];
      for (;;) {
        wsnl();
        if (text[i] === ']') { i++; break; }
        if (i >= n) break;
        arr.push(value());
        wsnl();
        if (text[i] === ',') i++;
      }
      return arr;
    }
    if (c === '{') {
      i++;
      const obj = {};
      for (;;) {
        ws();
        if (text[i] === '}') { i++; break; }
        if (i >= n || text[i] === '\n') break;
        const k = key();
        ws(); if (text[i] === '=') i++;
        setPath(obj, k, value());
        ws();
        if (text[i] === ',') i++;
      }
      return obj;
    }
    const m = /^[^,\]}\n#]+/.exec(text.slice(i, i + 200));
    const raw = (m ? m[0] : '').trim();
    i += m ? m[0].length : 0;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    const num = Number(raw.replace(/_/g, ''));
    return raw !== '' && !Number.isNaN(num) ? num : raw;
  };
  const setPath = (obj, parts, v) => {
    let o = obj;
    for (const p of parts.slice(0, -1)) o = (o[p] && typeof o[p] === 'object') ? o[p] : (o[p] = {});
    o[parts[parts.length - 1]] = v;
  };
  const table = (parts, arr) => {
    let o = root;
    parts.forEach((p, idx) => {
      const last = idx === parts.length - 1;
      if (last && arr) { if (!Array.isArray(o[p])) o[p] = []; const t = {}; o[p].push(t); o = t; return; }
      if (Array.isArray(o[p])) o = o[p][o[p].length - 1];
      else o = (o[p] && typeof o[p] === 'object') ? o[p] : (o[p] = {});
    });
    return o;
  };
  while (i < n) {
    wsnl();
    if (i >= n) break;
    if (text[i] === '[') {
      const arr = text[i + 1] === '[';
      i += arr ? 2 : 1;
      const k = key();
      i += arr ? 2 : 1;
      cur = table(k, arr);
    } else {
      const k = key();
      ws();
      if (!k.length || text[i] !== '=') { while (i < n && text[i] !== '\n') i++; continue; }
      i++;
      setPath(cur, k, value());
    }
    ws();
    if (text[i] === '#') while (i < n && text[i] !== '\n') i++;
  }
  return root;
}

// ---------------------------------------------------------------- redaction
const SECRET_NAME = /(token|secret|password|passwd|api[-_]?key|apikey|access[-_]?key|private[-_]?key|auth|bearer|credential|cookie|session|signature|sig)$/i;
const SECRET_NAME_ANY = /(token|secret|password|passwd|api[-_]?key|apikey|access[-_]?key|private[-_]?key|bearer|credential|cookie)/i;
const looksSecret = (v) => /^(sk-|sk_|pk_live|rk_|ghp_|gho_|ghs_|github_pat_|glpat-|xox[abposr]-|AKIA|ASIA|AIza|ya29\.|eyJ[\w-]{10,}\.)/.test(v)
  || (/^[A-Za-z0-9_\-+/=.]{32,}$/.test(v) && /\d/.test(v) && /[A-Za-z]/.test(v) && !v.includes('/'));
const MASK = '•••';
export function redactArg(a, prev) {
  a = String(a);
  const kv = a.match(/^(--?[\w.-]+)=(.*)$/);
  if (kv) return SECRET_NAME_ANY.test(kv[1]) || looksSecret(kv[2]) ? `${kv[1]}=${MASK}` : `${kv[1]}=${redactInline(kv[2])}`;
  if (prev && /^--?[\w.-]+$/.test(prev) && SECRET_NAME_ANY.test(prev)) return MASK;
  if (/^[A-Z][A-Z0-9_]*=/.test(a)) { const [k, ...v] = a.split('='); return SECRET_NAME_ANY.test(k) || looksSecret(v.join('=')) ? `${k}=${MASK}` : a; }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(a)) return redactUrl(a); // https://, postgres://user:pw@…, redis://…
  return looksSecret(a) ? MASK : redactInline(a);
}
const redactInline = (s) => String(s).replace(/((?:token|key|secret|password|auth)["']?\s*[:=]\s*["']?)([^"'\s,&]{6,})/gi, `$1${MASK}`);
export function redactUrl(u) {
  try {
    const url = new URL(u);
    if (url.password) url.password = MASK;
    if (url.username && looksSecret(url.username)) url.username = MASK;
    for (const [k, v] of [...url.searchParams]) if (SECRET_NAME.test(k) || SECRET_NAME_ANY.test(k) || looksSecret(v)) url.searchParams.set(k, MASK);
    return decodeURI(url.toString()).replace(/%E2%80%A2/g, '•');
  } catch { return redactInline(u); }
}

// ---------------------------------------------------------------- server normalisation
/** Claude Code tool names are mcp__<server>__<tool> with the server name squashed to [A-Za-z0-9_-]. */
export const normName = (s) => String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_');

function entry(name, raw, base) {
  if (!raw || typeof raw !== 'object') return null;
  const plugRoot = base.pluginRoot;
  const sub = (v) => (plugRoot && typeof v === 'string' ? v.replaceAll('${CLAUDE_PLUGIN_ROOT}', plugRoot) : v);
  let command = raw.command, args = raw.args || [];
  if (Array.isArray(command)) { args = command.slice(1); command = command[0]; } // opencode: command: ["npx", "-y", "x"]
  const url = raw.url || raw.serverUrl || raw.httpUrl || null;
  let transport = raw.type || raw.transport || (url ? 'http' : command ? 'stdio' : '?');
  if (transport === 'local') transport = 'stdio';
  if (transport === 'remote') transport = 'http';
  if (transport === 'streamable-http' || transport === 'streamable_http') transport = 'http';
  const env = raw.env || raw.environment || {};
  const headers = raw.headers || raw.http_headers || {};
  const envKeys = [...Object.keys(env || {}), ...[].concat(raw.env_vars || [])];
  const headerKeys = [...Object.keys(headers || {}), ...Object.keys(raw.env_http_headers || {})];
  if (raw.bearer_token_env_var) headerKeys.push(`Authorization ← $${raw.bearer_token_env_var}`);
  let enabled = true, why = null;
  if (raw.enabled === false || raw.disabled === true) { enabled = false; why = tr('설정에서 꺼져 있어요'); }
  const argList = [].concat(args || []).map((a, idx, all) => redactArg(sub(a), all[idx - 1]));
  return {
    ...base, name, transport,
    command: command ? shortHome(sub(String(command))) : null,
    args: argList.map((a) => shortHome(a)),
    url: url ? redactUrl(sub(String(url))) : null,
    envKeys, headerKeys, enabled, why,
    oauth: Boolean(raw.oauth || raw.auth),
    toolsAllow: raw.enabled_tools || raw.includeTools || null,
    toolsDeny: raw.disabled_tools || raw.excludeTools || null,
    pluginRoot: undefined,
  };
}
function entriesOf(map, base) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
  return Object.entries(map).map(([n, raw]) => entry(n, raw, base)).filter(Boolean);
}
/** .mcp.json is either { mcpServers: {...} } or the bare map. */
const serversOfMcpJson = (j) => (j && typeof j === 'object' ? (j.mcpServers && typeof j.mcpServers === 'object' ? j.mcpServers : (Object.values(j).every((v) => v && typeof v === 'object' && (v.command || v.url || v.type)) ? j : {})) : {});

// ---------------------------------------------------------------- scopes
const L = {
  user: () => tr('내 전역 (모든 폴더)'),
  managed: () => tr('회사 관리 (managed)'),
  plugin: (n) => tr('플러그인 · {name}', { name: n }),
  cloud: () => tr('claude.ai 커넥터'),
  builtin: () => tr('CLI 내장'),
  project: (n) => tr('프로젝트 · {name}', { name: n }),
  local: (n) => tr('프로젝트 · {name} (나만)', { name: n }),
  unlisted: () => tr('설정에서 찾지 못한 서버'),
};

function claudeJson() { return readJson(CLAUDE_JSON) || {}; }
function claudeSettings(dir) {
  const files = [path.join(CLAUDE_HOME, 'settings.json')];
  if (dir) files.push(path.join(dir, '.claude', 'settings.json'), path.join(dir, '.claude', 'settings.local.json'));
  const out = { enabledPlugins: {}, enableAll: false, enabled: [], disabled: [] };
  for (const f of files) {
    const j = readJson(f);
    if (!j) continue;
    Object.assign(out.enabledPlugins, j.enabledPlugins || {});
    if (j.enableAllProjectMcpServers) out.enableAll = true;
    out.enabled.push(...(j.enabledMcpjsonServers || []));
    out.disabled.push(...(j.disabledMcpjsonServers || []));
  }
  return out;
}

/** Servers that apply everywhere (not tied to a folder). */
function globalServers() {
  const out = [];
  // ---- Claude Code
  const cj = claudeJson();
  out.push(...entriesOf(cj.mcpServers, { tool: 'claude', scope: 'user', scopeLabel: L.user(), file: CLAUDE_JSON }));
  out.push(...entriesOf(serversOfMcpJson(readJson(MANAGED)), { tool: 'claude', scope: 'managed', scopeLabel: L.managed(), file: MANAGED }));
  const enabledPlugins = claudeSettings(null).enabledPlugins;
  const installed = readJson(path.join(CLAUDE_HOME, 'plugins', 'installed_plugins.json'))?.plugins || {};
  for (const [pid, ents] of Object.entries(installed)) {
    for (const ent of [].concat(ents)) {
      if (!ent?.installPath) continue;
      const plugin = pid.split('@')[0];
      const base = { tool: 'claude', scope: 'plugin', scopeLabel: L.plugin(plugin), pluginRoot: ent.installPath, plugin: pid };
      const on = enabledPlugins[pid] !== false;
      const off = (s) => (on ? s : { ...s, enabled: false, why: tr('플러그인이 꺼져 있어요') });
      const mj = path.join(ent.installPath, '.mcp.json');
      out.push(...entriesOf(serversOfMcpJson(readJson(mj)), { ...base, file: mj }).map(off));
      const pj = path.join(ent.installPath, '.claude-plugin', 'plugin.json');
      const ms = readJson(pj)?.mcpServers;
      if (typeof ms === 'string') { const f = path.resolve(ent.installPath, ms); out.push(...entriesOf(serversOfMcpJson(readJson(f)), { ...base, file: f }).map(off)); }
      else if (ms) out.push(...entriesOf(ms, { ...base, file: pj }).map(off));
    }
  }
  // claude.ai connectors and other servers only the CLI knows about, from the last `claude mcp list`
  const health = getKV('mcp_health_global', null);
  for (const h of health?.claude?.servers || []) {
    if (!/^claude\.ai /.test(h.name)) continue;
    out.push({ tool: 'claude', scope: 'cloud', scopeLabel: L.cloud(), file: null, name: h.name, transport: 'http', command: null, args: [], url: h.target ? redactUrl(h.target) : null, envKeys: [], headerKeys: [], enabled: true, why: null });
  }
  // ---- Codex
  const cx = path.join(CODEX_HOME, 'config.toml');
  out.push(...entriesOf(readToml(cx)?.mcp_servers, { tool: 'codex', scope: 'user', scopeLabel: L.user(), file: cx }));
  // ---- Antigravity
  const ag = path.join(AGY_CONFIG, 'mcp_config.json');
  out.push(...entriesOf(serversOfMcpJson(readJson(ag)), { tool: 'agy', scope: 'user', scopeLabel: L.user(), file: ag }));
  out.push(...agyPlugins(path.join(AGY_CONFIG, 'plugins')));
  // ---- OpenCode
  for (const f of ['opencode.json', 'opencode.jsonc', 'config.json']) {
    const p = path.join(XDG_CONFIG, 'opencode', f);
    out.push(...entriesOf(readJsonc(p)?.mcp, { tool: 'opencode', scope: 'user', scopeLabel: L.user(), file: p }));
  }
  // ---- Cursor
  const cu = path.join(HOME, '.cursor', 'mcp.json');
  out.push(...entriesOf(serversOfMcpJson(readJson(cu)), { tool: 'cursor', scope: 'user', scopeLabel: L.user(), file: cu }));
  return out;
}

function agyPlugins(dir, base = {}) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const n of names) {
    const f = path.join(dir, n, 'mcp_config.json');
    out.push(...entriesOf(serversOfMcpJson(readJson(f)), { tool: 'agy', scope: 'plugin', scopeLabel: L.plugin(n), file: f, ...base }));
  }
  return out;
}

/** Servers configured by files inside one folder (not its parents). `label` names the project for the UI. */
function folderServers(dir, label) {
  const out = [];
  const base = { scope: 'project', scopeLabel: L.project(label), project: dir };
  // ---- Claude Code: .mcp.json (shared, needs approval) + local scope in ~/.claude.json
  const mj = path.join(dir, '.mcp.json');
  const cjp = claudeJson().projects?.[dir] || {};
  const st = claudeSettings(dir);
  const approved = new Set([...(cjp.enabledMcpjsonServers || []), ...st.enabled]);
  const rejected = new Set([...(cjp.disabledMcpjsonServers || []), ...st.disabled]);
  for (const s of entriesOf(serversOfMcpJson(readJson(mj)), { ...base, tool: 'claude', file: mj })) {
    if (rejected.has(s.name)) out.push({ ...s, enabled: false, why: tr('이 프로젝트에서 거절했어요') });
    else if (approved.has(s.name) || st.enableAll) out.push(s);
    else out.push({ ...s, enabled: 'pending', why: tr('아직 승인하지 않았어요 — 터미널에서 claude를 열면 물어봐요') });
  }
  out.push(...entriesOf(cjp.mcpServers, { ...base, tool: 'claude', scope: 'local', scopeLabel: L.local(label), file: CLAUDE_JSON }));
  // ---- Codex
  const cx = path.join(dir, '.codex', 'config.toml');
  if (cx !== path.join(CODEX_HOME, 'config.toml')) out.push(...entriesOf(readToml(cx)?.mcp_servers, { ...base, tool: 'codex', file: cx }));
  // ---- Antigravity (workspace plugins)
  for (const root of ['.agents', '.agent']) out.push(...agyPlugins(path.join(dir, root, 'plugins'), { scopeLabel: L.project(label), scope: 'project', project: dir }));
  // ---- OpenCode
  for (const f of ['opencode.json', 'opencode.jsonc', path.join('.opencode', 'opencode.json')]) {
    const p = path.join(dir, f);
    out.push(...entriesOf(readJsonc(p)?.mcp, { ...base, tool: 'opencode', file: p }));
  }
  // ---- Cursor
  const cu = path.join(dir, '.cursor', 'mcp.json');
  if (cu !== path.join(HOME, '.cursor', 'mcp.json')) out.push(...entriesOf(serversOfMcpJson(readJson(cu)), { ...base, tool: 'cursor', file: cu }));
  // servers switched off with /mcp in this folder
  const off = new Set(cjp.disabledMcpServers || []);
  return out.map((s) => (s.tool === 'claude' && off.has(s.name) && s.enabled === true ? { ...s, enabled: false, why: tr('이 폴더에서 /mcp로 꺼 두었어요') } : s));
}

const sid = (s) => Buffer.from(`${s.tool}|${s.scope}|${s.file || ''}|${s.project || ''}|${s.name}`).toString('base64url');
const nameOf = (root, projects) => projects.find((p) => p.id === root)?.name || path.basename(root) || root;
const under = (cwd, dir) => Boolean(cwd && dir && (cwd === dir || cwd.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep)));

/** Everything configured anywhere Baton knows about (global + every project + every Claude local scope). */
async function inventory() {
  const projects = await projectsList();
  const all = globalServers();
  const roots = new Set(projects.map((p) => p.id).filter((r) => r && r !== HOME));
  for (const [dir, v] of Object.entries(claudeJson().projects || {})) if (v?.mcpServers && Object.keys(v.mcpServers).length) roots.add(dir);
  for (const r of roots) all.push(...folderServers(r, nameOf(r, projects)));
  const seen = new Set();
  return all.filter((s) => { const k = sid(s); return seen.has(k) ? false : seen.add(k); });
}

// ---------------------------------------------------------------- usage join
function builtinFor(tool, server) {
  if (tool === 'claude' && /^claude_ai_/.test(server)) return { scope: 'cloud', scopeLabel: L.cloud(), name: `claude.ai ${server.slice(10).replace(/_/g, ' ')}` };
  if (tool === 'claude' && server === 'claude-in-chrome') return { scope: 'builtin', scopeLabel: L.builtin(), name: 'Claude in Chrome' };
  if (tool === 'codex' && server === 'codex_apps') return { scope: 'builtin', scopeLabel: L.builtin(), name: tr('ChatGPT 앱 커넥터') };
  return null;
}

function attachUses(servers, uses) {
  const list = servers.map((s) => ({ ...s, id: sid(s), uses: 0, lastUsed: null, tools: {}, sessions: [] }));
  const extra = new Map();
  for (const u of uses) {
    // u: { tool, server, name (tool name), ts, cwd, session }
    const cands = list.filter((s) => s.tool === u.tool && (normName(s.name) === u.server || s.name === u.server));
    let s = cands.find((x) => x.project && under(u.cwd, x.project) && x.scope === 'local')
      || cands.find((x) => x.project && under(u.cwd, x.project))
      || cands.find((x) => !x.project);
    if (!s) {
      const k = `${u.tool}:${u.server}`;
      s = extra.get(k);
      if (!s) {
        const b = builtinFor(u.tool, u.server) || { scope: 'unlisted', scopeLabel: L.unlisted(), name: u.server };
        s = { tool: u.tool, file: null, transport: b.scope === 'cloud' ? 'http' : null, command: null, args: [], url: null, envKeys: [], headerKeys: [], enabled: true, why: null, ...b, uses: 0, lastUsed: null, tools: {}, sessions: [] };
        s.id = sid(s);
        extra.set(k, s);
      }
    }
    s.uses++;
    s.tools[u.name] = (s.tools[u.name] || 0) + 1;
    if (!s.lastUsed || u.ts > s.lastUsed) s.lastUsed = u.ts;
    const ex = s.sessions.find((x) => x.key === u.session);
    if (ex) { ex.n++; ex.ts = Math.max(ex.ts, u.ts); } else s.sessions.push({ key: u.session, ts: u.ts, n: 1, cwd: u.cwd });
  }
  return [...list, ...extra.values()];
}

function publicServer(s, { sessions = 12 } = {}) {
  return {
    ...s,
    fileShort: s.file ? shortHome(s.file) : null,
    projectShort: s.project ? shortHome(s.project) : null,
    tools: Object.entries(s.tools || {}).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
    sessions: (s.sessions || []).sort((a, b) => b.ts - a.ts).slice(0, sessions),
    status: liveStatus(s),
  };
}

// ---------------------------------------------------------------- live status (Baton runs + `claude mcp list`)
/** Called by the runner when a Claude run starts: init lists every MCP server and whether it connected. */
export function noteMcpStatus(tool, cwd, servers) {
  if (!cwd || !Array.isArray(servers)) return;
  const at = Date.now();
  const map = getKV('mcp_status', {}) || {};
  const k = `${tool}|${cwd}`;
  map[k] = { at, servers: servers.map((x) => ({ name: x.name, status: normStatus(x.status) })) };
  // keep the 200 most recent folders
  const keys = Object.keys(map).sort((a, b) => map[b].at - map[a].at);
  for (const x of keys.slice(200)) delete map[x];
  setKV('mcp_status', map);
}
const normStatus = (s) => {
  s = String(s || '').toLowerCase();
  if (/^(connected|ok|ready|✔|✓)/.test(s)) return 'ok';
  if (/auth/.test(s)) return 'auth';
  if (/pending|connecting|starting/.test(s)) return 'pending';
  if (/fail|error|✗|✘|disconnected/.test(s)) return 'fail';
  return 'unknown';
};
function statusMapFor(tool, cwd) {
  const map = getKV('mcp_status', {}) || {};
  const health = getKV('mcp_health', {}) || {};
  const out = new Map();
  const add = (rec) => { for (const x of rec?.servers || []) { const cur = out.get(x.name); if (!cur || rec.at > cur.at) out.set(x.name, { status: x.status, at: rec.at, detail: x.detail || null }); } };
  add(map[`${tool}|${cwd}`]);
  add(health[`${tool}|${cwd}`]);
  return out;
}
// last known status anywhere (for the global list)
function liveStatus(s) {
  const map = getKV('mcp_status', {}) || {};
  const health = getKV('mcp_health', {}) || {};
  let best = null;
  for (const [k, rec] of [...Object.entries(map), ...Object.entries(health)]) {
    const [tool, cwd] = k.split(/\|(.+)/);
    if (tool !== s.tool) continue;
    if (s.project && !under(cwd, s.project)) continue;
    const x = rec.servers.find((y) => y.name === s.name);
    if (x && (!best || rec.at > best.at)) best = { status: x.status, at: rec.at, detail: x.detail || null, cwd };
  }
  return best;
}

/** Ask the CLI itself which servers it loads in a folder and whether they connect. Claude only (others have no health check). */
export async function checkMcp(tool, cwd) {
  if (tool !== 'claude') return { supported: false };
  const bin = binFor('claude');
  if (!bin) return { supported: false, error: tr('Claude Code가 설치되어 있지 않아요') };
  const dir = cwd && fs.existsSync(cwd) ? cwd : HOME;
  const r = await runCli(bin, ['mcp', 'list'], { cwd: dir, timeout: 60000, env: childEnv() });
  const servers = [];
  for (const line of (r.stdout || '').split('\n')) {
    const m = line.match(/^(.+?):\s+(.*?)\s+-\s+(✔|✓|✗|✘|⚠|!|…|⏳)?\s*(.+)$/u);
    if (!m) continue;
    const icon = m[3] || '';
    const status = /[✔✓]/u.test(icon) ? 'ok' : /[✗✘]/u.test(icon) ? 'fail' : normStatus(m[4]);
    servers.push({ name: m[1].trim(), target: m[2].trim(), status, detail: m[4].trim() });
  }
  if (r.code !== 0 && !servers.length) return { supported: true, error: (r.stderr || r.stdout || 'failed').trim().split('\n').slice(-1)[0] };
  const at = Date.now();
  const health = getKV('mcp_health', {}) || {};
  health[`${tool}|${dir}`] = { at, servers: servers.map((x) => ({ ...x, target: undefined })) };
  for (const x of Object.keys(health).sort((a, b) => health[b].at - health[a].at).slice(200)) delete health[x];
  setKV('mcp_health', health);
  const g = getKV('mcp_health_global', {}) || {};
  g[tool] = { at, servers: servers.filter((x) => /^claude\.ai /.test(x.name)).map((x) => ({ name: x.name, target: x.target, status: x.status })) };
  setKV('mcp_health_global', g);
  return { supported: true, at, cwd: dir, servers: servers.map((x) => ({ ...x, target: /^https?:/.test(x.target) ? redactUrl(x.target) : x.target.split(/\s+/).map((a, i, all) => redactArg(a, all[i - 1])).join(' ') })) };
}

// ---------------------------------------------------------------- reports
let invCache = { at: 0, list: [] };
async function inv() {
  if (Date.now() - invCache.at > 30_000) invCache = { at: Date.now(), list: await inventory() };
  return invCache.list;
}

export async function mcpReport() {
  const list = attachUses(await inv(), await mcpUses());
  return { servers: list.map((s) => publicServer(s)), scannedAt: invCache.at, tracked: ['claude', 'codex'] };
}

export async function mcpDetail(id) {
  const list = attachUses(await inv(), await mcpUses());
  const s = list.find((x) => x.id === id);
  if (!s) return null;
  // same name configured elsewhere (overrides / duplicates across scopes)
  const twins = list.filter((x) => x.id !== id && x.tool === s.tool && x.name === s.name).map((x) => ({ id: x.id, scopeLabel: x.scopeLabel, fileShort: x.file ? shortHome(x.file) : null }));
  return { ...publicServer(s, { sessions: 30 }), twins };
}

/** Which servers a CLI loads when it works in `cwd` (closest scope wins), plus what this folder / session used. */
export async function mcpEffective({ cwd, tools, session }) {
  const projects = await projectsList();
  const dirs = [];
  if (cwd) {
    let d = path.resolve(cwd);
    for (;;) {
      dirs.push(d);
      const up = path.dirname(d);
      if (up === d || d === HOME || d === os.homedir()) break;
      d = up;
    }
  }
  const glob = globalServers();
  const folder = dirs.flatMap((d) => folderServers(d, nameOf(d, projects)))
    // a Claude local scope only applies to the exact folder it was added in; .mcp.json is read from parents too
    .filter((s) => s.scope !== 'local' || s.project === cwd);
  const uses = await mcpUses();
  const root = projects.find((p) => under(cwd, p.id) && p.id !== HOME)?.id || cwd;
  const here = uses.filter((u) => under(u.cwd, root));
  const out = {};
  for (const tool of tools) {
    // closest wins: local > project (nearest dir first) > user > plugin/managed/cloud
    const rank = { local: 0, project: 1, user: 2, plugin: 3, managed: 4, cloud: 5, builtin: 6 };
    const mine = [...folder, ...glob].filter((s) => s.tool === tool)
      .sort((a, b) => (rank[a.scope] - rank[b.scope]) || (dirs.indexOf(a.project) - dirs.indexOf(b.project)));
    const byName = new Map();
    const shadowed = [];
    for (const s of mine) { if (byName.has(s.name)) shadowed.push({ ...s, enabled: false, why: tr('{scope} 설정에 가려졌어요', { scope: byName.get(s.name).scopeLabel }) }); else byName.set(s.name, s); }
    const joined = attachUses([...byName.values(), ...shadowed], here.filter((u) => u.tool === tool));
    const status = statusMapFor(tool, cwd);
    const list = joined.map((s) => {
      const p = publicServer(s, { sessions: 0 });
      const inSession = session ? (s.sessions || []).filter((x) => x.key === session).reduce((a, x) => a + x.n, 0) : 0;
      return { ...p, status: status.get(s.name) || null, sessionUses: inSession };
    });
    // servers the CLI reported (claude.ai connectors, built-ins) that no file mentions
    for (const [name, st] of status) {
      if (list.some((x) => x.name === name)) continue;
      const b = /^claude\.ai /.test(name) ? { scope: 'cloud', scopeLabel: L.cloud() } : { scope: 'unlisted', scopeLabel: L.unlisted() };
      const s = { tool, name, ...b, file: null, transport: 'http', command: null, args: [], url: null, envKeys: [], headerKeys: [], enabled: true, why: null };
      list.push({ ...s, id: sid(s), uses: 0, lastUsed: null, tools: [], sessions: [], status: st, sessionUses: 0 });
    }
    const order = { true: 0, pending: 1, false: 2 };
    list.sort((a, b) => (order[a.enabled] - order[b.enabled]) || (b.sessionUses - a.sessionUses) || (b.uses - a.uses) || (rank[a.scope] ?? 9) - (rank[b.scope] ?? 9) || a.name.localeCompare(b.name));
    const checked = [...status.values()].reduce((m, x) => Math.max(m, x.at), 0) || null;
    out[tool] = { servers: list, checkedAt: checked, tracked: tool === 'claude' || tool === 'codex' };
  }
  return { cwd, root, tools: out };
}

/** Names of the MCP servers `tool` loads in `cwd` (global + every parent folder's config), for the @ picker.
 *  Same rules as mcpEffective but without the usage scan, so it answers instantly. */
export function mcpForPicker(tool, cwd) {
  const dirs = [];
  for (let d = path.resolve(cwd); ; d = path.dirname(d)) {
    dirs.push(d);
    if (path.dirname(d) === d || d === HOME || d === os.homedir()) break;
  }
  const rank = { local: 0, project: 1, user: 2, plugin: 3, managed: 4, cloud: 5, builtin: 6 };
  const mine = [...dirs.flatMap((d) => folderServers(d, path.basename(d))).filter((s) => s.scope !== 'local' || s.project === cwd), ...globalServers()]
    .filter((s) => s.tool === tool)
    .sort((a, b) => (rank[a.scope] - rank[b.scope]) || (dirs.indexOf(a.project) - dirs.indexOf(b.project)));
  const byName = new Map();
  for (const s of mine) if (!byName.has(s.name)) byName.set(s.name, s); // closest config wins, like the CLI
  for (const [name] of statusMapFor(tool, cwd)) if (!byName.has(name)) byName.set(name, { name, scope: /^claude\.ai /.test(name) ? 'cloud' : 'unlisted', enabled: true });
  return [...byName.values()].filter((s) => s.enabled === true).map((s) => ({ name: s.name, scope: s.scope })).sort((a, b) => a.name.localeCompare(b.name));
}

export function invalidateMcp() { invCache.at = 0; }

/**
 * The unredacted config of one server, normalised to { transport, command, args, env, url, headers } —
 * for copying it to another CLI. Server-side only: never send this to the browser (it holds secrets).
 */
export async function rawServer(id) {
  const s = (await inv()).find((x) => sid(x) === id);
  if (!s || !s.file || !['user', 'project', 'local'].includes(s.scope)) return null;
  let raw = null;
  if (s.tool === 'claude' && s.file === CLAUDE_JSON) raw = s.scope === 'local' ? claudeJson().projects?.[s.project]?.mcpServers?.[s.name] : claudeJson().mcpServers?.[s.name];
  else if (s.tool === 'codex') raw = readToml(s.file)?.mcp_servers?.[s.name];
  else if (s.tool === 'opencode') raw = readJsonc(s.file)?.mcp?.[s.name];
  else raw = serversOfMcpJson(readJson(s.file))?.[s.name];
  if (!raw || typeof raw !== 'object') return null;
  let command = raw.command || null, args = raw.args || [];
  if (Array.isArray(command)) { args = command.slice(1); command = command[0]; }
  const url = raw.url || raw.serverUrl || raw.httpUrl || null;
  const env = { ...(raw.env || raw.environment || {}) };
  for (const k of [].concat(raw.env_vars || [])) if (process.env[k] && !(k in env)) env[k] = process.env[k];
  const headers = { ...(raw.headers || raw.http_headers || {}) };
  for (const [h, v] of Object.entries(raw.env_http_headers || {})) if (process.env[v]) headers[h] = process.env[v];
  if (raw.bearer_token_env_var && process.env[raw.bearer_token_env_var]) headers.Authorization = `Bearer ${process.env[raw.bearer_token_env_var]}`;
  return { name: s.name, tool: s.tool, scope: s.scope, project: s.project || null, spec: url ? { transport: 'http', url, headers } : { transport: 'stdio', command, args: [].concat(args).map(String), env } };
}

/** Where a server lives, for removing it (no secrets). */
export async function serverLocation(id) {
  const s = (await inv()).find((x) => sid(x) === id);
  return s ? { tool: s.tool, scope: s.scope, name: s.name, file: s.file, project: s.project || null } : null;
}
