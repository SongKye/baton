// Claude Code sessions: ~/.claude/projects/<slug>/<sessionId>.jsonl
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getKV } from '../store.js';
import { HOME, eachJsonl, headJsonl, tailJsonl, cleanPrompt, clip, oneLine, pidAlive, statSafe } from '../util.js';
import { summarizeTool, toolOutputText } from './common.js';

const PROJECTS = path.join(HOME, '.claude', 'projects');
const LIVE_DIR = path.join(HOME, '.claude', 'sessions');
const cache = new Map(); // file -> { mtimeMs, size, summary }
const batonIds = () => new Set(getKV('baton_claude_ids', []) || []);

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((p) => p?.type === 'text').map((p) => p.text).join('\n');
  return '';
}

function isRealUserPrompt(e) {
  if (e.type !== 'user' || e.isMeta || e.isSidechain) return false;
  const c = e.message?.content;
  if (Array.isArray(c) && c.some((p) => p?.type === 'tool_result')) return false;
  const t = cleanPrompt(textOf(c));
  if (!t) return false;
  if (t.startsWith('Caveat:') || t.startsWith('[Request interrupted')) return false;
  return true;
}

async function summarize(file, st) {
  const id = path.basename(file, '.jsonl');
  const head = await headJsonl(file, 96 * 1024, 300);
  const tail = st.size > 96 * 1024 ? await tailJsonl(file, 256 * 1024) : head;
  let cwd = null, created = null, entrypoint = null, firstPrompt = null, gitBranch = null;
  for (const e of head) {
    if (!cwd && e.cwd) cwd = e.cwd;
    if (!created && e.timestamp) created = Date.parse(e.timestamp);
    if (!entrypoint && e.entrypoint) entrypoint = e.entrypoint;
    if (!gitBranch && e.gitBranch) gitBranch = e.gitBranch;
    if (!firstPrompt && isRealUserPrompt(e)) firstPrompt = cleanPrompt(textOf(e.message.content));
  }
  let aiTitle = null, customTitle = null, summaryTitle = null, lastPrompt = null, lastReply = null, updated = null, model = null, sidechainOnly = true;
  const scan = (arr) => {
    for (const e of arr) {
      if (e.type === 'ai-title' && e.aiTitle) aiTitle = e.aiTitle;
      if (e.type === 'custom-title' && e.customTitle) customTitle = e.customTitle;
      if (e.type === 'summary' && e.summary) summaryTitle = e.summary;
      if (e.timestamp) updated = Date.parse(e.timestamp) || updated;
      if (e.isSidechain === false) sidechainOnly = false;
      if (isRealUserPrompt(e)) lastPrompt = cleanPrompt(textOf(e.message.content));
      if (e.type === 'assistant' && !e.isSidechain) {
        const t = textOf(e.message?.content);
        if (t && t.trim()) lastReply = t;
        if (e.message?.model && !e.message.model.startsWith('<')) model = e.message.model;
      }
    }
  };
  scan(head);
  if (tail !== head) scan(tail);
  if (!aiTitle && !customTitle && st.size < 8 * 1024 * 1024 && tail !== head) {
    await eachJsonl(file, (e) => {
      if (e.type === 'ai-title' && e.aiTitle) aiTitle = e.aiTitle;
      if (e.type === 'custom-title' && e.customTitle) customTitle = e.customTitle;
    });
  }
  if (!firstPrompt && !lastPrompt && !aiTitle) return null; // empty / metadata-only file
  const isTmp = cwd?.startsWith('/tmp');
  return {
    tool: 'claude',
    id,
    title: customTitle || aiTitle || summaryTitle || clip(oneLine(firstPrompt || lastPrompt), 80) || '(제목 없음)',
    cwd,
    created: created || st.birthtimeMs,
    updated: updated || st.mtimeMs,
    firstPrompt: clip(oneLine(firstPrompt), 240),
    lastPrompt: clip(oneLine(lastPrompt), 240),
    lastReply: clip(oneLine(lastReply), 400),
    model,
    gitBranch,
    automated: Boolean(isTmp || sidechainOnly || (/^sdk/.test(entrypoint || '') && !batonIds().has(id))),
    entrypoint,
    file,
    size: st.size,
  };
}

