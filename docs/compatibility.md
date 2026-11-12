# CLI compatibility

Baton doesn't use an SDK for the coding-agent CLIs. It runs each CLI, reads its streamed output and reads the
session files it leaves on disk. Any CLI release can change those, so Baton records the **exact version it
was verified with** for each CLI. The source of truth is `server/compat.js`. This page explains it.

## Supported versions

| CLI | Support | Verified version | Verified on | Latest seen when verified |
|---|---|---|---|---|
| Claude Code | Supported | **2.1.318** | 2026-11-12 | 2.1.322 (npm) |
| Codex | Supported | **0.156.0** | 2026-11-12 | 0.167.2 (npm) |
| Antigravity | Supported | **1.5.6** | 2026-11-12 | — (not on npm) |
| OpenCode | Beta | — (built for 1.x from the docs) | — | 1.19.5 (npm) |
| Cursor | Unverified | — | — | — |

Baton shows the same information in **Settings → Supported AI tool versions** and on each tool's card in
**Get started → Connect AI**, compared with the version you have installed:

| Shown | Meaning | What to do |
|---|---|---|
| Verified | Installed version = verified version | Nothing |
| Newer, not checked yet | Installed version is newer than the verified one | Usually fine. If something breaks, include the CLI version when you report it |
| Older than verified | Installed version is older | Update the CLI if something misbehaves |
| Beta / Unverified | Baton has no verified version for this CLI | Expect rough edges |

"Supported" covers versions from the verified one onward until a release breaks something. Baton doesn't
block a CLI version or refuse to run it.

### What "verified" covered on 2026-11-12

- `npm run compat:check`: every flag and subcommand below appears in the installed CLI's `--help`.
- A one-line headless prompt through each CLI, using the flags Baton uses. The streamed events matched what
  Baton's parsers read (listed below).
- Those versions were in daily use on the maintainer's machine for sessions, the chat, limits and MCP setup.

It didn't cover every feature on every OS. Windows and macOS weren't re-checked for this table.

## What Baton relies on

If a feature breaks right after a CLI update, look here first. The file shows which code to read.

### Claude Code

| Surface | Used for | Code |
|---|---|---|
| `-p --output-format stream-json --verbose --include-partial-messages --input-format stream-json --permission-prompt-tool stdio` | Chat. Uses the Agent SDK control protocol (`control_request` / `control_response`, `initialize`, `can_use_tool` for AskUserQuestion) | `server/runner.js` `claudeCmd`, `claudeParser` |
| `--resume`, `--model`, `--effort`, `--permission-mode plan\|auto`, `--dangerously-skip-permissions` | Continue a session, model/effort pickers, permission modes | `server/runner.js` |
| Stream events `system/init` (`session_id`, `model`, `mcp_servers`), `stream_event` (`content_block_*`), `assistant`, `user`, `result` (`total_cost_usd`, `usage`, `permission_denials`) | Live chat view, MCP status, cost | `server/runner.js` `claudeParser` |
| `-p --output-format json --no-session-persistence --permission-mode plan --tools ""` | Briefs, skill and MCP drafts | `server/runner.js` `oneShot` |
| `--resume <id> --fork-session --no-session-persistence` | Hand-off summary | `server/handoff.js` |
| `~/.claude/projects/<slug>/<id>.jsonl` (entry types `user`, `assistant`, `summary`, `ai-title`, `custom-title`, `system/compact_boundary`; flags `isSidechain`, `isMeta`) | Session list, transcripts, token usage | `server/sources/claude.js`, `server/usage.js` |
| `~/.claude/sessions/<pid>.json` | Sessions running in a terminal | `server/sources/claude.js` |
| `~/.claude/.credentials.json` (`claudeAiOauth`), `auth status` | Sign-in state | `server/tools.js`, `server/providers.js` |
| `https://api.anthropic.com/api/oauth/usage` (`anthropic-beta: oauth-2025-04-20`), **undocumented** | Live limits | `server/limits.js` |
| `mcp add-json -s`, `mcp get`, `mcp list`, `mcp remove`; `~/.claude.json`, `.mcp.json` | MCP setup and health | `server/mcp*.js` |
| `~/.claude/settings.json` `env`, `model` | Company setups, default model | `server/connect.js`, `server/models.js` |
| `~/.claude/skills`, plugin `skills/` folders | Skills | `server/skills.js` |

### Codex

