// Model catalogs for each CLI, with the *actual* default model/effort spelled out.
// Defaults come from (1) what a Baton run without --model/--effort really used (recorded on run end),
// (2) the CLI's own config file, (3) recent session logs.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { HOME } from './util.js';
import { childEnv } from './runner.js';
import { getKV, setKV } from './store.js';
import { binFor } from './tools.js';
import { runCli } from './platform.js';
import { tr } from './i18n.js';

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

// ---------------------------------------------------------------- claude
const CLAUDE_KNOWN = ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
const FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'];

/** "claude-opus-5-5" -> "Opus 5.5"; "claude-sonnet-4-5-20250929" -> "Sonnet 4.5" */
export function prettyClaude(id) {
  const m = String(id || '').match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/);
  if (!m) return id;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? '.' + m[3] : ''}${m[4] ? ' (1M)' : ''}`;
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
  const settings = readJson(path.join(HOME, '.claude', 'settings.json')) || {};
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

// ---------------------------------------------------------------- codex
function codexCatalog() {
  let cfgModel = null; let cfgEffort = null;
  try {
    const cfg = fs.readFileSync(path.join(HOME, '.codex', 'config.toml'), 'utf8').split(/^\[/m)[0]; // top-level keys only
    cfgModel = cfg.match(/^model\s*=\s*"([^"]+)"/m)?.[1] || null;
    cfgEffort = cfg.match(/^model_reasoning_effort\s*=\s*"([^"]+)"/m)?.[1] || null;
  } catch { /* ignore */ }
  const j = readJson(path.join(HOME, '.codex', 'models_cache.json')) || {};
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

function agyCatalog() {
  if (Date.now() - agyCache.at > 6 * 3600 * 1000) { agyCache.at = Date.now(); refreshAgy(); }
  const obs = getKV('observed_default_agy', null);
  const label = (id) => agyCache.models.find((m) => m.id === id)?.label || id;
  const settings = readJson(path.join(HOME, '.gemini', 'antigravity-cli', 'settings.json')) || {};
  const defModel = obs?.model || null;
  const models = [{
    id: '', label: tr('기본값 · {model}', { model: defModel ? label(defModel) : settings.model || tr('알 수 없음') }), short: defModel ? label(defModel) : (settings.model || tr('기본')),
    desc: defModel ? tr('기본값으로 보냈을 때 실제로 쓰인 모델') : tr('아직 확인 전 · 한 번 보내면 실제 모델을 알려드려요'), defaultEffort: agyEffortOf(defModel),
  }];
  for (const m of agyCache.models) models.push({ ...m, short: m.label, desc: m.id, defaultEffort: agyEffortOf(m.id) });
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

export function catalogs() {
  return {
    claude: claudeCatalog(), codex: codexCatalog(), agy: agyCatalog(),
    opencode: simpleCatalog('opencode', tr('opencode 설정(opencode.json)의 기본 모델')),
    cursor: simpleCatalog('cursor', tr('Cursor 계정의 기본 모델 (auto)')),
  };
}
