// Manual release checks and in-place updates before restarting.
// Automatic checks and new-version alerts are disabled:
//   release install (scripts/install.sh: HEAD = a vX.Y.Z tag) → git checkout of the new release tag
//   main checkout (developers)                                → git pull --ff-only
// Both then run npm ci. Zip installs get a download link instead.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, cmpVersion } from './util.js';
import { getKV, setKV } from './store.js';
import { sh, IS_WIN, IS_MAC } from './platform.js';

export { cmpVersion };

const REPO = process.env.BATON_UPDATE_REPO || 'SongKye/baton';
const EVERY = 6 * 3600_000;
export const CURRENT = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '0.0.0'; } })();

async function fetchLatest() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'baton-update-check' }, signal: ctl.signal });
    if (!r.ok) throw new Error(`GitHub HTTP ${r.status}`);
    const j = await r.json();
    const zip = (j.assets || []).find((a) => /\.zip$/.test(a.name));
    return { latest: String(j.tag_name || '').replace(/^v/, ''), url: j.html_url, zip: zip?.browser_download_url || null, notes: String(j.body || '').slice(0, 8000), publishedAt: j.published_at ? Date.parse(j.published_at) : null };
  } finally { clearTimeout(timer); }
}

/** Fallback for git installs (private repo, API rate limit, no api.github.com): newest vX.Y.Z tag on origin. */
async function latestTag() {
  if (!fs.existsSync(path.join(ROOT, '.git'))) return null;
  const out = await sh('git', ['-C', ROOT, 'ls-remote', '--tags', '--refs', 'origin'], 20_000);
  const tags = [...out.matchAll(/refs\/tags\/v(\d+\.\d+\.\d+(?:-[\w.]+)?)\s*$/gm)].map((m) => m[1]).filter((v) => !v.includes('-'));
  if (!tags.length) return null;
  const latest = tags.sort((a, b) => cmpVersion(b, a))[0];
  return { latest, url: `https://github.com/${REPO}/releases/tag/v${latest}`, zip: null, notes: '', publishedAt: null };
}

const STABLE = /^\d+\.\d+\.\d+$/;

/** How Baton was installed, and whether it can update itself.
 *  channel 'release': HEAD sits exactly on a vX.Y.Z tag (the installer does this); 'main': the main branch;
 *  'merged': another branch whose commits are all in origin/main already (e.g. a merged PR branch) —
 *  switching back to main loses nothing, so the update does that. */
async function installInfo() {
  if (!fs.existsSync(path.join(ROOT, '.git'))) return { kind: 'zip', canAuto: false };
  const git = (...a) => sh('git', ['-C', ROOT, ...a]).then((o) => o.trim());
  const branch = await git('rev-parse', '--abbrev-ref', 'HEAD');
  const dirty = Boolean(await git('status', '--porcelain', '--untracked-files=no'));
  const tag = branch === 'HEAD' ? await git('describe', '--tags', '--exact-match', 'HEAD') : '';
  let channel = branch === 'main' ? 'main' : STABLE.test(tag.replace(/^v/, '')) ? 'release' : null;
  if (!channel && branch && branch !== 'HEAD') {
    await sh('git', ['-C', ROOT, 'fetch', '--quiet', 'origin', 'main'], 20_000);
    const head = await git('rev-parse', 'HEAD');
    if (head && head === await git('merge-base', 'HEAD', 'origin/main')) channel = 'merged';
  }
  return { kind: 'git', branch, tag: tag || null, channel, dirty, canAuto: Boolean(channel) && !dirty };
}

function view(c) {
  return { current: CURRENT, enabled: false, checkedAt: c?.at || null, error: c?.error || null,
    latest: c?.latest || null, newer: Boolean(c?.latest && cmpVersion(c.latest, CURRENT) > 0), url: c?.url || `https://github.com/${REPO}/releases`, zip: c?.zip || null, notes: c?.notes || '', publishedAt: c?.publishedAt || null };
}
/** Cached result only (cheap, for /api/state). */
export function updateCached() {
  const v = view(getKV('update_check', null));
  return { current: v.current, latest: v.latest, newer: v.newer };
}

export async function checkUpdate({ force = false } = {}) {
  let c = getKV('update_check', null);
  if (force || !c || Date.now() - c.at > EVERY || c.current !== CURRENT) {
    try { c = { at: Date.now(), current: CURRENT, ...(await fetchLatest()) }; }
    catch (e) {
      const tag = await latestTag().catch(() => null);
      c = tag ? { at: Date.now(), current: CURRENT, ...tag }
        : { ...(c || {}), at: Date.now(), current: CURRENT, error: e.name === 'AbortError' ? 'timeout' : e.message };
    }
    setKV('update_check', c);
  }
  const v = view(c);
  const install = await installInfo();
  // The new code is already on disk (pulled / switched branch by hand) and only this process is old: a restart is enough.
  const onDisk = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return CURRENT; } })();
  install.restartOnly = cmpVersion(onDisk, CURRENT) > 0 && (!v.latest || cmpVersion(onDisk, v.latest) >= 0);
  install.onDisk = onDisk;
  return { ...v, install: { ...install, manual: [...gitUpdateSteps(install.channel, v.latest), 'npm ci --omit=dev'].join(' && ') } };
}

/** The git part of an update: release installs move to the newest release tag, main checkouts pull,
 *  anything else (a merged or unmerged feature branch) goes back to main first. */
export function gitUpdateSteps(channel, latest) {
  if (channel === 'release' && STABLE.test(String(latest || ''))) {
    return ['git fetch --tags --force origin', `git -c advice.detachedHead=false checkout --quiet v${latest}`];
  }
  if (channel === 'main') return ['git pull --ff-only'];
  return ['git checkout main', 'git pull --ff-only'];
}

/** The shell command that updates a git install (shown to the user too). */
export async function updateCommand() {
  const i = await installInfo();
  const steps = [...gitUpdateSteps(i.channel, getKV('update_check', null)?.latest), 'npm ci --omit=dev'];
  // PowerShell has no &&: nest each next step under the previous one's success
  return IS_WIN ? `Set-Location "${ROOT}"; ${steps.reduceRight((rest, c) => (rest ? `${c}; if ($?) { ${rest} }` : c), '')}`
    : `cd "${ROOT}" && ${steps.join(' && ')}`;
}

/** Restart Baton the way it was started: systemd / launchd restart it themselves; otherwise respawn. */
export function restartSelf(server) {
  setTimeout(async () => {
    // only when THIS process is the baton.service main process (a terminal can inherit INVOCATION_ID too)
    if (!IS_WIN && !IS_MAC && process.env.INVOCATION_ID) {
      const pid = (await sh('systemctl', ['--user', 'show', 'baton.service', '-p', 'MainPID', '--value'])).trim();
      if (Number(pid) === process.pid) {
        spawn('systemctl', ['--user', 'restart', 'baton.service'], { detached: true, stdio: 'ignore' }).unref();
        return;
      }
    }
    if (IS_MAC && process.env.XPC_SERVICE_NAME === 'dev.baton.dashboard') process.exit(0); // launchd KeepAlive starts it again
    let done = false;
    const respawn = () => {
      if (done) return;
      done = true;
      spawn(process.execPath, process.argv.slice(1), { cwd: ROOT, detached: true, stdio: 'ignore', env: process.env, windowsHide: true }).unref();
      process.exit(0);
    };
    server.close(respawn); // frees the port first so the new process can listen
    server.closeAllConnections?.(); // SSE streams would otherwise keep close() waiting
    setTimeout(respawn, 3000).unref();
  }, 400);
}
