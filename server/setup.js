// Onboarding: check what's installed/signed-in, and run one-click install / sign-in / integration jobs
// whose output streams to the browser (sign-in links and device codes are picked out for the UI).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { ROOT } from './util.js';
import { TOOLS, TOOL_IDS, binFor, installPlan } from './tools.js';
import { IS_WIN, IS_MAC, IS_WSL, OS_NAME, which, clearWhichCache, runCli, spawnCli, augmentedPath, sh } from './platform.js';
import { childEnv } from './runner.js';
import { tr, lang } from './i18n.js';
import { claudeProvider, codexProvider } from './providers.js';
import { envInfo } from './env.js';
import { updateCommand } from './update.js';

const HOME = os.homedir();
const PORT = Number(process.env.BATON_PORT || 7420);
const NODE_MIN = [22, 13];

// ---------------------------------------------------------------- status
let statusCache = { at: 0, v: null };

async function version(bin, args = ['--version']) {
  const r = await runCli(bin, args, { timeout: 15000 });
  const m = (r.stdout + ' ' + r.stderr).match(/\d+\.\d+(\.\d+)?([-.\w]*)?/);
  return m ? m[0] : null;
}

async function tailscaleStatus() {
  const bin = which('tailscale');
  if (!bin) return { installed: false };
  const out = await sh(bin, ['status', '--json'], 6000);
  let host = null, online = false, phones = [];
  try {
    const j = JSON.parse(out);
    host = j.Self?.DNSName?.replace(/\.$/, '') || null;
    online = j.BackendState === 'Running';
    // phones/tablets on the same tailnet: proves step "install Tailscale on your phone" is done
    phones = Object.values(j.Peer || {}).filter((p) => /^(ios|android)$/i.test(p.OS || '')).map((p) => ({ name: p.HostName, os: p.OS, online: Boolean(p.Online) }));
  } catch { /* logged out */ }
  const serve = await sh(bin, ['serve', 'status', '--json'], 6000);
  let url = null;
  try {
    const j = JSON.parse(serve || '{}');
    for (const [hp, cfg] of Object.entries(j.Web || {})) {
      for (const h of Object.values(cfg.Handlers || {})) if (String(h.Proxy || '').endsWith(`:${PORT}`)) url = `https://${hp.replace(/:443$/, '')}`;
    }
  } catch { /* none */ }
  return { installed: true, online, host, url, phones };
}

function autostartPath() {
  if (IS_WIN) return path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Baton.vbs');
  if (IS_MAC) return path.join(HOME, 'Library', 'LaunchAgents', 'dev.baton.dashboard.plist');
  return path.join(HOME, '.config', 'systemd', 'user', 'baton.service');
}
async function hasSystemd() {
  if (IS_WIN || IS_MAC) return false;
  const out = await sh('systemctl', ['--user', 'is-system-running'], 4000);
  return Boolean(out.trim()) && !/offline/.test(out);
}

export async function setupStatus({ fresh = false } = {}) {
  if (!fresh && statusCache.v && Date.now() - statusCache.at < 20_000) return statusCache.v;
  clearWhichCache();
  const nodeVer = process.versions.node.split('.').map(Number);
  const tools = await Promise.all(TOOL_IDS.map(async (id) => {
    const t = TOOLS[id];
    const bin = binFor(id);
    const plan = installPlan(id);
    let [ver, logged] = bin ? await Promise.all([version(bin), t.loggedIn(bin).catch(() => false)]) : [null, false];
    // company setups: Bedrock / Vertex / gateway / API key (Claude) or a custom provider / API key (Codex)
    let provider = null;
    if (bin && id === 'claude') { const p = await claudeProvider().catch(() => null); if (p && !p.subscription) { provider = p.label; logged = true; } }
    if (bin && id === 'codex') { const p = codexProvider(); if (!p.subscription) { provider = p.label; logged = p.configured; } }
    return {
      id, name: t.name, vendor: t.vendor, docs: t.docs, installed: Boolean(bin), path: bin, version: ver, loggedIn: Boolean(logged), provider,
      optionalLogin: Boolean(t.optionalLogin), installCmd: plan?.cmd || null, canInstall: Boolean(plan),
      loginKind: t.login?.kind || null, loginCmd: bin ? [path.basename(bin).replace(/\.(cmd|exe)$/i, ''), ...t.login.args].join(' ') : null,
      note: t.note?.[lang()] || t.note?.en,
    };
  }));
  const git = which('git');
  const v = {
    os: OS_NAME, arch: process.arch, home: HOME, port: PORT,
    node: { version: process.versions.node, ok: nodeVer[0] > NODE_MIN[0] || (nodeVer[0] === NODE_MIN[0] && nodeVer[1] >= NODE_MIN[1]) },
    git: { installed: Boolean(git), version: git ? await version(git) : null, canInstall: IS_WIN || IS_MAC, hint: !git && !IS_WIN && !IS_MAC ? 'sudo apt install -y git' : null },
    tools,
    tailscale: await tailscaleStatus(),
    autostart: { supported: IS_WIN || IS_MAC || (await hasSystemd()), enabled: fs.existsSync(autostartPath()), kind: IS_WIN ? 'startup' : IS_MAC ? 'launchd' : 'systemd' },
    wslHint: IS_WIN, // on Windows, suggest WSL for the best experience (agy, sandboxing)
  };
  v.ready = tools.some((t) => t.installed && (t.loggedIn || t.optionalLogin));
  statusCache = { at: Date.now(), v };
  return v;
}

