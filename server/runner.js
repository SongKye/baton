// Spawns Claude / Codex / Antigravity / OpenCode / Cursor CLIs headlessly and normalizes their streaming output
// into a small event vocabulary the UI understands:
//   {t:'session', id}            session id became known (new sessions)
//   {t:'text', text}             assistant text delta
//   {t:'text_end'}               assistant text block finished
//   {t:'thinking'}               model is reasoning
//   {t:'tool', name, summary}    tool call started
//   {t:'tool_done', error}       tool call finished
//   {t:'mcp', servers}           MCP servers the CLI loaded for this run ([{name, status}], Claude only)
//   {t:'done', ok, error, result, cost, usage, durationMs}
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { spawnCli, IS_WIN } from './platform.js';
import { binFor, TOOL_IDS } from './tools.js';
import { tr } from './i18n.js';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { summarizeTool } from './sources/common.js';
import { getKV, setKV, patchSessionMeta } from './store.js';
import { codexDefaultFallback } from './providers.js';
import { clip, ONESHOT_DIR } from './util.js';
import { noteMcpStatus } from './mcp.js';
import { createRunEvents } from './run-events.js';

const runs = new Map();         // runId -> run
const activeByKey = new Map();  // "<tool>:<sessionId>" -> runId
export const bus = new EventEmitter(); // 'run_end' (run)
bus.setMaxListeners(100);

export const childPids = new Set();

/** Test hook (scripts/compat-smoke.mjs): sees every raw JSON event a CLI streams, before parsing. */
export const rawTap = { fn: null };

/** Environment for child CLIs: drop variables that would make a nested CLI think it's inside another session. */
export function childEnv(extra = {}) {
  const env = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...extra };
  for (const k of Object.keys(env)) {
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k === 'CLAUDE_PID' || k === 'CLAUDE_EFFORT' || k.startsWith('CODEX_THREAD') || k === 'CODEX_SANDBOX' || k === 'OPENCODE' || k === 'CURSOR_AGENT') delete env[k];
  }
  return env;
}

export function getRun(id) { return runs.get(id) || null; }
export function activeRunFor(key) {
  const id = activeByKey.get(key);
  const r = id && runs.get(id);
  return r && r.status === 'running' ? r : null;
}
export function listRuns() {
  return [...runs.values()].map(publicRun).sort((a, b) => b.startedAt - a.startedAt);
}
export function publicRun(r) {
  return {
    id: r.id, tool: r.tool, sessionId: r.sessionId, cwd: r.cwd, status: r.status, startedAt: r.startedAt,
    endedAt: r.endedAt, prompt: clip(r.prompt, 200), model: r.model, perm: r.perm, error: r.error, title: r.title,
  };
}

function rememberBatonSession(tool, id) {
  if (!id) return;
  const k = `baton_${tool}_ids`;
  const ids = new Set(getKV(k, []) || []);
  if (!ids.has(id)) { ids.add(id); setKV(k, [...ids].slice(-2000)); }
}

// ---------- command builders ----------
function claudeCmd({ sessionId, model, effort, perm, prompt, images }) {
  // stream-json in + `--permission-prompt-tool stdio` = the Agent SDK control protocol. That is what makes
  // Claude Code offer AskUserQuestion in headless mode: the question arrives as a control_request and the
  // answer goes back on stdin (stdin stays open until the result, see startRun).
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--input-format', 'stream-json', '--permission-prompt-tool', 'stdio'];
  const content = [{ type: 'text', text: prompt }];
  for (const im of images || []) content.push({ type: 'image', source: { type: 'base64', media_type: im.mime, data: fs.readFileSync(im.path).toString('base64') } });
  const stdin = JSON.stringify({ type: 'control_request', request_id: 'baton-init', request: { subtype: 'initialize' } }) + '\n'
    + JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';
  if (sessionId) args.push('--resume', sessionId);
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  if (perm === 'plan') args.push('--permission-mode', 'plan');
  else if (perm === 'full') args.push('--dangerously-skip-permissions');
  else args.push('--permission-mode', 'auto');
  return { bin: 'claude', args, stdin, keepOpen: true };
}

