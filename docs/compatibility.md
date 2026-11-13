# CLI compatibility

Baton doesn't use an SDK for the coding-agent CLIs. It runs each CLI, reads its streamed output and reads the
session files it leaves on disk. Any CLI release can change those, so Baton records the **exact version it
was verified with** for each CLI. The source of truth is `server/compat.json`. This page explains it.

## Supported versions

<!-- compat-table -->
| CLI | Support | Linux | Windows | macOS |
|---|---|---|---|---|
| Claude Code | Supported | **2.1.318** (2026-11-12) | — | — |
| Codex | Supported | **0.169.0** (2026-11-14) | — | — |
| Antigravity | Supported | **1.5.8** (2026-11-14) | — | — |
| OpenCode | Supported | **1.19.5** (2026-11-12) | — | — |
| Cursor | Unverified | — | — | — |
<!-- /compat-table -->

Each cell is the newest version verified **on that OS** (and when). Linux is verified every week
automatically; Windows and macOS when the maintainer runs `npm run compat:smoke -- --report` there.

Baton shows the same information in **Settings → Supported AI tool versions** and on each tool's card in
**Get started → Connect AI**, compared with the version you have installed:

| Shown | Meaning | What to do |
|---|---|---|
| Verified | Installed version = the version **this Baton release** verified **on your OS** | Nothing |
| Newer, not checked yet | Installed version is newer than that | Usually fine. If something breaks, include the CLI version when you report it. If a newer Baton release verified it, **Update Baton** appears |
| Older than verified | Installed version is older | **Update to vX** installs the verified version |
| Not checked on this OS | Verified on another OS only | Usually fine; the other OSes are listed underneath |
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

## Verified per release, and update buttons

**`server/compat.json` ships inside each Baton release, and that copy is what the release calls verified.** The
versions in it were tested with that release's code: the weekly job tests `main`, and `npm run compat:release`
re-tests the exact code right before a release (`npm run release:check` blocks until it has passed for the
current `server/` tree). An install keeps showing its own release's versions until Baton is updated. Then it
shows the new release's.

Baton also reads the table of the **newest Baton release** from GitHub (at that release's tag, never `main`, at
most every 6 hours). It is advice only, never "verified":

| Your CLI | Shown | Button |
|---|---|---|
| Older than this release verified | "You can update to the verified version" | **Update to vX** installs exactly that version, the way the CLI was installed (npm `-g`, `claude install X`, `opencode upgrade X`). Antigravity and Homebrew Codex can only go to their latest release |
| Newer, and the newest Baton release verified it | "Baton vY verified this version" | **Update Baton** |
| Newer than any release verified | "Newer, not checked yet" | none (the weekly check and the next release catch up) |

Versions verified on `main` but not released yet are never shown to users: they can't get that code yet. So
**cut a release after the weekly job (or a fix PR) moves a verified version**.

There is deliberately no downgrade button: Claude Code's auto-updater would undo it within hours, new models need
new CLI versions, a newer CLI may have migrated its data, and the same CLI is used in the terminal too.

## Live test (`compat:smoke`)

`npm run compat:smoke` drives each supported CLI through Baton's own code, the way a user would:

1. **CLI contract**: executable/version identity and successful help commands with every required flag.
2. **New session and resume**: store a random value in the first turn, recall it without repeating it in the second; the session id must remain the same.
3. **Session list, transcript and restore**: find the session in the requested project directory and read all four user/assistant messages back in order. Trash only that generated test session, verify it disappears, then restore it with the same project and full transcript. File checks stop if the project directory does not match.
4. **Plan/read**: read a randomly generated file through a tool without changing it.
5. **File edit and command**: independently uppercase that file in automatic edit mode and execute a command in full permission mode. Check actual file contents, a randomly generated command marker, and tool progress/completion events.
6. **Question/answer (Claude)**: receive an `AskUserQuestion` control request, submit an answer through Baton, and see the chosen answer in the reply.
7. **One-shot**: the path used for briefs and skill/MCP drafts.
8. **Limits**: check usage windows, percentages and reset timestamps. Authentication, quota and network failures are classified separately.
9. **Model list**: concrete model ids, with a successful live CLI refresh for Codex, Antigravity and OpenCode. Claude's built-in catalog is explicitly recorded as built-in, not a live listing.

Each run uses a new project inside the test home. Reports include the executable, actual/expected CLI version,
Baton git revision and dirty-worktree flag, OS/architecture, Node version, check time and the result/category of every step.
Large reports are passed through a temporary file, so exiting the test process cannot truncate a stdout pipe.

