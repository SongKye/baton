// Model catalogs for each CLI, with the *actual* default model/effort spelled out.
// Defaults come from (1) what a Baton run without --model/--effort really used (recorded on run end),
// (2) the CLI's own config file, (3) recent session logs.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { HOME } from './util.js';
import { childEnv } from './runner.js';
import { getKV, setKV } from './store.js';
import { binFor, TOOLS } from './tools.js';
import { runCli } from './platform.js';
import { tr } from './i18n.js';
import { claudeProviderCached, codexProvider } from './providers.js';
import { CLAUDE_HOME, CODEX_HOME } from './env.js';

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

// ---------------------------------------------------------------- claude
const CLAUDE_KNOWN = ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
const FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'];

/** "claude-opus-5-5" -> "Opus 5.5"; "claude-sonnet-4-5-20250929" -> "Sonnet 4.5" */
/** Bedrock / Vertex / ARN spellings -> plain "claude-<family>-<ver>" so they can be prettified. */
export function normalizeClaudeId(id) {
  return String(id || '')
    .replace(/^.*\//, '') // ARN / inference-profile path
    .replace(/^(?:us|eu|apac|global|jp|au)\./, '') // cross-region inference prefix
    .replace(/^anthropic\./, '')
    .replace(/-v\d+(?::\d+)?$/, '') // Bedrock version suffix
    .replace(/@\d{8}$/, ''); // Vertex date suffix
}
export function prettyClaude(id) {
  const n = normalizeClaudeId(id);
  const cap = (f) => `${f[0].toUpperCase()}${f.slice(1)}`;
  let m = n.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/);
  if (m) return `${cap(m[1])} ${m[2]}${m[3] ? '.' + m[3] : ''}${m[4] ? ' (1M)' : ''}`;
  m = n.match(/^claude-(\d+)(?:-(\d{1,2}))?-([a-z]+)(?:-\d{8})?$/); // older "claude-3-5-sonnet" naming
  if (m) return `${cap(m[3])} ${m[1]}${m[2] ? '.' + m[2] : ''}`;
  return id;
}
const ver = (id) => { const m = String(id).match(/-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/); return m ? +m[1] * 100 + +(m[2] || 0) : 0; };

function claudeKnownIds() {
  const seen = new Set(CLAUDE_KNOWN);
  for (const id of getKV('claude_seen_models', []) || []) seen.add(id);
  return [...seen];
}
/** Newest concrete model id for an alias (opus -> claude-opus-5-5). */
export function resolveClaudeAlias(alias) {
  if (!FAMILIES.includes(alias)) return alias;
  const ids = claudeKnownIds().filter((id) => id.startsWith(`claude-${alias}-`) && !id.includes('['));
  return ids.sort((a, b) => ver(b) - ver(a))[0] || alias;
}
export function noteClaudeModels(ids) {
  const cur = new Set(getKV('claude_seen_models', []) || []);
  const before = cur.size;
  for (const id of ids) if (/^claude-[a-z]+-\d/.test(id)) cur.add(id);
  if (cur.size !== before) setKV('claude_seen_models', [...cur]);
}

