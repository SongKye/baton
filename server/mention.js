// File/folder list for the chat composer's @ picker: names only, relative to the session's folder.
// git repos use `git ls-files` (respects .gitignore, never follows symlinks); other folders get a small bounded walk.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';

export const MAX_FILES = 20000;
const WALK_MAX_DEPTH = 6;
const WALK_MAX_ENTRIES = 5000;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '__pycache__', '.venv', 'venv', '.next', '.cache', 'coverage']);
const cache = new Map();

function gitFiles(cwd) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, 'ls-files', '-co', '--exclude-standard', '-z'], { timeout: 4000, maxBuffer: 64 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve(null); // not a repo, git missing, too slow…
      resolve(out.split('\0').filter(Boolean));
    });
  });
}

async function walkFiles(cwd) {
  const files = [];
  let seen = 0, truncated = false;
  const walk = async (dir, rel, depth) => {
    if (truncated) return;
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    ents.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of ents) {
      if (++seen > WALK_MAX_ENTRIES) { truncated = true; return; }
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        if (depth < WALK_MAX_DEPTH) await walk(path.join(dir, e.name), r, depth + 1);
      } else if (e.isFile() || e.isSymbolicLink()) files.push(r); // symlinks listed by name, never followed
    }
  };
  await walk(cwd, '', 1);
  return { files, truncated };
}

/** Parent folders of every listed file, e.g. a/b/c.js -> a/, a/b/ */
function dirsOf(files) {
  const out = new Set();
  for (const f of files) {
    let i = f.indexOf('/');
    while (i > 0) { out.add(f.slice(0, i + 1)); i = f.indexOf('/', i + 1); }
  }
  return [...out].sort();
}

/** { files, dirs, truncated } for an absolute folder already checked to be inside HOME. */
export async function mentionFiles(cwd) {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < 30_000) return hit.data;
  let files = await gitFiles(cwd), truncated = false;
  if (!files) ({ files, truncated } = await walkFiles(cwd));
  if (files.length > MAX_FILES) { files = files.slice(0, MAX_FILES); truncated = true; }
  const data = { files, dirs: dirsOf(files), truncated };
  cache.set(cwd, { at: Date.now(), data });
  if (cache.size > 50) cache.delete(cache.keys().next().value);
  return data;
}
