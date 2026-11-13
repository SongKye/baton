// Antigravity CLI (agy) conversations.
// Index: ~/.gemini/antigravity-cli/conversation_summaries.db (sqlite)
// Transcript: ~/.gemini/antigravity-cli/conversations/<id>.db -> table steps(step_payload protobuf)
// The protobuf schema is not public, so we decode the wire format generically and pick known field paths:
//   step_type 14 (user input):      field 19.2  -> user text
//   step_type 15 (agent response):  field 20.1  -> reply text, 20.3 -> thinking, 20.7.{2,3} -> tool call name/args
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME, clip, oneLine, statSafe, cleanPrompt, eachJsonl } from '../util.js';
import { summarizeTool } from './common.js';
import { getKV } from '../store.js';
import { tr } from '../i18n.js';

const ROOT = path.join(HOME, '.gemini', 'antigravity-cli');
const SUMMARY_DB = path.join(ROOT, 'conversation_summaries.db');
const CONV_DIR = path.join(ROOT, 'conversations');
const HISTORY = path.join(ROOT, 'history.jsonl');

// Conversations the user typed into interactively (headless `agy -p` runs never appear here).
let histCache = { mtimeMs: 0, ids: new Set() };
async function interactiveIds() {
  const st = await statSafe(HISTORY);
  if (!st) return histCache.ids;
  if (st.mtimeMs === histCache.mtimeMs) return histCache.ids;
  const ids = new Set();
  await eachJsonl(HISTORY, (e) => { if (e.conversationId) ids.add(e.conversationId); });
  histCache = { mtimeMs: st.mtimeMs, ids };
  return ids;
}

function openRO(file) {
  return new DatabaseSync(file, { readOnly: true });
}

function parseTime(s) {
  if (!s) return null;
  // "2026-10-24 12:02:20.526228752+00:00"
  const m = String(s).match(/^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)(\.\d+)?(.*)$/);
  if (!m) return Date.parse(s) || null;
  const frac = m[3] ? m[3].slice(0, 4) : '';
  const tz = m[4] && m[4] !== '' ? m[4] : 'Z';
  return Date.parse(`${m[1]}T${m[2]}${frac}${tz}`) || null;
}

let listCache = { mtimeMs: 0, rows: [] };

async function existingConversations(rows) {
  // The CLI's summary DB can outlive a deleted conversation. Check cached rows too:
  // trash/restore changes the transcript files without touching the summary timestamp.
  const present = await Promise.all(rows.map((row) => statSafe(row.file)));
  return rows.filter((_, i) => present[i]?.isFile());
}