// ---------------------------------------------------------------- jobs
const jobs = new Map();
const URL_RE = /https?:\/\/[^\s"'<>]+/g;
const CODE_RE = /\b([A-Z0-9]{4}-[A-Z0-9]{4,5})\b/;

function newJob(label) {
  const job = { id: crypto.randomUUID(), label, status: 'running', lines: [], urls: [], code: null, child: null, listeners: new Set(), startedAt: Date.now(), exit: null };
  job.emit = (ev) => { ev.i = job.lines.length; job.lines.push(ev); for (const l of job.listeners) { try { l(ev); } catch { /* ignore */ } } };
  jobs.set(job.id, job);
  setTimeout(() => jobs.delete(job.id), 60 * 60_000).unref();
  return job;
}

function attach(job, child, { afterSuccess } = {}) {
  job.child = child;
  const onData = (stream) => (chunk) => {
    const text = String(chunk).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r(?!\n)/g, '\n');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      job.emit({ t: 'line', stream, text: line });
      for (const u of line.match(URL_RE) || []) {
        const clean = u.replace(/[).,]+$/, '');
        if (!job.urls.includes(clean)) { job.urls.push(clean); job.emit({ t: 'url', url: clean }); }
      }
      const c = line.match(CODE_RE);
      if (c && /code|코드/i.test(line + (job.lines.at(-2)?.text || ''))) { job.code = c[1]; job.emit({ t: 'code', code: c[1] }); }
    }
  };
  child.stdout?.on('data', onData('out'));
  child.stderr?.on('data', onData('err'));
  child.on('error', (e) => { job.emit({ t: 'line', stream: 'err', text: e.message }); finish(job, -1); });
  child.on('close', async (code) => {
    if (code === 0 && afterSuccess) {
      try { await afterSuccess(job); } catch (e) { job.emit({ t: 'line', stream: 'err', text: e.message }); }
    }
    finish(job, code);
  });
}

// ---------------------------------------------------------------- PATH after install
// Install jobs run with augmentedPath() (so we can find CLIs under systemd), which means installers
// like OpenCode's see their bin dir already on PATH and skip editing ~/.bashrc. Baton then finds the
// CLI, but the user's own terminal says "command not found". After an install, ask a fresh login
// shell whether it can find the command; if not, link it into ~/.local/bin or add a PATH line.
const BASE_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
function userShell() { return process.env.SHELL || (IS_MAC ? '/bin/zsh' : '/bin/bash'); }

/** What a newly opened terminal sees: { path: [...dirs], finds: bool } (null if the shell can't be probed). */
function probeShell(name) {
  return new Promise((resolve) => {
    const env = { HOME, USER: os.userInfo().username, SHELL: userShell(), TERM: 'dumb', PATH: BASE_PATH, BATON_SHELL_PROBE: '1' };
    const script = `printf "__BATON__%s\\n" "$PATH"; command -v ${name} >/dev/null 2>&1 && printf "__FOUND__"`;
    execFile(userShell(), ['-ilc', script], { env, timeout: 10000 }, (err, stdout) => {
      const out = String(stdout || '');
      const at = out.indexOf('__BATON__');
      if (at < 0) return resolve(null);
      const line = out.slice(at + 9).split('\n')[0];
      resolve({ path: line.split(':').filter(Boolean), finds: out.includes('__FOUND__') });
    });
  });
}

function rcFileFor(shell) {
  const s = path.basename(shell);
  if (s === 'zsh') return path.join(HOME, '.zshrc');
  if (s === 'bash') return path.join(HOME, IS_MAC ? '.bash_profile' : '.bashrc');
  return null;
}

