// Which version of each coding-agent CLI Baton was last verified against, and how the installed one compares.
//
// Baton talks to these CLIs through surfaces their vendors can change in any release: command-line flags,
// streamed JSON events, session files on disk, config files and a few private usage endpoints
// (see docs/compatibility.md). So "supported" means "verified with this exact version"; anything newer
// probably works but hasn't been checked yet.
//
// The verified versions live in compat.json (data only), so the weekly auto-verification
// (scripts/compat-weekly.mjs) can bump them and older Baton installs can read the latest table from GitHub.
//   level: 'supported' (verified against a live install) | 'beta' (built from docs, never run live)
//          | 'unverified' (code exists, not supported)
// This file adds what each CLI's --help must still mention (npm run compat:check).
import fs from 'node:fs';
import path from 'node:path';
import { cmpVersion, ROOT, DATA_DIR } from './util.js';

const readTable = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'compat.json'), 'utf8')); } catch { return {}; } };
export const TABLE = readTable();

const CHECKS = {
  claude: {
    // `--help` output must mention these, or a feature Baton relies on is gone
    checks: [
      { args: ['--help'], expect: ['--output-format', '--input-format', '--include-partial-messages', '--permission-prompt-tool', '--resume', '--model', '--effort', '--permission-mode', '--dangerously-skip-permissions', '--no-session-persistence', '--fork-session', '--tools'] },
      { args: ['mcp', '--help'], expect: ['add-json', 'get', 'list', 'remove'] },
      { args: ['auth', '--help'], expect: ['login', 'status'] },
    ],
  },
  codex: {
    checks: [
      { args: ['exec', '--help'], expect: ['resume', '--json', '--skip-git-repo-check', '--ephemeral', '--image', '--dangerously-bypass-approvals-and-sandbox', '--model', '--config'] },
      { args: ['exec', 'resume', '--help'], expect: ['SESSION_ID', '--image', '--json'] },
      { args: ['mcp', '--help'], expect: ['get', 'list'] },
      { args: ['mcp', 'get', '--help'], expect: ['--json'] },
      { args: ['debug', '--help'], expect: ['models'] },
      { args: ['login', '--help'], expect: ['--device-auth', '--with-api-key', 'status'] },
    ],
  },
  agy: {
    checks: [
      { args: ['--help'], expect: ['--output-format', 'stream-json', '--conversation', '--model', '--effort', '--mode', 'accept-edits', 'plan', '--dangerously-skip-permissions', 'models'] },
      { args: ['mcp', '--help'], expect: ['add', 'remove', 'list'] },
    ],
  },
  opencode: {
    checks: [
      { args: ['run', '--help'], expect: ['--format', '--session', '--model', '--variant', '--agent', '--file'] },
      { args: ['models', '--help'], expect: ['--verbose'] },
    ],
  },
  cursor: {
    checks: [
      { args: ['--help'], expect: ['--print', '--output-format', '--resume', '--model', '--force', 'models', 'status', 'login'] },
    ],
  },
};

export const COMPAT = Object.fromEntries(Object.entries(CHECKS).map(([id, c]) => [id, { level: 'unverified', verified: null, verifiedAt: null, ...TABLE[id], ...c }]));

/**
 * How an installed version compares with the verified one:
 *   'verified'  same version Baton was verified with
 *   'newer'     newer than verified — most likely fine, not checked yet
 *   'older'     older than verified — update the CLI if something misbehaves
 *   'untested'  Baton has no verified version for this CLI (beta / unverified)
 *   'unknown'   the installed version couldn't be read
 */
export function compatState(id, installed, verified = COMPAT[id]?.verified) {
  if (!verified) return 'untested';
  if (!installed) return 'unknown';
  const d = cmpVersion(installed, verified);
  return d === 0 ? 'verified' : d > 0 ? 'newer' : 'older';
}

// ---------------------------------------------------------------- latest table from GitHub
// The weekly auto-check keeps compat.json on main current. Reading it here lets an older Baton know about
// CLI versions verified after it was released. An entry may say { needsBatonAfter: "0.10.0" }: that CLI
// version only works with code newer than that Baton release (a compatibility fix), so this install needs
// a Baton update first.
const REMOTE_URL = process.env.BATON_COMPAT_URL || 'https://raw.githubusercontent.com/SongKye/baton/main/server/compat.json';
const REMOTE_CACHE = path.join(DATA_DIR, 'compat-remote.json');
const REMOTE_EVERY = 6 * 3600_000;
export const BATON_VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '0.0.0'; } })();
let remote = (() => { try { return JSON.parse(fs.readFileSync(REMOTE_CACHE, 'utf8')); } catch { return null; } })();