export async function listAgy() {
  const st = await statSafe(SUMMARY_DB);
  if (!st) return [];
  const wal = await statSafe(SUMMARY_DB + '-wal');
  const hist = await statSafe(HISTORY);
  const stamp = st.mtimeMs + (wal?.mtimeMs || 0) + (hist?.mtimeMs || 0);
  const typed = await interactiveIds();
  if (stamp === listCache.mtimeMs) return existingConversations(listCache.rows);
  const batonIds = new Set(getKV('baton_agy_ids', []) || []);
  let db;
  try { db = openRO(SUMMARY_DB); } catch { return existingConversations(listCache.rows); }
  const rows = [];
  try {
    for (const r of db.prepare(`SELECT conversation_id, title, preview, step_count, last_modified_time, workspace_uris,
        status, source, agent_name, nesting_depth, parent_conversation_id, last_user_input_time, not_fully_idle
        FROM conversation_summaries`).all()) {
      let ws = [];
      try { ws = JSON.parse(r.workspace_uris || '[]'); } catch { /* ignore */ }
      const cwd = ws[0] ? (String(ws[0]).startsWith('file:') ? fileURLToPath(ws[0]) : String(ws[0])) : null;
      const isSub = (r.nesting_depth || 0) > 0 || Boolean(r.parent_conversation_id);
      const automated = !batonIds.has(r.conversation_id) && (isSub || Boolean(cwd?.startsWith('/tmp')) || !typed.has(r.conversation_id));
      const preview = cleanPrompt(r.preview || '');
      rows.push({
        tool: 'agy',
        id: r.conversation_id,
        title: r.title || clip(oneLine(preview), 80) || (r.agent_name ? `${r.agent_name} ${tr('서브에이전트')}` : tr('(제목 없음)')),
        cwd,
        created: parseTime(r.last_user_input_time) || parseTime(r.last_modified_time),
        busy: Boolean(r.not_fully_idle) || (r.status && !/IDLE/.test(r.status)),
        updated: parseTime(r.last_modified_time),
        firstPrompt: clip(oneLine(preview), 240),
        steps: r.step_count || 0,
        lastPrompt: null,
        lastReply: null,
        model: null,
        automated,
        sub: isSub,
        background: automated && !isSub,
        agentName: r.agent_name || null,
        runStatus: r.status,
        steps: r.step_count,
        file: path.join(CONV_DIR, `${r.conversation_id}.db`),
      });
    }
  } catch {
    return existingConversations(listCache.rows);
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
  listCache = { mtimeMs: stamp, rows };
  return existingConversations(rows);
}

// ---------- generic protobuf wire decoding ----------
function readVarint(b, i) {
  let r = 0, s = 0, x;
  do {
    if (i >= b.length) throw new Error('eof');
    x = b[i++];
    r += (x & 0x7f) * 2 ** s;
    s += 7;
  } while (x & 0x80);
  return [r, i];
}

const utf8 = new TextDecoder('utf-8', { fatal: true });
// eslint-disable-next-line no-control-regex
const PLAIN_TEXT = /^[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+$/;

/** Returns a list of [path, string] leaves, or null if `b` is not a valid message. */
function decode(b, prefix, out, depth) {
  let i = 0;
  try {
    while (i < b.length) {
      let key;
      [key, i] = readVarint(b, i);
      const f = Math.floor(key / 8), t = key & 7;
      if (f === 0) return false;
      if (t === 0) { let v; [v, i] = readVarint(b, i); out.push([prefix ? `${prefix}.${f}` : String(f), v]); }
      else if (t === 1) i += 8;
      else if (t === 5) i += 4;
      else if (t === 2) {
        let len;
        [len, i] = readVarint(b, i);
        if (i + len > b.length) return false;
        const sub = b.subarray(i, i + len);
        i += len;
        const p = prefix ? `${prefix}.${f}` : String(f);
        let nested = false;
        if (depth < 14 && len > 1) {
          const tmp = [];
          if (decode(sub, p, tmp, depth + 1)) { out.push(...tmp); nested = true; }
        }
        // Short text can also parse as a message ("hi" = 0x68 0x69 = field 13, varint 105), which used to
        // drop one-word prompts. Real sub-messages start with control-byte tags (0x0a, 0x12…), so keep
        // the string too whenever the bytes read as plain text.
        let text = null;
        try { text = utf8.decode(sub); } catch { /* binary */ }
        if (text != null && (!nested || PLAIN_TEXT.test(text))) out.push([p, text]);
      } else return false;
    }
    return i === b.length;
  } catch {
    return false;
  }
}

function leaves(buf) {
  const out = [];
  decode(buf, '', out, 0);
  return out;
}

function first(lv, p) {
  const hit = lv.find(([k, v]) => k === p && typeof v === 'string');
  return hit ? hit[1] : null;
}
function firstNum(lv, p) {
  const hit = lv.find(([k, v]) => k === p && typeof v === 'number');
  return hit ? hit[1] : null;
}

export async function readAgy(file) {
  const msgs = [];
  let db;
  try { db = openRO(file); } catch { return msgs; }
  try {
    const rows = db.prepare('SELECT idx, step_type, step_payload FROM steps ORDER BY idx').all();
    for (const r of rows) {
      if (!r.step_payload) continue;
      const buf = Buffer.from(r.step_payload);
      if (r.step_type !== 14 && r.step_type !== 15) continue;
      const lv = leaves(buf);
      if (r.step_type === 14) {
        const t = first(lv, '19.2') || first(lv, '19.3.1');
        if (t) {
          // strip the attachment footer Baton adds for agy (see runner.agyCmd)
          const m = t.match(/\n*\[Baton 첨부 이미지 (\d+)장[^\]]*\][\s\S]*$/);
          msgs.push({ role: 'user', text: cleanPrompt(m ? t.slice(0, m.index) : t), ...(m ? { images: Number(m[1]) } : {}) });
        }
      } else {
        const think = first(lv, '20.3');
        if (think && think.trim()) msgs.push({ role: 'thinking', text: think });
        const text = first(lv, '20.1') || first(lv, '20.8');
        if (text && text.trim()) msgs.push({ role: 'assistant', text });
        // tool calls: 20.7.2 (name) followed by 20.7.3 (json args); there may be several
        let name = null;
        for (const [k, v] of lv) {
          if (k === '20.7.2') name = v;
          else if (k === '20.7.3' && name) {
            msgs.push({ role: 'tool', tool: { name, summary: summarizeTool(name, v), input: v } });
            name = null;
          }
        }
      }
    }
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
  return msgs;
}

/** Model id the conversation last generated with (gen_metadata field 3.28), e.g. "gemini-4-argon-medium". */
export function agyConversationModel(file) {
  let db;
  try { db = openRO(file); } catch { return null; }
  try {
    const r = db.prepare('SELECT data FROM gen_metadata ORDER BY idx DESC LIMIT 1').get();
    if (!r?.data) return null;
    const m = first(leaves(Buffer.from(r.data)), '3.28');
    return typeof m === 'string' ? m : null;
  } catch { return null; } finally { try { db.close(); } catch { /* ignore */ } }
}

/** Per-generation token usage: steps.step_payload field 5.9 {2: input (incl. cached), 3: output (incl. thinking), 5: cache read},
 *  timestamp from steps.metadata field 1.1 (unix seconds). */
export function agyUsage(file) {
  let db;
  try { db = openRO(file); } catch { return []; }
  const out = [];
  try {
    for (const r of db.prepare('SELECT metadata, step_payload FROM steps WHERE step_payload IS NOT NULL').all()) {
      const buf = Buffer.from(r.step_payload);
      const lv = leaves(buf);
      const input = firstNum(lv, '5.9.2');
      if (typeof input !== 'number') continue;
      let ts = null;
      if (r.metadata) { const m = firstNum(leaves(Buffer.from(r.metadata)), '1.1'); if (typeof m === 'number') ts = m * 1000; }
      out.push({ ts, input, output: firstNum(lv, '5.9.3') || 0, cacheRead: firstNum(lv, '5.9.5') || 0 });
    }
  } catch { /* ignore */ } finally { try { db.close(); } catch { /* ignore */ } }
  return out;
}

/** Agent steps (not user input) whose payload mentions a SKILL.md path -> the agent read that skill. */
export function agySkillReads(file) {
  let db;
  try { db = openRO(file); } catch { return []; }
  const out = [];
  try {
    for (const r of db.prepare("SELECT metadata, step_payload FROM steps WHERE step_type != 14 AND step_payload IS NOT NULL").all()) {
      const buf = Buffer.from(r.step_payload);
      if (buf.indexOf('SKILL.md') < 0) continue;
      let ts = null;
      if (r.metadata) { const m = firstNum(leaves(Buffer.from(r.metadata)), '1.1'); if (typeof m === 'number') ts = m * 1000; }
      // only the tool-call arguments, not big tool outputs that might list many skills
      const args = leaves(buf).filter(([k, v]) => typeof v === 'string' && v.includes('SKILL.md') && v.length < 2000).map(([, v]) => v);
      if (args.length) out.push({ ts, text: args.join('\n') });
    }
  } catch { /* ignore */ } finally { try { db.close(); } catch { /* ignore */ } }
  return out;
}
