// Token usage per CLI, aggregated by local day and model.
//   claude: ~/.claude/projects/**/*.jsonl   assistant entries' message.usage (deduped by message id)
//   codex:  ~/.codex/sessions/**/rollout-*.jsonl   event_msg token_count (deltas of total_token_usage) + rate_limits
//   agy:    ~/.gemini/antigravity-cli/conversations/*.db   steps payload field 5.9 (per generation)
// Results are cached per file (mtime+size) in data/usage-cache.json so restarts don't rescan gigabytes.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { HOME, DATA_DIR, DAY } from './util.js';
import { noteClaudeModels } from './models.js';
import { agyUsage, agyConversationModel, agySkillReads } from './sources/agy.js';
import { OPENCODE_STORAGE, opencodeUsage, opencodeDbSessions, opencodeDbSessionIds, opencodeSessionId } from './sources/opencode.js';
import { CLAUDE_HOME, CODEX_HOME } from './env.js';

const WINDOW_DAYS = 31;
const CACHE_FILE = path.join(DATA_DIR, 'usage-cache.json');
const CLAUDE_DIR = path.join(CLAUDE_HOME, 'projects');
const CODEX_DIR = path.join(CODEX_HOME, 'sessions');
const AGY_DIR = path.join(HOME, '.gemini', 'antigravity-cli', 'conversations');

// bucket value: [input, cacheWrite, cacheRead, output]
// v2: per-file skill-use records (sk) were added -> older caches are rescanned once
// v4: per-file MCP tool-call records (mc: [server, tool, ts, cwd])
const CACHE_V = 4;
let cache = { v: CACHE_V, files: {}, codexLimits: null };
try {
  const j = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  cache = { ...cache, codexLimits: j.codexLimits || null, files: j.v === CACHE_V ? j.files || {} : {} };
} catch { /* first run */ }
const SKILL_PATH_RE = /((?:[\w.~@+-]*\/)*?([\w.@+-]+)\/SKILL\.md)/g;
function skillPaths(text, cwd) {
  const out = [];
  for (const m of String(text).matchAll(SKILL_PATH_RE)) {
    let p = m[1].replace(/^~(?=\/)/, HOME);
    if (!path.isAbsolute(p)) p = cwd ? path.resolve(cwd, p) : null;
    out.push({ path: p, name: m[2] });
  }
  return out;
}

// Claude Code and Codex both expose MCP tools to the model as mcp__<server>__<tool>
const MCP_NAME_RE = /^mcp__(.+?)__(.+)$/;
const mcpName = (n) => { const m = MCP_NAME_RE.exec(String(n || '')); return m ? [m[1], m[2]] : null; };

const dayKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function eachLine(file, needle, fn) {
  const stream = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 20 });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!needle.some((n) => line.includes(n))) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      fn(o);
    }
  } finally { rl.close(); stream.destroy(); }
}

async function walk(dir, out, minMtime) {
  let ents;
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out, minMtime);
    else if (e.name.endsWith('.jsonl')) {
      try { const st = await fsp.stat(p); if (st.mtimeMs >= minMtime) out.push({ p, st }); } catch { /* gone */ }
    }
  }
}

function add(b, key, v) {
  const cur = b[key] || (b[key] = [0, 0, 0, 0]);
  for (let i = 0; i < 4; i++) cur[i] += v[i] || 0;
}

