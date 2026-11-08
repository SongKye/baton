<div align="center">

# 🏃 Baton

**One dashboard for all your AI coding sessions.**
Claude Code · Codex · Antigravity · OpenCode · Cursor — on your desktop and your phone.

[![CI](https://github.com/SongKye/baton/actions/workflows/ci.yml/badge.svg)](https://github.com/SongKye/baton/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/SongKye/baton?include_prereleases)](https://github.com/SongKye/baton/releases)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2022.13-339933)
![Platforms](https://img.shields.io/badge/platforms-Linux%20%7C%20macOS%20%7C%20Windows%20%7C%20WSL-555)
![License](https://img.shields.io/badge/license-MIT-blue)

English · [한국어](README.ko.md)

</div>

---

Vibe coding means juggling many projects across many agents — and forgetting where you left off.
Baton reads the session files your CLIs already write, puts them in one place, and lets you pick any of them back up from a browser — or your phone.

- 🗂 **Every session, one list** — titles, previews, search, pins, and which ones are running right now (even in a terminal)
- 💬 **Continue anywhere** — streaming chat, tool calls, photos; choose model, reasoning effort and permissions per message; answer the agent's questions with a tap
- 🧭 **"Where was I?"** — AI briefs per project (done / next / ready-to-send prompts) and a daily nudge for forgotten projects
- 🔀 **Spread the load** — open a new session in the same project with another CLI, or hand a session over when one runs out of tokens
- 📊 **Limits & usage** — live subscription limits and token usage per CLI and model
- 🔌 **MCP servers** — add popular servers to every CLI in one tap, and see which ones each CLI loads in each folder, whether they connect, and which tools agents actually call
- 🖥 **Dev servers · 🔗 linked services** — each project's dev servers (on / off, kept running across restarts), its GitHub repo and links to the Vercel, Firebase or Supabase dashboards it uses
- 🧩 **Skills · 🧹 cleanup** — which skills agents actually use, and one-tap cleanup of throwaway sessions
- 🔔 **Notifications** — your phone buzzes whenever a session finishes (Baton or PC terminal) or the agent has a question; on a desktop, cards pop up in the corner. Mute a session or a whole project from its ⋯ menu
- 🏢 **Any backend** — subscriptions, API keys, Amazon Bedrock, Google Vertex, LLM gateways and self-hosted models

## Quick start

You need **Node.js 22.13+** (the setup scripts can install it).

<table>
<tr><th>macOS · Linux · WSL</th><th>Windows (PowerShell)</th></tr>
<tr><td>

```bash
curl -fsSL https://raw.githubusercontent.com/SongKye/baton/main/scripts/install.sh | bash
```

</td><td>

```powershell
irm https://raw.githubusercontent.com/SongKye/baton/main/scripts/install.ps1 | iex
```

</td></tr>
</table>

This installs the **latest release** into `~/baton` (set `BATON_DIR` to choose another folder) and starts it. Run the same line again any time to move to the newest release. Prefer a zip? Download `baton-vX.Y.Z.zip` from [Releases](https://github.com/SongKye/baton/releases), unzip it, and run `scripts/setup.sh` (or `scripts\setup.ps1`) — zip installs can't update themselves. Working on Baton itself? See [CONTRIBUTING.md](CONTRIBUTING.md).

Baton opens **http://localhost:7420** with a **Get started** screen that walks you through:

1. **Your computer** — OS, Node.js, Git (one-click Git install on Windows/macOS)
2. **Connect AI** — pick how you use AI:
   - *Subscription* — one-click install of each CLI with its vendor's official installer, then sign in (sign-in link, device code and code paste are handled in the page)
   - *API key* — paste it; Baton recognizes Anthropic, OpenAI, OpenRouter and Groq keys and connects the right CLI
   - *Company account* — Bedrock, Vertex, Azure OpenAI or a company gateway
   - *Models on your computer* — Ollama, LM Studio, vLLM, LiteLLM, llama.cpp and Jan are found automatically
3. **Add tools (MCP)** (optional) — one tap adds a server to all your CLIs
4. **Phone** (optional) — step by step with Tailscale, then scan a QR code
5. **Start on login** (optional) — systemd / launchd / Windows Startup

Every step shows whether it's done, and each connection can be checked with **Test connection**.

Existing sessions show up as soon as a CLI is installed. Later, run `npm start` (or `npm run open`) in the Baton folder (`~/baton`).

### Windows: install in WSL, step by step

Codex and Antigravity work best when Baton runs inside WSL (Linux on Windows). You use it from your normal Windows browser.

1. **Turn on WSL** (once). Open PowerShell **as administrator**, run `wsl --install`, and restart Windows. Ubuntu opens and asks you to make a Linux user name and password.
2. **Install Baton.** In the Ubuntu window, paste the install line:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/SongKye/baton/main/scripts/install.sh | bash
   ```
   It asks before installing Node.js, then starts Baton and opens **http://localhost:7420** in your Windows browser. Keep the Ubuntu window open while you use Baton; **Ctrl+C** stops it.
3. **Start it again later.** Open Ubuntu and run:
   ```bash
   cd ~/baton && npm start
   ```
   Or turn on **Start on login** in Get started so you never need the terminal. In WSL this starts Baton whenever WSL starts (opening Ubuntu once after a reboot is enough). It needs systemd, which new Ubuntu installs have. If Get started says auto-start isn't available, add these two lines to `/etc/wsl.conf` with `sudo nano /etc/wsl.conf`, then run `wsl --shutdown` in PowerShell and open Ubuntu again:
   ```ini
   [boot]
   systemd=true
   ```
4. **Update.** Press **Update now** when Baton tells you about a new version, or run the install line again.
5. **Remove.** Turn off Start on login in Get started, then run `rm -rf ~/baton`. Your CLIs and their sessions stay.

To change Baton's own code, use a `git clone` of `main` instead. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Supported CLIs

| | Sessions | Chat & new sessions | Photos | Live limits | Token usage | Backends |
|---|:-:|:-:|:-:|:-:|:-:|---|
| **Claude Code** | ✅ | ✅ | ✅ | ✅ | ✅ | Subscription · API key · Bedrock · Vertex · gateway / own server |
| **Codex** | ✅ | ✅ | ✅ | ✅ | ✅ | ChatGPT · API key · Azure OpenAI · gateway / own server |
| **Antigravity** | ✅ | ✅ | ✅ | ✅ | ✅ | Google account |
| **OpenCode** | beta | beta | ✅ | — | ✅ | Free models · any OpenAI-compatible server |
| **Cursor** | beta | beta | ✅ | — | — | Cursor account |

*beta* — implemented from the tools' documented formats; not yet verified against a live install.

## Bring your own model

Not everyone uses a subscription. In **Get started → Connect AI**, choose *API key*, *Company account* or *Models on your computer*:

| You have… | Use | Baton writes |
|---|---|---|
| An Anthropic API key | Claude Code → *Anthropic API key* | `~/.claude/settings.json` (`env`) |
| AWS Bedrock access | Claude Code → *Amazon Bedrock* | `CLAUDE_CODE_USE_BEDROCK`, region, profile, model |
| GCP Vertex access | Claude Code → *Google Vertex AI* | `CLAUDE_CODE_USE_VERTEX`, project, region, model |
| A gateway / self-hosted model with the **Anthropic Messages API** (e.g. LiteLLM) | Claude Code → *LLM gateway · your own server* | `ANTHROPIC_BASE_URL`, token, model |
| An OpenAI API key | Codex → *OpenAI API key* | `codex login --with-api-key` |
| Azure OpenAI / gateway / server with the **OpenAI Responses API** | Codex → *Your own server* | `~/.codex/config.toml` provider |
| Ollama, vLLM, LM Studio… (**chat completions** only) | OpenCode → *OpenAI-compatible server* | `opencode.json` provider |

Every write backs up the existing file first, and the CLI behaves the same in your terminal.
Forms that take a server address load its model list (`/v1/models`) so you can pick a model instead of typing it. After connecting, Baton sends a one-line prompt through it to test.

> Codex only speaks the Responses API (`wire_api = "chat"` was removed). For chat-only servers use OpenCode, or put a Responses-capable proxy such as LiteLLM in front.

### Company machines

- **Your shell's environment is used.** Baton reads your login shell (`~/.bashrc`, `~/.zshrc`) at startup and passes it to every CLI, so `AWS_PROFILE`, `HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`, etc. work even when Baton runs as a background service. Add anything else in **Settings → Company setup · CLI environment**.
- Relocated configs (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) are followed.
- Bedrock / API / gateway setups show "no subscription limits" instead of errors, the model picker offers what that backend understands, and every picker accepts a free-form model id.

## MCP servers

### Add one in a tap

In **Get started → Add tools** or with **＋** on **Tools → MCP servers**, pick a server and the CLIs to add it to:
Context7, Playwright, Chrome DevTools, GitHub, Filesystem, Memory, Sequential Thinking, Fetch, Notion, Linear, Sentry, Supabase, Figma — or your own command / URL.
Baton writes each CLI's own global config (`claude mcp add-json -s user`, `~/.codex/config.toml`, `mcp_config.json`, `opencode.json`, `~/.cursor/mcp.json`) and keeps a `.baton-backup` of the previous file.
On a server's page, **Add to other CLIs** copies it (keys included — they stay on your computer) and **Delete** removes it.

### See what's loaded and used

**Tools → MCP servers** lists every MCP server your CLIs can see, grouped by where it's configured:

| CLI | Global | Per project |
|---|---|---|
| Claude Code | `~/.claude.json` (user), plugins, `managed-mcp.json`, claude.ai connectors | `.mcp.json` (shared, needs approval) · `~/.claude.json` → `projects` (local, just you) |
| Codex | `~/.codex/config.toml` `[mcp_servers.*]` | `.codex/config.toml` |
| Antigravity | `~/.gemini/config/mcp_config.json`, plugins | `.agents/plugins/*/mcp_config.json` |
| OpenCode | `~/.config/opencode/opencode.json` `mcp` | `opencode.json` |
| Cursor | `~/.cursor/mcp.json` | `.cursor/mcp.json` |

- **What does the agent load here?** A project page and the 🔌 chip in a chat show the servers that apply in that folder. The closest scope wins (local > project > global), and servers that are off, not yet approved, or overridden are marked.
- **What did it actually use?** Calls are read from Claude Code and Codex transcripts: count, tools, last used, and which sessions used them. Servers nobody calls just cost context.
- **Is it connected?** ↻ / *Check connections* runs `claude mcp list` in that folder. Sessions started from Baton also record each server's status, and a failed or unauthenticated server is flagged while the reply streams.
- Environment variables and header values are never shown in the browser, and token-looking arguments and URL parameters are masked.

## Use it from your phone

Baton listens on `127.0.0.1` only. **Get started → Phone** walks you through it:

1. Install [Tailscale](https://tailscale.com/download) on your computer and sign in.
2. Install Tailscale on your phone (scan the QR code) and sign in with the same account. Baton notices when your phone joins.
3. Press **Share to my devices**, then scan the QR code with your phone camera. It's reachable only inside your own tailnet, never the public internet.
4. **Add to Home Screen** and turn on notifications in Settings (iOS allows web push only for home-screen apps).

There is no password: Baton trusts the Tailscale identity of the request. To allow only specific accounts, start Baton with `BATON_ALLOWED_LOGINS=me@example.com`. See [SECURITY.md](SECURITY.md).

## Questions from the agent

When an agent needs you to choose, you answer in the chat:

- **Claude Code** — its question tool (AskUserQuestion) shows up as a card with the options, multi-select and your own text — one question per page, then a review page and Submit. The reply continues once you answer. If you're not looking, your phone gets a notification.
- **Every CLI** — when a reply ends with a question and a short list of choices, the choices become buttons. Tapping one sends it as your next message. Several numbered questions with choices get the same one-per-page card, and your answers go back as one message.

## Working folders

Browse subfolders when starting a session or moving its working folder, and search projects by name or path. The default working folder is `workspace` under the **home of the account running Baton**, if that directory exists; otherwise it is the home folder. Baton does not create `workspace` automatically. Choose a different folder in **Settings → Working folders → Default working folder → Change** to use it for new sessions. On a phone, the browser still shows folders inside the home directory of the computer running Baton.

## Look and feel

Wide screens get a studio layout with a sidebar; phones keep the compact one. Pick a color palette (Default, Forest, Nord, Dracula, Tokyo Night, Monokai, Rosé Pine) and light / dark / system brightness in **Settings → Appearance & language**.

## Updates

Baton checks for a new release a few times a day and tells you once: a banner on Home and a notification. **Update now** switches to the new release, installs its packages and restarts Baton — sessions and settings stay. Installs from the install line only ever move between releases; a checkout of the `main` branch pulls `main` instead. If you installed from a zip, or the Baton folder has local changes, you get the steps instead. Installed with `git clone` before 0.8? Run `git fetch --tags && git checkout v0.8.0` in the Baton folder once, and from then on it follows releases. Check any time from the version line at the bottom of Settings; turn the alerts off in **Settings → Notifications**.

## How it works

```
 your CLIs ──write──▶ session files (~/.claude, ~/.codex, …) ──read──▶ Baton ──▶ browser / phone
                                                       ▲                 │
                                                       └── claude -p --resume, codex exec resume, … ◀── you send a message
```

Baton is a small Node.js server with no build step. It never stores your conversations — it reads the CLIs' own files and runs the CLIs themselves. Its own state (pins, briefs, settings) lives in `data/` on your computer.

## Troubleshooting

| Problem | Fix |
|---|---|
| A CLI shows *Not installed* right after installing | Press ↻ on Get started. On Windows, restart Baton so it sees the new PATH. |
| Works in my terminal, fails from Baton | Check **Settings → Company setup** — the variable it needs may only exist in a shell Baton didn't read. Add it there. |
| Port 7420 is taken | `BATON_PORT=7421 npm start` |
| Windows: Codex / Antigravity misbehave | They work best inside WSL. See [Windows: install in WSL](#windows-install-in-wsl-step-by-step). |
| A dev server won't open on the phone | Vite and friends block unknown hosts — set `server.allowedHosts`. |

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) — free to use, modify and share; keep the copyright notice.
