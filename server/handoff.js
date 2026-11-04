// Hand a session over to another CLI (e.g. Claude is near its limit -> continue in Codex), and back.
//
// No CLI can open another CLI's session format, so continuity has to be rebuilt. Baton writes a
// handoff note into the project (<cwd>/.baton/handoff/*.md, git-ignored) and starts (or resumes) a
// session in the target CLI that reads it first. The note has two layers:
//
//  1. "Agent summary" (optional, like /compact): the SOURCE agent, which still holds the whole
//     context, writes a structured summary (intent, decisions, rejected approaches, current work,
//     next step). Best continuity; costs the source CLI one turn. Falls back automatically if the
//     source is already rate-limited.
//  2. "Extracted record" (always, zero tokens): goal, project rule files, latest todo list, files
//     touched, git state, where it stopped (incl. the last tool results) and the recent conversation,
//     kept within a size budget so the receiving agent can actually read all of it.
//
// The receiving agent is told to restate its understanding before changing anything, so a broken
// handoff is visible in the first reply instead of after a wrong edit.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { db, patchSessionMeta } from './store.js';
import { findSession, readMessages } from './indexer.js';
import { gitInfo, projectName } from './projects.js';
import { startRun, childEnv, childPids } from './runner.js';
import { clip, oneLine, shortHome } from './util.js';
import { TOOLS, binFor } from './tools.js';
import { spawnCli } from './platform.js';
import { tr } from './i18n.js';
import { CLAUDE_HOME } from './env.js';

db.exec(`CREATE TABLE IF NOT EXISTS session_links (
  from_key TEXT NOT NULL, to_key TEXT NOT NULL, created INTEGER NOT NULL, note TEXT,
  PRIMARY KEY (from_key, to_key)
)`);

const toolName = (id) => TOOLS[id]?.name || id;
const NOTE_BUDGET = 48_000; // chars (~12k tokens): small enough that any agent reads it in one go
const RULE_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.cursorrules', '.cursor/rules', '.github/copilot-instructions.md', 'CONVENTIONS.md'];

function parseInput(m) {
  let input = m.tool?.input;
  if (typeof input === 'string') { try { input = JSON.parse(input); } catch { /* raw */ } }
  return input;
}