async function ensureOnShellPath(tool, job) {
  if (IS_WIN) return;
  clearWhichCache();
  const bin = binFor(tool);
  if (!bin) return;
  const name = path.basename(bin);
  const probe = await probeShell(name);
  if (!probe || probe.finds) return;
  const say = (text) => job.emit({ t: 'line', stream: 'out', text });

  // 1) ~/.local/bin is already on the user's PATH on most Linux setups: a symlink is the least invasive fix
  const localBin = path.join(HOME, '.local', 'bin');
  const link = path.join(localBin, name);
  if (probe.path.includes(localBin) && !fs.existsSync(link)) {
    let dangling = false;
    try { dangling = fs.lstatSync(link).isSymbolicLink(); } catch { /* nothing there */ }
    if (!dangling) {
      await fsp.mkdir(localBin, { recursive: true });
      await fsp.symlink(bin, link);
      say(tr('터미널에서도 {n} 명령을 찾을 수 있게 {p}에 연결했어요.', { n: name, p: link }));
      return;
    }
  }
  // 2) otherwise add the bin dir to the shell's rc file
  const rc = rcFileFor(userShell());
  const dir = path.dirname(bin);
  if (rc) {
    const line = `export PATH="${dir}:$PATH"`;
    const cur = await fsp.readFile(rc, 'utf8').catch(() => '');
    if (cur.includes(line)) return; // added on an earlier install; a new terminal will pick it up
    await fsp.appendFile(rc, `${cur && !cur.endsWith('\n') ? '\n' : ''}\n# Added by Baton so your terminal can find ${name}\n${line}\n`);
    say(tr('터미널에서도 {n} 명령을 찾을 수 있게 {p}에 PATH를 추가했어요. 이미 열려 있는 터미널은 새로 열어주세요.', { n: name, p: rc }));
    return;
  }
  say(tr('터미널에서 {n} 명령을 찾으려면 PATH에 {p}를 추가해주세요.', { n: name, p: dir }));
}
function finish(job, code) {
  if (job.status !== 'running') return;
  job.status = code === 0 ? 'done' : 'error';
  job.exit = code;
  clearWhichCache();
  statusCache.at = 0;
  job.emit({ t: 'end', ok: code === 0, code });
}

function shellSpawn(cmd) {
  const env = { ...childEnv(), PATH: augmentedPath() };
  if (IS_WIN) return spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  return spawn('bash', ['-lc', cmd], { env, stdio: ['pipe', 'pipe', 'pipe'] });
}

