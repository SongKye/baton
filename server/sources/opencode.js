// OpenCode 2 sessions (anomalyco/opencode, npm @opencode/cli). OpenCode 1 is not supported.
// Storage: <data>/opencode/opencode.db (SQLite), written by OpenCode's server:
//   session_v2       one row per session: id, parent_id, directory, title, time_created / time_updated /
//                    time_archived, and time_busy / time_idle (a run is in progress while time_busy > time_idle)
//   session_message  the conversation, ordered by seq; `type` + JSON `data`:
//                      user       { text, files: [{ mime, name, data }] }
//                      assistant  { model: { id, providerID, variant }, content: [reasoning | text | tool], tokens, time }
//                                 one row per model step; a tool is { name, state: { status, input, content, error } }
//                      idle       { outcome: succeeded | failed | interrupted, error? } after each turn
//                      system / agent-switched / …: notes for the model, not part of the conversation
// OpenCode 2 copies OpenCode 1's tables (session / message / part) into these on its first start, keeping the
// ids, titles and archived state, and leaves the old tables behind (only purged here).
// Sessions get file = "<db>#<sessionID>" so the rest of Baton can keep keying sessions by file.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import os from 'node:os';
import { clip, oneLine, cleanPrompt } from '../util.js';
import { summarizeTool, toolOutputText } from './common.js';
import { getKV } from '../store.js';

const DATA = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'); // Windows too
export const OPENCODE_DB = path.join(DATA, 'opencode', 'opencode.db');
const DB_PREFIX = `${OPENCODE_DB}#`;
export const isOpencodeDbRef = (file) => String(file || '').startsWith(DB_PREFIX);
export const opencodeSessionId = (file) => (isOpencodeDbRef(file) ? file.slice(DB_PREFIX.length) : path.basename(String(file || ''), '.json'));

const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

// Keep the full session in place during the restore window (archived sessions are hidden from OpenCode's own
// lists too; its server reads the column directly). Unlike read probes, mutations report errors to the trash caller.
export function changeOpencodeArchive(id, archived, purge = false) {
  if (!fs.existsSync(OPENCODE_DB)) throw new Error(`OpenCode database not found: ${OPENCODE_DB}`);
  const db = new DatabaseSync(OPENCODE_DB);
  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; BEGIN IMMEDIATE');
    const row = hasTable(db, 'session_v2') ? db.prepare('SELECT time_archived FROM session_v2 WHERE id = ?').get(id) : null;
    if (!row && !purge) throw new Error(`OpenCode session not found: ${id}`);
    if (purge) {
      // messages, parts, attachments and instructions cascade from session_v2
      if (row) db.prepare('DELETE FROM session_v2 WHERE id = ?').run(id);
      if (hasTable(db, 'session')) { // OpenCode 1's copy of a migrated session
        db.prepare('DELETE FROM part WHERE session_id = ?').run(id);
        db.prepare('DELETE FROM message WHERE session_id = ?').run(id);
        db.prepare('DELETE FROM session WHERE id = ?').run(id);
      }
    } else {
      db.prepare('UPDATE session_v2 SET time_archived = ? WHERE id = ?').run(archived, id);
    }
    db.exec('COMMIT');
    cache.delete(DB_PREFIX + id);
    return row?.time_archived ?? null;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* transaction may not have started */ }
    throw e;
  } finally { db.close(); }
}

function withDb(fn, fallback) {
  if (!fs.existsSync(OPENCODE_DB)) return fallback;
  let db;
  try { db = new DatabaseSync(OPENCODE_DB, { readOnly: true }); } catch { return fallback; }
  try { return fn(db); } catch { return fallback; } finally { try { db.close(); } catch { /* ignore */ } }
}

const parseEntry = (row) => { let d = {}; try { d = JSON.parse(row.data) || {}; } catch { /* keep the type */ } return { ...d, type: row.type }; };
const dbRows = (db, sessionId) => db.prepare('SELECT type, data FROM session_message WHERE session_id = ? ORDER BY seq').all(sessionId);
const dbEntries = (db, sessionId) => dbRows(db, sessionId).map(parseEntry);
const transcript = (file) => withDb((db) => dbEntries(db, opencodeSessionId(file)), []);

const content = (e) => (Array.isArray(e.content) ? e.content : []);
const replyText = (e) => content(e).filter((c) => c?.type === 'text' && c.text).map((c) => c.text).join('\n').trim();
const modelName = (m) => (m?.id ? `${m.providerID ? `${m.providerID}/` : ''}${m.id}` : null);

const cache = new Map(); // session file -> { stamp, row }

function rowFor({ s, entries, file, batonIds }) {
  const users = entries.filter((e) => e.type === 'user');
  const replies = entries.filter((e) => e.type === 'assistant');
  const lastAsst = [...replies].reverse().find((e) => replyText(e)) || replies[replies.length - 1];
  const first = users[0] ? String(users[0].text || '') : '';
  const last = users.length > 1 ? String(users[users.length - 1].text || '') : '';
  const updated = s.time_updated || s.time_created || 0;
  return {
    tool: 'opencode', id: s.id,
    title: s.title && !/^New session/i.test(s.title) ? s.title : clip(oneLine(cleanPrompt(first)), 80) || '(untitled)',
    cwd: s.directory || null,
    created: s.time_created || updated,
    updated,
    firstPrompt: clip(oneLine(cleanPrompt(first)), 240), lastPrompt: clip(oneLine(cleanPrompt(last)), 240), lastReply: clip(oneLine(lastAsst ? replyText(lastAsst) : ''), 400),
    model: modelName(lastAsst?.model),
    // same rule as Codex / Antigravity: a sub-session, or a throwaway /tmp run
    automated: !batonIds.has(s.id) && (Boolean(s.parent_id) || Boolean(s.directory?.startsWith('/tmp'))), file, size: s.size || 0,
  };
}

