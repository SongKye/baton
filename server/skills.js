// Skills (and slash commands) each CLI can see, where they live, and when an agent actually used them.
// Usage records come from the usage scanner (usage.js), which tags every transcript line that loads a skill.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { HOME, shortHome } from './util.js';
import { projectsList } from './indexer.js';
import { skillUses } from './usage.js';
import { tr } from './i18n.js';
import { CLAUDE_HOME, CODEX_HOME } from './env.js';

const exists = (p) => { try { return fs.statSync(p); } catch { return null; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

function frontmatter(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  const out = {};
  if (!m) return out;
  let key = null;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) { key = kv[1]; out[key] = kv[2].replace(/^["']|["']$/g, '').trim(); }
    else if (key && /^\s+\S/.test(line)) out[key] = `${out[key]} ${line.trim()}`.trim();
  }
  if (out.description === '>' || out.description === '|') out.description = '';
  return out;
}

async function readSkillDir(dir, base) {
  const file = path.join(dir, 'SKILL.md');
  const st = exists(file);
  if (!st) return null;
  let text = '';
  try { text = (await fsp.readFile(file, 'utf8')).slice(0, 8000); } catch { return null; }
  const fm = frontmatter(text);
  return { ...base, name: fm.name || path.basename(dir), description: fm.description || '', path: file, dir, mtime: st.mtimeMs, kind: 'skill' };
}

async function skillsIn(root, base, { depth = 1 } = {}) {
  const out = [];
  let ents = [];
  try { ents = await fsp.readdir(root, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    const d = path.join(root, e.name);
    const s = await readSkillDir(d, base);
    if (s) out.push(s);
    else if (depth > 1) out.push(...await skillsIn(d, base, { depth: depth - 1 }));
  }
  return out;
}

async function commandsIn(root, base) {
  const out = [];
  let ents = [];
  try { ents = await fsp.readdir(root); } catch { return out; }
  for (const n of ents) {
    if (!n.endsWith('.md')) continue;
    const file = path.join(root, n);
    let text = '';
    try { text = (await fsp.readFile(file, 'utf8')).slice(0, 4000); } catch { continue; }
    const fm = frontmatter(text);
    out.push({ ...base, name: n.replace(/\.md$/, ''), description: fm.description || text.replace(/^---[\s\S]*?---/, '').trim().split('\n')[0].slice(0, 160), path: file, dir: root, mtime: exists(file)?.mtimeMs || 0, kind: 'command' });
  }
  return out;
}

async function discover() {
  const C = CLAUDE_HOME;
  const X = CODEX_HOME;
  const G = path.join(HOME, '.gemini', 'antigravity-cli');
  const all = [];
  // ---- Claude Code
  all.push(...(await skillsIn(path.join(C, 'skills'), { tool: 'claude', scope: 'global', scopeLabel: tr('내 전역 스킬') })).filter((s) => !s.dir.includes('/synced/')));
  const synced = path.join(C, 'skills', 'synced');
  for (const b of await fsp.readdir(synced).catch(() => [])) {
    for (const s of await skillsIn(path.join(synced, b), { tool: 'claude', scope: 'synced', scopeLabel: tr('claude.ai 동기화') })) all.push({ ...s, alias: `anthropic-skills:${s.name}` });
  }
  all.push(...await commandsIn(path.join(C, 'commands'), { tool: 'claude', scope: 'global', scopeLabel: tr('내 전역 명령어') }));
  const installed = readJson(path.join(C, 'plugins', 'installed_plugins.json'))?.plugins || {};
  for (const [pid, entries] of Object.entries(installed)) {
    for (const ent of [].concat(entries)) {
      if (!ent?.installPath) continue;
      const plugin = pid.split('@')[0];
      for (const s of await skillsIn(path.join(ent.installPath, 'skills'), { tool: 'claude', scope: 'plugin', scopeLabel: tr('플러그인 · {name}', { name: plugin }) })) all.push({ ...s, alias: `${plugin}:${s.name}` });
    }
  }
  // ---- Codex
  all.push(...await skillsIn(path.join(X, 'skills', '.system'), { tool: 'codex', scope: 'builtin', scopeLabel: tr('Codex 기본 내장') }));
  all.push(...(await skillsIn(path.join(X, 'skills'), { tool: 'codex', scope: 'global', scopeLabel: tr('내 전역 스킬') })));
  all.push(...await skillsIn(path.join(HOME, '.agents', 'skills'), { tool: 'codex', scope: 'global', scopeLabel: tr('내 전역 스킬 (~/.agents)') }));
  for (const s of await skillsIn(path.join(X, 'plugins', 'cache'), { tool: 'codex', scope: 'plugin', scopeLabel: tr('플러그인') }, { depth: 5 })) {
    const m = s.dir.match(/plugins\/cache\/[^/]+\/([^/]+)\//);
    all.push({ ...s, scopeLabel: tr('플러그인 · {name}', { name: m ? m[1] : '?' }) });
  }
  // ---- Antigravity
  all.push(...await skillsIn(path.join(G, 'builtin', 'skills'), { tool: 'agy', scope: 'builtin', scopeLabel: tr('Antigravity 기본 내장') }));
  all.push(...await skillsIn(path.join(G, 'skills'), { tool: 'agy', scope: 'global', scopeLabel: tr('내 전역 스킬') }));
  all.push(...await skillsIn(path.join(HOME, '.gemini', 'skills'), { tool: 'agy', scope: 'global', scopeLabel: tr('내 전역 스킬 (~/.gemini)') }));
  // ---- per project (every project Baton knows about)
  const projects = await projectsList();
  const roots = [...new Set(projects.map((p) => p.id).filter((r) => r && r !== HOME))];
  for (const root of roots) {
    const name = projects.find((p) => p.id === root)?.name || path.basename(root);
    const base = { scope: 'project', scopeLabel: tr('프로젝트 · {name}', { name }), project: root };
    all.push(...await skillsIn(path.join(root, '.claude', 'skills'), { ...base, tool: 'claude' }));
    all.push(...await commandsIn(path.join(root, '.claude', 'commands'), { ...base, tool: 'claude' }));
    all.push(...await skillsIn(path.join(root, '.agents', 'skills'), { ...base, tool: 'codex' }));
    all.push(...await skillsIn(path.join(root, '.codex', 'skills'), { ...base, tool: 'codex' }));
    all.push(...await skillsIn(path.join(root, '.agent', 'skills'), { ...base, tool: 'agy' }));
    all.push(...await skillsIn(path.join(root, '.gemini', 'skills'), { ...base, tool: 'agy' }));
  }
  // de-dupe by path
  const seen = new Set();
  return all.filter((s) => (seen.has(s.path) ? false : seen.add(s.path)));
}

let cache = { at: 0, list: [] };

export async function skillsReport() {
  if (Date.now() - cache.at > 60_000) cache = { at: Date.now(), list: await discover() };
  const skills = cache.list.map((s) => ({ ...s, id: Buffer.from(s.path).toString('base64url'), uses: 0, lastUsed: null, sessions: [] }));
  const byPath = new Map(skills.map((s) => [s.path, s]));
  const unknown = new Map();
  for (const u of await skillUses()) {
    // u: { tool, name, path, ts, session, cwd }
    let s = u.path ? byPath.get(u.path) : null;
    if (!s) {
      const sameName = (x) => x.name === u.name || x.alias === u.name || path.basename(x.dir) === u.name || (u.path && path.basename(path.dirname(u.path)) === path.basename(x.dir));
      let cands = skills.filter((x) => x.tool === u.tool && sameName(x));
      // agents happily read other CLIs' skill files (codex opening .claude/skills/…) -> match across tools in the same project
      if (!cands.length) cands = skills.filter((x) => sameName(x) && x.project && u.cwd && (u.cwd === x.project || u.cwd.startsWith(x.project + '/')));
      // prefer the skill in the session's own project, then global
      s = cands.find((x) => x.project && u.cwd && (u.cwd === x.project || u.cwd.startsWith(x.project + '/'))) || cands.find((x) => x.scope !== 'project') || cands[0];
    }
    if (!s && u.cmd) continue; // built-in slash commands (/model, /clear …) are not skills
    if (!s) {
      const k = `${u.tool}:${u.name}`;
      s = unknown.get(k) || { tool: u.tool, name: u.name, description: '', path: u.path || null, scope: 'unlisted', scopeLabel: u.tool === 'claude' ? tr('Claude Code 내장') : tr('목록에 없는 스킬'), kind: 'skill', id: Buffer.from(`unlisted:${k}`).toString('base64url'), uses: 0, lastUsed: null, sessions: [] };
      unknown.set(k, s);
    }
    s.uses++;
    if (!s.lastUsed || u.ts > s.lastUsed) s.lastUsed = u.ts;
    const ex = s.sessions.find((x) => x.key === u.session);
    if (ex) { ex.n++; ex.ts = Math.max(ex.ts, u.ts); } else s.sessions.push({ key: u.session, ts: u.ts, n: 1, cwd: u.cwd });
  }
  const list = [...skills, ...unknown.values()].map((s) => ({
    ...s, dir: undefined, pathShort: s.path ? shortHome(s.path) : null,
    sessions: s.sessions.sort((a, b) => b.ts - a.ts).slice(0, 12),
  }));
  return { skills: list, scannedAt: cache.at };
}

export async function skillDetail(id) {
  const r = await skillsReport();
  const s = r.skills.find((x) => x.id === id);
  if (!s) return null;
  let content = '';
  if (s.path) { try { content = (await fsp.readFile(s.path, 'utf8')).slice(0, 60000); } catch { /* gone */ } }
  let files = [];
  if (s.path && s.kind === 'skill') { try { files = (await fsp.readdir(path.dirname(s.path))).filter((f) => f !== 'SKILL.md').slice(0, 40); } catch { /* ignore */ } }
  return { ...s, content, files };
}
