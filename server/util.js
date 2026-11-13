import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

export const HOME = os.homedir();
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

/** Where Baton's own background calls (briefs, skill/MCP drafts, connection checks) run: outside every project. */
export const ONESHOT_DIR = path.join(os.tmpdir(), 'baton-oneshot');

/** Sessions recorded in Baton's own working folders (the one-shot folder, or `data/` in older versions) are never the user's. */
export function isInternalCwd(cwd) {
  if (!cwd) return false;
  const norm = (p) => path.resolve(String(p)).replace(/[\\/]+$/, '');
  const c = norm(cwd), eq = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  return eq(c, norm(ONESHOT_DIR)) || eq(c, norm(DATA_DIR));
}

export const now = () => Date.now();
export const DAY = 86400000;

export async function statSafe(p) {
  try { return await fsp.stat(p); } catch { return null; }
}

/** Read a JSONL file line by line, calling fn(obj) for each parsed line. Stops if fn returns false. */
export async function eachJsonl(file, fn) {
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (fn(obj) === false) break;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

/** Read the last `bytes` of a file and parse full JSONL lines from it. */
export async function tailJsonl(file, bytes = 256 * 1024) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    const out = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try { out.push(JSON.parse(line)); } catch { /* partial line */ }
    }
    return out;
  } finally {
    await fh.close();
  }
}

/** Read the first `bytes` of a file and parse JSONL lines. */
export async function headJsonl(file, bytes = 128 * 1024, maxLines = 400) {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    const text = buf.subarray(0, bytesRead).toString('utf8');
    const out = [];
    const lines = text.split('\n');
    if (bytesRead === bytes) lines.pop();
    for (const line of lines.slice(0, maxLines)) {
      if (!line) continue;
      try { out.push(JSON.parse(line)); } catch { /* skip */ }
    }
    return out;
  } finally {
    await fh.close();
  }
}

export function clip(s, n) {
  if (!s) return '';
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function oneLine(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/** Strip harness-injected XML-ish blocks from user prompts so titles/previews are readable. */
export function cleanPrompt(s) {
  if (!s) return '';
  return String(s)
    .replace(/<(system-reminder|environment_context|user_instructions|command-message|command-args|local-command-stdout|local-command-caveat|INSTRUCTIONS|ide_opened_file|ide_selection)[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/<command-name>([\s\S]*?)<\/command-name>/g, '$1')
    .trim();
}

export function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

export function shortHome(p) {
  if (!p) return p;
  return p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p;
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** Run async fn over items with limited concurrency. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch (e) { out[idx] = undefined; }
    }
  });
  await Promise.all(workers);
  return out;
}

/** 1 if a > b, -1 if a < b, 0 if equal (x.y.z, a pre-release sorts before its release). */
export function cmpVersion(a, b) {
  const p = (v) => { const [core, pre] = String(v).replace(/^v/, '').split('-'); return { n: core.split('.').map((x) => Number(x) || 0), pre: pre || '' }; };
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if ((x.n[i] || 0) !== (y.n[i] || 0)) return (x.n[i] || 0) > (y.n[i] || 0) ? 1 : -1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre > y.pre ? 1 : -1;
}
