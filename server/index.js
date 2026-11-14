// Baton — HTTP server (JSON API + SSE + static PWA).
import { envInfo } from './env.js'; // must stay first: imports the login shell's environment
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ROOT, HOME, DAY, clip, shortHome } from './util.js';
import * as store from './store.js';
import { decoratedSessions, projectsList, findSession, readMessages, getSnapshot, forceRefresh } from './indexer.js';
import { gitInfo, projectRoot, projectFingerprint } from './projects.js';
import { startRun, getRun, stopRun, answerRun, listRuns, publicRun, activeRunFor, bus } from './runner.js';
import { catalogs, fromLine } from './models.js';
import { schedule, listScheduled, cancelScheduled, nextReset, startScheduler } from './schedule.js';
import { vapidPublicKey, notify, setPublicOrigin } from './push.js';
import { allLimits } from './limits.js';
import { trashSession, restoreSession, listTrash, emptyTrash, startTrashPurge, cleanupReason } from './trash.js';
import { startWatcher } from './watch.js';
import { listPorts, listPortsCached, invalidatePorts, shareToPhone, unshare, stopPort } from './ports.js';
import { listServers, startServer, stopServer, removeServer, addServer, serverLogs, observe as observeServers, startServerWatch } from './servers.js';
import { projectServices, reposReport, addLink, removeLink } from './links.js';
import { skillsReport, skillDetail, pickableSkills, projectSkills } from './skills.js';
import { targetsPreview, startDraft, draftStatus, cancelDraft, saveSkill, skillSource, copySkill, deleteSkill } from './skill-create.js';
import { mentionFiles } from './mention.js';
import { mcpReport, mcpDetail, mcpEffective, checkMcp, invalidateMcp, mcpForPicker } from './mcp.js';
import { setupStatus, startJob, getJob, jobInput, stopJob, publicJob, runningJobs } from './setup.js';
import { handoff, linksOf, buildHandoffNote } from './handoff.js';
import { moveSession, folderSuggestions, consumeMoveNote, startPendingMoves, TERMINAL_MOVE } from './move.js';
import { isLocal, authorized } from './auth.js';
import { toolsMeta, binFor, TOOL_IDS } from './tools.js';
import { OS_NAME, openBrowser } from './platform.js';
import { tr, lang } from './i18n.js';
import { providersSummary, resetProviderCache } from './providers.js';
import { connect, testConnection, probeModels, findLocalLlms } from './connect.js';
import { presets as mcpPresets, addMcp, copyMcp, removeMcp, planInstall, previewInstall } from './mcp-install.js';
import { startMcpDraft, startInstall, mcpJob, cancelMcpJob, testExisting } from './mcp-create.js';
import { qrSvg } from './qr.js';
import { checkUpdate, updateCached, restartSelf } from './update.js';
import crypto from 'node:crypto';
import { ensureBrief, briefPending } from './brief.js';
import { dozingProjects, sendNudge, startNudgeScheduler } from './nudge.js';
import { startCompatWatch } from './compat-watch.js';
import { pageMessages, slimMessage } from './sources/common.js';
import { usageReport, startUsageScheduler } from './usage.js';
import { observeRun, seedDefaults } from './observe.js';
import { readClaudeImage } from './sources/claude-images.js';

import { PORT, setPort } from './runtime.js';
import { listenerConfig, listen } from './listener.js';
const listener = listenerConfig(ROOT);
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
function sessionView(s) {
  return {
    key: s.key, tool: s.tool, id: s.id, title: s.title, cwd: shortHome(s.cwd), project: s.project, created: s.created, updated: s.updated,
    lastPrompt: s.lastPrompt, lastReply: s.lastReply, firstPrompt: s.firstPrompt, model: s.model, automated: s.automated, delegated: s.delegated, background: Boolean(s.background),
    origCwd: s.moved ? shortHome(s.origCwd) : null, moved: Boolean(s.moved),
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
  if (path.relative(HOME, abs).split(path.sep)[0] === '..' || path.isAbsolute(path.relative(HOME, abs))) throw new Error(tr('홈 디렉터리 밖은 열 수 없어요'));
  return abs;
}

function defaultCwd() {
  return store.getSettings().defaultCwd || (fs.statSync(path.join(HOME, 'workspace'), { throwIfNoEntry: false })?.isDirectory() ? '~/workspace' : '~');
}

const BOOT = Date.now();
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '?'; } })();

// ---------- routes ----------
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

route('GET', '/api/state', async () => ({
  settings: store.getSettings(),
  catalogs: catalogs(),
  vapidPublicKey,
  unread: store.unreadCount(),
  lastEventId: store.lastEventId(),
  runs: listRuns().filter((r) => r.status === 'running'),
  home: shortHome(HOME),
  tools: toolsMeta().map((t) => ({ ...t, installed: Boolean(binFor(t.id)) })),
  defaultCwd: defaultCwd(),
  version: VERSION,
  boot: BOOT, // changes on every start: lets the page tell a restarted server from the old one
  update: updateCached(),
  os: OS_NAME,
}));

