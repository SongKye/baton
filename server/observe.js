// Learn what "default" actually means for each CLI by looking at what a run really used.
import fs from 'node:fs';
import path from 'node:path';
import { HOME, tailJsonl } from './util.js';
import { getKV, setKV, } from './store.js';
import { findSession, forceRefresh } from './indexer.js';
import { agyConversationModel } from './sources/agy.js';

async function modelEffortFromFile(tool, file) {
  if (tool === 'agy') return { model: agyConversationModel(file), effort: null };
  const lines = await tailJsonl(file, 512 * 1024);
  for (let i = lines.length - 1; i >= 0; i--) {
    const o = lines[i];
    if (tool === 'claude' && o.type === 'assistant' && o.message?.model && !o.message.model.startsWith('<')) {
      return { model: o.requestedModel || o.message.model, effort: o.effort || o.perTurnEffort || null };
    }
    if (tool === 'codex' && o.type === 'turn_context' && o.payload?.model) {
      return { model: o.payload.model, effort: o.payload.effort || o.payload.reasoning_effort || null };
    }
  }
  return null;
}

function remember(tool, found, run) {
  if (!found) return;
  const key = `observed_default_${tool}`;
  const cur = getKV(key, {}) || {};
  const next = { ...cur, at: Date.now() };
  if (!run || !run.reqModel) { if (found.model) next.model = found.model; }
  if (!run || !run.effort) { if (found.effort) next.effort = found.effort; }
  setKV(key, next);
}

export async function observeRun(run) {
  try {
    if ((run.reqModel && run.effort) || !run.sessionId || run.status !== 'done') return;
    await forceRefresh();
    const s = await findSession(run.tool, run.sessionId);
    if (!s?.file) return;
    remember(run.tool, await modelEffortFromFile(run.tool, s.file), run);
  } catch { /* best effort */ }
}

/** First start: seed from the newest interactive Claude session so the label isn't blank. */
export async function seedDefaults() {
  if (getKV('observed_default_claude', null)) return;
  try {
    const root = path.join(HOME, '.claude', 'projects');
    let best = null;
    for (const d of fs.readdirSync(root)) {
      let ents = [];
      try { ents = fs.readdirSync(path.join(root, d)); } catch { continue; }
      for (const f of ents) {
        if (!f.endsWith('.jsonl')) continue;
        const p = path.join(root, d, f);
        const m = fs.statSync(p).mtimeMs;
        if (!best || m > best.m) best = { p, m };
      }
    }
    if (best) remember('claude', await modelEffortFromFile('claude', best.p), null);
  } catch { /* ignore */ }
}
