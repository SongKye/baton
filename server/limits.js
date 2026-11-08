// Live subscription limits for each CLI, fetched with the credentials the CLI itself already stored.
//   claude: GET api.anthropic.com/api/oauth/usage            (~/.claude/.credentials.json)
//   codex:  GET chatgpt.com/backend-api/wham/usage            (~/.codex/auth.json)
//   agy:    `agy -p=/usage --output-format json` (the CLI's own /usage command)
// We never refresh/rotate tokens ourselves (that would race the CLIs); an expired token just means
// we show the last good snapshot until the CLI is used again.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { HOME } from './util.js';
import { getKV, setKV } from './store.js';
import { childEnv } from './runner.js';
import { tr } from './i18n.js';
import { claudeProvider, codexProvider } from './providers.js';
import { CLAUDE_HOME, CODEX_HOME } from './env.js';

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const UA = 'baton/1.0';
const TTL = 60_000;

async function getJson(url, opts) {
  const ctl = AbortSignal.timeout(15000);
  const r = await fetch(url, { ...opts, signal: ctl });
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) throw Object.assign(new Error(j?.error?.message || `${r.status}`), { status: r.status });
  return j;
}
const pct = (x) => (x == null ? null : Math.max(0, Math.min(100, Math.round(x))));
const iso = (s) => (s ? Date.parse(s) || null : null);

