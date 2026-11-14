// What Baton's three permission levels mean, and how each CLI is told.
//
//   plan  Read only. Nothing in the project changes.
//   auto  Everyday development inside the project folder without prompts: edit files, run the project's
//         tools, commit with git, install packages, use the network. Work outside the project and
//         destructive or unrecognised actions still need "full".
//   full  Everything, no sandbox.
//
// Each CLI has its own permission model, so "auto" needs different settings per CLI to mean the same thing.
// Measured on Linux (2026-11, claude 2.1.318, codex 0.169.0, agy 1.5.8, opencode 1.19.5) with the same six
// tasks (write a file, git commit, curl, write ~/.cache, write /tmp, npm view):
//   claude  --permission-mode auto: a classifier approves safe actions. All six pass.
//   codex   sandbox_mode=workspace-write alone blocks the network and keeps .git read-only, so commits,
//           pushes and installs fail. Network access plus the repository's git folder and package caches as
//           writable roots make all six pass while everything else outside the project stays read-only.
//   agy     --mode accept-edits only edits files: any shell command is denied, and in print mode the first
//           denial ends the turn with no reply. `--mode auto` exists but isn't offered on every account.
//           The documented `permissions.allow` rules (`command(<program>)`) let the common development
//           programs run; each part of `a && b | c` must be allowed, and redirection into a file (`> f`)
//           is still denied (the agent writes files with its edit tool instead).
//   opencode the `build` agent already runs commands and blocks only folders outside the project. `--auto`
//           approves everything not explicitly denied, which is what "full" means.
// npm run compat:smoke checks these meanings against the live CLIs ("everyday work" step), and the --help
// checks in server/compat.js fail when a flag used here disappears.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PERMS = ['plan', 'auto', 'full'];

/**
 * Programs Antigravity may run in "auto". Read, build, test, package and git tools; no rm, sudo, shells
 * or interpreters of arbitrary downloaded scripts beyond the project's own runtimes. Deleting a file goes
 * through Antigravity's own file tools (accept-edits).
 */
export const AGY_AUTO_COMMANDS = [
  // version control and hosting
  'git', 'gh',
  // JavaScript / TypeScript
  'node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'bunx', 'deno', 'tsc', 'tsx', 'eslint', 'prettier', 'vitest', 'jest',
  // Python
  'python', 'python3', 'pip', 'pip3', 'uv', 'uvx', 'pytest', 'poetry', 'ruff',
  // other toolchains
  'cargo', 'rustc', 'go', 'make', 'cmake', 'java', 'javac', 'gradle', 'mvn', 'dotnet', 'ruby', 'bundle', 'php', 'composer',
  // reading and searching
  'ls', 'cat', 'head', 'tail', 'grep', 'rg', 'find', 'fd', 'wc', 'sort', 'uniq', 'diff', 'cut', 'tr', 'jq', 'file', 'stat', 'du',
  'tree', 'which', 'pwd', 'echo', 'printf', 'date', 'basename', 'dirname', 'realpath', 'env', 'test', 'true', 'false', 'xargs', 'sed', 'awk', 'tee', 'sleep',
  // files in the project
  'mkdir', 'touch', 'cp', 'mv', 'chmod', 'tar', 'unzip', 'zip',
  // network
  'curl', 'wget',
];

/** The git folder(s) of the repository containing `cwd`: `.git` itself, or for a worktree its own and the shared one. */
export function gitDirsFor(cwd) {
  let dir = path.resolve(cwd);
  for (;;) {
    const dotgit = path.join(dir, '.git');
    let st = null;
    try { st = fs.statSync(dotgit); } catch { /* keep walking up */ }
    if (st?.isDirectory()) return [dotgit];
    if (st?.isFile()) {
      // worktree / submodule: ".git" is a file "gitdir: <path>"; commits also write the shared git folder
      try {
        const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotgit, 'utf8'));
        if (!m) return [];
        const own = path.resolve(dir, m[1].trim());
        const dirs = [own];
        try { dirs.push(path.resolve(own, fs.readFileSync(path.join(own, 'commondir'), 'utf8').trim())); } catch { /* not a worktree */ }
        return [...new Set(dirs)];
      } catch { return []; }
    }
    const up = path.dirname(dir);
    if (up === dir) return [];
    dir = up;
  }
}