export async function listOpencode() {
  const batonIds = new Set(getKV('baton_opencode_ids', []) || []);
  return withDb((db) => {
    const out = [];
    const rows = db.prepare('SELECT id, parent_id, directory, title, time_created, time_updated, time_busy, time_idle FROM session_v2 WHERE time_archived IS NULL').all();
    for (const s of rows) {
      const file = DB_PREFIX + s.id;
      const stamp = `${s.time_updated}:${s.time_busy}:${s.time_idle}:${s.title}`; // the closing idle entry lands after time_updated
      const c = cache.get(file);
      if (c && c.stamp === stamp) { out.push(c.row); continue; }
      const raw = dbRows(db, s.id);
      const row = rowFor({ s: { ...s, size: raw.reduce((n, r) => n + String(r.data || '').length, 0) }, entries: raw.map(parseEntry), file, batonIds });
      cache.set(file, { stamp, row });
      out.push(row);
    }
    return out;
  }, []);
}

const toolOutput = (st) => (typeof st.output === 'string' ? st.output : st.content ? toolOutputText(st.content) : '') || undefined;

export async function readOpencode(file) {
  const out = [];
  for (const e of transcript(file)) {
    const ts = e.time?.created || null;
    if (e.type === 'user') {
      const text = cleanPrompt(String(e.text || '')).trim();
      const images = (Array.isArray(e.files) ? e.files : []).filter((f) => /^image\//.test(f?.mime || '')).length;
      if (text || images) out.push({ role: 'user', text, ts, ...(images ? { images } : {}) });
    } else if (e.type === 'assistant') {
      for (const c of content(e)) {
        if (c?.type === 'reasoning' && c.text?.trim()) out.push({ role: 'thinking', text: c.text, ts });
        else if (c?.type === 'text' && c.text?.trim()) out.push({ role: 'assistant', text: c.text, ts, model: e.model?.id });
        else if (c?.type === 'tool') {
          const st = c.state || {};
          const input = st.input || {};
          const failed = st.status === 'error';
          out.push({ role: 'tool', ts, tool: { name: c.name, summary: summarizeTool(c.name, input) || st.title || '', input, output: failed ? (st.error?.message || toolOutput(st)) : toolOutput(st), error: failed } });
        }
      }
      if (e.error) out.push({ role: 'system', text: String(e.error.message || e.error.data?.message || e.error.type || e.error.name || 'error'), ts });
    } else if (e.type === 'idle' && e.outcome === 'failed' && e.error) {
      out.push({ role: 'system', text: String(e.error.message || e.error.type || 'error'), ts });
    }
  }
  return out;
}

/** Token usage per model step: [{ ts, model, input, output, cacheRead, cacheWrite }]. */
export async function opencodeUsage(file) {
  return transcript(file).filter((e) => e.type === 'assistant' && e.tokens).map((e) => ({
    ts: e.time?.created || 0, model: modelName(e.model) || 'unknown',
    input: e.tokens.input || 0, output: (e.tokens.output || 0) + (e.tokens.reasoning || 0), cacheRead: e.tokens.cache?.read || 0, cacheWrite: e.tokens.cache?.write || 0,
  }));
}

/**
 * Sessions with a run in progress (time_busy after the last time_idle), from opencode.db:
 * Map id -> { directory, activity } where activity is the last time the db was touched for it. OpenCode writes at
 * step boundaries, so a quiet db is normal mid-reply; callers pair this with a process check and only use
 * `activity` as a fallback. A run whose process was killed hard never writes its idle entry, hence the window.
 */
export function opencodeInflight(windowMs = 12 * 3600_000) {
  return withDb((db) => {
    const out = new Map();
    const rows = db.prepare(`SELECT s.id, s.directory, s.time_updated AS su, s.time_busy AS sb,
        (SELECT MAX(time_updated) FROM session_message WHERE session_id = s.id) AS mu
      FROM session_v2 s
      WHERE s.time_archived IS NULL AND s.time_busy IS NOT NULL AND s.time_busy > COALESCE(s.time_idle, 0) AND s.time_busy >= ?`).all(Date.now() - windowMs);
    for (const r of rows) out.set(r.id, { directory: r.directory, activity: Math.max(r.su || 0, r.sb || 0, r.mu || 0) });
    return out;
  }, new Map());
}

/** Sessions changed since minMtime for the usage scanner: [{ p, st: { mtimeMs, size } }]. */
export function opencodeDbSessions(minMtime) {
  return withDb((db) => db.prepare('SELECT id, time_updated FROM session_v2 WHERE time_updated >= ?').all(minMtime)
    .map((r) => ({ p: DB_PREFIX + r.id, st: { mtimeMs: r.time_updated, size: 0 } })), []);
}

/** Signed in to any provider: OpenCode 2 keeps credentials in the db (`opencode auth login`), older installs in auth.json. */
export function opencodeSignedIn() {
  if (fs.existsSync(path.join(DATA, 'opencode', 'auth.json'))) return true;
  return withDb((db) => (hasTable(db, 'credential') ? db.prepare('SELECT COUNT(*) AS n FROM credential').get().n > 0 : false), false);
}

/** Changes whenever a credential is added, removed or refreshed (the model list depends on them). Never reads secrets. */
export function opencodeCredentialStamp() {
  return withDb((db) => {
    if (!hasTable(db, 'credential')) return '';
    const r = db.prepare('SELECT COUNT(*) AS n, MAX(time_updated) AS t FROM credential').get();
    return `${r.n}:${r.t || 0}`;
  }, '');
}