// ---------------------------------------------------------------- claude
const CLAUDE_EXTRA = () => ({ seven_day_opus: tr('주간 · Opus'), seven_day_sonnet: tr('주간 · Sonnet'), seven_day_oauth_apps: tr('주간 · 외부 앱') });
async function claudeLimits() {
  const prov = await claudeProvider().catch(() => null);
  if (prov && !prov.subscription) return { plan: prov.label, windows: [], noLimits: true, provider: prov.label };
  const cred = readJson(path.join(CLAUDE_HOME, '.credentials.json'))?.claudeAiOauth;
  if (!cred?.accessToken) throw Object.assign(new Error(tr('Claude Code 로그인 정보가 없어요')), { code: 'NOAUTH' });
  if (cred.expiresAt && cred.expiresAt < Date.now()) throw Object.assign(new Error(tr('토큰 만료 — Claude Code를 한 번 쓰면 갱신돼요')), { code: 'EXPIRED' });
  const j = await getJson('https://api.anthropic.com/api/oauth/usage', {
    headers: { Authorization: `Bearer ${cred.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', 'Content-Type': 'application/json', 'User-Agent': UA },
  });
  const windows = [];
  if (j.five_hour) windows.push({ id: 'session', label: tr('현재 세션'), sub: tr('5시간'), usedPercent: pct(j.five_hour.utilization), resetsAt: iso(j.five_hour.resets_at) });
  if (j.seven_day) windows.push({ id: 'weekly', label: tr('주간 · 모든 모델'), sub: tr('7일'), usedPercent: pct(j.seven_day.utilization), resetsAt: iso(j.seven_day.resets_at), weekly: true });
  for (const [k, label] of Object.entries(CLAUDE_EXTRA())) {
    if (j[k]?.utilization != null) windows.push({ id: k, label, sub: tr('7일'), usedPercent: pct(j[k].utilization), resetsAt: iso(j[k].resets_at), weekly: true });
  }
  const ex = j.extra_usage;
  const extra = ex?.is_enabled ? { usedPercent: pct(ex.utilization), used: ex.used_credits, limit: ex.monthly_limit, currency: ex.currency } : null;
  return { plan: cred.subscriptionType || null, windows, extra };
}

// ---------------------------------------------------------------- codex
async function codexLimits() {
  const prov = codexProvider();
  if (!prov.subscription) return { plan: prov.label, windows: [], noLimits: true, provider: prov.label };
  const auth = readJson(path.join(CODEX_HOME, 'auth.json'));
  const t = auth?.tokens;
  if (!t?.access_token) throw Object.assign(new Error(tr('Codex 로그인 정보가 없어요')), { code: 'NOAUTH' });
  const j = await getJson('https://chatgpt.com/backend-api/wham/usage', {
    headers: { Authorization: `Bearer ${t.access_token}`, 'ChatGPT-Account-Id': t.account_id || '', 'User-Agent': UA },
  }).catch((e) => {
    if (e.status === 401) throw Object.assign(new Error(tr('Codex 로그인이 만료됐어요 — 설정에서 다시 로그인해주세요')), { code: 'EXPIRED' });
    throw e;
  });
  const rl = j.rate_limit || {};
  const w = (x, id, label, sub, weekly) => (x ? { id, label, sub, usedPercent: pct(x.used_percent), resetsAt: x.reset_at ? x.reset_at * 1000 : null, weekly } : null);
  const windows = [
    w(rl.primary_window, 'session', tr('5시간 한도'), tr('5시간'), false),
    w(rl.secondary_window, 'weekly', tr('주간 한도'), tr('7일'), true),
  ].filter(Boolean);
  for (const [k, v] of Object.entries(j.additional_rate_limits || {})) {
    const p = v?.rate_limit || v;
    if (p?.primary_window) windows.push(w(p.primary_window, k, k, '', false));
  }
  return { plan: j.plan_type || null, windows, limitReached: Boolean(rl.limit_reached) };
}

// ---------------------------------------------------------------- agy
// `agy -p=/usage --output-format json` runs the built-in /usage slash command (no model call)
// and returns {command:{data:{groups:[{name, buckets:[{window, remaining_fraction, reset_time}]}]}}}.
const GROUP_KO = () => ({ 'Gemini Models': tr('Gemini 모델'), 'Claude and GPT models': tr('Claude·GPT 모델') });
function agyLimits() {
  return new Promise((resolve, reject) => {
    execFile('agy', ['-p=/usage', '--output-format', 'json'], { timeout: 60000, cwd: HOME, env: childEnv(), maxBuffer: 4 << 20 }, (err, stdout) => {
      let j = null;
      try { j = JSON.parse(stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop()); } catch { /* fallthrough */ }
      const groups = j?.command?.data?.groups;
      if (!groups) return reject(Object.assign(new Error(j?.error || err?.message || tr('한도 정보를 받지 못했어요')), { code: 'AGY' }));
      const windows = [];
      for (const g of groups) {
        for (const b of g.buckets || []) {
          const weekly = b.window === 'weekly';
          windows.push({
            id: b.id || `${g.name}:${b.window}`,
            label: `${weekly ? tr('주간') : tr('5시간')} · ${GROUP_KO()[g.name] || g.name}`,
            sub: g.description ? g.description.replace(/^Models within this group:\s*/, '') : (weekly ? tr('7일') : tr('5시간')),
            usedPercent: pct((1 - (b.remaining_fraction ?? 1)) * 100), resetsAt: iso(b.reset_time), weekly,
          });
        }
      }
      resolve({ plan: null, windows });
    });
  });
}

// ---------------------------------------------------------------- cache + api
const FETCH = { claude: claudeLimits, codex: codexLimits, agy: agyLimits };
const mem = getKV('limits_cache', {}) || {};
const inflight = {};

async function one(tool) {
  const cur = mem[tool];
  if (cur?.fetchedAt && Date.now() - cur.fetchedAt < (tool === 'agy' ? 3 * TTL : TTL) && !cur.error) return cur;
  if (inflight[tool]) return inflight[tool];
  inflight[tool] = (async () => {
    try {
      const data = await FETCH[tool]();
      mem[tool] = { ...data, fetchedAt: Date.now(), error: null };
    } catch (e) {
      // keep the last good snapshot, mark it stale
      mem[tool] = { ...(cur || {}), error: e.message, errorCode: e.code || e.status || null, tried: Date.now(), fetchedAt: cur?.fetchedAt || null };
    }
    setKV('limits_cache', mem);
    return mem[tool];
  })().finally(() => { delete inflight[tool]; });
  return inflight[tool];
}

export async function allLimits({ force = false } = {}) {
  if (force) for (const t of Object.keys(FETCH)) if (mem[t]) mem[t].fetchedAt = mem[t].fetchedAt ? mem[t].fetchedAt - TTL : null;
  const entries = await Promise.all(Object.keys(FETCH).map(async (t) => [t, await one(t)]));
  return Object.fromEntries(entries);
}
