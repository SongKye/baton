// Shared by the compat scripts: which OS this is, recording a verified version per OS in server/compat.json,
// and rendering the table in docs/compatibility.md (between the compat-table markers) from it.
//
// compat.json entry: { level, verified, verifiedAt, needsBatonAfter?, os: { linux|windows|macos: { verified, verifiedAt } } }
// The top-level `verified` is the newest version verified on any OS (what "Baton supports" means); `os` says
// where it was actually run.
import fs from 'node:fs';

export const OS_KEYS = ['linux', 'windows', 'macos'];
export const OS_NAMES = { linux: 'Linux', windows: 'Windows', macos: 'macOS' };
export const TOOL_NAMES = { claude: 'Claude Code', codex: 'Codex', agy: 'Antigravity', opencode: 'OpenCode', cursor: 'Cursor' };

/** WSL counts as Linux: the CLIs run there as Linux programs. */
export const osKey = (platform = process.platform) => process.env.BATON_COMPAT_OS || (platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux'); // env: tests

const cmp = (a, b) => {
  const p = (v) => String(v).replace(/^v/, '').split('-')[0].split('.').map((x) => Number(x) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
  return 0;
};

/** Record that `version` of `tool` passed on `os`. Never moves a record backwards. Returns true if anything changed. */
export function recordVersion(table, tool, os, version, date) {
  const e = table[tool];
  if (!e) return false;
  e.os ||= {};
  const cur = e.os[os]?.verified;
  if (cur && cmp(version, cur) <= 0) return false;
  e.os[os] = { verified: version, verifiedAt: date };
  e.level = 'supported';
  if (!e.verified || cmp(version, e.verified) > 0) Object.assign(e, { verified: version, verifiedAt: date });
  return true;
}

/** The markdown table for docs/compatibility.md. */
export function renderDocsTable(table) {
  const cell = (e, os) => (e.os?.[os]?.verified ? `**${e.os[os].verified}** (${e.os[os].verifiedAt})` : '—');
  const rows = Object.entries(table).map(([id, e]) => `| ${TOOL_NAMES[id] || id} | ${e.level === 'supported' ? 'Supported' : e.level === 'beta' ? 'Beta' : 'Unverified'} | ${OS_KEYS.map((os) => cell(e, os)).join(' | ')} |`);
  return ['| CLI | Support | Linux | Windows | macOS |', '|---|---|---|---|---|', ...rows].join('\n');
}

/** Rewrite the table between <!-- compat-table --> and <!-- /compat-table --> in a docs file. */
export function writeDocsTable(file, table) {
  const s = fs.readFileSync(file, 'utf8');
  const out = s.replace(/<!-- compat-table -->[\s\S]*?<!-- \/compat-table -->/, `<!-- compat-table -->\n${renderDocsTable(table)}\n<!-- /compat-table -->`);
  if (out !== s) fs.writeFileSync(file, out);
}
