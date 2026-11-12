// Regression checks for adding MCP servers (server/mcp-install.js, mcp-probe.js, mcp-create.js): templates and
// placeholders, where each CLI's global / project config goes, Codex folder trust, the protocol test against a
// fake stdio server and a local HTTP + legacy-SSE server, parsing the AI's answer, and a whole install job.
// Runs against a throwaway HOME; no AI is called and nothing leaves this machine.
//   node scripts/mcp-install-check.mjs
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const home = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'baton-mcphome-')));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.BATON_NO_SHELL_ENV = '1';
for (const k of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME']) delete process.env[k];

const mi = await import('../server/mcp-install.js');
const mp = await import('../server/mcp-probe.js');
const mc = await import('../server/mcp-create.js');
const mpaste = await import('../server/mcp-paste.js');
const { effectiveServer, invalidateMcp } = await import('../server/mcp.js');
const { getKV, setKV } = await import('../server/store.js');
const J = (...p) => path.join(home, ...p);
const read = (f) => fs.readFileSync(f, 'utf8');
const json = (f) => JSON.parse(read(f));
const NO_CLAUDE = ['codex', 'agy', 'opencode', 'cursor']; // Claude Code is written through its own CLI

// a tiny MCP server over stdio: two pages of tools, and it insists on FAKE_TOKEN=good
const fake = J('fake-mcp.mjs');
fs.writeFileSync(fake, `
process.stderr.write('starting with token ' + process.env.FAKE_TOKEN + '\\n');
if (process.env.FAKE_TOKEN !== 'good-secret-123') { process.stderr.write('Error: invalid API key\\n'); process.exit(3); }
console.log('a log line on stdout');
let buf = '';
const out = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
process.stdin.on('data', (c) => {
  buf += c; let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (m.method === 'initialize') out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1.0', icons: [1] } } });
    if (m.method === 'tools/list') out({ jsonrpc: '2.0', id: m.id, result: m.params.cursor ? { tools: [{ name: 'beta' }] } : { tools: [{ name: 'alpha' }], nextCursor: 'p2' } });
  }
});
`);

// streamable HTTP at /mcp (needs a bearer token; answers tools/list as SSE) and the old SSE transport at /sse
const streams = new Set();
const srv = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/mcp' && req.method === 'POST') {
    if (req.headers.authorization !== 'Bearer tok-ok-456') { res.writeHead(401); return res.end(); }
    const m = JSON.parse(body);
    if (m.id == null) { res.writeHead(202); return res.end(); }
    if (m.method === 'initialize') { res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 's1' }); return res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { serverInfo: { name: 'web', version: '2' } } })); }
    assert.equal(req.headers['mcp-session-id'], 's1', 'session id sent back');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    return res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'search' }] } })}\n\n`);
  }
  if (u.pathname === '/mcp' && req.method === 'DELETE') { res.writeHead(200); return res.end(); }
  if (u.pathname === '/open' && req.method === 'POST') { res.writeHead(401, { 'www-authenticate': 'Bearer' }); return res.end(); }
  if (u.pathname === '/sse' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('event: endpoint\ndata: /messages?s=1\n\n');
    streams.add(res);
    req.on('close', () => streams.delete(res));
    return;
  }
  if (u.pathname === '/sse') { res.writeHead(405); return res.end(); }
  if (u.pathname === '/messages') {
    const m = JSON.parse(body);
    res.writeHead(202); res.end();
    const reply = m.method === 'initialize' ? { serverInfo: { name: 'old', version: '0' } } : m.method === 'tools/list' ? { tools: [{ name: 'x' }, { name: 'y' }] } : null;
    if (reply && m.id != null) for (const s of streams) s.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: reply })}\n\n`);
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;

