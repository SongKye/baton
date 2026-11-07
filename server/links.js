// "What is this project tied to?" — its git remotes and the hosting / backend services it's set up for,
// each with a link to that service's own dashboard. Read-only: only the project's own config files are read
// (never secret values; from .env files only the public SUPABASE_URL line).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import { shortHome } from './util.js';
import { getKV, setKV } from './store.js';
import { tr } from './i18n.js';

const run = promisify(execFile);

// ---------------------------------------------------------------- git remotes
/** git@github.com:o/r.git, ssh://git@host/o/r, https://user@host/o/r.git -> { host, owner, repo, web } */
export function parseRemote(url) {
  if (!url) return null;
  let u = String(url).trim();
  let m = u.match(/^(?:ssh:\/\/)?[\w.-]+@([\w.-]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/);
  if (!m) m = u.match(/^(?:https?|git):\/\/(?:[^@/]+@)?([\w.-]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/);
  if (!m) return { host: null, owner: null, repo: u, slug: u, web: null };
  const host = m[1].toLowerCase();
  const slug = m[2].replace(/^\/+/, '');
  const parts = slug.split('/');
  const repo = parts.pop();
  const owner = parts.join('/');
  const webHost = host === 'ssh.github.com' ? 'github.com' : host;
  return { host: webHost, owner, repo, slug: `${owner}/${repo}`, web: `https://${webHost}/${owner}/${repo}` };
}

const remoteCache = new Map();
/** [{ name: 'origin', url, host, owner, repo, slug, web }] — one cheap git call, cached for 2 minutes. */
export async function gitRemotes(root) {
  if (!root) return [];
  const c = remoteCache.get(root);
  if (c && Date.now() - c.at < 120_000) return c.v;
  let v = [];
  try {
    const { stdout } = await run('git', ['config', '--get-regexp', '^remote\\..*\\.url$'], { cwd: root, timeout: 4000 });
    for (const line of stdout.split('\n').filter(Boolean)) {
      const [key, url] = line.split(/\s+/, 2);
      const name = key.replace(/^remote\./, '').replace(/\.url$/, '');
      const r = parseRemote(url);
      if (r) v.push({ name, url: url.replace(/\/\/[^@/]+@/, '//'), ...r }); // drop credentials embedded in https URLs
    }
    v.sort((a, b) => (a.name === 'origin' ? -1 : b.name === 'origin' ? 1 : a.name.localeCompare(b.name)));
  } catch { v = []; }
  remoteCache.set(root, { at: Date.now(), v });
  return v;
}

// ---------------------------------------------------------------- custom links (added by hand per project)
const LINKS = 'project_links';
/** Guess the service from a URL so a hand-added Vercel / Supabase / … link gets the right logo. */
export function kindFromUrl(url) {
  let h = '';
  try { h = new URL(url).hostname.toLowerCase(); } catch { return 'link'; }
  const map = [[/(^|\.)github\.io$/, 'ghpages'], [/(^|\.)github\.com$/, 'github'], [/gitlab/, 'gitlab'], [/bitbucket/, 'bitbucket'],
    [/vercel\.(com|app)$/, 'vercel'], [/firebase|\.web\.app$|firebaseapp\.com$/, 'firebase'], [/supabase\.(com|co)$/, 'supabase'],
    [/netlify\.(com|app)$/, 'netlify'], [/cloudflare|pages\.dev$|workers\.dev$/, 'cloudflare'], [/fly\.(io|dev)$/, 'fly'],
    [/render\.com$|onrender\.com$/, 'render'], [/railway\.(com|app)$/, 'railway'], [/expo\.(dev|io)$/, 'expo'], [/itch\.io$/, 'itch']];
  for (const [re, k] of map) if (re.test(h)) return k;
  return 'link';
}
export function customLinks(root) { return (getKV(LINKS, {}) || {})[root] || []; }
export function addLink(root, { name, url }) {
  url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let u;
  try { u = new URL(url); } catch { throw new Error(tr('주소가 올바르지 않아요')); }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) throw new Error(tr('주소가 올바르지 않아요'));
  const all = getKV(LINKS, {}) || {};
  const list = all[root] || [];
  const item = { id: crypto.randomBytes(4).toString('hex'), name: String(name || '').trim().slice(0, 60) || u.hostname.replace(/^www\./, ''), url: u.href, added: Date.now() };
  all[root] = [...list, item].slice(-30);
  setKV(LINKS, all);
  return item;
}
export function removeLink(root, id) {
  const all = getKV(LINKS, {}) || {};
  all[root] = (all[root] || []).filter((x) => x.id !== id);
  if (!all[root].length) delete all[root];
  setKV(LINKS, all);
}

// ---------------------------------------------------------------- services
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/^\s*\/\/.*$/gm, '')); } catch { return null; } };
const readText = (f, max = 200_000) => { try { const st = fs.statSync(f); return st.isFile() && st.size < max ? fs.readFileSync(f, 'utf8') : null; } catch { return null; } };
const exists = (f) => { try { fs.accessSync(f); return true; } catch { return false; } };

