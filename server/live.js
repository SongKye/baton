// Detect which sessions are currently open in a terminal (outside Baton).
// Claude: ~/.claude/sessions/<pid>.json registry. Codex/agy: scan /proc for processes holding the
// rollout file / conversation db open.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { liveClaude } from './sources/claude.js';
import { CODEX_HOME } from './env.js';

let cached = { at: 0, value: null };

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
  const [cl, scan] = await Promise.all([liveClaude(), procScan()]);
  for (const [id, v] of cl) out.set(`claude:${id}`, { pid: v.pid, status: v.status === 'busy' ? 'busy' : 'idle' });
  for (const [file, pid] of scan.codex) {
    const s = sessionsByFile?.get(file);
    if (s) out.set(`codex:${s.id}`, { pid, status: 'open' });
  }
  for (const [id, pid] of scan.agy) out.set(`agy:${id}`, { pid, status: 'open' });
  cached = { at: Date.now(), value: out };
  return out;
}
