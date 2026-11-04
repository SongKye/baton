// Baton — HTTP server (JSON API + SSE + static PWA).
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ROOT, HOME, DAY, clip, shortHome } from './util.js';
import * as store from './store.js';
import { decoratedSessions, projectsList, findSession, readMessages, getSnapshot, forceRefresh } from './indexer.js';
import { gitInfo, projectRoot, projectFingerprint } from './projects.js';
import { startRun, getRun, stopRun, listRuns, publicRun, activeRunFor, bus } from './runner.js';
import { catalogs } from './models.js';
import { vapidPublicKey, notify, setPublicOrigin } from './push.js';
import { allLimits } from './limits.js';
import { trashSession, restoreSession, listTrash, emptyTrash, startTrashPurge, cleanupReason } from './trash.js';
import { startWatcher } from './watch.js';
import { listPorts, shareToPhone, unshare, stopPort } from './ports.js';
import { skillsReport, skillDetail } from './skills.js';
import crypto from 'node:crypto';
import { ensureBrief, briefPending } from './brief.js';
import { dozingProjects, sendNudge, startNudgeScheduler } from './nudge.js';
import { pageMessages, slimMessage } from './sources/common.js';
import { usageReport, startUsageScheduler } from './usage.js';
import { observeRun, seedDefaults } from './observe.js';