// ---------- CLI environment (company setups: Bedrock, gateways, proxies…) ----------
const SECRET_KEY = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH/i;
const ENV_HINT = /^(CLAUDE_|ANTHROPIC_|AWS_|CLOUD_ML|GOOGLE_|VERTEX|AZURE_|OPENAI_|CODEX_|GEMINI_|OPENCODE|CURSOR_|HTTPS?_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS|SSL_CERT|REQUESTS_CA)/i;
route('GET', '/api/env', async () => {
  const extra = store.getKV('extra_env', {}) || {};
  return {
    shell: envInfo.shell, shellError: envInfo.error,
    imported: envInfo.imported.filter((k) => ENV_HINT.test(k)).sort(),
    extraText: Object.entries(extra).map(([k, v]) => `${k}=${SECRET_KEY.test(k) ? '__KEEP__' : v}`).join('\n'),
    providers: await providersSummary(),
  };
});
route('POST', '/api/env', async (req) => {
  const b = await body(req);
  const prev = store.getKV('extra_env', {}) || {};
  const next = {};
  for (const raw of String(b.text || '').split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i <= 0) return [400, { error: tr('이 줄을 읽을 수 없어요: {line}', { line: clip(line, 60) }) }];
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) return [400, { error: tr('변수 이름이 올바르지 않아요: {k}', { k }) }];
    if (v === '__KEEP__') v = prev[k] ?? '';
    next[k] = v;
  }
  for (const k of Object.keys(prev)) if (!(k in next)) delete process.env[k];
  for (const [k, v] of Object.entries(next)) process.env[k] = v;
  store.setKV('extra_env', next);
  resetProviderCache();
  return { ok: true, keys: Object.keys(next), providers: await providersSummary() };
});

// ---------- connect without a subscription (API keys, Bedrock, Vertex, gateways, own servers) ----------
route('POST', '/api/setup/connect', async (req) => {
  const b = await body(req);
  try { return { ok: true, ...(await connect(String(b.tool), String(b.kind), b.fields || {})), providers: await providersSummary() }; }
  catch (e) { return [400, { error: e.message }]; }
});
route('POST', '/api/setup/test', async (req) => {
  const b = await body(req);
  try { return await testConnection(String(b.tool)); } catch (e) { return [400, { error: e.message }]; }
});

// ---------- setup / onboarding ----------
route('GET', '/api/setup', async (req, url) => ({ ...(await setupStatus({ fresh: url.searchParams.get('fresh') === '1' })), local: isLocal(req) }));
route('POST', '/api/setup/probe', async (req) => {
  const b = await body(req);
  try { return await probeModels(b.baseUrl, b.apiKey); } catch (e) { return [400, { error: e.message }]; }
});
route('GET', '/api/setup/local-llms', async () => findLocalLlms());
// QR code for "scan this with your phone" (SVG built here, no third-party service sees the address)
route('GET', '/api/update', async () => checkUpdate());
route('POST', '/api/update/check', async () => checkUpdate({ force: true }));
route('POST', '/api/update/restart', async () => { restartSelf(server); return { ok: true }; });
route('GET', '/api/qr', async (req, url) => {
  const text = url.searchParams.get('text') || '';
  if (!text || text.length > 600) return [400, { error: 'text required' }];
  return { svg: qrSvg(text) };
});
route('POST', '/api/setup/jobs', async (req) => {
  const b = await body(req);
  try { return { job: publicJob(await startJob(String(b.action || ''), b.tool || null)) }; }
  catch (e) { return [400, { error: e.message }]; }
});
route('GET', '/api/setup/jobs', async () => ({ jobs: runningJobs() }));
route('POST', '/api/setup/jobs/:id/input', async (req, url, { id }) => ({ ok: jobInput(id, (await body(req)).text || '') }));
route('POST', '/api/setup/jobs/:id/stop', async (req, url, { id }) => ({ ok: stopJob(id) }));

route('GET', '/api/home', async () => {
  const sessions = await decoratedSessions();
  const projects = await projectsList();
  const settings = store.getSettings();
  const live = sessions.filter((s) => s.live).slice(0, 12);
  // Automated runs (CLI sub-sessions, scripts) are not "where I left off": they stay in the Sessions tab, not here.
  const recent = sessions.filter((s) => !s.live && !s.automated).slice(0, 10);
  const autoCount = sessions.filter((s) => s.automated).length;
  const pinned = sessions.filter((s) => s.pinned).slice(0, 10);
  const dozing = dozingProjects(projects, settings).slice(0, 8);
  const activeProjects = projects.filter((p) => p.status === 'active').sort((a, b) => b.lastActivity - a.lastActivity).slice(0, 6);
  const week = sessions.filter((s) => !s.automated && Date.now() - s.updated < 7 * DAY);
  return {
    live: live.map(sessionView), recent: recent.map(sessionView), pinned: pinned.map(sessionView),
    dozing, activeProjects, autoCount,
    stats: { sessions: sessions.length, projects: projects.length, week: week.length, weekProjects: new Set(week.map((s) => s.project)).size },
    runs: listRuns().slice(0, 10), unread: store.unreadCount(),
  };
});

route('GET', '/api/sessions', async (req, url) => {
  const sp = url.searchParams;
  let list = await decoratedSessions({ includeHidden: sp.get('hidden') === '1' });
  const tool = sp.get('tool');
  if (tool) list = list.filter((s) => s.tool === tool);
  const project = sp.get('project');
  if (project) list = list.filter((s) => s.project === project);
  if (sp.get('hidden') === '1') list = list.filter((s) => s.hidden);
  if (sp.get('automated') === '1') list = list.filter((s) => s.automated);
  const q = sp.get('q');
  if (q) list = list.filter((s) => matches(s, q));
  list.sort((a, b) => (b.pinned - a.pinned) || (b.live - a.live) || (b.updated - a.updated));
  const offset = Number(sp.get('offset') || 0), limit = Math.min(200, Number(sp.get('limit') || 60));
  return { total: list.length, items: list.slice(offset, offset + limit).map(sessionView) };
});

