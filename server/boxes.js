// Session boxes: saved keyword views, like mail folders. A box only *collects*: any session whose title or
// first message contains one of its keywords shows up in it. Boxes never hide a session anywhere else, and
// they have nothing to do with the automated / external-run labels (a box usually ends up holding
// scheduled or scripted runs only because their prompts repeat the same words).
import crypto from 'node:crypto';
import * as store from './store.js';

const MAX_BOXES = 30, MAX_KEYWORDS = 20;

export function listBoxes() {
  const list = store.getKV('boxes', []);
  return Array.isArray(list) ? list : [];
}

function cleanKeywords(v) {
  const arr = Array.isArray(v) ? v : [];
  const seen = new Set(), out = [];
  for (const k of arr.map((x) => String(x ?? '').trim().slice(0, 60)).filter(Boolean)) {
    if (seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase()); out.push(k);
  }
  return out.slice(0, MAX_KEYWORDS);
}

/** Create (no id) or update a box. */
export function saveBox(b) {
  const name = String(b?.name || '').trim().slice(0, 40);
  if (!name) throw new Error('name required');
  const keywords = cleanKeywords(b.keywords);
  if (!keywords.length) throw new Error('at least one keyword');
  const list = listBoxes();
  const at = b.id ? list.findIndex((x) => x.id === b.id) : -1;
  if (b.id && at < 0) throw new Error('no such box');
  const box = { id: b.id || crypto.randomBytes(4).toString('hex'), name, keywords };
  if (at >= 0) list[at] = box;
  else if (list.length >= MAX_BOXES) throw new Error('too many boxes');
  else list.push(box);
  store.setKV('boxes', list);
  return box;
}

export function deleteBox(id) {
  store.setKV('boxes', listBoxes().filter((x) => x.id !== id));
}

/** (session) → true when any keyword is in its title or first message (case-insensitive). */
export function boxMatcher(box) {
  const kws = (box.keywords || []).map((k) => k.toLowerCase()).filter(Boolean);
  return (s) => {
    if (!kws.length) return false;
    const hay = `${s.title || ''}\n${s.firstPrompt || ''}`.toLowerCase();
    return kws.some((k) => hay.includes(k));
  };
}
