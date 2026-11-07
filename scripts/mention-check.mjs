// Regression checks for the composer's @ picker file list (server/mention.js).
// Run from the repository root: node scripts/mention-check.mjs
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mentionFiles } from '../server/mention.js';
import { pickableSkills } from '../server/skills.js';

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'baton-mention-'));
const w = async (rel, text = 'x') => { await fsp.mkdir(path.dirname(path.join(tmp, rel)), { recursive: true }); await fsp.writeFile(path.join(tmp, rel), text); };
try {
  const outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'baton-outside-'));
  await fsp.writeFile(path.join(outside, 'secret.txt'), 'x');

  // plain folder: bounded walk
  const plain = path.join(tmp, 'plain');
  await w('plain/src/app.js'); await w('plain/한글 폴더/메모.md'); await w('plain/node_modules/pkg/index.js'); await w('plain/.hidden/x.js'); await w('plain/README.md');
  await fsp.symlink(outside, path.join(plain, 'link'));
  let r = await mentionFiles(plain);
  assert(r.files.includes('src/app.js') && r.files.includes('한글 폴더/메모.md') && r.files.includes('README.md'));
  assert(!r.files.some((f) => f.startsWith('node_modules/') || f.startsWith('.hidden/')), 'skips heavy and hidden dirs');
  assert(!r.files.some((f) => f.includes('secret.txt')), 'never follows symlinked dirs');
  assert.deepEqual(r.dirs, ['src/', '한글 폴더/']);

  // git repo: .gitignore respected, untracked files included, paths relative to a sub-folder cwd
  const repo = path.join(tmp, 'repo');
  await w('repo/.gitignore', 'ignored/\n*.log\n'); await w('repo/a/b/c.js'); await w('repo/ignored/x.js'); await w('repo/debug.log'); await w('repo/new.txt');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'add', '.gitignore', 'a']);
  r = await mentionFiles(repo);
  assert(r.files.includes('a/b/c.js') && r.files.includes('new.txt'));
  assert(!r.files.some((f) => f.startsWith('ignored/') || f.endsWith('.log')), 'respects .gitignore');
  assert.deepEqual(r.dirs, ['a/', 'a/b/']);
  r = await mentionFiles(path.join(repo, 'a'));
  assert.deepEqual(r.files, ['b/c.js'], 'relative to the chat folder');

  // the /api/mention route: home boundary, missing folders, home itself, session folder lookup
  const src = fs.readFileSync('server/index.js', 'utf8');
  const routes = new Map();
  const sessions = { s1: { cwd: repo }, gone: { cwd: path.join(tmp, 'deleted'), project: plain } };
  const ctx = vm.createContext({ fs, fsp, path, HOME: tmp, tr: (x) => x, store: { getSettings: () => ({}) }, TOOL_IDS: ['claude', 'codex'],
    mentionFiles, pickableSkills: async (tool, cwd) => ({ skills: [{ name: `${tool}-skill`, cwd }], others: [] }), mcpForPicker: (tool) => [{ name: `${tool}-mcp` }], projectRoot: (c) => c,
    findSession: async (tool, id) => sessions[id] || null, route: (m, p, f) => routes.set(`${m} ${p}`, f) });
  vm.runInContext(src.slice(src.indexOf('function resolveCwd('), src.indexOf('const VERSION =')), ctx);
  vm.runInContext(src.slice(src.indexOf("route('GET', '/api/mention'"), src.indexOf("route('GET', '/api/dirs',")), ctx);
  const get = (qs) => routes.get('GET /api/mention')({}, new URL(`http://test/?${new URLSearchParams(qs)}`));
  r = await get({ tool: 'claude', cwd: plain });
  assert(r.files.includes('src/app.js') && r.skills[0].name === 'claude-skill' && r.mcp[0].name === 'claude-mcp');
  assert.equal((await get({ tool: 'nope', cwd: plain }))[0], 400);
  r = await get({ tool: 'claude', cwd: path.join(plain, 'missing') });
  assert.deepEqual([r.files.length, r.skills.length], [0, 0], 'folder not created yet -> empty');
  r = await get({ tool: 'claude', cwd: path.join(plain, 'link') });
  assert(!r.files?.length, 'symlink out of home -> nothing');
  r = await get({ tool: 'claude', cwd: tmp + '-sibling' });
  assert(!r.files?.length, 'outside home -> nothing');
  r = await get({ tool: 'codex', cwd: '~' });
  assert.equal(r.files.length, 0); assert(r.truncated); assert.equal(r.skills[0].name, 'codex-skill');
  r = await get({ tool: 'claude', session: 's1' });
  assert(r.files.includes('a/b/c.js'), 'session -> its own folder');
  r = await get({ tool: 'claude', session: 'gone' });
  assert(r.files.includes('src/app.js'), 'deleted session folder -> project, like /api/run');
  assert.equal((await get({ tool: 'claude', session: 'nope' }))[0], 404);

  // project skills from the session folder and every parent (monorepo sub-folders), other CLIs' project skills as "others"
  const skill = (rel, name) => w(`${rel}/${name}/SKILL.md`, `---\nname: ${name}\ndescription: d\n---\n`);
  await skill('mono/.claude/skills', 'root-skill'); await skill('mono/apps/web/.claude/skills', 'web-skill'); await skill('mono/apps/web/.agents/skills', 'codex-only');
  const deep = path.join(tmp, 'mono', 'apps', 'web', 'src');
  await fsp.mkdir(deep, { recursive: true });
  const sk = await pickableSkills('claude', deep, path.join(tmp, 'mono'));
  assert(['root-skill', 'web-skill'].every((n) => sk.skills.some((x) => x.name === n)), 'nested project skills');
  assert(sk.others.some((x) => x.name === 'codex-only' && x.from === 'codex'), 'other CLI project skill offered');
  const cx = await pickableSkills('codex', deep, path.join(tmp, 'mono'));
  assert(cx.skills.some((x) => x.name === 'codex-only') && cx.others.some((x) => x.name === 'web-skill' && x.from === 'claude'));

  await fsp.rm(outside, { recursive: true, force: true });
  console.log('PASS: bounded walk, hidden/heavy dir skipping, symlink boundary, Unicode/spaces, .gitignore, untracked files, sub-folder paths, /api/mention home boundary, missing folders, home itself, session folders, nested project skills, other CLIs\' skills, MCP');
} finally { await fsp.rm(tmp, { recursive: true, force: true }); }
