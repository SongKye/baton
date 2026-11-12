// Talks to an MCP server the way a CLI would — start it (stdio) or call it (HTTP / legacy SSE), do the
// `initialize` handshake and ask for `tools/list` — so "it works" means a real connection, not just a
// config file that parses. Read-only: no tool is ever called. Secret values never appear in what it returns.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { HOME } from './util.js';
import { spawnCli, which, IS_WIN } from './platform.js';
import { childEnv } from './runner.js';
import { tr } from './i18n.js';

const PROTOCOL = '2025-06-18';
const CLIENT = { name: 'baton', version: '1' };
const MASK = '•••';

/** Replace every secret value (and anything token-looking after key=/token:) in `text`. */
export function scrub(text, secrets = []) {
  let s = String(text || '');
  for (const v of [...new Set(secrets)].filter((x) => x && String(x).length >= 4).sort((a, b) => b.length - a.length)) s = s.split(String(v)).join(MASK);
  return s.replace(/((?:token|key|secret|password|authorization|bearer)["']?\s*[:=]\s*["']?(?:bearer\s+)?)([^"'\s,&]{8,})/gi, `$1${MASK}`);
}

const tail = (s, n = 1800) => { s = String(s || '').replace(/\x1b\[[0-9;]*m/g, '').trim(); return s.length > n ? `…${s.slice(-n)}` : s; };
const info = (x) => (x && typeof x === 'object' ? { name: String(x.title || x.name || '').slice(0, 80), version: String(x.version || '').slice(0, 30) } : null);
const initMsg = (id) => ({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: CLIENT } });

/** A command we can start: on PATH, or an existing file. */
function runnable(cmd) {
  if (!cmd) return false;
  if (which(cmd)) return true;
  const p = String(cmd).replace(/^~(?=$|[\\/])/, HOME);
  return path.isAbsolute(p) && fs.existsSync(p);
}

/** What to install when a launcher is missing. */
export function installHint(cmd) {
  const c = path.basename(String(cmd || '')).replace(/\.(cmd|exe|bat)$/i, '');
  if (c === 'npx' || c === 'node' || c === 'npm') return tr('Node.js를 설치하면 npx가 같이 생겨요 (nodejs.org)');
  if (c === 'uvx' || c === 'uv') return tr('uv(파이썬 도구)를 설치해주세요: docs.astral.sh/uv');
  if (c === 'docker') return tr('Docker Desktop(또는 docker)을 설치하고 켜주세요');
  if (c === 'python' || c === 'python3' || c === 'pip') return tr('Python을 설치해주세요');
  return '';
}

/** Turn a low-level failure into one sentence a person can act on. */
function explain(err, log) {
  const all = `${err || ''}\n${log || ''}`;
  if (/E404|404 Not Found.*registry|is not in this registry|No matching distribution|not found in the package registry/i.test(all)) return tr('패키지를 찾을 수 없어요. 패키지 이름을 확인해주세요');
  if (/ECONNREFUSED|connection refused/i.test(all)) return tr('서버에 연결할 수 없어요. 그 서버(앱)가 켜져 있는지, 주소가 맞는지 확인해주세요');
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(all)) return tr('주소를 찾을 수 없어요. URL과 인터넷 연결을 확인해주세요');
  if (/certificate|SSL|TLS/i.test(all)) return tr('보안 연결(인증서) 문제로 연결하지 못했어요');
  if (/Cannot connect to the Docker daemon|docker daemon/i.test(all)) return tr('Docker가 켜져 있지 않아요');
  if (/(missing|required|must (be )?set|not set|invalid|wrong|bad|expired|no ).{0,40}(api[_ -]?key|token|env|credential)|(api[_ -]?key|token|credential).{0,30}(missing|required|not set|invalid|expired)|unauthori[sz]ed|\b401\b/i.test(all)) return tr('필요한 키나 토큰이 없거나 틀린 것 같아요');
  if (/EACCES|permission denied/i.test(all)) return tr('실행 권한이 없어요');
  return '';
}