function claudeCatalog() {
  const prov = claudeProviderCached();
  if (prov && !prov.subscription) return claudeCompanyCatalog(prov);
  const settings = readJson(path.join(CLAUDE_HOME, 'settings.json')) || {};
  const obs = getKV('observed_default_claude', null);
  const cfgModel = settings.model || null;
  const defModel = obs?.model || (cfgModel ? resolveClaudeAlias(cfgModel) : null);
  const defEffort = obs?.effort || settings.effortLevel || null;
  const ids = claudeKnownIds().sort((a, b) => (FAMILIES.indexOf(a.split('-')[1]) - FAMILIES.indexOf(b.split('-')[1])) || ver(b) - ver(a));
  const models = [{
    id: '', label: tr('기본값 · {model}', { model: defModel ? prettyClaude(defModel) : tr('알 수 없음') }), short: defModel ? prettyClaude(defModel) : tr('기본'),
    desc: cfgModel ? tr('~/.claude/settings.json의 "{v}"', { v: cfgModel }) + (obs ? ` · ${tr('실제 실행에서 확인됨')}` : '') : tr('Claude Code 계정 기본값'),
  }];
  for (const f of FAMILIES) {
    const r = resolveClaudeAlias(f);
    if (r === f) continue;
    models.push({ id: f, label: tr('{family} 최신', { family: `${f[0].toUpperCase()}${f.slice(1)}` }), short: prettyClaude(r), desc: tr('지금은 {name} ({id}) · 새 버전이 나오면 자동으로 바뀌어요', { name: prettyClaude(r), id: r }) });
  }
  for (const id of ids) models.push({ id, label: prettyClaude(id), short: prettyClaude(id), desc: `${id} · ${tr('버전 고정')}` });
  return {
    models,
    efforts: ['', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaults: { model: defModel, effort: defEffort },
  };
}

/** Bedrock / Vertex / Foundry / gateway: first-party ids may not exist there — use aliases and configured ids. */
function claudeCompanyCatalog(prov) {
  const m = prov.models || {};
  const obs = getKV('observed_default_claude', null);
  const def = m.main || obs?.model || null;
  const models = [{ id: '', label: tr('기본값 · {model}', { model: def ? prettyClaude(def) : prov.label }), short: def ? prettyClaude(def) : tr('기본'), desc: `${prov.label}${prov.region ? ` · ${prov.region}` : ''}${def ? ` · ${def}` : ''}` }];
  for (const f of ['opus', 'sonnet', 'haiku']) {
    models.push({ id: f, label: `${f[0].toUpperCase()}${f.slice(1)}`, short: m[f] ? prettyClaude(m[f]) : `${f[0].toUpperCase()}${f.slice(1)}`, desc: m[f] ? m[f] : tr('{provider}에서 Claude Code가 고르는 {family} 모델', { provider: prov.label, family: f }) });
  }
  const seen = new Set(models.map((x) => x.id));
  for (const id of [m.main, m.opus, m.sonnet, m.haiku].filter(Boolean)) if (!seen.has(id)) { seen.add(id); models.push({ id, label: prettyClaude(id), short: prettyClaude(id), desc: id }); }
  return { models, efforts: ['', 'low', 'medium', 'high', 'xhigh', 'max'], defaults: { model: def, effort: obs?.effort || null }, provider: prov.label, freeform: true };
}

// ---------------------------------------------------------------- codex
function codexCatalog() {
  let cfgModel = null; let cfgEffort = null;
  try {
    const cfg = fs.readFileSync(path.join(CODEX_HOME, 'config.toml'), 'utf8').split(/^\[/m)[0]; // top-level keys only
    cfgModel = cfg.match(/^model\s*=\s*"([^"]+)"/m)?.[1] || null;
    cfgEffort = cfg.match(/^model_reasoning_effort\s*=\s*"([^"]+)"/m)?.[1] || null;
  } catch { /* ignore */ }
  const prov = codexProvider();
  if (prov.kind === 'custom') {
    return {
      models: [{ id: '', label: tr('기본값 · {model}', { model: cfgModel || prov.label }), short: cfgModel || tr('기본'), desc: `${prov.label}${prov.baseUrl ? ` · ${prov.baseUrl}` : ''}` }],
      efforts: ['', 'minimal', 'low', 'medium', 'high'], defaults: { model: cfgModel, effort: cfgEffort }, provider: prov.label, freeform: true,
    };
  }
  const j = readJson(path.join(CODEX_HOME, 'models_cache.json')) || {};
  const list = (j.models || []).filter((m) => m.slug && !/auto-review/.test(m.slug)).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  const name = (slug) => list.find((m) => m.slug === slug)?.display_name || slug;
  const obs = getKV('observed_default_codex', null);
  const defModel = cfgModel || obs?.model || list[0]?.slug || null;
  const effortFor = (slug) => cfgEffort || list.find((m) => m.slug === slug)?.default_reasoning_level || null;
  const models = [{
    id: '', label: tr('기본값 · {model}', { model: defModel ? name(defModel) : tr('알 수 없음') }), short: defModel ? name(defModel) : tr('기본'),
    desc: cfgModel ? tr('~/.codex/config.toml의 model = "{v}"', { v: cfgModel }) : tr('Codex 계정 기본값'), defaultEffort: effortFor(defModel),
  }];
  const efforts = new Set(['']);
  for (const m of list) {
    const levels = (m.supported_reasoning_levels || []).map((x) => x.effort);
    levels.forEach((e) => efforts.add(e));
    models.push({ id: m.slug, label: m.display_name || m.slug, short: m.display_name || m.slug, desc: [m.slug !== m.display_name ? m.slug : '', m.description].filter(Boolean).join(' · ').slice(0, 120), efforts: levels, defaultEffort: effortFor(m.slug) });
  }
  return {
    models,
    efforts: efforts.size > 1 ? [...efforts] : ['', 'minimal', 'low', 'medium', 'high', 'xhigh'],
    defaults: { model: defModel, effort: effortFor(defModel), effortSource: cfgEffort ? 'config' : 'model' },
  };
}

