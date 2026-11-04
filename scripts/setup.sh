#!/usr/bin/env bash
# Baton setup for macOS / Linux / WSL.
#   ./scripts/setup.sh            install dependencies and open the dashboard
#   ./scripts/setup.sh --no-open  same, but don't open a browser
# Everything else (Claude Code, Codex, Antigravity, OpenCode, Cursor, sign-in, auto-start)
# is done from the dashboard's "Get started" screen.
set -euo pipefail
cd "$(dirname "$0")/.."

NEED_MAJOR=22
NEED_MINOR=13
PORT="${BATON_PORT:-7420}"
OPEN=1
[[ "${1:-}" == "--no-open" ]] && OPEN=0

say() { printf '\033[1;38;5;209m▸\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local v; v="$(node -p 'process.versions.node')"
  local major="${v%%.*}" rest="${v#*.}"; local minor="${rest%%.*}"
  (( major > NEED_MAJOR || (major == NEED_MAJOR && minor >= NEED_MINOR) ))
}

# 1) Node.js >= 22.13 (Baton uses the built-in node:sqlite)
if node_ok; then
  ok "Node.js $(node -v)"
else
  say "Baton needs Node.js ${NEED_MAJOR}.${NEED_MINOR}+ (found: $(node -v 2>/dev/null || echo none))."
  if [[ "$(uname)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
    read -r -p "Install Node.js 22 with Homebrew now? [Y/n] " a
    [[ "${a:-Y}" =~ ^[Yy]$ ]] || die "Install Node.js 22+ from https://nodejs.org and run this again."
    brew install node@22 && brew link --overwrite --force node@22
  else
    read -r -p "Install Node.js 22 with fnm (a small Node version manager, installs into your home folder)? [Y/n] " a
    [[ "${a:-Y}" =~ ^[Yy]$ ]] || die "Install Node.js 22+ from https://nodejs.org and run this again."
    curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell
    export PATH="$HOME/.local/share/fnm:$HOME/.fnm:$PATH"
    eval "$(fnm env --shell bash)"
    fnm install 22 && fnm default 22 && fnm use 22
    say "Added Node via fnm. Open a new terminal later so 'node' is on your PATH everywhere."
  fi
  node_ok || die "Node.js is still too old. Install 22.13+ from https://nodejs.org"
  ok "Node.js $(node -v)"
fi

# 2) Git is optional for Baton itself but the AI tools rely on it
if command -v git >/dev/null 2>&1; then ok "Git $(git --version | awk '{print $3}')"; else say "Git not found — the dashboard can help you install it."; fi

# 3) Dependencies
say "Installing Baton's dependencies…"
npm install --omit=dev --no-audit --no-fund --loglevel=error
ok "Dependencies installed"

# 4) Start
say "Starting Baton on http://localhost:${PORT}  (Ctrl+C to stop)"
say "Tip: turn on “Start Baton when you log in” in Get started so you don't need this terminal."
ARGS=(--no-warnings server/index.js)
(( OPEN )) && ARGS+=(--open)
exec env BATON_PORT="$PORT" node "${ARGS[@]}"
