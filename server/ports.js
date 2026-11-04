// What is being served on this PC right now: listening TCP ports -> process, folder/project, page title,
// which agent session started it, and whether it is reachable from the phone (tailnet).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { shortHome, clip } from './util.js';
import { projectRoot } from './projects.js';
import { getSnapshot } from './indexer.js';
import { liveSessions } from './live.js';
import { IS_WIN, IS_MAC, sh } from './platform.js';
import { tr } from './i18n.js';

const pexec = promisify(execFile);
const MY_UID = os.userInfo().uid;
const BATON_PORT = Number(process.env.BATON_PORT || 7420);
const PS = ['-NoProfile', '-NonInteractive', '-Command'];

// ---------------------------------------------------------------- per-OS: listening sockets
async function listeners() {
  const rows = [];
  if (IS_WIN) {
    const out = await sh('powershell.exe', [...PS, 'Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress'], 12000);
    let j = [];
    try { j = [].concat(JSON.parse(out || '[]')); } catch { /* none */ }
    for (const r of j) rows.push({ port: Number(r.LocalPort), addr: String(r.LocalAddress), pid: Number(r.OwningProcess) || null });
    return rows;
  }
  if (IS_MAC) {
    const out = await sh('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn'], 8000);
    let pid = null;
    for (const line of out.split('\n')) {
      if (line[0] === 'p') pid = Number(line.slice(1));
      else if (line[0] === 'n') {
        const a = line.slice(1);
        rows.push({ port: Number(a.slice(a.lastIndexOf(':') + 1)), addr: a.slice(0, a.lastIndexOf(':')).replace(/^\*$/, '0.0.0.0').replace(/^\[|\]$/g, ''), pid });
      }
    }
    return rows;
  }
  let out = await sh('ss', ['-ltnpH'], 5000);
  if (out) {
    for (const line of out.split('\n')) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 4) continue;
      const local = cols[3];
      rows.push({
        port: Number(local.slice(local.lastIndexOf(':') + 1)),
        addr: local.slice(0, local.lastIndexOf(':')).replace(/%.*$/, '').replace(/^\[|\]$/g, ''),
        pid: Number((line.match(/pid=(\d+)/) || [])[1]) || null,
      });
    }
    return rows;
  }
  out = await sh('netstat', ['-tlnp'], 5000); // fallback (older distros)
  for (const line of out.split('\n')) {
    const m = line.match(/^tcp6?\s+\d+\s+\d+\s+(\S+):(\d+)\s+\S+\s+LISTEN\s+(\d+)?/);
    if (m) rows.push({ port: Number(m[2]), addr: m[1], pid: Number(m[3]) || null });
  }
  return rows;
}

// ---------------------------------------------------------------- per-OS: process details
async function winProcs(pids) {
  if (!pids.length) return new Map();
  const filter = pids.map((p) => `ProcessId=${Number(p)}`).join(' or ');
  const out = await sh('powershell.exe', [...PS, `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId,ParentProcessId,CommandLine,CreationDate | ConvertTo-Json -Compress`], 15000);
  const map = new Map();
  let j = [];
  try { j = [].concat(JSON.parse(out || '[]')); } catch { /* none */ }
  for (const r of j) {
    const created = String(r.CreationDate || '').match(/\d{10,}/);
    const cmd = r.CommandLine || null;
    // best-effort cwd: the folder of a script path in the command line
    const scriptPath = cmd && (cmd.match(/"?([A-Za-z]:\\[^"]+?\\)[^"\\]+\.(?:m?js|ts|py)"?/) || [])[1];
    map.set(Number(r.ProcessId), { pid: Number(r.ProcessId), ppid: Number(r.ParentProcessId), cmd, cwd: scriptPath ? scriptPath.replace(/\\$/, '') : null, startedAt: created ? Number(created[0]) : null, mine: Boolean(cmd) });
  }
  return map;
}

