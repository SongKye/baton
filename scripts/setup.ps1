# Baton setup for Windows (PowerShell).
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
# Installs Node.js 22 LTS with winget if needed, installs dependencies and opens the dashboard.
# Everything else (Claude Code, Codex, OpenCode, Cursor, sign-in, auto-start) is done from the
# dashboard's "Get started" screen. Tip: for Codex/Antigravity, running Baton inside WSL works best.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$Port = if ($env:BATON_PORT) { $env:BATON_PORT } else { '7420' }

function Say($m) { Write-Host "▸ $m" -ForegroundColor DarkYellow }
function Ok($m)  { Write-Host "✓ $m" -ForegroundColor Green }

function Test-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return $false }
  $v = (& node -p "process.versions.node").Split('.')
  return ([int]$v[0] -gt 22) -or ([int]$v[0] -eq 22 -and [int]$v[1] -ge 13)
}

if (Test-Node) {
  Ok "Node.js $(node -v)"
} else {
  Say "Baton needs Node.js 22.13 or newer."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    $a = Read-Host "Install Node.js LTS with winget now? [Y/n]"
    if ($a -eq '' -or $a -match '^[Yy]') {
      winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
      # pick up the new PATH in this session
      $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    }
  }
  if (-not (Test-Node)) { throw "Please install Node.js 22.13+ from https://nodejs.org and run this again." }
  Ok "Node.js $(node -v)"
}

if (Get-Command git -ErrorAction SilentlyContinue) { Ok "Git found" } else { Say "Git not found — the dashboard can install it (winget)." }

Say "Installing Baton's dependencies…"
npm install --omit=dev --no-audit --no-fund --loglevel=error
Ok "Dependencies installed"

Say "Starting Baton on http://localhost:$Port  (close this window to stop)"
Say "Tip: turn on 'Start Baton when you log in' in Get started so you don't need this window."
$env:BATON_PORT = $Port
node --no-warnings server/index.js --open