route('GET', '/api/sessions/:tool/:id', async (req, url, { tool, id }) => {
  const s = await findSession(tool, decodeURIComponent(id));
  if (!s) return [404, { error: tr('세션을 찾을 수 없어요') }];
  const before = url.searchParams.has('before') ? Number(url.searchParams.get('before')) : null;
  const msgs = await readMessages(s);
  const page = pageMessages(msgs, before, Number(url.searchParams.get('limit') || 80));
  const list = await decoratedSessions({ includeHidden: true });
  const view = list.find((x) => x.key === s.key) || s;
  if (url.searchParams.get('seen') !== '0') store.patchSessionMeta(s.key, { last_seen: Math.max(Date.now(), s.updated) });
  const run = activeRunFor(s.key);
  const byKey = new Map(list.map((x) => [x.key, x]));
  const lk = linksOf(s.key);
  const describe = (l) => { const x = byKey.get(l.key); const [tool, ...rest] = l.key.split(':'); return { key: l.key, tool, id: rest.join(':'), title: x?.title || null, created: l.created }; };
  const links = { from: lk.from.map(describe), to: lk.to.map(describe) };
  return { session: sessionView(view), ...page, messages: page.messages.map((message) => {
    const { imageRefs, ...m } = slimMessage(message);
    return { ...m, ...(imageRefs?.length ? { imageUrls: imageRefs.map((ref) => `/api/sessions/claude/${encodeURIComponent(s.id)}/images/${ref}`) } : {}) };
  }), run: run ? publicRun(run) : null, outcome: run ? null : store.getRunOutcome(s.key), links };
});

// dismiss the "last run hit the limit / was blocked / failed" card in a chat
route('DELETE', '/api/sessions/:tool/:id/outcome', async (req, url, { tool, id }) => {
  store.clearRunOutcome(`${tool}:${decodeURIComponent(id)}`);
  return { ok: true };
});

route('POST', '/api/sessions/:tool/:id/meta', async (req, url, { tool, id }) => {
  const b = await body(req);
  const patch = {};
  if ('pinned' in b) patch.pinned = Boolean(b.pinned);
  if ('hidden' in b) patch.hidden = Boolean(b.hidden);
  if ('title' in b) patch.title = b.title ? String(b.title).slice(0, 200) : null;
  if ('notify' in b) patch.notify = Number(b.notify) < 0 ? -1 : 0; // -1 = muted, 0 = default (notify)
  return store.patchSessionMeta(`${tool}:${decodeURIComponent(id)}`, patch);
});

// Images from the composer: claude/codex take them as files/blocks from Baton's data dir;
// agy can only read files inside its workspace, so those go to <cwd>/.baton-uploads (git-ignored).
const IMG_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
async function saveImages(tool, cwd, list) {
  if (!Array.isArray(list) || !list.length) return [];
  if (list.length > 8) throw new Error(tr('이미지는 한 번에 8장까지 보낼 수 있어요'));
  const dir = tool === 'agy' ? path.join(cwd, '.baton-uploads') : path.join(ROOT, 'data', 'uploads', new Date().toISOString().slice(0, 10));
  await fsp.mkdir(dir, { recursive: true });
  if (tool === 'agy') await fsp.writeFile(path.join(dir, '.gitignore'), '*\n').catch(() => {});
  const out = [];
  for (const im of list) {
    const ext = IMG_EXT[im?.mime];
    if (!ext || typeof im.data !== 'string') throw new Error(tr('지원하지 않는 이미지 형식이에요'));
    const buf = Buffer.from(im.data, 'base64');
    if (buf.length > 12e6) throw new Error(tr('이미지가 너무 커요'));
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
    if (!s) return [404, { error: tr('세션을 찾을 수 없어요') }];
    cwd = s.cwd && fs.existsSync(s.cwd) ? s.cwd : (s.project || HOME);
    title = s.title;
  } else {
    cwd = resolveCwd(b.cwd || defaultCwd());
    if (!fs.existsSync(cwd)) {
      if (!b.mkdir) return [400, { error: tr('폴더가 없어요: {p}', { p: shortHome(cwd) }), code: 'NO_DIR' }];
      await fsp.mkdir(cwd, { recursive: true });
    }
    title = clip(b.prompt, 60);
  }
  let images = [];
  try { images = await saveImages(b.tool, cwd, b.images); } catch (e) { return [400, { error: e.message }]; }
  try {
    const prompt0 = String(b.prompt || '');
    const run = startRun({ tool: b.tool, sessionId: b.sessionId || null, cwd, prompt: b.sessionId ? consumeMoveNote(`${b.tool}:${b.sessionId}`, prompt0) : prompt0, model: b.model || null, effort: b.effort || null, perm: b.perm || store.getSettings().defaultPerm, title, images });
    return { run: publicRun(run) };
  } catch (e) {
    return [e.code === 'BUSY' ? 409 : 400, { error: e.message, runId: e.runId }];
  }
});

route('GET', '/api/runs', async () => ({ runs: listRuns() }));
route('POST', '/api/runs/:id/stop', async (req, url, { id }) => ({ ok: stopRun(id) }));
route('POST', '/api/runs/:id/answer', async (req, url, { id }) => { const b = await body(req); return answerRun(id, String(b.requestId || ''), b.answers && typeof b.answers === 'object' ? b.answers : null) ? { ok: true } : [409, { error: tr('이미 답했거나 끝난 질문이에요') }]; });

