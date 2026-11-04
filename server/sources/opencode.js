// OpenCode (sst/opencode) sessions.
// Storage (JSON files): <data>/opencode/storage/
//   session/<projectID>/<sessionID>.json   { id, title, directory, parentID?, time:{created,updated} }
//   message/<sessionID>/<messageID>.json   { id, role, time:{created}, modelID, providerID, tokens:{input,output,reasoning,cache:{read,write}} }
//   part/<messageID>/<partID>.json         { type: text|reasoning|tool|file|step-*, text?, tool?, state?:{status,input,output} }
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { statSafe, clip, oneLine, cleanPrompt } from '../util.js';
import { summarizeTool } from './common.js';
import { getKV } from '../store.js';

const DATA = process.env.XDG_DATA_HOME || (process.platform === 'win32'
  ? path.join(os.homedir(), '.local', 'share')
  : path.join(os.homedir(), '.local', 'share'));
export const OPENCODE_STORAGE = path.join(DATA, 'opencode', 'storage');

const readJson = async (p) => { try { return JSON.parse(await fsp.readFile(p, 'utf8')); } catch { return null; } };
async function jsonDir(dir) {
  let names = [];
  try { names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.json')).sort(); } catch { return []; }
  const out = [];
  for (const n of names) { const j = await readJson(path.join(dir, n)); if (j) out.push(j); }
  return out;
}

async function messagesOf(sessionId) {
  const msgs = await jsonDir(path.join(OPENCODE_STORAGE, 'message', sessionId));
  msgs.sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0) || String(a.id).localeCompare(String(b.id)));
  return msgs;
}
const partsOf = (messageId) => jsonDir(path.join(OPENCODE_STORAGE, 'part', messageId));
const textOfParts = (parts) => parts.filter((p) => p.type === 'text' && !p.synthetic && p.text).map((p) => p.text).join('\n').trim();

const cache = new Map(); // session file -> { stamp, row }

export async function listOpencode() {
  const root = path.join(OPENCODE_STORAGE, 'session');
  let projects = [];
  try { projects = await fsp.readdir(root); } catch { return []; }
  const batonIds = new Set(getKV('baton_opencode_ids', []) || []);
  const out = [];
  for (const proj of projects) {
    let files = [];
    try { files = (await fsp.readdir(path.join(root, proj))).filter((f) => f.endsWith('.json')); } catch { continue; }
    for (const f of files) {
      const file = path.join(root, proj, f);
      const st = await statSafe(file);
      if (!st) continue;
      const s = await readJson(file);
      if (!s?.id) continue;
      const mdir = await statSafe(path.join(OPENCODE_STORAGE, 'message', s.id));
      const stamp = `${st.mtimeMs}:${mdir?.mtimeMs || 0}`;
      const c = cache.get(file);
      if (c && c.stamp === stamp) { out.push(c.row); continue; }
      let first = '', last = '', reply = '', model = null;
      try {
        const msgs = await messagesOf(s.id);
        const users = msgs.filter((m) => m.role === 'user');
        const lastAsst = [...msgs].reverse().find((m) => m.role === 'assistant');
        if (users[0]) first = textOfParts(await partsOf(users[0].id));
        if (users.length > 1) last = textOfParts(await partsOf(users[users.length - 1].id));
        if (lastAsst) { reply = textOfParts(await partsOf(lastAsst.id)); model = lastAsst.modelID ? `${lastAsst.providerID ? lastAsst.providerID + '/' : ''}${lastAsst.modelID}` : null; }
      } catch { /* partial */ }
      const row = {
        tool: 'opencode', id: s.id,
        title: s.title && !/^New session/i.test(s.title) ? s.title : clip(oneLine(cleanPrompt(first)), 80) || '(untitled)',
        cwd: s.directory || null,
        created: s.time?.created || st.birthtimeMs,
        updated: Math.max(s.time?.updated || 0, mdir?.mtimeMs || 0) || st.mtimeMs,
        firstPrompt: clip(oneLine(cleanPrompt(first)), 240), lastPrompt: clip(oneLine(cleanPrompt(last)), 240), lastReply: clip(oneLine(reply), 400),
        model, automated: Boolean(s.parentID) && !batonIds.has(s.id), file, size: st.size,
      };
      cache.set(file, { stamp, row });
      out.push(row);
    }
  }
  return out;
}

export async function readOpencode(file) {
  const s = await readJson(file);
  if (!s?.id) return [];
  const out = [];
  for (const m of await messagesOf(s.id)) {
    const ts = m.time?.created || null;
    const parts = await partsOf(m.id);
    if (m.role === 'user') {
      const text = cleanPrompt(textOfParts(parts));
      const images = parts.filter((p) => p.type === 'file' && /^image\//.test(p.mime || '')).length;
      if (text || images) out.push({ role: 'user', text, ts, ...(images ? { images } : {}) });
      continue;
    }
    for (const p of parts) {
      if (p.type === 'reasoning' && p.text?.trim()) out.push({ role: 'thinking', text: p.text, ts });
      else if (p.type === 'text' && p.text?.trim() && !p.synthetic) out.push({ role: 'assistant', text: p.text, ts, model: m.modelID });
      else if (p.type === 'tool') {
        const st = p.state || {};
        out.push({ role: 'tool', ts, tool: { name: p.tool, summary: summarizeTool(p.tool, st.input || {}) || st.title || '', input: st.input, output: typeof st.output === 'string' ? st.output : st.error || undefined, error: st.status === 'error' } });
      }
    }
    if (m.error) out.push({ role: 'system', text: String(m.error.data?.message || m.error.name || 'error'), ts });
  }
  return out;
}

/** Token usage per assistant message: [{ ts, model, input, output, cacheRead, cacheWrite }]. */
export async function opencodeUsage(file) {
  const s = await readJson(file);
  if (!s?.id) return [];
  return (await messagesOf(s.id)).filter((m) => m.role === 'assistant' && m.tokens).map((m) => ({
    ts: m.time?.created || 0, model: m.modelID ? `${m.providerID ? m.providerID + '/' : ''}${m.modelID}` : 'unknown',
    input: m.tokens.input || 0, output: (m.tokens.output || 0) + (m.tokens.reasoning || 0), cacheRead: m.tokens.cache?.read || 0, cacheWrite: m.tokens.cache?.write || 0,
  }));
}
