// Codex CLI sessions: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl, titles in ~/.codex/session_index.jsonl
import fsp from 'node:fs/promises';
import path from 'node:path';
import { HOME, eachJsonl, headJsonl, tailJsonl, cleanPrompt, clip, oneLine, statSafe } from '../util.js';
import { summarizeTool, toolOutputText } from './common.js';
import { getKV } from '../store.js';
import { tr } from '../i18n.js';
import { CODEX_HOME } from '../env.js';

const ROOT = CODEX_HOME;
const SESSIONS = path.join(ROOT, 'sessions');
const INDEX = path.join(ROOT, 'session_index.jsonl');
const cache = new Map();
let titleCache = { mtimeMs: 0, map: new Map() };

async function titles() {
  const st = await statSafe(INDEX);
  if (!st) return titleCache.map;
  if (st.mtimeMs === titleCache.mtimeMs) return titleCache.map;
  const map = new Map();
  await eachJsonl(INDEX, (e) => { if (e.id && e.thread_name) map.set(e.id, e.thread_name); });
  titleCache = { mtimeMs: st.mtimeMs, map };
  return map;
}

function userText(e) {
  const p = e.payload || {};
  if (e.type === 'event_msg' && p.type === 'user_message') return p.message;
  if (e.type === 'event_msg' && p.type === 'item_completed' && p.item?.type === 'UserMessage') {
    return (p.item.content || []).map((c) => c.text || '').join('\n');
  }
  return null;
}

function assistantText(e) {
  const p = e.payload || {};
  if (e.type === 'response_item' && p.type === 'message' && p.role === 'assistant') {
    return (p.content || []).map((c) => c.text || '').join('\n');
  }
  return null;
}

async function walk(dir, out) {
  let ents = [];
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
}

async function summarize(file, st, batonIds) {
  const head = await headJsonl(file, 64 * 1024, 200);
  const meta = head.find((e) => e.type === 'session_meta')?.payload;
  if (!meta) return null;
  const tail = st.size > 64 * 1024 ? await tailJsonl(file, 192 * 1024) : head;
  let firstPrompt = null, lastPrompt = null, lastReply = null, updated = null, model = null;
  for (const e of head) {
    const u = userText(e);
    if (u && !firstPrompt) firstPrompt = cleanPrompt(u);
    if (e.type === 'turn_context' && e.payload?.model) model = e.payload.model;
  }
  for (const e of tail) {
    if (e.timestamp) updated = Date.parse(e.timestamp) || updated;
    const u = userText(e);
    if (u) lastPrompt = cleanPrompt(u);
    const a = assistantText(e);
    if (a) lastReply = a;
    if (e.type === 'event_msg' && e.payload?.type === 'task_complete' && e.payload.last_agent_message) lastReply = e.payload.last_agent_message;
    if (e.type === 'turn_context' && e.payload?.model) model = e.payload.model;
  }
  if (!firstPrompt && !lastPrompt) return null;
  const id = meta.id || meta.session_id;
  const source = typeof meta.source === 'string' ? meta.source : (meta.source ? 'subagent' : '');
  const cwd = meta.cwd;
  const automated = !batonIds.has(id) && (source === 'exec' || source === 'subagent' || cwd?.startsWith('/tmp'));
  return {
    tool: 'codex',
    id,
    title: null, // filled from index at list time
    fallbackTitle: clip(oneLine(firstPrompt || lastPrompt), 80),
    cwd,
    created: Date.parse(meta.timestamp) || st.birthtimeMs,
    updated: updated || st.mtimeMs,
    firstPrompt: clip(oneLine(firstPrompt), 240),
    lastPrompt: clip(oneLine(lastPrompt), 240),
    lastReply: clip(oneLine(lastReply), 400),
    model,
    automated,
    source,
    file,
    size: st.size,
  };
}

export async function listCodex() {
  const files = [];
  await walk(SESSIONS, files);
  const t = await titles();
  const batonIds = new Set(getKV('baton_codex_ids', []) || []);
  const out = [];
  const seen = new Set();
  for (const file of files) {
    seen.add(file);
    const st = await statSafe(file);
    if (!st) continue;
    let c = cache.get(file);
    if (!c || c.mtimeMs !== st.mtimeMs || c.size !== st.size) {
      let summary = null;
      try { summary = await summarize(file, st, batonIds); } catch { summary = null; }
      c = { mtimeMs: st.mtimeMs, size: st.size, summary };
      cache.set(file, c);
    }
    if (!c.summary) continue;
    const s = c.summary;
    if (s.automated && batonIds.has(s.id)) s.automated = false;
    s.title = t.get(s.id) || s.fallbackTitle || tr('(제목 없음)');
    out.push(s);
  }
  for (const k of cache.keys()) if (!seen.has(k)) cache.delete(k);
  return out;
}

export async function readCodex(file) {
  const msgs = [];
  const byCall = new Map();
  await eachJsonl(file, (e) => {
    const ts = e.timestamp ? Date.parse(e.timestamp) : null;
    const p = e.payload || {};
    const u = userText(e);
    if (u) {
      const t = cleanPrompt(u);
      const n = (p.images?.length || 0) + (p.local_images?.length || 0) + (p.item?.content || []).filter((c) => /image/i.test(c?.type || '')).length;
      if (t || n) msgs.push({ role: 'user', text: t, ts, ...(n ? { images: n } : {}) });
      return;
    }
    if (e.type === 'event_msg' && p.type === 'context_compacted') {
      msgs.push({ role: 'system', text: tr('대화가 압축(compact)되었어요'), ts });
      return;
    }
    if (e.type !== 'response_item') return;
    if (p.type === 'message' && p.role === 'assistant') {
      const t = (p.content || []).map((c) => c.text || '').join('\n');
      if (t.trim()) msgs.push({ role: 'assistant', text: t, ts });
    } else if (p.type === 'reasoning') {
      const t = (p.summary || []).map((s) => s.text || '').join('\n');
      if (t.trim()) msgs.push({ role: 'thinking', text: t, ts });
    } else if (p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') {
      const input = p.arguments ?? p.input ?? p.action;
      const m = { role: 'tool', ts, tool: { name: p.name || 'shell', summary: summarizeTool(p.name, input), input } };
      if (p.call_id) byCall.set(p.call_id, m);
      msgs.push(m);
    } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output' || p.type === 'local_shell_call_output') {
      const m = byCall.get(p.call_id);
      if (m) m.tool.output = toolOutputText(p.output);
    } else if (p.type === 'web_search_call') {
      msgs.push({ role: 'tool', ts, tool: { name: 'web_search', summary: p.action?.query || '' } });
    }
  });
  return msgs;
}
