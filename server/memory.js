// Shared project memory across AI CLIs in Baton.
//
// 3-Speed lifecycle (Baton chat runs only):
//   L0 (instant, 0 tokens): record turn activity + AskUserQuestion choices from run.events,
//       update .baton/sessions/<tool>-<id8>.md in neutral reference mode.
//   L1 (debounced, lightweight AI oneShot): incrementally extract durable decisions, feedback,
//       gotchas, state and references as JSON add/update/remove, serialized per project.
//   L2 (periodic Auto-Dream consolidation): merge duplicates, prune completed state, resolve
//       contradictions and relative dates while keeping user-pinned items untouched.
//
// 3-Layer progressive disclosure on read:
//   Layer 1: tight <=4,000-char trailing <baton-memory> block (full on turn 1, delta-only after
//            so prompt caches stay intact, plus <1ms Korean+English BM25 smart recall).
//   Layer 2: <project>/.baton/memory.md index + .baton/memory/<topic>.md files on disk.
//   Layer 3: <project>/.baton/sessions/<tool>-<id8>.md reference logs readable by any CLI.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { db, getKV, setKV, getSettings, getProjectMeta } from './store.js';
import { projectRoot, gitInfo } from './projects.js';
import { findSession, readMessages, forceRefresh } from './indexer.js';
import { oneShot } from './runner.js';
import { buildHandoffNote, claudeMemory, filesTouched } from './handoff.js';
import { aiTarget } from './brief.js';
import { listPortsCached } from './ports.js';
import { prettyCmd } from './servers.js';
import { allLimits } from './limits.js';
import { TOOLS } from './tools.js';
import { HOME, ROOT, clip, oneLine, shortHome, cleanPrompt } from './util.js';
import { tr, lang } from './i18n.js';

// ---------- schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS project_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  tags TEXT,
  source_key TEXT,
  branch TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  removed INTEGER NOT NULL DEFAULT 0,
  removed_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_pm_proj_seq ON project_memory(project, seq);
CREATE INDEX IF NOT EXISTS idx_pm_proj_active ON project_memory(project, removed, pinned, updated);

CREATE TABLE IF NOT EXISTS project_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  key TEXT NOT NULL,
  tool TEXT NOT NULL,
  branch TEXT,
  ts INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  line TEXT NOT NULL,
  detail TEXT,
  files TEXT
);
CREATE INDEX IF NOT EXISTS idx_pa_proj_seq ON project_activity(project, seq);

CREATE TABLE IF NOT EXISTS project_memory_state (
  project TEXT PRIMARY KEY,
  seq INTEGER NOT NULL DEFAULT 0,
  extractions_since_dream INTEGER NOT NULL DEFAULT 0,
  last_dream_at INTEGER,
  pending_turn_seq INTEGER NOT NULL DEFAULT 0,
  extracted_turn_seq INTEGER NOT NULL DEFAULT 0
);
`);

const q = (sql) => db.prepare(sql);
const VALID_KINDS = new Set(['decision', 'feedback', 'state', 'gotcha', 'reference']);
const KIND_ALIASES = { convention: 'feedback', preference: 'feedback', rule: 'feedback', caution: 'gotcha', warning: 'gotcha', bug: 'gotcha', todo: 'state', progress: 'state', status: 'state', ref: 'reference', link: 'reference' };
const MAX_INLINE_CHARS = 4000;
const MAX_ACTIVITIES_PER_PROJECT = 60;
const PORT_TIMEOUT_MS = 250;

const cfg = {
  debounceMs: 10_000,
  dreamExtractions: 12,
  dreamActiveLimit: 35,
  dreamCooldownMs: 6 * 3600_000,
  oneShotFn: null, // test hook override
  projectRootFn: null, // test hook override when HOME itself lives in os.tmpdir()
};

/** Test hook to tune timings or inject a deterministic oneShot stub. */
export function configureMemory(patch = {}) {
  for (const k of Object.keys(cfg)) {
    if (k in patch) cfg[k] = patch[k];
  }
}

export function normalizeKind(raw) {
  const k = String(raw || '').trim().toLowerCase();
  if (VALID_KINDS.has(k)) return k;
  return KIND_ALIASES[k] || 'decision';
}

const toolLabel = (id) => TOOLS[id]?.name || id || 'CLI';
const sourceTool = (sourceKey) => {
  if (!sourceKey || sourceKey === 'user') return 'user';
  return String(sourceKey).split(':')[0] || 'unknown';
};

// ---------- project eligibility ----------
function normDir(p) {
  return path.resolve(String(p)).replace(/[\\/]+$/, '');
}

/** Resolve the project root eligible for shared memory, or null for HOME / workspace containers / worktrees / tmp. */
export function memoryProject(cwd) {
  if (!cwd) return null;
  // Check POSIX temp dirs before path.resolve: on Windows it turns `/tmp/x` into `D:\tmp\x`.
  if (/^\/(?:var\/)?tmp(?:\/|$)/.test(String(cwd))) return null;
  const abs = normDir(cwd);
  if (/[\\/]\.claude[\\/]worktrees(?:[\\/]|$)|[\\/]\.codex(?:[\\/]|$)/.test(abs)) return null;
  const root = (cfg.projectRootFn || projectRoot)(abs);
  if (!root) return null;
  const nr = normDir(root);
  if (nr === normDir(HOME) || nr === normDir(path.join(HOME, 'workspace'))) return null;
  const wsRoots = getSettings().workspaceRoots || [];
  for (const r of wsRoots) {
    const exp = r.startsWith('~') ? path.join(HOME, r.slice(1)) : r;
    if (nr === normDir(exp)) return null;
  }
  return root;
}

export function isMemoryEnabled(project) {
  if (!project) return false;
  if (getSettings().sharedMemory === false) return false;
  const meta = getProjectMeta(project);
  return !meta?.memory_off;
}

// ---------- secret redaction ----------
const SECRET_PATTERNS = [
  [/\b(sk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,})\b/g, '[REDACTED_KEY]'],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED_TOKEN]'],
  [/\b(AIza[A-Za-z0-9_-]{20,})\b/g, '[REDACTED_KEY]'],
  [/\b(AKIA[0-9A-Z]{16})\b/g, '[REDACTED_AWS_KEY]'],
  [/\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g, '[REDACTED_SLACK_TOKEN]'],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/-]{20,}=*/gi, '$1[REDACTED]'],
  [/((?:API_KEY|SECRET_KEY|ACCESS_TOKEN|PRIVATE_KEY|PASSWORD|PASSWD|AUTH_TOKEN)\s*[:=]\s*["']?)([^\s"'`]{8,})(["']?)/gi, '$1[REDACTED]$3'],
];

export function redactSecrets(text) {
  let s = String(text || '');
  for (const [re, rep] of SECRET_PATTERNS) s = s.replace(re, rep);
  return s;
}

// ---------- monotonic project seq ----------
function ensureState(project) {
  q('INSERT OR IGNORE INTO project_memory_state (project, seq) VALUES (?, 0)').run(project);
  return q('SELECT * FROM project_memory_state WHERE project = ?').get(project);
}

function nextSeq(project) {
  ensureState(project);
  const row = q('UPDATE project_memory_state SET seq = seq + 1 WHERE project = ? RETURNING seq').get(project);
  return row.seq;
}

export function getProjectMemoryState(project) {
  return ensureState(project);
}

// ---------- Korean + English hybrid BM25 smart recall ----------
const KO_PARTICLES = /(?:으로서|으로써|으로부터|에서부터|까지도|에서는|에서도|으로는|으로도|한테서|에게는|에게도|이라도|이나마|처럼|보다|까지|부터|에서|에게|한테|으로|라고|이랑|하고|이나|이며|인데|거든|은|는|이|가|을|를|의|에|로|도|만|와|과|랑)$/;
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'what', 'when', 'where', 'which', 'how', 'why',
  'can', 'could', 'would', 'should', 'please', 'make', 'just', 'like', 'into', 'about', 'then', 'than', 'also',
  '어떻게', '무엇', '이거', '저거', '그거', '여기', '저기', '거기', '해주세요', '해줘', '해줄래', '알려줘', '확인', '한번', '다시', '지금', '방금', '그냥', '좀', '그리고', '하지만', '그런데', '있는', '없는', '하는', '되는', '하고', '해서', '하자', '할까',
]);

