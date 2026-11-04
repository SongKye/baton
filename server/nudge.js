// Gentle reminders for projects that are drifting into the "forgotten" zone.
import { projectsList } from './indexer.js';
import { ensureBrief } from './brief.js';
import { notify } from './push.js';
import { getSettings, getKV, setKV, patchProjectMeta } from './store.js';
import { DAY, HOME } from './util.js';

/** Projects that are dozing (idle >= staleDays) but not abandoned/finished/snoozed. Sorted by priority. */
export function dozingProjects(projects, settings = getSettings()) {
  const now = Date.now();
  return projects
    .filter((p) => p.status === 'active'
      && p.id !== HOME && p.id !== HOME + '/workspace'
      && p.idleDays >= settings.staleDays
      && p.idleDays <= settings.forgetDays
      && !(p.snoozeUntil && p.snoozeUntil > now))
    .map((p) => ({ ...p, score: (p.pinned ? 2 : 1) * Math.log2(2 + p.sessions) * Math.min(p.idleDays, 60) }))
    .sort((a, b) => b.score - a.score);
}

export async function pickNudge({ ignoreCooldown = false } = {}) {
  const settings = getSettings();
  const now = Date.now();
  const list = dozingProjects(await projectsList(), settings)
    .filter((p) => ignoreCooldown || !p.lastNudged || now - p.lastNudged > settings.nudgeCooldownDays * DAY);
  return list[0] || null;
}

export async function sendNudge({ ignoreCooldown = false } = {}) {
  const p = await pickNudge({ ignoreCooldown });
  if (!p) return null;
  let brief = null;
  try { brief = await ensureBrief(p); } catch (e) { console.warn('[nudge] brief failed', e.message); }
  const next = brief?.next?.[0]?.title;
  const title = `💤 ${p.name} · ${p.idleDays}일째 쉬는 중`;
  const body = next
    ? `다음 할 일: ${next}\n이어서 해볼까요, 아니면 보류할까요?`
    : `${brief?.oneLiner || p.lastSession?.title || ''}\n이 프로젝트, 진행 예정이 있나요?`;
  await notify({ kind: 'nudge', title, body, url: `/#/p/${encodeURIComponent(p.id)}`, tag: `nudge-${p.id}` });
  patchProjectMeta(p.id, { last_nudged: Date.now() });
  return { project: p.id, title, body };
}

function localDay(d = new Date()) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Checks every 10 minutes; sends at most one nudge per day at the configured hour. */
export function startNudgeScheduler() {
  const tick = async () => {
    try {
      const s = getSettings();
      if (!s.nudgeEnabled) return;
      const d = new Date();
      if (d.getHours() !== s.nudgeHour) return;
      if (getKV('lastNudgeDay') === localDay(d)) return;
      setKV('lastNudgeDay', localDay(d));
      await sendNudge();
    } catch (e) {
      console.warn('[nudge] tick failed', e.message);
    }
  };
  setInterval(tick, 10 * 60 * 1000).unref();
  setTimeout(tick, 15000).unref();
}
