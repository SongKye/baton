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
    const out = await oneShot({ tool, model: null, prompt: 'Reply with exactly: OK', cwd: os.tmpdir(), timeoutMs: 90_000 });
    return { ok: true, reply: String(out).trim().slice(0, 200), ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 600), ms: Date.now() - t0 };
  }
}
