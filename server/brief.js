// "Where did I leave off?" — AI-generated project briefs.
import { decoratedSessions, findSession, readMessages, sessionsOfProject } from './indexer.js';
import { gitInfo, projectDocs, projectName, projectFingerprint } from './projects.js';
import { getBrief, saveBrief, getSettings } from './store.js';
import { oneShot } from './runner.js';
import { DATA_DIR, clip, oneLine, shortHome } from './util.js';
import { tr, lang } from './i18n.js';
import { binFor, TOOL_IDS } from './tools.js';
import { claudeProvider, codexProvider } from './providers.js';

const inflight = new Map();

function fmtDate(ts) {
  return ts ? new Date(ts).toISOString().slice(0, 16).replace('T', ' ') : '?';
}

async function buildContext(root) {
  const all = await decoratedSessions({ includeHidden: true });
  const sessions = sessionsOfProject(all, root).sort((a, b) => b.updated - a.updated);
  const human = sessions.filter((s) => !s.automated);
  const picked = (human.length ? human : sessions).slice(0, 4);
  const parts = [];
  parts.push(`# Project: ${projectName(root)} (${shortHome(root)})`);
  parts.push(`Sessions: ${sessions.length} (opened by a human: ${human.length}), last activity: ${fmtDate(sessions[0]?.updated)}, first activity: ${fmtDate(sessions.at(-1)?.created)}`);
  const git = await gitInfo(root);
  if (git) {
    parts.push(`\n## git (branch ${git.branch || '?'}, ${git.dirty} uncommitted changes)`);
    for (const c of git.commits.slice(0, 12)) parts.push(`- ${fmtDate(c.ts)} ${c.subject}`);
    if (git.changed.length) parts.push(`Uncommitted files: ${git.changed.slice(0, 15).map((l) => l.slice(3)).join(', ')}`);
  }
  for (const d of projectDocs(root)) {
    parts.push(`\n## ${d.file} (beginning)\n${clip(d.text, 1800)}`);
  }
  for (const s of picked) {
    const full = await findSession(s.tool, s.id);
    const msgs = await readMessages(full);
    const users = msgs.filter((m) => m.role === 'user').slice(-10);
    const replies = msgs.filter((m) => m.role === 'assistant').slice(-3);
    parts.push(`\n## Session [${s.tool}] "${s.title}" (${fmtDate(s.created)} ~ ${fmtDate(s.updated)}, ${msgs.length} messages)`);
    parts.push('User requests (chronological):');
    for (const u of users) parts.push(`- ${clip(oneLine(u.text), 320)}`);
    parts.push('Last agent replies:');
    for (const r of replies) parts.push(`> ${clip(oneLine(r.text), 900)}`);
  }
  return { text: parts.join('\n'), sessions };
}

/** The configured summary tool/model, falling back to something that works on this setup. */
async function briefTarget(st) {
  let tool = st.briefTool;
  if (!binFor(tool)) tool = TOOL_IDS.find((id) => binFor(id)) || tool;
  let model = tool === st.briefTool ? st.briefModel : '';
  if (tool === 'claude' && ['haiku', 'sonnet', 'opus'].includes(model)) {
    // on gateways / self-hosted servers an alias like "haiku" may not exist — use the configured model
    const p = await claudeProvider().catch(() => null);
    if (p && (p.kind === 'gateway' || p.kind === 'apikey') && !p.models?.[model]) model = '';
  }
  if (tool === 'codex' && codexProvider().kind === 'custom') model = '';
  return { tool, model };
}

const PROMPT = (ctx, language) => `You are a project-manager assistant for a "vibe coding" developer who runs many projects in parallel with AI coding agents (Claude Code, Codex, Antigravity, OpenCode, Cursor) and often forgets where they left off.
From the material below (session transcripts, git log, docs), write a briefing that lets someone coming back to this project act immediately.

Rules:
- Write every text value in ${language}. Short and concrete. Mark guesses with "(guess)".
- next[].prompt must be a concrete request (1-3 sentences) the developer can send to an agent as-is.
- Never invent facts that are not in the material.
- Output exactly one JSON object. No code fences, no explanation.

JSON shape:
{
  "what": "one line: what this project is",
  "oneLiner": "current state in one sentence (e.g. 3D lock rotation done, payments not wired yet)",
  "progress": integer 0-100 (estimated completeness),
  "phase": "one of: idea | design | early build | mid build | polishing | live/maintenance (in ${language})",
  "lastDone": ["recently finished work (max 4)"],
  "next": [{"title": "next thing to do (short)", "why": "one line on why now", "prompt": "request to send to the agent"}],
  "openQuestions": ["decisions needed / blockers (max 3, empty array if none)"],
  "resumeTip": "one line: what to do in the first 5 minutes when resuming"
}

--- material ---
${ctx}`;

function parseJson(text) {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error(tr('JSON을 찾지 못했어요'));
  const j = JSON.parse(text.slice(s, e + 1));
  return {
    what: String(j.what || ''),
    oneLiner: String(j.oneLiner || ''),
    progress: Number.isFinite(+j.progress) ? Math.max(0, Math.min(100, Math.round(+j.progress))) : null,
    phase: String(j.phase || ''),
    lastDone: (j.lastDone || []).map(String).slice(0, 5),
    next: (j.next || []).slice(0, 4).map((n) => ({ title: String(n.title || ''), why: String(n.why || ''), prompt: String(n.prompt || '') })),
    openQuestions: (j.openQuestions || []).map(String).slice(0, 4),
    resumeTip: String(j.resumeTip || ''),
  };
}

/** Generate (or reuse) a brief. `force` regenerates even if fingerprint unchanged. */
export async function ensureBrief(project, { force = false } = {}) {
  const fp = projectFingerprint(project);
  const cur = getBrief(project.id);
  if (!force && cur && cur.fingerprint === fp) return cur;
  if (inflight.has(project.id)) return inflight.get(project.id);
  const p = (async () => {
    const { text } = await buildContext(project.id);
    const st = getSettings();
    const { tool: briefTool, model: briefModel } = await briefTarget(st);
    const out = await oneShot({ tool: briefTool, model: briefModel, prompt: PROMPT(clip(text, 40000), lang() === 'ko' ? 'Korean' : 'English'), cwd: DATA_DIR });
    const brief = parseJson(out);
    saveBrief(project.id, fp, brief);
    return getBrief(project.id);
  })().finally(() => inflight.delete(project.id));
  inflight.set(project.id, p);
  return p;
}

export function briefPending(id) {
  return inflight.has(id);
}
