// Make a skill from a plain-language request. An AI CLI writes the draft (SKILL.md + any helper files),
// you review / edit / ask for changes, then Baton writes it into every folder the chosen CLIs read —
// globally or inside one project. Also: load one of your skills for editing, copy it to other CLIs, delete it.
// Nothing outside the skill's own folder is touched; overwritten or deleted skills are backed up first.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { HOME, DATA_DIR, DAY, clip, shortHome } from './util.js';
import { PICK_DIRS, invalidateSkills, skillDetail, frontmatter } from './skills.js';
import { oneShot } from './runner.js';
import { binFor, TOOL_IDS } from './tools.js';
import { getSettings } from './store.js';
import { projectDocs, gitInfo, projectName } from './projects.js';
import { tr, lang } from './i18n.js';

export const SKILL_TOOLS = Object.keys(PICK_DIRS);
const BACKUPS = path.join(DATA_DIR, 'skill-backups');
const MAX_FILES = 12;
const MAX_FILE = 100_000;
const MAX_TOTAL = 400_000;
const fail = (msg, code) => Object.assign(new Error(msg), code ? { code } : {});

// ---------------------------------------------------------------- where it goes
/** A project folder the user chose: inside home, not home itself, and it exists. */
export function checkRoot(p) {
  const abs = path.resolve(String(p || '').replace(/^~(?=$|[\\/])/, HOME));
  const rel = path.relative(HOME, abs);
  if (!rel || rel.split(path.sep)[0] === '..' || path.isAbsolute(rel)) throw fail(tr('홈 폴더 안의 프로젝트 폴더를 골라주세요'));
  if (!fs.statSync(abs, { throwIfNoEntry: false })?.isDirectory()) throw fail(tr('폴더가 없어요: {p}', { p: shortHome(abs) }));
  return abs;
}

const dirsOf = (tool, scope, root) => (scope === 'project' ? PICK_DIRS[tool].project.map((r) => path.join(root, r)) : PICK_DIRS[tool].mine());

/**
 * The fewest skill folders that every chosen CLI reads: e.g. a project's .claude/skills covers Claude Code,
 * OpenCode and Cursor; .agents/skills covers Codex, Antigravity and OpenCode. Writing one copy per folder
 * (not per CLI) keeps a CLI that reads several folders from seeing the same skill twice.
 * -> [{ dir, tools }] where tools = the chosen CLIs that read `dir`.
 */
export function planTargets(tools, scope, root) {
  const want = [...new Set(tools || [])].filter((x) => PICK_DIRS[x]);
  if (!want.length) throw fail(tr('스킬을 쓸 CLI를 하나 이상 골라주세요'));
  if (scope === 'project' && !root) throw fail(tr('프로젝트 폴더를 골라주세요'));
  const cand = [];
  for (const x of want) for (const d of dirsOf(x, scope, root)) if (!cand.includes(d)) cand.push(d);
  const left = new Set(want);
  const out = [];
  while (left.size) {
    let best = null, cover = [];
    for (const d of cand) {
      const c = [...left].filter((x) => dirsOf(x, scope, root).includes(d));
      if (c.length > cover.length) { best = d; cover = c; }
    }
    for (const x of cover) left.delete(x);
    out.push({ dir: best, tools: want.filter((x) => dirsOf(x, scope, root).includes(best)) });
  }
  return out;
}

export function targetsPreview(q) {
  const scope = q.scope === 'project' ? 'project' : 'global';
  const root = scope === 'project' ? checkRoot(q.project) : null;
  return { targets: planTargets(String(q.tools || '').split(',').filter(Boolean), scope, root).map((x) => ({ dir: shortHome(x.dir), tools: x.tools })) };
}

// ---------------------------------------------------------------- validation
// "synced" is the folder claude.ai skills sync into (~/.claude/skills/synced)
export function validName(n) {
  return typeof n === 'string' && n.length <= 64 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(n) && n !== 'synced';
}
const nameError = () => fail(tr('이름은 영어 소문자·숫자·하이픈(-)만, 64자까지 쓸 수 있어요 (예: commit-message)'));

