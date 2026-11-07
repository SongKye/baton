// Dev servers Baton remembers per project, so a server that stopped is still listed and can be started again.
//
//   on (enabled)  — Baton keeps it up: started again after a reboot / Baton restart if it isn't running
//   off           — stays in the list, not running, one tap to start again
//   removed       — gone from the list (and not auto-registered again)
//
// Servers Baton starts run outside Baton's own process group (a transient systemd user unit on Linux,
// a detached process elsewhere), so restarting or updating Baton no longer takes them down.
// Servers an agent or a terminal starts are registered automatically while they're running.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { getKV, setKV } from './store.js';
import { listPortsCached, invalidatePorts, stopPort } from './ports.js';
import { projectRoot } from './projects.js';
import { childEnv } from './runner.js';
import { IS_WIN, IS_LINUX, which, sh } from './platform.js';
import { DATA_DIR, ROOT, shortHome, HOME } from './util.js';
import { tr } from './i18n.js';

const KEY = 'servers';
const IGNORED = 'servers_ignored';
const LOG_DIR = path.join(DATA_DIR, 'server-logs');
const unitName = (id) => `baton-srv-${id}`;
const detached = new Map(); // id -> pid (non-systemd starts)

const all = () => getKV(KEY, []) || [];
const save = (list) => setKV(KEY, list);
const ignoredSet = () => new Set(getKV(IGNORED, []) || []);
const sig = (dir, port) => `${dir}|${port}`;

// ---------------------------------------------------------------- systemd (Linux)
let systemdOk = null;
async function hasSystemd() {
  if (systemdOk != null) return systemdOk;
  systemdOk = false;
  if (IS_LINUX && which('systemd-run') && which('systemctl')) {
    const out = await sh('systemctl', ['--user', 'is-system-running'], 4000);
    systemdOk = /running|degraded|starting/.test(out);
  }
  return systemdOk;
}
async function unitActive(id) {
  if (!(await hasSystemd())) return false;
  return (await sh('systemctl', ['--user', 'is-active', unitName(id)], 4000)).trim() === 'active';
}