function codexCmd({ sessionId, model, effort, perm, prompt, images }) {
  const args = ['exec'];
  if (sessionId) args.push('resume');
  for (const im of images || []) args.push(`--image=${im.path}`);
  args.push('--json', '--skip-git-repo-check');
  model ||= codexDefaultFallback(); // config.toml's model isn't offered on this ChatGPT account
  if (model) args.push('-m', model);
  if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
  if (perm === 'full') args.push('--dangerously-bypass-approvals-and-sandbox');
  else args.push('-c', `sandbox_mode="${perm === 'plan' ? 'read-only' : 'workspace-write'}"`);
  if (sessionId) args.push(sessionId);
  args.push('-');
  return { bin: 'codex', args, stdin: prompt };
}

function agyCmd({ sessionId, model, effort, perm, prompt, images, cwd }) {
  // agy print mode only accepts text, so images are saved inside the workspace and referenced by path
  if (images?.length) {
    const rel = images.map((im) => `- ${path.relative(cwd, im.path)}`).join('\n');
    // fixed marker (readAgy strips it back out of the transcript) — not translated on purpose
    prompt = `${prompt}\n\n[Baton 첨부 이미지 ${images.length}장 — read_file 도구로 열어서 확인하세요 / open these image files with read_file]\n${rel}`;
  }
  const args = [`-p=${prompt}`, '--output-format', 'stream-json'];
  if (sessionId) args.push('--conversation', sessionId);
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  if (perm === 'plan') args.push('--mode', 'plan');
  else if (perm === 'full') args.push('--dangerously-skip-permissions');
  else args.push('--mode', 'accept-edits'); // `auto` isn't available on every account
  return { bin: 'agy', args, stdin: null };
}

function opencodeCmd({ sessionId, model, effort, perm, prompt, images }) {
  // `opencode run` reads the message from stdin when it isn't a TTY; --format json emits one JSON event per line
  const args = ['run', '--format', 'json'];
  if (sessionId) args.push('--session', sessionId);
  if (model) args.push('--model', model);
  if (model && effort) args.push('--variant', effort); // the model's reasoning variant (low/medium/high/…)
  args.push('--agent', perm === 'plan' ? 'plan' : 'build');
  for (const im of images || []) args.push('--file', im.path);
  return { bin: 'opencode', args, stdin: prompt };
}

function cursorCmd({ sessionId, model, perm, prompt, images, cwd }) {
  if (images?.length) {
    const rel = images.map((im) => `- ${path.relative(cwd, im.path)}`).join('\n');
    prompt = `${prompt}\n\n[Attached images — open these files to view them]\n${rel}`;
  }
  if (perm === 'plan') prompt = `${prompt}\n\n(Plan only: do not modify files or run commands that change anything.)`;
  const args = ['-p', '--output-format', 'stream-json'];
  if (sessionId) args.push('--resume', sessionId);
  if (model) args.push('--model', model);
  if (perm === 'full') args.push('--force');
  args.push(prompt);
  return { bin: 'cursor-agent', args, stdin: null };
}

