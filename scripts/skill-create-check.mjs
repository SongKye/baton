// Regression checks for "new skill" (server/skill-create.js): where skills go, parsing the AI draft,
// saving / editing / copying / deleting. Runs against a throwaway HOME; no CLI or AI is called.
//   node scripts/skill-create-check.mjs
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'baton-skillhome-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.BATON_NO_SHELL_ENV = '1';
for (const k of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME']) delete process.env[k];

const sc = await import('../server/skill-create.js');
const { frontmatter, invalidateSkills, skillsReport } = await import('../server/skills.js');
const made = [];
const J = (...p) => path.join(home, ...p);
const u = (s) => s.replace(/\\/g, '/'); // shortHome keeps Windows separators
try {
  // ---- where skills go: the fewest folders every chosen CLI reads
  const all = ['claude', 'codex', 'agy', 'opencode', 'cursor'];
  let plan = sc.planTargets(all, 'global');
  assert.deepEqual(plan.map((x) => x.dir), [J('.claude/skills'), J('.codex/skills'), J('.gemini/config/skills'), J('.cursor/skills')]);
  assert.deepEqual(plan[0].tools, ['claude', 'opencode'], 'OpenCode reads ~/.claude/skills');
  assert.deepEqual(sc.planTargets(['codex', 'opencode'], 'global').map((x) => x.dir), [J('.agents/skills')], 'one shared folder');
  const proj = J('work', 'app');
  await fsp.mkdir(proj, { recursive: true });
  plan = sc.planTargets(all, 'project', proj);
  assert.deepEqual(plan.map((x) => x.dir), [path.join(proj, '.claude/skills'), path.join(proj, '.agents/skills')]);
  assert.deepEqual(plan[1].tools, ['codex', 'agy', 'opencode']);
  assert.throws(() => sc.planTargets([], 'global'));
  assert.throws(() => sc.checkRoot(home), 'home itself is not a project');
  assert.throws(() => sc.checkRoot(os.tmpdir()), 'outside home');
  assert.equal(sc.checkRoot('~/work/app'), proj);

  // ---- names, descriptions, paths
  assert(sc.validName('commit-message') && !sc.validName('Commit') && !sc.validName('a--b') && !sc.validName('-a') && !sc.validName('synced') && !sc.validName('x'.repeat(65)));
  assert.equal(sc.cleanDescription('  Writes <b>commit</b>\n messages  '), 'Writes bcommit/b messages');
  assert.throws(() => sc.cleanDescription(' '));
  assert.equal(sc.cleanRel('./scripts/run.sh'), 'scripts/run.sh');
  for (const bad of ['../x', '/etc/passwd', 'a/../../b', 'SKILL.md', 'C:/x', 'a//b', '']) assert.equal(sc.cleanRel(bad), null, bad);

  // ---- SKILL.md round trip (quotes, colons, Korean) and kept frontmatter
  const desc = 'Writes commit messages: use when the user says "커밋해줘" or \'commit this\'. Not for PR text #1';
  const md = sc.buildSkillMd({ name: 'commit-message', description: desc, body: '# Commit\n\nDo it.', extraFront: 'metadata:\n  short-description: Commit' });
  assert.equal(frontmatter(md).description, desc);
  assert.equal(frontmatter(md).name, 'commit-message');
  assert.equal(sc.extraFrontmatter(md), 'metadata:\n  short-description: Commit');
  assert.equal(frontmatter('---\nname: x\ndescription: >-\n  Folded text\n  continues\n---\n').description, 'Folded text continues');
  assert.equal(sc.extraFrontmatter('---\nname: x\ndescription: >-\n  a\n  b\nallowed-tools:\n- Bash\n---'), 'allowed-tools:\n- Bash');

  // ---- parsing the writer's answer
  const answer = `Sure! Here it is.
=== SKILL.md ===
---
name: Release Notes
description: Drafts release notes from git history. Use when the user says "릴리스 노트 써줘".
---
# Release notes

=== Usage ===
Run the script.
=== scripts/log.sh ===
#!/usr/bin/env bash
git log --oneline "$1"..HEAD
=== ../evil.sh ===
rm -rf /
=== baton.json ===
{"summary": "릴리스 노트를 써요", "assumptions": ["마지막 태그부터"], "tryPrompts": ["릴리스 노트 써줘", "변경 사항 정리"], "similar": ""}
`;
  const d = sc.parseBundle(answer);
  assert.equal(d.name, 'release-notes', 'name normalized');
  assert.match(d.description, /^Drafts release notes/);
  assert.match(d.body, /=== Usage ===\nRun the script\./, '"=== Usage ===" stays in the body');
  assert.deepEqual(d.files.map((f) => f.path), ['scripts/log.sh'], 'unsafe paths dropped');
  assert.deepEqual(d.tryPrompts, ['릴리스 노트 써줘', '변경 사항 정리']);
  assert.equal(sc.parseBundle('```\n' + answer.split('\n').slice(1).join('\n').trim() + '\n```').name, 'release-notes', 'one wrapping fence is fine');
  assert.throws(() => sc.parseBundle('no skill here'));
  const prompt = sc.draftPrompt({ request: '커밋 메시지 스킬', tools: ['claude', 'codex'], scope: 'global', names: ['ship'], material: '', language: 'Korean' });
  assert(prompt.includes('Claude Code, Codex') && prompt.includes('ship') && prompt.includes('커밋 메시지 스킬'));

  // ---- save a new global skill for Claude Code + Codex
  const draft = { name: 'release-notes', description: d.description, body: d.body, files: d.files, tools: ['claude', 'codex'], scope: 'global' };
  let r = await sc.saveSkill(draft);
  assert.deepEqual(r.written.map((x) => u(x.dir)), ['~/.claude/skills/release-notes', '~/.codex/skills/release-notes']);
  assert(r.listed, 'shows up on the skills page');
  const script = J('.claude/skills/release-notes/scripts/log.sh');
  assert(fs.readFileSync(script, 'utf8').startsWith('#!/usr/bin/env bash'));
  if (process.platform !== 'win32') assert(fs.statSync(script).mode & 0o100, 'scripts with a shebang are executable');
  assert.equal(frontmatter(fs.readFileSync(J('.codex/skills/release-notes/SKILL.md'), 'utf8')).description, d.description);
  await assert.rejects(sc.saveSkill(draft), (e) => e.code === 'EXISTS');
  r = await sc.saveSkill({ ...draft, body: '# v2', overwrite: true });
  made.push(...r.backups);
  assert.equal(r.backups.length, 2);
  assert.match(fs.readFileSync(J('.claude/skills/release-notes/SKILL.md'), 'utf8'), /# v2/);
  await assert.rejects(sc.saveSkill({ ...draft, name: 'Bad Name' }));
  await assert.rejects(sc.saveSkill({ ...draft, name: 'x2', files: [{ path: '../x', content: '' }] }));

  // ---- project skill
  r = await sc.saveSkill({ ...draft, name: 'deploy-check', tools: ['codex', 'agy'], scope: 'project', project: '~/work/app' });
  assert.deepEqual(r.written.map((x) => u(x.dir)), ['~/work/app/.agents/skills/deploy-check']);

  // ---- edit one of your skills: load, change, drop a file, keep the folder name
  invalidateSkills();
  const rep = await skillsReport();
  const mine = rep.skills.find((s) => s.path === J('.claude/skills/release-notes/SKILL.md'));
  assert(mine, 'listed');
  const src = await sc.skillSource(mine.id);
  assert.deepEqual(src.files.map((f) => f.path), ['scripts/log.sh']);
  assert.deepEqual(src.readers, ['claude', 'opencode']);
  r = await sc.saveSkill({ editId: mine.id, description: 'Edited.', body: '# v3', files: [{ path: 'references/notes.md', content: 'n' }], remove: ['scripts/log.sh'] });
  made.push(r.backup);
  assert(!fs.existsSync(script) && fs.existsSync(J('.claude/skills/release-notes/references/notes.md')));
  assert.equal(frontmatter(fs.readFileSync(J('.claude/skills/release-notes/SKILL.md'), 'utf8')).description, 'Edited.');

  // ---- copy to other CLIs, then delete
  r = await sc.copySkill(mine.id, ['claude', 'agy', 'cursor']);
  assert.deepEqual(r.results.map((x) => [u(x.dir), x.ok]), [['~/.gemini/config/skills/release-notes', true], ['~/.cursor/skills/release-notes', true]]);
  assert(fs.existsSync(J('.cursor/skills/release-notes/references/notes.md')));
  await assert.rejects(sc.copySkill(mine.id, ['claude']), 'already reads it');
  r = await sc.deleteSkill(mine.id);
  made.push(r.backup);
  assert(!fs.existsSync(J('.claude/skills/release-notes')));
  assert(fs.existsSync(path.join(r.backup.replace(/^~/, home), 'SKILL.md')), 'backed up');
  fs.mkdirSync(J('.claude/skills/synced/x/y'), { recursive: true });
  fs.writeFileSync(J('.claude/skills/synced/x/y/SKILL.md'), '---\nname: y\ndescription: d\n---\n');
  invalidateSkills();
  const syncedSkill = (await skillsReport()).skills.find((s) => s.scope === 'synced');
  assert(syncedSkill && !(await sc.skillSource(syncedSkill.id)), 'synced skills are not editable');
  await assert.rejects(sc.deleteSkill(syncedSkill.id));
  console.log('skill-create checks passed');
} finally {
  for (const b of made) if (b) await fsp.rm(b.replace(/^~/, home), { recursive: true, force: true });
  await fsp.rm(home, { recursive: true, force: true });
}