| Surface | Used for | Code |
|---|---|---|
| `exec [resume] --json --skip-git-repo-check --image -m -c model_reasoning_effort=… -c sandbox_mode=… --dangerously-bypass-approvals-and-sandbox <id> -` | Chat, continue a session | `server/runner.js` `codexCmd` |
| Events `thread.started`, `item.started` / `item.completed` (`agent_message`, `reasoning`, `command_execution`, `file_change`, `mcp_tool_call`, `web_search`, `todo_list`), `turn.completed`, `turn.failed`, `error` | Live chat view | `server/runner.js` `codexParser` |
| `exec --ephemeral` | Briefs, drafts | `server/runner.js` `oneShot` |
| `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (`session_meta`, `turn_context`, `event_msg`, `response_item`), `~/.codex/session_index.jsonl` | Session list, transcripts, token usage | `server/sources/codex.js`, `server/usage.js` |
| `~/.codex/auth.json`, `login status`, `login --device-auth`, `login --with-api-key` | Sign-in | `server/tools.js`, `server/connect.js` |
| `https://chatgpt.com/backend-api/wham/usage`, **undocumented** | Live limits, expired sign-in check | `server/limits.js`, `server/tools.js` |
| `debug models` | Model picker | `server/models.js` |
| `~/.codex/config.toml` (`model`, `model_provider`, `[model_providers.*]`, `[mcp_servers.*]`, trusted projects), `mcp get --json` | Company setups, MCP | `server/connect.js`, `server/mcp*.js` |

### Antigravity

| Surface | Used for | Code |
|---|---|---|
| `-p=… --output-format stream-json --conversation --model --effort --mode plan\|accept-edits --dangerously-skip-permissions` | Chat | `server/runner.js` `agyCmd` |
| Events `init` (`conversation_id`), `step_update` (`step_type`, `state`, `text_delta`, `tool_name`), `result` (`status`, `denied_actions`) | Live chat view | `server/runner.js` `agyParser` |
| `~/.gemini/antigravity-cli/conversation_summaries.db`, `conversations/<id>.db` (table `steps`, **undocumented protobuf**: step types 14/15, field paths in the file header) | Session list, transcripts, token usage | `server/sources/agy.js`, `server/usage.js` |
| `-p=/usage --output-format json` (`command.data.groups[].buckets[]`) | Live limits | `server/limits.js` |
| `models`, `mcp list`; `~/.gemini/antigravity-cli/settings.json`, `~/.gemini/config/mcp_config.json` | Model picker, MCP | `server/models.js`, `server/mcp*.js` |
| `~/.gemini/antigravity-cli/antigravity-oauth-token` | Sign-in state | `server/tools.js` |

The protobuf transcript is the most fragile part: its schema isn't public, so a CLI update can change the field
numbers without notice.

### OpenCode (beta) and Cursor (unverified)

OpenCode: `run --format json --session --model --variant --agent --file`, `models --verbose`,
`<data>/opencode/opencode.db` (1.x) or the older `storage/*.json`, `opencode.json`. Cursor:
`cursor-agent -p --output-format stream-json --resume --model --force`, `~/.cursor/chats/*/store.db`,
`~/.cursor/mcp.json`. Neither has been verified against a live install.

## Live test (`compat:smoke`)

`npm run compat:smoke` drives each supported CLI through Baton's own code, the way a user would:

1. **New session**: a one-line prompt; the CLI must report a session id and reply.
2. **Resume session**: a second prompt into the same session.
3. **Session list**: the session must show up in Baton's index (session files are where Baton expects).
4. **Transcript**: Baton must read both prompts and replies back from the session file.
5. **One-shot**: the path used for briefs and skill/MCP drafts.
6. **Limits**: the live usage windows.
7. **Model list**: the model picker gets a list.

It also records the **shape** of every streamed event and session-file entry (each key path, such as
`result usage.input_tokens`) and compares it with `scripts/compat-fixtures/<tool>.json`. A renamed or
removed field shows up even when every step still passes. Store a new baseline with `--update-fixtures`.

It uses your real subscriptions, but in a separate home folder (`~/.baton-compat/home`): test sessions,
configs and sign-in tokens never touch your everyday ones. Claude Code and Codex need a one-time sign-in
there: `npm run compat:smoke -- --login` (in a terminal). Antigravity uses its normal sign-in. Each run is
three short prompts per CLI on the cheapest model (Claude: Haiku, Codex: low effort).

Test a specific binary instead of the one on PATH with `--bin codex=/path/to/dir`.

## Re-verifying after a CLI update

1. Update the CLI on a test machine and run `npm run compat:check` (or `npm run compat:check -- codex`). It
   prints the installed version vs the verified one and fails if a flag Baton uses is missing from `--help`.
2. Run `npm run compat:smoke` (or `-- codex`). Then, by hand, add/test an MCP server for that CLI.
3. If everything works, update `verified` / `verifiedAt` in `server/compat.js` and the table above, with a
   CHANGELOG line ("Verified with Codex 0.167.2").
4. If something broke, fix it, and keep a note here of the version where the change happened.