// ---------- stream parsers ----------
function claudeParser(run) {
  const toolIdx = new Map();
  return (e) => {
    if (e.type === 'system' && e.subtype === 'init') {
      if (e.session_id) run.setSession(e.session_id);
      if (e.model) run.model = run.model || e.model;
      if (Array.isArray(e.mcp_servers)) {
        // which MCP servers this run actually loaded, and whether each one connected
        run.mcp = e.mcp_servers.map((x) => ({ name: x.name, status: x.status }));
        noteMcpStatus('claude', run.cwd, run.mcp);
        if (run.mcp.length) run.emit({ t: 'mcp', servers: run.mcp });
      }
    } else if (e.type === 'stream_event') {
      const ev = e.event || {};
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') run.emit({ t: 'text', text: ev.delta.text });
      else if (ev.type === 'content_block_start' && ev.content_block?.type === 'thinking') run.emit({ t: 'thinking' });
      else if (ev.type === 'content_block_stop') run.emit({ t: 'text_end' });
    } else if (e.type === 'assistant') {
      for (const p of e.message?.content || []) {
        if (p.type === 'tool_use') {
          toolIdx.set(p.id, true);
          run.emit({ t: 'tool', name: p.name, summary: summarizeTool(p.name, p.input) });
        }
      }
    } else if (e.type === 'user') {
      for (const p of e.message?.content || []) {
        if (p.type === 'tool_result') run.emit({ t: 'tool_done', error: Boolean(p.is_error) });
      }
    } else if (e.type === 'control_request') {
      const r = e.request || {};
      if (r.subtype === 'can_use_tool' && r.tool_name === 'AskUserQuestion' && Array.isArray(r.input?.questions)) {
        // the agent asks the user to choose — show it in the chat and wait for the answer (answerRun)
        run.pendingAsk = { requestId: e.request_id, input: r.input };
        run.emit({ t: 'ask', requestId: e.request_id, questions: r.input.questions.map((q) => ({
          question: String(q.question || ''), header: q.header || '', multiSelect: Boolean(q.multiSelect),
          options: (q.options || []).map((o) => ({ label: String(o.label || ''), description: o.description || '' })),
        })) });
        bus.emit('run_ask', run);
      } else if (r.subtype === 'can_use_tool') {
        // same as before the control protocol: anything that needs an approval prompt is declined
        run.control({ behavior: 'deny', message: 'Baton cannot show approval prompts for this tool. Continue without it, or ask the user to change the permission mode.' }, e.request_id);
      } else run.control(null, e.request_id, 'unsupported control request');
    } else if (e.type === 'result') {
      if (e.session_id) run.setSession(e.session_id);
      run.result = {
        ok: !e.is_error, result: e.result, cost: e.total_cost_usd, usage: e.usage, error: e.is_error ? (e.result || e.subtype) : null,
        denied: (e.permission_denials || []).map((d) => d.tool_name || d.name || 'tool'),
      };
      run.closeInput?.();
    }
  };
}

function codexParser(run) {
  return (e) => {
    const it = e.item || {};
    if (e.type === 'thread.started' && e.thread_id) run.setSession(e.thread_id);
    else if (e.type === 'item.started') {
      if (it.type === 'command_execution') run.emit({ t: 'tool', name: 'shell', summary: clip(it.command, 160) });
      else if (it.type === 'mcp_tool_call') run.emit({ t: 'tool', name: `${it.server || 'mcp'}.${it.tool || ''}`, summary: '' });
      else if (it.type === 'web_search') run.emit({ t: 'tool', name: 'web_search', summary: it.query || '' });
      else if (it.type === 'reasoning') run.emit({ t: 'thinking' });
    } else if (e.type === 'item.completed') {
      if (it.type === 'agent_message' && it.text) { run.emit({ t: 'text', text: it.text }); run.emit({ t: 'text_end' }); run.lastText = it.text; }
      else if (it.type === 'reasoning') run.emit({ t: 'thinking' });
      else if (it.type === 'command_execution') run.emit({ t: 'tool_done', error: it.exit_code ? it.exit_code !== 0 : false });
      else if (it.type === 'file_change') {
        const files = (it.changes || []).map((c) => `${c.kind || ''} ${c.path || ''}`.trim()).join(', ');
        run.emit({ t: 'tool', name: 'edit', summary: clip(files, 160) });
        run.emit({ t: 'tool_done', error: it.status === 'failed' });
      } else if (it.type === 'mcp_tool_call' || it.type === 'web_search') run.emit({ t: 'tool_done', error: it.status === 'failed' });
      else if (it.type === 'todo_list') run.emit({ t: 'tool', name: 'todo', summary: (it.items || []).map((x) => (x.completed ? '☑' : '☐') + ' ' + x.text).join(' · ') });
    } else if (e.type === 'turn.completed') {
      run.result = { ok: true, result: run.lastText, usage: e.usage };
    } else if (e.type === 'turn.failed') {
      run.result = { ok: false, error: e.error?.message || 'turn failed' };
    } else if (e.type === 'error') {
      run.result = { ok: false, error: e.message || 'error' };
    }
  };
}