async function procInfo(pid) {
  if (IS_MAC) {
    const out = (await sh('ps', ['-o', 'ppid=,uid=,etime=,command=', '-p', String(pid)])).trim();
    const m = out.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    const cwdOut = await sh('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
    const cwd = (cwdOut.split('\n').find((l) => l[0] === 'n') || '').slice(1) || null;
    return m ? { pid, ppid: Number(m[1]), uid: Number(m[2]), startedAt: Date.now() - etimeMs(m[3]), cmd: m[4], cwd } : { pid };
  }
  const r = { pid };
  try { r.cmd = (await fsp.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean).join(' '); } catch { /* gone */ }
  try { r.cwd = await fsp.readlink(`/proc/${pid}/cwd`); } catch { /* not ours */ }
  try {
    const st = await fsp.readFile(`/proc/${pid}/stat`, 'utf8');
    const f = st.slice(st.lastIndexOf(')') + 2).split(' ');
    r.ppid = Number(f[1]);
    const ticks = Number(f[19]);
    const uptime = Number((await fsp.readFile('/proc/uptime', 'utf8')).split(' ')[0]);
    r.startedAt = Date.now() - (uptime - ticks / 100) * 1000;
  } catch { /* ignore */ }
  try { r.uid = fs.statSync(`/proc/${pid}`).uid; } catch { /* ignore */ }
  return r;
}

function etimeMs(t) { // [[dd-]hh:]mm:ss
  const m = String(t).match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  return m ? ((+(m[1] || 0) * 24 + +(m[2] || 0)) * 3600 + +m[3] * 60 + +m[4]) * 1000 : 0;
}

const titleCache = new Map();
async function pageTitle(port) {
  const c = titleCache.get(port);
  if (c && Date.now() - c.at < 30_000) return c.v;
  let v = null;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1200), redirect: 'follow' });
    const ct = r.headers.get('content-type') || '';
    if (/html/.test(ct)) {
      const html = (await r.text()).slice(0, 65536);
      const t = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
      v = { kind: 'web', title: t ? t[1].trim() : null, status: r.status };
    } else v = { kind: /json/.test(ct) ? 'api' : 'http', title: null, status: r.status };
  } catch { v = { kind: 'tcp', title: null }; }
  titleCache.set(port, { at: Date.now(), v });
  return v;
}

let tsCache = { at: 0, v: null };
async function tailscaleInfo() {
  if (Date.now() - tsCache.at < 30_000) return tsCache.v;
  const v = { host: null, ips: [], serve: {} };
  try {
    const { stdout } = await pexec('tailscale', ['status', '--json'], { timeout: 4000 });
    const j = JSON.parse(stdout);
    v.host = j.Self?.DNSName?.replace(/\.$/, '') || null;
    v.ips = j.Self?.TailscaleIPs || [];
  } catch { /* no tailscale */ }
  try {
    const { stdout } = await pexec('tailscale', ['serve', 'status', '--json'], { timeout: 4000 });
    const j = JSON.parse(stdout || '{}');
    for (const [hp, cfg] of Object.entries(j.Web || {})) {
      const ext = Number(hp.split(':').pop());
      for (const [, h] of Object.entries(cfg.Handlers || {})) {
        const m = String(h.Proxy || '').match(/:(\d+)\/?$/);
        if (m) (v.serve[Number(m[1])] ||= []).push({ port: ext, url: `https://${hp.replace(/:443$/, '')}`, funnel: Boolean(j.AllowFunnel?.[hp]) });
      }
    }
  } catch { /* ignore */ }
  tsCache = { at: Date.now(), v };
  return v;
}

/** Walk up the parent chain until we hit a process that is a known agent session. */
function agentFor(pid, procs, liveByPid) {
  let p = pid;
  for (let i = 0; i < 12 && p > 1; i++) {
    if (liveByPid.has(p)) return liveByPid.get(p);
    p = procs.get(p)?.ppid;
  }
  return null;
}