const proj = J('work', 'app');
const healthKeys = () => Object.keys(getKV('mcp_health', {}) || {}).filter((k) => k.includes(home));
try {
  // ---- forms, templates and placeholders
  let tpl = mi.formToTemplate({ name: 'My Server!', target: 'npx -y "@x/srv" --dir {{DIR}} --key={{KEY}}', pairs: 'TOKEN={{TOKEN}}\nMODE=fast\n# comment', inputs: [{ key: 'DIR', default: '~/w' }, { key: 'KEY', required: false }, { key: 'TOKEN', secret: true }] });
  assert.equal(tpl.name, 'My-Server');
  assert.deepEqual([tpl.command, tpl.args], ['npx', ['-y', '@x/srv', '--dir', '{{DIR}}', '--key={{KEY}}']]);
  let r = mi.resolveTemplate(tpl, { TOKEN: ' t0k ' });
  assert.deepEqual(r.spec.args, ['-y', '@x/srv', '--dir', J('w')], 'default used, ~ expanded, empty optional dropped');
  assert.deepEqual(r.spec.env, { TOKEN: 't0k', MODE: 'fast' });
  assert.deepEqual(r.secrets, ['t0k']);
  assert.throws(() => mi.resolveTemplate(tpl, {}), /TOKEN/, 'required input');
  assert.throws(() => mi.resolveTemplate(mi.formToTemplate({ name: 'a', target: 'run {{NOPE}}' }), {}), /NOPE/, 'placeholder without an input');
  tpl = mi.formToTemplate({ name: 'w', target: 'https://h.example/mcp', transport: 'sse', pairs: 'Authorization: Bearer {{T}}\nX-Opt: {{O}}', inputs: [{ key: 'T', secret: true }, { key: 'O', required: false }] });
  r = mi.resolveTemplate(tpl, { T: 'abc' });
  assert.deepEqual(r.spec, { transport: 'sse', url: 'https://h.example/mcp', headers: { Authorization: 'Bearer abc' } });
  assert.throws(() => mi.formToTemplate({ name: '', target: 'x' }));
  assert.throws(() => mi.formToTemplate({ name: 'a', target: 'npx x', transport: 'http' }), 'remote type needs a URL');
  assert.throws(() => mi.resolveTemplate(mi.formToTemplate({ name: 'u', target: 'https://' }), {}), 'bad url');
  const back = mi.toForm({ name: 'f', transport: 'stdio', command: 'node', args: ['/a b/c.js', '-x'], env: { A: '1' } });
  assert.deepEqual([back.target, back.pairs], ['node "/a b/c.js" -x', 'A=1']);
  assert.deepEqual(mi.formToTemplate(back).args, ['/a b/c.js', '-x'], 'round trip keeps quoted args');
  const gh = mi.presets().find((p) => p.id === 'github');
  assert.equal(gh.form.pairs, 'Authorization: Bearer {{token}}');
  assert.deepEqual(mi.resolveTemplate(mi.formToTemplate(gh.form), { token: 'ghp_1' }).spec.headers, { Authorization: 'Bearer ghp_1' });
  const fsPreset = mi.presets().find((p) => p.id === 'filesystem');
  assert.equal(mi.resolveTemplate(mi.formToTemplate(fsPreset.form), {}).spec.args.at(-1), J('workspace'), 'preset default value');

  // ---- where each CLI's config goes
  await fsp.mkdir(proj, { recursive: true });
  let plan = await mi.planInstall({ tools: 'claude,codex,agy,opencode,cursor', scope: 'global', name: 'x' });
  assert.deepEqual(plan.targets.map((t) => t.file.replace(/\\/g, '/')), ['~/.claude.json', '~/.codex/config.toml', '~/.gemini/config/mcp_config.json', '~/.config/opencode/opencode.json', '~/.cursor/mcp.json']);
  plan = await mi.planInstall({ tools: 'claude,codex,agy,opencode,cursor', scope: 'project', project: proj, name: 'x' });
  assert.deepEqual(plan.targets.map((t) => t.file.replace(/\\/g, '/')), ['~/.claude.json', '~/work/app/.codex/config.toml', '~/work/app/.agents/plugins/baton-mcp/mcp_config.json', '~/work/app/opencode.json', '~/work/app/.cursor/mcp.json']);
  assert.equal(plan.targets[1].trusted, false, 'new folder is not trusted by Codex');
  plan = await mi.planInstall({ tools: 'claude', scope: 'project', project: proj, share: '1' });
  assert.equal(plan.targets[0].file.replace(/\\/g, '/'), '~/work/app/.mcp.json');
  await assert.rejects(mi.planInstall({ tools: 'codex', scope: 'project', project: home }), 'home is not a project');

  // ---- writing: global, then the same name for one project (closest config wins)
  const spec = { transport: 'stdio', command: process.execPath, args: [fake], env: { FAKE_TOKEN: 'good-secret-123' } };
  let res = await mi.writeServer('fake', spec, NO_CLAUDE, mi.parseWhere({ scope: 'global' }));
  assert(res.every((x) => x.ok), JSON.stringify(res));
  assert.equal(json(J('.cursor/mcp.json')).mcpServers.fake.env.FAKE_TOKEN, 'good-secret-123');
  assert.deepEqual(json(J('.config/opencode/opencode.json')).mcp.fake.command, [process.execPath, fake]);
  assert.match(read(J('.codex/config.toml')), /\[mcp_servers\.fake\]\ncommand = /);
  res = await mi.writeServer('fake', { ...spec, env: { FAKE_TOKEN: 'good-secret-123', HERE: '1' } }, NO_CLAUDE, mi.parseWhere({ scope: 'project', project: proj }), { trustCodex: true });
  assert(res.every((x) => x.ok && !x.replaced), JSON.stringify(res));
  assert.equal(json(path.join(proj, '.agents/plugins/baton-mcp/plugin.json')).name, 'baton-mcp', 'Antigravity plugin manifest');
  assert(json(path.join(proj, '.agents/plugins/baton-mcp/mcp_config.json')).mcpServers.fake);
  assert(json(path.join(proj, 'opencode.json')).$schema && json(path.join(proj, '.cursor/mcp.json')).mcpServers.fake.env.HERE === '1');
  assert.match(read(path.join(proj, '.codex/config.toml')), /\[mcp_servers\.fake\]/);
  assert(mi.codexTrusted(proj), 'trusted on request');
  assert.match(read(J('.codex/config.toml')), /\[mcp_servers\.fake\][\s\S]*\[projects\.".*app"\]\ntrust_level = "trusted"/);
  invalidateMcp();
  for (const t of NO_CLAUDE) {
    const s = effectiveServer(t, proj, 'fake');
    assert.equal(s?.scope, 'project', `${t}: the project's copy wins in the project`);
    assert.equal(effectiveServer(t, home, 'fake')?.scope, 'user', `${t}: elsewhere the global one`);
  }
  res = await mi.writeServer('fake', spec, ['cursor'], mi.parseWhere({ scope: 'project', project: proj }));
  assert(res[0].replaced && fs.existsSync(path.join(proj, '.cursor/mcp.json.baton-backup')), 'replacing backs up');
  assert.equal(json(path.join(proj, '.cursor/mcp.json')).mcpServers.fake.env.HERE, undefined);
  res = await mi.writeServer('old', { transport: 'sse', url: `${base}/sse`, headers: {} }, ['codex', 'cursor'], mi.parseWhere({ scope: 'global' }));
  assert.deepEqual(res.map((x) => x.ok), [false, true], 'Codex has no SSE transport');
  fs.writeFileSync(path.join(proj, 'opencode.jsonc'), '{}');
  const p2 = J('work', 'two');
  fs.mkdirSync(p2);
  fs.writeFileSync(path.join(p2, 'opencode.jsonc'), '{}');
  res = await mi.writeServer('fake', spec, ['opencode'], mi.parseWhere({ scope: 'project', project: p2 }));
  assert(!res[0].ok && /jsonc/.test(res[0].error), 'opencode.jsonc is left alone');
  fs.writeFileSync(J('.cursor/mcp.json'), '{ broken');
  res = await mi.writeServer('z', spec, ['cursor'], mi.parseWhere({ scope: 'global' }));
  assert(!res[0].ok && /JSON/.test(res[0].error), 'a broken file is not overwritten');
  assert.equal(read(J('.cursor/mcp.json')), '{ broken');

  // ---- the protocol test
  let pr = await mp.probeServer(spec, { cwd: home });
  assert.equal(pr.status, 'ok', JSON.stringify(pr));
  assert.deepEqual(pr.tools, ['alpha', 'beta'], 'all pages of tools/list');
  assert.deepEqual(pr.server, { name: 'fake', version: '1.0' });
  assert(!pr.log.includes('good-secret-123') && pr.log.includes('•••'), 'secret scrubbed from the log');
  pr = await mp.probeServer({ ...spec, env: { FAKE_TOKEN: 'wrong-value-999' } });
  assert.equal(pr.status, 'fail');
  assert(!JSON.stringify(pr).includes('wrong-value-999'), 'even a wrong secret is scrubbed');
  assert.match(pr.hint, /키나 토큰|key or token/i);
  pr = await mp.probeServer({ transport: 'stdio', command: 'no-such-command-zz', args: [] });
  assert.equal(pr.status, 'fail');
  assert.equal(pr.missing, 'no-such-command-zz');
  pr = await mp.probeServer({ transport: 'stdio', command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] }, { timeoutMs: 1500 });
  assert(pr.status === 'fail' && /1|2/.test(pr.error), 'a silent server times out');
  pr = await mp.probeServer({ transport: 'http', url: `${base}/mcp`, headers: { Authorization: 'Bearer tok-ok-456' } });
  assert.equal(pr.status, 'ok', JSON.stringify(pr));
  assert.deepEqual(pr.tools, ['search'], 'SSE-framed reply');
  pr = await mp.probeServer({ transport: 'http', url: `${base}/mcp`, headers: { Authorization: 'Bearer bad-token-000' } });
  assert.equal(pr.status, 'fail', 'a rejected token is a failure, not "sign in"');
  pr = await mp.probeServer({ transport: 'http', url: `${base}/open`, headers: {} });
  assert.equal(pr.status, 'auth', 'no token + 401 = OAuth sign-in');
  pr = await mp.probeServer({ transport: 'http', url: `${base}/sse`, headers: {} });
  assert.equal(pr.status, 'ok', JSON.stringify(pr));
  assert(pr.legacySse && pr.tools.join() === 'x,y', 'falls back to the old SSE transport');
  pr = await mp.probeServer({ transport: 'http', url: 'http://127.0.0.1:9/mcp', headers: {} }, { timeoutMs: 4000 });
  assert.equal(pr.status, 'fail');
  assert.equal(mp.scrub('key=abcdefgh123 and Bearer zzzzzzzzzz9', ['zzzzzzzzzz9']), 'key=••• and Bearer •••');

  // ---- the AI's answer
  let d = mc.parseMcpDraft('Here you go:\n```json\n{"name":"Pg DB","transport":"stdio","command":"npx","args":["-y","pg-mcp","{{DATABASE_URL}}"],"env":{"PG_TOKEN":"{{PG_TOKEN}}"},"inputs":[{"key":"DATABASE_URL","label":"DB URL","secret":true},{"key":"UNUSED"}],"summary":"s","tryPrompts":["a","b"],"confidence":"wild"}\n```');
  assert.equal(d.form.name, 'Pg-DB');
  assert.equal(d.form.target, 'npx -y pg-mcp {{DATABASE_URL}}');
  assert.deepEqual(d.form.inputs.map((i) => [i.key, i.secret]), [['DATABASE_URL', true], ['PG_TOKEN', true]], 'missing input added, unused dropped');
  assert.equal(d.confidence, 'medium');
  d = mc.parseMcpDraft('{"name":"n","url":"https://x.example/mcp","headers":{"Authorization":"Bearer {{T}}"},"oauth":true,"fixable":false,"diagnosis":"bad token"}');
  assert.deepEqual([d.form.transport, d.form.pairs, d.form.oauth, d.fixable], ['http', 'Authorization: Bearer {{T}}', true, false]);
  assert.throws(() => mc.parseMcpDraft('no json here'));
  assert.throws(() => mc.parseMcpDraft('{"name":"x","transport":"stdio"}'), 'stdio without a command');
  assert.deepEqual(mc.referencesIn('use https://github.com/o/r and https://mcp.x.dev/mcp, maybe @scope/pkg.'), [{ url: 'https://github.com/o/r' }, { npm: '@scope/pkg' }]);
  const prompt = mc.mcpPrompt({ request: 'r', previous: { name: 'a', target: 'run --api-key=sk-live-abcdefghijklmnop', pairs: 'API_TOKEN=plainsecret\nX={{X}}', inputs: [] }, failure: 'boom', where: { scope: 'global' }, tools: ['codex'], language: 'English', refs: '', runners: 'npx' });
  assert(!prompt.includes('plainsecret') && !prompt.includes('sk-live-abcdefghijklmnop') && prompt.includes('{{X}}') && prompt.includes('"fixable"'), 'no literal secret reaches the AI');

  // ---- a whole job: test -> write -> ask each CLI
  const poll = async (id) => { for (let i = 0; i < 600; i++) { const j = mc.mcpJob(id); if (j.status !== 'running') return j; await new Promise((x) => setTimeout(x, 100)); } throw new Error('job hung'); };
  const form = { name: 'fake2', target: `"${process.execPath}" "${fake}"`, pairs: 'FAKE_TOKEN={{TOKEN}}', inputs: [{ key: 'TOKEN', secret: true }] };
  let job = await poll((await mc.startInstall({ form, values: { TOKEN: 'nope-nope-nope' }, tools: ['cursor'], scope: 'project', project: proj })).id);
  assert.equal(job.status, 'probe-failed', 'nothing written when the test fails');
  assert(!json(path.join(proj, '.cursor/mcp.json')).mcpServers.fake2);
  assert(!JSON.stringify(job).includes('nope-nope-nope'));
  let git = true;
  try { execFileSync('git', ['init', '-q', proj], { stdio: 'ignore' }); } catch { git = false; }
  job = await poll((await mc.startInstall({ form, values: { TOKEN: 'good-secret-123' }, tools: ['cursor', 'opencode', 'codex'], scope: 'project', project: p2 })).id);
  assert.equal(job.status, 'done', JSON.stringify(job));
  assert.equal(job.probe.status, 'ok');
  const by = Object.fromEntries(job.results.map((x) => [x.tool, x]));
  assert(by.cursor.write.ok && by.cursor.verify.status === 'ok', JSON.stringify(by.cursor));
  assert(!by.opencode.write.ok, 'opencode.jsonc in that folder');
  assert(by.codex.write.ok && by.codex.verify.status === 'warn' && by.codex.verify.code === 'trust' || (by.codex.verify.how === 'file'), JSON.stringify(by.codex));
  assert(!JSON.stringify(job).includes('good-secret-123'), 'the job never shows the secret');
  job = await poll((await mc.startInstall({ form, values: { TOKEN: 'good-secret-123' }, tools: ['cursor'], scope: 'project', project: proj })).id);
  if (git) assert.deepEqual(job.warnings.map((w) => w.code), ['git'], 'token in a file git would commit');
  job = await poll((await mc.startInstall({ form, values: { TOKEN: 'bad-bad-bad' }, tools: ['cursor'], scope: 'global', force: true })).id);
  assert(job.status === 'done' && job.forced && job.probe.status === 'fail', 'force writes it anyway');
  await assert.rejects(mc.startInstall({ form, values: {}, tools: ['cursor'] }), 'required input');
  await assert.rejects(mc.startInstall({ form, values: { TOKEN: 'x' }, tools: [] }));

  // ---- pasted snippets and commands (no AI), masking for the AI
  let q = mpaste.quickParse('Add to your config:\n```json\n{ "mcpServers": { "acme": { "command": "npx", "args": ["-y", "@acme/mcp", "--api-key", "sk-live-0123456789abcdef"], "env": { "ACME_TOKEN": "<YOUR_TOKEN>", "REGION": "eu" } } } }\n```');
  assert.equal(q.form.name, 'acme');
  assert.equal(q.form.target, 'npx -y @acme/mcp --api-key {{API_KEY}}');
  assert.equal(q.form.pairs, 'ACME_TOKEN={{ACME_TOKEN}}\nREGION=eu');
  assert.deepEqual(q.prefill, { API_KEY: 'sk-live-0123456789abcdef' }, 'a real token is prefilled, a <YOUR_TOKEN> stub is asked for');
  assert(q.form.inputs.every((i) => i.secret && i.required));
  q = mpaste.quickParse('claude mcp add --transport http acme https://mcp.acme.dev/mcp --header "Authorization: Bearer tok_abcdef123456" -s user');
  assert.deepEqual([q.form.transport, q.form.target, q.form.pairs, q.prefill.TOKEN], ['http', 'https://mcp.acme.dev/mcp', 'Authorization: Bearer {{TOKEN}}', 'tok_abcdef123456']);
  q = mpaste.quickParse('claude mcp add acme -e ACME_KEY=k_1234567890 -- npx -y @acme/mcp --region eu');
  assert.deepEqual([q.form.target, q.form.pairs], ['npx -y @acme/mcp --region eu', 'ACME_KEY={{ACME_KEY}}']);
  q = mpaste.quickParse('codex mcp add acme --env MODE=ro -- uvx acme-mcp');
  assert.deepEqual([q.form.target, q.form.pairs], ['uvx acme-mcp', 'MODE=ro']);
  q = mpaste.quickParse('[mcp_servers.acme]\nurl = "https://a.dev/mcp"\nbearer_token_env_var = "ACME_TOKEN"');
  assert.deepEqual([q.form.target, q.form.pairs], ['https://a.dev/mcp', 'Authorization: Bearer {{ACME_TOKEN}}']);
  q = mpaste.quickParse('{"servers":{"gh":{"type":"http","url":"https://api.githubcopilot.com/mcp/","headers":{"Authorization":"Bearer ${input:github_token}"}}},"inputs":[]}');
  assert.equal(q.form.pairs, 'Authorization: Bearer {{GITHUB_TOKEN}}', 'VS Code ${input:…}');
  q = mpaste.quickParse('{"mcp":{"servers":{"oc":{"type":"local","command":["node","srv.js"],"environment":{"A":"1"}}}}}');
  assert.deepEqual([q.form.name, q.form.target, q.form.pairs], ['oc', 'node srv.js', 'A=1'], 'OpenCode V2 snippet');
  q = mpaste.quickParse('{"mcpServers":{"a":{"command":"x"},"b":{"url":"https://b.dev/mcp"}}}');
  assert(q.notes.length === 1 && q.form.name === 'a', 'several servers: the first, with a note');
  assert.equal(mpaste.quickParse('서버 주소는 https://mcp.acme.dev/mcp 이고 토큰은 abcd1234efgh 입니다'), null, 'plain text goes to the AI');
  const mk = mpaste.maskPasted('주소 https://x.dev/mcp?api_key=AKIAABCDEFGHIJKLMNOP 토큰은 abcd1234efgh, Authorization: Bearer eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.sig123 again abcd1234efgh, key: <YOUR_KEY>');
  for (const v of ['AKIAABCDEFGHIJKLMNOP', 'abcd1234efgh', 'eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.sig123']) assert(!mk.text.includes(v), `masked ${v}`);
  assert.equal(Object.keys(mk.secrets).length, 3, 'same value, same name');
  assert(mk.text.includes('<YOUR_KEY>'), 'stubs stay');

  // ---- per-CLI rendering, its self-check, and the preview (secrets never shown)
  const wG = mi.parseWhere({ scope: 'global' });
  const stdioSpec = { transport: 'stdio', command: 'npx', args: ['-y', 'a b'], env: { K: 'v' } };
  for (const t of ['claude', 'codex', 'agy', 'opencode', 'cursor']) {
    const r = mi.renderFor(t, 'srv', stdioSpec, wG);
    assert.deepEqual(mi.checkRendered(t, r), [], `${t} stdio renders valid`);
    assert.deepEqual(mi.checkRendered(t, mi.renderFor(t, 'srv', { transport: 'http', url: 'https://h.dev/mcp', headers: { A: 'b' } }, wG)), [], `${t} http renders valid`);
  }
  assert.equal(JSON.parse(mi.renderFor('cursor', 's', stdioSpec, wG).text).mcpServers.s.type, 'stdio', 'Cursor lists type as required for stdio');
  assert.equal(JSON.parse(mi.renderFor('opencode', 's', { transport: 'http', url: 'https://h.dev/mcp', headers: { A: 'b' } }, wG).text).mcp.s.oauth, false, 'header auth turns OpenCode OAuth off');
  assert.deepEqual(mi.checkRendered('opencode', { lang: 'json', text: '{"mcp":{"s":{"type":"local","command":"npx"}}}' }), ['opencode: fields'], 'catches a string command');
  const pv = mi.previewInstall({ form: { name: 'w', target: 'https://h.dev/mcp', pairs: 'Authorization: Bearer {{T}}\nX-Api-Key: plain-secret-1', inputs: [{ key: 'T', secret: true }] }, values: { T: 'real-token-123' }, tools: ['claude', 'codex', 'opencode'] });
  const pvText = JSON.stringify(pv);
  assert(!pvText.includes('real-token-123') && !pvText.includes('plain-secret-1') && pvText.includes('‹T›'), 'preview masks secrets');
  assert(pv.items.every((x) => !x.error && !x.problems.length), JSON.stringify(pv));
  assert(/claude mcp add-json -s user w/.test(pv.items[0].command));
  // OpenCode V2 layout ("mcp": { "servers": … }) is kept and read
  const ocv2 = J('work', 'oc2');
  fs.mkdirSync(ocv2, { recursive: true });
  fs.writeFileSync(path.join(ocv2, 'opencode.json'), JSON.stringify({ mcp: { timeout: { startup: 5000 }, servers: { old: { type: 'local', command: ['x'] } } } }));
  res = await mi.writeServer('fake', spec, ['opencode'], mi.parseWhere({ scope: 'project', project: ocv2 }));
  assert(res[0].ok, JSON.stringify(res));
  const oc = json(path.join(ocv2, 'opencode.json'));
  assert(oc.mcp.servers.fake && !oc.mcp.fake && oc.mcp.servers.fake.enabled === undefined && oc.mcp.timeout.startup === 5000, JSON.stringify(oc));
  invalidateMcp();
  assert.equal(effectiveServer('opencode', ocv2, 'fake')?.file, path.join(ocv2, 'opencode.json'), 'V2 servers are read');
  assert.equal(effectiveServer('opencode', ocv2, 'timeout'), null, 'mcp.timeout is not a server');

  console.log('mcp-install checks passed');
} finally {
  srv.close();
  for (const s of streams) s.destroy();
  const h = getKV('mcp_health', {}) || {};
  for (const k of healthKeys()) delete h[k];
  setKV('mcp_health', h);
  await fsp.rm(home, { recursive: true, force: true });
}
process.exit(0);