function filesTouched(msgs) {
  const files = new Map(); // path -> action
  for (const m of msgs) {
    if (m.role !== 'tool' || !m.tool) continue;
    const name = String(m.tool.name || '').toLowerCase();
    const input = parseInput(m);
    const p = input && typeof input === 'object' ? (input.file_path || input.path || input.TargetFile || input.AbsolutePath || input.filePath) : null;
    if (p && /edit|write|patch|create|replace|multi/.test(name)) files.set(p, 'edited');
    else if (p && /read|view|open/.test(name) && !files.has(p)) files.set(p, 'read');
    const raw = typeof m.tool.input === 'string' ? m.tool.input : JSON.stringify(m.tool.input || '');
    for (const mm of raw.matchAll(/\*\*\* (?:Update|Add|Delete) File: ([^\n\\"]+)/g)) files.set(mm[1].trim(), 'edited');
  }
  return [...files.entries()];
}

/** The agent's most recent todo/plan list (Claude TodoWrite, Codex todo_list, update_plan…). */
function latestTodos(msgs) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== 'tool') continue;
    const name = String(m.tool?.name || '').toLowerCase();
    if (!/todo|plan/.test(name)) continue;
    const input = parseInput(m);
    const list = input?.todos || input?.plan || input?.items;
    if (Array.isArray(list) && list.length) {
      return list.map((x) => {
        const text = x.content || x.step || x.text || x.title || JSON.stringify(x);
        const st = x.status || (x.completed ? 'completed' : 'pending');
        return `- [${st === 'completed' ? 'x' : st === 'in_progress' ? '~' : ' '}] ${clip(oneLine(text), 200)}${st === 'in_progress' ? ' (in progress)' : ''}`;
      });
    }
    if (m.tool.summary && /[☑☐]/.test(m.tool.summary)) return m.tool.summary.split(' · ').map((x) => `- ${x}`);
  }
  return null;
}

/** Claude Code's per-project auto-memory (~/.claude/projects/<encoded cwd>/memory/*.md) — other CLIs can't see it. */
function claudeMemory(dirs) {
  const out = [];
  let size = 0;
  for (const d of [...new Set(dirs.filter(Boolean))]) {
    const memDir = path.join(CLAUDE_HOME, 'projects', d.replace(/[^a-zA-Z0-9]/g, '-'), 'memory');
    let names = [];
    try { names = fs.readdirSync(memDir).filter((n) => n.endsWith('.md')); } catch { continue; }
    for (const n of names.sort((a, b) => (a === 'MEMORY.md' ? -1 : b === 'MEMORY.md' ? 1 : a.localeCompare(b)))) {
      let text = '';
      try { text = fs.readFileSync(path.join(memDir, n), 'utf8').replace(/^---[\s\S]*?---\s*/, '').trim(); } catch { continue; }
      if (!text || size > 8000) continue;
      const piece = clip(text, 2500);
      size += piece.length;
      out.push(`### ${n}\n${piece}`);
    }
  }
  return out;
}

function ruleFiles(root) {
  const out = [];
  for (const f of RULE_FILES) { if (root && fs.existsSync(path.join(root, f))) out.push(f); }
  return out;
}

const fmtTool = (t) => `${t.name}${t.summary ? ` (${clip(oneLine(t.summary), 100)})` : ''}`;

/** Zero-token extracted record of the session, within NOTE_BUDGET. */
export async function buildHandoffNote(s, msgs, { agentSummary = null } = {}) {
  const root = s.project || s.cwd;
  const head = [];
  const users = msgs.filter((m) => m.role === 'user' && m.text);
  const lastUser = users.at(-1);
  const lastAsst = [...msgs].reverse().find((m) => m.role === 'assistant' && m.text);
  head.push(`# Handoff: ${s.title || 'session'}`);
  head.push('');
  head.push(`You are taking over a coding session that was started in **${toolName(s.tool)}** (session \`${s.id}\`${s.model ? `, model ${s.model}` : ''}).`);
  head.push('It was paused — usually because that tool ran low on its usage limit. Continue the same work here.');
  head.push('');
  head.push(`- Project: ${projectName(root)} (\`${shortHome(s.cwd || root || '')}\`)`);
  head.push(`- Last activity: ${new Date(s.updated).toISOString()}`);
  head.push('');
  head.push('## Rules for you');
  head.push('- This note can be incomplete or slightly stale. The files on disk and `git diff` are the source of truth — check them before editing.');
  head.push('- Do not redo finished work. Keep the decisions and conventions recorded here unless the user says otherwise.');
  const rules = ruleFiles(root);
  if (rules.length) head.push(`- Project rules live in ${rules.map((f) => `\`${f}\``).join(', ')} (some were written for a different agent — they still apply to you). Read them.`);
  head.push('- If the last task was cut off mid-way, finish or repair it first (files may be half-edited).');
  head.push('');
  if (agentSummary) { head.push(`## Summary written by ${toolName(s.tool)} itself (most reliable)`); head.push(agentSummary.trim()); head.push(''); }
  const mem = claudeMemory([s.cwd, root]);
  if (mem.length) { head.push('## Project memory saved by Claude Code (conventions/decisions — follow them)'); head.push(...mem); head.push(''); }
  if (users[0]) { head.push('## Original goal'); head.push(clip(users[0].text.trim(), 3000)); head.push(''); }
  const todos = latestTodos(msgs);
  if (todos) { head.push('## Latest todo list'); head.push(...todos.slice(0, 40)); head.push(''); }
  const files = filesTouched(msgs);
  if (files.length) {
    head.push('## Files touched in that session');
    for (const [p, a] of files.slice(-60)) head.push(`- ${a}: \`${shortHome(p)}\``);
    head.push('');
  }
  const git = await gitInfo(root).catch(() => null);
  if (git) {
    head.push(`## Git (branch ${git.branch || '?'})`);
    if (git.changed.length) { head.push('Uncommitted changes:'); for (const c of git.changed.slice(0, 30)) head.push(`- \`${c}\``); }
    if (git.commits.length) { head.push('Recent commits:'); for (const c of git.commits.slice(0, 8)) head.push(`- ${c.hash} ${c.subject}`); }
    head.push('');
  }

  // Where it stopped: last request, last reply, and the last tool calls WITH their results
  const stop = ['## Where it stopped'];
  if (lastUser) stop.push(`Last request from the user:\n> ${clip(lastUser.text.trim(), 4000).replace(/\n/g, '\n> ')}`);
  const lastUserIdx = lastUser ? msgs.lastIndexOf(lastUser) : -1;
  const tail = msgs.slice(Math.max(lastUserIdx, msgs.length - 30)).filter((m) => m.role === 'tool' && m.tool).slice(-8);
  if (tail.length) {
    stop.push('\nLast tool calls after that request (most recent last):');
    for (const m of tail) {
      stop.push(`- ${fmtTool(m.tool)}${m.tool.error ? ' — ERROR' : ''}`);
      if (m.tool.output) stop.push(`  \`\`\`\n  ${clip(String(m.tool.output).trim(), 1200).replace(/\n/g, '\n  ')}\n  \`\`\``);
    }
  }
  if (lastAsst) stop.push(`\nLast reply from ${toolName(s.tool)}:\n> ${clip(lastAsst.text.trim(), 4000).replace(/\n/g, '\n> ')}`);

  // Conversation: newest first gets the budget; older turns shrink to user requests only.
  const turns = [];
  let cur = null;
  const flat = (x) => x.trim().replace(/^#{1,6} +/gm, ''); // quoted headings would break the note's structure
  for (const m of msgs) {
    if (m.role === 'user' && m.text) { cur = { user: flat(m.text), replies: [], tools: [] }; turns.push(cur); continue; }
    if (!cur) continue;
    if (m.role === 'assistant' && m.text) cur.replies.push(flat(m.text));
    else if (m.role === 'tool' && m.tool) cur.tools.push(m.tool);
  }
  const fixed = [...head, ...stop].join('\n');
  let budget = NOTE_BUDGET - fixed.length - 600;
  const rendered = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const tn = turns[i];
    const age = turns.length - 1 - i;
    const full = age < 12;
    let block = `**User:** ${clip(tn.user, full ? 2500 : 600)}`;
    if (tn.tools.length) block += `\n  - tools: ${tn.tools.slice(0, full ? 10 : 4).map(fmtTool).join('; ')}${tn.tools.length > (full ? 10 : 4) ? ` … +${tn.tools.length - (full ? 10 : 4)}` : ''}`;
    if (tn.replies.length) block += `\n**${toolName(s.tool)}:** ${clip(tn.replies.join('\n'), full ? 1800 : 300)}`;
    if (block.length > budget) {
      const short = `**User:** ${clip(oneLine(tn.user), 200)}`;
      if (short.length > budget) { rendered.push(`*(${i + 1} earlier turns omitted — see the original session if needed)*`); break; }
      rendered.push(short); budget -= short.length; continue;
    }
    rendered.push(block); budget -= block.length + 2;
  }
  const convo = ['## Conversation (oldest first; older turns shortened)', ...rendered.reverse()].join('\n\n');
  return [fixed.split('## Where it stopped')[0].trimEnd(), '', convo, '', stop.join('\n')].join('\n');
}

