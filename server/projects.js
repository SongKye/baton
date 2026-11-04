// Group sessions into projects and compute "where did I leave off" signals.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HOME, DAY, shortHome } from './util.js';

const run = promisify(execFile);
const MARKERS = ['.git', 'package.json', 'pubspec.yaml', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod', 'CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'project.godot', 'index.html'];
const rootCache = new Map();

/** Resolve the project root for a cwd: nearest ancestor with a .git, else nearest with a marker file. */
export function projectRoot(cwd) {
  if (!cwd) return null;
  if (cwd.startsWith('/tmp') || cwd.startsWith('/var/tmp')) return null;
  if (rootCache.has(cwd)) return rootCache.get(cwd);
  let gitRoot = null, markerRoot = null;
  let dir = cwd;
  const stop = path.dirname(HOME);
  while (dir && dir !== '/' && dir !== stop && dir !== HOME) {
    let names;
    try { names = fs.readdirSync(dir); } catch { names = null; }
    if (names) {
      if (!gitRoot && names.includes('.git')) { gitRoot = dir; break; }
      if (!markerRoot && MARKERS.some((m) => names.includes(m))) markerRoot = dir;
    }
    dir = path.dirname(dir);
  }
  let root = gitRoot || markerRoot || cwd;
  // Don't collapse a deep folder into a generic container like ~/workspace.
  if (root === path.join(HOME, 'workspace') && cwd !== root) root = markerRoot && markerRoot !== root ? markerRoot : cwd;
  // Asset/gen sub-folders belong to their parent project.
  const sub = root.match(/^(.*?)\/(assets-src|assets|concept|scratchpad|node_modules|dist|build)(\/|$)/);
  if (sub) root = sub[1];
  rootCache.set(cwd, root);
  return root;
}

export function projectName(root) {
  if (!root) return '기타';
  if (root === HOME) return '홈 (~)';
  const base = path.basename(root);
  // "261010_yupum" -> "yupum" (keep date prefix out of the name; it's shown separately)
  return base.replace(/^\d{6}[_-]/, '') || base;
}

export function projectDatePrefix(root) {
  const m = root && path.basename(root).match(/^(\d{2})(\d{2})(\d{2})[_-]/);
  return m ? `20${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Group visible sessions into projects. */
export function groupProjects(sessions, metaMap, briefs) {
  const map = new Map();
  for (const s of sessions) {
    const root = s.project;
    if (!root) continue;
    let p = map.get(root);
    if (!p) {
      const meta = metaMap.get(root);
      p = {
        id: root,
        path: shortHome(root),
        name: meta?.name || projectName(root),
        started: projectDatePrefix(root),
        status: meta?.status || 'active',
        pinned: Boolean(meta?.pinned),
        snoozeUntil: meta?.snooze_until || null,
        lastNudged: meta?.last_nudged || null,
        note: meta?.note || null,
        sessions: 0,
        autoSessions: 0,
        tools: {},
        lastActivity: 0,
        firstActivity: Infinity,
        lastSession: null,
        live: 0,
      };
      map.set(root, p);
    }
    if (s.automated) p.autoSessions++;
    else p.sessions++;
    p.tools[s.tool] = (p.tools[s.tool] || 0) + 1;
    if (s.updated > p.lastActivity) p.lastActivity = s.updated;
    const better = !p.lastSession || (p.lastSession.automated && !s.automated) || (p.lastSession.automated === s.automated && s.updated > p.lastSession.updated);
    if (better) p.lastSession = { tool: s.tool, id: s.id, title: s.title, lastPrompt: s.lastPrompt, lastReply: s.lastReply, updated: s.updated, automated: s.automated };
    if (s.created && s.created < p.firstActivity) p.firstActivity = s.created;
    if (s.live) p.live++;
  }
  // A folder counts as a project if a human worked there, or agents ran there repeatedly.
  const out = [...map.values()].filter((p) => p.sessions > 0 || p.autoSessions >= 3);
  for (const p of out) {
    if (p.firstActivity === Infinity) p.firstActivity = p.lastActivity;
    p.idleDays = Math.floor((Date.now() - p.lastActivity) / DAY);
    const b = briefs.get(p.id);
    p.brief = b ? { oneLiner: b.oneLiner, next: b.next?.[0] || null, progress: b.progress ?? null, created: b.created, fingerprint: b.fingerprint } : null;
  }
  return out;
}

/** Fingerprint used to decide if a brief is out of date. */
export function projectFingerprint(p) {
  return `${p.lastActivity}:${p.sessions}:${p.autoSessions}`;
}

const gitCache = new Map();
export async function gitInfo(root) {
  if (!root) return null;
  const c = gitCache.get(root);
  if (c && Date.now() - c.at < 60_000) return c.value;
  let value = null;
  try {
    const opts = { cwd: root, timeout: 4000, maxBuffer: 1 << 20 };
    const [{ stdout: inside }] = await Promise.all([run('git', ['rev-parse', '--is-inside-work-tree'], opts)]);
    if (inside.trim() === 'true') {
      const [log, status, branch] = await Promise.all([
        run('git', ['log', '-12', '--date=unix', '--format=%h%x09%ad%x09%s'], opts).catch(() => ({ stdout: '' })),
        run('git', ['status', '--porcelain'], opts).catch(() => ({ stdout: '' })),
        run('git', ['branch', '--show-current'], opts).catch(() => ({ stdout: '' })),
      ]);
      const commits = log.stdout.trim().split('\n').filter(Boolean).map((l) => {
        const [hash, ts, ...rest] = l.split('\t');
        return { hash, ts: Number(ts) * 1000, subject: rest.join('\t') };
      });
      const changed = status.stdout.split('\n').filter(Boolean);
      value = { branch: branch.stdout.trim(), commits, dirty: changed.length, changed: changed.slice(0, 30) };
    }
  } catch { value = null; }
  gitCache.set(root, { at: Date.now(), value });
  return value;
}

/** Readme / todo hints that help the brief. */
export function projectDocs(root) {
  const out = [];
  if (!root) return out;
  for (const f of ['TODO.md', 'todo.md', 'PLAN.md', 'plan.md', 'ROADMAP.md', 'CLAUDE.md', 'AGENTS.md', 'README.md']) {
    const p = path.join(root, f);
    try {
      const st = fs.statSync(p);
      if (!st.isFile()) continue;
      const text = fs.readFileSync(p, 'utf8').slice(0, 3000);
      out.push({ file: f, text });
      if (out.length >= 3) break;
    } catch { /* missing */ }
  }
  return out;
}
