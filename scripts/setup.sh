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
    # fnm's installer needs unzip, which a fresh Ubuntu (e.g. WSL) doesn't have
    if ! command -v unzip >/dev/null 2>&1; then
      if command -v apt-get >/dev/null 2>&1; then
        say "Installing unzip (needed to install Node.js). Your Linux password may be asked."
        SUDO=""; (( EUID == 0 )) || SUDO="sudo"
        $SUDO apt-get update -qq && $SUDO apt-get install -y -qq unzip >/dev/null \
          || die "Couldn't install unzip. Run 'sudo apt-get install -y unzip' and run this again."
      else
        die "Installing Node.js needs unzip. Install it with your package manager and run this again."
      fi
    fi
    # without --skip-shell, fnm adds itself to your shell's config so 'node' works in new terminals too
    curl -fsSL https://fnm.vercel.app/install | bash
    export PATH="$HOME/.local/share/fnm:$HOME/.fnm:$PATH"
    eval "$(fnm env --shell bash)"
    fnm install 22 && fnm default 22 && fnm use 22
    say "Added Node.js with fnm. Terminals you open from now on find 'node' too."
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

# 4) The `baton` command: start Baton again later (or open the dashboard) without remembering the folder or port
link_command() {
  local bin="$HOME/.local/bin" target="$PWD/scripts/baton" current
  chmod +x "$target" 2>/dev/null || true
  if [[ -e "$bin/baton" || -L "$bin/baton" ]]; then
    current="$(readlink "$bin/baton" 2>/dev/null || true)"
    # only replace our own link (possibly from another Baton folder), never someone else's `baton`
    [[ "$current" == */scripts/baton ]] || { say "$bin/baton already exists, so the 'baton' command was not added. Start Baton with: $target"; return 0; }
  fi
  mkdir -p "$bin" && ln -sfn "$target" "$bin/baton" || { say "Couldn't add the 'baton' command. Start Baton with: $target"; return 0; }
  case ":$PATH:" in
    *":$bin:"*) ok "Added the 'baton' command. Type 'baton' in a terminal to start Baton again later." ;;
    *) ok "Added the 'baton' command. Open a new terminal and type 'baton' to start Baton again later (if it isn't found there, run $bin/baton)." ;;
  esac
}
link_command

# 5) Start
say "Starting Baton (Ctrl+C to stop). The server will print and open its address."
say "Tip: turn on “Start Baton when you log in” in Get started so you don't need this terminal."
ARGS=(--no-warnings server/index.js)
(( OPEN )) && ARGS+=(--open)
exec node "${ARGS[@]}"
