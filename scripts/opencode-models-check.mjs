// Regression: the OpenCode model picker.
//  1) Windows prints `opencode models --verbose` with CRLF; parsing must still find every model and its
//     effort levels (otherwise the picker falls back to raw ids with no effort).
//  2) Installing OpenCode or signing in to a provider must show the (new) models without restarting Baton.
// Runs the real modules in a throwaway copy (Baton's data/ is ROOT/data) with a fake HOME and a fake CLI.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unavailableCliPath } from './lib-check-clis.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const child = process.argv[2] === '--child';
const tmp = child ? null : await fs.mkdtemp(path.join(os.tmpdir(), 'baton-opencode-models-'));
try {
  if (!child) {
    const app = path.join(tmp, 'app');
    await fs.mkdir(path.join(app, 'public'), { recursive: true });
    for (const d of ['server', 'scripts', path.join('public', 'locales')]) await fs.cp(path.join(repo, d), path.join(app, d), { recursive: true });
    await fs.copyFile(path.join(repo, 'package.json'), path.join(app, 'package.json'));
    await fs.symlink(path.join(repo, 'node_modules'), path.join(app, 'node_modules'), 'junction').catch(() => {});
    const home = path.join(tmp, 'home');
    await fs.mkdir(home, { recursive: true });
    const cliPath = await unavailableCliPath(tmp, ['claude', 'codex', 'agy', 'cursor-agent', 'agent']);
    execFileSync(process.execPath, ['--no-warnings', path.join(app, 'scripts', 'opencode-models-check.mjs'), '--child'], {
      stdio: 'inherit', cwd: app,
      env: { ...process.env, HOME: home, USERPROFILE: home, XDG_DATA_HOME: path.join(home, 'data'), XDG_CONFIG_HOME: path.join(home, 'config'), APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), BATON_NO_SHELL_ENV: '1', PATH: cliPath },
    });
  } else {
    const home = os.homedir();
    const { parseOpencodeVerbose, catalogs, invalidateModels } = await import(pathToFileURL(path.join(process.cwd(), 'server', 'models.js')));
    const { clearWhichCache } = await import(pathToFileURL(path.join(process.cwd(), 'server', 'platform.js')));

    const entry = (id, name, cost, variants = {}) => [id, ...JSON.stringify({ id, name, cost, variants }, null, 2).split('\n')];
    const verbose = (signedIn) => [
      ...entry('opencode/beam-free', 'Beam Free', { input: 0, output: 0 }),
      ...entry('opencode/claude-opus-5-5', 'Claude Opus 5.5', { input: 5, output: 25 }, { high: {}, low: {}, max: {} }),
      ...(signedIn ? entry('anthropic/claude-sonnet-5-5', 'Claude Sonnet 5.5', { input: 3, output: 15 }, { medium: {} }) : []),
    ].join('\r\n') + '\r\n';

    // 1) CRLF output parses the same as LF output
    const crlf = parseOpencodeVerbose(verbose(false));
    assert.deepEqual(crlf, parseOpencodeVerbose(verbose(false).replace(/\r\n/g, '\n')));
    assert.deepEqual(crlf.map((m) => [m.id, m.name, m.free, m.efforts]), [
      ['opencode/beam-free', 'Beam', true, []],
      ['opencode/claude-opus-5-5', 'Claude Opus 5.5', false, ['low', 'high', 'max']],
    ]);

    // 2) not installed -> only "default"; install (fake CLI appears) -> real list without a restart
    const ids = () => catalogs().opencode.models.map((m) => m.id).filter(Boolean);
    const waitFor = async (want, what) => {
      for (let i = 0; i < 100; i++) { if (want(ids(), catalogs().opencode)) return; await new Promise((r) => setTimeout(r, 100)); }
      assert.fail(`${what}: got ${JSON.stringify(ids())}`);
    };
    assert.deepEqual(ids(), [], 'nothing listed before install');

    const binDir = path.join(home, '.opencode', 'bin');
    await fs.mkdir(binDir, { recursive: true });
    const fake = path.join(binDir, 'fake-opencode.mjs');
    const auth = path.join(process.env.XDG_DATA_HOME, 'opencode', 'auth.json');
    await fs.writeFile(fake, `import fs from 'node:fs';\nconst out = ${JSON.stringify({ a: verbose(false), b: verbose(true) })};\nprocess.stdout.write(fs.existsSync(${JSON.stringify(auth)}) ? out.b : out.a);\n`);
    if (process.platform === 'win32') await fs.writeFile(path.join(binDir, 'opencode.cmd'), `@"${process.execPath}" "%~dp0fake-opencode.mjs" %*\r\n`);
    else await fs.writeFile(path.join(binDir, 'opencode'), `#!/bin/sh\nexec "${process.execPath}" "\${0%/*}/fake-opencode.mjs" "$@"\n`, { mode: 0o755 });

    clearWhichCache(); invalidateModels(); // what a finished install job does
    await waitFor((l, cat) => cat.efforts.includes('high'), 'models after install'); // the verbose list, not the plain fallback
    const opus = catalogs().opencode.models.find((m) => m.id === 'opencode/claude-opus-5-5');
    assert.deepEqual(opus.efforts, ['low', 'high', 'max'], 'effort levels survive');
    assert.ok(catalogs().opencode.efforts.includes('high'));

    // 3) signing in from the user's own terminal (auth.json appears) -> new provider's models show up
    await fs.mkdir(path.dirname(auth), { recursive: true });
    await fs.writeFile(auth, '{}');
    await waitFor((l) => l.includes('anthropic/claude-sonnet-5-5'), 'models after sign-in');

    console.log('PASS: OpenCode CRLF model list, effort levels, and refresh after install / sign-in');
    process.exit(0);
  }
} finally {
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
}