// ---------------------------------------------------------------- agy
let agyCache = { at: 0, models: [] };
function refreshAgy() {
  execFile('agy', ['models'], { timeout: 30000, env: childEnv() }, (err, stdout) => {
    if (err) return;
    const models = [];
    for (const line of stdout.split('\n')) {
      const m = line.match(/^(\S+)\t(.+)$/);
      if (m) models.push({ id: m[1], label: m[2].trim() });
    }
    if (models.length) agyCache = { at: Date.now(), models };
  });
}
const agyEffortOf = (id) => String(id || '').match(/-(minimal|low|medium|high|xhigh|max)$/)?.[1] || null;

export function groupAgyModels(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const effort = agyEffortOf(entry.id);
    const base = effort ? entry.id.slice(0, -effort.length - 1) : entry.id;
    if (!groups.has(base)) {
      const label = effort ? entry.label.replace(/\s*\((minimal|low|medium|high|xhigh|max)\)$/i, '') : entry.label;
      groups.set(base, { id: entry.id, label, short: label, desc: base,
        defaultEffort: effort, efforts: [], variants: {} });
    }
    const group = groups.get(base);
    if (effort) { group.efforts.push(effort); group.variants[effort] = entry.id; }
  }
  const order = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  return [...groups.values()].map((group) => ({ ...group, efforts: group.efforts.sort((a, b) => order.indexOf(a) - order.indexOf(b)) }));
}