const PORT = Number(process.env.BATON_PORT || 7420);
const HOST = process.env.BATON_HOST || '127.0.0.1';
const ALLOWED = (process.env.BATON_ALLOWED_LOGINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const PUBLIC = path.join(ROOT, 'public');
const VENDOR = {
  '/vendor/marked.js': path.join(ROOT, 'node_modules/marked/lib/marked.umd.js'),
  '/vendor/purify.js': path.join(ROOT, 'node_modules/dompurify/dist/purify.min.js'),
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

// ---------- helpers ----------
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}
async function body(req) {
  const chunks = [];
  let n = 0;
  for await (const c of req) { n += c.length; if (n > 40e6) throw new Error('too large'); chunks.push(c); }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function authorized(req) {
  const login = String(req.headers['tailscale-user-login'] || '').toLowerCase();
  const proxied = Boolean(req.headers['x-forwarded-for']);
  if (login) return !ALLOWED.length || ALLOWED.includes(login);
  return !proxied; // direct local access only
}
function sessionView(s) {
  return {
    key: s.key, tool: s.tool, id: s.id, title: s.title, cwd: shortHome(s.cwd), project: s.project, created: s.created, updated: s.updated,
    lastPrompt: s.lastPrompt, lastReply: s.lastReply, firstPrompt: s.firstPrompt, model: s.model, automated: s.automated,
    pinned: s.pinned, hidden: s.hidden, terminal: s.terminal, running: s.running, live: s.live, unseen: s.unseen, agentName: s.agentName, notify: s.notify || 0,
  };
}
function matches(s, q) {
  if (!q) return true;
  const hay = `${s.title}\n${s.firstPrompt}\n${s.lastPrompt}\n${s.lastReply}\n${s.cwd}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
function resolveCwd(p) {
  if (!p) return null;
  let abs = p.startsWith('~') ? path.join(HOME, p.slice(1)) : p;
  abs = path.resolve(abs);
  if (!abs.startsWith(HOME)) throw new Error('홈 디렉터리 밖은 열 수 없어요');
  return abs;
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

route('GET', '/api/state', async () => ({
  settings: store.getSettings(),
  catalogs: catalogs(),
  vapidPublicKey,
  unread: store.unreadCount(),
  runs: listRuns().filter((r) => r.status === 'running'),
  home: shortHome(HOME),
}));

route('GET', '/api/home', async () => {
  const sessions = await decoratedSessions();
  const projects = await projectsList();
  const settings = store.getSettings();
  const live = sessions.filter((s) => s.live).slice(0, 12);
  const recent = sessions.filter((s) => !s.live).slice(0, 10);
  const pinned = sessions.filter((s) => s.pinned).slice(0, 10);
  const dozing = dozingProjects(projects, settings).slice(0, 8);
  const activeProjects = projects.filter((p) => p.status === 'active').sort((a, b) => b.lastActivity - a.lastActivity).slice(0, 6);
  const week = sessions.filter((s) => Date.now() - s.updated < 7 * DAY);
  return {
    live: live.map(sessionView), recent: recent.map(sessionView), pinned: pinned.map(sessionView),
    dozing, activeProjects,
    stats: { sessions: sessions.length, projects: projects.length, week: week.length, weekProjects: new Set(week.map((s) => s.project)).size },
    runs: listRuns().slice(0, 10), unread: store.unreadCount(),
  };
});

route('GET', '/api/sessions', async (req, url) => {
  const sp = url.searchParams;
  let list = await decoratedSessions({ includeAutomated: sp.get('automated') === '1' ? true : undefined, includeHidden: sp.get('hidden') === '1' });
  const tool = sp.get('tool');
  if (tool) list = list.filter((s) => s.tool === tool);
  const project = sp.get('project');
  if (project) list = list.filter((s) => s.project === project);
  if (sp.get('hidden') === '1') list = list.filter((s) => s.hidden);
  const q = sp.get('q');
  if (q) list = list.filter((s) => matches(s, q));
  list.sort((a, b) => (b.pinned - a.pinned) || (b.live - a.live) || (b.updated - a.updated));
  const offset = Number(sp.get('offset') || 0), limit = Math.min(200, Number(sp.get('limit') || 60));
  return { total: list.length, items: list.slice(offset, offset + limit).map(sessionView) };
});

route('GET', '/api/sessions/:tool/:id', async (req, url, { tool, id }) => {
  const s = await findSession(tool, decodeURIComponent(id));
  if (!s) return [404, { error: '세션을 찾을 수 없어요' }];
  const before = url.searchParams.has('before') ? Number(url.searchParams.get('before')) : null;
  const msgs = await readMessages(s);
  const page = pageMessages(msgs, before, Number(url.searchParams.get('limit') || 80));
  const list = await decoratedSessions({ includeAutomated: true, includeHidden: true });
  const view = list.find((x) => x.key === s.key) || s;
  if (url.searchParams.get('seen') !== '0') store.patchSessionMeta(s.key, { last_seen: Math.max(Date.now(), s.updated) });
  const run = activeRunFor(s.key);
  return { session: sessionView(view), ...page, messages: page.messages.map(slimMessage), run: run ? publicRun(run) : null };
});

route('POST', '/api/sessions/:tool/:id/meta', async (req, url, { tool, id }) => {
  const b = await body(req);
  const patch = {};
  if ('pinned' in b) patch.pinned = Boolean(b.pinned);
  if ('hidden' in b) patch.hidden = Boolean(b.hidden);
  if ('title' in b) patch.title = b.title ? String(b.title).slice(0, 200) : null;
  if ('notify' in b) patch.notify = [0, 1, 2].includes(Number(b.notify)) ? Number(b.notify) : 0;
  return store.patchSessionMeta(`${tool}:${decodeURIComponent(id)}`, patch);
});

// Images from the composer: claude/codex take them as files/blocks from Baton's data dir;
// agy can only read files inside its workspace, so those go to <cwd>/.baton-uploads (git-ignored).
const IMG_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
async function saveImages(tool, cwd, list) {
  if (!Array.isArray(list) || !list.length) return [];
  if (list.length > 8) throw new Error('이미지는 한 번에 8장까지 보낼 수 있어요');
  const dir = tool === 'agy' ? path.join(cwd, '.baton-uploads') : path.join(ROOT, 'data', 'uploads', new Date().toISOString().slice(0, 10));
  await fsp.mkdir(dir, { recursive: true });
  if (tool === 'agy') await fsp.writeFile(path.join(dir, '.gitignore'), '*\n').catch(() => {});
  const out = [];
  for (const im of list) {
    const ext = IMG_EXT[im?.mime];
    if (!ext || typeof im.data !== 'string') throw new Error('지원하지 않는 이미지 형식이에요');
    const buf = Buffer.from(im.data, 'base64');
    if (buf.length > 12e6) throw new Error('이미지가 너무 커요');
    const file = path.join(dir, `img-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}.${ext}`);
    await fsp.writeFile(file, buf);
    out.push({ path: file, mime: im.mime });
  }
  return out;
}

route('POST', '/api/run', async (req) => {
  const b = await body(req);
  let cwd = null, title = null;
  if (b.sessionId) {
    const s = await findSession(b.tool, b.sessionId);
    if (!s) return [404, { error: '세션을 찾을 수 없어요' }];
    cwd = s.cwd && fs.existsSync(s.cwd) ? s.cwd : (s.project || HOME);
    title = s.title;
  } else {
    cwd = resolveCwd(b.cwd || '~/workspace');
    if (!fs.existsSync(cwd)) {
      if (!b.mkdir) return [400, { error: `폴더가 없어요: ${shortHome(cwd)}` }];
      await fsp.mkdir(cwd, { recursive: true });
    }
    title = clip(b.prompt, 60);
  }
  let images = [];
  try { images = await saveImages(b.tool, cwd, b.images); } catch (e) { return [400, { error: e.message }]; }
  try {
    const run = startRun({ tool: b.tool, sessionId: b.sessionId || null, cwd, prompt: String(b.prompt || ''), model: b.model || null, effort: b.effort || null, perm: b.perm || store.getSettings().defaultPerm, title, images });
    return { run: publicRun(run) };
  } catch (e) {
    return [e.code === 'BUSY' ? 409 : 400, { error: e.message, runId: e.runId }];
  }
});

route('GET', '/api/runs', async () => ({ runs: listRuns() }));
route('POST', '/api/runs/:id/stop', async (req, url, { id }) => ({ ok: stopRun(id) }));

route('GET', '/api/projects', async () => {
  const projects = await projectsList();
  projects.sort((a, b) => (b.pinned - a.pinned) || (b.lastActivity - a.lastActivity));
  return { items: projects, dozing: dozingProjects(projects).map((p) => p.id) };
});

route('GET', '/api/projects/:pid', async (req, url, { pid }) => {
  const id = decodeURIComponent(pid);
  const projects = await projectsList();
  const p = projects.find((x) => x.id === id);
  if (!p) return [404, { error: '프로젝트를 찾을 수 없어요' }];
  const all = await decoratedSessions({ includeAutomated: url.searchParams.get('automated') === '1' });
  const sessions = all.filter((s) => s.project === id).map(sessionView);
  const brief = store.getBrief(id);
  return { project: p, sessions, git: await gitInfo(id), brief, briefStale: !brief || brief.fingerprint !== projectFingerprint(p), briefPending: briefPending(id) };
});

route('POST', '/api/projects/:pid/meta', async (req, url, { pid }) => {
  const id = decodeURIComponent(pid);
  const b = await body(req);
  const patch = {};
  if (b.status && ['active', 'paused', 'done', 'archived'].includes(b.status)) patch.status = b.status;
  if ('name' in b) patch.name = b.name ? String(b.name).slice(0, 80) : null;
  if ('pinned' in b) patch.pinned = Boolean(b.pinned);
  if ('note' in b) patch.note = b.note ? String(b.note).slice(0, 2000) : null;
  if ('snoozeDays' in b) patch.snooze_until = b.snoozeDays ? Date.now() + Number(b.snoozeDays) * DAY : null;
  if (b.status === 'active') patch.snooze_until = patch.snooze_until ?? null;
  return store.patchProjectMeta(id, patch);
});

route('POST', '/api/projects/:pid/brief', async (req, url, { pid }) => {
  const id = decodeURIComponent(pid);
  const p = (await projectsList()).find((x) => x.id === id);
  if (!p) return [404, { error: '프로젝트를 찾을 수 없어요' }];
  try {
    return { brief: await ensureBrief(p, { force: url.searchParams.get('force') === '1' }) };
  } catch (e) {
    return [500, { error: e.message }];
  }
});

route('GET', '/api/dirs', async (req, url) => {
  const q = (url.searchParams.get('q') || '').toLowerCase();
  const projects = await projectsList();
  const seen = new Set();
  const out = [];
  for (const p of projects.sort((a, b) => b.lastActivity - a.lastActivity)) {
    if (q && !p.id.toLowerCase().includes(q) && !p.name.toLowerCase().includes(q)) continue;
    seen.add(p.id);
    out.push({ path: shortHome(p.id), name: p.name, known: true, lastActivity: p.lastActivity });
    if (out.length >= 30) break;
  }
  for (const rootRaw of store.getSettings().workspaceRoots) {
    const root = resolveCwd(rootRaw);
    const walk = async (dir, depth) => {
      if (depth > 2 || out.length >= 60) return;
      let ents = [];
      try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
        const full = path.join(dir, e.name);
        if (!seen.has(full) && (!q || full.toLowerCase().includes(q))) { seen.add(full); out.push({ path: shortHome(full), name: e.name, known: false }); }
        await walk(full, depth + 1);
      }
    };
    await walk(root, 0);
  }
  return { items: out.slice(0, 60) };
});

route('GET', '/api/events', async () => ({ items: store.listEvents(60), unread: store.unreadCount() }));
route('POST', '/api/events/read', async () => { store.markEventsRead(); return { ok: true }; });

route('POST', '/api/push/subscribe', async (req) => { const b = await body(req); if (!b?.endpoint) return [400, { error: 'bad subscription' }]; store.addPushSub(b); return { ok: true }; });
route('POST', '/api/push/unsubscribe', async (req) => { const b = await body(req); store.removePushSub(b.endpoint); return { ok: true }; });
route('POST', '/api/push/test', async () => ({ sent: await notify({ kind: 'test', title: '🏃 Baton 알림 테스트', body: '알림이 잘 도착했어요!', url: '/#/' }) }));
route('POST', '/api/nudge/now', async () => ({ nudge: await sendNudge({ ignoreCooldown: true }) }));

route('GET', '/api/usage', async () => usageReport());

// ---------- cleanup / trash ----------
route('GET', '/api/cleanup', async () => {
  const all = await decoratedSessions({ includeAutomated: true, includeHidden: true });
  const items = [];
  for (const s of all) { const reason = cleanupReason(s); if (reason) items.push({ ...s, reason }); }
  return { items };
});
route('POST', '/api/sessions/trash', async (req) => {
  const b = await body(req);
  const keys = Array.isArray(b.keys) ? b.keys.slice(0, 2000) : [];
  const snap = await getSnapshot(0);
  const all = new Map((await decoratedSessions({ includeAutomated: true, includeHidden: true })).map((s) => [s.key, s]));
  let moved = 0; const errors = [];
  for (const key of keys) {
    const s = snap.byKey.get(key);
    const d = all.get(key);
    if (!s) continue;
    if (d?.live || d?.running) { errors.push(`${d.title}: 실행 중이라 건너뛰었어요`); continue; }
    try { await trashSession({ ...s, title: d?.title || s.title }); moved++; } catch (e) { errors.push(`${s.title}: ${e.message}`); }
  }
  await forceRefresh();
  return { moved, errors };
});
route('GET', '/api/trash', async () => ({ items: listTrash() }));
route('POST', '/api/trash/restore', async (req) => {
  const b = await body(req);
  for (const k of b.keys || []) await restoreSession(k);
  await forceRefresh();
  return { ok: true };
});
route('POST', '/api/trash/empty', async () => ({ removed: await emptyTrash(0) }));

// ---------- ports / skills ----------
route('GET', '/api/ports', async () => listPorts());
route('POST', '/api/ports/:port/share', async (req, url, { port }) => shareToPhone(port));
route('POST', '/api/ports/:port/unshare', async (req, url, { port }) => { await unshare(port); return { ok: true }; });
route('POST', '/api/pids/:pid/stop', async (req, url, { pid }) => stopPort(pid));
route('GET', '/api/skills', async () => skillsReport());
route('GET', '/api/skills/:id', async (req, url, { id }) => (await skillDetail(id)) || [404, { error: '스킬을 찾을 수 없어요' }]);
route('GET', '/api/limits', async (req, url) => allLimits({ force: url.searchParams.get('force') === '1' }));
route('GET', '/api/settings', async () => store.getSettings());
route('POST', '/api/settings', async (req) => store.updateSettings(await body(req)));
route('POST', '/api/refresh', async () => { await forceRefresh(); return { ok: true }; });

// ---------- SSE for runs ----------
function streamRun(req, res, id, from) {
  const run = getRun(id);
  if (!run) { send(res, 404, { error: 'run not found' }); return; }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write(`event: meta\ndata: ${JSON.stringify(publicRun(run))}\n\n`);
  const write = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  // Replay, merging consecutive text deltas so reconnects are cheap.
  let merged = null;
  for (const ev of run.events.slice(Math.max(0, from))) {
    if (ev.t === 'text') { if (merged) merged.text += ev.text; else merged = { ...ev }; merged.i = ev.i; continue; }
    if (merged) { write(merged); merged = null; }
    write(ev);
  }
  if (merged) write(merged);
  if (run.status !== 'running') { res.end(); return; }
  const listener = (ev) => { write(ev); if (ev.t === 'done') res.end(); };
  run.listeners.add(listener);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => { clearInterval(ping); run.listeners.delete(listener); });
}

// ---------- notifications on run completion ----------
bus.on('run_end', (run) => {
  const settings = store.getSettings();
  const watching = run.listeners.size > 0;
  const url = run.sessionId ? `/#/s/${run.tool}/${encodeURIComponent(run.sessionId)}` : '/#/';
  const label = clip(run.title || run.prompt, 40);
  const ok = run.status === 'done';
  const title = ok ? `✅ ${label}` : `⚠️ ${label}`;
  const res = run.events.findLast?.((e) => e.t === 'done');
  const bodyText = ok ? clip((res?.result || '응답이 끝났어요').replace(/\s+/g, ' '), 140) : clip(run.error || '실패했어요', 140);
  if (settings.notifyOnRunDone && !watching) notify({ kind: ok ? 'run_done' : 'run_error', title, body: bodyText, url, tag: `run-${run.sessionId || run.id}` }).catch(() => {});
  else store.addEvent(ok ? 'run_done' : 'run_error', title, bodyText, url);
  forceRefresh().catch(() => {});
  observeRun(run);
});