// ---------------------------------------------------------------- process cleanup
function killTree(child) {
  if (!child?.pid || child.exitCode != null) return;
  try {
    if (IS_WIN) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGTERM');
  } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } }
  if (!IS_WIN) setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, 1500).unref();
}

// ---------------------------------------------------------------- stdio
function probeStdio(spec, { cwd, timeoutMs, secrets }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    if (!runnable(spec.command)) {
      resolve({ status: 'fail', ms: 0, missing: spec.command, error: tr('{cmd} 명령을 찾을 수 없어요', { cmd: spec.command }), hint: installHint(spec.command) || tr('먼저 설치해주세요'), log: '' });
      return;
    }
    let child;
    try {
      child = spawnCli(spec.command, (spec.args || []).map(String), {
        cwd: cwd && fs.existsSync(cwd) ? cwd : HOME, env: childEnv(spec.env || {}),
        stdio: ['pipe', 'pipe', 'pipe'], detached: !IS_WIN,
      });
    } catch (e) {
      resolve({ status: 'fail', ms: 0, error: scrub(e.message, secrets), hint: explain(e.message), log: '' });
      return;
    }
    let buf = '', errLog = '', done = false, stage = 'init';
    const tools = [];
    let server = null, instructions = '';
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { child.stdin.end(); } catch { /* closed */ }
      killTree(child);
      const log = scrub(tail(errLog), secrets);
      resolve({ ms: Date.now() - t0, server, tools, instructions, log, ...r, error: r.error ? scrub(r.error, secrets) : undefined, hint: r.hint ?? (r.status === 'fail' ? explain(r.error, errLog) : undefined) });
    };
    const send = (m) => { try { child.stdin.write(`${JSON.stringify(m)}\n`); } catch { /* closed */ } };
    const timer = setTimeout(() => finish({ status: 'fail', error: stage === 'init'
      ? tr('{s}초 동안 서버가 응답하지 않았어요', { s: Math.round(timeoutMs / 1000) })
      : tr('서버가 도구 목록을 보내지 않았어요') }), timeoutMs);
    child.on('error', (e) => finish({ status: 'fail', error: e.code === 'ENOENT' ? tr('{cmd} 명령을 찾을 수 없어요', { cmd: spec.command }) : e.message, hint: e.code === 'ENOENT' ? installHint(spec.command) : undefined }));
    child.on('close', (code) => finish({ status: 'fail', error: tr('서버가 바로 종료됐어요 (code {code})', { code }) }));
    child.stdin.on('error', () => {});
    child.stderr.on('data', (c) => { errLog = (errLog + c).slice(-8000); });
    let cursor = null, pages = 0;
    child.stdout.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('{')) { if (line) errLog = (errLog + line + '\n').slice(-8000); continue; } // a server that logs to stdout
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1) {
          if (m.error) return finish({ status: 'fail', error: m.error.message || JSON.stringify(m.error) });
          server = info(m.result?.serverInfo);
          instructions = String(m.result?.instructions || '').slice(0, 400);
          stage = 'tools';
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        } else if (typeof m.id === 'number' && m.id >= 2) {
          if (m.error) return finish({ status: 'ok', note: m.error.message }); // connected; tools/list unsupported
          for (const x of m.result?.tools || []) tools.push(x.name);
          cursor = m.result?.nextCursor;
          if (cursor && ++pages < 5) send({ jsonrpc: '2.0', id: m.id + 1, method: 'tools/list', params: { cursor } });
          else return finish({ status: 'ok' });
        } else if (m.method && m.id != null) {
          // a request from the server (roots/list, ping…): answer politely so it doesn't stall
          send({ jsonrpc: '2.0', id: m.id, result: m.method === 'roots/list' ? { roots: [] } : {} });
        }
      }
    });
    send(initMsg(1));
  });
}

// ---------------------------------------------------------------- HTTP (streamable) and legacy SSE
/** Read an SSE body; calls onEvent({event, data}) until it returns true or the stream ends. */
async function readSse(body, onEvent, signal) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) return;
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        let event = 'message';
        const data = [];
        for (const l of block.split('\n')) {
          if (l.startsWith('event:')) event = l.slice(6).trim();
          else if (l.startsWith('data:')) data.push(l.slice(5).replace(/^ /, ''));
        }
        if (data.length && onEvent({ event, data: data.join('\n') })) return;
      }
    }
  } finally { reader.cancel().catch(() => {}); }
}