// ---------------------------------------------------------------- helpers
const shq = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${String(a).replace(/'/g, `'\\''`)}'`);
/** Turn a running process's argv back into a command line that starts the same server. */
function argvToCmd(argv) {
  if (!argv?.length) return null;
  if (IS_WIN) return argv.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
  return argv.map(shq).join(' ');
}
/** Short human label: "vite --host --port 5210" instead of "/home/…/node /home/…/node_modules/vite/bin/vite.js …". */
export function prettyCmd(cmd) {
  if (!cmd) return '';
  return String(cmd)
    .replace(/^\S*\/node(\.exe)?\s+/, '')
    .replace(/\S*node_modules\/(?:\.bin\/)?([\w@.-]+)(?:\/[\w./-]*)?/g, '$1')
    .replace(new RegExp(HOME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '~');
}

/** A Baton server (this one, or another copy on a different port) — never register or stop it from here. */
const isBaton = (p) => p.baton || (p.dir === ROOT && /server[\\/]index\.js/.test(p.cmd || ''));

/** Is this listening process a dev server we should remember? */
function looksLikeDevServer(p) {
  if (!p.mine || isBaton(p) || !p.dir || !p.project || !p.port) return false;
  if (!p.page || p.page.kind === 'tcp') return false; // only things that speak HTTP
  if (/[\\/]\.claude[\\/]worktrees[\\/]|[\\/]\.codex[\\/]|^\/tmp\b|^\/var\/tmp\b/.test(p.dir)) return false; // agents' throwaway worktrees
  if (p.dir === HOME || p.project === HOME) return false;
  // Something else (a systemd service, code-server, …) already looks after it.
  if (p.unit && /\.service$/.test(p.unit) && !/^baton(-srv-[\w-]+)?\.service$/.test(p.unit)) return false;
  if (/code-server|codex|gnome-|adb\b|language.?server|tsserver|esbuild --service|playwright|chrome|electron/i.test(p.cmd || '')) return false;
  // The AI CLIs themselves open short-lived local ports (auth callbacks, model lists…).
  if (/^(claude|codex|agy|antigravity|gemini|opencode|cursor-agent)$/.test(String(p.name || '').split(' ')[0])) return false;
  if (!p.startedAt || Date.now() - p.startedAt < 30_000) return false; // only servers that stay up
  return true;
}

// ---------------------------------------------------------------- auto-register
let observing = null;
/** Remember dev servers that are running now (called by the ports page and every few minutes). */
export async function observe(ports) {
  const list = all();
  const ignored = ignoredSet();
  let changed = false;
  for (const p of ports) {
    if (!looksLikeDevServer(p)) continue;
    const cmd = argvToCmd(p.argv) || p.cmd;
    if (!cmd) continue;
    let s = list.find((x) => x.port === p.port && x.cwd === p.dir);
    if (!s) {
      if (ignored.has(sig(p.dir, p.port))) continue;
      // Same folder, same program, old port no longer listening -> it moved ports: update instead of adding.
      s = list.find((x) => x.cwd === p.dir && x.auto && prettyCmd(x.cmd).split(' ')[0] === prettyCmd(cmd).split(' ')[0] && !ports.some((q) => q.port === x.port));
      if (s) { s.port = p.port; s.cmd = cmd; }
      else {
        s = { id: crypto.randomBytes(4).toString('hex'), cwd: p.dir, port: p.port, cmd, enabled: true, auto: true, added: Date.now() };
        list.push(s);
      }
      changed = true;
    }
    // Somebody started a server that was turned off again on purpose (not just one that's still shutting down).
    if (!s.enabled && Date.now() - (s.stoppedAt || 0) > 90_000) { s.enabled = true; changed = true; }
    if (p.page?.title && s.title !== p.page.title) { s.title = p.page.title; changed = true; }
    if (Date.now() - (s.seen || 0) > 60_000) { s.seen = Date.now(); changed = true; }
  }
  if (changed) save(list);
}
async function observeNow() {
  if (observing) return observing;
  observing = listPortsCached(0).then((d) => observe(d.ports)).catch(() => {}).finally(() => { observing = null; });
  return observing;
}

// ---------------------------------------------------------------- list
export async function listServers({ project } = {}) {
  const { ports } = await listPortsCached();
  await observe(ports);
  const list = all();
  const out = [];
  for (const s of list) {
    if (s.cwd === ROOT && /server[\\/]index\.js/.test(s.cmd)) continue; // registered by an older build
    const root = projectRoot(s.cwd) || s.cwd;
    if (project && root !== project) continue;
    const live = ports.find((p) => p.port === s.port);
    const ours = live && (!live.dir || live.dir === s.cwd || (live.project && live.project === root));
    out.push({
      id: s.id, port: s.port, cmd: s.cmd, label: prettyCmd(s.cmd), cwd: shortHome(s.cwd), project: root,
      title: (ours && live.page?.title) || s.title || null,
      enabled: Boolean(s.enabled), auto: Boolean(s.auto), added: s.added, seen: s.seen || null,
      running: Boolean(ours),
      busyBy: live && !ours ? (live.name || live.cmd || '?') : null, // the port is taken by something else
      pid: ours ? live.pid : null,
      startedAt: ours ? live.startedAt : null,
      phoneUrl: ours ? live.phoneUrl : null,
      local: ours ? live.local : null,
      web: ours ? live.page?.kind !== 'tcp' : true,
      agent: ours ? live.agent : null,
      starting: Boolean(s.startingAt && Date.now() - s.startingAt < 30_000 && !ours),
      lastError: s.lastError || null,
    });
  }
  const dupes = new Map();
  for (const s of out) dupes.set(s.port, (dupes.get(s.port) || 0) + 1);
  for (const s of out) s.portShared = dupes.get(s.port) > 1;
  out.sort((a, b) => Number(b.running) - Number(a.running) || Number(b.enabled) - Number(a.enabled) || a.port - b.port);
  return out;
}

// ---------------------------------------------------------------- start / stop
function patch(id, fn) {
  const list = all();
  const s = list.find((x) => x.id === id);
  if (!s) throw new Error(tr('등록된 서버를 찾을 수 없어요'));
  fn(s, list);
  save(list);
  return s;
}

async function launch(s) {
  if (!fs.existsSync(s.cwd)) throw new Error(tr('폴더가 없어요: {dir}', { dir: shortHome(s.cwd) }));
  const env = childEnv();
  if (await hasSystemd()) {
    if (await unitActive(s.id)) return;
    await sh('systemctl', ['--user', 'reset-failed', unitName(s.id)], 4000);
    const keep = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'USER', 'SHELL', 'NVM_DIR', 'NODE_EXTRA_CA_CERTS', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY'];
    const args = ['--user', `--unit=${unitName(s.id)}`, '--collect', '--quiet', `--working-directory=${s.cwd}`,
      `--description=Baton dev server :${s.port} (${path.basename(s.cwd)})`, '-p', 'KillMode=control-group'];
    for (const k of keep) if (env[k]) args.push(`--setenv=${k}=${env[k]}`);
    args.push('--setenv=BROWSER=none', '/bin/sh', '-c', s.cmd);
    const res = await new Promise((resolve) => {
      const c = spawn('systemd-run', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      c.stderr.on('data', (d) => (err += d));
      c.on('error', (e) => resolve(e.message));
      c.on('close', (code) => resolve(code === 0 ? null : err.trim() || `exit ${code}`));
    });
    if (res) throw new Error(res);
    return;
  }
  // No systemd: a detached process in its own group, output to data/server-logs/<id>.log
  await fsp.mkdir(LOG_DIR, { recursive: true });
  const fd = fs.openSync(path.join(LOG_DIR, `${s.id}.log`), 'a');
  const child = IS_WIN
    ? spawn(process.env.comspec || 'cmd.exe', ['/d', '/s', '/c', s.cmd], { cwd: s.cwd, env: { ...env, BROWSER: 'none' }, detached: true, windowsHide: true, stdio: ['ignore', fd, fd] })
    : spawn('/bin/sh', ['-c', s.cmd], { cwd: s.cwd, env: { ...env, BROWSER: 'none' }, detached: true, stdio: ['ignore', fd, fd] });
  child.on('error', () => {});
  child.unref();
  fs.closeSync(fd);
  if (child.pid) detached.set(s.id, child.pid);
}

export async function startServer(id) {
  const s = patch(id, (x) => { x.enabled = true; });
  const { ports } = await listPortsCached(0);
  const live = ports.find((p) => p.port === s.port);
  if (live) {
    if (live.dir === s.cwd || live.project === (projectRoot(s.cwd) || s.cwd)) return { ok: true, already: true };
    throw new Error(tr(':{port} 포트를 다른 프로그램({name})이 쓰고 있어요', { port: s.port, name: live.name || '?' }));
  }
  try {
    await launch(s);
    patch(id, (x) => { x.startingAt = Date.now(); x.lastError = null; });
  } catch (e) {
    patch(id, (x) => { x.lastError = e.message; });
    throw e;
  }
  invalidatePorts();
  return { ok: true };
}

async function kill(s) {
  let stopped = false;
  if (await unitActive(s.id)) { await sh('systemctl', ['--user', 'stop', unitName(s.id)], 15000); stopped = true; }
  const pid = detached.get(s.id);
  if (pid) { try { process.kill(IS_WIN ? pid : -pid, 'SIGTERM'); stopped = true; } catch { /* gone */ } detached.delete(s.id); }
  // Started by an agent or a terminal: stop the process that listens on the port.
  const { ports } = await listPortsCached(0);
  const live = ports.find((p) => p.port === s.port && (p.dir === s.cwd || p.project === (projectRoot(s.cwd) || s.cwd)));
  if (live?.pid && !isBaton(live)) { try { await stopPort(live.pid); stopped = true; } catch { /* not ours */ } }
  invalidatePorts();
  return stopped;
}

/** Turn off: stop it, keep it in the list. */
export async function stopServer(id) {
  const s = patch(id, (x) => { x.enabled = false; x.startingAt = null; x.stoppedAt = Date.now(); });
  await kill(s);
  return { ok: true };
}

/** Remove from the list (stops it too) and don't auto-register it again. */
export async function removeServer(id) {
  const s = all().find((x) => x.id === id);
  if (!s) return { ok: true };
  await kill(s);
  save(all().filter((x) => x.id !== id));
  const ig = getKV(IGNORED, []) || [];
  if (!ig.includes(sig(s.cwd, s.port))) setKV(IGNORED, [...ig, sig(s.cwd, s.port)].slice(-500));
  return { ok: true };
}

/** Register a server by hand (folder + command + port). */
export function addServer({ cwd, cmd, port, enabled = true }) {
  port = Number(port);
  cwd = String(cwd || '').replace(/^~(?=$|[\\/])/, HOME);
  if (!cwd || !fs.existsSync(cwd)) throw new Error(tr('폴더가 없어요: {dir}', { dir: cwd }));
  if (!cmd || !String(cmd).trim()) throw new Error(tr('실행 명령을 적어주세요'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(tr('포트 번호가 올바르지 않아요'));
  const list = all();
  let s = list.find((x) => x.cwd === cwd && x.port === port);
  if (s) Object.assign(s, { cmd: String(cmd).trim(), enabled: Boolean(enabled) });
  else { s = { id: crypto.randomBytes(4).toString('hex'), cwd, port, cmd: String(cmd).trim(), enabled: Boolean(enabled), auto: false, added: Date.now() }; list.push(s); }
  save(list);
  setKV(IGNORED, (getKV(IGNORED, []) || []).filter((x) => x !== sig(cwd, port)));
  return s;
}

export async function serverLogs(id) {
  const s = all().find((x) => x.id === id);
  if (!s) return null;
  let text = '';
  if (await hasSystemd()) text = await sh('journalctl', ['--user', '-u', unitName(id), '-n', '120', '--no-pager', '-o', 'cat'], 6000);
  if (!text.trim()) { try { text = (await fsp.readFile(path.join(LOG_DIR, `${id}.log`), 'utf8')).slice(-12000); } catch { /* none */ } }
  return { text: text.replace(/\x1b\[[0-9;]*m/g, '') };
}

// ---------------------------------------------------------------- keep enabled servers up
/** After Baton starts (reboot, update, restart): start every enabled server that isn't running. */
export async function resumeServers() {
  await observeNow();
  const { ports } = await listPortsCached(0);
  for (const s of all()) {
    if (!s.enabled || ports.some((p) => p.port === s.port)) continue;
    try { await startServer(s.id); console.log(`[servers] started :${s.port} ${shortHome(s.cwd)}`); }
    catch (e) { console.log(`[servers] could not start :${s.port} ${shortHome(s.cwd)}: ${e.message}`); }
  }
}

export function startServerWatch() {
  // Give the indexer and the OS a moment after boot, then bring enabled servers back.
  setTimeout(() => resumeServers().catch(() => {}), 12_000).unref();
  // Pick up servers agents / terminals start, so they survive the next Baton restart.
  setInterval(() => observeNow(), 120_000).unref();
}
