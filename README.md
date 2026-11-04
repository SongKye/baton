<div align="center">

# 🏃 Baton

**One dashboard for all your AI coding sessions.**
Claude Code · Codex · Antigravity · OpenCode · Cursor — on your desktop and your phone.

[![CI](https://github.com/SongKye/baton/actions/workflows/ci.yml/badge.svg)](https://github.com/SongKye/baton/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/SongKye/baton?include_prereleases)](https://github.com/SongKye/baton/releases)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2022.13-339933)
![Platforms](https://img.shields.io/badge/platforms-Linux%20%7C%20macOS%20%7C%20Windows%20%7C%20WSL-555)

English · [한국어](README.ko.md)

</div>

---

Vibe coding means juggling many projects across many agents — and forgetting where you left off.
Baton reads the session files your CLIs already write, puts them in one place, and lets you pick any of them back up from a browser — or your phone.

- 🗂 **Every session, one list** — titles, previews, search, pins, and which ones are running right now (even in a terminal)
- 💬 **Continue anywhere** — streaming chat, tool calls, photos; choose model, reasoning effort and permissions per message
- 🧭 **"Where was I?"** — AI briefs per project (done / next / ready-to-send prompts) and a daily nudge for forgotten projects
- 🔀 **Spread the load** — open a new session in the same project with another CLI, or hand a session over when one runs out of tokens
- 📊 **Limits & usage** — live subscription limits and token usage per CLI and model
- 🖥 **Served ports · 🧩 skills · 🧹 cleanup** — what's running where, which skills agents actually use, and one-tap cleanup of throwaway sessions
- 🔔 **Notifications** — your phone buzzes when a reply finishes
- 🏢 **Any backend** — subscriptions, API keys, Amazon Bedrock, Google Vertex, LLM gateways and self-hosted models

## Quick start

You need **Node.js 22.13+** (the setup scripts can install it).

<table>
<tr><th>macOS · Linux · WSL</th><th>Windows (PowerShell)</th></tr>
<tr><td>

```bash
git clone https://github.com/SongKye/baton.git
cd baton
./scripts/setup.sh
```

</td><td>

```powershell
git clone https://github.com/SongKye/baton.git
cd baton
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

</td></tr>
</table>

No Git? Download the zip from [Releases](https://github.com/SongKye/baton/releases), unzip, and run the same script.

Baton opens **http://localhost:7420** with a **Get started** screen that walks you through:

1. **Your computer** — OS, Node.js, Git (one-click Git install on Windows/macOS)
2. **AI coding tools** — one-click install of each CLI with its vendor's official installer, then sign in (sign-in link, device code and code paste are handled in the page)
3. **Connect without a subscription** — API key, Bedrock, Vertex, gateway or your own server, plus a **Test connection** button
4. **Phone access** (optional) — share Baton to your own devices with Tailscale
5. **Start on login** (optional) — systemd / launchd / Windows Startup

Existing sessions show up as soon as a CLI is installed. Later: `npm start` (or `npm run open`).

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

Not everyone uses a subscription. In **Get started → Connect via API / company / own server**:

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
Then press **Test connection** to send a one-line prompt through it.

> Codex only speaks the Responses API (`wire_api = "chat"` was removed). For chat-only servers use OpenCode, or put a Responses-capable proxy such as LiteLLM in front.

### Company machines

- **Your shell's environment is used.** Baton reads your login shell (`~/.bashrc`, `~/.zshrc`) at startup and passes it to every CLI, so `AWS_PROFILE`, `HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`, etc. work even when Baton runs as a background service. Add anything else in **Settings → Company setup · CLI environment**.
- Relocated configs (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) are followed.
- Bedrock / API / gateway setups show "no subscription limits" instead of errors, the model picker offers what that backend understands, and every picker accepts a free-form model id.

## Use it from your phone

Baton listens on `127.0.0.1` only. Install [Tailscale](https://tailscale.com/download) on your computer and phone, then press **Share to my devices** in Get started — it's reachable only inside your own tailnet, never the public internet. Open the link on your phone, **Add to Home Screen**, and turn on notifications in Settings (iOS allows web push only for home-screen apps).

New devices enter a password once (default **`0000`** — change it in **Settings → Security**) and are remembered for 30 days. See [SECURITY.md](SECURITY.md).

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
| Windows: Codex / Antigravity misbehave | They work best inside WSL — run `./scripts/setup.sh` in WSL and open `http://localhost:7420` from Windows. |
| A dev server won't open on the phone | Vite and friends block unknown hosts — set `server.allowedHosts`. |

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).
