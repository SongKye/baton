// Reading what someone gave you to set up an MCP server — usually a developer's "add this" note: a config snippet
// for some client (Claude Desktop / Claude Code / Cursor / VS Code / OpenCode JSON, Codex TOML), an install command
// (`claude mcp add …`, `codex mcp add …`, `agy mcp add …`), a URL and a token.
//   quickParse(text)  -> the server(s) in a snippet or command, without any AI; secrets become inputs (prefilled)
//   maskPasted(text)  -> the same text with token-looking values replaced by {{PASTED_SECRET_n}} (for the AI)
import { parseToml } from './mcp.js';
import { toForm, cleanInputs } from './mcp-install.js';
import { tr } from './i18n.js';

const SECRET_KEY = /(token|secret|password|passwd|api[-_]?key|apikey|access[-_]?key|private[-_]?key|credential|cookie|authorization|auth|bearer|[_-]pat|(^|[_-])key)$|^(token|secret|password|api[-_]?key|authorization)/i;
const TOKENISH = /^(sk-|sk_|pk_live|rk_|ghp_|gho_|ghs_|github_pat_|glpat-|xox[abposr]-|AKIA|ASIA|AIza|ya29\.|eyJ[\w-]{10,}\.|ntn_|secret_|lin_api_|sbp_)/;
/** "<YOUR_KEY>", "your-api-key-here", "xxx", "…": something the user still has to fill in. */
const stub = (v) => /^\s*$|^<[^>]*>$|^\$\{|your[_ -]|_here$|-here$|^x{3,}$|^\.{3}$|^…$|^(replace|insert|paste|change)[_ -]?me/i.test(String(v));
const looksSecret = (v) => TOKENISH.test(v) || (/^[A-Za-z0-9_\-+/=.]{32,}$/.test(v) && /\d/.test(v) && /[A-Za-z]/.test(v) && !v.includes('/'));
const keyOf = (s) => String(s).replace(/^Authorization$/i, 'TOKEN').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase().replace(/^(\d)/, 'K$1').slice(0, 60) || 'VALUE';

// ---------------------------------------------------------------- secrets in free text (for the AI)
/** -> { text, secrets: { PASTED_SECRET_1: value } } — the same value always gets the same name. */
export function maskPasted(text) {
  const secrets = {};
  const byValue = new Map();
  const name = (v) => {
    if (!byValue.has(v)) { const k = `PASTED_SECRET_${byValue.size + 1}`; byValue.set(v, k); secrets[k] = v; }
    return `{{${byValue.get(v)}}}`;
  };
  let s = String(text || '');
  s = s.replace(/\b(Bearer|Token|Basic)(\s+)([A-Za-z0-9._~+/=-]{8,})/g, (m, a, sp, v) => (stub(v) ? m : `${a}${sp}${name(v)}`));
  s = s.replace(/(["']?[\w.-]*(?:token|secret|password|passwd|api[-_]?key|apikey|access[-_]?key|private[-_]?key|credential|_pat|auth)[\w.-]*["']?\s*[:=]\s*["']?)(?!Bearer\b|Basic\b|Token\b|\{\{|<|\$\{)([^"'\s,}&;]{6,})/gi, (m, a, v) => (stub(v) ? m : `${a}${name(v)}`));
  s = s.replace(/((?:토큰|액세스\s*키|API\s*키|키|비밀번호|패스워드|시크릿)\s*(?:값)?\s*(?:은|는|이|가|:|=)?\s*)(?!\{\{)([A-Za-z0-9._~+/=-]{8,})/g, (m, a, v) => (stub(v) ? m : `${a}${name(v)}`));
  s = s.replace(/([?&][\w-]*(?:key|token|secret|sig|auth)[\w-]*=)([^&\s"'<>]{6,})/gi, (m, a, v) => (stub(v) || v.startsWith('{{') ? m : `${a}${name(v)}`));
  s = s.replace(/\b(sk-[\w-]{16,}|ghp_\w{20,}|gho_\w{20,}|github_pat_\w{20,}|glpat-[\w-]{16,}|xox[abposr]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{30,}|ntn_\w{20,}|lin_api_\w{20,}|sbp_\w{20,}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]+)\b/g, (m) => name(m));
  // the same value anywhere else in the text (without a label next to it)
  for (const [v, k] of byValue) s = s.split(v).join(`{{${k}}}`);
  return { text: s, secrets };
}

// ---------------------------------------------------------------- snippets
/** Every balanced {...} in the text that parses as JSON (comments and trailing commas allowed). */
function jsonObjects(text) {
  const out = [];
  const t = String(text);
  for (let i = t.indexOf('{'), n = 0; i >= 0 && n < 40; i = t.indexOf('{', i + 1), n++) {
    let depth = 0, str = null, j = i;
    for (; j < t.length; j++) {
      const c = t[j];
      if (str) { if (c === '\\') j++; else if (c === str) str = null; continue; }
      if (c === '"') str = c;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) break;
    }
    if (depth !== 0) continue;
    const raw = t.slice(i, j + 1).replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1');
    try { out.push(JSON.parse(raw)); i = j; } catch { /* not this one */ }
  }
  return out;
}
const serverLike = (o) => o && typeof o === 'object' && !Array.isArray(o) && Boolean(o.command || o.url || o.serverUrl || o.httpUrl || ['stdio', 'http', 'sse', 'local', 'remote', 'streamable-http'].includes(o.type));
/** A parsed object -> [[name, raw]] (handles mcpServers / servers / mcp / context_servers, a bare map, one server). */
function serversIn(o) {
  for (const k of ['mcpServers', 'servers', 'mcp', 'context_servers', 'mcp_servers']) {
    let m = o?.[k];
    if (k === 'mcp' && m?.servers && typeof m.servers === 'object' && !serverLike(m.servers)) m = m.servers; // OpenCode V2
    if (m && typeof m === 'object' && !Array.isArray(m)) { const e = Object.entries(m).filter(([, v]) => serverLike(v)); if (e.length) return e; }
  }
  if (serverLike(o)) return [['', o]];
  if (o && typeof o === 'object') { const e = Object.entries(o).filter(([, v]) => serverLike(v)); if (e.length && e.length === Object.keys(o).length) return e; }
  return [];
}

/** One raw entry (any client's shape) -> a template with placeholders + values to prefill. */
function fromRaw(name, raw) {
  const inputs = [];
  const prefill = {};
  const want = (key, value, { secret = false, label = key } = {}) => {
    let k = keyOf(key);
    while (inputs.some((x) => x.key === k) && prefill[k] !== value) k += '_2';
    if (!inputs.some((x) => x.key === k)) inputs.push({ key: k, label, secret, required: true, default: '' });
    if (value && !stub(value)) prefill[k] = value;
    return `{{${k}}}`;
  };
  // ${VAR}, ${env:VAR}, ${input:id} (VS Code) -> an input the user fills in
  const refs = (s) => String(s).replace(/\$\{(?:env:|input:)?([A-Za-z_][\w-]*)\}/g, (m, v) => want(v, '', { secret: SECRET_KEY.test(v) }));
  const val = (k, v) => {
    v = String(v ?? '');
    if (/\$\{/.test(v)) return refs(v);
    const bearer = v.match(/^(Bearer|Token|Basic)\s+(.+)$/i);
    if (bearer) return `${bearer[1]} ${want(k, bearer[2].trim(), { secret: true })}`;
    if (SECRET_KEY.test(k) || looksSecret(v)) return want(k, v, { secret: true });
    if (stub(v)) return want(k, '', { secret: SECRET_KEY.test(k) });
    return v;
  };
  let command = raw.command, args = [].concat(raw.args || []).map(String);
  if (Array.isArray(command)) { args = command.slice(1).map(String); command = command[0]; }
  const url = raw.url || raw.serverUrl || raw.httpUrl || '';
  const t = String(raw.type || raw.transport || '').toLowerCase();
  const tpl = { name, inputs };
  if (url && !command) {
    tpl.transport = t === 'sse' ? 'sse' : 'http';
    let u = refs(url);
    try {
      const p = new URL(u);
      for (const [k, v] of [...p.searchParams]) if ((SECRET_KEY.test(k) || /key|token|secret|sig/i.test(k) || looksSecret(v)) && !v.startsWith('{{')) u = u.replace(`${k}=${encodeURIComponent(v)}`, `${k}=${want(k, v, { secret: true })}`).replace(`${k}=${v}`, `${k}=${want(k, v, { secret: true })}`);
    } catch { /* placeholders in host */ }
    tpl.url = u;
    tpl.headers = Object.fromEntries(Object.entries(raw.headers || raw.http_headers || {}).map(([k, v]) => [k, val(k, v)]));
    if (raw.bearer_token_env_var) tpl.headers.Authorization = `Bearer ${want(raw.bearer_token_env_var, '', { secret: true })}`;
  } else {
    tpl.transport = 'stdio';
    tpl.command = String(command || '');
    const out = [];
    args.forEach((a, i) => {
      const kv = a.match(/^(--?[\w.-]+)=(.*)$/);
      if (kv && (SECRET_KEY.test(kv[1].replace(/^-+/, '')) || looksSecret(kv[2]))) out.push(`${kv[1]}=${want(kv[1].replace(/^-+/, ''), kv[2], { secret: true })}`);
      else if (/^--?[\w.-]+$/.test(args[i - 1] || '') && SECRET_KEY.test(args[i - 1].replace(/^-+/, '')) && !a.startsWith('-')) out.push(want(args[i - 1].replace(/^-+/, ''), a, { secret: true }));
      else if (looksSecret(a)) out.push(want('TOKEN', a, { secret: true }));
      else out.push(/\$\{/.test(a) ? refs(a) : a);
    });
    tpl.args = out;
    tpl.env = Object.fromEntries(Object.entries(raw.env || raw.environment || {}).map(([k, v]) => [k, val(k, v)]));
  }
  return { tpl, prefill };
}

// ---------------------------------------------------------------- install commands
/** Shell-ish words: quotes, backslash escapes, line continuations. */
export function words(line) {
  const out = [];
  let cur = '', q = null, has = false;
  const s = String(line).replace(/\\\r?\n/g, ' ');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"' && /["\\$`]/.test(s[i + 1])) cur += s[++i]; else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; has = true; continue; }
    if (c === '\\' && i + 1 < s.length) { cur += s[++i]; has = true; continue; }
    if (/\s/.test(c)) { if (has || cur) out.push(cur); cur = ''; has = false; continue; }
    cur += c;
  }
  if (has || cur) out.push(cur);
  return out;
}

/** `claude mcp add …`, `claude mcp add-json …`, `codex mcp add …`, `agy mcp add …`, `gemini mcp add …` -> [[name, raw]] */
function fromCommand(text) {
  const out = [];
  const lines = String(text).replace(/\\\r?\n/g, ' ').split('\n');
  for (const line of lines) {
    const m = line.match(/\b(claude|codex|agy|gemini)\s+mcp\s+(add-json|add)\s+(.+)$/);
    if (!m) continue;
    const w = words(m[3]);
    if (m[2] === 'add-json') {
      const pos = w.filter((x, i) => !x.startsWith('-') && !/^-/.test(w[i - 1] || '') || /^\{/.test(x));
      const json = jsonObjects(pos.slice(1).join(' '))[0];
      if (pos[0] && serverLike(json)) out.push([pos[0], json]);
      continue;
    }
    const raw = { env: {}, headers: {} };
    const pos = [];
    let rest = false;
    for (let i = 0; i < w.length; i++) {
      const a = w[i];
      if (rest || (!a.startsWith('-') && pos.length >= 2)) { pos.push(a); continue; }
      if (a === '--') { rest = true; continue; }
      const [flag, inline] = a.includes('=') && a.startsWith('--') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, null];
      const next = () => (inline != null ? inline : w[++i]);
      if (/^(-e|--env)$/.test(flag)) { const v = next() || ''; const j = v.indexOf('='); if (j > 0) raw.env[v.slice(0, j)] = v.slice(j + 1); }
      else if (/^(-H|--header)$/.test(flag)) { const v = next() || ''; const j = v.indexOf(':'); if (j > 0) raw.headers[v.slice(0, j).trim()] = v.slice(j + 1).trim(); }
      else if (/^(-t|--transport|--type)$/.test(flag)) raw.type = next();
      else if (flag === '--url') raw.url = next();
      else if (flag === '--bearer-token-env-var') raw.bearer_token_env_var = next();
      else if (/^(-s|--scope|--timeout|--trust|--description|--include-tools|--exclude-tools)$/.test(flag)) { if (inline == null && w[i + 1] && !w[i + 1].startsWith('-')) i++; }
      else if (flag.startsWith('-')) { /* unknown switch */ }
      else pos.push(a);
    }
    const [name, target, ...args] = pos;
    if (!name) continue;
    if (raw.url) out.push([name, raw]);
    else if (target && /^https?:\/\//.test(target)) out.push([name, { ...raw, url: target }]);
    else if (target) out.push([name, { ...raw, command: target, args }]);
  }
  return out;
}

/**
 * A config snippet or an install command in `text` -> { form, prefill, notes } (the first server; others named in notes),
 * or null when there is none (then the AI reads it).
 */
export function quickParse(text) {
  const src = String(text || '');
  let found = fromCommand(src);
  if (!found.length) for (const o of jsonObjects(src)) { found = serversIn(o); if (found.length) break; }
  if (!found.length && /\[\s*mcp_servers\./.test(src)) {
    try { found = Object.entries(parseToml(src.slice(src.search(/\[\s*mcp_servers\./))).mcp_servers || {}).filter(([, v]) => serverLike(v)); } catch { found = []; }
  }
  if (!found.length) return null;
  const [name, raw] = found[0];
  const { tpl, prefill } = fromRaw(name, raw);
  if (!name) tpl.name = guessName(tpl);
  const form = toForm({ ...tpl, inputs: cleanInputs(tpl.inputs) });
  if (!form.target) return null;
  const notes = found.length > 1 ? [tr('붙여넣은 설정에 서버가 {n}개 있어요 ({list}). 첫 번째만 가져왔어요', { n: found.length, list: found.map(([n]) => n || '?').join(', ') })] : [];
  return { form, prefill, notes };
}

function guessName(t) {
  if (t.url) { try { return new URL(t.url.replace(/\{\{[^}]*\}\}/g, 'x')).hostname.split('.').filter((x) => !['www', 'mcp', 'api', 'com', 'dev', 'io', 'app', 'ai', 'net', 'org'].includes(x))[0] || 'server'; } catch { return 'server'; } }
  const pkg = [t.command, ...(t.args || [])].find((a) => /^@?[\w.-]+\/?[\w.-]*$/.test(a) && !['npx', 'uvx', '-y', 'node', 'python', 'python3', 'docker', 'run', '-i', '--rm', 'bunx', 'pnpm', 'dlx'].includes(a));
  return String(pkg || t.command || 'server').split('/').pop().replace(/@.*$/, '').replace(/^(mcp-server-|server-)|(-mcp-server|-mcp|-server)$/g, '') || 'server';
}
