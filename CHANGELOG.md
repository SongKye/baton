# Changelog

All notable changes to Baton are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- Phone: the screen no longer goes black after leaving a chat (it used to stay black until you dragged it). Leaving a chat now closes the keyboard and stops the message list first, and each screen change asks the phone to repaint. (#71)

### Changed
- Reorganized the English and Korean READMEs around product benefits, desktop/mobile screenshots and a three-step quick start; moved detailed setup and feature instructions into linked user guides.
- Clarified that Cursor integration is unverified, not officially supported, and has no current plans for official support; removed it from the README supported-tools list.

## [0.9.0] - 2026-11-08

### Added
- **Start Baton again without a terminal command or the port**: setup adds a **Baton** shortcut to the Windows Start menu and desktop, and a `baton` command on macOS / Linux / WSL (`~/.local/bin`). Both start Baton and open the dashboard, or just open the dashboard when Baton is already running. Run the installer again to get them on an existing install.

## [0.8.8] - 2026-11-08

### Fixed
- **Updating works from a branch that was already merged**: if Baton's folder is on a branch whose commits are all in `main` (e.g. after a merged PR), the update switches back to `main` and pulls instead of staying on the old branch. Other branches get the right manual command (`git checkout main && git pull`).

### Changed
- **Settings → Baton version card**: shows the current version and "Latest version: vX.Y.Z" with an Update button that is only enabled when a newer release exists. Opening Settings checks GitHub (at most every 5 minutes).
- **New-version alerts are disabled**: automatic release checks, Home banners, inbox and push alerts are off and cannot be re-enabled, including through saved settings or the API. Manual checks and updates remain available in Settings.

## [0.8.7] - 2026-11-08

### Added
- **Update and restart Baton from Settings**: a new "Baton version · Updates" card at the bottom of Settings shows the current version and any new release (update in one tap; Baton restarts and reloads on its own), plus a "Restart Baton" button so you never need a terminal just to restart.

### Fixed
- **The update sheet no longer offers a zip download on git installs**: if the new version is already on disk (pulled by hand) it just offers to restart; if Baton can't update itself (another branch, edited files) it shows the command plus a restart button. The zip link is only for zip installs.

## [0.8.6] - 2026-11-08

### Fixed
- **No more "MCP connection problem" note on every message for unused claude.ai connectors**: connectors that come attached to your claude.ai account (e.g. Google Calendar) but were never authorized no longer show "Needs auth" in the chat. The MCP panel still shows their status, and real connection failures are still reported.
- **OpenCode on Windows shows readable model names and effort levels**: Windows prints `opencode models --verbose` with CRLF line endings, so Baton couldn't read it and fell back to raw model ids with no effort choice. The list now parses the same as on WSL/macOS/Linux.
- **OpenCode models appear right after installing or signing in, without restarting Baton**: a missing CLI was remembered until restart and the model list was cached for hours. Baton now notices a newly installed CLI within seconds, refetches the list when an install/sign-in finishes, and also when OpenCode's sign-in (`auth.json`) or `opencode.json` changes from the user's own terminal.

## [0.8.5] - 2026-11-08

### Fixed
- **Claude Code no longer shows "Ready" with an old, expired sign-in**: a leftover `~/.claude/.credentials.json` from an earlier install counted as signed in. Baton now checks the saved login, and shows "Login expired" with the sign-in button (like Codex) when it was rejected or has been expired for over a week. A credentials file without a Claude login is no longer treated as signed in.
- **Deleting an OpenCode session from its database now works safely**: the session is archived in place and restored or purged together with the trash, and old JSON copies of a migrated session can't bring it back.

## [0.8.4] - 2026-11-08

### Fixed
- **Windows installation no longer fails with an unterminated-string error**: install and setup scripts use ASCII text so Windows PowerShell 5.1 can read them regardless of the system encoding. Windows CI now checks their encoding and parses them with Windows PowerShell.
- **Windows setup reports failures instead of continuing as if installation succeeded**: invoke `npm.cmd` explicitly, stop on dependency installation errors, and propagate setup/server failures to the installer. Existing files are described as downloaded files, not a completed installation. Windows CI exercises fresh installs, retries, release upgrades, and failure handling.

## [0.8.3] - 2026-11-08

### Fixed
- **Windows and WSL can run independent Baton installations without choosing ports manually**: native Windows defaults to 7421 and Linux/WSL to 7420, with separate fallback port ranges. Baton remembers the selected port across restarts and auto-start, checks installation identity before reusing a running server, and uses the actual port for setup and phone sharing.

## [0.8.2] - 2026-11-08

### Fixed
- **Claude Code and Codex show a sign-in button right after installing**: a fresh install was mistaken for "already connected with an API key", so the account sign-in button was hidden.
- **You can tell whether an install or sign-in is running**: the button turns into "Installing…" and can't be tapped twice, a timer and status line show progress, and the end says clearly whether it worked — with the reason and a "Try again" button if it didn't. Tapping again (or from another device) joins the running job instead of starting a second one, and the progress comes back if you leave and reopen the page.

### Changed
- **Sign in with your account, per tool**: "Sign in with Claude / ChatGPT / Google / Cursor" buttons with a short how-to — no API key needed.
- **Line icons instead of emoji** in the setup page, folder picker, MCP lists, session and project menus, and chat tool summaries, so they match the rest of the app.

## [0.8.1] - 2026-11-08

### Added
- **Step-by-step WSL guide in the README**: turning on WSL, installing, starting Baton again, auto-start (and enabling systemd), updating and removing.

### Fixed
- **Installing on a fresh Ubuntu / WSL no longer stops at `unzip … Missing!`**: setup installs `unzip` (with `apt-get`) before installing Node.js, so Baton actually starts.
- **`node` is found in new terminals after setup installs it**: fnm is now added to your shell's config, so `cd ~/baton && npm start` works later.
- **The install line works for private forks**: when the repository needs a sign-in, `install.sh` downloads it with the GitHub CLI (`gh`) if you're signed in.

## [0.8.0] - 2026-11-08

### Added
- **One-line install of the latest release**: `curl -fsSL https://raw.githubusercontent.com/SongKye/baton/main/scripts/install.sh | bash` on macOS, Linux and WSL, or `irm https://raw.githubusercontent.com/SongKye/baton/main/scripts/install.ps1 | iex` in Windows PowerShell. It installs the newest release into `~/baton` (or `BATON_DIR`) and starts it. Running it again moves to the newest release.

### Changed
- **Update now installs releases, not the latest code on `main`**: installs from the install line switch to the new release tag. A checkout of the `main` branch still pulls `main`. To move an older `git clone` install to releases, run `git fetch --tags && git checkout v0.8.0` in its folder once.

## [0.7.0] - 2026-11-08

### Added
- **Type @ in the chat box to pick files, folders, skills and MCP servers**: Baton searches the chat's folder (following `.gitignore` in git repos) and shows the skills and MCP servers the chosen CLI loads there, including project-level ones from parent folders. Picking an item writes it into your message: `@path` for files and folders, `/skill` for Claude Code, `$skill` for Codex, and a short phrase for the other CLIs. Skills from other CLIs are listed too; picking one asks the agent to read that skill's `SKILL.md`. Baton only lists names and never sends file contents.

## [0.6.0] - 2026-11-07

### Added
- **Dev servers stay listed and come back**: Baton remembers each project's dev servers (folder, command, port). Servers that agents or terminals start are added automatically. Turn one off and it stays in the list so you can start it again with one tap; remove it to drop it from the list. Servers left on are started again after a reboot or a Baton restart. See **Tools → Served ports** and each project page. Other programs with an open port (remote desktop, adb…) are collapsed under **Other programs**.
- **Linked services on project pages**: Baton shows the GitHub repo and hosting and backend services a project is set up for, such as Vercel, Firebase, Supabase, Netlify, Cloudflare, Fly.io and itch.io. Each has a link to its dashboard. Baton only reads the project's config files and never reads secret values.
- **Tools → Git repositories**: every git remote used by your projects, with the projects (folders, worktrees) that use it. Repos are marked as yours or external. Projects that use git without a remote are listed separately. "Yours" means the repo belongs to the account signed in to the GitHub CLI (`gh`) or to one of its organizations. Without `gh`, Baton falls back to `github.user` in your git config, and shows no badge if neither is set.
- **Add your own links to a project**: use **+ Add link** under Linked services to keep dashboards Baton can't detect on the project page, such as a live site, an admin console or a planning doc. Known services get their logo automatically.
- Linked services and repositories now show each service's real logo (from Simple Icons, CC0).

### Changed
- **Tools icons**: the Tools screen uses line icons that match the tab bar instead of emoji.

### Fixed
- **Updating or restarting Baton no longer stops dev servers**: servers Baton starts now run in their own systemd user unit on Linux, or as a detached process elsewhere, so they no longer share Baton's process group.

## [0.5.0] - 2026-11-07

### Added
- **Pull to refresh**: on a phone, pull down from the top of any screen (or the top of a chat) to reload it.

### Changed
- Updated DOMPurify from 3.2.6 to 3.4.17 and marked from 15.0.12 to 18.1.3 for security hardening and Markdown fixes.
- Updated the CI and release workflows to actions/checkout v7 and actions/setup-node v7.

### Fixed
- **Claude chat image history**: attached photos remain visible after replies, refreshes and reopening a chat. Images load lazily from the session transcript; tap a preview to open the full image.
- **Sessions no longer vanish when the first message has a large screenshot**: Baton could treat such a Claude session as empty, drop it from the list, and show "Session not found" when you opened it.
- **Phone notifications no longer get dropped on a network hiccup**: if sending a push fails because of a brief connection problem, Baton retries twice before giving up, and logs the real error instead of an empty `[push] failed`.
- **Notifications show on a locked iPhone**: the app no longer waits on a suspended Baton window before showing a push notification on phones.

## [0.4.0] - 2026-11-06

### Added
- **Desktop chat input**: on a mouse + keyboard computer, Enter sends and Shift+Enter starts a new line (Ctrl/Cmd+Enter still works; phones keep Enter as a new line). Paste an image or drag it onto the chat to attach it.
- **Open a local server in one click**: on *Serving ports*, web servers get an *Open ↗* button (`http://localhost:port`) when you're using Baton on that PC.
- **Esc closes sheets** (only the top one when several are open).
- **Show more on the project page**: projects with more than 40 sessions now page through all of them; *Select all* covers every row on screen.
- **OpenCode and Cursor filters** on the Sessions and Skills tabs (every installed tool gets a chip).

### Changed
- **Automated sessions are listed like any other** (tagged *Auto*) instead of being hidden by default — scripts, `codex exec`, another tool's `claude -p`, subagents. Hide what you don't want: *Select* → **Hide** on the Sessions tab or a project page (hides many at once; *Unhide* from the *Hidden* filter), or *Cleanup* → tick *Automated* → **Hide** to clear them all in one go. The *Show automated sessions* setting, the *Include automated* chip and the project page's *Show automated* button are gone.

### Fixed
- Leaving a chat before it finished loading no longer lets the old session's late reply overwrite the screen you moved to (or show a stray "Couldn't load" error).
- **Background runs show up while they're running**: when another tool hands work to a CLI in the background (e.g. Antigravity running `claude -p`, or a script running `codex exec`), the session now appears in *Running now* with a *Working in background* tag, and its page follows along live. Once it finishes, a delegated Claude session that actually did work (used tools) stays in your list tagged *Delegated*; one-shot script calls are still hidden as automated.
- Desktop home: the update banner stays at the top instead of dropping to the bottom of the side column; the duplicate *New session* button and logo are gone; the usage card shows every installed tool without overflowing; sleeping projects stack as cards instead of a hidden-scrollbar strip.
- Desktop chat: header, new-session bar, messages and input share one width; the sidebar keeps *Sessions* highlighted; the running-reply pill for other sessions stays visible.
- Two-column port cards on wide screens no longer sit 10px out of line or overflow.
- Desktop notification cards and their setting now work from 760px, matching the desktop layout.
- *Original layout* and *Compare layouts* pages have a link back to the default screen.
- A missing script, style or image now returns 404 instead of the app page, and notifications use the new Baton icon.

## [0.3.0] - 2026-11-06

### Added
- **Session menu from any list**: every session row (Home, Sessions, project page) has a ⋯ button that opens the session menu — rename, pin, move, trash… — without opening the chat. Long-press / right-click now works on the project page too.
- **Bulk trash on the project page**: *Select* next to the session list, tick sessions (or *Select all*), then *Move to trash*.
- **Mute a session or a project**: ⋯ → *Mute this session* / *Mute this project*. Muted sessions still show up in the inbox, just without a phone or desktop alert. 🔕 marks them in lists.
- **Edit the project note in place**: tap the note to edit it right there (Ctrl+Enter saves, Esc cancels); an empty project shows a *Leave a note* button.

### Changed
- **New icon and calmer default colors**: a new Baton mark (two hand-off strokes on warm paper) for the app icon, home-screen icon, notifications, the Home title and the desktop sidebar. The default theme moves from orange to warm neutrals with a muted green accent; the desktop sidebar is now charcoal. Reinstall or re-add Baton to your home screen if the old icon sticks around.
- **Agent questions, one per page**: when an agent asks several questions, you now see one at a time — tap a choice (single-choice questions turn the page by themselves) or type your own, step back with *Back*, check everything on a review page and *Submit*. A single single-choice question is still one tap.
- **Notifications are on for every session by default**: you get a ping each time any session finishes, whether it ran in Baton or in a PC terminal (sessions active in the last 3 hours are followed; automated runs are skipped). The old per-session "notify me once / every time" opt-in is gone; mute instead. The *Reply finished* switch in Settings still turns all of it off.
- Codex, Antigravity, OpenCode and Cursor ask in plain text (their question tools don't reach Baton): a reply that ends with several numbered questions, each with options, now gets the same paged card, and your answers go back as one message.

### Fixed
- Dragging inside a bottom sheet no longer scrolls the page behind it on phones.
- Bottom sheets (note, rename, …) no longer slide down when you drag inside a text field to select or scroll text; swipe down from the handle or title still closes them.

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

[Unreleased]: https://github.com/SongKye/baton/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/SongKye/baton/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/SongKye/baton/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/SongKye/baton/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/SongKye/baton/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/SongKye/baton/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/SongKye/baton/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/SongKye/baton/releases/tag/v0.1.0
