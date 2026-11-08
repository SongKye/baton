// Which backend each CLI talks to — subscription login vs. company setups (Bedrock, Vertex, Foundry,
// LLM gateways, API keys, custom Codex providers). Baton uses this to:
//   - not ask Bedrock/API users to "sign in" on the setup screen,
//   - skip subscription-limit lookups that don't apply (and say why),
//   - offer only model names that backend understands (+ free-form model ids).
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_HOME, CODEX_HOME } from './env.js';
import { binFor } from './tools.js';
import { runCli } from './platform.js';
import { getKV } from './store.js';

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

const MANAGED = process.platform === 'win32' ? 'C:\\ProgramData\\ClaudeCode\\managed-settings.json'
  : process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode/managed-settings.json'
    : '/etc/claude-code/managed-settings.json';

/** Effective env for Claude Code: process env + settings.json "env" + managed settings "env" (highest). */
function claudeEnv() {
  const user = readJson(path.join(CLAUDE_HOME, 'settings.json')) || {};
  const managed = readJson(MANAGED) || {};
  return { env: { ...process.env, ...(user.env || {}), ...(managed.env || {}) }, user, managed };
}

const LABEL = { subscription: 'Claude subscription', bedrock: 'Amazon Bedrock', vertex: 'Google Vertex AI', foundry: 'Microsoft Foundry', gateway: 'LLM gateway', apikey: 'Anthropic API key' };

let claudeCache = { at: 0, v: null };
export async function claudeProvider() {
  if (claudeCache.v && Date.now() - claudeCache.at < 5 * 60_000) return claudeCache.v;
  const { env, user, managed } = claudeEnv();
  const on = (k) => /^(1|true|yes)$/i.test(String(env[k] || ''));
  let kind = on('CLAUDE_CODE_USE_BEDROCK') ? 'bedrock' : on('CLAUDE_CODE_USE_VERTEX') ? 'vertex' : on('CLAUDE_CODE_USE_FOUNDRY') ? 'foundry'
    : env.ANTHROPIC_BASE_URL ? 'gateway' : (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || user.apiKeyHelper || managed.apiKeyHelper) ? 'apikey' : null;
  // ask Claude Code itself when we can (it knows about every config source)
  const bin = binFor('claude');
  if (bin) {
    const r = await runCli(bin, ['auth', 'status'], { timeout: 15000 });
    try {
      const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
      const p = String(j.apiProvider || '').toLowerCase();
      if (/bedrock/.test(p)) kind = 'bedrock';
      else if (/vertex/.test(p)) kind = 'vertex';
      else if (/foundry|azure/.test(p)) kind = 'foundry';
      // a fresh install reports authMethod "none" — that's "not signed in yet", not an API key
      else if (!kind && j.loggedIn && j.authMethod && !/claude\.ai|none/i.test(j.authMethod)) kind = 'apikey';
    } catch { /* older CLI: env-based guess stands */ }
  }
  kind = kind || 'subscription';
  // model ids configured for this backend (Bedrock/Vertex need their own ids or inference profiles)
  const models = {
    main: env.ANTHROPIC_MODEL || null,
    opus: env.ANTHROPIC_DEFAULT_OPUS_MODEL || null,
    sonnet: env.ANTHROPIC_DEFAULT_SONNET_MODEL || null,
    haiku: env.ANTHROPIC_DEFAULT_HAIKU_MODEL || env.ANTHROPIC_SMALL_FAST_MODEL || null,
  };
  const v = { kind, label: LABEL[kind], subscription: kind === 'subscription', models, region: env.AWS_REGION || env.CLOUD_ML_REGION || null, baseUrl: env.ANTHROPIC_BASE_URL || null };
  claudeCache = { at: Date.now(), v };
  return v;
}

/** Codex: config.toml model_provider + [model_providers.<id>], auth.json mode, env keys. */
export function codexProvider() {
  let toml = '';
  try { toml = fs.readFileSync(path.join(CODEX_HOME, 'config.toml'), 'utf8'); } catch { /* defaults */ }
  const top = toml.split(/^\[/m)[0];
  const providerId = (top.match(/^model_provider\s*=\s*"([^"]+)"/m) || [])[1] || 'openai';
  const section = toml.match(new RegExp(`^\\[model_providers\\.${providerId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]([\\s\\S]*?)(?=^\\[|$(?![\\s\\S]))`, 'm'))?.[1] || '';
  const name = (section.match(/^name\s*=\s*"([^"]+)"/m) || [])[1] || providerId;
  const baseUrl = (section.match(/^base_url\s*=\s*"([^"]+)"/m) || [])[1] || null;
  const envKey = (section.match(/^env_key\s*=\s*"([^"]+)"/m) || [])[1] || null;
  const auth = readJson(path.join(CODEX_HOME, 'auth.json')) || {};
  const chatgpt = providerId === 'openai' && (auth.auth_mode === 'chatgpt' || Boolean(auth.tokens?.access_token)) && !auth.OPENAI_API_KEY;
  // no key anywhere means "not signed in yet" (ChatGPT login is the default), not an API-key setup
  const hasKey = Boolean(auth.OPENAI_API_KEY || process.env.OPENAI_API_KEY);
  const kind = providerId !== 'openai' ? 'custom' : chatgpt || !hasKey ? 'subscription' : 'apikey';
  return {
    kind, subscription: kind === 'subscription', providerId, label: kind === 'custom' ? name : kind === 'apikey' ? 'OpenAI API key' : 'ChatGPT',
    baseUrl, envKey, envKeySet: envKey ? Boolean(process.env[envKey]) : null,
    configured: chatgpt || (kind === 'apikey' && hasKey) || (kind === 'custom' && (!envKey || Boolean(process.env[envKey]))),
    accountId: auth.tokens?.account_id || null, configModel: (top.match(/^model\s*=\s*"([^"]+)"/m) || [])[1] || null,
  };
}

/**
 * Model to send when the user picks "default" but config.toml's model isn't offered on this ChatGPT
 * account (set by the Codex catalog). Only valid for the exact setup it was computed for: switching
 * to a custom provider / API key, another account, or editing the model in config.toml drops it.
 */
export function codexDefaultFallback() {
  const fb = getKV('codex_default_fallback', null);
  if (!fb?.model) return null;
  const prov = codexProvider();
  if (!prov.subscription || prov.accountId !== fb.accountId || prov.configModel !== fb.configModel) return null;
  return fb.model;
}

/** Last known Claude provider without waiting (refreshes in the background). */
export function claudeProviderCached() {
  if (!claudeCache.v || Date.now() - claudeCache.at > 5 * 60_000) claudeProvider().catch(() => {});
  return claudeCache.v;
}
export function resetProviderCache() { claudeCache = { at: 0, v: null }; }

export async function providersSummary() {
  return { claude: await claudeProvider(), codex: codexProvider() };
}