export async function listClaude() {
  const out = [];
  let dirs = [];
  try { dirs = await fsp.readdir(PROJECTS, { withFileTypes: true }); } catch { return out; }
  const seen = new Set();
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(PROJECTS, d.name);
    let files = [];
    try { files = await fsp.readdir(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const file = path.join(dir, f);
      seen.add(file);
      const st = await statSafe(file);
      if (!st) continue;
      const c = cache.get(file);
      if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) { if (c.summary) out.push(c.summary); continue; }
      let summary = null;
      try { summary = await summarize(file, st); } catch { summary = null; }
      cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, summary });
      if (summary) out.push(summary);
    }
  }
  for (const k of cache.keys()) if (!seen.has(k)) cache.delete(k);
  return out;
}

/** Live interactive Claude processes (from ~/.claude/sessions/<pid>.json). */
export async function liveClaude() {
  const live = new Map();
  let files = [];
  try { files = await fsp.readdir(LIVE_DIR); } catch { return live; }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const j = JSON.parse(await fsp.readFile(path.join(LIVE_DIR, f), 'utf8'));
      if (!j.pid || !pidAlive(j.pid)) continue;
      live.set(j.sessionId, { pid: j.pid, status: j.status || 'idle', kind: j.kind, since: j.startedAt, updatedAt: j.updatedAt });
    } catch { /* ignore */ }
  }
  return live;
}

/** Full transcript as unified messages. */
export async function readClaude(file) {
  const msgs = [];
  const toolById = new Map();
  await eachJsonl(file, (e) => {
    if (e.isSidechain) return;
    const ts = e.timestamp ? Date.parse(e.timestamp) : null;
    if (e.type === 'system' && e.subtype === 'compact_boundary') {
      msgs.push({ role: 'system', text: '대화가 압축(compact)되었어요', ts });
      return;
    }
    if (e.type === 'user') {
      const c = e.message?.content;
      if (Array.isArray(c)) {
        for (const p of c) {
          if (p?.type === 'tool_result') {
            const t = toolById.get(p.tool_use_id);
            if (t) { t.tool.output = toolOutputText(p.content); t.tool.error = Boolean(p.is_error); }
          }
        }
      }
      if (e.isMeta || e.isCompactSummary) return;
      const raw = textOf(c);
      if (!raw) return;
      if (/<local-command-stdout>/.test(raw)) {
        const out = raw.replace(/[\s\S]*<local-command-stdout>([\s\S]*?)<\/local-command-stdout>[\s\S]*/, '$1').trim();
        if (out) msgs.push({ role: 'system', text: clip(out, 2000), ts });
        return;
      }
      const t = cleanPrompt(raw);
      if (!t || t.startsWith('Caveat:')) return;
      msgs.push({ role: 'user', text: t, ts, images: Array.isArray(c) ? c.filter((p) => p?.type === 'image').length : 0 });
      return;
    }
    if (e.type === 'assistant') {
      const c = e.message?.content;
      if (!Array.isArray(c)) return;
      for (const p of c) {
        if (p.type === 'text' && p.text?.trim()) {
          if (p.text.startsWith('No response requested')) continue;
          msgs.push({ role: 'assistant', text: p.text, ts, model: e.message?.model });
        } else if (p.type === 'tool_use') {
          const m = { role: 'tool', ts, tool: { name: p.name, summary: summarizeTool(p.name, p.input), input: p.input } };
          toolById.set(p.id, m);
          msgs.push(m);
        } else if (p.type === 'thinking' && p.thinking?.trim()) {
          msgs.push({ role: 'thinking', text: p.thinking, ts });
        }
      }
    }
  });
  return msgs;
}