// ---------- static ----------
async function serveStatic(req, res, pathname) {
  let file = VENDOR[pathname];
  if (!file) {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    file = path.join(PUBLIC, path.normalize(rel));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  }
  try {
    const data = await fsp.readFile(file);
    const ext = path.extname(file);
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' || pathname === '/sw.js' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(data);
  } catch {
    // SPA fallback
    const data = await fsp.readFile(path.join(PUBLIC, 'index.html'));
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
    res.end(data);
  }
}

const server = http.createServer(async (req, res) => {
  if (!authorized(req)) { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('forbidden'); return; }
  if (req.headers['tailscale-user-login'] && req.headers.host) setPublicOrigin(`https://${req.headers['x-forwarded-host'] || req.headers.host}`);
  const url = new URL(req.url, 'http://x');
  try {
    const m = url.pathname.match(/^\/api\/runs\/([^/]+)\/stream$/);
    if (m && req.method === 'GET') return streamRun(req, res, m[1], Number(url.searchParams.get('from') || 0));
    if (url.pathname.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const mm = url.pathname.match(r.re);
        if (!mm) continue;
        const out = await r.fn(req, url, mm.groups || {});
        if (Array.isArray(out)) return send(res, out[0], out[1]);
        return send(res, 200, out);
      }
      return send(res, 404, { error: 'not found' });
    }
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error('[http]', req.method, url.pathname, e);
    if (!res.headersSent) send(res, 500, { error: e.message });
    else res.end();
  }
});

server.listen(PORT, HOST, async () => {
  console.log(`[baton] listening on http://${HOST}:${PORT}`);
  const t = Date.now();
  const snap = await getSnapshot(0);
  console.log(`[baton] indexed ${snap.sessions.length} sessions in ${Date.now() - t}ms`);
  startNudgeScheduler();
  startWatcher();
  startTrashPurge();
  startUsageScheduler();
  seedDefaults();
});

// keep the index warm so the UI is instant
setInterval(() => { getSnapshot(15000).catch(() => {}); }, 20000).unref();
export { projectRoot };
