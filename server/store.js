// Persistent state for Baton (pins, hides, project status, briefs, push subscriptions, settings).
// Uses node:sqlite (built into Node 22.5+).
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DATA_DIR } from './util.js';

export const db = new DatabaseSync(path.join(DATA_DIR, 'baton.db'));
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS session_meta (
  key TEXT PRIMARY KEY,           -- "<tool>:<id>"
  pinned INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  title TEXT,                     -- user override
  last_seen INTEGER               -- last time opened in Baton
);
CREATE TABLE IF NOT EXISTS project_meta (
  id TEXT PRIMARY KEY,            -- project root path
  name TEXT,                      -- user override
  status TEXT NOT NULL DEFAULT 'active',  -- active | paused | done | archived
  pinned INTEGER NOT NULL DEFAULT 0,
  snooze_until INTEGER,
  last_nudged INTEGER,
  note TEXT
);
CREATE TABLE IF NOT EXISTS briefs (
  project TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  created INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,             -- run_done | run_error | nudge
  title TEXT NOT NULL,
  body TEXT,
  url TEXT,
  read INTEGER NOT NULL DEFAULT 0
);
`);

const q = (sql) => db.prepare(sql);
// migrations
try { db.exec('ALTER TABLE session_meta ADD COLUMN notify INTEGER NOT NULL DEFAULT 0'); } catch { /* exists */ }
try { db.exec('ALTER TABLE session_meta ADD COLUMN cwd_override TEXT'); } catch { /* exists */ }

// ---------- kv / settings ----------
const DEFAULT_SETTINGS = {
  lang: 'en',                   // UI language: 'en' (default) or 'ko'
  setupDone: false,             // onboarding finished or skipped
  showAutomated: false,         // codex exec / agy subagent / tmp sessions
  nudgeEnabled: true,
  nudgeHour: 21,                // local hour to send the daily nudge
  staleDays: 5,                 // a project is "dozing" after N idle days
  forgetDays: 180,              // stop nudging after N days (probably abandoned)
  nudgeCooldownDays: 10,        // don't nudge the same project again within N days
  briefTool: 'claude',
  briefModel: 'haiku',
  defaultPerm: 'auto',
  notifyOnRunDone: true,
  updateCheck: true,            // look for new Baton releases and announce them
  workspaceRoots: ['~/workspace'],
  defaultCwd: '',
};

export function getKV(k, fallback = null) {
  const row = q('SELECT v FROM kv WHERE k = ?').get(k);
  if (!row) return fallback;
  try { return JSON.parse(row.v); } catch { return fallback; }
}
export function setKV(k, v) {
  q('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, JSON.stringify(v));
}
export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(getKV('settings', {}) || {}) };
}
export function updateSettings(patch) {
  const next = { ...getSettings() };
  for (const [k, v] of Object.entries(patch || {})) {
    if (k in DEFAULT_SETTINGS && typeof v === typeof DEFAULT_SETTINGS[k]) next[k] = v;
  }
  setKV('settings', next);
  return next;
}

// ---------- session meta ----------
export function allSessionMeta() {
  const map = new Map();
  for (const r of q('SELECT * FROM session_meta').all()) map.set(r.key, r);
  return map;
}
export function patchSessionMeta(key, patch) {
  const cur = q('SELECT * FROM session_meta WHERE key = ?').get(key) || { key, pinned: 0, hidden: 0, title: null, last_seen: null, notify: 0, cwd_override: null };
  const next = { ...cur, ...patch };
  q(`INSERT INTO session_meta (key, pinned, hidden, title, last_seen, notify, cwd_override) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET pinned=excluded.pinned, hidden=excluded.hidden, title=excluded.title, last_seen=excluded.last_seen, notify=excluded.notify, cwd_override=excluded.cwd_override`)
    .run(key, next.pinned ? 1 : 0, next.hidden ? 1 : 0, next.title ?? null, next.last_seen ?? null, Number(next.notify) || 0, next.cwd_override ?? null);
  return next;
}

// ---------- project meta ----------
export function allProjectMeta() {
  const map = new Map();
  for (const r of q('SELECT * FROM project_meta').all()) map.set(r.id, r);
  return map;
}
export function getProjectMeta(id) {
  return q('SELECT * FROM project_meta WHERE id = ?').get(id) || null;
}
export function patchProjectMeta(id, patch) {
  const cur = getProjectMeta(id) || { id, name: null, status: 'active', pinned: 0, snooze_until: null, last_nudged: null, note: null };
  const next = { ...cur, ...patch };
  q(`INSERT INTO project_meta (id, name, status, pinned, snooze_until, last_nudged, note) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, status=excluded.status, pinned=excluded.pinned,
       snooze_until=excluded.snooze_until, last_nudged=excluded.last_nudged, note=excluded.note`)
    .run(id, next.name ?? null, next.status || 'active', next.pinned ? 1 : 0, next.snooze_until ?? null, next.last_nudged ?? null, next.note ?? null);
  return next;
}

// ---------- briefs ----------
export function getBrief(project) {
  const r = q('SELECT * FROM briefs WHERE project = ?').get(project);
  if (!r) return null;
  try { return { ...JSON.parse(r.json), fingerprint: r.fingerprint, created: r.created }; } catch { return null; }
}
export function allBriefs() {
  const map = new Map();
  for (const r of q('SELECT * FROM briefs').all()) {
    try { map.set(r.project, { ...JSON.parse(r.json), fingerprint: r.fingerprint, created: r.created }); } catch { /* skip */ }
  }
  return map;
}
export function saveBrief(project, fingerprint, obj) {
  q(`INSERT INTO briefs (project, fingerprint, created, json) VALUES (?, ?, ?, ?)
     ON CONFLICT(project) DO UPDATE SET fingerprint=excluded.fingerprint, created=excluded.created, json=excluded.json`)
    .run(project, fingerprint, Date.now(), JSON.stringify(obj));
}

// ---------- push subscriptions ----------
export function listPushSubs() {
  return q('SELECT json FROM push_subs').all().map((r) => JSON.parse(r.json));
}
export function addPushSub(sub) {
  q('INSERT INTO push_subs (endpoint, json, created) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET json=excluded.json')
    .run(sub.endpoint, JSON.stringify(sub), Date.now());
}
export function removePushSub(endpoint) {
  q('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint);
}

// ---------- notification inbox ----------
export function addEvent(kind, title, body, url) {
  q('INSERT INTO events (ts, kind, title, body, url) VALUES (?, ?, ?, ?, ?)').run(Date.now(), kind, title, body || null, url || null);
  q('DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 200)').run();
}
export function listEvents(limit = 50) {
  return q('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit);
}
export function markEventsRead() {
  q('UPDATE events SET read = 1 WHERE read = 0').run();
}
export function lastEventId() {
  return q('SELECT MAX(id) AS id FROM events').get().id || 0;
}
export function eventsAfter(id, limit = 10) {
  return q('SELECT * FROM events WHERE id > ? ORDER BY id ASC LIMIT ?').all(id, limit);
}
export function unreadCount() {
  return q('SELECT COUNT(*) AS n FROM events WHERE read = 0').get().n;
}

/** Sessions moved to another working folder in Baton: key -> folder. */
export function cwdOverrides() {
  const map = new Map();
  for (const r of q('SELECT key, cwd_override FROM session_meta WHERE cwd_override IS NOT NULL').all()) map.set(r.key, r.cwd_override);
  return map;
}

/** Sessions the user asked to be pinged about when the agent finishes (1 = once, 2 = every time). */
export function watchedSessions() {
  return q('SELECT key, notify FROM session_meta WHERE notify > 0').all();
}
