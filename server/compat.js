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
      // permission levels (server/permissions.js): the --permission-mode choices Baton passes
      { args: ['--help'], expect: ['"plan"', '"auto"'] },
      { args: ['mcp', '--help'], expect: ['add-json', 'get', 'list', 'remove'] },
      { args: ['auth', '--help'], expect: ['login', 'status'] },
    ],
  },
  codex: {
    checks: [
      { args: ['exec', '--help'], expect: ['resume', '--json', '--skip-git-repo-check', '--ephemeral', '--image', '--dangerously-bypass-approvals-and-sandbox', '--model', '--config'] },
      // permission levels: sandbox_mode values; `codex sandbox` runs the model-free sandbox probe (scripts/lib-perm-probe.mjs)
      { args: ['exec', '--help'], expect: ['--sandbox', 'read-only', 'workspace-write'] },
      { args: ['sandbox', '--help'], expect: ['--config'] },
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
      // permission levels: "auto" passes allow rules for the session through --settings
      { args: ['--help'], expect: ['--settings'] },
      { args: ['mcp', '--help'], expect: ['add', 'remove', 'list'] },
    ],
  },
  opencode: {
    checks: [
      { args: ['run', '--help'], expect: ['--format', '--session', '--model', '--variant', '--agent', '--file'] },
      // permission levels: "full" approves everything with --auto
      { args: ['run', '--help'], expect: ['--auto'] },
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

// ---------------------------------------------------------------- what the newest Baton release supports
// "Supported" on this install always means THIS release's own compat.json: versions tested with this release's
// code. The newest release's table (read from GitHub at that release's tag, never main) is advice only: when
// the installed CLI is newer than this release supports but the newest release supports it, the user is told to
// update Baton. Verifications on main that no release ships yet are never shown: users can't get that code.
const REMOTE_BASE = 'https://raw.githubusercontent.com/SongKye/baton';
const REMOTE_CACHE = path.join(DATA_DIR, 'compat-remote.json');
const REMOTE_EVERY = 6 * 3600_000;
export const BATON_VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '0.0.0'; } })();
let remote = (() => { try { return JSON.parse(fs.readFileSync(REMOTE_CACHE, 'utf8')); } catch { return null; } })();

const validTable = (t) => t && typeof t === 'object' && !Array.isArray(t)
  && Object.values(t).every((e) => e && typeof e === 'object' && (e.verified === null || /^\d+\.\d+\.\d+/.test(String(e.verified))));

/** Fetch the newest release's table (only if that release is newer than this one), at most every 6 hours. */
export async function refreshRemote({ latestBaton = null, force = false } = {}) {
  if (!latestBaton || cmpVersion(latestBaton, BATON_VERSION) <= 0) return null; // this is the newest release
  if (!force && remote?.tag === latestBaton && Date.now() - remote.at < REMOTE_EVERY) return remote;
  const url = process.env.BATON_COMPAT_URL || `${REMOTE_BASE}/v${latestBaton}/server/compat.json`; // env: tests
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'baton' } });
    const table = r.ok ? await r.json() : null;
    if (validTable(table)) {
      remote = { at: Date.now(), tag: latestBaton, table };
      fs.writeFileSync(REMOTE_CACHE, JSON.stringify(remote));
    } else if (remote) remote.at = Date.now() - REMOTE_EVERY + 30 * 60_000; // bad answer: retry in 30 min
  } catch { if (remote) remote.at = Date.now() - REMOTE_EVERY + 30 * 60_000; }
  return remote;
}

const OS_KEY = process.env.BATON_COMPAT_OS || (process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'); // WSL = linux; env: tests
const OSES = ['linux', 'windows', 'macos'];

/**
 * What the UI shows for one CLI, all from this release's own table:
 *   hereVerified  the version verified on this OS (null: not checked on this OS yet)
 *   state         installed vs hereVerified (or, if this OS was never checked, vs the newest version verified elsewhere)
 *   action        'cli-update'   installed is older -> install `target` (the verified version)
 *                 'baton-update' installed is newer, and the newest Baton release (`target`) supports it
 */
export function compatInfo(id, installed, { latestBaton = null } = {}) {
  const c = COMPAT[id] || {};
  const platforms = Object.fromEntries(OSES.map((os) => [os, c.os?.[os]?.verified || null]));
  const hereVerified = platforms[OS_KEY];
  const ref = hereVerified || c.verified || null;
  const state = compatState(id, installed, ref);
  let action = null, target = null;
  if (state === 'older' && CLI_UPDATABLE.has(id)) { action = 'cli-update'; target = ref; }
  else if (state === 'newer' && latestBaton && remote?.tag === latestBaton && cmpVersion(latestBaton, BATON_VERSION) > 0) {
    const r = remote.table?.[id];
    const rv = r?.os?.[OS_KEY]?.verified || r?.verified;
    if (rv && cmpVersion(rv, installed) >= 0) { action = 'baton-update'; target = latestBaton; }
  }
  return { level: c.level || 'unverified', verified: c.verified || null, verifiedAt: c.verifiedAt || null, builtFor: c.builtFor || null,
    state, action, target, platforms, here: OS_KEY, hereVerified };
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