route('GET', '/api/projects', async () => {
  const projects = await projectsList();
  projects.sort((a, b) => (b.pinned - a.pinned) || (b.lastActivity - a.lastActivity));
  return { items: projects, dozing: dozingProjects(projects).map((p) => p.id) };
});

route('GET', '/api/projects/:pid', async (req, url, { pid }) => {
  const id = decodeURIComponent(pid);
  const projects = await projectsList();
  const p = projects.find((x) => x.id === id);
  if (!p) return [404, { error: tr('프로젝트를 찾을 수 없어요') }];
  const all = await decoratedSessions();
  const sessions = all.filter((s) => s.project === id).map(sessionView);
  const brief = store.getBrief(id);
  const [git, services, servers] = await Promise.all([gitInfo(id), projectServices(id).catch(() => []), listServers({ project: id }).catch(() => [])]);
  return { project: p, sessions, git, services, servers, brief, briefStale: !brief || brief.fingerprint !== projectFingerprint(p), briefPending: briefPending(id) };
});

route('POST', '/api/projects/:pid/meta', async (req, url, { pid }) => {
  const id = decodeURIComponent(pid);
  const b = await body(req);
  const patch = {};
  if (b.status && ['active', 'paused', 'done', 'archived'].includes(b.status)) patch.status = b.status;
  if ('name' in b) patch.name = b.name ? String(b.name).slice(0, 80) : null;
  if ('pinned' in b) patch.pinned = Boolean(b.pinned);
  if ('note' in b) patch.note = b.note ? String(b.note).slice(0, 2000) : null;
  if ('muted' in b) patch.muted = Boolean(b.muted);
  if ('snoozeDays' in b) patch.snooze_until = b.snoozeDays ? Date.now() + Number(b.snoozeDays) * DAY : null;
  if (b.status === 'active') patch.snooze_until = patch.snooze_until ?? null;
  return store.patchProjectMeta(id, patch);
});

route('GET', '/api/projects/:pid/skills', async (req, url, { pid }) => {
  const id = decodeURIComponent(pid);
  if (!(await projectsList()).some((x) => x.id === id)) return [404, { error: tr('프로젝트를 찾을 수 없어요') }];
  return projectSkills(id);
});

route('POST', '/api/projects/:pid/brief', async (req, url, { pid }) => {
  const id = decodeURIComponent(pid);
  const p = (await projectsList()).find((x) => x.id === id);
  if (!p) return [404, { error: tr('프로젝트를 찾을 수 없어요') }];
  try {
    return { brief: await ensureBrief(p, { force: url.searchParams.get('force') === '1' }) };
  } catch (e) {
    return [500, { error: e.message }];
  }
});

