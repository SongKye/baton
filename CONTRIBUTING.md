# Contributing to Baton

Thanks for helping! Baton is deliberately simple: **Node.js only, no build step, no framework**.

## Run it locally

```bash
git clone https://github.com/SongKye/baton.git && cd baton
npm install
npm start            # http://localhost:7420
```

Use another port for a second copy while one is already running: `BATON_PORT=7421 npm start`.

## Project layout

| Path | What it is |
|---|---|
| `server/index.js` | HTTP server: JSON API, SSE streams, static files, auth gate |
| `server/sources/*.js` | Readers for each CLI's session files (Claude JSONL, Codex rollouts, Antigravity SQLite+protobuf, OpenCode JSON, Cursor `store.db`) |
| `server/runner.js` | Runs the CLIs headlessly and normalizes their streaming output |
| `server/env.js` | Loaded first: login-shell environment, extra variables, config-dir locations |
| `server/providers.js`, `server/connect.js` | Which backend each CLI uses (subscription, API key, Bedrock, Vertex, gateway…) and the setup forms that configure them |
| `server/tools.js`, `server/setup.js` | Supported CLIs, install/sign-in jobs, auto-start |
| `server/platform.js` | Windows / macOS / Linux / WSL differences |
| `public/app.js` | The whole UI (vanilla JS, hash router) |
| `public/locales/en.json` | English translations |

## UI text and translations

UI strings are written **in Korean** in the code and wrapped: `t('세션')` in the browser, `tr('세션')` on the server.
English lives in `public/locales/en.json`, keyed by the Korean text. Use placeholders for values: `t('{n}개 선택', { n })`.

```bash
npm run i18n:check   # lists strings missing from en.json
```

Don't name a local variable `t` in `public/app.js` — it shadows the translation function.

## Before opening a PR

```bash
npm run i18n:check
node scripts/ci-boot.mjs       # boots the server and checks every endpoint (what CI runs)
```

If you have Playwright and Chrome, `node scripts/smoke.cjs http://127.0.0.1:7420 <path-to-playwright-core>` opens every screen and reports page errors.

Please also add a line under **Unreleased** in `CHANGELOG.md`.

## Releasing (maintainers)

1. Move the **Unreleased** entries in `CHANGELOG.md` under a new version heading.
2. Bump `version` in `package.json` (semver: features → minor, fixes → patch).
3. Commit, then tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
   The Release workflow creates the GitHub Release with the changelog notes and a ready-to-run zip.
