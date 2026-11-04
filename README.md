# Baton 🏃

**One dashboard for all your AI coding sessions** — Claude Code, Codex, Antigravity, OpenCode and Cursor.
See every session with its title, continue any of them from your desktop or phone, and never lose track of a project again.

[한국어 README](README.ko.md)

- **All sessions in one place** — titles, previews, search, pin/hide, live "running" state (even for sessions open in a terminal)
- **Continue any session** — chat UI with streaming replies, tool calls, photos, and per-message model / effort / permission picks
- **"Where was I?" briefs** — an AI summary of each project (what's done, what's next, ready-to-send prompts) and a daily nudge for projects you forgot
- **Usage & limits** — live subscription limits (Claude, Codex, Antigravity) and token usage per CLI and model
- **Served ports** — which dev servers are running, from which project and which agent session; open them on your phone
- **Skills** — every skill/command each CLI can see, where it lives, and when an agent actually used it
- **Clean up** — trash test / automated / "hi" sessions in bulk (restorable for 30 days)
- **Notifications** — push to your phone when a reply finishes, even for sessions running in your terminal
- **English / 한국어**, light / dark, mobile and desktop layouts

## Quick start

You need **Node.js 22.13+** (the setup scripts can install it) and Git or the ZIP download.

**macOS · Linux · WSL**

```bash
git clone https://github.com/SongKye/baton.git
cd baton
./scripts/setup.sh
```

**Windows (PowerShell)**

```powershell
git clone https://github.com/SongKye/baton.git
cd baton
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

The dashboard opens at **http://localhost:7420** with a **Get started** screen that:

1. checks your computer (OS, Node.js, Git — and installs Git on Windows/macOS),
2. installs any of the five AI coding CLIs with one click, using each vendor's official installer,
3. signs you in (opens the sign-in page, shows device codes, takes pasted codes — no terminal needed),
4. optionally shares Baton to your phone over Tailscale, and
5. optionally starts Baton automatically when you log in (systemd on Linux/WSL, launchd on macOS, Startup folder on Windows).

As soon as a CLI is installed, its existing sessions appear in Baton — there's nothing else to connect.

Later runs: `npm start` (or `npm run open` to also open the browser).

## Supported CLIs

| CLI | Read sessions | Continue / new session | Photos | Live limits | Token usage | Install on |
|---|---|---|---|---|---|---|
| Claude Code | ✅ | ✅ | ✅ | ✅ | ✅ | macOS, Linux, WSL, Windows |
| Codex | ✅ | ✅ | ✅ | ✅ | ✅ | macOS, Linux, WSL, Windows (npm) |
| Antigravity (`agy`) | ✅ | ✅ | ✅ (via workspace file) | ✅ | ✅ | macOS, Linux, WSL |
| OpenCode | ✅ beta | ✅ beta | ✅ | — | ✅ | macOS, Linux, WSL, Windows (npm) |
| Cursor (`cursor-agent`) | ✅ beta | ✅ beta | ✅ (via workspace file) | — | — | macOS, Linux, WSL, Windows |

*beta*: implemented from the tools' documented formats; not yet verified against a live install. Please open an issue if something looks off.

### Permission modes

| Baton | Claude Code | Codex | Antigravity | OpenCode | Cursor |
|---|---|---|---|---|---|
| Plan only | `--permission-mode plan` | `sandbox_mode=read-only` | `--mode plan` | `--agent plan` | asks the agent not to modify anything |
| Auto | `--permission-mode auto` | `sandbox_mode=workspace-write` | `--mode accept-edits` | `--agent build` | default |
| Full access | `--dangerously-skip-permissions` | `--dangerously-bypass-approvals-and-sandbox` | `--dangerously-skip-permissions` | `--agent build` | `--force` |

## Using it from your phone

Baton listens on `127.0.0.1` only. To reach it from your phone, install [Tailscale](https://tailscale.com/download) on the PC and the phone, then press **Share to my devices** on the Get started screen (it runs `tailscale serve --https=8443`, visible only inside your tailnet — never public). Open `https://<your-pc>.<tailnet>.ts.net:8443` on the phone, add it to the home screen, and turn on notifications in Settings (iOS only allows web push for home-screen apps).

## How it works

- `server/sources/*` — readers for each CLI's session files (Claude JSONL, Codex rollout JSONL, Antigravity SQLite+protobuf, OpenCode JSON storage, Cursor `store.db`)
- `server/runner.js` — runs the CLIs headlessly (`claude -p --resume`, `codex exec resume`, `agy -p --conversation`, `opencode run --session`, `cursor-agent -p --resume`) and normalizes their streams
- `server/setup.js`, `server/tools.js` — onboarding checks, one-click install/sign-in jobs, auto-start
- `server/platform.js` — Windows/macOS/Linux/WSL differences (PATH, `.cmd` shims, ports, processes)
- `server/limits.js`, `server/usage.js` — live limits and token usage; `server/skills.js`, `server/ports.js`, `server/trash.js`, `server/watch.js`
- `public/` — build-free vanilla JS PWA; `public/locales/en.json` — translations (UI strings are written in Korean in code and looked up here)
- `data/` — local state (SQLite), never committed

Nothing leaves your machine except what the CLIs themselves send, plus the vendors' own usage endpoints queried with the CLIs' stored credentials.

## Troubleshooting

- **A CLI shows "Not installed" right after installing** — press ↻ on Get started; on Windows, restart Baton so the new PATH is picked up.
- **Sign-in needs a terminal** (OpenCode provider keys) — Get started shows the exact command to copy.
- **Port 7420 is taken** — `BATON_PORT=7421 npm start`.
- **Windows**: Codex and Antigravity work best inside WSL. Install WSL, then run `./scripts/setup.sh` inside it; open `http://localhost:7420` from Windows.
- Translations: `npm run i18n:check` lists strings missing from `public/locales/en.json`.
