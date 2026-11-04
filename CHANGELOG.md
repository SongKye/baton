# Changelog

All notable changes to Baton are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-05

First public preview.

### Sessions & chat
- One list of every session from **Claude Code, Codex, Antigravity, OpenCode and Cursor**, with titles, previews, search, pin/hide and live "running" state (including sessions open in a terminal).
- Continue any session or start a new one from the browser: streaming replies, collapsible tool calls, photo attachments, and per-message model / effort / permission choice (with the real default shown).
- Start a new session in the same project with any CLI, or **hand a session over to another CLI** when one runs low on tokens (handoff note with an optional compact-style summary written by the source agent).
- **Move a session** to the folder it really works in (Claude Code's `claude --resume` list follows).
- Push notifications when a reply finishes — per session, even for terminal sessions.

### Projects
- Sessions grouped into projects with an AI "where was I?" brief (what's done, what's next, ready-to-send prompts) and a daily nudge for projects you forgot.

### Tools
- Live subscription limits (Claude, Codex, Antigravity) and token usage per CLI and model.
- Served ports: which dev servers run, from which project and agent session; share one to your phone over Tailscale.
- Skills: every skill/command each CLI can see, where it lives and when it was actually used.
- Cleanup: trash test / automated / one-line sessions in bulk; restorable for 30 days.

### Setup & platforms
- **Get started** screen: environment check, one-click install and sign-in for all five CLIs, phone access via Tailscale, start on login (systemd / launchd / Windows Startup).
- **Any backend**: subscription, API keys, Amazon Bedrock, Google Vertex, LLM gateways and self-hosted servers — connect from the setup screen (writes the CLI's own config) and test the connection. Login-shell environment and extra variables are passed to every CLI; `CLAUDE_CONFIG_DIR` / `CODEX_HOME` honored.
- Linux, macOS, Windows and WSL; mobile and desktop layouts; English and Korean.

### Security
- Listens on `127.0.0.1` only. Other devices need a password once (default `0000` — change it) and are remembered for 30 days; failed attempts are rate-limited.

[Unreleased]: https://github.com/SongKye/baton/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/SongKye/baton/releases/tag/v0.1.0
