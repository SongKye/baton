// Which version of each coding-agent CLI Baton was last verified against, and how the installed one compares.
//
// Baton talks to these CLIs through surfaces their vendors can change in any release: command-line flags,
// streamed JSON events, session files on disk, config files and a few private usage endpoints
// (see docs/compatibility.md). So "supported" means "verified with this exact version"; anything newer
// probably works but hasn't been checked yet.
//
// When you re-verify a CLI: run `npm run compat:check`, try a chat, a resumed session and the setup page
// with that version, then update `verified` / `verifiedAt` here and the table in docs/compatibility.md.
import { cmpVersion } from './util.js';

// level: 'supported' (verified against a live install) | 'beta' (built from docs, never run live)
//        | 'unverified' (code exists, not supported)
export const COMPAT = {
  claude: {
    level: 'supported', verified: '2.1.318', verifiedAt: '2026-11-12',
    // `--help` output must mention these, or a feature Baton relies on is gone
    checks: [
      { args: ['--help'], expect: ['--output-format', '--input-format', '--include-partial-messages', '--permission-prompt-tool', '--resume', '--model', '--effort', '--permission-mode', '--dangerously-skip-permissions', '--no-session-persistence', '--fork-session', '--tools'] },
      { args: ['mcp', '--help'], expect: ['add-json', 'get', 'list', 'remove'] },
      { args: ['auth', '--help'], expect: ['login', 'status'] },
    ],
  },
  codex: {
    level: 'supported', verified: '0.156.0', verifiedAt: '2026-11-12',
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
    level: 'supported', verified: '1.5.6', verifiedAt: '2026-11-12',
    checks: [
      { args: ['--help'], expect: ['--output-format', 'stream-json', '--conversation', '--model', '--effort', '--mode', 'accept-edits', 'plan', '--dangerously-skip-permissions', 'models'] },
      { args: ['mcp', '--help'], expect: ['add', 'remove', 'list'] },
    ],
  },
  opencode: {
    level: 'beta', verified: null, verifiedAt: null, builtFor: '1.x',
    checks: [
      { args: ['run', '--help'], expect: ['--format', '--session', '--model', '--variant', '--agent', '--file'] },
      { args: ['models', '--help'], expect: ['--verbose'] },
    ],
  },
  cursor: {
    level: 'unverified', verified: null, verifiedAt: null,
    checks: [
      { args: ['--help'], expect: ['--print', '--output-format', '--resume', '--model', '--force', 'models', 'status', 'login'] },
    ],
  },
};

/**
 * How an installed version compares with the verified one:
 *   'verified'  same version Baton was verified with
 *   'newer'     newer than verified — most likely fine, not checked yet
 *   'older'     older than verified — update the CLI if something misbehaves
 *   'untested'  Baton has no verified version for this CLI (beta / unverified)
 *   'unknown'   the installed version couldn't be read
 */
export function compatState(id, installed) {
  const c = COMPAT[id];
  if (!c?.verified) return 'untested';
  if (!installed) return 'unknown';
  const d = cmpVersion(installed, c.verified);
  return d === 0 ? 'verified' : d > 0 ? 'newer' : 'older';
}

/** What the UI shows for one CLI. */
export function compatInfo(id, installed) {
  const c = COMPAT[id] || {};
  return { level: c.level || 'unverified', verified: c.verified || null, verifiedAt: c.verifiedAt || null, builtFor: c.builtFor || null, state: compatState(id, installed) };
}