function authResult(res, headers, secrets) {
  const sentAuth = Object.keys(headers || {}).some((k) => /^(authorization|x-api-key|api-key)$/i.test(k) || /key|token/i.test(k));
  if (res.status === 401 && !sentAuth) return { status: 'auth', error: tr('로그인(OAuth)이 필요한 서버예요'), hint: tr('각 CLI에서 처음 쓸 때 로그인하면 돼요') };
  if (res.status === 401 || res.status === 403) return { status: 'fail', error: tr('서버가 인증을 거절했어요 (HTTP {code})', { code: res.status }), hint: tr('토큰이나 키가 맞는지, 권한(scope)이 충분한지 확인해주세요') };
  void secrets;
  return null;
}

/** POST one JSON-RPC message; returns { res, msg } where msg is the reply with the same id (if any). */
async function post(url, headers, msg, session, signal) {
  const res = await fetch(url, {
    method: 'POST', signal, redirect: 'follow',
    headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': PROTOCOL, ...(session ? { 'Mcp-Session-Id': session } : {}) },
    body: JSON.stringify(msg),
  });
  if (msg.id == null || !res.ok) { res.body?.cancel().catch(() => {}); return { res, msg: null }; }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    let found = null;
    await readSse(res.body, ({ data }) => { try { const m = JSON.parse(data); if (m.id === msg.id) { found = m; return true; } } catch { /* skip */ } return false; }, signal);
    return { res, msg: found };
  }
  const text = await res.text();
  try { const j = JSON.parse(text); return { res, msg: Array.isArray(j) ? j.find((m) => m.id === msg.id) : j }; } catch { return { res, msg: null, text }; }
}

async function probeStreamable(spec, { signal, secrets }) {
  const headers = spec.headers || {};
  const { res, msg, text } = await post(spec.url, headers, initMsg(1), null, signal);
  const auth = authResult(res, headers, secrets);
  if (auth) return auth;
  if (!res.ok || !msg) return { status: 'fail', http: res.status, error: res.ok ? tr('MCP 응답이 아니에요') : `HTTP ${res.status}`, body: scrub(tail(text || '', 400), secrets) };
  if (msg.error) return { status: 'fail', error: msg.error.message || JSON.stringify(msg.error) };
  const session = res.headers.get('mcp-session-id');
  const server = info(msg.result?.serverInfo);
  const instructions = String(msg.result?.instructions || '').slice(0, 400);
  await post(spec.url, headers, { jsonrpc: '2.0', method: 'notifications/initialized' }, session, signal).catch(() => {});
  const tools = [];
  let cursor, id = 2;
  do {
    const r = await post(spec.url, headers, { jsonrpc: '2.0', id, method: 'tools/list', params: cursor ? { cursor } : {} }, session, signal);
    if (!r.msg || r.msg.error) break;
    for (const x of r.msg.result?.tools || []) tools.push(x.name);
    cursor = r.msg.result?.nextCursor;
    id++;
  } while (cursor && id < 7);
  // be tidy: end the session
  if (session) fetch(spec.url, { method: 'DELETE', headers: { ...headers, 'Mcp-Session-Id': session }, signal: AbortSignal.timeout(3000) }).catch(() => {});
  return { status: 'ok', server, tools, instructions };
}

