# CLI compatibility

Baton doesn't use an SDK for the coding-agent CLIs. It runs each CLI, reads its streamed output and reads the
session files it leaves on disk. Any CLI release can change those, so Baton records the **exact version it
was verified with** for each CLI. The source of truth is `server/compat.json`. This page explains it.

## Supported versions

<!-- compat-table -->
| CLI | Support | Linux | Windows | macOS |
|---|---|---|---|---|
| Claude Code | Supported | **2.1.318** (2026-11-12) | — | — |
| Codex | Supported | **0.156.0** (2026-11-12) | — | — |
| Antigravity | Supported | **1.5.6** (2026-11-12) | — | — |
| OpenCode | Supported | **1.19.5** (2026-11-12) | — | — |
| Cursor | Unverified | — | — | — |
<!-- /compat-table -->

Each cell is the newest version verified **on that OS** (and when). Linux is verified every week
automatically; Windows and macOS when the maintainer runs `npm run compat:smoke -- --report` there.

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

### OpenCode

| Surface | Used for | Code |
|---|---|---|
| `run --format json --session --model --variant --agent plan\|build --file` | Chat, continue a session | `server/runner.js` `opencodeCmd`, `opencodeParser` |
| Events `text`, `reasoning`, `tool_use`/`tool` (`part.state`), `step_finish` (`part.tokens`, `part.cost`), `error`; `sessionID` on every event | Live chat view, tokens | `server/runner.js` |
| `<data>/opencode/opencode.db` (1.x, tables `session` / `message` / `part`) or the older `storage/*.json` | Session list, transcripts, token usage | `server/sources/opencode.js`, `server/usage.js` |
| `models --verbose` | Model picker | `server/models.js` |
| `<data>/opencode/auth.json`, `~/.config/opencode/opencode.json` (`provider`, `mcp`) | Sign-in, own servers, MCP | `server/tools.js`, `server/connect.js`, `server/mcp*.js` |

Verified with the free models (no sign-in). OpenCode has no subscription limits, so there is no limits step.

### Cursor (unverified)

`cursor-agent -p --output-format stream-json --resume --model --force`, `~/.cursor/chats/*/store.db`,
`~/.cursor/mcp.json`. Not verified against a live install.

## Latest table and update buttons

Baton reads the latest `server/compat.json` from GitHub (`main`, at most every 6 hours, last good copy kept
offline). An install released before a CLI version was verified still knows about it:

| Your CLI | Shown | Button |
|---|---|---|
| Older than the supported version | "You can update to the verified version" | **Update to vX** installs exactly that version, the way the CLI was installed (npm `-g`, `claude install X`, `opencode upgrade X`). Antigravity and Homebrew Codex can only go to their latest release |
| Newer, verified without code changes | Verified (the newer table applies to this Baton too) | none |
| Newer, verified only with a code fix | "Update Baton to support this version" | **Update Baton**, once a release with the fix exists; otherwise "supported from the next Baton update" |
| Newer than anything verified | "Newer, not checked yet" | none (the weekly check catches up) |

A code fix records `needsBatonAfter: "<version>"` on the CLI's entry: only Baton releases after that version
have the fix. The weekly fix PR sets it to the Baton version on `main` at the time, so **cut a release after
merging a fix PR**: until then, users see "supported from the next Baton update". A later data-only bump keeps
the field.

There is deliberately no downgrade button: Claude Code's auto-updater would undo it within hours, new models need
new CLI versions, a newer CLI may have migrated its data, and the same CLI is used in the terminal too.

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
there: `npm run compat:smoke -- --login` (in a terminal). Antigravity uses its normal sign-in; OpenCode uses its free models, no sign-in. Each run is
three short prompts per CLI (Claude Code: Sonnet 5.5, Codex: low effort, others: account default).

Test a specific binary instead of the one on PATH with `--bin codex=/path/to/dir`.

## Weekly auto-check

