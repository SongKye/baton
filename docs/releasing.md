# Deployment readiness and release verification

Run `npm run release:check` at the start of release work. It checks versions,
release notes, a clean working tree, GitHub DNS, remote read access and GitHub CLI
repository permission. It does not publish, test Git metadata writes or prove
that branch/tag protection permits a push. A failing DNS check is not evidence
that a token is invalid; do not replace credentials before connectivity works.

## Execution environment requirements

The deployment session needs network access to GitHub, authenticated repository
write access, and permission to write this checkout's Git metadata. The launcher
or managed execution environment must grant these permissions. Source edits and
successful local tests alone do not establish deployment capability.

## Publish a fix

1. Inspect the working tree and include only the intended changes. Do not commit
   unrelated concurrent work. Review the final diff and run relevant local checks.
2. Run CI for the candidate commit, including Windows PowerShell 5.1 parsing and
   `scripts/windows-install-check.mjs`. A Linux run only checks script encoding;
   it does not validate the Windows installation scenarios.
3. Choose an unused version after checking remote releases and tags. Update
   `package.json`, both version entries in `package-lock.json`, and `CHANGELOG.md`.
   Commit and integrate through the repository's normal review/branch rules.
4. Verify the final commit's CI is green, then create and push its matching `v*`
   tag. Installers select the newest stable tag, so a tag can become installable
   before the GitHub Release workflow finishes. Never tag an unvalidated commit.
5. Wait for the Release workflow's checks and publishing job to succeed. Verify
   the release, its ZIP asset, and the tag's commit. A successful push alone does
   not mean publishing succeeded.
6. Verify the public PowerShell installer on clean Windows and on an existing
   release installation. Check the selected version and dashboard startup.
   Editing `main` alone does not fix `setup.ps1` downloaded from an old release.

Report the published version, commit, CI result and release URL. If any step is
blocked, report the specific failed operation and distinguish local changes from
published changes. Never claim Windows validation when it was skipped.
