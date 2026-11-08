// OpenCode (sst/opencode) sessions.
// Storage (JSON files): <data>/opencode/storage/
//   session/<projectID>/<sessionID>.json   { id, title, directory, parentID?, time:{created,updated} }
//   message/<sessionID>/<messageID>.json   { id, role, time:{created}, modelID, providerID, tokens:{input,output,reasoning,cache:{read,write}} }
//   part/<messageID>/<partID>.json         { type: text|reasoning|tool|file|step-*, text?, tool?, state?:{status,input,output} }
// OpenCode 1.x moved to SQLite: <data>/opencode/opencode.db, tables session / message / part, where
// message.data and part.data hold the same JSON as the old files (minus id). Sessions from the db get
// file = "<db>#<sessionID>" so the rest of Baton can keep keying sessions by file.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import os from 'node:os';
import { statSafe, clip, oneLine, cleanPrompt } from '../util.js';
import { summarizeTool } from './common.js';
import { getKV } from '../store.js';

const DATA = process.env.XDG_DATA_HOME || (process.platform === 'win32'
  ? path.join(os.homedir(), '.local', 'share')
  : path.join(os.homedir(), '.local', 'share'));
export const OPENCODE_STORAGE = path.join(DATA, 'opencode', 'storage');
export const OPENCODE_DB = path.join(DATA, 'opencode', 'opencode.db');
const DB_PREFIX = `${OPENCODE_DB}#`;
export const isOpencodeDbRef = (file) => String(file || '').startsWith(DB_PREFIX);
export const opencodeSessionId = (file) => (isOpencodeDbRef(file) ? file.slice(DB_PREFIX.length) : path.basename(file, '.json'));

function withDb(fn, fallback) {
  if (!fs.existsSync(OPENCODE_DB)) return fallback;
  let db;
  try { db = new DatabaseSync(OPENCODE_DB, { readOnly: true }); } catch { return fallback; }
  try { return fn(db); } catch { return fallback; } finally { try { db.close(); } catch { /* ignore */ } }
}
const parseData = (row) => { try { return { id: row.id, ...JSON.parse(row.data) }; } catch { return { id: row.id }; } };
const dbMessages = (db, sessionId) => db.prepare('SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created, id').all(sessionId).map(parseData);
const dbParts = (db, messageId) => db.prepare('SELECT id, data FROM part WHERE message_id = ? ORDER BY time_created, id').all(messageId).map(parseData);

const readJson = async (p) => { try { return JSON.parse(await fsp.readFile(p, 'utf8')); } catch { return null; } };
async function jsonDir(dir) {
  let names = [];
  try { names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.json')).sort(); } catch { return []; }
  const out = [];
  for (const n of names) { const j = await readJson(path.join(dir, n)); if (j) out.push(j); }
  return out;
}

async function fileMessages(sessionId) {
  const msgs = await jsonDir(path.join(OPENCODE_STORAGE, 'message', sessionId));
  msgs.sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0) || String(a.id).localeCompare(String(b.id)));
  return msgs;
}
const fileParts = (messageId) => jsonDir(path.join(OPENCODE_STORAGE, 'part', messageId));

/** [{ ...message, parts: [...] }] for a session, from either backend. */
async function transcript(file) {
  if (isOpencodeDbRef(file)) {
    const id = opencodeSessionId(file);
    return withDb((db) => dbMessages(db, id).map((m) => ({ ...m, parts: dbParts(db, m.id) })), []);
  }
  const s = await readJson(file);
  if (!s?.id) return [];
  const out = [];
  for (const m of await fileMessages(s.id)) out.push({ ...m, parts: await fileParts(m.id) });
  return out;
}
const textOfParts = (parts) => parts.filter((p) => p.type === 'text' && !p.synthetic && p.text).map((p) => p.text).join('\n').trim();

const cache = new Map(); // session file -> { stamp, row }

function rowFor({ s, msgs, file, updated, size, batonIds }) {
  const users = msgs.filter((m) => m.role === 'user');
  const lastAsst = [...msgs].reverse().find((m) => m.role === 'assistant');
  const first = users[0] ? textOfParts(users[0].parts) : '';
  const last = users.length > 1 ? textOfParts(users[users.length - 1].parts) : '';
  const reply = lastAsst ? textOfParts(lastAsst.parts) : '';
  const model = lastAsst?.modelID ? `${lastAsst.providerID ? lastAsst.providerID + '/' : ''}${lastAsst.modelID}` : null;
  return {
    tool: 'opencode', id: s.id,
    title: s.title && !/^New session/i.test(s.title) ? s.title : clip(oneLine(cleanPrompt(first)), 80) || '(untitled)',
    cwd: s.directory || null,
    created: s.time?.created || updated,
    updated,
    firstPrompt: clip(oneLine(cleanPrompt(first)), 240), lastPrompt: clip(oneLine(cleanPrompt(last)), 240), lastReply: clip(oneLine(reply), 400),
    model, automated: Boolean(s.parentID) && !batonIds.has(s.id), file, size,
  };
}