async function writeAutostart() {
  const file = autostartPath();
  const node = process.execPath;
  const entry = path.join(ROOT, 'server', 'index.js');
  await fsp.mkdir(path.dirname(file), { recursive: true });
  if (IS_WIN) {
    await fsp.writeFile(file, `Set sh = CreateObject("WScript.Shell")\r\nsh.CurrentDirectory = "${ROOT}"\r\nsh.Run """${node}"" --no-warnings ""${entry}""", 0, False\r\n`);
    return tr('다음에 Windows에 로그인하면 Baton이 자동으로 켜져요.');
  }
  if (IS_MAC) {
    await fsp.writeFile(file, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.baton.dashboard</string>
  <key>ProgramArguments</key><array><string>${node}</string><string>--no-warnings</string><string>${entry}</string></array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${augmentedPath()}</string><key>BATON_PORT</key><string>${PORT}</string></dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
</dict></plist>
`);
    return tr('다음에 Mac에 로그인하면 Baton이 자동으로 켜져요.');
  }
  await fsp.writeFile(file, `[Unit]
Description=Baton - vibe coding dashboard
After=network-online.target

[Service]
WorkingDirectory=${ROOT}
ExecStart=${node} --no-warnings ${entry}
Environment=BATON_PORT=${PORT}
Environment=PATH=${augmentedPath()}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`);
  await sh('systemctl', ['--user', 'daemon-reload']);
  await sh('systemctl', ['--user', 'enable', 'baton.service']);
  return IS_WSL ? tr('WSL이 켜질 때 Baton이 자동으로 시작돼요.') : tr('다음에 로그인하면 Baton이 자동으로 켜져요.');
}
async function removeAutostart() {
  if (!IS_WIN && !IS_MAC) await sh('systemctl', ['--user', 'disable', 'baton.service']);
  await fsp.rm(autostartPath(), { force: true });
}

/** action: install | login | git | tailscale-share | tailscale-unshare | autostart-on | autostart-off | update */
export async function startJob(action, tool) {
  const t = tool ? TOOLS[tool] : null;
  if (tool && !t) throw new Error('unknown tool');
  // a second tap (or another device) joins the job already running instead of starting it twice
  const key = `${action}:${tool || ''}`;
  for (const j of jobs.values()) if (j.key === key && j.status === 'running') return j;
  const job = await createJob(action, tool, t);
  job.key = key; job.action = action; job.tool = tool || null;
  return job;
}

async function createJob(action, tool, t) {
  if (action === 'install') {
    const plan = installPlan(tool);
    if (!plan) throw new Error(tr('이 OS에서는 자동 설치를 지원하지 않아요. 문서를 참고해주세요.'));
    const job = newJob(`${t.name} ${tr('설치')}`);
    job.emit({ t: 'line', stream: 'cmd', text: `$ ${plan.cmd}` });
    const afterSuccess = (j) => ensureOnShellPath(tool, j);
    if (plan.kind === 'npm') attach(job, spawnCli('npm', ['install', '-g', TOOLS[tool].install.npm], { env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] }), { afterSuccess });
    else attach(job, shellSpawn(plan.cmd), { afterSuccess });
    return job;
  }
  if (action === 'login') {
    const bin = binFor(tool);
    if (!bin) throw new Error(tr('먼저 설치해주세요'));
    const job = newJob(`${t.name} ${tr('로그인')}`);
    job.emit({ t: 'line', stream: 'cmd', text: `$ ${path.basename(bin)} ${t.login.args.join(' ')}` });
    attach(job, spawnCli(bin, t.login.args, { env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'], cwd: HOME }));
    return job;
  }
  if (action === 'git') {
    const cmd = IS_WIN ? 'winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements' : IS_MAC ? 'xcode-select --install' : null;
    if (!cmd) throw new Error(tr('터미널에서 직접 설치해주세요: sudo apt install -y git'));
    const job = newJob('Git');
    job.emit({ t: 'line', stream: 'cmd', text: `$ ${cmd}` });
    attach(job, shellSpawn(cmd));
    return job;
  }
  if (action === 'tailscale-share' || action === 'tailscale-unshare') {
    const bin = which('tailscale');
    if (!bin) throw new Error(tr('Tailscale이 설치되어 있지 않아요'));
    const args = action === 'tailscale-share' ? ['serve', '--bg', '--https=8443', `http://127.0.0.1:${PORT}`] : ['serve', '--https=8443', 'off'];
    const job = newJob('Tailscale');
    job.emit({ t: 'line', stream: 'cmd', text: `$ tailscale ${args.join(' ')}` });
    attach(job, spawnCli(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }));
    return job;
  }
  if (action === 'update') {
    const cmd = await updateCommand();
    const job = newJob(tr('Baton 업데이트'));
    job.emit({ t: 'line', stream: 'cmd', text: `$ ${cmd}` });
    attach(job, shellSpawn(cmd));
    return job;
  }
  if (action === 'autostart-on' || action === 'autostart-off') {
    const job = newJob(tr('자동 시작'));
    try {
      const msg = action === 'autostart-on' ? await writeAutostart() : (await removeAutostart(), tr('자동 시작을 껐어요.'));
      job.emit({ t: 'line', stream: 'out', text: msg });
      finish(job, 0);
    } catch (e) { job.emit({ t: 'line', stream: 'err', text: e.message }); finish(job, 1); }
    return job;
  }
  throw new Error('unknown action');
}

export function getJob(id) { return jobs.get(id) || null; }
export function jobInput(id, text) {
  const job = jobs.get(id);
  if (!job?.child?.stdin || job.status !== 'running') return false;
  job.child.stdin.write(String(text).replace(/\r?\n$/, '') + '\n');
  job.emit({ t: 'line', stream: 'in', text: '••••' });
  return true;
}
export function stopJob(id) {
  const job = jobs.get(id);
  if (!job?.child || job.status !== 'running') return false;
  if (IS_WIN && job.child.pid) spawn('taskkill', ['/pid', String(job.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else job.child.kill('SIGTERM');
  return true;
}
export function publicJob(j) {
  return { id: j.id, label: j.label, status: j.status, urls: j.urls, code: j.code, exit: j.exit, action: j.action, tool: j.tool, startedAt: j.startedAt };
}
/** Jobs still running, so a reopened setup page can show their progress again. */
export function runningJobs() { return [...jobs.values()].filter((j) => j.status === 'running').map(publicJob); }
