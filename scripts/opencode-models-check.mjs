// Regression: the OpenCode 2 model picker (`opencode api --standalone model.list`, JSON).
//  1) Names, the free tag and effort levels (variants) come from the JSON; a provider's API key in `settings`
//     never reaches the catalog; Windows CRLF output parses the same.
//  2) Installing OpenCode or signing in to a provider (a credential row in opencode.db) shows the (new) models
//     without restarting Baton; listing never starts OpenCode's background service (--standalone).
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
    const { DatabaseSync } = await import('node:sqlite');
    const { parseOpencodeModels, catalogs, invalidateModels } = await import(pathToFileURL(path.join(process.cwd(), 'server', 'models.js')));
    const { clearWhichCache } = await import(pathToFileURL(path.join(process.cwd(), 'server', 'platform.js')));

    // the shape OpenCode 2.3 prints (trimmed), including a provider key that must not leak
    const model = (providerID, id, name, cost, variants = [], extra = {}) => ({
      id, modelID: id, providerID, type: 'chat', name, cost: [{ input: cost, output: cost * 5, cache: { read: 0, write: 0 } }],
      variants: variants.map((v) => ({ id: v, settings: { reasoningEffort: v } })), status: 'active', enabled: true,
      settings: { apiKey: 'secret-key-must-not-leak', baseURL: 'https://example.invalid/v1' }, ...extra,
    });
    const list = (signedIn) => JSON.stringify({ location: { directory: home }, data: [
      model('opencode', 'beam-free', 'Beam Free', 0, ['low', 'medium', 'high']),
      model('opencode', 'claude-opus-5-5', 'Claude Opus 5.5', 5, ['max', 'low', 'high']),
      model('opencode', 'old-thing', 'Old', 1, [], { status: 'deprecated' }),
      model('opencode', 'embed-1', 'Embeddings', 1, [], { type: 'embedding' }),
      ...(signedIn ? [model('anthropic', 'claude-sonnet-5-5', 'Claude Sonnet 5.5', 3, ['medium'])] : []),
    ] }, null, 2);

    // 1) parsing
    const parsed = parseOpencodeModels(list(false));
    assert.deepEqual(parsed.map((m) => [m.id, m.name, m.free, m.efforts]), [
      ['opencode/beam-free', 'Beam', true, ['low', 'medium', 'high']],
      ['opencode/claude-opus-5-5', 'Claude Opus 5.5', false, ['low', 'high', 'max']],
    ], 'deprecated and non-chat models are left out; efforts are ordered');
    assert.deepEqual(parseOpencodeModels(list(false).replace(/\n/g, '\r\n') + '\r\n'), parsed, 'CRLF output parses the same');
    assert.deepEqual(parseOpencodeModels('not json'), []);
    assert.ok(!JSON.stringify(parsed).includes('secret-key'), 'provider settings are dropped');

    // 2) not installed -> only "default"; install (fake CLI appears) -> real list without a restart
    const ids = () => catalogs().opencode.models.map((m) => m.id).filter(Boolean);
    const waitFor = async (want, what) => {
      for (let i = 0; i < 100; i++) { if (want(ids(), catalogs().opencode)) return; await new Promise((r) => setTimeout(r, 100)); }
      assert.fail(`${what}: got ${JSON.stringify(ids())}`);
    };
    assert.deepEqual(ids(), [], 'nothing listed before install');

    const db = path.join(process.env.XDG_DATA_HOME, 'opencode', 'opencode.db');
    const binDir = path.join(home, '.opencode', 'bin');
    await fs.mkdir(binDir, { recursive: true });
    const fake = path.join(binDir, 'fake-opencode.mjs');
    const calls = path.join(home, 'calls.log');
    await fs.writeFile(fake, `import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, args.join(' ') + '\\n');
if (!args.includes('--standalone')) { process.stderr.write('would start the background service'); process.exit(1); }
if (args.join(' ') !== 'api --standalone model.list') { process.stdout.write('opencode/plain-fallback\\n'); process.exit(0); }
let signedIn = false;
try { signedIn = new DatabaseSync(${JSON.stringify(db)}, { readOnly: true }).prepare('SELECT COUNT(*) AS n FROM credential').get().n > 0; } catch {}
const out = ${JSON.stringify({ a: list(false), b: list(true) })};
process.stdout.write((signedIn ? out.b : out.a).replace(/\\n/g, process.platform === 'win32' ? '\\r\\n' : '\\n'));
`);
    if (process.platform === 'win32') await fs.writeFile(path.join(binDir, 'opencode.cmd'), `@"${process.execPath}" --no-warnings "%~dp0fake-opencode.mjs" %*\r\n`);
    else await fs.writeFile(path.join(binDir, 'opencode'), `#!/bin/sh\nexec "${process.execPath}" --no-warnings "\${0%/*}/fake-opencode.mjs" "$@"\n`, { mode: 0o755 });

    clearWhichCache(); invalidateModels(); // what a finished install job does
    await waitFor((l, cat) => cat.efforts.includes('high'), 'models after install'); // the JSON list, not the plain fallback
    const opus = catalogs().opencode.models.find((m) => m.id === 'opencode/claude-opus-5-5');
    assert.deepEqual(opus.efforts, ['low', 'high', 'max'], 'effort levels survive');
    assert.ok(catalogs().opencode.models.find((m) => m.id === 'opencode/beam-free').label.includes('Beam'));
    assert.ok(!JSON.stringify(catalogs()).includes('secret-key'), 'no provider key in the catalog sent to the browser');

    // 3) signing in from the user's own terminal (a credential row appears) -> the new provider's models show up
    await fs.mkdir(path.dirname(db), { recursive: true });
    const w = new DatabaseSync(db);
    w.exec('CREATE TABLE credential (id text PRIMARY KEY, integration_id text, label text NOT NULL, value text NOT NULL, connector_id text, method_id text, active integer, time_created integer NOT NULL, time_updated integer NOT NULL)');
    w.prepare('INSERT INTO credential VALUES (?, ?, ?, ?, NULL, NULL, 1, ?, ?)').run('cred_1', 'anthropic', 'Anthropic', 'sk-secret', Date.now(), Date.now());
    w.close();
    await waitFor((l) => l.includes('anthropic/claude-sonnet-5-5'), 'models after sign-in');

    const { TOOLS } = await import(pathToFileURL(path.join(process.cwd(), 'server', 'tools.js')));
    assert.equal(await TOOLS.opencode.loggedIn(), true, 'a credential row counts as signed in');
    for (const line of (await fs.readFile(calls, 'utf8')).trim().split('\n')) assert.ok(line.includes('--standalone'), `every call stays off the background service: ${line}`);

    console.log('PASS: OpenCode 2 model list (JSON, efforts, no secrets, CRLF), refresh after install / sign-in, --standalone');
    process.exit(0);
  }
} finally {
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
}
