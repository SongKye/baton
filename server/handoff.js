// Hand a session over to another CLI (e.g. Claude is near its limit -> continue in Codex), and back.
// No CLI can open another CLI's session format, so Baton writes a handoff note into the project
// (<cwd>/.baton/handoff/*.md, git-ignored) with the goal, the condensed conversation, touched files and
// git state, then starts (or resumes) a session in the target CLI that reads that note first.
// The exhausted CLI spends no tokens on this; the receiving one reads the note with its own budget.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { db, patchSessionMeta } from './store.js';
import { findSession, readMessages } from './indexer.js';
import { gitInfo, projectName } from './projects.js';
import { startRun } from './runner.js';
import { clip, oneLine, shortHome } from './util.js';
import { TOOLS } from './tools.js';
import { tr } from './i18n.js';

db.exec(`CREATE TABLE IF NOT EXISTS session_links (
  from_key TEXT NOT NULL, to_key TEXT NOT NULL, created INTEGER NOT NULL, note TEXT,
  PRIMARY KEY (from_key, to_key)
)`);

const toolName = (id) => TOOLS[id]?.name || id;

function filesTouched(msgs) {
  const files = new Map(); // path -> action
  for (const m of msgs) {
    if (m.role !== 'tool' || !m.tool) continue;
    const name = String(m.tool.name || '').toLowerCase();
    let input = m.tool.input;
    if (typeof input === 'string') { try { input = JSON.parse(input); } catch { /* raw */ } }
    const p = input && typeof input === 'object' ? (input.file_path || input.path || input.TargetFile || input.AbsolutePath || input.filePath) : null;
    if (p && /edit|write|patch|create|replace|multi/.test(name)) files.set(p, 'edited');
    else if (p && /read|view|open/.test(name) && !files.has(p)) files.set(p, 'read');
    const raw = typeof m.tool.input === 'string' ? m.tool.input : JSON.stringify(m.tool.input || '');
    for (const mm of raw.matchAll(/\*\*\* (?:Update|Add|Delete) File: ([^\n\\"]+)/g)) files.set(mm[1].trim(), 'edited');
  }
  return [...files.entries()];
}

/** Markdown note that lets a different agent pick up exactly where this session stopped. */
export async function buildHandoffNote(s, msgs) {
  const L = [];
  const users = msgs.filter((m) => m.role === 'user' && m.text);
  const lastUser = users.at(-1);
  const lastAsst = [...msgs].reverse().find((m) => m.role === 'assistant' && m.text);
  L.push(`# Handoff: ${s.title || 'session'}`);
  L.push('');
  L.push(`You are taking over a coding session that was started in **${toolName(s.tool)}** (session \`${s.id}\`${s.model ? `, model ${s.model}` : ''}).`);
  L.push(`It was paused — usually because that tool ran low on its usage limit. Continue the same work here.`);
  L.push('');
  L.push(`- Project: ${projectName(s.project || s.cwd)} (\`${shortHome(s.cwd || s.project || '')}\`)`);
  L.push(`- Last activity: ${new Date(s.updated).toISOString()}`);
  L.push('');
  L.push('## Rules for you');
  L.push('- Do not redo work that is already done. Check the current state of files before editing — they may have changed since the notes below.');
  L.push('- Keep the conventions and decisions you see below unless the user says otherwise.');
  L.push('- When unsure what the user wants next, finish the last unfinished request below.');
  L.push('');
  if (users[0]) { L.push('## Original goal'); L.push(clip(users[0].text, 3000)); L.push(''); }
  const files = filesTouched(msgs);
  if (files.length) {
    L.push('## Files touched in that session');
    for (const [p, a] of files.slice(-60)) L.push(`- ${a}: \`${shortHome(p)}\``);
    L.push('');
  }
  const git = await gitInfo(s.project || s.cwd).catch(() => null);
  if (git) {
    L.push(`## Git (branch ${git.branch || '?'})`);
    if (git.changed.length) { L.push('Uncommitted changes:'); for (const c of git.changed.slice(0, 30)) L.push(`- \`${c}\``); }
    if (git.commits.length) { L.push('Recent commits:'); for (const c of git.commits.slice(0, 8)) L.push(`- ${c.hash} ${c.subject}`); }
    L.push('');
  }
  // Conversation, condensed: every user message, assistant replies shortened (recent ones kept longer),
  // tool calls collapsed into one line each.
  L.push('## Conversation so far (condensed, oldest first)');
  const recentFrom = Math.max(0, msgs.length - 40);
  let toolRun = [];
  const flushTools = () => {
    if (!toolRun.length) return;
    L.push(`  - tools: ${toolRun.slice(0, 12).map((x) => `${x.name}${x.summary ? ` (${clip(oneLine(x.summary), 80)})` : ''}`).join('; ')}${toolRun.length > 12 ? ` … +${toolRun.length - 12}` : ''}`);
    toolRun = [];
  };
  msgs.forEach((m, i) => {
    if (m.role === 'tool') { toolRun.push(m.tool || {}); return; }
    flushTools();
    if (m.role === 'user' && m.text) L.push(`\n**User:** ${clip(m.text.trim(), i >= recentFrom ? 4000 : 1200)}`);
    else if (m.role === 'assistant' && m.text) L.push(`\n**${toolName(s.tool)}:** ${clip(m.text.trim(), i >= recentFrom ? 2500 : 400)}`);
  });
  flushTools();
  L.push('');
  L.push('## Where it stopped');
  if (lastUser) L.push(`Last request from the user:\n> ${clip(lastUser.text.trim(), 3000).replace(/\n/g, '\n> ')}`);
  if (lastAsst) L.push(`\nLast reply from ${toolName(s.tool)}:\n> ${clip(lastAsst.text.trim(), 3000).replace(/\n/g, '\n> ')}`);
  return L.join('\n');
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

/** Linked sessions: { parents: [{key, created}], children: [...] } */
export function linksOf(key) {
  return {
    from: db.prepare('SELECT from_key AS key, created FROM session_links WHERE to_key = ? ORDER BY created DESC').all(key),
    to: db.prepare('SELECT to_key AS key, created FROM session_links WHERE from_key = ? ORDER BY created DESC').all(key),
  };
}

/**
 * Hand session `fromTool:fromId` to `toTool`. If `toSessionId` is given (e.g. going back to the original
 * session), that session is resumed; otherwise a new one is started in the same folder.
 */
export async function handoff({ fromTool, fromId, toTool, toSessionId, prompt, model, effort, perm, images }) {
  if (fromTool === toTool && !toSessionId) throw new Error(tr('같은 도구로는 넘길 수 없어요'));
  const s = await findSession(fromTool, fromId);
  if (!s) throw new Error(tr('세션을 찾을 수 없어요'));
  const cwd = s.cwd && fs.existsSync(s.cwd) ? s.cwd : s.project;
  if (!cwd || !fs.existsSync(cwd)) throw new Error(tr('세션의 작업 폴더를 찾을 수 없어요'));
  const msgs = await readMessages(s);
  const note = await buildHandoffNote(s, msgs);
  const file = await writeNote(cwd, s, note);
  const rel = path.relative(cwd, file);
  const ask = String(prompt || '').trim() || 'Continue the work from where it stopped.';
  const composed = toSessionId
    ? `While you were paused, this work continued in another agent (${toolName(fromTool)}). Read \`${rel}\` first — it summarizes what happened there (files changed, decisions, where it stopped). Check the files' current state, then continue.\n\nUser's request: ${ask}`
    : `You are continuing a session handed over from ${toolName(fromTool)} (it ran low on usage limits). First read \`${rel}\` in this folder — it has the original goal, the condensed conversation, files touched and git state. Check the current state of the files, then continue.\n\nUser's request: ${ask}`;
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
  return { run, note: rel };
}
