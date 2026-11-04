// Device trust + password gate.
// - Requests made directly on this PC (loopback, not proxied) are always allowed.
// - Any other device must enter the password once; it then gets a device cookie that stays valid
//   while the device keeps coming back within `trustDays` (sliding window). Devices can be revoked.
// - Default password is "0000" until changed in Settings. Failed attempts are rate-limited.
import crypto from 'node:crypto';
import { db, getKV, setKV, getSettings } from './store.js';
import { DAY } from './util.js';
import { tr } from './i18n.js';

db.exec(`CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, name TEXT, ip TEXT,
  created INTEGER NOT NULL, last_seen INTEGER NOT NULL
)`);

const COOKIE = 'baton_device';
const DEFAULT_PASSWORD = '0000';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(pw), salt, 32).toString('hex') };
}
function passwordRecord() {
  return getKV('auth_password', null) || { ...hashPassword(DEFAULT_PASSWORD), isDefault: true };
}
function checkPassword(pw) {
  const rec = passwordRecord();
  const h = crypto.scryptSync(String(pw ?? ''), rec.salt, 32);
  return crypto.timingSafeEqual(h, Buffer.from(rec.hash, 'hex'));
}
export function usingDefaultPassword() { return Boolean(passwordRecord().isDefault); }

export function isLocal(req) {
  const ra = req.socket.remoteAddress || '';
  const loopback = ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1';
  const proxied = Boolean(req.headers['x-forwarded-for'] || req.headers['tailscale-user-login'] || req.headers['x-forwarded-host']);
  return loopback && !proxied;
}
export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

function cookieToken(req) {
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]+)`));
  return m ? m[1] : null;
}
const trustMs = () => Math.max(1, Number(getSettings().trustDays) || 30) * DAY;

function cookieHeader(req, token, maxAgeSec) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || /\.ts\.net(:\d+)?$/.test(req.headers.host || '');
  return `${COOKIE}=${token}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** { ok, device, setCookie? } — refreshes last_seen (sliding trust window). */
export function checkDevice(req) {
  const token = cookieToken(req);
  if (!token) return { ok: false };
  const d = db.prepare('SELECT * FROM devices WHERE token_hash = ?').get(sha(token));
  if (!d) return { ok: false };
  const now = Date.now();
  if (now - d.last_seen > trustMs()) { db.prepare('DELETE FROM devices WHERE id = ?').run(d.id); return { ok: false, expired: true }; }
  let setCookie = null;
  if (now - d.last_seen > 10 * 60_000) {
    db.prepare('UPDATE devices SET last_seen = ?, ip = ? WHERE id = ?').run(now, clientIp(req), d.id);
    setCookie = cookieHeader(req, token, Math.round(trustMs() / 1000));
  }
  return { ok: true, device: d, setCookie };
}

// --- brute-force protection: per IP and global
const fails = new Map(); // ip -> { n, until }
let globalFails = { n: 0, since: Date.now() };
function lockedFor(ip) {
  const f = fails.get(ip);
  if (f?.until && f.until > Date.now()) return f.until - Date.now();
  if (Date.now() - globalFails.since > 3600_000) globalFails = { n: 0, since: Date.now() };
  if (globalFails.n >= 30) return globalFails.since + 3600_000 - Date.now();
  return 0;
}
function noteFail(ip) {
  const f = fails.get(ip) || { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= 5) { f.until = Date.now() + Math.min(60, 5 * 2 ** (Math.floor(f.n / 5) - 1)) * 60_000; }
  fails.set(ip, f);
  globalFails.n += 1;
}

function deviceName(ua = '') {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /CriOS|Chrome\//.test(ua) && !/Edg\//.test(ua) ? 'Chrome' : /Edg\//.test(ua) ? 'Edge' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return `${os}${br ? ` · ${br}` : ''}`;
}

/** Returns { ok, setCookie } or { ok:false, error, retryInSec }. */
export function login(req, password) {
  const ip = clientIp(req);
  const wait = lockedFor(ip);
  if (wait > 0) return { ok: false, error: tr('너무 많이 틀렸어요. {n}분 뒤에 다시 시도하세요', { n: Math.ceil(wait / 60_000) }), retryInSec: Math.ceil(wait / 1000) };
  if (!checkPassword(password)) { noteFail(ip); return { ok: false, error: tr('비밀번호가 맞지 않아요') }; }
  fails.delete(ip);
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO devices (id, token_hash, name, ip, created, last_seen) VALUES (?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), sha(token), deviceName(req.headers['user-agent']), ip, now, now);
  return { ok: true, setCookie: cookieHeader(req, token, Math.round(trustMs() / 1000)) };
}

export function logout(req) {
  const token = cookieToken(req);
  if (token) db.prepare('DELETE FROM devices WHERE token_hash = ?').run(sha(token));
  return cookieHeader(req, 'x', 0);
}

export function changePassword(current, next) {
  if (!checkPassword(current)) throw new Error(tr('현재 비밀번호가 맞지 않아요'));
  next = String(next || '');
  if (next.length < 4 || next.length > 64) throw new Error(tr('비밀번호는 4~64자로 정해주세요'));
  setKV('auth_password', hashPassword(next));
}

export function listDevices(req) {
  const mine = cookieToken(req);
  const myHash = mine ? sha(mine) : null;
  const cutoff = Date.now() - trustMs();
  return db.prepare('SELECT * FROM devices ORDER BY last_seen DESC').all()
    .filter((d) => d.last_seen >= cutoff)
    .map((d) => ({ id: d.id, name: d.name, ip: d.ip, created: d.created, lastSeen: d.last_seen, expiresAt: d.last_seen + trustMs(), current: d.token_hash === myHash }));
}
export function revokeDevice(id) { db.prepare('DELETE FROM devices WHERE id = ?').run(id); }
export function revokeAll(exceptReq) {
  const mine = cookieToken(exceptReq);
  if (mine) db.prepare('DELETE FROM devices WHERE token_hash != ?').run(sha(mine));
  else db.prepare('DELETE FROM devices').run();
}
