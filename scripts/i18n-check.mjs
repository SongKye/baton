#!/usr/bin/env node
// Lists translation keys used in the code (t('…') / tr('…')) that are missing from public/locales/en.json,
// and dictionary entries no longer used. Source strings are Korean; English lives in en.json.
//   node scripts/i18n-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/locales/en.json'), 'utf8'));
const files = ['public/app.js', ...fs.readdirSync(path.join(ROOT, 'server')).filter((f) => f.endsWith('.js')).map((f) => `server/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'server/sources')).map((f) => `server/sources/${f}`)];
const re = /\btr?\(\s*'((?:[^'\\]|\\.)*)'/g;
const used = new Set();
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of src.matchAll(re)) {
    const k = m[1].replace(/\\'/g, "'");
    if (/[가-힣]/.test(k)) used.add(k);
  }
}
const missing = [...used].filter((k) => !(k in dict));
const unused = Object.keys(dict).filter((k) => !used.has(k) && !['홈', '프로젝트', '세션', '도구', '설정', '테스트 폴더', '테스트 메시지', '짧은 한마디', '빈 대화', '자동 실행'].includes(k));
console.log(`keys in code: ${used.size}, in en.json: ${Object.keys(dict).length}`);
if (missing.length) { console.log(`\nmissing (${missing.length}):`); for (const k of missing) console.log(`  ${JSON.stringify(k)}`); }
if (unused.length) { console.log(`\nunused (${unused.length}):`); for (const k of unused) console.log(`  ${JSON.stringify(k)}`); }
process.exit(missing.length ? 1 : 0);
