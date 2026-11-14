// Session boxes: mail-style folders for sessions. A box has keywords (matched against the title and the
// first prompt) and can be kept off Home. "auto" is built in: sessions a CLI or script ran on its own.
// Which box a session is in, first match wins:
//   1. set by hand (session_meta.box = box id; '-' = "no box", so it shows on Home again)
//   2. the first user box with a keyword in the title / first prompt
//   3. "auto" when the session was detected as automated
// Boxes only filter views; the Sessions tab still lists every session by default.
import crypto from 'node:crypto';
import * as store from './store.js';

export const AUTO = 'auto';
export const NO_BOX = '-';
const MAX_BOXES = 30, MAX_KEYWORDS = 20;

function userBoxes() {
  const list = store.getKV('boxes', []);
  return Array.isArray(list) ? list : [];
}

/** All boxes, built-in first. The built-in one has no name: the client shows its translated label. */
export function listBoxes() {
  return [{ id: AUTO, name: null, keywords: [], hideHome: true, builtin: true }, ...userBoxes()];
}

function cleanKeywords(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split(/[,\n]/);
  return [...new Set(arr.map((k) => String(k).trim()).filter(Boolean).map((k) => k.slice(0, 60)))].slice(0, MAX_KEYWORDS);
}

/** Create (no id) or update a user box. */
export function saveBox(b) {
  const name = String(b?.name || '').trim().slice(0, 40);
  if (!name) throw new Error('name required');
  const list = userBoxes();
  const box = { id: b.id || crypto.randomBytes(4).toString('hex'), name, keywords: cleanKeywords(b.keywords), hideHome: b.hideHome !== false };
  if (box.id === AUTO || box.id === NO_BOX) throw new Error('reserved id');
  const at = list.findIndex((x) => x.id === box.id);
  if (at >= 0) list[at] = box;
  else if (list.length >= MAX_BOXES) throw new Error('too many boxes');
  else list.push(box);
  store.setKV('boxes', list);
  return box;
}

/** Remove a user box; sessions put there by hand go back to automatic sorting. */
export function deleteBox(id) {
  if (id === AUTO) throw new Error('built-in box');
  store.setKV('boxes', userBoxes().filter((x) => x.id !== id));
  store.db.prepare('UPDATE session_meta SET box = NULL WHERE box = ?').run(id);
}

/** Returns a sorter: (session, manualBox) → { box, manual }. Build once per listing. */
export function boxSorter() {
  const boxes = userBoxes().map((b) => ({ id: b.id, kws: (b.keywords || []).map((k) => k.toLowerCase()) }));
  const ids = new Set([AUTO, NO_BOX, ...boxes.map((b) => b.id)]);
  return (s, manual) => {
    if (manual && ids.has(manual)) return { box: manual === NO_BOX ? null : manual, manual: true };
    const hay = `${s.title || ''}\n${s.firstPrompt || ''}`.toLowerCase();
    const hit = boxes.find((b) => b.kws.some((k) => hay.includes(k)));
    if (hit) return { box: hit.id, manual: false };
    return { box: s.automated ? AUTO : null, manual: false };
  };
}

/** Box ids whose sessions stay off Home. */
export function homeHiddenBoxes() {
  return new Set(listBoxes().filter((b) => b.hideHome).map((b) => b.id));
}