export function tokenizeSearch(text) {
  const raw = String(text || '').replace(/<baton-memory>[\s\S]*?<\/baton-memory>/g, ' ');
  const out = new Set();
  const chunks = raw.split(/[\s,.;:!?()[\]{}"'`<>|+=*~@#$%^&]+/).filter(Boolean);
  for (const c of chunks) {
    // split file paths and camelCase / snake_case identifiers
    const subParts = c.split(/[\\/._-]+/).filter(Boolean);
    const expanded = [];
    for (const p of subParts) {
      expanded.push(p);
      const camel = p.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ');
      if (camel.length > 1) expanded.push(...camel);
    }
    if (c.includes('/') || c.includes('.')) expanded.push(c);
    for (const part of expanded) {
      let tok = part.toLowerCase().trim();
      if (!tok) continue;
      if (/[가-힣]/.test(tok)) {
        if (tok.length >= 2 && !STOP_WORDS.has(tok)) out.add(tok);
        const stem = tok.replace(KO_PARTICLES, '');
        if (stem.length >= 2 && stem !== tok && !STOP_WORDS.has(stem)) out.add(stem);
      } else {
        if (tok.length >= 2 && !STOP_WORDS.has(tok)) out.add(tok);
      }
    }
  }
  return [...out];
}

function scoreDocument(docText, docTags, queryTokens, dfMap, totalDocs) {
  if (!queryTokens.length) return 0;
  const hay = `${docText || ''} ${docTags || ''}`.toLowerCase();
  const docToks = new Set(tokenizeSearch(hay));
  const tagLower = String(docTags || '').toLowerCase();
  let score = 0;
  let matched = 0;
  for (const qt of queryTokens) {
    const idf = Math.log(1 + (totalDocs + 1) / ((dfMap.get(qt) || 0) + 1));
    if (docToks.has(qt)) {
      score += 3.0 * idf;
      matched++;
    } else if (qt.length >= 2 && hay.includes(qt)) {
      score += 2.0 * idf;
      matched++;
    }
    if (tagLower && tagLower.includes(qt)) score += 1.2 * idf;
  }
  if (matched === 0) return 0;
  // Bonus when multiple distinct query tokens co-occur in the same memory
  if (matched >= 2) score *= 1 + 0.25 * Math.min(matched - 1, 3);
  return score;
}

export function recallRelevant(project, prompt, { excludeMemIds = new Set(), excludeActIds = new Set(), limit = 4, minScore = 2.6 } = {}) {
  const queryTokens = tokenizeSearch(prompt);
  if (!queryTokens.length) return { memories: [], activities: [] };

  const allMems = q('SELECT * FROM project_memory WHERE project = ? AND removed = 0').all(project);
  const allActs = q('SELECT * FROM project_activity WHERE project = ? ORDER BY id DESC LIMIT ?').all(project, MAX_ACTIVITIES_PER_PROJECT);
  const totalDocs = allMems.length + allActs.length;
  if (!totalDocs) return { memories: [], activities: [] };

  // Document frequency across this project's corpus
  const dfMap = new Map();
  const countDf = (s) => {
    const low = String(s || '').toLowerCase();
    for (const qt of queryTokens) {
      if (low.includes(qt)) dfMap.set(qt, (dfMap.get(qt) || 0) + 1);
    }
  };
  for (const m of allMems) countDf(`${m.text} ${m.tags || ''}`);
  for (const a of allActs) countDf(`${a.line} ${a.detail || ''} ${a.files || ''}`);

  const now = Date.now();
  const scoredMems = [];
  for (const m of allMems) {
    if (excludeMemIds.has(m.id)) continue;
    let sc = scoreDocument(m.text, m.tags, queryTokens, dfMap, totalDocs);
    if (sc < minScore) continue;
    const ageDays = Math.max(0, (now - m.updated) / 86_400_000);
    sc *= 1 + 0.15 / (1 + ageDays / 14);
    scoredMems.push({ row: m, score: sc });
  }
  scoredMems.sort((a, b) => b.score - a.score);

  const scoredActs = [];
  for (const a of allActs) {
    if (excludeActIds.has(a.id)) continue;
    let sc = scoreDocument(`${a.line} ${a.detail || ''}`, a.files, queryTokens, dfMap, totalDocs);
    if (sc < minScore + 0.8) continue;
    const ageDays = Math.max(0, (now - a.ts) / 86_400_000);
    sc *= 1 + 0.15 / (1 + ageDays / 7);
    scoredActs.push({ row: a, score: sc });
  }
  scoredActs.sort((a, b) => b.score - a.score);

  const memories = scoredMems.slice(0, limit).map((x) => x.row);
  const actCap = Math.max(0, limit - memories.length);
  const activities = scoredActs.slice(0, Math.min(2, actCap || 1)).map((x) => x.row);
  return { memories, activities };
}

// ---------- disk mirror (.baton/memory.md & .baton/memory/*.md) ----------
function fmtShortDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtIsoDate(ts) {
  return ts ? new Date(ts).toISOString().slice(0, 10) : '';
}

async function ensureBatonDir(project) {
  const dir = path.join(project, '.baton');
  await fsp.mkdir(dir, { recursive: true });
  const gi = path.join(dir, '.gitignore');
  if (!fs.existsSync(gi)) await fsp.writeFile(gi, '*\n').catch(() => {});
  return dir;
}

const TOPIC_MAP = [
  ['decisions.md', 'Decisions', ['decision']],
  ['feedback.md', 'Feedback & Conventions', ['feedback']],
  ['gotchas.md', 'Gotchas & Cautions', ['gotcha']],
  ['state.md', 'Current State & References', ['state', 'reference']],
];

export async function mirrorMemoryFiles(project) {
  if (!project || !fs.existsSync(project)) return;
  try {
    const batonDir = await ensureBatonDir(project);
    const memDir = path.join(batonDir, 'memory');
    await fsp.mkdir(memDir, { recursive: true });
    const rows = q('SELECT * FROM project_memory WHERE project = ? AND removed = 0 ORDER BY pinned DESC, updated DESC').all(project);
    const acts = q('SELECT * FROM project_activity WHERE project = ? ORDER BY id DESC LIMIT 12').all(project);

    const fmtRow = (r) => {
      const who = r.source_key === 'user' ? 'user' : toolLabel(sourceTool(r.source_key));
      const pin = r.pinned ? '📌 ' : '';
      const br = r.branch ? ` · ${r.branch}` : '';
      return `- ${pin}[${r.kind} · ${who} · ${fmtIsoDate(r.updated)}${br}] ${r.text}`;
    };

    const indexLines = [
      `# Baton Shared Project Memory`,
      '',
      `> Automatically maintained by Baton across AI CLIs for \`${shortHome(project)}\`.`,
      `> Updated: ${new Date().toISOString()} · Active items: ${rows.length}`,
      '',
    ];
    const pinned = rows.filter((r) => r.pinned);
    if (pinned.length) {
      indexLines.push('## Pinned (Follow Strictly)', ...pinned.map(fmtRow), '');
    }
    for (const [file, title, kinds] of TOPIC_MAP) {
      const list = rows.filter((r) => !r.pinned && kinds.includes(r.kind));
      const allForTopic = rows.filter((r) => kinds.includes(r.kind));
      const topicBody = [`# ${title}`, '', ...(allForTopic.length ? allForTopic.map(fmtRow) : ['_(none)_']), ''].join('\n');
      await fsp.writeFile(path.join(memDir, file), topicBody);
      if (list.length) {
        indexLines.push(`## ${title} (\`.baton/memory/${file}\`)`, ...list.map(fmtRow), '');
      }
    }
    if (acts.length) {
      indexLines.push('## Recent Activity', ...acts.map((a) => `- [${fmtIsoDate(a.ts)} · ${toolLabel(a.tool)}] ${a.line}`), '');
    }
    await fsp.writeFile(path.join(batonDir, 'memory.md'), indexLines.join('\n'));
  } catch (e) {
    console.warn('[memory] mirror failed:', e.message);
  }
}

async function writeSessionReference(project, tool, sessionId) {
  if (!project || !tool || !sessionId || !fs.existsSync(project)) return null;
  try {
    await forceRefresh();
    const s = await findSession(tool, sessionId);
    if (!s) return null;
    const msgs = await readMessages(s);
    if (!msgs.length) return null;
    const batonDir = await ensureBatonDir(project);
    const sessDir = path.join(batonDir, 'sessions');
    await fsp.mkdir(sessDir, { recursive: true });
    const safeId = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 8) || 'session';
    const file = path.join(sessDir, `${tool}-${safeId}.md`);
    const note = await buildHandoffNote(s, msgs, { budget: 16_000, mode: 'reference' });
    await fsp.writeFile(file, redactSecrets(note));
    return path.relative(project, file).replace(/\\/g, '/');
  } catch (e) {
    console.warn('[memory] session file failed:', e.message);
    return null;
  }
}

// ---------- turn data extraction from run.events (L0, zero disk race) ----------
function extractTurnFromRun(run) {
  const userText = cleanPrompt(run.prompt || '');
  const textParts = [];
  const editedFiles = new Set();
  const toolSummaries = [];
  const askMap = new Map();
  const qaPairs = [];

  for (const ev of run.events || []) {
    if (ev.t === 'text' && ev.text) textParts.push(ev.text);
    else if (ev.t === 'text_end') textParts.push('\n');
    else if (ev.t === 'tool') {
      const name = String(ev.name || '');
      const sum = String(ev.summary || '');
      if (sum) toolSummaries.push(`${name}(${clip(oneLine(sum), 80)})`);
      if (/edit|write|patch|create|replace|multi|file_change/i.test(name) && sum) {
        for (const p of sum.split(/,\s*/)) {
          const clean = p.replace(/^(?:update|add|delete|create|modify)\s+/i, '').trim();
          if (clean) editedFiles.add(clean);
        }
      }
    } else if (ev.t === 'ask' && ev.requestId) {
      askMap.set(ev.requestId, (ev.questions || []).map((x) => x.question).filter(Boolean));
    } else if (ev.t === 'ask_done' && ev.answers) {
      for (const [question, answer] of Object.entries(ev.answers)) {
        if (answer) qaPairs.push(`Q: ${clip(oneLine(question), 120)} -> A: ${clip(oneLine(answer), 160)}`);
      }
    }
  }

  let reply = textParts.join('').trim();
  if (!reply) {
    const doneEv = [...(run.events || [])].reverse().find((e) => e.t === 'done');
    reply = String(doneEv?.result || run.result?.result || '').trim();
  }
  const files = [...editedFiles].slice(0, 12);
  const safeUser = redactSecrets(userText);
  const safeReply = redactSecrets(reply);
  const safeQa = qaPairs.map(redactSecrets);

  const lineParts = [];
  if (safeUser) lineParts.push(`"${clip(oneLine(safeUser), 90)}"`);
  if (files.length) lineParts.push(`files: ${clip(files.join(', '), 80)}`);
  if (safeQa.length) lineParts.push(`decided: ${clip(safeQa.join('; '), 100)}`);
  else if (safeReply) lineParts.push(`-> ${clip(oneLine(safeReply), 110)}`);

  const detailParts = [];
  if (safeUser) detailParts.push(`User: ${clip(oneLine(safeUser), 200)}`);
  if (safeQa.length) detailParts.push(`User choices: ${clip(safeQa.join(' | '), 220)}`);
  if (files.length) detailParts.push(`Edited: ${clip(files.join(', '), 120)}`);
  if (safeReply) detailParts.push(`Reply: ${clip(oneLine(safeReply), 320)}`);

  return {
    userText: safeUser,
    reply: safeReply,
    files,
    qaPairs: safeQa,
    toolCount: toolSummaries.length,
    line: clip(lineParts.join(' · ') || 'Turn completed', 240),
    detail: clip(detailParts.join('\n'), 650),
  };
}

// ---------- 0-token pre-filter for L1 extraction ----------
const SIGNAL_RE = /결정|규칙|컨벤션|앞으로|사용하|쓰자|쓰지\s*마|바꾸|변경|대신|유지|고정|금지|주의|버그|원인|해결|실패|에러|포트|인증|로그인|결제|배포|스키마|마이그레이션|브랜치|TODO|FIXME|decid|convent|instead|prefer|always|never|avoid|switch|migrat|port|auth|fix|bug|gotcha|caveat|workaround|architect|schema|deploy|remember/i;

export function isWorthExtracting(turns) {
  for (const t of turns) {
    if (t.files?.length > 0) return true;
    if (t.qaPairs?.length > 0) return true;
    if (SIGNAL_RE.test(t.userText || '') || SIGNAL_RE.test(t.reply || '')) return true;
    if ((t.userText?.length || 0) + (t.reply?.length || 0) >= 240) return true;
  }
  return false;
}

// ---------- rate limit guard ----------
async function isExtractionToolLimited(tool) {
  try {
    const lims = await allLimits({ force: false });
    const ws = lims?.[tool]?.windows || [];
    return ws.some((w) => (w.usedPercent ?? 0) >= 90);
  } catch {
    return false;
  }
}

// ---------- LLM helpers (L1 & L2) ----------
async function callMemoryAi(prompt, label) {
  if (cfg.oneShotFn) return cfg.oneShotFn({ prompt, label });
  const st = getSettings();
  const { tool, model } = await aiTarget(st, 'memoryTool', 'memoryModel');
  if (await isExtractionToolLimited(tool)) {
    throw Object.assign(new Error(`rate limit near cap on ${tool}`), { code: 'RATE_LIMITED' });
  }
  return oneShot({ tool, model, prompt, timeoutMs: 90_000, failLabel: label });
}

export function parseMemoryJson(raw) {
  const text = String(raw || '');
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e < s) return null;
  let j;
  try { j = JSON.parse(text.slice(s, e + 1)); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const add = Array.isArray(j.add)
    ? j.add
        .filter((x) => x && typeof x.text === 'string' && x.text.trim())
        .map((x) => ({
          kind: normalizeKind(x.kind),
          text: redactSecrets(clip(oneLine(x.text), 260)),
          tags: x.tags ? redactSecrets(clip(oneLine(Array.isArray(x.tags) ? x.tags.join(' ') : String(x.tags)), 120)) : null,
        }))
    : [];
  const update = Array.isArray(j.update)
    ? j.update
        .filter((x) => x && Number.isInteger(Number(x.id)) && typeof x.text === 'string' && x.text.trim())
        .map((x) => ({
          id: Number(x.id),
          kind: x.kind ? normalizeKind(x.kind) : null,
          text: redactSecrets(clip(oneLine(x.text), 260)),
          tags: x.tags !== undefined ? redactSecrets(clip(oneLine(Array.isArray(x.tags) ? x.tags.join(' ') : String(x.tags || '')), 120)) : undefined,
        }))
    : [];
  const remove = Array.isArray(j.remove)
    ? j.remove.map((x) => (typeof x === 'object' && x ? Number(x.id) : Number(x))).filter((id) => Number.isInteger(id) && id > 0)
    : [];
  return { add, update, remove };
}

export function applyMemoryOps(project, ops, { sourceKey = null, branch = null, protectPinned = false, reason = 'superseded' } = {}) {
  if (!ops) return 0;
  let changed = 0;
  const now = Date.now();
  db.exec('BEGIN');
  try {
    for (const u of ops.update || []) {
      const cur = q('SELECT * FROM project_memory WHERE id = ? AND project = ? AND removed = 0').get(u.id, project);
      if (!cur) continue;
      if (protectPinned && cur.pinned) continue;
      const nextKind = u.kind || cur.kind;
      const nextTags = u.tags !== undefined ? u.tags : cur.tags;
      if (cur.text === u.text && cur.kind === nextKind && cur.tags === nextTags) continue;
      const seq = nextSeq(project);
      q('UPDATE project_memory SET kind = ?, text = ?, tags = ?, source_key = COALESCE(?, source_key), branch = COALESCE(?, branch), updated = ?, seq = ? WHERE id = ?')
        .run(nextKind, u.text, nextTags || null, sourceKey, branch, now, seq, cur.id);
      changed++;
    }
    for (const id of ops.remove || []) {
      const cur = q('SELECT * FROM project_memory WHERE id = ? AND project = ? AND removed = 0').get(id, project);
      if (!cur) continue;
      if (protectPinned && cur.pinned) continue;
      const seq = nextSeq(project);
      q('UPDATE project_memory SET removed = 1, removed_reason = ?, source_key = COALESCE(?, source_key), updated = ?, seq = ? WHERE id = ?')
        .run(reason, sourceKey, now, seq, cur.id);
      changed++;
    }
    for (const a of ops.add || []) {
      // Avoid exact-duplicate additions
      const dup = q('SELECT id FROM project_memory WHERE project = ? AND removed = 0 AND lower(text) = lower(?)').get(project, a.text);
      if (dup) continue;
      const seq = nextSeq(project);
      q('INSERT INTO project_memory (project, kind, text, tags, source_key, branch, pinned, created, updated, seq, removed) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0)')
        .run(project, a.kind, a.text, a.tags || null, sourceKey, branch, now, now, seq);
      changed++;
    }
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
  return changed;
}

function buildExtractPrompt({ existing, turns, language, activeCount }) {
  const today = new Date().toISOString().slice(0, 10);
  const existingText = existing.length
    ? existing.map((m) => `- #${m.id}${m.pinned ? ' [PINNED - DO NOT MODIFY OR REMOVE]' : ''} [${m.kind}] ${m.text}${m.tags ? ` (tags: ${m.tags})` : ''}`).join('\n')
    : '(none yet)';
  const turnsText = turns.map((t, i) => [
    `### Turn ${i + 1} (${toolLabel(t.tool)}${t.branch ? `, branch ${t.branch}` : ''})`,
    `User: ${clip(t.userText, 1200)}`,
    t.qaPairs?.length ? `Interactive choices:\n${t.qaPairs.join('\n')}` : '',
    t.files?.length ? `Files edited: ${t.files.join(', ')}` : '',
    `Assistant: ${clip(t.reply, 2000)}`,
  ].filter(Boolean).join('\n')).join('\n\n');

  const compactRule = activeCount > 45
    ? '\n- Memory already has many items: merge overlapping entries and remove outdated `state` items.'
    : '';

  return `You maintain shared project memory for multiple AI coding CLIs working on the same repository via Baton.
Today is ${today}. Write all memory texts in ${language}.

## What to store (ONLY durable facts other AI sessions cannot easily derive from code/git alone)
- decision: Architectural or technical choices, WHY they were chosen, and rejected alternatives.
- feedback: User corrections, style/workflow preferences, and conventions the user confirmed.
- gotcha: Non-obvious pitfalls, environment quirks, failed approaches, and root causes.
- state: Current active work-in-progress, remaining tasks, or unresolved blockers (short-lived).
- reference: External pointers, key endpoints, ports, or important commands/docs.

## Strict rules
- NEVER store generic facts easily read from the codebase (e.g. "uses React", file lists).
- NEVER store secrets, API keys, passwords, tokens, or credentials.
- NEVER modify or remove items marked [PINNED].
- If a new decision contradicts or updates an existing item, use \`update\` (or \`remove\` if cancelled/completed).
- Convert relative times ("yesterday", "just now") to absolute dates (${today}).
- Keep each item to 1-2 concise sentences. Include 2-5 space-separated search keywords/file names in \`tags\`.
- If nothing durable changed, return empty arrays.${compactRule}
- Output ONLY one valid JSON object with no markdown fences or explanation:
{"add":[{"kind":"decision|feedback|gotcha|state|reference","text":"...","tags":"kw1 kw2"}],"update":[{"id":1,"kind":"...","text":"...","tags":"..."}],"remove":[2]}

## Current project memory
${existingText}

## New conversation turn(s)
${turnsText}`;
}

function buildDreamPrompt({ pinned, editable, git, activities, language }) {
  const today = new Date().toISOString().slice(0, 10);
  const pinnedText = pinned.length
    ? pinned.map((m) => `- #${m.id} [PINNED/${m.kind}] ${m.text}`).join('\n')
    : '(none)';
  const editableText = editable.map((m) => `- #${m.id} [${m.kind} · ${fmtIsoDate(m.updated)}${m.branch ? ` · ${m.branch}` : ''}] ${m.text}${m.tags ? ` (tags: ${m.tags})` : ''}`).join('\n');
  const gitText = git
    ? `Branch: ${git.branch || '?'}\nRecent commits:\n${(git.commits || []).slice(0, 10).map((c) => `- ${fmtIsoDate(c.ts)} ${c.hash} ${c.subject}`).join('\n') || '(none)'}`
    : '(no git info)';
  const actText = activities.length
    ? activities.map((a) => `- [${fmtIsoDate(a.ts)} · ${toolLabel(a.tool)}] ${a.line}`).join('\n')
    : '(none)';

  return `You are running a periodic memory consolidation ("Dream") pass for a coding project's shared AI memory.
Today is ${today}. Write all text values in ${language}.

## Goals (4-phase consolidation)
1. Merge duplicate or overlapping entries into a single sharper entry (keep one id via \`update\`, \`remove\` the redundant ids).
2. Remove outdated \`state\` entries that appear completed or superseded in git commits / recent activity.
3. Resolve contradictions (keep the newer truth; if an editable entry contradicts a [PINNED] entry, remove or align the editable entry).
4. Normalize relative dates ("yesterday", "earlier") into absolute dates, strip trivial code-obvious facts, and drop dead file references.
5. NEVER include any [PINNED] id in \`update\` or \`remove\`. NEVER invent facts. Target <= 25 crisp, high-signal entries.

Output ONLY one valid JSON object:
{"update":[{"id":1,"kind":"decision|feedback|gotcha|state|reference","text":"...","tags":"..."}],"remove":[2,3],"add":[]}

## Pinned memory (READ-ONLY, protected)
${pinnedText}

## Editable memory (candidates for consolidation)
${editableText}

## Git context
${gitText}

## Recent session activity
${actText}`;
}

// ---------- per-project serial queue + per-session debounce ----------
const projectQueues = new Map(); // project -> Promise
const sessionPending = new Map(); // "<tool>:<id>" -> { project, tool, sessionId, branch, turns: [], timer }

function enqueueProject(project, fn) {
  const prev = projectQueues.get(project) || Promise.resolve();
  const next = prev.then(fn, fn).finally(() => {
    if (projectQueues.get(project) === next) projectQueues.delete(project);
  });
  projectQueues.set(project, next);
  return next;
}

/** Flush pending debounced turns for a session (returns Promise when extraction completes). */
async function flushSession(key) {
  const entry = sessionPending.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  sessionPending.delete(key);
  const { project, tool, sessionId, branch, turns, maxActivitySeq } = entry;

  return enqueueProject(project, async () => {
    if (!isMemoryEnabled(project)) return;
    // Always refresh the zero-token reference log for this session
    await writeSessionReference(project, tool, sessionId);

    if (!isWorthExtracting(turns)) {
      q('UPDATE project_memory_state SET extracted_turn_seq = MAX(extracted_turn_seq, ?) WHERE project = ?').run(maxActivitySeq, project);
      return;
    }

    const existing = q('SELECT * FROM project_memory WHERE project = ? AND removed = 0 ORDER BY pinned DESC, updated DESC LIMIT 80').all(project);
    const language = lang() === 'ko' ? 'Korean' : 'English';
    const prompt = buildExtractPrompt({ existing, turns, language, activeCount: existing.length });

    try {
      const out = await callMemoryAi(prompt, 'memory extract');
      const ops = parseMemoryJson(out);
      if (ops) {
        applyMemoryOps(project, ops, { sourceKey: key, branch, protectPinned: true, reason: 'superseded' });
      }
      q('UPDATE project_memory_state SET extractions_since_dream = extractions_since_dream + 1, extracted_turn_seq = MAX(extracted_turn_seq, ?) WHERE project = ?')
        .run(maxActivitySeq, project);
      await mirrorMemoryFiles(project);

      // Check L2 Auto-Dream trigger
      const st = ensureState(project);
      const activeCount = q('SELECT COUNT(*) AS n FROM project_memory WHERE project = ? AND removed = 0').get(project).n;
      const dueByCount = st.extractions_since_dream >= cfg.dreamExtractions || activeCount > cfg.dreamActiveLimit;
      const cooledDown = !st.last_dream_at || (Date.now() - st.last_dream_at) >= cfg.dreamCooldownMs;
      if (dueByCount && cooledDown && activeCount >= 6) {
        await runDreamInner(project);
      }
    } catch (e) {
      if (e.code !== 'RATE_LIMITED') console.warn('[memory] extract failed:', e.message);
    }
  });
}

async function runDreamInner(project) {
  const all = q('SELECT * FROM project_memory WHERE project = ? AND removed = 0 ORDER BY pinned DESC, updated DESC').all(project);
  const pinned = all.filter((m) => m.pinned);
  const editable = all.filter((m) => !m.pinned);
  if (editable.length < 2) {
    q('UPDATE project_memory_state SET extractions_since_dream = 0, last_dream_at = ? WHERE project = ?').run(Date.now(), project);
    return { ok: true, changed: 0, skipped: true };
  }
  const git = await gitInfo(project).catch(() => null);
  const activities = q('SELECT * FROM project_activity WHERE project = ? ORDER BY id DESC LIMIT 15').all(project);
  const language = lang() === 'ko' ? 'Korean' : 'English';
  const out = await callMemoryAi(buildDreamPrompt({ pinned, editable, git, activities, language }), 'memory dream');
  const ops = parseMemoryJson(out);
  const changed = ops ? applyMemoryOps(project, ops, { sourceKey: 'dream', protectPinned: true, reason: 'consolidated' }) : 0;
  q('UPDATE project_memory_state SET extractions_since_dream = 0, last_dream_at = ? WHERE project = ?').run(Date.now(), project);
  await mirrorMemoryFiles(project);
  return { ok: true, changed };
}

/** Manually or programmatically run L2 Dream consolidation for a project. */
export function runDream(project) {
  if (!project) return Promise.resolve({ ok: false, changed: 0 });
  return enqueueProject(project, () => runDreamInner(project));
}

/**
 * Extract durable memories from a session's full conversation so far (triggered by the user from
 * the chat's ⋯ menu). AI decides what to keep and how to categorize internally; the user never
 * has to pick categories or curate individual replies.
 */
export async function saveSessionToMemory(tool, sessionId) {
  const s = await findSession(tool, sessionId);
  if (!s) throw Object.assign(new Error(tr('세션을 찾을 수 없어요')), { code: 'NOT_FOUND' });
  const cwd = s.cwd || s.project;
  const project = memoryProject(cwd);
  if (!project) throw Object.assign(new Error(tr('이 폴더에서는 공유 메모리를 쓸 수 없어요')), { code: 'UNSUPPORTED' });
  if (!isMemoryEnabled(project)) throw Object.assign(new Error(tr('이 프로젝트의 공유 메모리가 꺼져 있어요')), { code: 'DISABLED' });

  const key = `${tool}:${sessionId}`;
  const pending = sessionPending.get(key);
  if (pending) {
    clearTimeout(pending.timer);
    sessionPending.delete(key);
  }

  return enqueueProject(project, async () => {
    const msgs = await readMessages(s);
    if (!msgs.length) return { ok: true, project, added: 0, updated: 0, removed: 0, changed: 0 };

    // Group transcript into turns (keep newest turns in full + original goal if older)
    const turns = [];
    let cur = null;
    for (const m of msgs) {
      if (m.role === 'user' && m.text) {
        cur = { tool, userText: redactSecrets(cleanPrompt(m.text)), replies: [], files: [], qaPairs: [] };
        turns.push(cur);
        continue;
      }
      if (!cur) continue;
      if (m.role === 'assistant' && m.text) cur.replies.push(redactSecrets(m.text));
    }
    const touched = filesTouched(msgs).filter(([, a]) => a === 'edited').map(([p]) => shortHome(p)).slice(-20);
    const picked = turns.length <= 10 ? turns : [turns[0], ...turns.slice(-9)];
    const git = await gitInfo(project).catch(() => null);
    const branch = git?.branch || null;
    const formattedTurns = picked.map((t, idx) => ({
      tool,
      branch,
      userText: t.userText,
      reply: t.replies.join('\n'),
      files: idx === picked.length - 1 ? touched : [],
      qaPairs: [],
    }));
    if (!formattedTurns.length) return { ok: true, project, added: 0, updated: 0, removed: 0, changed: 0 };

    await writeSessionReference(project, tool, sessionId);
    const existing = q('SELECT * FROM project_memory WHERE project = ? AND removed = 0 ORDER BY pinned DESC, updated DESC LIMIT 80').all(project);
    const language = lang() === 'ko' ? 'Korean' : 'English';
    const prompt = buildExtractPrompt({ existing, turns: formattedTurns, language, activeCount: existing.length });
    const out = await callMemoryAi(prompt, 'memory save session');
    const ops = parseMemoryJson(out) || { add: [], update: [], remove: [] };
    const changed = applyMemoryOps(project, ops, { sourceKey: key, branch, protectPinned: true, reason: 'superseded' });
    const st = ensureState(project);
    q('UPDATE project_memory_state SET extractions_since_dream = extractions_since_dream + 1, extracted_turn_seq = MAX(extracted_turn_seq, ?) WHERE project = ?')
      .run(st.pending_turn_seq || st.seq, project);
    await mirrorMemoryFiles(project);
    return {
      ok: true,
      project,
      added: ops.add.length,
      updated: ops.update.length,
      removed: ops.remove.length,
      changed,
    };
  });
}

/** Wait for all currently scheduled/queued memory tasks (used by tests). */
export async function flushAllMemory() {
  const keys = [...sessionPending.keys()];
  await Promise.all(keys.map((k) => flushSession(k)));
  await Promise.all([...projectQueues.values()]);
}

// ---------- L0 write entrypoint (bus.on('run_end')) ----------
export function recordTurn(run) {
  try {
    if (!run || run.status !== 'done' || !run.sessionId || !run.cwd) return;
    const project = memoryProject(run.cwd);
    if (!isMemoryEnabled(project)) return;
    const key = `${run.tool}:${run.sessionId}`;
    const turn = extractTurnFromRun(run);
    if (!turn.userText && !turn.reply && !turn.files.length) return;

    const seq = nextSeq(project);
    const now = Date.now();
    q('INSERT INTO project_activity (project, key, tool, branch, ts, seq, line, detail, files) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(project, key, run.tool, null, now, seq, turn.line, turn.detail, turn.files.join(', '));
    q('DELETE FROM project_activity WHERE project = ? AND id NOT IN (SELECT id FROM project_activity WHERE project = ? ORDER BY id DESC LIMIT ?)')
      .run(project, project, MAX_ACTIVITIES_PER_PROJECT);
    q('UPDATE project_memory_state SET pending_turn_seq = MAX(pending_turn_seq, ?) WHERE project = ?').run(seq, project);

    // Update branch asynchronously if git repo (never block run_end)
    gitInfo(project).then((g) => {
      if (g?.branch) {
        q('UPDATE project_activity SET branch = ? WHERE project = ? AND seq = ?').run(g.branch, project, seq);
        const p = sessionPending.get(key);
        if (p) p.branch = g.branch;
      }
    }).catch(() => {});

    // Debounce per session for L1 extraction + session reference file refresh
    let entry = sessionPending.get(key);
    if (!entry) {
      entry = { project, tool: run.tool, sessionId: run.sessionId, branch: null, turns: [], maxActivitySeq: seq, timer: null };
      sessionPending.set(key, entry);
    }
    entry.turns.push({ tool: run.tool, branch: entry.branch, ...turn });
    entry.maxActivitySeq = Math.max(entry.maxActivitySeq, seq);
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => { flushSession(key).catch(() => {}); }, cfg.debounceMs);
    entry.timer.unref?.();
  } catch (e) {
    console.warn('[memory] recordTurn failed:', e.message);
  }
}

// ---------- live dev server helper (fast + 30s-threshold-free) ----------
async function liveProjectServers(project) {
  try {
    const res = await Promise.race([
      listPortsCached(15_000),
      new Promise((resolve) => setTimeout(() => resolve(null), PORT_TIMEOUT_MS)),
    ]);
    if (!res?.ports) return [];
    const seen = new Set();
    const out = [];
    for (const p of res.ports) {
      if (!p.mine || p.baton || !p.port || p.project !== project) continue;
      if (p.page?.kind === 'tcp') continue;
      if (/^(claude|codex|agy|antigravity|gemini|opencode|cursor-agent)$/.test(String(p.name || '').split(' ')[0])) continue;
      if (seen.has(p.port)) continue;
      seen.add(p.port);
      const who = p.agent ? `started by ${toolLabel(p.agent.tool)} session "${clip(p.agent.title || '', 40)}"` : (prettyCmd(p.cmd) || p.name || 'running');
      out.push({ port: p.port, url: `http://localhost:${p.port}`, phoneUrl: p.phoneUrl || null, who });
    }
    out.sort((a, b) => a.port - b.port);
    return out;
  } catch {
    return [];
  }
}

// ---------- Layer 1 prompt builder (withMemory) ----------
function seenKey(tool, sessionId) {
  return `mem_seen:${tool}:${sessionId}`;
}

function getSeen(tool, sessionId) {
  if (!sessionId) return null;
  const raw = getKV(seenKey(tool, sessionId), null);
  if (raw == null) return null;
  if (typeof raw === 'number') return { project: null, seq: raw, serversSig: '', recalledIds: [] };
  return { project: raw.project || null, seq: Number(raw.seq) || 0, serversSig: raw.serversSig || '', recalledIds: Array.isArray(raw.recalledIds) ? raw.recalledIds : [] };
}

function saveSeen(tool, sessionId, data) {
  if (!tool || !sessionId) return;
  setKV(seenKey(tool, sessionId), {
    project: data.project,
    seq: data.seq,
    serversSig: data.serversSig || '',
    recalledIds: (data.recalledIds || []).slice(-40),
  });
}

function fmtMemLine(m) {
  const who = m.source_key === 'user' ? 'user' : toolLabel(sourceTool(m.source_key));
  const br = m.branch ? ` · ${m.branch}` : '';
  return `- [${m.kind} · ${who} · ${fmtShortDate(m.updated)}${br}] ${m.text}`;
}

function sessionRefPath(project, key) {
  const [tool, ...rest] = String(key || '').split(':');
  const id = rest.join(':');
  if (!tool || !id) return null;
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 8);
  const rel = `.baton/sessions/${tool}-${safeId}.md`;
  return fs.existsSync(path.join(project, rel)) ? rel : null;
}

/**
 * Wrap a user prompt with shared project memory (full on turn 1 or project switch, delta-only on continuing turns).
 * Appends <baton-memory> AFTER the user's prompt so CLI previews/auto-titles see the real request first.
 * Enforces a strict <=4,000-char inline budget across all sections (safe for agy/cursor Windows argv).
 */
export async function withMemory({ tool, sessionId = null, cwd, prompt, excludeSessionKey = null, includeClaudeMemory = true } = {}) {
  const noop = { wirePrompt: prompt, memoryEvent: null, markSeen: () => {} };
  if (!prompt || !String(prompt).trim()) return noop;
  const project = memoryProject(cwd);
  if (!isMemoryEnabled(project)) return noop;

  const selfKey = sessionId ? `${tool}:${sessionId}` : null;
  const st = ensureState(project);
  const currentSeq = st.seq;
  const seen = sessionId ? getSeen(tool, sessionId) : null;
  const isFull = !seen || seen.project !== project;

  const servers = await liveProjectServers(project);
  const serversSig = servers.map((s) => s.port).join(',');

  const sections = [];
  const toolsFrom = new Set();
  const includedMemIds = new Set();
  const includedActIds = new Set();
  let itemCount = 0;
  let actCount = 0;
  let recalledCount = 0;
  let hasServerInfo = false;

  const HEADER = isFull
    ? [
        '<baton-memory>',
        'Shared project memory from Baton (other AI CLIs work on this same repository through Baton).',
        'Follow Pinned rules strictly unless the user explicitly overrides them. Treat Auto items as context from other sessions — verify against current files/git diff if relevant, and follow the user if they change direction. Do not mention this block unless asked.',
      ].join('\n')
    : [
        '<baton-memory>',
        'Updates from other AI sessions on this project since your last turn (via Baton). Do not mention this block unless asked.',
      ].join('\n');
  const FOOTER_LINES = [];
  if (fs.existsSync(path.join(project, '.baton', 'memory.md'))) FOOTER_LINES.push('Full memory index: .baton/memory.md');
  const FOOTER = (FOOTER_LINES.length ? FOOTER_LINES.join('\n') + '\n' : '') + '</baton-memory>';

  let budget = MAX_INLINE_CHARS - HEADER.length - FOOTER.length - 16;

  const pushSection = (title, lines) => {
    if (!lines.length || budget < 60) return 0;
    const head = `## ${title}`;
    const kept = [];
    let used = head.length + 2;
    for (const ln of lines) {
      const c = clip(ln, 320);
      if (used + c.length + 1 > budget) break;
      kept.push(c);
      used += c.length + 1;
    }
    if (!kept.length) return 0;
    sections.push(`${head}\n${kept.join('\n')}`);
    budget -= used + 2;
    return kept.length;
  };

  const trackSource = (sourceKey) => {
    const t = sourceTool(sourceKey);
    if (t && t !== 'user' && t !== 'unknown' && t !== 'dream') toolsFrom.add(t);
  };

  const newRecalledIds = new Set(seen?.recalledIds || []);

  if (isFull) {
    const allActive = q('SELECT * FROM project_memory WHERE project = ? AND removed = 0 ORDER BY pinned DESC, updated DESC').all(project);
    const pinned = allActive.filter((m) => m.pinned);
    const core = allActive.filter((m) => !m.pinned && m.kind !== 'state');
    const states = allActive.filter((m) => !m.pinned && m.kind === 'state');

    // 1. Pinned rules (always first)
    if (pinned.length) {
      const n = pushSection('Pinned rules (follow strictly)', pinned.map(fmtMemLine));
      for (const m of pinned.slice(0, n)) { includedMemIds.add(m.id); trackSource(m.source_key); }
      itemCount += n;
    }

    // 2. Core decisions / feedback / gotchas / references (leave room for state, recall, activity, servers)
    const coreReserve = Math.max(400, Math.floor(budget * 0.52));
    if (core.length && budget > 120) {
      const savedBudget = budget;
      budget = Math.min(budget, coreReserve);
      const n = pushSection('Decisions, conventions & gotchas', core.map(fmtMemLine));
      const spent = Math.min(savedBudget, coreReserve) - budget;
      budget = savedBudget - spent;
      for (const m of core.slice(0, n)) { includedMemIds.add(m.id); trackSource(m.source_key); }
      itemCount += n;
    }

    // 3. Active state
    if (states.length) {
      const n = pushSection('Current state', states.slice(0, 6).map(fmtMemLine));
      for (const m of states.slice(0, n)) { includedMemIds.add(m.id); trackSource(m.source_key); }
      itemCount += n;
    }

    // 4. Recent activity in other sessions (with richer detail if still pending L1 extraction!)
    const acts = q('SELECT * FROM project_activity WHERE project = ? ORDER BY id DESC LIMIT 10').all(project)
      .filter((a) => a.key !== selfKey && a.key !== excludeSessionKey)
      .slice(0, 5);
    if (acts.length) {
      const actLines = [];
      const refFiles = new Set();
      for (const a of acts) {
        const ref = sessionRefPath(project, a.key);
        if (ref) refFiles.add(ref);
        const unextracted = a.seq > (st.extracted_turn_seq || 0);
        if (unextracted && a.detail) {
          actLines.push(`- [${toolLabel(a.tool)} · ${fmtShortDate(a.ts)} · latest] ${oneLine(a.detail)}`);
        } else {
          actLines.push(`- [${toolLabel(a.tool)} · ${fmtShortDate(a.ts)}] ${a.line}`);
        }
        toolsFrom.add(a.tool);
        includedActIds.add(a.id);
      }
      if (refFiles.size) actLines.push(`Session detail logs (read if needed): ${[...refFiles].slice(0, 4).join(', ')}`);
      actCount += pushSection('Recent activity in other sessions', actLines);
    }

    // 5. Smart Recall for items pushed out of the top slice or older matching activities
    const recalled = recallRelevant(project, prompt, { excludeMemIds: includedMemIds, excludeActIds: includedActIds, limit: 4 });
    const recallLines = [
      ...recalled.memories.map((m) => { includedMemIds.add(m.id); newRecalledIds.add(m.id); trackSource(m.source_key); return fmtMemLine(m); }),
      ...recalled.activities.map((a) => { includedActIds.add(a.id); toolsFrom.add(a.tool); return `- [${toolLabel(a.tool)} · ${fmtShortDate(a.ts)}] ${a.line}`; }),
    ];
    if (recallLines.length) recalledCount += pushSection('Relevant past context (matched to your request)', recallLines);

    // 6. Live dev servers
    if (servers.length) {
      const srvLines = servers.map((s) => `- ${s.url}${s.phoneUrl ? ` (phone: ${s.phoneUrl})` : ''} — ${s.who}`);
      if (pushSection('Dev servers already running — reuse these, do NOT start another on a new port', srvLines) > 0) hasServerInfo = true;
    }

    // 7. Bridge Claude Code's native auto-memory to non-Claude CLIs within remaining budget (clean line breaks, no orphan headings)
    if (tool !== 'claude' && includeClaudeMemory && budget > 220) {
      const cm = claudeMemory([cwd, project]);
      if (cm.length) {
        const cap = Math.min(900, budget - 60);
        const rawLines = redactSecrets(cm.join('\n')).split('\n').map((l) => l.trimEnd()).filter(Boolean);
        const pickedLines = [];
        let used = 0;
        for (const l of rawLines) {
          if (used + l.length + 1 > cap) break;
          pickedLines.push(l);
          used += l.length + 1;
        }
        while (pickedLines.length && /^#{1,6}\s/.test(pickedLines[pickedLines.length - 1])) pickedLines.pop();
        if (pickedLines.length) pushSection('Claude Code auto-memory (read-only)', pickedLines);
      }
    }
  } else {
    // Delta mode: only changes created by OTHER sessions (or user/dream) since seen.seq
    const changedMems = q('SELECT * FROM project_memory WHERE project = ? AND seq > ? ORDER BY seq ASC').all(project, seen.seq)
      .filter((m) => m.source_key !== selfKey && m.source_key !== excludeSessionKey);
    const activeDeltas = changedMems.filter((m) => !m.removed);
    const removedDeltas = changedMems.filter((m) => m.removed);

    if (activeDeltas.length) {
      const n = pushSection('New / updated decisions & notes', activeDeltas.map(fmtMemLine));
      for (const m of activeDeltas.slice(0, n)) { includedMemIds.add(m.id); trackSource(m.source_key); }
      itemCount += n;
    }
    if (removedDeltas.length) {
      const n = pushSection('No longer applies / revoked', removedDeltas.map((m) => `- [removed ${m.kind}] ${m.text}`));
      for (const m of removedDeltas.slice(0, n)) trackSource(m.source_key);
      itemCount += n;
    }

    const newActs = q('SELECT * FROM project_activity WHERE project = ? AND seq > ? ORDER BY seq DESC LIMIT 8').all(project, seen.seq)
      .filter((a) => a.key !== selfKey && a.key !== excludeSessionKey)
      .slice(0, 4);
    if (newActs.length) {
      const actLines = [];
      const refFiles = new Set();
      for (const a of newActs) {
        const ref = sessionRefPath(project, a.key);
        if (ref) refFiles.add(ref);
        const unextracted = a.seq > (st.extracted_turn_seq || 0);
        actLines.push(unextracted && a.detail
          ? `- [${toolLabel(a.tool)} · ${fmtShortDate(a.ts)}] ${oneLine(a.detail)}`
          : `- [${toolLabel(a.tool)} · ${fmtShortDate(a.ts)}] ${a.line}`);
        toolsFrom.add(a.tool);
        includedActIds.add(a.id);
      }
      if (refFiles.size) actLines.push(`Session detail logs: ${[...refFiles].slice(0, 3).join(', ')}`);
      actCount += pushSection('Recent activity in other sessions', actLines);
    }

    // Only inject dev servers if running set changed since seen
    if (servers.length && serversSig !== seen.serversSig) {
      const srvLines = servers.map((s) => `- ${s.url}${s.phoneUrl ? ` (phone: ${s.phoneUrl})` : ''} — ${s.who}`);
      if (pushSection('Dev servers now running — reuse these, do NOT start another on a new port', srvLines) > 0) hasServerInfo = true;
    }

    // High-confidence Smart Recall for older topics not yet shown in this session
    const skipIds = new Set([...includedMemIds, ...(seen.recalledIds || [])]);
    const recalled = recallRelevant(project, prompt, { excludeMemIds: skipIds, excludeActIds: includedActIds, limit: 2, minScore: 4.5 });
    const recallLines = recalled.memories.map((m) => { newRecalledIds.add(m.id); trackSource(m.source_key); return fmtMemLine(m); });
    if (recallLines.length) recalledCount += pushSection('Relevant past project memory', recallLines);
  }

  const markSeen = (actualSessionId) => {
    const sid = actualSessionId || sessionId;
    if (sid) saveSeen(tool, sid, { project, seq: currentSeq, serversSig, recalledIds: [...newRecalledIds] });
  };

  if (!sections.length) {
    // Nothing to inject: keep prompt untouched (0 extra tokens, prompt cache preserved)
    return { wirePrompt: prompt, memoryEvent: null, markSeen };
  }

  const block = `${HEADER}\n${sections.join('\n\n')}\n${FOOTER}`;
  const wirePrompt = `${prompt}\n\n${block}`;
  const memoryEvent = {
    t: 'memory',
    project,
    mode: isFull ? 'full' : 'delta',
    items: itemCount,
    activities: actCount,
    recalled: recalledCount,
    servers: hasServerInfo ? servers.length : 0,
    from: [...toolsFrom],
  };

  return { wirePrompt, memoryEvent, markSeen };
}

// ---------- CRUD & UI API helpers ----------
export function listMemory(project, { query = '' } = {}) {
  const st = ensureState(project);
  const meta = getProjectMeta(project);
  let items = q('SELECT * FROM project_memory WHERE project = ? AND removed = 0 ORDER BY pinned DESC, updated DESC').all(project);
  if (query && query.trim()) {
    const tokens = tokenizeSearch(query);
    if (tokens.length) {
      const df = new Map();
      for (const m of items) {
        const low = `${m.text} ${m.tags || ''}`.toLowerCase();
        for (const t of tokens) if (low.includes(t)) df.set(t, (df.get(t) || 0) + 1);
      }
      items = items
        .map((m) => ({ m, sc: scoreDocument(m.text, m.tags, tokens, df, items.length) }))
        .filter((x) => x.sc > 0)
        .sort((a, b) => b.sc - a.sc)
        .map((x) => x.m);
    }
  }
  const activities = q('SELECT id, key, tool, branch, ts, line FROM project_activity WHERE project = ? ORDER BY id DESC LIMIT 10').all(project);
  return {
    project,
    enabled: isMemoryEnabled(project),
    memoryOff: Boolean(meta?.memory_off),
    globalEnabled: getSettings().sharedMemory !== false,
    items: items.map((r) => ({
      id: r.id, kind: r.kind, text: r.text, tags: r.tags || '', sourceKey: r.source_key,
      sourceTool: sourceTool(r.source_key), branch: r.branch || null,
      pinned: Boolean(r.pinned), created: r.created, updated: r.updated, seq: r.seq,
    })),
    activities,
    stats: {
      seq: st.seq,
      extractionsSinceDream: st.extractions_since_dream || 0,
      lastDreamAt: st.last_dream_at || null,
    },
  };
}

export async function addMemoryItem(project, { kind = 'decision', text, tags = null, pinned = false, sourceKey = 'user', branch = null } = {}) {
  const clean = redactSecrets(clip(oneLine(text || ''), 400));
  if (!clean) throw new Error('empty memory text');
  const k = normalizeKind(kind);
  const seq = nextSeq(project);
  const now = Date.now();
  const cleanTags = tags ? redactSecrets(clip(oneLine(tags), 120)) : null;
  const info = q('INSERT INTO project_memory (project, kind, text, tags, source_key, branch, pinned, created, updated, seq, removed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)')
    .run(project, k, clean, cleanTags, sourceKey, branch, pinned ? 1 : 0, now, now, seq);
  const row = q('SELECT * FROM project_memory WHERE id = ?').get(info.lastInsertRowid);
  await mirrorMemoryFiles(project);
  return {
    id: row.id, kind: row.kind, text: row.text, tags: row.tags || '', sourceKey: row.source_key,
    sourceTool: sourceTool(row.source_key), branch: row.branch || null, pinned: Boolean(row.pinned),
    created: row.created, updated: row.updated, seq: row.seq,
  };
}

export async function updateMemoryItem(project, id, patch = {}) {
  const cur = q('SELECT * FROM project_memory WHERE id = ? AND project = ? AND removed = 0').get(Number(id), project);
  if (!cur) return null;
  const nextKind = patch.kind !== undefined ? normalizeKind(patch.kind) : cur.kind;
  const nextText = patch.text !== undefined ? redactSecrets(clip(oneLine(patch.text), 400)) : cur.text;
  if (!nextText) throw new Error('empty memory text');
  const nextTags = patch.tags !== undefined ? (patch.tags ? redactSecrets(clip(oneLine(patch.tags), 120)) : null) : cur.tags;
  const nextPinned = patch.pinned !== undefined ? (patch.pinned ? 1 : 0) : cur.pinned;
  const seq = nextSeq(project);
  const now = Date.now();
  q('UPDATE project_memory SET kind = ?, text = ?, tags = ?, pinned = ?, updated = ?, seq = ? WHERE id = ?')
    .run(nextKind, nextText, nextTags, nextPinned, now, seq, cur.id);
  const row = q('SELECT * FROM project_memory WHERE id = ?').get(cur.id);
  await mirrorMemoryFiles(project);
  return {
    id: row.id, kind: row.kind, text: row.text, tags: row.tags || '', sourceKey: row.source_key,
    sourceTool: sourceTool(row.source_key), branch: row.branch || null, pinned: Boolean(row.pinned),
    created: row.created, updated: row.updated, seq: row.seq,
  };
}

export async function deleteMemoryItem(project, id) {
  const cur = q('SELECT * FROM project_memory WHERE id = ? AND project = ? AND removed = 0').get(Number(id), project);
  if (!cur) return false;
  const seq = nextSeq(project);
  q("UPDATE project_memory SET removed = 1, removed_reason = 'user', source_key = 'user', updated = ?, seq = ? WHERE id = ?")
    .run(Date.now(), seq, cur.id);
  await mirrorMemoryFiles(project);
  return true;
}