/** One line, no angle brackets (Codex rejects them), at most 1024 characters. */
export function cleanDescription(d) {
  const s = String(d || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  if (!s) throw fail(tr('설명을 적어주세요. 에이전트는 이 설명을 보고 스킬을 쓸지 정해요'));
  if (s.length > 1024) throw fail(tr('설명이 너무 길어요 ({n}자). 1024자 안으로 줄여주세요', { n: s.length }));
  return s;
}

/** A helper file path inside the skill folder: relative, no `..`, not SKILL.md itself. */
export function cleanRel(p) {
  const s = String(p || '').replace(/\\/g, '/').replace(/^(\.\/)+/, '').trim();
  if (!s || s.startsWith('/') || /^[A-Za-z]:/.test(s) || s.length > 160) return null;
  const parts = s.split('/');
  if (parts.length > 4 || parts.some((x) => !x || x === '.' || x === '..')) return null;
  if (s.toLowerCase() === 'skill.md') return null;
  return s;
}

function cleanFiles(files) {
  const out = [];
  let total = 0;
  for (const f of [].concat(files || [])) {
    const rel = cleanRel(f?.path);
    if (!rel) throw fail(tr('파일 경로가 올바르지 않아요: {p}', { p: String(f?.path || '') }));
    if (out.some((x) => x.path === rel)) throw fail(tr('같은 파일이 두 번 있어요: {p}', { p: rel }));
    const content = String(f.content ?? '');
    if (content.length > MAX_FILE) throw fail(tr('파일이 너무 커요: {p}', { p: rel }));
    total += content.length;
    out.push({ path: rel, content });
  }
  if (out.length > MAX_FILES) throw fail(tr('추가 파일은 {n}개까지예요', { n: MAX_FILES }));
  if (total > MAX_TOTAL) throw fail(tr('파일이 너무 커요: {p}', { p: '…' }));
  return out;
}

// plain YAML when it is unambiguous, otherwise a double-quoted (JSON-compatible) scalar
const yamlStr = (s) => (/^[A-Za-z0-9가-힣(][^:#"'`|>{}[\]]*$/.test(s) && !/\s$/.test(s) ? s : JSON.stringify(s));

/** Frontmatter lines other than name/description (kept as-is when editing an existing skill). */
export function extraFrontmatter(text) {
  const m = String(text || '').match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return '';
  const keep = [];
  let skipping = false;
  for (const line of m[1].split('\n')) {
    const key = line.match(/^([A-Za-z_-]+):/)?.[1];
    if (key) skipping = key === 'name' || key === 'description'; // other lines belong to the key above them
    if (!skipping) keep.push(line);
  }
  return keep.join('\n').trim();
}

export function buildSkillMd({ name, description, body, extraFront = '' }) {
  const extra = String(extraFront || '').trim();
  return `---\nname: ${name}\ndescription: ${yamlStr(description)}\n${extra ? `${extra}\n` : ''}---\n\n${String(body || '').trim()}\n`;
}

// ---------------------------------------------------------------- the draft (AI)
/** Splits the writer's "=== path ===" sections into SKILL.md fields, helper files and Baton notes. */
export function parseBundle(text) {
  let src = String(text || '').replace(/\r\n/g, '\n').trim();
  const fenced = src.match(/^```[\w-]*\n([\s\S]*)\n```$/); // the whole answer wrapped in one fence
  if (fenced) src = fenced[1];
  const sections = [];
  let cur = null;
  for (const line of src.split('\n')) {
    // "=== scripts/run.sh ===" starts a file; "=== Usage ===" inside a body (no dot or slash) does not
    const m = line.match(/^={3,}\s*(?:FILE:\s*)?([^=\s][^=]*?)\s*={3,}\s*$/);
    if (m && /[./]/.test(m[1])) { cur = { path: m[1].trim(), lines: [] }; sections.push(cur); continue; }
    cur?.lines.push(line);
  }
  const text0 = (s) => s.lines.join('\n').replace(/^\n+|\s+$/g, '');
  const skill = sections.find((s) => s.path.toLowerCase() === 'skill.md');
  if (!skill) throw fail(tr('AI 답변에서 SKILL.md를 찾지 못했어요. 다시 시도해주세요'));
  const md = text0(skill);
  const fm = frontmatter(md);
  const body = md.replace(/^---\s*\n[\s\S]*?\n---\s*/, '').trim();
  let meta = {};
  const metaSec = sections.find((s) => s.path.toLowerCase() === 'baton.json');
  if (metaSec) {
    const raw = text0(metaSec).replace(/^```\w*\n|\n```$/g, '');
    try { meta = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) || {}; } catch { meta = {}; }
  }
  const files = sections.filter((s) => s !== skill && s !== metaSec).map((s) => ({ path: cleanRel(s.path), content: `${text0(s)}\n` })).filter((f) => f.path).slice(0, MAX_FILES);
  const list = (v, n) => [].concat(v || []).map((x) => String(x).trim()).filter(Boolean).slice(0, n);
  const rawName = String(fm.name || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
  return {
    name: rawName, description: String(fm.description || '').replace(/\s+/g, ' ').trim(), body, files,
    extraFront: extraFrontmatter(md),
    summary: String(meta.summary || '').trim(), assumptions: list(meta.assumptions, 5), tryPrompts: list(meta.tryPrompts, 3), similar: String(meta.similar || '').trim(),
  };
}

const TOOL_NAMES = { claude: 'Claude Code', codex: 'Codex', agy: 'Antigravity', opencode: 'OpenCode', cursor: 'Cursor' };

async function existingNames(scope, root) {
  const dirs = new Set();
  for (const x of SKILL_TOOLS) for (const d of PICK_DIRS[x].mine()) dirs.add(d);
  if (scope === 'project' && root) for (const x of SKILL_TOOLS) for (const r of PICK_DIRS[x].project) dirs.add(path.join(root, r));
  const names = new Set();
  for (const d of dirs) for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'synced') names.add(e.name);
  return [...names].sort();
}

async function projectMaterial(root) {
  const parts = [`Project: ${projectName(root)} (${shortHome(root)})`];
  try {
    const ents = (await fsp.readdir(root, { withFileTypes: true })).filter((e) => !['node_modules', '.git'].includes(e.name)).slice(0, 80);
    parts.push(`Top-level entries: ${ents.map((e) => e.name + (e.isDirectory() ? '/' : '')).join(', ')}`);
  } catch { /* unreadable */ }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    parts.push(`package.json: name=${pkg.name || '?'}; scripts=${JSON.stringify(pkg.scripts || {})}`);
  } catch { /* not a node project */ }
  const git = await gitInfo(root).catch(() => null);
  if (git) parts.push(`git branch ${git.branch || '?'}; recent commits:\n${git.commits.slice(0, 8).map((c) => `- ${c.subject}`).join('\n')}`);
  for (const d of projectDocs(root)) parts.push(`## ${d.file} (beginning)\n${clip(d.text, 2500)}`);
  return parts.join('\n\n');
}

const bundleText = (d) => [
  `=== SKILL.md ===\n${buildSkillMd({ name: d.name || 'unnamed', description: d.description || '', body: d.body || '', extraFront: d.extraFront })}`,
  ...(d.files || []).map((f) => `=== ${f.path} ===\n${f.content}`),
].join('\n');

export function draftPrompt({ request, feedback, previous, fixedName, tools, scope, root, names, material, language }) {
  const toolList = tools.map((x) => TOOL_NAMES[x] || x).join(', ');
  return `You write Agent Skills: folders holding a SKILL.md that coding agents (Claude Code, Codex, Antigravity, OpenCode, Cursor) load on demand.
${previous ? 'Revise the skill below as the user asks.' : 'Turn the user\'s request into one complete skill that works on the first try.'}

How agents use a skill:
- Before every task the agent sees only each skill's name and description and decides from those alone whether to load it. The description is the trigger.
- When it applies, the agent reads the SKILL.md body and follows it. Helper files are read or run only when the body points to them.

Write it well:
- name: lowercase letters, digits and single hyphens, at most 40 characters, short and action-oriented (e.g. "commit-message", "release-notes"). Always English.${fixedName ? ` Keep exactly: ${fixedName}` : ''}
- description: ONE line, at most 400 characters, third person. Say what the skill does AND when to use it: the situations, plus 2-4 literal phrases the user would type, quoted, in ${language}. Add a "Not for ..." boundary only if it prevents a likely mix-up. No angle brackets.
- body: Markdown in ${language}. The agent is already a capable engineer, so include only what changes its decisions: the goal, the steps or decision rules, the conventions and output format to follow, how to check the result, and what not to do. Imperative voice. Show a short example when an output format matters. Usually 20-120 lines; no filler, no generic advice.
- Ask yourself what an agent would get wrong without this skill, and make sure the skill fixes exactly that.
- Stay within the request. Don't add steps that push, publish, deploy, delete data, spend money or contact outside services unless asked; if the workflow needs one, have the agent confirm with the user first.
- Helper files only when they clearly help: scripts/ for deterministic, repeated operations (complete and runnable, no placeholders, bash/node/python standard library only, and the body says when and how to run them); references/ for long material the body links to by relative path. No README, changelog or install guide.
- Never invent facts about the project (commands, paths, tools). Use what the project material shows; otherwise write the step so the agent finds out (e.g. "use the test command from package.json scripts").
- It must work in: ${toolList}. Use only name and description in the frontmatter. Describe actions generically ("run the tests", "read the file") instead of naming one CLI's internal tools.
- If something is ambiguous, pick the most sensible option and list it under assumptions.

Output exactly these sections and nothing else: no text before or after, no code fences around sections.
=== SKILL.md ===
---
name: ...
description: ...
---
(body)
=== scripts/example.sh ===
(zero or more helper files like this one, each with a path relative to the skill folder; omit when not needed)
=== baton.json ===
{"summary": "one sentence in ${language}: what this skill makes the agent do", "assumptions": ["choices you made that the user may want to change, in ${language}, at most 4"], "tryPrompts": ["2-3 realistic requests in ${language} that should trigger this skill"], "similar": "name of an existing skill that overlaps, or empty"}

Where it will be installed: ${scope === 'project' ? `only inside the project ${shortHome(root)} (agents see it when working in that folder)` : 'globally (every folder)'}.
Existing skill names (don't reuse one; mention a real overlap in "similar"): ${names.length ? names.join(', ') : '(none)'}
${material ? `\n--- project material ---\n${material}\n` : ''}
--- user request ---
${request || '(editing an existing skill; see the current version below)'}
${previous ? `\n--- current version ---\n${bundleText(previous)}\n\n--- requested changes ---\n${feedback || 'Improve it: sharper description, tighter and more useful body.'}\nRewrite the whole skill with these changes; keep what still fits. Output every file again, unchanged helper files included: a file you leave out is deleted.` : ''}`;
}

/** The CLI that writes drafts: the one asked for, else the brief/summary CLI, else any installed one. */
export function writerTool(asked) {
  if (asked && TOOL_IDS.includes(asked) && binFor(asked)) return asked;
  const st = getSettings();
  if (binFor(st.briefTool)) return st.briefTool;
  const any = TOOL_IDS.find((id) => binFor(id));
  if (!any) throw fail(tr('먼저 설치해주세요'));
  return any;
}

const drafts = new Map();
const publicDraft = (j) => ({ id: j.id, status: j.status, tool: j.tool, startedAt: j.startedAt, endedAt: j.endedAt || null, draft: j.draft || null, error: j.error || null });

/** Start writing a draft in the background. body: { request, tools, scope, project, writer, previous?, feedback?, fixedName? } */
export async function startDraft(b = {}) {
  const request = String(b.request || '').trim().slice(0, 6000);
  const previous = b.previous && typeof b.previous === 'object' ? { ...b.previous, files: cleanFiles(b.previous.files) } : null;
  if (!request && !previous) throw fail(tr('어떤 스킬이 필요한지 적어주세요'));
  const scope = b.scope === 'project' ? 'project' : 'global';
  const root = scope === 'project' ? checkRoot(b.project) : null;
  const tools = [...new Set([].concat(b.tools || []))].filter((x) => PICK_DIRS[x]);
  if (!tools.length) throw fail(tr('스킬을 쓸 CLI를 하나 이상 골라주세요'));
  const fixedName = b.fixedName && validName(b.fixedName) ? b.fixedName : '';
  const tool = writerTool(b.writer);
  const language = /[가-힣]/.test(request + (b.feedback || '')) || (!request && lang() === 'ko') ? 'Korean' : 'English';
  const prompt = draftPrompt({
    request, feedback: String(b.feedback || '').trim().slice(0, 4000), previous, fixedName, tools, scope, root, language,
    names: (await existingNames(scope, root)).filter((n) => n !== fixedName), material: root ? await projectMaterial(root) : '',
  });
  for (const [id, j] of drafts) if (j.endedAt && Date.now() - j.endedAt > 3600_000) drafts.delete(id);
  const job = { id: crypto.randomUUID(), status: 'running', tool, startedAt: Date.now(), ctl: new AbortController() };
  drafts.set(job.id, job);
  oneShot({ tool, model: '', prompt, timeoutMs: 6 * 60_000, signal: job.ctl.signal, failLabel: tr('스킬 초안을 만들지 못했어요') })
    .then((out) => {
      const d = parseBundle(out);
      if (fixedName) d.name = fixedName;
      if (previous && !d.extraFront) d.extraFront = previous.extraFront || '';
      Object.assign(job, { status: 'done', draft: d });
    })
    .catch((e) => Object.assign(job, { status: 'error', error: e.message }))
    .finally(() => { job.endedAt = Date.now(); });
  return publicDraft(job);
}

export function draftStatus(id) {
  const j = drafts.get(id);
  return j ? publicDraft(j) : null;
}

export function cancelDraft(id) {
  const j = drafts.get(id);
  if (!j || j.status !== 'running') return false;
  j.ctl.abort();
  return true;
}

// ---------------------------------------------------------------- your own skills on disk
/** A skill Baton may edit or delete: a SKILL.md folder directly inside one of the CLIs' own skill folders. */
async function ownedSkill(id) {
  const s = await skillDetail(id);
  if (!s?.path || s.kind !== 'skill' || !['global', 'project'].includes(s.scope)) return null;
  const dir = path.dirname(s.path);
  const parent = path.dirname(dir);
  const roots = new Set();
  for (const x of SKILL_TOOLS) {
    for (const d of PICK_DIRS[x].mine()) roots.add(d);
    if (s.project) for (const r of PICK_DIRS[x].project) roots.add(path.join(s.project, r));
  }
  if (!roots.has(parent) || dir.split(path.sep).includes('synced')) return null;
  return { ...s, dir };
}

async function textFiles(dir) {
  const out = [], skipped = [];
  const walk = async (d, depth) => {
    for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(d, e.name);
      const rel = path.relative(dir, full).split(path.sep).join('/');
      if (rel === 'SKILL.md' || e.name === '.DS_Store') continue;
      if (e.isDirectory()) { if (depth < 3 && e.name !== 'node_modules' && e.name !== '.git') await walk(full, depth + 1); else skipped.push(`${rel}/`); continue; }
      if (!e.isFile()) { skipped.push(rel); continue; }
      const st = await fsp.stat(full).catch(() => null);
      if (!st || st.size > MAX_FILE || out.length >= MAX_FILES) { skipped.push(rel); continue; }
      const buf = await fsp.readFile(full).catch(() => null);
      if (!buf || buf.includes(0)) { skipped.push(rel); continue; } // binary (images, fonts…) stays untouched
      out.push({ path: rel, content: buf.toString('utf8') });
    }
  };
  await walk(dir, 1);
  return { files: out, skipped };
}

/** The editable parts of one of your skills (for the editor). */
export async function skillSource(id) {
  const s = await ownedSkill(id);
  if (!s) return null;
  const md = await fsp.readFile(s.path, 'utf8');
  const fm = frontmatter(md);
  const { files, skipped } = await textFiles(s.dir);
  return {
    id, name: path.basename(s.dir), description: String(fm.description || ''), body: md.replace(/^---\s*\n[\s\S]*?\n---\s*/, '').trim(),
    extraFront: extraFrontmatter(md), files, skipped, tool: s.tool, scope: s.scope, project: s.project || null,
    readers: s.readers, dir: shortHome(s.dir),
  };
}

async function backup(dir, name) {
  await fsp.mkdir(BACKUPS, { recursive: true });
  const dst = path.join(BACKUPS, `${new Date().toISOString().replace(/[:.]/g, '-')}-${name}`);
  await fsp.cp(dir, dst, { recursive: true, dereference: true });
  // keep a month of backups
  for (const n of await fsp.readdir(BACKUPS).catch(() => [])) {
    const p = path.join(BACKUPS, n);
    const st = await fsp.stat(p).catch(() => null);
    if (st && Date.now() - st.mtimeMs > 30 * DAY) await fsp.rm(p, { recursive: true, force: true }).catch(() => {});
  }
  return dst;
}

async function writeSkillDir(dir, md, files, remove = []) {
  await fsp.mkdir(dir, { recursive: true });
  for (const rel of remove) {
    const r = cleanRel(rel);
    if (r) await fsp.rm(path.join(dir, r), { force: true });
  }
  await fsp.writeFile(path.join(dir, 'SKILL.md'), md);
  for (const f of files) {
    const p = path.join(dir, f.path);
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, f.content.endsWith('\n') ? f.content : `${f.content}\n`);
    if (f.content.startsWith('#!')) await fsp.chmod(p, 0o755).catch(() => {});
  }
}

