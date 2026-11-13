// "Connect without a subscription": guided setup for API keys, Amazon Bedrock, Google Vertex,
// LLM gateways and self-hosted servers. It writes the CLIs' OWN config (so the terminal CLI works the
// same way as Baton), backing the file up first, and can run a one-line connection test.
//
//   Claude Code -> ~/.claude/settings.json  "env" block (official way to configure Bedrock/Vertex/gateways)
//   Codex       -> ~/.codex/config.toml      model_provider + [model_providers.baton] (Responses API)
//                  or `codex login --with-api-key` for a plain OpenAI key
//   OpenCode    -> ~/.config/opencode/opencode.json  provider via @ai-sdk/openai-compatible (chat API)
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CLAUDE_HOME, CODEX_HOME } from './env.js';
import { getKV, setKV } from './store.js';
import { binFor } from './tools.js';
import { runCli } from './platform.js';
import { oneShot } from './runner.js';
import { resetProviderCache } from './providers.js';
import { tr } from './i18n.js';

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
async function backup(file) {
  if (fs.existsSync(file)) await fsp.copyFile(file, `${file}.baton-backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
}
const need = (v, name) => { if (!String(v || '').trim()) throw new Error(tr('{name}을(를) 입력해주세요', { name })); return String(v).trim(); };

// every env key any Claude backend choice may set — cleared before applying a new choice
const CLAUDE_KEYS = ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'AWS_REGION', 'AWS_PROFILE',
  'CLOUD_ML_REGION', 'ANTHROPIC_VERTEX_PROJECT_ID', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL'];

async function connectClaude(kind, f) {
  const env = {};
  if (kind === 'apikey') env.ANTHROPIC_API_KEY = need(f.apiKey, 'API key');
  else if (kind === 'bedrock') {
    env.CLAUDE_CODE_USE_BEDROCK = '1';
    env.AWS_REGION = need(f.region, 'AWS region');
    if (f.profile) env.AWS_PROFILE = f.profile.trim();
    if (f.model) env.ANTHROPIC_MODEL = f.model.trim();
  } else if (kind === 'vertex') {
    env.CLAUDE_CODE_USE_VERTEX = '1';
    env.CLOUD_ML_REGION = need(f.region, 'Region');
    env.ANTHROPIC_VERTEX_PROJECT_ID = need(f.project, 'GCP project id');
    if (f.model) env.ANTHROPIC_MODEL = f.model.trim();
  } else if (kind === 'gateway') {
    env.ANTHROPIC_BASE_URL = need(f.baseUrl, 'Base URL').replace(/\/+$/, '').replace(/\/v1$/, '');
    if (f.apiKey) env.ANTHROPIC_AUTH_TOKEN = f.apiKey.trim();
    if (f.model) {
      // self-hosted servers usually have one model: use it for the "small/fast" background calls too
      env.ANTHROPIC_MODEL = f.model.trim();
      env.ANTHROPIC_SMALL_FAST_MODEL = f.model.trim();
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = f.model.trim();
    }
  } else if (kind !== 'subscription') throw new Error('unknown kind');
  const file = path.join(CLAUDE_HOME, 'settings.json');
  const cur = readJson(file) || {};
  const nextEnv = { ...(cur.env || {}) };
  for (const k of CLAUDE_KEYS) delete nextEnv[k];
  Object.assign(nextEnv, env);
  await fsp.mkdir(CLAUDE_HOME, { recursive: true });
  await backup(file);
  const next = { ...cur, env: nextEnv };
  if (!Object.keys(nextEnv).length) delete next.env;
  await fsp.writeFile(file, JSON.stringify(next, null, 2) + '\n');
  // make it effective for Baton's own runs right away too
  for (const k of CLAUDE_KEYS) if (!(k in env) && process.env[k] && cur.env?.[k] === process.env[k]) delete process.env[k];
  Object.assign(process.env, env);
  return { file: path.join(CLAUDE_HOME, 'settings.json') };
}

function setTopLevelToml(toml, key, value) {
  const head = toml.split(/^\[/m)[0];
  const rest = toml.slice(head.length);
  const line = `${key} = ${JSON.stringify(value)}`;
  const re = new RegExp(`^${key}\\s*=.*$`, 'm');
  const newHead = re.test(head) ? head.replace(re, line) : `${line}\n${head}`;
  return newHead + rest;
}
function removeTopLevelToml(toml, key) {
  const head = toml.split(/^\[/m)[0];
  return head.replace(new RegExp(`^${key}\\s*=.*\\n?`, 'm'), '') + toml.slice(head.length);
}
function replaceTomlSection(toml, header, body) {
  const re = new RegExp(`^\\[${header.replace(/[.[\]]/g, '\\$&')}\\][\\s\\S]*?(?=^\\[|(?![\\s\\S]))`, 'm');
  const block = `[${header}]\n${body}\n\n`;
  return re.test(toml) ? toml.replace(re, block) : `${toml.replace(/\s*$/, '\n\n')}${block}`;
}

async function connectCodex(kind, f) {
  const file = path.join(CODEX_HOME, 'config.toml');
  let toml = '';
  try { toml = await fsp.readFile(file, 'utf8'); } catch { /* new */ }
  await fsp.mkdir(CODEX_HOME, { recursive: true });
  if (kind === 'apikey') {
    const key = need(f.apiKey, 'API key');
    if (/^model_provider\s*=\s*"baton"/m.test(toml)) { await backup(file); await fsp.writeFile(file, removeTopLevelToml(toml, 'model_provider')); }
    const bin = binFor('codex');
    const r = await runCli(bin, ['login', '--with-api-key'], { input: key, timeout: 30000 });
    if (r.code !== 0) throw new Error((r.stderr || r.stdout || 'codex login failed').trim().split('\n').pop());
    return { file: path.join(CODEX_HOME, 'auth.json') };
  }
  if (kind === 'subscription') {
    if (/^model_provider\s*=\s*"baton"/m.test(toml)) { await backup(file); await fsp.writeFile(file, removeTopLevelToml(toml, 'model_provider')); }
    return { file };
  }
  if (kind !== 'server') throw new Error('unknown kind');
  const baseUrl = need(f.baseUrl, 'Base URL').replace(/\/+$/, '');
  const model = need(f.model, 'Model');
  const envKey = 'BATON_CODEX_API_KEY';
  let next = setTopLevelToml(toml, 'model_provider', 'baton');
  next = setTopLevelToml(next, 'model', model);
  next = replaceTomlSection(next, 'model_providers.baton', [
    `name = ${JSON.stringify(f.name?.trim() || 'Custom server')}`,
    `base_url = ${JSON.stringify(/\/v\d+$/.test(baseUrl) ? baseUrl : `${baseUrl}/v1`)}`,
    ...(f.apiKey ? [`env_key = "${envKey}"`] : []),
  ].join('\n'));
  await backup(file);
  await fsp.writeFile(file, next);
  // Codex reads the key from an env var; keep it in Baton's CLI environment (Settings → Company setup)
  const extra = getKV('extra_env', {}) || {};
  if (f.apiKey) { extra[envKey] = f.apiKey.trim(); process.env[envKey] = f.apiKey.trim(); } else delete extra[envKey];
  setKV('extra_env', extra);
  return { file, envKey: f.apiKey ? envKey : null };
}

async function connectOpencode(kind, f) {
  if (kind !== 'server') throw new Error('unknown kind');
  const dir = process.platform === 'win32' ? path.join(os.homedir(), '.config', 'opencode') : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'opencode');
  const file = path.join(dir, 'opencode.json');
  const cur = readJson(file) || { $schema: 'https://opencode.ai/config.json' };
  const model = need(f.model, 'Model');
  const id = 'baton';
  cur.provider = { ...(cur.provider || {}), [id]: {
    npm: '@ai-sdk/openai-compatible', name: f.name?.trim() || 'Custom server',
    options: { baseURL: need(f.baseUrl, 'Base URL').replace(/\/+$/, ''), ...(f.apiKey ? { apiKey: f.apiKey.trim() } : {}) },
    models: { [model]: { name: model } },
  } };
  cur.model = `${id}/${model}`;
  await fsp.mkdir(dir, { recursive: true });
  await backup(file);
  await fsp.writeFile(file, JSON.stringify(cur, null, 2) + '\n');
  return { file };
}

export async function connect(tool, kind, fields = {}) {
  const r = tool === 'claude' ? await connectClaude(kind, fields) : tool === 'codex' ? await connectCodex(kind, fields)
    : tool === 'opencode' ? await connectOpencode(kind, fields) : (() => { throw new Error('unsupported tool'); })();
  resetProviderCache();
  return r;
}

/** Ask the CLI for a one-word reply through whatever backend is configured. */
export async function testConnection(tool) {
  if (!binFor(tool)) throw new Error(tr('먼저 설치해주세요'));
  const t0 = Date.now();
  try {
    const out = await oneShot({ tool, model: null, prompt: 'Reply with exactly: OK', timeoutMs: 90_000 });
    return { ok: true, reply: String(out).trim().slice(0, 200), ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 600), ms: Date.now() - t0 };
  }
}

// ---------------------------------------------------------------- model discovery
async function getJson(url, headers = {}, ms = 4000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json };
  } catch (e) { return { status: 0, error: e.name === 'AbortError' ? 'timeout' : e.cause?.code || e.message }; }
  finally { clearTimeout(timer); }
}
const modelIds = (j) => [...new Set([
  ...(Array.isArray(j?.data) ? j.data.map((m) => m.id || m.name) : []),
  ...(Array.isArray(j?.models) ? j.models.map((m) => m.model || m.name || m.id) : []),
].filter(Boolean).map(String))].sort();

/**
 * "Which models does this server offer?" — tries <base>/models and <base>/v1/models (OpenAI-style),
 * which LiteLLM, vLLM, Ollama, LM Studio, OpenRouter, Azure-style gateways and Anthropic all answer.
 */
export async function probeModels(baseUrl, apiKey) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw new Error(tr('http:// 또는 https://로 시작하는 주소를 넣어주세요'));
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}`, 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } : {};
  const urls = /\/v\d+$/.test(base) ? [`${base}/models`] : [`${base}/v1/models`, `${base}/models`];
  let last = null;
  for (const u of urls) {
    const r = await getJson(u, headers);
    last = r;
    const models = modelIds(r.json);
    if (r.status >= 200 && r.status < 300 && models.length) return { ok: true, models: models.slice(0, 500), url: u };
  }
  const why = !last || last.status === 0 ? tr('서버에 연결하지 못했어요 ({e})', { e: last?.error || '?' })
    : last.status === 401 || last.status === 403 ? tr('키가 필요하거나 맞지 않아요 (HTTP {s})', { s: last.status })
      : tr('모델 목록을 받지 못했어요 (HTTP {s}). 모델 이름을 직접 입력해주세요', { s: last.status });
  return { ok: false, error: why, models: [] };
}

const LOCAL = [
  { id: 'ollama', name: 'Ollama', port: 11434 },
  { id: 'lmstudio', name: 'LM Studio', port: 1234 },
  { id: 'vllm', name: 'vLLM', port: 8000 },
  { id: 'litellm', name: 'LiteLLM', port: 4000 },
  { id: 'llamacpp', name: 'llama.cpp', port: 8080 },
  { id: 'jan', name: 'Jan', port: 1337 },
];
/** Model servers running on this computer right now. */
export async function findLocalLlms() {
  const found = await Promise.all(LOCAL.map(async (s) => {
    const base = `http://127.0.0.1:${s.port}`;
    const r = await getJson(`${base}/v1/models`, {}, 1500);
    let models = r.status === 200 ? modelIds(r.json) : [];
    if (!models.length && s.id === 'ollama') { const t = await getJson(`${base}/api/tags`, {}, 1500); models = modelIds(t.json); }
    if (!models.length && !(s.id === 'litellm' && r.status === 401)) return null;
    return { ...s, baseUrl: `${base}/v1`, models: models.slice(0, 200), needsKey: r.status === 401 };
  }));
  return { servers: found.filter(Boolean) };
}
