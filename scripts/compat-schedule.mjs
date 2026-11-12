#!/usr/bin/env node
// Turns the weekly CLI auto-verification on (or off) on this computer: a systemd user timer that runs
// scripts/compat-weekly.mjs every Saturday at 00:00 local time. If the computer was off then, it runs at the
// next start (Persistent=true). Linux only for now.
//   npm run compat:schedule              install / update the timer
//   npm run compat:schedule -- --remove  turn it off
//   npm run compat:schedule -- --status  when it runs next
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UNITS = path.join(os.homedir(), '.config', 'systemd', 'user');
const SERVICE = path.join(UNITS, 'baton-compat.service');
const TIMER = path.join(UNITS, 'baton-compat.timer');
const ctl = (...a) => execFileSync('systemctl', ['--user', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

if (process.platform !== 'linux') { console.log('The weekly auto-check currently runs on Linux (systemd) only.'); process.exit(1); }

if (process.argv.includes('--remove')) {
  try { ctl('disable', '--now', 'baton-compat.timer'); } catch { /* not enabled */ }
  for (const f of [SERVICE, TIMER]) fs.rmSync(f, { force: true });
  ctl('daemon-reload');
  console.log('Weekly auto-check turned off.');
  process.exit(0);
}

if (!process.argv.includes('--status')) {
  // PATH as seen now (node, npm, git, gh, claude), minus anything only meaningful inside this session
  const pathDirs = [...new Set([path.dirname(process.execPath), ...(process.env.PATH || '').split(':')])].filter((d) => d && !d.includes('/tmp/'));
  fs.mkdirSync(UNITS, { recursive: true });
  fs.writeFileSync(SERVICE, `[Unit]
Description=Baton weekly CLI compatibility check
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${REPO}
Environment=PATH=${pathDirs.join(':')}
ExecStart=${process.execPath} --no-warnings ${path.join(REPO, 'scripts', 'compat-weekly.mjs')}
TimeoutStartSec=4h
Nice=10
`);
  fs.writeFileSync(TIMER, `[Unit]
Description=Run Baton's CLI compatibility check every Saturday at 00:00

[Timer]
OnCalendar=Sat *-*-* 00:00:00
Persistent=true

[Install]
WantedBy=timers.target
`);
  ctl('daemon-reload');
  ctl('enable', '--now', 'baton-compat.timer');
  console.log(`Weekly auto-check is on: every Saturday 00:00 (missed runs catch up at the next start).\nLogs: ~/.baton-compat/logs · run now: systemctl --user start baton-compat.service`);
}
try { console.log(ctl('list-timers', 'baton-compat.timer', '--no-pager').trim()); } catch (e) { console.log(String(e.stderr || e.message)); }