Every Saturday at 00:00 (local time) a systemd user timer runs `scripts/compat-weekly.mjs`. If the computer was
off then, it runs at the next start. Turn it on with `npm run compat:schedule` (off: `-- --remove`).

**Maintainers only.** The job opens PRs, merges and files issues on `SongKye/baton`. It refuses to install or run
unless the checkout's `origin` is that repository and the signed-in GitHub account can push to it. Other
installs ship the scripts but never run them, and Settings shows the weekly row only where the timer is installed.

**Models.** The live test talks to Claude Code with Sonnet 5.5 (`BATON_SMOKE_CLAUDE_MODEL` to change). Codex,
Antigravity and OpenCode can only use their own vendor's models, so they use the account default. Fix PRs are
written by Claude Code with Opus 5.5 (`BATON_COMPAT_FIX_MODEL`). Version-bump PRs need no AI.

1. **New release?** Claude Code's npm `stable` tag, Codex's and OpenCode's npm `latest`, and Antigravity's
   release manifest. If it isn't newer than the verified version, nothing else happens.
2. **Install** that release into `~/.baton-compat/versions/<tool>/<version>`, off PATH. Your everyday CLI is
   untouched. Antigravity's download is checked against the manifest's SHA-512.
3. **Test** it with `compat:check` and `compat:smoke`, from a separate git worktree (`~/.baton-compat/work`)
   checked out at `origin/main`. The folder Baton runs from is never touched.
4. **Passed** → one PR that bumps `server/compat.json`, the shape baselines, the docs and the CHANGELOG. It is
   merged automatically once CI is green, unless fields disappeared from the CLI's output, in which case it
   stays open for review.
5. **Failed** → Claude Code (your everyday sign-in) gets the failure report and this page, fixes Baton on a
   branch, and the pipeline re-tests. The result is always opened as a PR for review, never merged
   automatically: a ready PR if the test passes, a draft if not, or an issue if nothing could be changed.

The result goes to `~/.baton-compat/last-run.json` and the log to `~/.baton-compat/logs/<date>.log`. Baton
shows it under **Settings → Supported AI tool versions → Weekly auto-check**. It sends a push notification when
something needs a look, and otherwise records a quiet inbox entry.

Try it without pushing anything: `npm run compat:weekly -- --dry-run` (`--only codex` limits it to one CLI;
`--ref <branch>` runs a pushed branch instead of main).

## Manual check on Windows or macOS

The weekly job verifies Linux. To record another OS, on a computer with that OS, in a Baton checkout whose
`origin` is `SongKye/baton`, with the GitHub CLI (`gh`) signed in to an account that can push:

1. Once: `npm run compat:smoke -- --login` (in a terminal: signs Claude Code and Codex in to the test home).
2. Whenever you like: `npm run compat:smoke -- --report`

It runs the same live test with the CLIs installed on that computer. It then opens a PR that writes every
passing version into that OS's column of `server/compat.json` and this page, and merges the PR once CI is green.
Failures are listed in the output and the PR but never recorded. Without push access, it only prints the
results.

Users see this per OS. **Verified** means the installed version was verified on their OS. **Verified on
another OS** means it was verified elsewhere but not on theirs yet. Settings also lists the verified version on
each OS.

On Windows the test home is isolated through `USERPROFILE`. Antigravity is recommended in WSL there, which
counts as Linux.

## Re-verifying after a CLI update

1. Update the CLI on a test machine and run `npm run compat:check` (or `npm run compat:check -- codex`). It
   prints the installed version vs the verified one and fails if a flag Baton uses is missing from `--help`.
2. Run `npm run compat:smoke` (or `-- codex`). Then, by hand, add/test an MCP server for that CLI.
3. If everything works, update `verified` / `verifiedAt` in `server/compat.json` and the table above, with a
   CHANGELOG line ("Verified with Codex 0.167.2"). The weekly auto-check does this for you.
4. If something broke, fix it, and keep a note here of the version where the change happened.