It also records **key paths and value types** of streamed events and JSONL entries and compares them with
`scripts/compat-fixtures/<tool>.json`. Removed fields, changed types, unobserved event kinds and a missing or
untyped baseline require review. An unobserved event can be nondeterministic; it is not by itself a failed
behavioral test. Store a reviewed baseline with `--update-fixtures`.

SQLite/protobuf storage still receives the live transcript check, but does not yet receive a raw schema diff.
This suite does not verify every model, provider, MCP, skill, image or mobile browser; see the coverage plan below.

It uses your real subscriptions, but in a separate home folder (`~/.baton-compat/home`): test sessions,
configs and sign-in tokens never touch your everyday ones. Claude Code and Codex need a one-time sign-in
there: `npm run compat:smoke -- --login` (in a terminal). Antigravity uses its normal sign-in; OpenCode uses its free models, no sign-in. Each run is
six short prompts per CLI (seven for Claude, including the question/answer check). Models: Claude Code: Sonnet 5.5, Codex: low effort, others: account default.

Test a specific binary instead of the one on PATH with `--bin codex=/path/to/dir`.
Use `--expect codex=0.156.0` to require an exact version and `--strict` to fail when a requested CLI is skipped.
A run where no CLI passes exits unsuccessfully even without `--strict`. An install failure never falls back to
an unrelated binary on PATH. The weekly job always supplies both an explicit binary directory and an expected version.

## Weekly auto-check

Every Saturday at 00:00 (local time) a systemd user timer runs `scripts/compat-weekly.mjs`. If the computer was
off then, it runs at the next start. Turn it on with `npm run compat:schedule` (off: `-- --remove`).

**Maintainers only.** The job opens PRs, merges and files issues on `SongKye/baton`. It refuses to install or run
unless the checkout's `origin` is that repository and the signed-in GitHub account can push to it. Other
installs ship the scripts but never run them, and nothing about the weekly job appears in their Settings.

**Models.** The live test talks to Claude Code with Sonnet 5.5 (`BATON_SMOKE_CLAUDE_MODEL` to change). Codex,
Antigravity and OpenCode can only use their own vendor's models, so they use the account default. Fix PRs are
written by Claude Code with Opus 5.5 (`BATON_COMPAT_FIX_MODEL`). Version-bump PRs need no AI.

1. **New release?** Claude Code's npm `stable` tag, Codex's and OpenCode's npm `latest`, and Antigravity's
   release manifest. An unchanged version is also tested as a scheduled health check; a passing unchanged version does not create a version-bump PR.
2. **Install** that release into `~/.baton-compat/versions/<tool>/<version>`, off PATH. Your everyday CLI is
   untouched. Antigravity's download is checked against the manifest's SHA-512.
3. **Test** it with `compat:check` and `compat:smoke`, from a separate git worktree (`~/.baton-compat/work`)
   checked out at `origin/main`. The folder Baton runs from is never touched.
4. **Passed** → one PR that bumps `server/compat.json`, the shape baselines, the docs and the CHANGELOG. It is
   merged automatically once CI is green, unless the schema/baseline needs review, in which case it stays open.
   Health-check failures and schema drift are recorded even without a new CLI release.
5. **Failed** → authentication, quota, environment and unclassified failures are reported for attention rather
   than sent to an automatic code fixer. Network failures get one retry. A new version with a contract failure
   can be sent to Claude Code (your everyday sign-in). The pipeline then re-tests **both the exact new and previous
   verified binaries**, and runs the same isolated offline regression suite as CI. Browser checks run separately on the PR. If the old binary is unavailable,
   the fix cannot be marked ready. Verifier/CI/package/compat-table edits by the fixer are restored before
   re-testing and require review. Fix PRs are never merged automatically: ready when all required checks pass,
   draft otherwise, or an issue when nothing could be changed.

The result goes to `~/.baton-compat/last-run.json` and the log to `~/.baton-compat/logs/<date>.log`. Detailed test reports are retained beside the log. Baton
reports it through Baton's notifications (a push when something needs a look, a quiet inbox entry
otherwise) and the PRs it opens. It is not shown in Settings: users don't need it.

Try it without pushing anything: `npm run compat:weekly -- --dry-run` (`--only codex` limits it to one CLI;
`--ref <branch>` runs a pushed branch instead of main).

## Manual check on Windows or macOS

Step-by-step for Windows, copy-paste only (Korean): [windows-compat-check.ko.md](windows-compat-check.ko.md).