/** The 2024 transport: GET an event stream, learn the POST endpoint from its first event, replies come back on the stream. */
async function probeLegacySse(spec, { signal, secrets }) {
  const headers = spec.headers || {};
  const own = new AbortController(); // closing the event stream when we're done
  const stop = () => own.abort();
  signal?.addEventListener('abort', stop, { once: true });
  const res = await fetch(spec.url, { headers: { ...headers, Accept: 'text/event-stream' }, signal: own.signal });
  const auth = authResult(res, headers, secrets);
  if (auth) { stop(); return auth; }
  if (!res.ok || !(res.headers.get('content-type') || '').includes('text/event-stream')) { stop(); return { status: 'fail', http: res.status, error: res.ok ? tr('MCP 응답이 아니에요') : `HTTP ${res.status}` }; }
  const waiters = new Map();
  let endpointResolve;
  const endpoint = new Promise((r) => { endpointResolve = r; });
  const pump = readSse(res.body, ({ event, data }) => {
    if (event === 'endpoint') endpointResolve(new URL(data.trim(), spec.url).toString());
    else { try { const m = JSON.parse(data); waiters.get(m.id)?.(m); } catch { /* skip */ } }
    return false;
  }, own.signal).catch(() => {});
  const ask = async (url, msg) => {
    const reply = msg.id != null ? new Promise((r) => waiters.set(msg.id, r)) : null;
    const r = await fetch(url, { method: 'POST', signal, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(msg) });
    r.body?.cancel().catch(() => {});
    if (!r.ok && r.status !== 202) throw new Error(`HTTP ${r.status}`);
    return reply ? Promise.race([reply, pump.then(() => null)]) : null;
  };
  try {
    const ep = await Promise.race([endpoint, pump.then(() => null)]);
    if (!ep) return { status: 'fail', error: tr('MCP 응답이 아니에요') };
    const init = await ask(ep, initMsg(1));
    if (!init) return { status: 'fail', error: tr('MCP 응답이 아니에요') };
    if (init.error) return { status: 'fail', error: init.error.message };
    await ask(ep, { jsonrpc: '2.0', method: 'notifications/initialized' });
    const list = await ask(ep, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    return { status: 'ok', legacySse: true, server: info(init.result?.serverInfo), tools: (list?.result?.tools || []).map((x) => x.name), instructions: String(init.result?.instructions || '').slice(0, 400) };
  } finally { stop(); signal?.removeEventListener('abort', stop); }
}

async function probeHttp(spec, { timeoutMs, secrets }) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    let r = spec.transport === 'sse' ? null : await probeStreamable(spec, { signal: ctl.signal, secrets });
    // Older servers only speak the SSE transport: a POST there is usually 404/405 or not JSON-RPC at all.
    if (!r || (r.status === 'fail' && (r.http === 404 || r.http === 405 || r.http === 400 || /sse\/?$/i.test(new URL(spec.url).pathname)))) {
      const s = await probeLegacySse(spec, { signal: ctl.signal, secrets }).catch((e) => ({ status: 'fail', error: e.message }));
      if (s.status !== 'fail' || !r) r = s;
    }
    return { ms: Date.now() - t0, tools: [], server: null, ...r, error: r.error ? scrub(r.error, secrets) : undefined, hint: r.hint ?? (r.status === 'fail' ? explain(r.error) : undefined), body: undefined, log: r.body || '' };
  } catch (e) {
    const msg = ctl.signal.aborted ? tr('{s}초 동안 서버가 응답하지 않았어요', { s: Math.round(timeoutMs / 1000) }) : (e.cause?.code || e.cause?.message || e.message);
    return { status: 'fail', ms: Date.now() - t0, tools: [], server: null, error: scrub(msg, secrets), hint: explain(`${e.message} ${e.cause?.code || ''} ${e.cause?.message || ''}`), log: '' };
  } finally { clearTimeout(timer); }
}

/**
 * spec: { transport: 'stdio'|'http'|'sse', command, args, env, url, headers }
 * -> { status: 'ok'|'auth'|'fail', ms, server: {name, version}|null, tools: [name], instructions, error?, hint?, log, missing? }
 */
export async function probeServer(spec, { cwd = HOME, timeoutMs, secrets = [] } = {}) {
  const all = [...secrets, ...Object.values(spec.env || {}), ...Object.values(spec.headers || {}).map((v) => String(v).replace(/^(Bearer|Basic|Token)\s+/i, ''))];
  if (spec.transport === 'stdio') return probeStdio(spec, { cwd, timeoutMs: timeoutMs || 90_000, secrets: all });
  if (!/^https?:\/\//i.test(spec.url || '')) return { status: 'fail', ms: 0, tools: [], error: tr('URL이 올바르지 않아요') };
  return probeHttp(spec, { timeoutMs: timeoutMs || 25_000, secrets: all });
}
