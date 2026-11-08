#!/usr/bin/env bash
# Install the latest Baton release (macOS / Linux / WSL):
#   curl -fsSL https://raw.githubusercontent.com/SongKye/baton/main/scripts/install.sh | bash
# Clones Baton into ~/baton (or $BATON_DIR), checks out the newest release tag (not the main branch),
# then runs scripts/setup.sh. Running it again moves a release install to the newest release;
# a checkout on a branch (development) is never switched.
# Extra arguments go to setup.sh:  curl … | bash -s -- --no-open
set -euo pipefail

# everything is inside main() so a half-downloaded script never runs
main() {
  local repo="${BATON_REPO:-https://github.com/SongKye/baton.git}"
  local dir="${BATON_DIR:-$HOME/baton}"
  local release=0

  say() { printf '\033[1;38;5;209m▸\033[0m %s\n' "$*"; }
  ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
  die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

  if ! command -v git >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then die "Baton needs Git. Install it with:  sudo apt-get install -y git   and run this again."
    elif [[ "$(uname)" == "Darwin" ]]; then die "Baton needs Git. Install it with:  xcode-select --install   and run this again."
    else die "Baton needs Git. Install it with your package manager and run this again."; fi
  fi

  if [[ -d "$dir/.git" ]]; then
    if [[ "$(git -C "$dir" rev-parse --abbrev-ref HEAD)" == "HEAD" ]]; then
      say "Baton is already installed in $dir. Looking for a newer release…"
      git -C "$dir" fetch --quiet --tags --force origin
      release=1
    else
      say "$dir is a git checkout on a branch (development), so it stays as it is."
    fi
  elif [[ -e "$dir" ]]; then
    die "$dir already exists and is not a Baton install. Pick another folder with BATON_DIR=… and run this again."
  else
    say "Downloading Baton into $dir…"
    git clone --quiet "$repo" "$dir"
    release=1
  fi

  if (( release )); then
    local tag
    tag="$(git -C "$dir" tag -l 'v[0-9]*' --sort=-v:refname | grep -Ev -- '-' | head -n1 || true)"
    [[ -n "$tag" ]] || die "No Baton release found at $repo."
    git -C "$dir" -c advice.detachedHead=false checkout --quiet "$tag" \
      || die "Couldn't switch $dir to $tag (files changed there?). Run 'git -C $dir status' to see what changed."
    ok "Baton $tag"
  fi

  cd "$dir"
  # `curl | bash` feeds this script on stdin; give setup.sh the terminal so its questions work
  if [[ -t 0 ]] || ! { : </dev/tty; } 2>/dev/null; then exec ./scripts/setup.sh "$@"; fi
  exec ./scripts/setup.sh "$@" </dev/tty
}

main "$@"