/** Services this project is set up for, each with a dashboard link. */
export async function projectServices(root) {
  if (!root || !exists(root)) return [];
  const out = [];
  const add = (s) => { if (!out.some((x) => x.id === s.id)) out.push(s); };
  const at = (...p) => path.join(root, ...p);
  const pkg = readJson(at('package.json')) || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const scripts = Object.values(pkg.scripts || {}).join('\n');

  // GitHub / GitLab / … from git remotes
  for (const r of await gitRemotes(root)) {
    if (!r.web) continue;
    const kind = /github\.com$/.test(r.host) ? 'github' : /gitlab/.test(r.host) ? 'gitlab' : /bitbucket/.test(r.host) ? 'bitbucket' : 'git';
    add({ id: `git:${r.web}`, kind, name: r.slug, detail: r.name === 'origin' ? null : r.name, url: r.web, source: '.git/config' });
  }

  // Vercel
  const vp = readJson(at('.vercel', 'project.json'));
  if (vp || exists(at('vercel.json')) || /\bvercel\b/.test(scripts)) {
    add({ id: 'vercel', kind: 'vercel', name: vp?.projectName || 'Vercel', detail: null,
      url: 'https://vercel.com/dashboard', source: vp ? '.vercel/project.json' : exists(at('vercel.json')) ? 'vercel.json' : 'package.json' });
  }

  // Firebase (Hosting, Firestore, …)
  const frc = readJson(at('.firebaserc'));
  const fb = readJson(at('firebase.json'));
  const fbId = frc?.projects?.default || Object.values(frc?.projects || {})[0] || null;
  if (fbId || fb || deps.firebase || deps['firebase-admin']) {
    const parts = fb ? ['hosting', 'firestore', 'functions', 'storage', 'database', 'auth'].filter((k) => fb[k]) : [];
    add({ id: 'firebase', kind: 'firebase', name: fbId || 'Firebase', detail: parts.join(' · ') || null,
      url: fbId ? `https://console.firebase.google.com/project/${encodeURIComponent(fbId)}/overview` : 'https://console.firebase.google.com/',
      site: fbId && fb?.hosting ? `https://${fbId}.web.app` : null, source: frc ? '.firebaserc' : fb ? 'firebase.json' : 'package.json' });
  }

  // Supabase: project ref from the CLI link or the public project URL in .env files
  let ref = (readText(at('supabase', '.temp', 'project-ref')) || '').trim() || null;
  if (!ref) {
    for (const f of ['.env', '.env.local', '.env.development', '.env.production', '.env.example']) {
      const m = (readText(at(f)) || '').match(/^\s*(?:export\s+)?[\w]*SUPABASE_URL\s*=\s*["']?https:\/\/([a-z0-9]{15,30})\.supabase\.co/m);
      if (m) { ref = m[1]; break; }
    }
  }
  if (ref || exists(at('supabase', 'config.toml')) || deps['@supabase/supabase-js'] || deps['@supabase/ssr']) {
    add({ id: 'supabase', kind: 'supabase', name: ref || 'Supabase', detail: exists(at('supabase', 'migrations')) ? 'migrations' : null,
      url: ref ? `https://supabase.com/dashboard/project/${ref}` : 'https://supabase.com/dashboard/projects', source: ref ? 'project ref' : 'supabase/' });
  }

  // Netlify
  const ns = readJson(at('.netlify', 'state.json'));
  if (ns || exists(at('netlify.toml'))) {
    add({ id: 'netlify', kind: 'netlify', name: 'Netlify', detail: null,
      url: ns?.siteId ? `https://app.netlify.com/sites/${encodeURIComponent(ns.siteId)}` : 'https://app.netlify.com/', source: ns ? '.netlify/state.json' : 'netlify.toml' });
  }

  // Cloudflare Workers / Pages
  const wr = ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc'].find((f) => exists(at(f)));
  if (wr) {
    const name = ((readText(at(wr)) || '').match(/^\s*"?name"?\s*[=:]\s*"([^"]+)"/m) || [])[1] || null;
    add({ id: 'cloudflare', kind: 'cloudflare', name: name || 'Cloudflare', detail: null, url: 'https://dash.cloudflare.com/', source: wr });
  }

  // Fly.io · Render · Railway · Expo
  const fly = readText(at('fly.toml'));
  if (fly) { const app = (fly.match(/^\s*app\s*=\s*["']([^"']+)/m) || [])[1]; add({ id: 'fly', kind: 'fly', name: app || 'Fly.io', url: app ? `https://fly.io/apps/${encodeURIComponent(app)}` : 'https://fly.io/dashboard', source: 'fly.toml' }); }
  if (exists(at('render.yaml'))) add({ id: 'render', kind: 'render', name: 'Render', url: 'https://dashboard.render.com/', source: 'render.yaml' });
  if (exists(at('railway.json')) || exists(at('railway.toml'))) add({ id: 'railway', kind: 'railway', name: 'Railway', url: 'https://railway.com/dashboard', source: 'railway.json' });
  if (exists(at('eas.json'))) add({ id: 'expo', kind: 'expo', name: 'Expo (EAS)', url: 'https://expo.dev/', source: 'eas.json' });

  // GitHub Pages (a deploy-pages / gh-pages workflow) and itch.io (butler / itch build scripts)
  const gh = out.find((s) => s.kind === 'github');
  try {
    const wf = at('.github', 'workflows');
    const txt = fs.readdirSync(wf).filter((f) => /\.ya?ml$/.test(f)).map((f) => readText(path.join(wf, f)) || '').join('\n');
    if (gh && /actions\/deploy-pages|peaceiris\/actions-gh-pages|JamesIves\/github-pages-deploy/.test(txt)) {
      const r = parseRemote(gh.url);
      add({ id: 'ghpages', kind: 'ghpages', name: 'GitHub Pages', url: `${gh.url}/settings/pages`, site: `https://${r.owner.toLowerCase()}.github.io/${r.repo}/`, source: '.github/workflows' });
    }
  } catch { /* no workflows */ }
  if (/\bbutler\b|itch/i.test(scripts) || exists(at('.itch.toml'))) add({ id: 'itch', kind: 'itch', name: 'itch.io', url: 'https://itch.io/dashboard', source: 'package.json' });

  for (const l of customLinks(root)) out.push({ id: `custom:${l.id}`, linkId: l.id, kind: kindFromUrl(l.url), name: l.name, url: l.url, custom: true });
  return out;
}

// ---------------------------------------------------------------- repos across projects
let ghUser = { at: 0, v: { login: null, orgs: [], via: null } };
/** Who "me" is on GitHub: the signed-in GitHub CLI account (and its organizations), else git's github.user. */
async function githubIdentity() {
  if (Date.now() - ghUser.at < 3_600_000) return ghUser.v;
  const v = { login: null, orgs: [], via: null };
  try { v.login = (await run('gh', ['api', 'user', '-q', '.login'], { timeout: 6000 })).stdout.trim() || null; if (v.login) v.via = 'gh'; } catch { /* gh missing or signed out */ }
  if (v.login) {
    try { v.orgs = (await run('gh', ['api', 'user/orgs', '--paginate', '-q', '.[].login'], { timeout: 8000 })).stdout.split('\n').map((x) => x.trim()).filter(Boolean); } catch { /* no read:org scope */ }
  } else {
    try { v.login = (await run('git', ['config', '--global', 'github.user'], { timeout: 3000 })).stdout.trim() || null; if (v.login) v.via = 'git'; } catch { /* unset */ }
  }
  ghUser = { at: Date.now(), v };
  return v;
}

/** Every git remote used by a Baton project, with the projects (folders) that use it. */
export async function reposReport(projects) {
  const me = await githubIdentity();
  const login = me.login;
  const orgs = new Set(me.orgs.map((o) => o.toLowerCase()));
  const byWeb = new Map();
  const noRemote = [];
  const queue = [...projects];
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const remotes = await gitRemotes(p.id);
      if (!remotes.length) {
        if (exists(path.join(p.id, '.git'))) noRemote.push({ id: p.id, name: p.name, path: shortHome(p.id), lastActivity: p.lastActivity });
        continue;
      }
      for (const r of remotes) {
        const k = r.web || r.url;
        let e = byWeb.get(k);
        if (!e) { e = { key: k, web: r.web, host: r.host, owner: r.owner, repo: r.repo, slug: r.slug, projects: [] }; byWeb.set(k, e); }
        if (!e.projects.some((x) => x.id === p.id)) e.projects.push({ id: p.id, name: p.name, path: shortHome(p.id), remote: r.name, lastActivity: p.lastActivity, worktree: /[\\/]worktrees[\\/]/.test(p.id) });
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  const repos = [...byWeb.values()].map((e) => ({
    ...e,
    mine: Boolean(login && e.host === 'github.com' && e.owner?.toLowerCase() === login.toLowerCase()),
    org: Boolean(e.host === 'github.com' && orgs.has(String(e.owner || '').toLowerCase())),
    lastActivity: Math.max(...e.projects.map((x) => x.lastActivity || 0)),
    projects: e.projects.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0)),
  }));
  repos.sort((a, b) => b.lastActivity - a.lastActivity);
  noRemote.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
  return { login, orgs: me.orgs, via: me.via, repos, noRemote };
}