/** Sessions in opencode.db (OpenCode 1.x). */
function listDbSessions(batonIds) {
  return withDb((db) => {
    const out = [];
    const rows = db.prepare('SELECT id, parent_id, directory, title, time_created, time_updated, time_archived FROM session').all();
    for (const r of rows) {
      if (r.time_archived) continue;
      const file = DB_PREFIX + r.id;
      const stamp = String(r.time_updated);
      const c = cache.get(file);
      if (c && c.stamp === stamp) { out.push(c.row); continue; }
      const msgs = dbMessages(db, r.id).map((m) => ({ ...m, parts: dbParts(db, m.id) }));
      const s = { id: r.id, title: r.title, directory: r.directory, parentID: r.parent_id, time: { created: r.time_created, updated: r.time_updated } };
      const size = msgs.reduce((n, m) => n + JSON.stringify(m).length, 0); // ~ what the old JSON files weighed
      const row = rowFor({ s, msgs, file, updated: r.time_updated, size, batonIds });
      cache.set(file, { stamp, row });
      out.push(row);
    }
    return out;
  }, []);
}

export async function listOpencode() {
  const batonIds = new Set(getKV('baton_opencode_ids', []) || []);
  const out = listDbSessions(batonIds);
  const seen = new Set(out.map((r) => r.id));
  const root = path.join(OPENCODE_STORAGE, 'session');
  let projects = [];
  try { projects = await fsp.readdir(root); } catch { return out; }
  for (const proj of projects) {
    let files = [];
    try { files = (await fsp.readdir(path.join(root, proj))).filter((f) => f.endsWith('.json')); } catch { continue; }
    for (const f of files) {
      const file = path.join(root, proj, f);
      const st = await statSafe(file);
      if (!st) continue;
      const s = await readJson(file);
      if (!s?.id || seen.has(s.id)) continue; // already migrated into opencode.db
      const mdir = await statSafe(path.join(OPENCODE_STORAGE, 'message', s.id));
      const stamp = `${st.mtimeMs}:${mdir?.mtimeMs || 0}`;
      const c = cache.get(file);
      if (c && c.stamp === stamp) { out.push(c.row); continue; }
      let msgs = [];
      try { msgs = await transcript(file); } catch { /* partial */ }
      const updated = Math.max(s.time?.updated || 0, mdir?.mtimeMs || 0) || st.mtimeMs;
      const row = rowFor({ s: { ...s, time: { ...s.time, created: s.time?.created || st.birthtimeMs } }, msgs, file, updated, size: st.size, batonIds });
      cache.set(file, { stamp, row });
      out.push(row);
    }
  }
  return out;
}

export async function readOpencode(file) {
  const out = [];
  for (const m of await transcript(file)) {
    const ts = m.time?.created || null;
    const parts = m.parts;
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
  return (await transcript(file)).filter((m) => m.role === 'assistant' && m.tokens).map((m) => ({
    ts: m.time?.created || 0, model: m.modelID ? `${m.providerID ? m.providerID + '/' : ''}${m.modelID}` : 'unknown',
    input: m.tokens.input || 0, output: (m.tokens.output || 0) + (m.tokens.reasoning || 0), cacheRead: m.tokens.cache?.read || 0, cacheWrite: m.tokens.cache?.write || 0,
  }));
}

/** Every session id in opencode.db (legacy JSON copies of these must not be counted again). */
export function opencodeDbSessionIds() {
  return new Set(withDb((db) => db.prepare('SELECT id FROM session').all().map((r) => r.id), []));
}

/** Sessions changed since minMtime for the usage scanner: [{ p, st: { mtimeMs, size } }] (db sessions only). */
export function opencodeDbSessions(minMtime) {
  return withDb((db) => db.prepare('SELECT id, time_updated FROM session WHERE time_updated >= ?').all(minMtime)
    .map((r) => ({ p: DB_PREFIX + r.id, st: { mtimeMs: r.time_updated, size: 0 } })), []);
}
