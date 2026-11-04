// Cursor CLI (cursor-agent) chats.
// Storage: ~/.cursor/chats/<md5(workspace)>/<chatId>/store.db (sqlite)
//   meta(key, value)  key '0' -> hex-encoded JSON { agentId, name, createdAt, lastUsedModel, mode }
//   blobs(id, data)   content-addressed; message blobs are JSON { role, content: string | [{type:'text'|'tool-call'|'tool-result', ...}] }
// The blob DAG isn't documented, so messages are read in insertion (rowid) order, which matches the chat order.
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { statSafe, clip, oneLine, cleanPrompt } from '../util.js';
import { summarizeTool } from './common.js';
import { getKV } from '../store.js';

export const CURSOR_CHATS = path.join(os.homedir(), '.cursor', 'chats');

function openRO(file) { return new DatabaseSync(file, { readOnly: true }); }

function readMeta(db) {
  try {
    const r = db.prepare("SELECT value FROM meta WHERE key = '0'").get();
    if (!r) return {};
    const v = String(r.value);
    const text = /^[0-9a-f]+$/i.test(v) ? Buffer.from(v, 'hex').toString('utf8') : v;
    return JSON.parse(text);
  } catch { return {}; }
}

function messages(db) {
  const out = [];
  let rows = [];
  try { rows = db.prepare('SELECT rowid, data FROM blobs ORDER BY rowid').all(); } catch { return out; }
  for (const r of rows) {
    const buf = Buffer.from(r.data || []);
    if (buf[0] !== 0x7b) continue; // JSON objects only
    try {
      const j = JSON.parse(buf.toString('utf8'));
      if (j && typeof j.role === 'string') out.push(j);
    } catch { /* protobuf/binary */ }
  }
  return out;
}

const textOf = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter((c) => c?.type === 'text' && c.text).map((c) => c.text).join('\n') : '');
const userQuery = (t) => { const m = String(t).match(/<user_query>([\s\S]*?)<\/user_query>/); return (m ? m[1] : t).trim(); };

// workspace hash -> path, learned from every cwd Baton knows about
const knownDirs = new Set();
export function noteCursorDirs(dirs) { for (const d of dirs) if (d) knownDirs.add(d); }
function dirForHash(hash) {
  for (const d of knownDirs) if (crypto.createHash('md5').update(d).digest('hex') === hash) return d;
  return null;
}

const cache = new Map();

export async function listCursor() {
  let hashes = [];
  try { hashes = await fsp.readdir(CURSOR_CHATS); } catch { return []; }
  const batonIds = new Set(getKV('baton_cursor_ids', []) || []);
  const out = [];
  for (const h of hashes) {
    let chats = [];
    try { chats = await fsp.readdir(path.join(CURSOR_CHATS, h)); } catch { continue; }
    for (const id of chats) {
      const file = path.join(CURSOR_CHATS, h, id, 'store.db');
      const st = await statSafe(file);
      if (!st) continue;
      const wal = await statSafe(file + '-wal');
      const stamp = `${st.mtimeMs}:${wal?.mtimeMs || 0}`;
      const c = cache.get(file);
      if (c && c.stamp === stamp) { out.push(c.row); continue; }
      let db;
      try { db = openRO(file); } catch { continue; }
      let meta = {}, msgs = [];
      try { meta = readMeta(db); msgs = messages(db); } finally { try { db.close(); } catch { /* ignore */ } }
      const users = msgs.filter((m) => m.role === 'user').map((m) => userQuery(textOf(m.content))).filter(Boolean);
      const lastAsst = [...msgs].reverse().find((m) => m.role === 'assistant' && textOf(m.content).trim());
      let cwd = dirForHash(h);
      if (!cwd) {
        const sys = msgs.map((m) => textOf(m.content)).join('\n');
        cwd = (sys.match(/Workspace Path:\s*(\S+)/) || sys.match(/workspace(?:_path)?["':\s]+(\/[^\s"']+)/i) || [])[1] || null;
      }
      const row = {
        tool: 'cursor', id, // the chat folder name is what `cursor-agent --resume` takes
        title: meta.name && meta.name !== 'New Agent' ? meta.name : clip(oneLine(cleanPrompt(users[0] || '')), 80) || '(untitled)',
        cwd, created: meta.createdAt || st.birthtimeMs, updated: Math.max(st.mtimeMs, wal?.mtimeMs || 0),
        firstPrompt: clip(oneLine(users[0] || ''), 240), lastPrompt: clip(oneLine(users.length > 1 ? users[users.length - 1] : ''), 240),
        lastReply: clip(oneLine(lastAsst ? textOf(lastAsst.content) : ''), 400),
        model: meta.lastUsedModel || null, automated: !batonIds.has(id) && users.length === 0, file, size: st.size,
      };
      cache.set(file, { stamp, row });
      out.push(row);
    }
  }
  return out;
}

export async function readCursor(file) {
  let db;
  try { db = openRO(file); } catch { return []; }
  let msgs = [];
  try { msgs = messages(db); } finally { try { db.close(); } catch { /* ignore */ } }
  const out = [];
  const byCall = new Map();
  for (const m of msgs) {
    if (m.role === 'system') continue;
    if (m.role === 'user') { const t = cleanPrompt(userQuery(textOf(m.content))); if (t && !/^<user_info>/.test(t)) out.push({ role: 'user', text: t }); continue; }
    const parts = Array.isArray(m.content) ? m.content : [{ type: 'text', text: textOf(m.content) }];
    for (const p of parts) {
      if (p.type === 'text' && p.text?.trim() && m.role === 'assistant') out.push({ role: 'assistant', text: p.text });
      else if (p.type === 'reasoning' && p.text?.trim()) out.push({ role: 'thinking', text: p.text });
      else if (p.type === 'tool-call') {
        const t = { role: 'tool', tool: { name: p.toolName || 'tool', summary: summarizeTool(p.toolName, p.args || {}), input: p.args } };
        if (p.toolCallId) byCall.set(p.toolCallId, t);
        out.push(t);
      } else if (p.type === 'tool-result') {
        const t = byCall.get(p.toolCallId);
        const res = typeof p.result === 'string' ? p.result : JSON.stringify(p.result ?? '');
        if (t) { t.tool.output = res; t.tool.error = Boolean(p.isError); }
      }
    }
  }
  return out;
}
