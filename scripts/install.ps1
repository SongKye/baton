# Install the latest Baton release (Windows PowerShell):
#   irm https://raw.githubusercontent.com/SongKye/baton/main/scripts/install.ps1 | iex
# Clones Baton into %USERPROFILE%\baton (or $env:BATON_DIR), checks out the newest release tag
# (not the main branch), then runs scripts\setup.ps1. Running it again moves a release install to
# the newest release; a checkout on a branch (development) is never switched.
& {
  $ErrorActionPreference = 'Stop'
  $Repo = if ($env:BATON_REPO) { $env:BATON_REPO } else { 'https://github.com/SongKye/baton.git' }
  $Dir = if ($env:BATON_DIR) { $env:BATON_DIR } else { Join-Path $HOME 'baton' }
  function Say($m) { Write-Host "▸ $m" -ForegroundColor DarkYellow }
  function Ok($m)  { Write-Host "✓ $m" -ForegroundColor Green }

  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    $a = if (Get-Command winget -ErrorAction SilentlyContinue) { Read-Host "Baton needs Git. Install it with winget now? [Y/n]" } else { 'n' }
    if ($a -eq '' -or $a -match '^[Yy]') {
      winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
      $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Please install Git from https://git-scm.com and run this again." }
  }

  $release = $false
  if (Test-Path (Join-Path $Dir '.git')) {
    if ((git -C $Dir rev-parse --abbrev-ref HEAD) -eq 'HEAD') {
      Say "Baton is already installed in $Dir. Looking for a newer release…"
      git -C $Dir fetch --quiet --tags --force origin
      if ($LASTEXITCODE) { throw "Couldn't reach $Repo." }
      $release = $true
    } else {
      Say "$Dir is a git checkout on a branch (development), so it stays as it is."
    }
  } elseif (Test-Path $Dir) {
    throw "$Dir already exists and is not a Baton install. Pick another folder with `$env:BATON_DIR and run this again."
  } else {
    Say "Downloading Baton into $Dir…"
    git clone --quiet $Repo $Dir
    if ($LASTEXITCODE) { throw "Couldn't download Baton from $Repo." }
    $release = $true
  }

  if ($release) {
    $tag = git -C $Dir tag -l 'v[0-9]*' --sort=-v:refname | Where-Object { $_ -notmatch '-' } | Select-Object -First 1
    if (-not $tag) { throw "No Baton release found at $Repo." }
    git -C $Dir -c advice.detachedHead=false checkout --quiet $tag
    if ($LASTEXITCODE) { throw "Couldn't switch $Dir to $tag (files changed there?). Run 'git -C $Dir status' to see what changed." }
    Ok "Baton $tag"
  }

  & powershell -ExecutionPolicy Bypass -File (Join-Path $Dir 'scripts\setup.ps1')
}
