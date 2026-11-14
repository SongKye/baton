// Model-free check that Codex's sandbox still gives Baton's permission levels their meaning
// (server/permissions.js). `codex sandbox` runs a command under exactly the policy `codex exec` would use
// for the same -c overrides, so this catches a changed sandbox (e.g. .git or the network blocked again in
// "auto") on every version check without spending tokens.
// Used by compat:check and compat:smoke. Not on Windows: Codex's Windows sandbox is a different mechanism.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runCli } from '../server/platform.js';
import { codexPermArgs } from '../server/permissions.js';

const fail = (message) => Object.assign(new Error(message), { category: 'contract' });

/** -> a one-line summary; throws (category 'contract' or 'environment') when a level lost its meaning. */
export async function probeCodexSandbox(bin) {
  if (process.platform === 'win32') return 'skipped on Windows';
  const home = os.homedir();
  // the project must live outside the temp folder: that one is writable in every sandbox mode
  const repo = await fsp.mkdtemp(path.join(home, 'baton-perm-'));
  const outside = path.join(home, `baton-perm-outside-${crypto.randomBytes(6).toString('hex')}`);
  const cacheFile = path.join(home, '.cache', `baton-perm-${crypto.randomBytes(6).toString('hex')}`);
  try {
    await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
    const git = spawnSync('git', ['init', '-q'], { cwd: repo });
    if (git.status !== 0) throw Object.assign(new Error('git is not available for the permission check'), { category: 'environment' });
    const q = (s) => `'${s.replaceAll("'", "'\\''")}'`;
    const script = [
      `git -c user.name=baton -c user.email=baton@localhost commit -q --allow-empty -m probe >/dev/null 2>&1; echo git=$?`,
      `touch ${q(path.join(repo, 'file'))} 2>/dev/null; echo project=$?`,
      `touch ${q(cacheFile)} 2>/dev/null; echo cache=$?`,
      `touch ${q(outside)} 2>/dev/null; echo outside=$?`,
      `node -e "fetch('https://registry.npmjs.org/-/ping').then(r=>process.exit(r.ok?0:2),()=>process.exit(1))"; echo net=$?`,
    ].join('\n');
    const run = async (perm) => {
      const r = await runCli(bin, ['sandbox', ...codexPermArgs(perm, repo), '--', 'sh', '-c', script], { cwd: repo, timeout: 60000 });
      const out = Object.fromEntries([...`${r.stdout}`.matchAll(/^(\w+)=(\d+)$/gm)].map((m) => [m[1], Number(m[2])]));
      if (!('net' in out)) throw fail(`codex sandbox did not run the probe (exit ${r.code}): ${(r.stderr || r.stdout).trim().slice(-400)}`);
      for (const f of [outside, cacheFile, path.join(repo, 'file')]) fs.rmSync(f, { force: true });
      return out;
    };
    const auto = await run('auto');
    const want = { git: 0, project: 0, cache: 0, net: 0 };
    const wrong = Object.entries(want).filter(([k, v]) => auto[k] !== v).map(([k]) => k);
    if (wrong.length) throw fail(`"auto" no longer allows ${wrong.join(', ')} under Codex's sandbox (${JSON.stringify(auto)}): check the sandbox_workspace_write options in server/permissions.js`);
    if (auto.outside === 0) throw fail('"auto" can now write outside the project and caches: Codex\'s sandbox got wider, review server/permissions.js');
    const plan = await run('plan');
    if (plan.project === 0 || plan.git === 0) throw fail(`"plan" (read-only) could change the project: ${JSON.stringify(plan)}`);
    return 'auto: project, git, caches and network allowed, home blocked; plan: read-only';
  } finally {
    await fsp.rm(repo, { recursive: true, force: true }).catch(() => {});
    for (const f of [outside, cacheFile]) await fsp.rm(f, { force: true }).catch(() => {});
  }
}
