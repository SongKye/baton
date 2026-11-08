// Read-only deployment preflight. Never creates commits/tags or publishes.
import { lookup } from 'node:dns/promises';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
let failures = 0;
function report(ok, message) {
  console.log(`${ok ? 'OK' : 'BLOCKED'} ${message}`);
  if (!ok) failures++;
}
function run(command, args) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 20_000 });
}
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));
report(pkg.version === lock.version && pkg.version === lock.packages[''].version,
  `package and lockfile version: ${pkg.version}`);
const notes = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
report(notes.includes(`## [${pkg.version}]`), `release notes for ${pkg.version}`);
const status = run('git', ['status', '--porcelain']);
if (status.error) {
  report(false, `Cannot run git status: ${status.error.code || status.error.message}. Working-tree cleanliness is unknown.`);
} else {
  report(status.status === 0 && !status.stdout.trim(), 'working tree must be committed and clean before release');
}

let network = true;
for (const host of ['github.com', 'api.github.com']) {
  let timer;
  try {
    await Promise.race([
      lookup(host),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DNS timeout')), 10_000); }),
    ]);
    report(true, `${host} DNS`);
  } catch (error) {
    network = false;
    report(false, `${host} DNS: ${error.code || error.message}. Check the session network policy before changing credentials.`);
  } finally { clearTimeout(timer); }
}
if (network) {
  const remote = run('git', ['ls-remote', '--exit-code', 'origin', 'refs/heads/main']);
  report(remote.status === 0, remote.error
    ? `Cannot run git ls-remote: ${remote.error.code || remote.error.message}`
    : 'origin/main is reachable (read access only)');
  const access = run('gh', ['repo', 'view', '--json', 'viewerPermission', '--jq', '.viewerPermission']);
  report(access.status === 0 && ['WRITE', 'MAINTAIN', 'ADMIN'].includes(access.stdout.trim()),
    'GitHub CLI can access this repository with write permission');
  if (access.error) console.log(`GitHub CLI: ${access.error.code || access.error.message}`);
} else {
  console.log('SKIP GitHub authentication/permissions: DNS failed; credentials have not been tested.');
}
console.log('Also verify host policy permits Git metadata writes and the intended push; this read-only check does not prove either.');
console.log('Release procedure: docs/releasing.md');
process.exitCode = failures ? 1 : 0;