/** Package-manager caches Codex may write in "auto" (installs and `npm view` fail on a read-only cache). */
export function packageCacheDirs(home = os.homedir(), env = process.env) {
  const dirs = [
    path.join(home, '.cache'), path.join(home, '.npm'), path.join(home, '.bun', 'install', 'cache'),
    path.join(home, '.local', 'share', 'pnpm'), path.join(home, '.cargo', 'registry'), path.join(home, '.cargo', 'git'),
    path.join(home, 'go', 'pkg', 'mod'), path.join(home, 'Library', 'Caches'),
  ];
  if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, 'npm-cache'), path.join(env.LOCALAPPDATA, 'pip', 'Cache'));
  if (env.npm_config_cache) dirs.push(path.resolve(env.npm_config_cache));
  return [...new Set(dirs)];
}

const tomlString = (s) => JSON.stringify(String(s)); // a JSON string is a valid TOML basic string

/** Codex `-c` overrides for a permission level. */
export function codexPermArgs(perm, cwd) {
  if (perm === 'full') return ['--dangerously-bypass-approvals-and-sandbox'];
  if (perm === 'plan') return ['-c', 'sandbox_mode="read-only"'];
  const roots = [...gitDirsFor(cwd), ...packageCacheDirs()];
  return [
    '-c', 'sandbox_mode="workspace-write"',
    '-c', 'sandbox_workspace_write.network_access=true',
    '-c', `sandbox_workspace_write.writable_roots=[${roots.map(tomlString).join(',')}]`,
  ];
}

/** The user's own Antigravity permission rules, so Baton's session settings add to them instead of replacing them. */
function agyUserPermissions(home = os.homedir()) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(home, '.gemini', 'antigravity-cli', 'settings.json'), 'utf8'))?.permissions;
    return p && typeof p === 'object' ? p : {};
  } catch { return {}; }
}

/** Antigravity arguments for a permission level. */
export function agyPermArgs(perm) {
  if (perm === 'plan') return ['--mode', 'plan'];
  if (perm === 'full') return ['--dangerously-skip-permissions'];
  // `auto` mode isn't offered on every account (it falls back to a sandbox without git or network), so:
  // accept-edits for files + allow rules for the common development programs
  const user = agyUserPermissions();
  const list = (x) => (Array.isArray(x) ? x.filter((r) => typeof r === 'string') : []);
  const permissions = {
    allow: [...new Set([...list(user.allow), ...AGY_AUTO_COMMANDS.map((c) => `command(${c})`)])],
    deny: list(user.deny),
    ask: list(user.ask),
  };
  return ['--mode', 'accept-edits', '--settings', JSON.stringify({ permissions })];
}

/** OpenCode arguments for a permission level. */
export function opencodePermArgs(perm) {
  if (perm === 'plan') return ['--agent', 'plan'];
  if (perm === 'full') return ['--agent', 'build', '--auto'];
  return ['--agent', 'build'];
}

/** Claude Code arguments for a permission level. */
export function claudePermArgs(perm) {
  if (perm === 'plan') return ['--permission-mode', 'plan'];
  if (perm === 'full') return ['--dangerously-skip-permissions'];
  return ['--permission-mode', 'auto'];
}

// Codex reports a sandbox refusal as an ordinary failed command, never as a denial. These outputs mean the
// sandbox (not the command itself) stopped it, so the chat can offer "retry with full permissions".
const CODEX_SANDBOX_BLOCK = /read-only file system|operation not permitted|could not resolve host|temporary failure in name resolution|getaddrinfo (?:eai_again|enotfound)|network is unreachable|sandbox(?:ed)? (?:denied|blocked)/i;

/** For a failed Codex command: the label to report as blocked, or null if the sandbox wasn't the cause. */
export function codexSandboxBlock(item) {
  if (!item || item.type !== 'command_execution' || !item.exit_code) return null;
  if (!CODEX_SANDBOX_BLOCK.test(String(item.aggregated_output || ''))) return null;
  // "/bin/bash -lc 'git commit -m x'" -> "git commit"
  let cmd = String(item.command || '').trim();
  const m = /^(?:\S*[\\/])?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/.exec(cmd) || /^(?:\S*[\\/])?(?:pwsh|powershell)(?:\.exe)?\s+(?:-\S+\s+)*-Command\s+(['"]?)([\s\S]*)\1$/i.exec(cmd);
  if (m) cmd = m[2];
  const words = cmd.split(/\s+/).filter((w) => w && !/^-/.test(w)).slice(0, 2);
  return words.length ? `shell: ${words.join(' ')}` : 'shell';
}