function agyParser(run) {
  const seen = new Set();
  return (e) => {
    if (e.event === 'init' && e.conversation_id) {
      run.setSession(e.conversation_id);
      if (e.init?.model) run.model = run.model || e.init.model;
    } else if (e.event === 'step_update') {
      const s = e.step_update || {};
      if (s.step_type === 'agent_response') {
        if (s.text_delta) run.emit({ t: 'text', text: s.text_delta });
        if (s.thinking_delta) run.emit({ t: 'thinking' });
        if (s.state === 'DONE') run.emit({ t: 'text_end' });
      } else if (s.step_type && s.step_type !== 'user_input' && !/system_message|ephemeral|checkpoint/.test(s.tool_name || s.step_type)) {
        const k = s.step_index;
        if (!seen.has(k)) {
          seen.add(k);
          const name = s.tool_name || s.tool_info?.name || s.step_type;
          run.emit({ t: 'tool', name, summary: summarizeTool(name, s.tool_info?.parameters || {}) });
        }
        if (s.state === 'DONE' || s.state === 'ERROR' || s.state === 'CANCELED') run.emit({ t: 'tool_done', error: s.state !== 'DONE' });
      }
    } else if (e.event === 'result') {
      const r = e.result || {};
      if (r.conversation_id) run.setSession(r.conversation_id);
      run.result = {
        ok: r.status === 'SUCCESS', result: r.response, usage: r.usage, error: r.status === 'SUCCESS' ? null : (r.error || r.status),
        denied: (r.denied_actions || []).map((d) => d.display_name || d.action),
      };
    }
  };
}

function opencodeParser(run) {
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0 };
  return (e) => {
    if (e.sessionID) run.setSession(e.sessionID);
    const p = e.part || {};
    if (e.type === 'text' && p.text) { run.emit({ t: 'text', text: p.text }); run.emit({ t: 'text_end' }); run.lastText = p.text; }
    else if (e.type === 'reasoning') run.emit({ t: 'thinking' });
    else if (e.type === 'tool_use' || e.type === 'tool') {
      const st = p.state || {};
      run.emit({ t: 'tool', name: p.tool || 'tool', summary: summarizeTool(p.tool, st.input || {}) || st.title || '' });
      if (st.status === 'completed' || st.status === 'error') run.emit({ t: 'tool_done', error: st.status === 'error' });
    } else if (e.type === 'step_finish' && p.tokens) {
      usage.input_tokens += p.tokens.input || 0;
      usage.output_tokens += (p.tokens.output || 0) + (p.tokens.reasoning || 0);
      usage.cache_read_tokens += p.tokens.cache?.read || 0;
      run.result = { ok: true, result: run.lastText, usage, cost: p.cost };
    } else if (e.type === 'error') {
      const err = e.error || {};
      run.result = { ok: false, error: err.data?.message || err.message || err.name || 'error' };
    }
  };
}

function cursorParser(run) {
  let inText = false;
  return (e) => {
    if (e.session_id) run.setSession(e.session_id);
    if (e.type === 'system' && e.subtype === 'init') { if (e.model) run.model = run.model || e.model; }
    else if (e.type === 'assistant') {
      for (const c of e.message?.content || []) {
        if (c.type === 'text' && c.text) { run.emit({ t: 'text', text: c.text }); run.lastText = (run.lastText || '') + c.text; inText = true; }
      }
    } else if (e.type === 'tool_call') {
      if (inText) { run.emit({ t: 'text_end' }); inText = false; }
      const tc = e.tool_call || {};
      const kind = Object.keys(tc)[0] || 'tool';
      const name = kind.replace(/ToolCall$/, '');
      if (e.subtype === 'started') run.emit({ t: 'tool', name, summary: summarizeTool(name, tc[kind]?.args || {}) });
      else if (e.subtype === 'completed') run.emit({ t: 'tool_done', error: Boolean(tc[kind]?.result?.error || tc[kind]?.result?.rejected) });
    } else if (e.type === 'result') {
      if (inText) { run.emit({ t: 'text_end' }); inText = false; }
      run.result = { ok: !e.is_error && e.subtype !== 'error', result: e.result || run.lastText, error: e.is_error ? (e.result || e.subtype) : null, usage: e.usage };
    }
  };
}

