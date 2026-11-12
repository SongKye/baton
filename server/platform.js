// Cross-platform helpers: OS detection (incl. WSL), finding executables, and spawning CLIs
// the same way on Linux, macOS and Windows (npm installs `.cmd` shims there that Node can't exec directly).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';

export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';
export const IS_LINUX = process.platform === 'linux';
export const IS_WSL = IS_LINUX && (() => {
  try { return /microsoft|wsl/i.test(fs.readFileSync('/proc/version', 'utf8')); } catch { return false; }
})();
export const OS_NAME = IS_WIN ? 'windows' : IS_MAC ? 'macos' : IS_WSL ? 'wsl' : 'linux';

const HOME = os.homedir();

/** Directories CLIs commonly install into that may be missing from PATH (e.g. under systemd/launchd). */
export function extraPathDirs() {
  const dirs = IS_WIN
    ? [path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'npm'), path.join(HOME, '.local', 'bin'),
      path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), 'Programs', 'cursor-agent'),
      path.join(HOME, '.opencode', 'bin'), path.join(HOME, '.bun', 'bin')]
    : [path.join(HOME, '.local', 'bin'), path.join(HOME, '.npm-global', 'bin'), path.join(HOME, '.opencode', 'bin'),
      path.join(HOME, '.bun', 'bin'), path.join(HOME, '.cursor', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  // node's own bin dir (npm -g installs next to it on most setups)
  dirs.push(path.dirname(process.execPath));
  return dirs;
}

export function augmentedPath(base = process.env.PATH || '') {
  const parts = base.split(path.delimiter).filter(Boolean);
  for (const d of extraPathDirs()) if (!parts.includes(d)) parts.push(d);
  return parts.join(path.delimiter);
}

const whichCache = new Map();
/** Absolute path of an executable, or null. Honors PATHEXT on Windows. */
// A miss is only trusted for 15s: a CLI installed from the user's own terminal shows up without a restart.
export function which(bin, { fresh = false } = {}) {
  const hit = whichCache.get(bin);
  if (!fresh && hit && (hit.found || Date.now() - hit.at < 15_000)) return hit.found;
  const exts = IS_WIN ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').map((e) => e.toLowerCase()) : [''];
  let found = null;
  for (const dir of augmentedPath().split(path.delimiter)) {
    for (const ext of IS_WIN ? ['', ...exts] : exts) {
      const p = path.join(dir, bin + ext);
      try {
        const st = fs.statSync(p);
        if (st.isFile() && (IS_WIN ? ext !== '' : (st.mode & 0o111) !== 0)) { found = p; break; }
      } catch { /* not here */ }
    }
    if (found) break;
  }
  whichCache.set(bin, { found, at: Date.now() });
  return found;
}
export function clearWhichCache() { whichCache.clear(); }

// --- Windows cmd.exe quoting (same rules as the widely used `cross-spawn` package)
const META = /([()\][%!^"`<>&|;, *?])/g;
function escapeArg(arg) {
  arg = `${arg}`.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"').replace(/(?=(\\+?)?)\1$/, '$1$1');
  return `"${arg}"`.replace(META, '^$1');
}
function escapeCmd(cmd) { return cmd.replace(META, '^$1'); }

/**
 * spawn() that works for npm shims on Windows. `bin` is a bare command name or a path.
 * Newlines can't travel through cmd.exe arguments, so callers should pass long prompts via stdin.
 */
export function spawnCli(bin, args, opts = {}) {
  const env = { ...(opts.env || process.env), PATH: augmentedPath((opts.env || process.env).PATH) };
  // spawn's `cwd` doesn't update $PWD, so a child would inherit Baton's own folder (e.g. ~/baton when started
  // by the `baton` command) and CLIs that trust $PWD record their session there instead of in the project.
  if (opts.cwd) { env.PWD = path.resolve(String(opts.cwd)); delete env.OLDPWD; }
  const resolved = which(bin) || bin;
  if (IS_WIN && /\.(cmd|bat)$/i.test(resolved)) {
    const line = [escapeCmd(path.normalize(resolved)), ...args.map((a) => escapeArg(String(a).replace(/\r?\n/g, ' ')))].join(' ');
    return spawn(process.env.comspec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...opts, env, windowsVerbatimArguments: true, windowsHide: true });
  }
  return spawn(resolved, args, { ...opts, env, windowsHide: true });
}

/** Promise wrapper: { code, stdout, stderr } (never rejects). */
export function runCli(bin, args, { timeout = 30000, input = null, cwd, env } = {}) {
  return new Promise((resolve) => {
    let stdout = '', stderr = '', done = false;
    let child;
    try { child = spawnCli(bin, args, { cwd, env, stdio: [input != null ? 'pipe' : 'ignore', 'pipe', 'pipe'] }); }
    catch (e) { resolve({ code: -1, stdout: '', stderr: e.message }); return; }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, timeout);
    child.stdout.on('data', (c) => { stdout += c; if (stdout.length > 4e6) stdout = stdout.slice(-4e6); });
    child.stderr.on('data', (c) => { stderr += c; if (stderr.length > 1e6) stderr = stderr.slice(-1e6); });
    child.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ code: -1, stdout, stderr: stderr + e.message }); } });
    child.on('close', (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ code, stdout, stderr }); } });
    if (input != null) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  });
}

/** Plain execFile with a timeout that resolves to stdout ('' on error). */
export function sh(cmd, args, timeout = 6000) {
  return new Promise((resolve) => execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 16 << 20 }, (err, stdout) => resolve(err && !stdout ? '' : String(stdout || ''))));
}

/** Open a URL in the user's default browser (used after starting the server locally). */
export function openBrowser(url) {
  try {
    if (IS_WIN) spawn('cmd.exe', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else if (IS_MAC) spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else if (IS_WSL) spawn('cmd.exe', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* headless */ }
}

/** True if `child` is `parent` or inside it, on any OS (case-insensitive on Windows/macOS). */
export function isInside(child, parent) {
  if (!child || !parent) return false;
  const rel = path.relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}