const SUMMARY_PROMPT = `Another AI coding agent is about to take over this exact session from you (you're running low on usage limits). Write a handoff summary for it, like the summary you'd write when compacting this conversation. Use these sections, be specific (file paths, function names, exact commands, error messages), and do not run tools:

1. Primary request and intent — everything the user asked for, including later changes of mind.
2. Key decisions and conventions — what was decided and why; approaches that were tried and rejected.
3. Files and code — files created/changed and what each change does; important snippets if short.
4. Errors and fixes — problems hit and how they were solved (or not).
5. Current state — what is done, verified, and what is half-finished right now.
6. Next step — the exact next action, quoting the user's latest request.

Reply with only the summary.`;

/**
 * Ask the source CLI (which still holds the full context) for a compact-style summary.
 * Claude: resumed in a throwaway fork (original session untouched). Codex: one extra turn in the session.
 * Returns null when the tool can't (rate limited, unsupported, timeout) — the caller falls back.
 */
export function agentSummary(s, { timeoutMs = 180_000 } = {}) {
  const bin = binFor(s.tool);
  if (!bin || !['claude', 'codex'].includes(s.tool)) return Promise.resolve(null);
  const args = s.tool === 'claude'
    ? ['-p', '--resume', s.id, '--fork-session', '--no-session-persistence', '--output-format', 'json', '--permission-mode', 'plan']
    : ['exec', 'resume', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="read-only"', s.id, '-'];
  return new Promise((resolve) => {
    let out = '';
    let child;
    try { child = spawnCli(bin, args, { cwd: s.cwd || undefined, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] }); } catch { resolve(null); return; }
    if (child.pid) childPids.add(child.pid);
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, timeoutMs);
    child.stdout.on('data', (c) => { out += c; });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', () => {
      clearTimeout(timer);
      if (child.pid) childPids.delete(child.pid);
      let text = null;
      try {
        if (s.tool === 'claude') {
          const j = JSON.parse(out.trim().split('\n').filter(Boolean).pop());
          text = !j.is_error && typeof j.result === 'string' ? j.result : null;
        } else {
          for (const line of out.split('\n')) {
            try { const e = JSON.parse(line); if (e.type === 'item.completed' && e.item?.type === 'agent_message') text = e.item.text; } catch { /* skip */ }
          }
        }
      } catch { /* fallthrough */ }
      resolve(text && text.length > 200 ? text : null);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(SUMMARY_PROMPT);
  });
}