function agyCatalog() {
  if (Date.now() - agyCache.at > 6 * 3600 * 1000) { agyCache.at = Date.now(); refreshAgy(); }
  const obs = getKV('observed_default_agy', null);
  const grouped = groupAgyModels(agyCache.models);
  const groupFor = (id) => grouped.find((m) => m.id === id || Object.values(m.variants).includes(id));
  const label = (id) => groupFor(id)?.label || id;
  const settings = readJson(path.join(HOME, '.gemini', 'antigravity-cli', 'settings.json')) || {};
  const defModel = obs?.model || null;
  const models = [{
    id: '', label: tr('기본값 · {model}', { model: defModel ? label(defModel) : settings.model || tr('알 수 없음') }), short: defModel ? label(defModel) : (settings.model || tr('기본')),
    desc: defModel ? tr('기본값으로 보냈을 때 실제로 쓰인 모델') : tr('아직 확인 전 · 한 번 보내면 실제 모델을 알려드려요'), defaultEffort: agyEffortOf(defModel), efforts: groupFor(defModel)?.efforts,
  }];
  models.push(...grouped);
  return {
    models,
    efforts: ['', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaults: { model: defModel, effort: agyEffortOf(defModel) },
  };
}

// ---------------------------------------------------------------- opencode / cursor
// Both list their models with a `models` subcommand; refreshed in the background every 6h.
const listCache = { opencode: { at: 0, models: [] }, cursor: { at: 0, models: [] } };
function refreshList(tool) {
  const c = listCache[tool];
  if (Date.now() - c.at < 6 * 3600 * 1000) return;
  c.at = Date.now();
  const bin = binFor(tool);
  if (!bin) return;
  runCli(bin, ['models'], { timeout: 30000 }).then(({ stdout }) => {
    const models = [];
    for (const raw of stdout.split('\n')) {
      const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trim();
      if (!line || /^(available|models|usage|error)/i.test(line)) continue;
      const m = line.match(/^([\w./:@-]+)(?:\s+[-–—]\s+(.+)|\s{2,}(.+))?$/);
      if (m) models.push({ id: m[1], label: (m[2] || m[3] || m[1]).trim() });
    }
    if (models.length) c.models = models;
  });
}
function simpleCatalog(tool, note) {
  refreshList(tool);
  return {
    models: [{ id: '', label: tr('기본값'), short: tr('기본'), desc: note }, ...listCache[tool].models.map((m) => ({ ...m, short: m.label, desc: m.id }))],
    efforts: [''],
    defaults: { model: null, effort: null },
  };
}

// OpenCode: `opencode models --verbose` prints "<provider>/<id>" then that model's JSON (name, cost,
// variants = the reasoning levels `opencode run --variant` accepts). Use it for readable names, a
// free-models-first order and per-model effort; fall back to the plain list if it can't be parsed.
const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const effortRank = (e) => (e === '' ? -1 : EFFORT_ORDER.includes(e) ? EFFORT_ORDER.indexOf(e) : 99);
const ocList = { at: 0, ok: false, models: null };
export function parseOpencodeVerbose(text) {
  const lines = String(text).replace(/\x1b\[[0-9;]*m/g, '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const id = lines[i].trim();
    if (!/^[\w.@-]+\/[\w./:@-]+$/.test(id) || lines[i + 1]?.trim() !== '{') continue;
    let j = i + 1;
    while (j < lines.length && lines[j] !== '}') j++;
    let meta = null;
    try { meta = JSON.parse(lines.slice(i + 1, j + 1).join('\n')); } catch { /* skip */ }
    i = j;
    if (!meta || meta.status === 'deprecated') continue;
    const c = meta.cost || {};
    const free = !c.input && !c.output;
    const efforts = Object.keys(meta.variants || {}).sort((a, b) => effortRank(a) - effortRank(b));
    const name = String(meta.name || id).replace(free ? /[\s(-]*free\)?$/i : /$^/, '').trim() || id; // "Beam Free" -> "Beam" + our own tag
    out.push({ id, name, free, efforts });
  }
  return out;
}
function refreshOpencodeModels() {
  if (Date.now() - ocList.at < (ocList.ok ? 6 * 3600 * 1000 : 120 * 1000)) return;
  ocList.at = Date.now();
  const bin = binFor('opencode');
  if (!bin) return;
  runCli(bin, ['models', '--verbose'], { timeout: 60000 }).then(({ stdout }) => {
    const models = parseOpencodeVerbose(stdout);
    ocList.ok = models.length > 0;
    if (ocList.ok) ocList.models = models;
  }).catch(() => { ocList.ok = false; });
}
function opencodeCatalog() {
  refreshOpencodeModels();
  if (!ocList.models) return simpleCatalog('opencode', tr('OpenCode가 고르는 기본 모델 · 따로 설정하지 않아도 돼요'));
  const list = [...ocList.models.filter((m) => m.free), ...ocList.models.filter((m) => !m.free)];
  const efforts = new Set(['']);
  for (const m of list) m.efforts.forEach((e) => efforts.add(e));
  return {
    models: [
      { id: '', label: tr('기본값'), short: tr('기본'), desc: tr('OpenCode가 고르는 기본 모델 · 따로 설정하지 않아도 돼요'), efforts: [] },
      ...list.map((m) => ({ id: m.id, label: m.free ? tr('{name} · 무료', { name: m.name }) : m.name, short: m.name, desc: m.id, efforts: m.efforts })),
    ],
    efforts: [...efforts].sort((a, b) => effortRank(a) - effortRank(b)),
    defaults: { model: null, effort: null },
  };
}

/** "From Claude Code - Opus 5.5": who answered, for notifications. */
export function fromLine(tool, model) {
  let cat = null;
  try { cat = catalogs()[tool]; } catch { /* ignore */ }
  const id = model || cat?.defaults?.model || null;
  const m = cat?.models?.find((x) => x.id && x.id === id);
  const label = m?.short || (id ? (tool === 'claude' ? prettyClaude(id) : id) : null);
  const name = TOOLS[tool]?.name || tool;
  return label ? `From ${name} - ${label}` : `From ${name}`;
}

export function catalogs() {
  return {
    claude: claudeCatalog(), codex: codexCatalog(), agy: agyCatalog(),
    opencode: opencodeCatalog(),
    cursor: simpleCatalog('cursor', tr('Cursor 계정의 기본 모델 (auto)')),
  };
}