async function scanClaude(file) {
  const b = {};
  const sk = [];
  const mc = [];
  const seen = new Set();
  const seenCalls = new Set();
  await eachLine(file, ['"usage"', '"name":"Skill"', '<command-name>', '"name":"mcp__'], (o) => {
    const ts = Date.parse(o.timestamp) || 0;
    if (o.type === 'assistant') {
      for (const c of o.message?.content || []) {
        if (c?.type !== 'tool_use') continue;
        if (c.name === 'Skill' && (c.input?.skill || c.input?.command)) sk.push([c.input.skill || c.input.command, ts, null, o.cwd || null]);
        const m = mcpName(c.name);
        // streamed assistant entries repeat the same tool_use block -> dedupe by id
        if (m && !seenCalls.has(c.id)) { seenCalls.add(c.id); mc.push([m[0], m[1], ts, o.cwd || null]); }
      }
    } else if (o.type === 'user' && typeof o.message?.content === 'string') {
      const m = o.message.content.match(/<command-name>\/?([^<\s]+)<\/command-name>/);
      if (m) sk.push([m[1], ts, null, o.cwd || null, 'cmd']);
    }
    if (o.type !== 'assistant' || !o.message?.usage) return;
    const model = o.message.model;
    if (!model || model.startsWith('<')) return;
    const id = o.message.id || o.requestId || o.uuid;
    if (seen.has(id)) return;
    seen.add(id);
    const u = o.message.usage;
    add(b, `${dayKey(o.timestamp)}|${model}`, [u.input_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens, u.output_tokens]);
  });
  // subagent transcripts (<id>/subagents/x.jsonl) belong to the parent session
  const m = file.match(/([0-9a-f-]{36})(?:\/subagents\/[^/]+)?\.jsonl$/);
  return { b, sk, mc, sid: m ? `claude:${m[1]}` : null };
}