const BUILDERS = { claude: claudeCmd, codex: codexCmd, agy: agyCmd, opencode: opencodeCmd, cursor: cursorCmd };
const PARSERS = { claude: claudeParser, codex: codexParser, agy: agyParser, opencode: opencodeParser, cursor: cursorParser };

// ---------- run lifecycle ----------
export function startRun({ tool, sessionId, cwd, prompt, model, effort, perm, title, images }) {
  if (!TOOL_IDS.includes(tool)) throw new Error('unknown tool');
  if (!prompt || !prompt.trim()) throw new Error('empty prompt');
  if (!binFor(tool)) throw new Error(tr('{name}가 설치되어 있지 않아요. 설정 → 시작하기에서 설치할 수 있어요', { name: tool }));
  if (sessionId) {
    const existing = activeRunFor(`${tool}:${sessionId}`);
    if (existing) throw Object.assign(new Error(tr('이 세션은 이미 응답 중이에요')), { code: 'BUSY', runId: existing.id });
  }
  const opts = { sessionId, model, effort, perm, prompt, images, cwd };
  const cmd = BUILDERS[tool](opts);
  const eventLog = createRunEvents();

  const run = {
    id: crypto.randomUUID(), tool, sessionId: sessionId || null, cwd, prompt, model: model || null, reqModel: model || null, effort: effort || null, images: images?.length || 0, perm: perm || 'auto',
    title: title || null, status: 'running', startedAt: Date.now(), endedAt: null, events: eventLog.events, eventLog, result: null, error: null,
    stderr: '', listeners: new Set(), child: null, lastText: '',
  };
  run.emit = (ev) => {
    eventLog.append(ev);
    for (const l of run.listeners) { try { l(ev); } catch { /* ignore */ } }
  };
  run.setSession = (id) => {
    if (!id || run.sessionId === id) return;
    const isNew = !run.sessionId;
    run.sessionId = id;
    activeByKey.set(`${tool}:${id}`, run.id);
    if (isNew) rememberBatonSession(tool, id);
    run.emit({ t: 'session', id });
  };

  const parse = PARSERS[tool](run);
  const child = spawnCli(binFor(tool) || cmd.bin, cmd.args, {
    cwd,
    detached: !IS_WIN, // its shell/tool descendants share a process group for Stop
    env: childEnv({ BATON_RUN: run.id }),
    stdio: [cmd.stdin != null ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });
  run.child = child;
  if (child.pid) childPids.add(child.pid);
  if (cmd.stdin != null) {
    child.stdin.on('error', () => {});
    if (cmd.keepOpen) {
      child.stdin.write(cmd.stdin);
      run.closeInput = () => { try { child.stdin.end(); } catch { /* closed */ } };
    } else child.stdin.end(cmd.stdin);
  }
  // reply to a control_request (Claude Code control protocol)
  run.control = (response, requestId, error) => {
    if (!child.stdin.writable) return false;
    const msg = error ? { type: 'control_response', response: { subtype: 'error', request_id: requestId, error } }
      : { type: 'control_response', response: { subtype: 'success', request_id: requestId, response } };
    child.stdin.write(JSON.stringify(msg) + '\n');
    return true;
  };

  let buf = '';
  const parseLine = (line) => {
    line = line.trim();
    if (!line || line[0] !== '{') return;
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    if (rawTap.fn) try { rawTap.fn(tool, ev); } catch { /* observer only */ }
    try { parse(ev); } catch { /* malformed event */ }
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      parseLine(line);
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => { run.stderr = (run.stderr + c).slice(-8000); });

  const finish = (code, signal, spawnErr) => {
    if (run.status !== 'running') return;
    if (buf.trim()) { parseLine(buf); buf = ''; }
    if (child.pid) childPids.delete(child.pid);
    run.endedAt = Date.now();
    const res = run.result || {};
    let ok = res.ok === true && code === 0;
    let error = res.error || null;
    if (spawnErr) { ok = false; error = tr('{bin} 실행 실패: {msg}', { bin: cmd.bin, msg: spawnErr.message }); }
    else if (run.stopped) { ok = false; error = tr('사용자가 중지했어요'); }
    else if (!ok && !error) error = clip(run.stderr.trim().split('\n').slice(-6).join('\n'), 1200) || (code === 0 && res.ok == null ? 'CLI exited without a completion event' : tr('종료 코드 {code}', { code: code ?? signal }));
    run.status = ok ? 'done' : 'error';
    run.error = error;
    // ran into the CLI's usage/rate limit? the UI offers to hand the session to another CLI
    run.limited = !ok && /rate.?limit|usage limit|limit (?:reached|exceeded)|quota|exceeded your|out of (?:credits|tokens)|\b429\b|too many requests|hit your limit|resets? (?:at|in)/i.test(`${error || ''} ${run.stderr.slice(-2000)}`);
    const denied = [...new Set(res.denied || [])];
    run.denied = denied;
    run.emit({ t: 'done', ok, error, denied, limited: run.limited, result: res.result ? clip(res.result, 4000) : null, cost: res.cost ?? null, usage: res.usage ?? null, durationMs: run.endedAt - run.startedAt });
    if (run.sessionId) activeByKey.delete(`${tool}:${run.sessionId}`);
    bus.emit('run_end', run);
    setTimeout(() => { run.listeners.clear(); runs.delete(run.id); eventLog.dispose(); }, 45 * 60 * 1000).unref();
  };
  child.on('error', (err) => finish(null, null, err));
  child.on('close', (code, signal) => finish(code, signal));

  runs.set(run.id, run);
  if (run.sessionId) activeByKey.set(`${tool}:${run.sessionId}`, run.id);
  return run;
}

/** The user's answer to an AskUserQuestion: answers = { [question]: "label" | "a, b" | "free text" }; null = skip. */
export function answerRun(id, requestId, answers) {
  const run = runs.get(id);
  const ask = run?.pendingAsk;
  if (!run || run.status !== 'running' || !ask || ask.requestId !== requestId) return false;
  run.pendingAsk = null;
  const ok = answers && Object.keys(answers).length
    ? run.control({ behavior: 'allow', updatedInput: { ...ask.input, answers } }, requestId)
    : run.control({ behavior: 'deny', message: 'The user skipped this question. Continue with your best judgment and say what you assumed.' }, requestId);
  run.emit({ t: 'ask_done', requestId, answers: answers || null });
  return ok;
}

export function stopRun(id) {
  const run = runs.get(id);
  if (!run || run.status !== 'running' || !run.child) return false;
  run.stopped = true;
  if (IS_WIN && run.child.pid) { // kill the whole tree (cmd.exe shim -> node -> tools)
    spawn('taskkill', ['/pid', String(run.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return true;
  }
  const killGroup = (signal) => { try { process.kill(-run.child.pid, signal); } catch { /* already exited */ } };
  killGroup('SIGINT');
  setTimeout(() => killGroup('SIGTERM'), 4000).unref();
  setTimeout(() => killGroup('SIGKILL'), 10000).unref();
  return true;
}

// Runs live in their own process group (detached), so they no longer receive the terminal's
// Ctrl+C or launchd's group kill along with Baton. End them whenever Baton exits; process.kill
// is synchronous, so this works inside an 'exit' handler. Windows children are not detached.
process.once('exit', () => {
  if (IS_WIN) return;
  for (const run of runs.values()) {
    if (run.status === 'running' && run.child?.pid) { try { process.kill(-run.child.pid, 'SIGTERM'); } catch { /* already exited */ } }
  }
});

/**
 * The session a one-shot call left behind in the CLI's own storage, read from its JSON output
 * (OpenCode: `sessionID` on every event; Antigravity: `conversation_id`; Cursor: `session_id`). Claude and Codex
 * don't save one-shot sessions. Returns null when none is found.
 */
export function oneShotSessionId(tool, out) {
  if (!['opencode', 'agy', 'cursor'].includes(tool)) return null;
  for (const line of String(out).split('\n')) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    const id = e?.sessionID || e?.conversation_id || e?.session_id || e?.part?.sessionID;
    if (typeof id === 'string' && id) return id;
  }
  return null;
}

/**
 * One-shot, non-persisted completion (project briefs, skill drafts, connection checks). Resolves to the final text.
 * Always runs in Baton's own one-shot folder, outside every project: OpenCode / Antigravity / Cursor keep these
 * calls as real sessions (no "don't save" flag), so the session is also hidden, and the indexer drops anything
 * recorded in that folder as a safety net.
 */
export function oneShot({ tool, model, effort, prompt, timeoutMs = 180000, signal = null, failLabel = '' }) {
  const cwd = ONESHOT_DIR;
  try { fs.mkdirSync(cwd, { recursive: true }); } catch { /* spawn reports it */ }
  return new Promise((resolve, reject) => {
    let bin, args, stdin = true;
    if (tool === 'opencode') {
      bin = 'opencode';
      args = ['run', '--format', 'json', '--agent', 'plan'];
      if (model) args.push('--model', model);
      if (model && effort) args.push('--variant', effort);
    } else if (tool === 'cursor') {
      bin = 'cursor-agent';
      args = ['-p', '--output-format', 'json'];
      if (model) args.push('--model', model);
      args.push(prompt);
      stdin = false;
    } else if (tool === 'codex') {
      bin = 'codex';
      args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '-c', 'sandbox_mode="read-only"'];
      model ||= codexDefaultFallback();
      if (model) args.push('-m', model);
      if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
      args.push('-');
    } else if (tool === 'agy') {
      bin = 'agy';
      args = ['-p', prompt, '--output-format', 'json', '--mode', 'plan'];
      if (model) args.push('--model', model);
      if (effort) args.push('--effort', effort);
      stdin = false;
    } else {
      bin = 'claude';
      args = ['-p', '--output-format', 'json', '--no-session-persistence', '--permission-mode', 'plan', '--tools', ''];
      if (model) args.push('--model', model);
      if (effort) args.push('--effort', effort);
    }
    const child = spawnCli(binFor(tool) || bin, args, { cwd, env: childEnv(), stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    if (child.pid) childPids.add(child.pid);
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    signal?.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err = (err + c).slice(-4000); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (child.pid) childPids.delete(child.pid);
      const sid = oneShotSessionId(tool, out); // before the failure checks: a failed call can still leave a session
      if (sid) { try { patchSessionMeta(`${tool}:${sid}`, { hidden: true }); } catch { /* the folder rule still hides it */ } }
      if (signal?.aborted) return reject(new Error(tr('취소했어요')));
      if (code !== 0) return reject(new Error(`${failLabel || tr('요약 생성 실패')} (code ${code}): ${clip(err || out, 400)}`));
      try {
        if (tool === 'opencode') {
          const texts = [];
          let failed = false;
          for (const line of out.split('\n')) {
            try { const e = JSON.parse(line); if (e.type === 'error') failed = true; if (e.type === 'text' && e.part?.text) texts.push(e.part.text); } catch { /* skip */ }
          }
          if (texts.length && !failed) return resolve(texts.join('\n'));
        } else if (tool === 'codex') {
          let text = '';
          let completed = false, failed = false;
          for (const line of out.split('\n')) {
            try { const e = JSON.parse(line); if (e.type === 'turn.completed') completed = true; if (e.type === 'turn.failed' || e.type === 'error') failed = true; if (e.type === 'item.completed' && e.item?.type === 'agent_message') text = e.item.text; } catch { /* skip */ }
          }
          if (text && completed && !failed) return resolve(text);
        } else {
          const j = JSON.parse(out.trim().split('\n').filter(Boolean).pop());
          const text = j.result?.response ?? j.result ?? j.response;
          if (!j.is_error && !j.error && (!j.result?.status || j.result.status === 'SUCCESS') && typeof text === 'string' && text) return resolve(text);
        }
      } catch { /* fallthrough */ }
      if (signal?.aborted) return reject(new Error(tr('취소했어요')));
      reject(new Error(`${failLabel || tr('요약 생성 실패')} (code ${code}): ${clip(err || out, 400)}`));
    });
    if (stdin) { child.stdin.on('error', () => {}); child.stdin.end(prompt); }
  });
}
