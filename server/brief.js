// "Where did I leave off?" — AI-generated project briefs.
import { decoratedSessions, findSession, readMessages, sessionsOfProject } from './indexer.js';
import { gitInfo, projectDocs, projectName, projectFingerprint } from './projects.js';
import { getBrief, saveBrief, getSettings } from './store.js';
import { oneShot } from './runner.js';
import { DATA_DIR, clip, oneLine, shortHome } from './util.js';

const inflight = new Map();

function fmtDate(ts) {
  return ts ? new Date(ts).toISOString().slice(0, 16).replace('T', ' ') : '?';
}

async function buildContext(root) {
  const all = await decoratedSessions({ includeAutomated: true, includeHidden: true });
  const sessions = sessionsOfProject(all, root).sort((a, b) => b.updated - a.updated);
  const human = sessions.filter((s) => !s.automated);
  const picked = (human.length ? human : sessions).slice(0, 4);
  const parts = [];
  parts.push(`# 프로젝트: ${projectName(root)} (${shortHome(root)})`);
  parts.push(`세션 수: ${sessions.length} (사람이 연 세션 ${human.length}), 마지막 활동: ${fmtDate(sessions[0]?.updated)}, 첫 활동: ${fmtDate(sessions.at(-1)?.created)}`);
  const git = await gitInfo(root);
  if (git) {
    parts.push(`\n## git (branch ${git.branch || '?'}, 미커밋 변경 ${git.dirty}개)`);
    for (const c of git.commits.slice(0, 12)) parts.push(`- ${fmtDate(c.ts)} ${c.subject}`);
    if (git.changed.length) parts.push(`미커밋 파일: ${git.changed.slice(0, 15).map((l) => l.slice(3)).join(', ')}`);
  }
  for (const d of projectDocs(root)) {
    parts.push(`\n## ${d.file} (앞부분)\n${clip(d.text, 1800)}`);
  }
  for (const s of picked) {
    const full = await findSession(s.tool, s.id);
    const msgs = await readMessages(full);
    const users = msgs.filter((m) => m.role === 'user').slice(-10);
    const replies = msgs.filter((m) => m.role === 'assistant').slice(-3);
    parts.push(`\n## 세션 [${s.tool}] "${s.title}" (${fmtDate(s.created)} ~ ${fmtDate(s.updated)}, 메시지 ${msgs.length}개)`);
    parts.push('사용자 요청(최근순 아님, 시간순):');
    for (const u of users) parts.push(`- ${clip(oneLine(u.text), 320)}`);
    parts.push('에이전트 마지막 답변들:');
    for (const r of replies) parts.push(`> ${clip(oneLine(r.text), 900)}`);
  }
  return { text: parts.join('\n'), sessions };
}

const PROMPT = (ctx) => `너는 바이브코딩 개발자의 프로젝트 매니저 비서야. 개발자는 여러 프로젝트를 AI 코딩 에이전트(Claude Code, Codex, Antigravity)로 동시에 진행하다가 어디까지 했는지 자주 잊어버려.
아래 자료(대화 세션 기록, git 로그, 문서)를 보고 이 프로젝트를 "다시 이어서 하려는 사람"이 바로 행동할 수 있도록 브리핑을 만들어.

규칙:
- 반드시 한국어, 짧고 구체적으로. 추측은 "(추정)" 표시.
- next[].prompt 는 개발자가 에이전트에게 그대로 보낼 수 있는 구체적인 요청문(1~3문장)으로 써.
- 자료에 없는 사실을 지어내지 마.
- 출력은 JSON 하나만. 코드블록/설명 없이.

JSON 형식:
{
  "what": "이 프로젝트가 무엇인지 한 줄",
  "oneLiner": "현재 상태를 한 문장으로 (예: 3D 자물쇠 회전까지 구현, 결제 연동 전)",
  "progress": 0~100 정수 (완성도 추정),
  "phase": "아이디어|설계|구현 초기|구현 중반|마무리|운영/유지보수 중 하나",
  "lastDone": ["최근에 끝낸 일 (최대 4개)"],
  "next": [{"title": "다음 할 일 (짧게)", "why": "왜 지금 이걸 해야 하는지 한 줄", "prompt": "에이전트에게 보낼 요청문"}],
  "openQuestions": ["결정이 필요한 것 / 막힌 것 (최대 3개, 없으면 빈 배열)"],
  "resumeTip": "다시 시작할 때 첫 5분 동안 할 일 한 줄"
}

--- 자료 ---
${ctx}`;

function parseJson(text) {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error('JSON을 찾지 못했어요');
  const j = JSON.parse(text.slice(s, e + 1));
  return {
    what: String(j.what || ''),
    oneLiner: String(j.oneLiner || ''),
    progress: Number.isFinite(+j.progress) ? Math.max(0, Math.min(100, Math.round(+j.progress))) : null,
    phase: String(j.phase || ''),
    lastDone: (j.lastDone || []).map(String).slice(0, 5),
    next: (j.next || []).slice(0, 4).map((n) => ({ title: String(n.title || ''), why: String(n.why || ''), prompt: String(n.prompt || '') })),
    openQuestions: (j.openQuestions || []).map(String).slice(0, 4),
    resumeTip: String(j.resumeTip || ''),
  };
}

/** Generate (or reuse) a brief. `force` regenerates even if fingerprint unchanged. */
export async function ensureBrief(project, { force = false } = {}) {
  const fp = projectFingerprint(project);
  const cur = getBrief(project.id);
  if (!force && cur && cur.fingerprint === fp) return cur;
  if (inflight.has(project.id)) return inflight.get(project.id);
  const p = (async () => {
    const { text } = await buildContext(project.id);
    const st = getSettings();
    const out = await oneShot({ tool: st.briefTool, model: st.briefModel, prompt: PROMPT(clip(text, 40000)), cwd: DATA_DIR });
    const brief = parseJson(out);
    saveBrief(project.id, fp, brief);
    return getBrief(project.id);
  })().finally(() => inflight.delete(project.id));
  inflight.set(project.id, p);
  return p;
}

export function briefPending(id) {
  return inflight.has(id);
}