async function scanCodex(file) {
  const b = {};
  let model = 'unknown';
  let prev = null;
  let limits = null;
  const sk = [];
  const mc = [];
  const mcIds = new Set();
  const addMcp = (server, tool, ts, callId) => {
    if (!server || !tool) return;
    if (callId) { if (mcIds.has(callId)) return; mcIds.add(callId); }
    mc.push([server, tool, ts, cwd]);
  };
  let sid = null, cwd = null;
  await eachLine(file, ['"token_count"', '"turn_context"', 'SKILL.md', '"session_meta"', 'mcp_tool_call', '"mcp__'], (o) => {
    const p = o.payload || {};
    if (o.type === 'session_meta') { sid = p.id ? `codex:${p.id}` : sid; cwd = p.cwd || cwd; return; }
    const ts = Date.parse(o.timestamp) || 0;
    if (o.type === 'event_msg' && (p.type === 'mcp_tool_call_begin' || p.type === 'mcp_tool_call_end')) {
      addMcp(p.invocation?.server, p.invocation?.tool, ts, p.call_id);
      return;
    }
    if (o.type === 'response_item' && p.type === 'function_call') {
      const m = mcpName(p.name);
      if (m) addMcp(m[0], m[1], ts, p.call_id);
    } else if (o.type === 'response_item' && p.type === 'custom_tool_call' && typeof p.input === 'string') {
      // code mode: the model calls tools from a script (only the call input, never tool outputs that list tool names)
      for (const x of p.input.matchAll(/\bmcp__([\w-]+?)__([\w-]+)\s*\(/g)) addMcp(x[1], x[2], ts, null);
    }
    if (o.type === 'response_item' && /call/.test(p.type || '')) {
      // the agent opened a SKILL.md (cat/sed/read) -> that skill was used
      const text = [p.arguments, p.input, JSON.stringify(p.action || '')].filter(Boolean).join(' ');
      const seenHere = new Set();
      for (const h of skillPaths(text, cwd)) { if (!seenHere.has(h.path)) { seenHere.add(h.path); sk.push([h.name, Date.parse(o.timestamp) || 0, h.path, cwd]); } }
      return;
    }
    if (o.type === 'turn_context') { if (p.model) model = p.model; if (p.cwd) cwd = p.cwd; return; }
    if (p.type !== 'token_count') return;
    if (p.rate_limits) limits = { at: Date.parse(o.timestamp) || 0, ...p.rate_limits };
    const t = p.info?.total_token_usage;
    if (!t) return;
    if (prev && t.total_tokens <= prev.total_tokens) return;
    const d = (k) => (t[k] || 0) - (prev?.[k] || 0);
    const cached = d('cached_input_tokens');
    add(b, `${dayKey(o.timestamp)}|${model}`, [Math.max(0, d('input_tokens') - cached), d('cache_write_input_tokens'), cached, d('output_tokens')]);
    prev = t;
  });
  if (!sid) { const m = file.match(/([0-9a-f]{8}-[0-9a-f-]{27,})\.jsonl$/); if (m) sid = `codex:${m[1]}`; }
  return { b, limits, sk, mc, sid };
}

async function listAgyDbs(minMtime) {
  const out = [];
  let names = [];
  try { names = await fsp.readdir(AGY_DIR); } catch { return out; }
  for (const n of names) {
    if (!n.endsWith('.db')) continue;
    const p = path.join(AGY_DIR, n);
    try {
      const st = await fsp.stat(p);
      const wal = await fsp.stat(p + '-wal').catch(() => null);
      const m = Math.max(st.mtimeMs, wal?.mtimeMs || 0);
      if (m >= minMtime) out.push({ p, st: { mtimeMs: m, size: st.size + (wal?.size || 0) } });
    } catch { /* gone */ }
  }
  return out;
}

function scanAgy(file) {
  const b = {};
  const model = agyConversationModel(file) || 'unknown';
  const fallbackTs = fs.statSync(file).mtimeMs;
  for (const u of agyUsage(file)) {
    add(b, `${dayKey(u.ts || fallbackTs)}|${model}`, [Math.max(0, u.input - u.cacheRead), 0, u.cacheRead, u.output]);
  }
  const sk = agySkillReads(file).flatMap((r) => skillPaths(r.text).map((h) => [h.name, r.ts || fallbackTs, h.path, null]));
  return { b, sk, sid: `agy:${path.basename(file, '.db')}` };
}

async function listOpencodeSessions(minMtime) {
  const out = opencodeDbSessions(minMtime);
  const inDb = opencodeDbSessionIds(); // all of them, not just recent: an old migrated session's JSON may be newer
  const root = path.join(OPENCODE_STORAGE, 'session');
  for (const proj of await fsp.readdir(root).catch(() => [])) {
    for (const f of await fsp.readdir(path.join(root, proj)).catch(() => [])) {
      if (!f.endsWith('.json') || inDb.has(f.replace(/\.json$/, ''))) continue;
      const p = path.join(root, proj, f);
      const st = await fsp.stat(p).catch(() => null);
      const md = await fsp.stat(path.join(OPENCODE_STORAGE, 'message', f.replace(/\.json$/, ''))).catch(() => null);
      const m = Math.max(st?.mtimeMs || 0, md?.mtimeMs || 0);
      if (st && m >= minMtime) out.push({ p, st: { mtimeMs: m, size: st.size } });
    }
  }
  return out;
}

async function scanOpencode(file) {
  const b = {};
  for (const u of await opencodeUsage(file)) add(b, `${dayKey(u.ts || Date.now())}|${u.model}`, [Math.max(0, u.input), u.cacheWrite, u.cacheRead, u.output]);
  return { b, sk: [], sid: `opencode:${opencodeSessionId(file)}` };
}

let scanning = null;
let lastScan = 0;

export function refreshUsage() {
  if (scanning) return scanning;
  scanning = (async () => {
    const minMtime = Date.now() - WINDOW_DAYS * DAY;
    const files = { claude: [], codex: [], agy: await listAgyDbs(minMtime), opencode: await listOpencodeSessions(minMtime) };
    await walk(CLAUDE_DIR, files.claude, minMtime);
    await walk(CODEX_DIR, files.codex, minMtime);
    const next = {};
    let limits = cache.codexLimits;
    for (const tool of Object.keys(files)) {
      for (const { p, st } of files[tool]) {
        const old = cache.files[p];
        if (old && old.m === st.mtimeMs && old.s === st.size) { next[p] = old; }
        else {
          try {
            const r = tool === 'claude' ? await scanClaude(p) : tool === 'codex' ? await scanCodex(p) : tool === 'opencode' ? await scanOpencode(p) : scanAgy(p);
            next[p] = { t: tool, m: st.mtimeMs, s: st.size, b: r.b, sk: r.sk?.length ? r.sk : undefined, mc: r.mc?.length ? r.mc : undefined, sid: r.sid || undefined };
            if (r.limits && (!limits || r.limits.at > limits.at)) limits = r.limits;
          } catch { /* unreadable */ }
        }
      }
    }
    cache = { v: CACHE_V, files: next, codexLimits: limits };
    lastScan = Date.now();
    try { await fsp.writeFile(CACHE_FILE, JSON.stringify(cache)); } catch { /* ignore */ }
  })().finally(() => { scanning = null; });
  return scanning;
}

/** Every recorded skill/command use in the last ~30 days: { tool, name, path, ts, session, cwd, cmd }. */
export async function skillUses() {
  if (!lastScan) await refreshUsage();
  const out = [];
  for (const f of Object.values(cache.files)) {
    for (const [name, ts, p, cwd, kind] of f.sk || []) out.push({ tool: f.t, name, path: p, ts, cwd, session: f.sid, cmd: kind === 'cmd' });
  }
  return out;
}

/** Every recorded MCP tool call in the last ~30 days: { tool, server, name, ts, session, cwd }. */
export async function mcpUses() {
  if (!lastScan) await refreshUsage();
  const out = [];
  for (const f of Object.values(cache.files)) {
    for (const [server, name, ts, cwd] of f.mc || []) out.push({ tool: f.t, server, name, ts, cwd, session: f.sid });
  }
  return out;
}

export async function usageReport() {
  if (!lastScan) await refreshUsage();
  else if (Date.now() - lastScan > 60_000) refreshUsage(); // stale-while-revalidate
  const merged = { claude: {}, codex: {}, agy: {}, opencode: {}, cursor: {} };
  for (const f of Object.values(cache.files)) for (const [k, v] of Object.entries(f.b)) add(merged[f.t], k, v);

  noteClaudeModels(Object.keys(merged.claude).map((k) => k.split('|')[1]));
  const today = dayKey(Date.now());
  const days = Array.from({ length: 14 }, (_, i) => dayKey(Date.now() - (13 - i) * DAY));
  const since = { today, d7: dayKey(Date.now() - 6 * DAY), d30: dayKey(Date.now() - 29 * DAY) };
  const out = {};
  for (const [tool, buckets] of Object.entries(merged)) {
    const periods = {};
    for (const [pk, from] of Object.entries(since)) {
      const tot = [0, 0, 0, 0];
      const byModel = {};
      for (const [k, v] of Object.entries(buckets)) {
        const [day, model] = k.split('|');
        if (day < from) continue;
        for (let i = 0; i < 4; i++) tot[i] += v[i];
        add(byModel, model, v);
      }
      periods[pk] = {
        input: tot[0], cacheWrite: tot[1], cacheRead: tot[2], output: tot[3],
        models: Object.entries(byModel).map(([m, v]) => ({ model: m, input: v[0], cacheWrite: v[1], cacheRead: v[2], output: v[3] }))
          .sort((a, b) => (b.input + b.output + b.cacheWrite) - (a.input + a.output + a.cacheWrite)),
      };
    }
    const daily = days.map((d) => {
      const v = [0, 0, 0, 0];
      for (const [k, x] of Object.entries(buckets)) if (k.startsWith(d + '|')) for (let i = 0; i < 4; i++) v[i] += x[i];
      return { day: d, input: v[0], cacheWrite: v[1], cacheRead: v[2], output: v[3] };
    });
    out[tool] = { periods, daily };
  }
  const l = cache.codexLimits;
  if (l) {
    const win = (w) => (w ? { usedPercent: w.used_percent, windowMinutes: w.window_minutes, resetsAt: w.resets_at ? w.resets_at * 1000 : null } : null);
    out.codex.limits = { at: l.at, plan: l.plan_type || null, primary: win(l.primary), secondary: win(l.secondary) };
  }
  return { tools: out, computedAt: lastScan, scanning: Boolean(scanning) };
}

export function startUsageScheduler() {
  refreshUsage().catch(() => {});
  setInterval(() => refreshUsage().catch(() => {}), 5 * 60_000).unref();
}
