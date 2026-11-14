#!/usr/bin/env node
// For each installed coding-agent CLI: its version vs the one Baton was verified with (server/compat.js),
// and whether the flags/subcommands Baton calls still appear in that CLI's --help.
// Run it after a CLI updates, before bumping `verified` in server/compat.js.
//   npm run compat:check            all installed CLIs
//   npm run compat:check -- codex   just one
// Exit code 1 if a check fails (a flag Baton relies on is missing from --help).
// Passing here is necessary, not sufficient: streamed events and session files can still change, so also
// try a chat, a resumed session and the setup page (docs/compatibility.md lists everything Baton relies on).
import '../server/env.js';
import { TOOLS, TOOL_IDS, binFor } from '../server/tools.js';
import { runCli } from '../server/platform.js';
import { COMPAT, compatState } from '../server/compat.js';
import { checkVersion } from './lib-compat-contracts.mjs';
import { probeCodexSandbox } from './lib-perm-probe.mjs';

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const ids = only.length ? only : TOOL_IDS;
let failed = 0;

for (const id of ids) {
  const t = TOOLS[id], c = COMPAT[id];
  if (!t || !c) { console.log(`? ${id}: unknown tool (one of ${TOOL_IDS.join(', ')})`); failed++; continue; }
  const bin = binFor(id);
  if (!bin) { console.log(`- ${t.name}: not installed`); if (only.length) failed++; continue; }
  const r = await runCli(bin, ['--version'], { timeout: 15000 });
  let ver;
  try { ver = checkVersion(r); } catch (e) { failed++; console.log(`  ✗ ${e.message}`); continue; }
  const state = compatState(id, ver);
  const label = {
    verified: 'same as verified', newer: `newer than verified ${c.verified}: not checked yet`,
    older: `older than verified ${c.verified}`, untested: `no verified version (${c.level})`, unknown: 'version unreadable',
  }[state];
  console.log(`\n${t.name} ${ver || '?'} — ${label}`);
  for (const chk of c.checks || []) {
    const h = await runCli(bin, chk.args, { timeout: 20000 });
    const text = h.stdout + '\n' + h.stderr;
    const missing = chk.expect.filter((f) => !text.includes(f));
    const cmd = `${id} ${chk.args.join(' ')}`;
    if (h.code !== 0 || missing.length) { failed++; console.log(`  ✗ ${cmd}: exit ${h.code}; missing ${missing.join(', ')}`); }
    else console.log(`  ✓ ${cmd} (${chk.expect.length} flags)`);
  }
  if (id === 'codex') {
    // the permission levels still mean what Baton says (no model call)
    try { console.log(`  ✓ permission sandbox: ${await probeCodexSandbox(bin)}`); }
    catch (e) { failed++; console.log(`  ✗ permission sandbox: ${e.message}`); }
  }
}

console.log(failed ? `\n${failed} check(s) failed — see docs/compatibility.md for what each one is used for.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