const idOf = (dir) => Buffer.from(path.join(dir, 'SKILL.md')).toString('base64url');

/**
 * Save a new skill, or your edits to one. body: { name, description, body, files, extraFront,
 *   tools, scope, project, overwrite } | { editId, description, body, files, remove, extraFront }
 */
export async function saveSkill(b = {}) {
  const description = cleanDescription(b.description);
  const body = String(b.body || '').trim();
  if (!body) throw fail(tr('본문(SKILL.md 내용)을 적어주세요'));
  const files = cleanFiles(b.files);
  if (b.editId) {
    const s = await ownedSkill(String(b.editId));
    if (!s) throw fail(tr('이 스킬은 여기서 고칠 수 없어요'));
    const name = path.basename(s.dir);
    const bak = await backup(s.dir, name);
    await writeSkillDir(s.dir, buildSkillMd({ name, description, body, extraFront: b.extraFront }), files, [].concat(b.remove || []));
    invalidateSkills();
    return { name, id: idOf(s.dir), written: [{ dir: shortHome(s.dir), tools: s.readers }], backup: shortHome(bak) };
  }
  const name = String(b.name || '').trim();
  if (!validName(name)) throw nameError();
  const scope = b.scope === 'project' ? 'project' : 'global';
  const root = scope === 'project' ? checkRoot(b.project) : null;
  const targets = planTargets([].concat(b.tools || []), scope, root).map((x) => ({ ...x, dir: path.join(x.dir, name) }));
  const taken = targets.filter((x) => fs.existsSync(x.dir));
  if (taken.length && !b.overwrite) throw fail(tr('같은 이름의 스킬이 이미 있어요: {list}', { list: taken.map((x) => shortHome(x.dir)).join(', ') }), 'EXISTS');
  const md = buildSkillMd({ name, description, body, extraFront: b.extraFront });
  const backups = [];
  for (const x of targets) {
    if (fs.existsSync(x.dir)) { backups.push(shortHome(await backup(x.dir, name))); await fsp.rm(x.dir, { recursive: true, force: true }); }
    await writeSkillDir(x.dir, md, files);
  }
  invalidateSkills();
  const id = idOf(targets[0].dir);
  // a project folder Baton has no sessions for isn't scanned by the skills page
  const listed = Boolean(await skillDetail(id).catch(() => null));
  return { name, id, listed, written: targets.map((x) => ({ dir: shortHome(x.dir), tools: x.tools })), backups, cwd: root ? shortHome(root) : null };
}

