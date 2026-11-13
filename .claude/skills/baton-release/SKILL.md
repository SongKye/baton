---
name: baton-release
description: How to release Baton (this repository) correctly. Use whenever the user says "릴리스해줘", "배포해줘", "새 버전 내줘", "버전 올려줘", "release", "cut a version", "ship a release", or asks to tag or publish Baton. Covers the order that matters here: merge the approved PRs, deal with the weekly CLI-compatibility PRs, re-verify the CLIs with the exact code being released (npm run compat:release), bump the version and CHANGELOG, release:check, release PR, tag, and watch the Release workflow. For a plain PR or merge without a release, use the general `ship` skill instead.
---

# Releasing Baton

The user is the maintainer and is new to version control: do the git/GitHub work yourself, say what you are doing in one plain sentence (in the user's language, usually Korean), and never skip a step below because it "looks fine". Two things make Baton different from a normal project:

- **`server/compat.json` ships inside each release and is what users see as "verified".** Those versions must have been tested with exactly the code being released. `release:check` enforces this with a stamp keyed by the git tree of `server/`.
- **Installers pick the newest `v*` tag directly.** A tag is installable before the Release workflow finishes. Never tag a commit that hasn't passed everything below.

Background: `docs/releasing.md` (procedure), `docs/compatibility.md` (what the compatibility machinery does).

## 0. Where this can run

The release must run on the **maintainer's Linux machine**: `compat:release` needs the test home signed in (`~/.baton-compat/home`) and the CLIs' real subscriptions, and the weekly timer lives there. Check first, and stop with a clear explanation if any fails:

```bash
git remote get-url origin                     # must be SongKye/baton
gh api repos/SongKye/baton --jq .permissions.push   # must print true
ls ~/.baton-compat/home/.claude/.credentials.json ~/.baton-compat/home/.codex/auth.json
```

If the test home isn't signed in, tell the user to run `npm run compat:smoke -- --login` in a terminal (it needs their browser). Do not try to work around it, and do not skip `compat:release`.

## 1. Survey (read only)

```bash
git checkout main && git pull
git fetch --tags
git describe --tags --abbrev=0                      # last release
node -p "require('./package.json').version"
git log --oneline $(git describe --tags --abbrev=0)..origin/main
gh pr list                                          # open PRs
cat ~/.baton-compat/last-run.json                   # last weekly compatibility run (needsAttention?)
git status --short                                  # uncommitted work: ask whether it belongs
```

If nothing changed since the last tag, say so and stop.

## 2. Plan: show it, then act

Tell the user: the last version, what is already on `main` (group by theme, user-facing), every open PR (number, title, what it touches, CI, whether it conflicts with `main`), the proposed version and why, and what you will do about each open PR. Then proceed on what they approved.

- **Never merge a PR the user hasn't approved for this release**, including their own old ones. Say what each one touches. A PR that edits `server/` changes the git tree that `compat:release` certifies, so it forces a re-run (10–20 min).
- A PR written against older code may conflict. Resolve it only when the resolution is mechanical (both sides of a CHANGELOG list, a cache-bust number). Anything that needs a product decision: stop and ask.
- If an open PR was written to "hold until used on the phone / real device", say so before merging it.

## 3. Weekly compatibility PRs (check before releasing)

The weekly job (Saturday 00:00, `baton-compat.timer`) opens PRs on branches named `compat/…`:

- `Verified with …` (a bump of verified versions): safe ones merge themselves. One left open means fields disappeared from a CLI's output: read the PR, check `grep -rn` that Baton doesn't read those fields, and ask the user before merging.
- `Fix … compatibility` / `[needs help] …` / an issue: **always the user's decision.** Don't release over an unhandled one without telling them what users will see (the CLI shows "newer, not checked yet").

If the user wants the newest CLI versions in this release and the last run is stale, run the job now (`systemctl --user start baton-compat.service`, 10–15 min), then handle its PRs as above.

Windows and macOS are verified only when the maintainer runs `npm run compat:smoke -- --report` there. A release does not need that; users on those OSes see "not checked on this OS". Never claim Windows/macOS validation that wasn't done.

## 4. Merge the approved PRs

Oldest first, merge commits (`gh pr merge N --merge --delete-branch`, the repo's style), each after its CI is green on all four jobs. Then `git checkout main && git pull`.

## 5. Re-verify the CLIs with this exact code (required)

```bash
npm run compat:release     # 10–20 min: run it in the background and wait
```

It installs each CLI's verified version off PATH, runs the full live suite with `--strict`, and writes `~/.baton-compat/release-verified.json` keyed by `git rev-parse HEAD:server`. Must pass.

- It fails → this code breaks a verified CLI. Find out why and fix it (a PR) before releasing. Never edit `server/compat.json` to make it pass.
- Any later change under `server/` invalidates the stamp: run it again.
- The release/version commit doesn't touch `server/`, so it stays valid.

## 6. Version, CHANGELOG, release branch

- Version (SemVer; the project is `0.x`): new features or anything breaking → minor; fixes only → patch. Never suggest `1.0.0` unless the user says it's stable. Check the version isn't already tagged.
- `git checkout -b release/X.Y.Z`, then `npm version X.Y.Z --no-git-tag-version` (updates both `package.json` and `package-lock.json`).
- `CHANGELOG.md`: turn `## [Unreleased]` into `## [X.Y.Z] - YYYY-MM-DD` with a fresh empty `## [Unreleased]` above it. One `Added` / `Changed` / `Fixed` each (merge duplicate headings that piled up from separate PRs). Write for users, not commit-speak; keep maintainer-only items short. Refresh anything stale, especially the line listing verified CLI versions (they must equal `server/compat.json`).
- Commit as `Release vX.Y.Z`.

## 7. Release check and release PR

```bash
npm run release:check      # must be all OK (clean tree, notes, stamp matches this server/ tree, GitHub access)
git push -u origin release/X.Y.Z
gh pr create --base main --title "Release vX.Y.Z" ...   # what's in it, what was left out and why, the checks
```

Wait for CI on **ubuntu 22/24, macOS and Windows** (Windows runs the installer check: installers read release tags directly). Merge with `--merge --delete-branch`, `git checkout main && git pull`. Confirm `git rev-parse HEAD:server` still equals the stamp's `serverTree`.

## 8. Tag and publish

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"      # on the merged commit
git push origin vX.Y.Z
gh run list --workflow release.yml --limit 1      # then: gh run watch <id> --exit-status
gh release view vX.Y.Z --json tagName,isDraft,isPrerelease,url,assets
git rev-list -n1 vX.Y.Z; git rev-parse origin/main   # must be identical
```

The workflow checks the tag matches `package.json` and attaches `baton-vX.Y.Z.zip`. If it fails, read the log and fix the cause. Do not delete or move a published tag without asking.

## 9. After

- If Baton runs from this checkout (`baton.service`), the running server still has old code: schedule a delayed restart (a direct restart kills the session you are in): `systemd-run --user --on-active=60s systemctl --user restart baton.service`.
- Report: version, what's in it (and what was deliberately left out), CI results, release URL, and anything not done (Windows/macOS checks, PRs still open).

## Guards

- No force-push to `main`, no rewriting or deleting published tags/releases without asking.
- No tag unless `release:check` and CI are green for that exact commit.
- Don't merge weekly fix PRs, drift PRs or anyone's PRs on your own judgment.
- Pushing, merging, tagging and publishing are outward-facing: do them because the user asked for the release, but stop and confirm when the survey turns up surprises (failing CI, conflicts needing decisions, unexpected PRs, stale compatibility state).
- If a permission check blocks a command, say what it was for and give the user the exact command to run.
- Commit/PR attribution follows the session's rules.