export async function listPorts() {
  const rows = (await listeners()).filter((r) => r.port > 0);
  // merge v4/v6 duplicates of the same port+pid
  const byKey = new Map();
  for (const r of rows) {
    const k = `${r.port}:${r.pid}`;
    const cur = byKey.get(k);
    if (cur) cur.addrs.push(r.addr); else byKey.set(k, { port: r.port, pid: r.pid, addrs: [r.addr] });
  }
  const ts = await tailscaleInfo();
  const procs = new Map();
  const want = new Set([...byKey.values()].map((r) => r.pid).filter(Boolean));
  if (IS_WIN) {
    let batch = [...want];
    for (let depth = 0; depth < 6 && batch.length; depth++) { // walk parents a few levels for agent attribution
      const got = await winProcs(batch.filter((p) => !procs.has(p)));
      for (const [k, v] of got) procs.set(k, v);
      batch = [...got.values()].map((v) => v.ppid).filter((p) => p > 4 && !procs.has(p));
    }
  } else {
    for (const pid of want) {
      let p = pid;
      for (let i = 0; i < 12 && p > 1 && !procs.has(p); i++) { const info = await procInfo(p); procs.set(p, info); p = info.ppid; }
    }
  }
  const snap = await getSnapshot(10_000);
  const live = await liveSessions(snap.byFile);
  const liveByPid = new Map();
  for (const [key, v] of live) {
    const s = snap.byKey.get(key);
    if (s) liveByPid.set(v.pid, { key, tool: s.tool, id: s.id, title: s.title });
  }
  const out = [];
  for (const r of byKey.values()) {
    if (r.addrs.every((a) => ts.ips.includes(a))) continue; // tailscale's own serve listeners
    const p = r.pid ? procs.get(r.pid) : null;
    // Windows: anything running from C:\Windows (svchost, lsass, spoolsv…) is the system, not "my server"
    const mine = IS_WIN ? Boolean(p?.mine) && !/^"?[A-Za-z]:\\Windows\\/i.test(p?.cmd || '') : p?.uid === MY_UID;
    const local = r.addrs.every((a) => a === '127.0.0.1' || a === '::1' || a === 'localhost');
    const page = mine || !r.pid ? pageTitle(r.port) : null; // resolved below, all ports in parallel
    const root = p?.cwd ? projectRoot(p.cwd) : null;
    const served = ts.serve[r.port] || [];
    out.push({
      port: r.port, pid: r.pid, addrs: r.addrs, mine, system: !mine,
      local, // only reachable from this PC
      phoneUrl: served[0]?.url || (!local && ts.host ? `http://${ts.host}:${r.port}` : null),
      tailnetServe: served,
      cmd: p?.cmd ? clip(p.cmd.replace(/\s+/g, ' '), 300) : null,
      name: p?.cmd ? progName(p.cmd) : null,
      cwd: p?.cwd ? shortHome(p.cwd) : null,
      project: root,
      startedAt: p?.startedAt || null,
      agent: r.pid ? agentFor(r.pid, procs, liveByPid) : null,
      baton: r.port === BATON_PORT,
      page,
    });
  }
  await Promise.all(out.map(async (o) => { o.page = await o.page; }));
  out.sort((a, b) => Number(b.mine) - Number(a.mine) || a.port - b.port);
  return { ports: out, host: ts.host };
}

function progName(cmd) {
  const parts = cmd.replace(/"/g, '').split(' ');
  const bin = parts[0].split(/[\\/]/).pop().replace(/\.exe$/i, '');
  const find = (re) => parts.find((x) => re.test(x));
  if (/node|bun|deno/.test(bin)) {
    const s = find(/vite|next|nuxt|astro|webpack|serve|http-server|nodemon|tsx|ts-node|remix|svelte/);
    return s ? s.split('/').filter((x) => x && x !== 'bin' && x !== 'node_modules' && x !== '.bin').pop() : `node ${(parts[1] || '').split('/').pop()}`;
  }
  if (/python/.test(bin)) {
    if (parts.includes('-m')) return `python -m ${parts[parts.indexOf('-m') + 1]}`;
    const s = find(/uvicorn|gunicorn|flask|manage\.py|streamlit|jupyter|\.py$/);
    return s ? `python ${s.split('/').pop()}` : 'python';
  }
  return bin;
}

const tsPortsBusy = new Set([443, 8443]);
/** Expose a localhost-only port to the tailnet (https://host:<port>), tailnet only — never Funnel. */
export async function shareToPhone(port) {
  port = Number(port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || tsPortsBusy.has(port)) throw new Error(tr('이 포트는 열 수 없어요'));
  await pexec('tailscale', ['serve', '--bg', `--https=${port}`, `http://127.0.0.1:${port}`], { timeout: 15000 });
  tsCache.at = 0;
  const ts = await tailscaleInfo();
  return { url: ts.host ? `https://${ts.host}:${port}` : null };
}
export async function unshare(port) {
  port = Number(port);
  if (tsPortsBusy.has(port)) throw new Error(tr('Baton·기존 서비스 포트는 닫을 수 없어요'));
  await pexec('tailscale', ['serve', `--https=${port}`, 'off'], { timeout: 15000 });
  tsCache.at = 0;
}

export async function stopPort(pid) {
  pid = Number(pid);
  if (pid === process.pid) throw new Error(tr('Baton 자신은 멈출 수 없어요'));
  if (IS_WIN) {
    const info = (await winProcs([pid])).get(pid);
    if (!info?.mine) throw new Error(tr('내 프로세스만 멈출 수 있어요'));
    await sh('taskkill', ['/pid', String(pid), '/T', '/F']);
    return { ok: true };
  }
  const info = await procInfo(pid);
  if (info.uid !== MY_UID) throw new Error(tr('내 프로세스만 멈출 수 있어요'));
  process.kill(pid, 'SIGTERM');
  return { ok: true };
}