// Browse directories on the Baton host, restricted to the user's real home tree.
route('GET', '/api/dirs/browse', async (req, url) => {
  try {
    const dir = resolveCwd(url.searchParams.get('path') || defaultCwd());
    const home = await fsp.realpath(HOME);
    const inside = (p) => { const rel = path.relative(home, p); return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
    if (!inside(await fsp.realpath(dir))) return [403, { error: tr('홈 디렉터리 밖은 열 수 없어요') }];
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const items = (await Promise.all(entries.filter((e) => e.isDirectory() || e.isSymbolicLink()).map(async (e) => {
      const full = path.join(dir, e.name);
      try {
        if (!inside(await fsp.realpath(full)) || !(await fsp.stat(full)).isDirectory()) return null;
        return { name: e.name, path: shortHome(full), hidden: e.name.startsWith('.') };
      } catch { return null; }
    }))).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
    return { path: shortHome(dir), parent: dir === HOME ? null : shortHome(path.dirname(dir)), items };
  } catch (e) {
    return [400, { error: tr('폴더를 열 수 없어요. 경로와 접근 권한을 확인해주세요'), code: e.code || 'INVALID_PATH' }];
  }
});

// @ picker in the chat composer: files, folders and skills for this chat's folder (names only, never contents).
route('GET', '/api/mention', async (req, url) => {
  const tool = url.searchParams.get('tool');
  if (!TOOL_IDS.includes(tool)) return [400, { error: 'unknown tool' }];
  let cwd;
  const sid = url.searchParams.get('session');
  try {
    if (sid) { // same folder rule as /api/run
      const s = await findSession(tool, sid);
      if (!s) return [404, { error: tr('세션을 찾을 수 없어요') }];
      cwd = s.cwd && fs.existsSync(s.cwd) ? s.cwd : (s.project || HOME);
    } else cwd = resolveCwd(url.searchParams.get('cwd') || defaultCwd());
    const home = await fsp.realpath(HOME);
    const real = await fsp.realpath(cwd);
    const rel = path.relative(home, real);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return [403, { error: tr('홈 디렉터리 밖은 열 수 없어요') }];
    if (!(await fsp.stat(real)).isDirectory()) throw new Error('not a dir');
  } catch { return { files: [], dirs: [], skills: [], others: [], mcp: [], truncated: false }; } // folder not created yet / gone
  const isHome = path.resolve(cwd) === path.resolve(HOME);
  const [f, sk] = await Promise.all([
    isHome ? { files: [], dirs: [], truncated: true } : mentionFiles(cwd), // the whole home tree is too big to list
    pickableSkills(tool, cwd, projectRoot(cwd)),
  ]);
  let mcp = [];
  try { mcp = mcpForPicker(tool, cwd); } catch { /* unreadable config */ }
  return { ...f, ...sk, mcp };
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
  for (const rootRaw of new Set([defaultCwd(), ...store.getSettings().workspaceRoots])) {
    let root;
    try { root = resolveCwd(rootRaw); } catch { continue; }
    const walk = async (dir, depth) => {
      if (depth > 2 || out.length >= 60) return;
      let ents = [];
      try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (out.length >= 60) break;
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
route('GET', '/api/events/after/:id', async (req, url, { id }) => ({ items: store.eventsAfter(Number(id) || 0) }));
route('POST', '/api/events/read', async () => { store.markEventsRead(); return { ok: true }; });

route('POST', '/api/push/subscribe', async (req) => { const b = await body(req); if (!b?.endpoint) return [400, { error: 'bad subscription' }]; store.addPushSub(b); return { ok: true }; });
route('POST', '/api/push/unsubscribe', async (req) => { const b = await body(req); store.removePushSub(b.endpoint); return { ok: true }; });
route('POST', '/api/push/test', async () => ({ sent: await notify({ kind: 'test', title: tr('🏃 Baton 알림 테스트'), body: tr('알림이 잘 도착했어요!'), url: '/#/' }) }));
route('POST', '/api/nudge/now', async () => ({ nudge: await sendNudge({ ignoreCooldown: true }) }));

route('GET', '/api/usage', async () => usageReport());

// ---------- move a session to another working folder ----------
route('GET', '/api/sessions/:tool/:id/folders', async (req, url, { tool, id }) => {
  const s = await findSession(tool, decodeURIComponent(id));
  if (!s) return [404, { error: tr('세션을 찾을 수 없어요') }];
  return { current: shortHome(s.cwd), original: shortHome(s.origCwd || s.cwd), moved: Boolean(s.moved), terminalMove: TERMINAL_MOVE.has(tool), suggestions: await folderSuggestions(s) };
});
route('POST', '/api/sessions/:tool/:id/move', async (req, url, { tool, id }) => {
  const b = await body(req);
  const sid = decodeURIComponent(id);
  const d = (await decoratedSessions({ includeHidden: true })).find((x) => x.key === `${tool}:${sid}`);
  try { return await moveSession({ tool, id: sid, cwd: b.cwd, live: Boolean(d?.live || d?.running) }); }
  catch (e) { return [400, { error: e.message }]; }
});

// ---------- scheduled messages (send when the limit resets) ----------
route('GET', '/api/scheduled', async (req, url) => ({ items: listScheduled({ key: url.searchParams.get('key'), all: url.searchParams.get('all') === '1' }) }));
route('GET', '/api/scheduled/reset/:tool', async (req, url, { tool }) => ({ reset: await nextReset(tool, { force: true }).catch(() => null) }));
route('POST', '/api/scheduled', async (req) => {
  const b = await body(req);
  try { return { item: await schedule({ tool: b.tool, sessionId: b.sessionId, prompt: b.prompt, model: b.model, effort: b.effort, perm: b.perm, when: b.when, at: b.at }) }; }
  catch (e) { return [400, { error: e.message }]; }
});
route('POST', '/api/scheduled/:id/cancel', async (req, url, { id }) => { cancelScheduled(id); return { ok: true }; });

// ---------- handoff between CLIs ----------
route('POST', '/api/handoff', async (req) => {
  const b = await body(req);
  try {
    const r2 = await handoff({
      fromTool: b.fromTool, fromId: b.fromId, toTool: b.toTool, toSessionId: b.toSessionId || null,
      prompt: String(b.prompt || ''), model: b.model || null, effort: b.effort || null, perm: b.perm || store.getSettings().defaultPerm,
      mode: b.mode === 'summary' ? 'summary' : 'extract',
    });
    const { run, note } = r2;
    return { run: publicRun(run), note, summarized: r2.summarized, summaryFailed: r2.summaryFailed };
  } catch (e) { return [e.code === 'BUSY' ? 409 : 400, { error: e.message }]; }
});
route('GET', '/api/handoff/preview/:tool/:id', async (req, url, { tool, id }) => {
  const s = await findSession(tool, decodeURIComponent(id));
  if (!s) return [404, { error: tr('세션을 찾을 수 없어요') }];
  return { note: await buildHandoffNote(s, await readMessages(s)) };
});

// ---------- cleanup / trash ----------
route('GET', '/api/cleanup', async () => {
  const all = await decoratedSessions({ includeHidden: true });
  const items = [];
  for (const s of all) { if (s.hidden) continue; const reason = cleanupReason(s); if (reason) items.push({ ...s, reason }); }
  return { items };
});
route('POST', '/api/sessions/hide', async (req) => {
  const b = await body(req);
  const keys = Array.isArray(b.keys) ? b.keys.filter((k) => typeof k === 'string').slice(0, 5000) : [];
  const hidden = b.hidden !== false;
  store.patchSessionMetaMany(keys, { hidden });
  await forceRefresh();
  return { changed: keys.length };
});
route('POST', '/api/sessions/trash', async (req) => {
  const b = await body(req);
  const keys = Array.isArray(b.keys) ? b.keys.slice(0, 2000) : [];
  const snap = await getSnapshot(0);
  const all = new Map((await decoratedSessions({ includeHidden: true })).map((s) => [s.key, s]));
  let moved = 0; const errors = [];
  for (const key of keys) {
    const s = snap.byKey.get(key);
    const d = all.get(key);
    if (!s) continue;
    if (d?.live || d?.running) { errors.push(tr('{title}: 실행 중이라 건너뛰었어요', { title: d.title })); continue; }
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
route('GET', '/api/ports', async () => {
  invalidatePorts();
  const d = await listPortsCached();
  await observeServers(d.ports).catch(() => {});
  return { ...d, ports: d.ports.map(({ argv, dir, ...p }) => p), servers: await listServers() };
});
route('GET', '/api/servers', async (req, url) => ({ items: await listServers({ project: url.searchParams.get('project') || undefined }) }));
route('POST', '/api/servers', async (req) => {
  const b = await body(req);
  try { const s = addServer(b || {}); if (s.enabled) await startServer(s.id).catch(() => {}); return { ok: true, id: s.id }; }
  catch (e) { return [400, { error: e.message }]; }
});
route('POST', '/api/servers/:id/start', async (req, url, { id }) => { try { return await startServer(id); } catch (e) { return [400, { error: e.message }]; } });
route('POST', '/api/servers/:id/stop', async (req, url, { id }) => { try { return await stopServer(id); } catch (e) { return [400, { error: e.message }]; } });
route('POST', '/api/servers/:id/remove', async (req, url, { id }) => removeServer(id));
route('GET', '/api/servers/:id/logs', async (req, url, { id }) => (await serverLogs(id)) || [404, { error: tr('등록된 서버를 찾을 수 없어요') }]);
route('POST', '/api/projects/:pid/links', async (req, url, { pid }) => {
  try { return { ok: true, link: addLink(decodeURIComponent(pid), (await body(req)) || {}) }; } catch (e) { return [400, { error: e.message }]; }
});
route('POST', '/api/projects/:pid/links/:id/remove', async (req, url, { pid, id }) => { removeLink(decodeURIComponent(pid), id); return { ok: true }; });
route('GET', '/api/repos', async () => reposReport(await projectsList()));
route('POST', '/api/ports/:port/share', async (req, url, { port }) => shareToPhone(port));
route('POST', '/api/ports/:port/unshare', async (req, url, { port }) => { await unshare(port); return { ok: true }; });
route('POST', '/api/pids/:pid/stop', async (req, url, { pid }) => stopPort(pid));
route('GET', '/api/skills', async () => skillsReport());
// new skill: preview where it goes -> AI draft (background job, polled) -> save. Plus edit/copy/delete your own.
const skillErr = (e) => [e.code === 'EXISTS' ? 409 : 400, { error: e.message, code: e.code || null }];
route('GET', '/api/skills/targets', async (req, url) => { try { return targetsPreview(Object.fromEntries(url.searchParams)); } catch (e) { return skillErr(e); } });
route('POST', '/api/skills/drafts', async (req) => { try { return await startDraft(await body(req)); } catch (e) { return skillErr(e); } });
route('GET', '/api/skills/drafts/:id', async (req, url, { id }) => draftStatus(id) || [404, { error: tr('초안을 찾을 수 없어요') }]);
route('POST', '/api/skills/drafts/:id/cancel', async (req, url, { id }) => ({ ok: cancelDraft(id) }));
route('POST', '/api/skills/save', async (req) => { try { return await saveSkill(await body(req)); } catch (e) { return skillErr(e); } });
route('POST', '/api/skills/copy', async (req) => { const b = await body(req); try { return await copySkill(b.id, b.tools); } catch (e) { return skillErr(e); } });
route('POST', '/api/skills/delete', async (req) => { const b = await body(req); try { return await deleteSkill(b.id); } catch (e) { return skillErr(e); } });
route('GET', '/api/skills/:id/source', async (req, url, { id }) => (await skillSource(id)) || [404, { error: tr('이 스킬은 여기서 고칠 수 없어요') }]);
route('GET', '/api/skills/:id', async (req, url, { id }) => (await skillDetail(id)) || [404, { error: tr('스킬을 찾을 수 없어요') }]);
route('GET', '/api/mcp', async (req, url) => { if (url.searchParams.get('fresh') === '1') invalidateMcp(); return mcpReport(); });
route('GET', '/api/mcp/effective', async (req, url) => {
  const cwd = url.searchParams.get('cwd');
  if (!cwd) return [400, { error: 'cwd required' }];
  const tool = url.searchParams.get('tool');
  return mcpEffective({ cwd: resolveCwd(cwd), tools: tool && TOOL_IDS.includes(tool) ? [tool] : TOOL_IDS.filter((t) => binFor(t)), session: url.searchParams.get('session') || null });
});
route('POST', '/api/mcp/check', async (req) => {
  const b = await body(req);
  if (!TOOL_IDS.includes(b.tool)) return [400, { error: 'unknown tool' }];
  const r = await checkMcp(b.tool, b.cwd ? resolveCwd(b.cwd) : null);
  invalidateMcp();
  return r;
});
route('GET', '/api/mcp/presets', async () => ({ presets: mcpPresets() }));
route('POST', '/api/mcp/add', async (req) => {
  try { return await addMcp(await body(req)); } catch (e) { return [400, { error: e.message }]; }
});
// new server: where it goes -> (AI draft, background job) -> install + test (background job). Both polled.
route('GET', '/api/mcp/targets', async (req, url) => { try { return await planInstall(Object.fromEntries(url.searchParams)); } catch (e) { return [400, { error: e.message }]; } });
route('POST', '/api/mcp/preview', async (req) => { try { return previewInstall(await body(req)); } catch (e) { return [400, { error: e.message }]; } });
route('POST', '/api/mcp/drafts', async (req) => { try { return await startMcpDraft(await body(req)); } catch (e) { return [400, { error: e.message }]; } });
route('POST', '/api/mcp/install', async (req) => { try { return await startInstall(await body(req)); } catch (e) { return [400, { error: e.message }]; } });
route('GET', '/api/mcp/jobs/:id', async (req, url, { id }) => mcpJob(id) || [404, { error: tr('작업을 찾을 수 없어요') }]);
route('POST', '/api/mcp/jobs/:id/cancel', async (req, url, { id }) => ({ ok: cancelMcpJob(id) }));
route('POST', '/api/mcp/test', async (req) => { const b = await body(req); try { return await testExisting(b.id); } catch (e) { return [400, { error: e.message }]; } });
route('POST', '/api/mcp/copy', async (req) => {
  const b = await body(req);
  try { return await copyMcp(String(b.id || ''), b.tools, b.scope === 'global' ? 'global' : ''); } catch (e) { return [400, { error: e.message }]; }
});
route('POST', '/api/mcp/remove', async (req) => {
  const b = await body(req);
  try { return await removeMcp(String(b.id || '')); } catch (e) { return [400, { error: e.message }]; }
});
route('GET', '/api/mcp/:id', async (req, url, { id }) => (await mcpDetail(id)) || [404, { error: tr('MCP 서버를 찾을 수 없어요') }]);
route('GET', '/api/limits', async (req, url) => allLimits({ force: url.searchParams.get('force') === '1' }));
route('GET', '/api/settings', async () => store.getSettings());
route('POST', '/api/settings', async (req) => {
  const patch = await body(req);
  if (patch.defaultCwd !== undefined && patch.defaultCwd !== '') {
    try {
      if (typeof patch.defaultCwd !== 'string') throw new Error();
      const dir = resolveCwd(patch.defaultCwd);
      const relative = path.relative(await fsp.realpath(HOME), await fsp.realpath(dir));
      if (relative.split(path.sep)[0] === '..' || path.isAbsolute(relative)) throw new Error();
      if (!(await fsp.stat(dir)).isDirectory()) throw new Error();
      patch.defaultCwd = shortHome(dir);
    } catch { return [400, { error: tr('폴더를 열 수 없어요. 경로와 접근 권한을 확인해주세요') }]; }
  }
  return store.updateSettings(patch);
});
route('POST', '/api/refresh', async () => { await forceRefresh(); return { ok: true }; });

// ---------- SSE for runs ----------
function streamJob(req, res, id, from) {
  const job = getJob(id);
  if (!job) { send(res, 404, { error: 'job not found' }); return; }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  const write = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  for (const ev of job.lines.slice(Math.max(0, from))) write(ev);
  if (job.status !== 'running') { res.end(); return; }
  const listener = (ev) => { write(ev); if (ev.t === 'end') res.end(); };
  job.listeners.add(listener);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => { clearInterval(ping); job.listeners.delete(listener); });
}

function streamRun(req, res, id, from) {
  const run = getRun(id);
  if (!run) { send(res, 404, { error: 'run not found' }); return; }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write(`event: meta\ndata: ${JSON.stringify(publicRun(run))}\n\n`);
  const write = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  // Replay, merging consecutive text deltas so reconnects are cheap.
  let merged = null;
  for (const ev of run.eventLog.replay(from)) {
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

// ---------- the agent asked a question: ping the phone if nobody is looking ----------
/** Muted session / project? (the session may be too new for the index: fall back to the run's folder) */
const runNotifies = (run) => {
  const key = run.sessionId ? `${run.tool}:${run.sessionId}` : null;
  return store.notifyAllowed(key, { cwd: run.cwd });
};
bus.on('run_ask', (run) => {
  if (run.listeners.size > 0 || !runNotifies(run)) return;
  const q = run.pendingAsk?.input?.questions?.[0]?.question || '';
  const url = run.sessionId ? `/#/s/${run.tool}/${encodeURIComponent(run.sessionId)}` : '/#/';
  notify({ kind: 'ask', title: fromLine(run.tool, run.model), body: `❓ ${clip(run.title || run.prompt, 40)}\n${clip(q, 140)}`, url, tag: `ask-${run.sessionId || run.id}` }).catch(() => {});
});

// ---------- remember how a session's last run ended (limit / blocked / error) until the next run ----------
bus.on('run_end', (run) => {
  if (!run.sessionId) return;
  const key = `${run.tool}:${run.sessionId}`;
  const kind = run.stopped ? null : run.limited ? 'limited' : run.denied?.length ? 'denied' : run.status === 'error' ? 'error' : null;
  if (kind) store.setRunOutcome(key, { kind, error: run.error, denied: run.denied });
  else store.clearRunOutcome(key);
});

// ---------- notifications on run completion ----------
bus.on('run_end', (run) => {
  const settings = store.getSettings();
  const watching = run.listeners.size > 0;
  const url = run.sessionId ? `/#/s/${run.tool}/${encodeURIComponent(run.sessionId)}` : '/#/';
  const label = clip(run.title || run.prompt, 40);
  const ok = run.status === 'done';
  // title = who answered ("From Claude Code - Opus 5.5"); body = which session + the reply
  const title = fromLine(run.tool, run.model);
  const res = run.events.findLast?.((e) => e.t === 'done');
  const bodyText = `${ok ? '✅' : '⚠️'} ${label}\n${ok ? clip((res?.result || tr('응답이 끝났어요')).replace(/\s+/g, ' '), 140) : clip(run.error || tr('실패했어요'), 140)}`;
  if (settings.notifyOnRunDone && !watching && runNotifies(run)) notify({ kind: ok ? 'run_done' : 'run_error', title, body: bodyText, url, tag: `run-${run.sessionId || run.id}` }).catch(() => {});
  else store.addEvent(ok ? 'run_done' : 'run_error', title, bodyText, url, { quiet: !watching }); // muted / alerts off: inbox only
  forceRefresh().catch(() => {});
  observeRun(run);
});

// ---------- static ----------
// Blocking script loaded before app.js: language, dictionary and t() for the browser.
function serveI18n(res) {
  let en = {};
  try { en = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'locales', 'en.json'), 'utf8')); } catch { /* ko only */ }
  const L = lang();
  const js = `window.LANG=${JSON.stringify(L)};window.LOCALE=${JSON.stringify(L === 'ko' ? 'ko-KR' : 'en-US')};
window.I18N_EN=${L === 'ko' ? '{}' : JSON.stringify(en)};
window.t=function(ko,vars){var s=window.LANG==='ko'?ko:(window.I18N_EN[ko]!=null?window.I18N_EN[ko]:ko);if(vars)s=s.replace(/\\{(\\w+)\\}/g,function(m,k){return vars[k]!=null?vars[k]:m;});return s;};
window.hourLabel=function(h){return new Date(2000,0,1,h).toLocaleTimeString(window.LOCALE,{hour:'numeric'});};
document.documentElement.lang=window.LANG;`;
  res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
  res.end(js);
}

async function serveStatic(req, res, pathname) {
  if (pathname === '/i18n.js') return serveI18n(res);
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
    // SPA fallback only for page-like paths (no extension or .html). A missing asset such as
    // /app.js?v=99 or /icon-x.png must 404, or the browser/service worker caches index.html in its place.
    const ext = path.extname(pathname).toLowerCase();
    if (ext && ext !== '.html') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end('not found');
      return;
    }
    const data = await fsp.readFile(path.join(PUBLIC, 'index.html'));
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
    res.end(data);
  }
}

const server = http.createServer(async (req, res) => {
  if (!authorized(req, ALLOWED)) { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('forbidden'); return; }
  // Retire cookies issued by the removed password/device login.
  if (/(?:^|;\s*)baton_device=/.test(req.headers.cookie || '')) {
    res.setHeader('set-cookie', 'baton_device=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
  }
  if (req.headers['tailscale-user-login'] && req.headers.host) setPublicOrigin(`https://${req.headers['x-forwarded-host'] || req.headers.host}`);
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/api/instance' && isLocal(req)) {
    return send(res, 200, { id: listener.id, os: OS_NAME, port: PORT });
  }
  try {
    const image = url.pathname.match(/^\/api\/sessions\/claude\/([^/]+)\/images\/([^/]+)$/);
    if (image && req.method === 'GET') {
      const session = await findSession('claude', decodeURIComponent(image[1]));
      const result = session?.file ? await readClaudeImage(session.file, image[2]) : null;
      if (!result) return send(res, 404, { error: 'image not found' });
      res.writeHead(200, { 'content-type': result.mime, 'content-length': result.data.length,
        'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox" });
      return res.end(result.data);
    }
    const m = url.pathname.match(/^\/api\/runs\/([^/]+)\/stream$/);
    if (m && req.method === 'GET') return streamRun(req, res, m[1], Number(url.searchParams.get('from') || 0));
    const mj = url.pathname.match(/^\/api\/setup\/jobs\/([^/]+)\/stream$/);
    if (mj && req.method === 'GET') return streamJob(req, res, mj[1], Number(url.searchParams.get('from') || 0));
    if (url.pathname.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const mm = url.pathname.match(r.re);
        if (!mm) continue;
        const out = await r.fn(req, url, mm.groups || {});
        if (Array.isArray(out)) { if (out[2]) for (const [k, v] of Object.entries(out[2])) res.setHeader(k, v); return send(res, out[0], out[1]); }
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

// Without handlers Node dies on these signals without running 'exit' hooks, which would leave
// detached CLI runs and archived run events behind. Exit normally so those hooks clean up.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => process.exit(128 + os.constants.signals[sig]));

let listening;
try {
  listening = await listen(server, listener, HOST);
  setPort(listening.port);
} catch (e) {
  console.error(`[baton] ${e.message}`);
  process.exit(1);
}
if (listening.existing) {
  console.log(`[baton] this installation is already running → http://localhost:${PORT}`);
  if (process.argv.includes('--open')) openBrowser(`http://localhost:${PORT}`);
  process.exit(0);
}
await (async () => {
  console.log(`[baton] listening on http://${HOST}:${PORT}`);
  console.log(`[baton] open  →  http://localhost:${PORT}`);
  if (process.argv.includes('--open')) openBrowser(`http://localhost:${PORT}`);
  const t = Date.now();
  const snap = await getSnapshot(0);
  console.log(`[baton] indexed ${snap.sessions.length} sessions in ${Date.now() - t}ms`);
  providersSummary().catch(() => {}); // warm the provider cache (model list, limits)
  if (process.platform === 'win32') setTimeout(() => listPorts().catch(() => {}), 3000).unref(); // first PowerShell start is slow (~7 s)
  if (envInfo.imported.length || envInfo.extra.length) console.log(`[baton] env: ${envInfo.imported.length} vars from ${envInfo.shell || 'shell'}, ${envInfo.extra.length} from settings`);
  startNudgeScheduler();
  startCompatWatch();
  startScheduler();
  startWatcher();
  startTrashPurge();
  startPendingMoves(async (key) => {
    const d = (await decoratedSessions({ includeHidden: true })).find((x) => x.key === key);
    return Boolean(d?.live || d?.running);
  });
  startUsageScheduler();
  seedDefaults();
  startServerWatch();
})();

// keep the index warm so the UI is instant
setInterval(() => { getSnapshot(15000).catch(() => {}); }, 20000).unref();
export { projectRoot };