const validTable = (t) => t && typeof t === 'object' && !Array.isArray(t)
  && Object.values(t).every((e) => e && typeof e === 'object' && (e.verified === null || /^\d+\.\d+\.\d+/.test(String(e.verified))));

/** Fetch the latest table at most every 6 hours; keeps the last good copy when offline. */
export async function refreshRemote({ force = false } = {}) {
  if (!force && remote?.at && Date.now() - remote.at < REMOTE_EVERY) return remote;
  try {
    const r = await fetch(REMOTE_URL, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'baton' } });
    const table = r.ok ? await r.json() : null;
    if (validTable(table)) {
      remote = { at: Date.now(), table };
      fs.writeFileSync(REMOTE_CACHE, JSON.stringify(remote));
    } else if (remote) remote.at = Date.now() - REMOTE_EVERY + 30 * 60_000; // bad answer: retry in 30 min
  } catch { if (remote) remote.at = Date.now() - REMOTE_EVERY + 30 * 60_000; }
  return remote;
}

const OS_KEY = process.env.BATON_COMPAT_OS || (process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'); // WSL = linux; env: tests
const OSES = ['linux', 'windows', 'macos'];

/** This Baton has the code a table entry needs. */
const batonOk = (e) => !e?.needsBatonAfter || cmpVersion(BATON_VERSION, e.needsBatonAfter) > 0;

/**
 * What the UI shows for one CLI: the version this Baton supports (its own table, or a newer one from GitHub
 * when this Baton has the code for it), how the installed version compares, and what the user can do:
 *   action 'cli-update'   installed CLI is older than supported -> install `target`
 *          'baton-update' a newer Baton release supports the installed CLI version -> update Baton
 *          'baton-next'   only Baton code that isn't released yet supports it -> wait for the next release
 */
export function compatInfo(id, installed, { latestBaton = null } = {}) {
  const c = COMPAT[id] || {};
  const r = remote?.table?.[id];
  let verified = c.verified || null, verifiedAt = c.verifiedAt || null, level = c.level || 'unverified', source = 'local';
  if (r?.verified && batonOk(r) && (!verified || cmpVersion(r.verified, verified) > 0)) ({ verified, verifiedAt, level } = { verified: r.verified, verifiedAt: r.verifiedAt || null, level: r.level || level }), source = 'github';
  const state = compatState(id, installed, verified);
  let action = null, target = null, needsBatonAfter = null;
  if (state === 'older' && CLI_UPDATABLE.has(id)) { action = 'cli-update'; target = verified; }
  else if (state === 'newer' && r?.verified && !batonOk(r) && cmpVersion(r.verified, installed) >= 0) {
    needsBatonAfter = r.needsBatonAfter;
    action = latestBaton && cmpVersion(latestBaton, r.needsBatonAfter) > 0 ? 'baton-update' : 'baton-next';
  }
  // where each version was actually run: the newer of this Baton's table and GitHub's (when this Baton can use it)
  const platforms = {};
  for (const os of OSES) {
    const a = c.os?.[os]?.verified || null, b = r && batonOk(r) ? r.os?.[os]?.verified || null : null;
    platforms[os] = a && b ? (cmpVersion(a, b) >= 0 ? a : b) : a || b;
  }
  return { level, verified, verifiedAt, source, builtFor: c.builtFor || null, state, action, target, needsBatonAfter, platforms, here: OS_KEY, hereVerified: platforms[OS_KEY] };
}

// ---------------------------------------------------------------- updating a CLI to the supported version
const CLI_UPDATABLE = new Set(['claude', 'codex', 'agy', 'opencode']);
const NPM_PKG = { claude: '@anthropic-ai/claude-code', codex: '@openai/codex', opencode: 'opencode-ai' };

/** The command that moves this CLI to `version`, the same way it was installed. -> { bin, args, exact } */
export function cliUpdatePlan(id, bin, version) {
  let real = bin;
  try { real = fs.realpathSync(bin); } catch { /* keep */ }
  if (NPM_PKG[id] && /[\\/]node_modules[\\/]/.test(real)) return { bin: 'npm', args: ['install', '-g', `${NPM_PKG[id]}@${version}`], exact: true };
  if (id === 'claude') return { bin, args: ['install', version], exact: true }; // native installer
  if (id === 'opencode') return { bin, args: ['upgrade', version], exact: true };
  if (id === 'codex') return { bin, args: ['update'], exact: false }; // e.g. Homebrew: latest only
  if (id === 'agy') return { bin, args: ['update'], exact: false }; // Antigravity updates to its latest release only
  return null;
}