The weekly job verifies Linux. To record another OS, on a computer with that OS, in a Baton checkout whose
`origin` is `SongKye/baton`, with the GitHub CLI (`gh`) signed in to an account that can push:

1. Once: `npm run compat:smoke -- --login` (in a terminal: signs Claude Code and Codex in to the test home).
2. Whenever you like: `npm run compat:smoke -- --report`

It installs **each CLI's verified version** into `~/.baton-compat/versions` (off PATH, so the CLIs you use
are untouched and a CLI you don't have installed is still tested) and runs the same live test. It then opens a
PR that writes every passing version into that OS's column of `server/compat.json` and this page, and merges
the PR once CI is green only when its schema/baseline does not require review. Add `--installed` to test the CLIs installed on that computer instead, or use
`--install` to test without recording. Antigravity has no versioned installer, so the installed one is used.
Failures are listed in the output and the PR but never recorded. Without push access, it only prints the
results.

Reports can be recorded only when their Baton revision matches the recording worktree, `dirty` is false,
and OS/architecture match. Run from a clean checkout of the target revision; results from local edits cannot
certify the unmodified release.

Users see this per OS: "Verified (Windows): vX" is the version verified on their OS. If their OS wasn't
checked yet, it says so, and the versions verified on other OSes are listed underneath.

On Windows the test home is isolated through `USERPROFILE`. Antigravity is recommended in WSL there, which
counts as Linux.

## Re-verifying after a CLI update

1. Update the CLI on a test machine and run `npm run compat:check` (or `npm run compat:check -- codex`). It
   prints the installed version vs the verified one and fails if a flag Baton uses is missing from `--help`.
2. Run `npm run compat:smoke` (or `-- codex`). Then, by hand, add/test an MCP server for that CLI.
3. If everything works, update `verified` / `verifiedAt` in `server/compat.json` and the table above, with a
   CHANGELOG line ("Verified with Codex 0.167.2"). The weekly auto-check does this for you.
4. If something broke, fix it, and keep a note here of the version where the change happened.

## Regression suite and remaining coverage

`npm test` runs the same offline checks in CI and in the weekly fix pipeline, using a temporary Baton
installation and home. The runner tests start local fake executables for all four supported CLIs and exercise
real process spawning, JSON parsing, permission arguments, tool progress, Claude questions (answer, skip,
duplicate/stale answer and denied approvals), failure/limit states, stop/concurrent runs and HTTP SSE replay.
They also verify that incomplete output and a nonzero exit cannot be reported as success.

Long runs retain monotonic event ids. Events outside the memory window are archived in private temporary files
and replayed on reconnect, then deleted when the run expires or the server exits. This preserves replay during
a server process's lifetime; it is not persistence across a server restart.

The policy tests cover same-version health checks, environment-vs-contract failures, drift review, old/new
binary pinning, restoring modified verifiers and large/missing child reports. Existing access, folder and
Codex indexing regressions now run in CI too (folder/symlink tests remain Unix-only).

`npm run test:browser` adds Chromium checks of the production live renderer, question UI, runner and SSE route
in desktop and mobile viewport sizes. It verifies disconnection/replay, question recovery after reload,
two-tab answer handling and delayed tool-error rendering. The surrounding navigation shell and CLI are fixtures;
this does not replace full-app navigation or real-phone testing. CI installs Playwright separately. Locally,
set `BATON_PLAYWRIGHT` to an installed `playwright`/`playwright-core` package directory and optionally
`BATON_BROWSER` to a Chromium executable.

Offline session tests cover Claude/Codex/Antigravity old/current transcript fixtures and OpenCode DB/JSON
storage, including trash/restore, full transcript and companion-file preservation. Conflicting destinations,
missing backups and a failure partway through restoration must preserve recoverable originals.

Remaining work, **not implied by a passing compatibility report**:

- Live image input, actual MCP tool invocation and actual skill discovery/application.
- Project moves and end-to-end CLI storage migrations across actual version upgrades.
- CLI-to-CLI handoff, token aggregation, scheduled messages and terminal-session completion notifications.
- Full-app browser navigation and real phone push/foreground/background checks.
- Raw SQLite/protobuf schema drift, negative permission enforcement, selected model/effort behavior,
  additional provider profiles and live Windows/macOS runs.

The Korean implementation checklist is in [compatibility-checks.ko.md](compatibility-checks.ko.md).

Automatic compatibility fixes use Claude Opus 5.5 with `--effort medium`; `BATON_COMPAT_FIX_MODEL` can override the model.
