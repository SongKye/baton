# Changelog

All notable changes to Baton are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Session menu from any list**: every session row (Home, Sessions, project page) has a ⋯ button that opens the session menu — rename, pin, move, trash… — without opening the chat. Long-press / right-click now works on the project page too.
- **Bulk trash on the project page**: *Select* next to the session list, tick sessions (or *Select all*), then *Move to trash*.

### Changed
- **Agent questions, one per page**: when an agent asks several questions, you now see one at a time — tap a choice (single-choice questions turn the page by themselves) or type your own, step back with *Back*, check everything on a review page and *Submit*. A single single-choice question is still one tap.
- Codex, Antigravity, OpenCode and Cursor ask in plain text (their question tools don't reach Baton): a reply that ends with several numbered questions, each with options, now gets the same paged card, and your answers go back as one message.

## [0.2.1] - 2026-11-06

### Added
- **Update notices**: Baton checks GitHub Releases a few times a day (falling back to `git ls-remote --tags` for private forks or rate limits) and tells you once per new version — a banner on Home, the inbox and a push notification. **Update now** runs `git pull --ff-only` and `npm ci --omit=dev`, then restarts Baton (systemd / launchd / plain process) and reloads the page. Zip installs and git checkouts with local changes or another branch get instructions instead. Turn it off in Settings → Notifications (*New version alerts*).

### Fixed
- Project page: the folder path under the title no longer repeats after each edit, and pins, renames, notes and status changes show up right away.

## [0.2.0] - 2026-11-05

### Added
- **Guided setup**: Get started is now five numbered steps with a progress bar (computer → connect AI → add tools → phone → auto-start), and adapts when opened from a phone.
  - **Connect AI by how you use it**: subscription, API key, company account, or models on your own computer. Paste an API key and Baton recognizes it (Anthropic, OpenAI, OpenRouter, Groq) and connects the right CLI. Model servers running locally (Ollama, LM Studio, vLLM, LiteLLM, llama.cpp, Jan) are found automatically. Gateway / server forms load the model list from the address you enter.
  - **Phone, step by step**: Tailscale on the computer, Tailscale on the phone (detected on your tailnet), share, then scan a QR code instead of typing the address. QR codes are generated locally.
- **MCP servers** (Tools → MCP servers): every MCP server Claude Code, Codex, Antigravity, OpenCode and Cursor can see, by scope (global / project / local / plugin / managed / claude.ai connectors). Shows on/off, approval and override state, call counts and tools from Claude Code and Codex transcripts, and connection status (`claude mcp list`, plus status recorded by Baton-started runs). Project pages and a 🔌 chip in chat show what each CLI loads in that folder. Secrets are never shown.
- **MCP quick setup**: one-tap presets (Context7, Playwright, Chrome DevTools, GitHub, Filesystem, Memory, Sequential Thinking, Fetch, Notion, Linear, Sentry, Supabase, Figma) or your own command / URL, added to several CLIs at once. On a server's page: **Add to other CLIs** (copies the config, secrets included, server-side) and **Delete**. Each CLI's own config is written, with a `.baton-backup` copy.
- **The agent can ask you questions in chat** (Claude Code): AskUserQuestion shows up as a card with the options, multi-select and free text. Tap to answer and the reply continues; Skip lets it decide. If you're not looking, your phone gets a notification.
- **Quick replies** (every CLI): when a reply ends with a question and a short list of choices, the choices become buttons; tapping one sends it as your next message. Covers Codex and Antigravity, whose question tools don't reach headless runs.
- **Scheduled messages**: queue a message for a session to be sent as soon as its CLI's usage limit resets (re-checked live, postponed if still exhausted, retried if it hits the limit again) or at a chosen time. From the limit-reached card, the chat ⋯ menu, and Tools → Scheduled messages.
- **Desktop notification cards**: on a desktop browser, new notifications (reply finished, watched session done, scheduled message sent, nudges) pop up as cards in the bottom-right corner. Click to open the session; hover to keep them. When push is on and the Baton tab is focused, the card replaces the OS notification so you don't get both. Toggle per computer in Settings → Notifications.
- **Studio layout and themes**: wide screens get a sidebar layout; color palettes (Default, Forest, Nord, Dracula, Tokyo Night, Monokai, Rosé Pine) with light / dark / system brightness in Settings → Appearance & language.
- **Folder browsing**: browse subfolders when starting a session or moving its working folder, search projects by name or path, and choose a default working folder (Settings → Working folders).
- MIT license.

### Changed
- **Remote access uses your Tailscale identity** instead of a Baton password and device cookies. Restrict it to specific accounts with `BATON_ALLOWED_LOGINS`. Requests that don't come through the local Tailscale proxy with an identity are rejected. See SECURITY.md.
- Notifications say who answered: the title is "From Claude Code - Opus 5.5" (CLI and model), the body shows the session and the reply.
- Claude Code runs use the CLI's control protocol (`--input-format stream-json --permission-prompt-tool stdio`) so questions reach Baton; other approval prompts are still declined, as before.
- Settings are grouped (Appearance & language, Workspace & sessions, Notifications & reminders, AI briefs, Advanced).
- Antigravity models are grouped by model with their effort levels instead of one entry per variant.

### Fixed
- Codex sessions whose first message sits far into the transcript (large images, long setup messages) no longer disappear from the list.

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

[Unreleased]: https://github.com/SongKye/baton/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/SongKye/baton/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/SongKye/baton/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/SongKye/baton/releases/tag/v0.1.0
