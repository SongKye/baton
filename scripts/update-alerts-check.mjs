// Exercise legacy settings and manual checks in an isolated install, without network access.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'baton-update-alerts-'));
const originalFetch = globalThis.fetch;
let db;
try {
  await fs.cp(path.join(root, 'server'), path.join(tmp, 'server'), { recursive: true });
  await fs.copyFile(path.join(root, 'package.json'), path.join(tmp, 'package.json'));
  const store = await import(pathToFileURL(path.join(tmp, 'server/store.js')).href);
  db = store.db;
  assert.equal(store.getSettings().updateCheck, false);
  store.setKV('settings', { updateCheck: true });
  assert.equal(store.getSettings().updateCheck, false, 'legacy settings cannot enable alerts');
  assert.equal(store.updateSettings({ updateCheck: true, lang: 'ko' }).updateCheck, false);
  assert.equal(store.getKV('settings').updateCheck, false, 'API writes persist false');
  assert.equal(store.getSettings().lang, 'ko', 'other settings still work');

  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return { ok: true, json: async () => ({ tag_name: 'v999.0.0', html_url: 'https://example.com/release', body: 'Release notes' }) };
  };
  const update = await import(pathToFileURL(path.join(tmp, 'server/update.js')).href);
  assert.equal(requests, 0, 'loading the updater does not check automatically');
  const result = await update.checkUpdate({ force: true });
  assert.equal(requests, 1, 'manual checks still fetch releases');
  assert.equal(result.newer, true);
  assert.equal(result.enabled, false);
  assert.equal(result.notes, 'Release notes');
  assert.equal(update.updateCached().latest, '999.0.0');
  assert.equal(store.getKV('update_notified'), null);
  assert.equal(db.prepare("SELECT count(*) AS n FROM events WHERE kind = 'update'").get().n, 0);
  console.log('Update alerts stay disabled; manual release checks still work.');
} finally {
  globalThis.fetch = originalFetch;
  db?.close();
  await fs.rm(tmp, { recursive: true, force: true });
}