async function writeNote(cwd, s, text) {
  const dir = path.join(cwd, '.baton', 'handoff');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(cwd, '.baton', '.gitignore'), '*\n').catch(() => {});
  const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${s.tool}-${s.id.slice(0, 8)}.md`);
  await fsp.writeFile(file, text);
  return file;
}

function link(fromKey, toKey, note) {
  db.prepare('INSERT OR REPLACE INTO session_links (from_key, to_key, created, note) VALUES (?, ?, ?, ?)').run(fromKey, toKey, Date.now(), note || null);
}

/** Linked sessions: { from: [{key, created}], to: [...] } */
export function linksOf(key) {
  return {
    from: db.prepare('SELECT from_key AS key, created FROM session_links WHERE to_key = ? ORDER BY created DESC').all(key),
    to: db.prepare('SELECT to_key AS key, created FROM session_links WHERE from_key = ? ORDER BY created DESC').all(key),
  };
}

/**
 * Hand session `fromTool:fromId` to `toTool`. If `toSessionId` is given (e.g. going back to the original
 * session), that session is resumed; otherwise a new one is started in the same folder.
 * mode: 'summary' (source agent writes a compact-style summary first, falls back) | 'extract' (zero tokens).
 */
export async function handoff({ fromTool, fromId, toTool, toSessionId, prompt, model, effort, perm, images, mode = 'extract' }) {
  if (fromTool === toTool && !toSessionId) throw new Error(tr('같은 도구로는 넘길 수 없어요'));
  const s = await findSession(fromTool, fromId);
  if (!s) throw new Error(tr('세션을 찾을 수 없어요'));
  const cwd = s.cwd && fs.existsSync(s.cwd) ? s.cwd : s.project;
  if (!cwd || !fs.existsSync(cwd)) throw new Error(tr('세션의 작업 폴더를 찾을 수 없어요'));
  const msgs = await readMessages(s);
  const summary = mode === 'summary' ? await agentSummary(s) : null;
  const note = await buildHandoffNote(s, msgs, { agentSummary: summary });
  const file = await writeNote(cwd, s, note);
  const rel = path.relative(cwd, file);
  const ask = String(prompt || '').trim() || 'Continue the work from where it stopped.';
  const check = 'Before changing anything, start your reply with 2-4 short lines: what you understand was being done, what state it is in, and what you will do next. Then proceed.';
  const composed = toSessionId
    ? `While you were paused, this work continued in another agent (${toolName(fromTool)}). Read \`${rel}\` first — it records what happened there (decisions, files changed, where it stopped). Check the files' current state. ${check}\n\nUser's request: ${ask}`
    : `You are continuing a session handed over from ${toolName(fromTool)} (it ran low on usage limits). First read \`${rel}\` in this folder — it has the goal, decisions, files touched, git state and where it stopped. Check the current state of the files. ${check}\n\nUser's request: ${ask}`;
  const run = startRun({ tool: toTool, sessionId: toSessionId || null, cwd, prompt: composed, model, effort, perm, title: s.title, images });
  const fromKey = `${fromTool}:${fromId}`;
  const save = (id) => {
    if (!id) return;
    link(fromKey, `${toTool}:${id}`, rel);
    // a new session would otherwise be titled after the handoff instructions
    if (!toSessionId && s.title) patchSessionMeta(`${toTool}:${id}`, { title: `↪ ${s.title}` });
  };
  if (run.sessionId) save(run.sessionId);
  else {
    const listener = (ev) => { if (ev.t === 'session') { save(ev.id); run.listeners.delete(listener); } };
    run.listeners.add(listener);
  }
  return { run, note: rel, summarized: Boolean(summary), summaryFailed: mode === 'summary' && !summary };
}
