// Reads the result of the weekly CLI auto-verification (scripts/compat-weekly.mjs writes
// ~/.baton-compat/last-run.json), shows it in Settings and sends one notification per run:
// a push when something needs a look (a fix PR to review, a failure), an inbox entry otherwise.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { notify } from './push.js';
import { addEvent, getKV, setKV } from './store.js';
import { tr } from './i18n.js';

const BASE = path.join(os.homedir(), '.baton-compat');
const LAST_RUN = path.join(BASE, 'last-run.json');
const TIMER = path.join(os.homedir(), '.config', 'systemd', 'user', 'baton-compat.timer');
const NAMES = { claude: 'Claude Code', codex: 'Codex', agy: 'Antigravity', opencode: 'OpenCode' };

/** One translated line per CLI, e.g. "Codex 0.167.2: passed". */
function lines(run) {
  return (run.results || []).filter((r) => NAMES[r.tool]).map((r) => {
    const n = NAMES[r.tool];
    if (r.status === 'up-to-date') return tr('{name}: 새 버전 없음', { name: n });
    if (r.status === 'passed') return tr('{name} {v}: 통과', { name: n, v: r.to });
    if (r.status === 'passed-drift') return tr('{name} {v}: 통과 · 검토 필요', { name: n, v: r.to });
    if (r.status === 'failed') return `${tr('{name} {v}: 실패', { name: n, v: r.to })}${r.fix?.outcome === 'fixed' ? ` · ${tr('수정 PR을 만들었어요')}` : r.fix ? ` · ${tr('자동 수정 실패')}` : ''}`;
    if (r.status === 'skipped') return tr('{name}: 건너뜀 ({why})', { name: n, why: r.note || '?' });
    return tr('{name}: 오류 ({why})', { name: n, why: r.note || '?' });
  });
}

/** Summary for Settings (null if the auto-check never ran). */
export function compatRunInfo() {
  let run = null;
  try { run = JSON.parse(fs.readFileSync(LAST_RUN, 'utf8')); } catch { /* never ran */ }
  return {
    scheduled: fs.existsSync(TIMER),
    last: run ? {
      at: run.finishedAt || run.runAt, dryRun: Boolean(run.dryRun), needsAttention: Boolean(run.needsAttention),
      lines: run.fatal ? [tr('실행 중 오류: {why}', { why: run.fatal })] : lines(run),
      prs: (run.prs || []).filter((p) => p.url).map((p) => ({ url: p.url, kind: p.kind, merged: Boolean(p.merged) })),
    } : null,
  };
}

/** Notify once per finished run. */
function check() {
  let run;
  try { run = JSON.parse(fs.readFileSync(LAST_RUN, 'utf8')); } catch { return; }
  if (!run.finishedAt || run.dryRun || getKV('compat_seen_run') === run.runAt) return;
  setKV('compat_seen_run', run.runAt);
  const body = run.fatal ? tr('실행 중 오류: {why}', { why: run.fatal }) : lines(run).join(' · ');
  const open = (run.prs || []).find((p) => p.url && !p.merged);
  const url = open?.url || '/#/settings';
  if (run.needsAttention) notify({ kind: 'compat', title: tr('AI 도구 자동 검증: 확인이 필요해요'), body, url }).catch(() => {});
  else addEvent('compat', tr('AI 도구 자동 검증 완료'), body, url, { quiet: true });
}

export function startCompatWatch() {
  setTimeout(check, 30_000).unref();
  setInterval(check, 10 * 60_000).unref();
}
