// Server-side translation. Strings are written in Korean in the source and looked up in
// public/locales/en.json (the same dictionary the browser uses). English is the default language.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './util.js';
import { getSettings } from './store.js';

const FILE = path.join(ROOT, 'public', 'locales', 'en.json');
let EN = {};
let mtime = 0;
function dict() {
  try {
    const st = fs.statSync(FILE);
    if (st.mtimeMs !== mtime) { EN = JSON.parse(fs.readFileSync(FILE, 'utf8')); mtime = st.mtimeMs; }
  } catch { /* keep last */ }
  return EN;
}

export function lang() {
  try { return getSettings().lang === 'ko' ? 'ko' : 'en'; } catch { return 'en'; }
}

/** tr('{n}개 남았어요', { n: 3 }) -> "3 left" (en) / "3개 남았어요" (ko) */
export function tr(ko, vars) {
  let s = lang() === 'ko' ? ko : (dict()[ko] ?? ko);
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return s;
}
