// Regression: the "default model" fallback for a ChatGPT account whose config.toml pins an unsupported
// model must not leak into other setups (custom provider, another account, an edited config.toml).
// Runs the real catalog + runner helpers in a throwaway copy so Baton's own data/ is never touched.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const child = process.argv[2] === '--child';
const tmp = child ? null : await fs.mkdtemp(path.join(os.tmpdir(), 'baton-codex-fallback-'));
try {
  if (!child) {
    // copy the server into tmp/app (data/ is ROOT/data), give it a fake HOME + CODEX_HOME, and re-run there
    const app = path.join(tmp, 'app');
    await fs.mkdir(path.join(app, 'public'), { recursive: true });
    for (const d of ['server', 'scripts', path.join('public', 'locales')]) await fs.cp(path.join(repo, d), path.join(app, d), { recursive: true });
    await fs.copyFile(path.join(repo, 'package.json'), path.join(app, 'package.json'));
    await fs.symlink(path.join(repo, 'node_modules'), path.join(app, 'node_modules'), 'junction').catch(() => {});
    const home = path.join(tmp, 'home');
    await fs.mkdir(path.join(home, '.codex'), { recursive: true });
    execFileSync(process.execPath, ['--no-warnings', path.join(app, 'scripts', 'codex-fallback-check.mjs'), '--child'], {
      stdio: 'inherit', cwd: app,
      env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex'), BATON_NO_SHELL_ENV: '1', PATH: path.dirname(process.execPath) },
    });
  } else {
    const codexHome = process.env.CODEX_HOME;
    const write = (f, v) => fs.writeFile(path.join(codexHome, f), typeof v === 'string' ? v : JSON.stringify(v));
    const auth = (account) => write('auth.json', { OPENAI_API_KEY: null, tokens: { access_token: 'x', refresh_token: 'y', id_token: 'z', account_id: account } });
    await write('models_cache.json', { models: [
      { slug: 'offered', display_name: 'Offered', priority: 1, visibility: 'list' },
      { slug: 'other', display_name: 'Other', priority: 2, visibility: 'list' },
      { slug: 'hidden', display_name: 'Hidden', priority: 0, visibility: 'hide' },
    ] });
    await auth('acct-1');
    await write('config.toml', 'model = "retired-model"\n');

    const { catalogs } = await import(path.join(process.cwd(), 'server', 'models.js'));
    const { codexDefaultFallback } = await import(path.join(process.cwd(), 'server', 'providers.js'));
    const codex = () => catalogs().codex;

    // 1) ChatGPT account, config.toml model not offered -> default uses the first offered model
    let cat = codex();
    assert.equal(cat.defaults.model, 'offered');
    assert.ok(!cat.models.some((m) => m.id === 'hidden'), 'hidden models are not listed');
    assert.equal(codexDefaultFallback(), 'offered');

    // 2) switch to a custom provider: the fallback must stop applying right away, and the catalog clears it
    await write('config.toml', 'model = "retired-model"\nmodel_provider = "corp"\n\n[model_providers.corp]\nname = "Corp"\nbase_url = "https://llm.corp/v1"\n');
    assert.equal(codexDefaultFallback(), null, 'custom provider ignores the ChatGPT fallback before the catalog runs');
    cat = codex();
    assert.equal(cat.provider, 'Corp');
    assert.equal(codexDefaultFallback(), null);

    // 3) back on ChatGPT: recomputed for the same setup
    await write('config.toml', 'model = "retired-model"\n');
    codex();
    assert.equal(codexDefaultFallback(), 'offered');

    // 4) another account, or config.toml now naming an offered model -> no stale fallback
    await auth('acct-2');
    assert.equal(codexDefaultFallback(), null, 'a different account invalidates it');
    codex();
    assert.equal(codexDefaultFallback(), 'offered');
    await write('config.toml', 'model = "other"\n');
    assert.equal(codexDefaultFallback(), null, 'editing config.toml invalidates it');
    cat = codex();
    assert.equal(cat.defaults.model, 'other');
    assert.equal(codexDefaultFallback(), null);

    console.log('PASS: Codex default fallback is scoped to the ChatGPT account and config it was computed for');
    process.exit(0);
  }
} finally {
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
}
