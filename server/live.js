// Detect which sessions are currently open in a terminal (outside Baton).
// Claude: ~/.claude/sessions/<pid>.json registry. Codex/agy: scan /proc for processes holding the
// rollout file / conversation db open. OpenCode: an unfinished reply in opencode.db plus a live `opencode` process.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { liveClaude } from './sources/claude.js';
import { CODEX_HOME } from './env.js';
import { opencodeInflight } from './sources/opencode.js';
import { childPids } from './runner.js';

let cached = { at: 0, value: null };
const OPENCODE_FRESH_MS = 60_000; // no process to match (e.g. `opencode serve`): trust a db touched this recently

/** Running OpenCode processes: [{ pid, cwd, run }]. `run` = `opencode run ...` (a one-shot, as scripts use), not the TUI. */
async function opencodeProcs() {
  const out = [];
  let pids = [];
  try { pids = (await fsp.readdir('/proc')).filter((p) => /^\d+$/.test(p)); } catch { return out; }
  for (const pid of pids) {
    try {
      if (!/^\.?opencode/i.test((await fsp.readFile(`/proc/${pid}/comm`, 'utf8')).trim())) continue;
      const args = (await fsp.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').slice(1).filter(Boolean);
      out.push({ pid: Number(pid), cwd: await fsp.readlink(`/proc/${pid}/cwd`), run: args[0] === 'run' });
    } catch { /* gone, or not ours */ }
  }
  return out;
}

/** OpenCode keeps no per-session registry: a reply still unfinished in the db is "working" if a process is there to finish it. */
async function liveOpencode() {
  const out = new Map();
  const inflight = opencodeInflight();
  if (!inflight.size) return out;
  const procs = await opencodeProcs();
  for (const [id, s] of inflight) {
    const here = procs.filter((p) => p.cwd === s.directory);
    const p = here.find((x) => !childPids.has(x.pid)) || here[0]; // Baton's own run is shown as a run, not as someone else's
    if (!p && Date.now() - s.activity > OPENCODE_FRESH_MS) continue; // abandoned: nothing left to finish it
    out.set(id, { pid: p?.pid ?? 0, status: 'busy', background: p ? p.run : true });
  }
  return out;
}

async function procScan() {
  const codex = new Map(); // rollout file path -> pid
  const agy = new Map();   // conversation id -> pid
  let pids = [];
  try { pids = (await fsp.readdir('/proc')).filter((p) => /^\d+$/.test(p)); } catch { return { codex, agy }; }
  for (const pid of pids) {
    let comm = '';
    try { comm = (await fsp.readFile(`/proc/${pid}/comm`, 'utf8')).trim(); } catch { continue; }
    if (!/codex|agy|antigravity|node/i.test(comm)) continue;
    let fds = [];
    try { fds = await fsp.readdir(`/proc/${pid}/fd`); } catch { continue; }
    for (const fd of fds) {
      let target;
      try { target = await fsp.readlink(`/proc/${pid}/fd/${fd}`); } catch { continue; }
      if (target.startsWith(path.join(CODEX_HOME, 'sessions')) && target.endsWith('.jsonl')) codex.set(target, Number(pid));
      else if (target.includes('/antigravity-cli/conversations/') && target.endsWith('.db')) {
        agy.set(path.basename(target, '.db'), Number(pid));
      }
    }
  }
  return { codex, agy };
}

/** Map "<tool>:<id>" -> { pid, status } for sessions open in a terminal. Cached for 4s. */
export async function liveSessions(sessionsByFile) {
  if (cached.value && Date.now() - cached.at < 4000) return cached.value;
  const out = new Map();
  const [cl, scan, oc] = await Promise.all([liveClaude(), procScan(), liveOpencode()]);
  for (const [id, v] of cl) out.set(`claude:${id}`, { pid: v.pid, status: v.status === 'busy' ? 'busy' : 'idle' });
  for (const [file, pid] of scan.codex) {
    const s = sessionsByFile?.get(file);
    if (s) out.set(`codex:${s.id}`, { pid, status: 'open' });
  }
  for (const [id, pid] of scan.agy) out.set(`agy:${id}`, { pid, status: 'open' });
  for (const [id, v] of oc) out.set(`opencode:${id}`, v);
  cached = { at: Date.now(), value: out };
  return out;
}