/** Copy a skill folder (as-is, helper files included) so other CLIs load it too. Same scope as the original. */
export async function copySkill(id, tools) {
  const s = await skillDetail(String(id || ''));
  if (!s?.path || s.kind !== 'skill' || s.scope === 'unlisted') throw fail(tr('이 스킬은 복사할 수 없어요'));
  const src = path.dirname(s.path);
  const name = path.basename(src);
  const scope = s.scope === 'project' && s.project ? 'project' : 'global';
  const want = [].concat(tools || []).filter((x) => PICK_DIRS[x] && !(s.readers || []).includes(x));
  if (!want.length) throw fail(tr('이미 고른 CLI 모두 이 스킬을 읽고 있어요'));
  const results = [];
  for (const x of planTargets(want, scope, s.project)) {
    const dst = path.join(x.dir, name);
    if (fs.existsSync(dst)) { results.push({ dir: shortHome(dst), tools: x.tools, ok: false, error: tr('같은 이름의 스킬이 이미 있어요') }); continue; }
    try {
      await fsp.mkdir(x.dir, { recursive: true });
      await fsp.cp(src, dst, { recursive: true, dereference: true, filter: (p) => !p.split(path.sep).includes('node_modules') });
      results.push({ dir: shortHome(dst), tools: x.tools, ok: true });
    } catch (e) { results.push({ dir: shortHome(dst), tools: x.tools, ok: false, error: e.message }); }
  }
  invalidateSkills();
  return { name, results };
}

/** Delete one of your skills; the folder is kept in data/skill-backups for 30 days. */
export async function deleteSkill(id) {
  const s = await ownedSkill(String(id || ''));
  if (!s) throw fail(tr('이 스킬은 여기서 지울 수 없어요'));
  const bak = await backup(s.dir, path.basename(s.dir));
  await fsp.rm(s.dir, { recursive: true, force: true });
  invalidateSkills();
  return { ok: true, backup: shortHome(bak) };
}
