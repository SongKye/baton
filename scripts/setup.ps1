# Keep this file ASCII-only for Windows PowerShell 5.1 (including irm | iex).
# Baton setup for Windows (PowerShell).
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
# Installs Node.js 22 LTS with winget if needed, installs dependencies and opens the dashboard.
# Everything else (Claude Code, Codex, OpenCode, Cursor, sign-in, auto-start) is done from the
# dashboard's "Get started" screen. Tip: for Codex/Antigravity, running Baton inside WSL works best.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Say($m) { Write-Host "> $m" -ForegroundColor DarkYellow }
function Ok($m)  { Write-Host "[OK] $m" -ForegroundColor Green }

function Test-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return $false }
  $version = & node -p "process.versions.node"
  if ($LASTEXITCODE -ne 0 -or $version -notmatch '^\d+\.\d+\.\d+') { return $false }
  $v = $version.Split('.')
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

if (Get-Command git -ErrorAction SilentlyContinue) { Ok "Git found" } else { Say "Git not found - the dashboard can install it (winget)." }

Say "Installing Baton's dependencies..."
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw "npm.cmd was not found. Repair your Node.js installation and run this again." }
& npm.cmd install --omit=dev --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed (exit $LASTEXITCODE). Run the installer again to retry." }
Ok "Dependencies installed"

# A "Baton" shortcut (Start menu + desktop) starts Baton again later without a terminal or the port:
# it starts the server in a minimized window (close it to stop Baton), or just opens the dashboard
# when Baton is already running. A failure here never stops setup.
try {
  $root = (Get-Location).Path
  $nodeExe = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $wsh = New-Object -ComObject WScript.Shell
  $made = @()
  foreach ($place in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {
    if (-not $place -or -not (Test-Path $place)) { continue }
    $lnk = $wsh.CreateShortcut((Join-Path $place 'Baton.lnk'))
    $lnk.TargetPath = $nodeExe
    $lnk.Arguments = '--no-warnings "' + (Join-Path $root 'server\index.js') + '" --open'
    $lnk.WorkingDirectory = $root
    $lnk.WindowStyle = 7
    $lnk.IconLocation = (Join-Path $root 'public\baton.ico') + ',0'
    $lnk.Description = 'Start Baton and open the dashboard'
    $lnk.Save()
    $made += $place
  }
  if ($made.Count) { Ok "Added a 'Baton' shortcut to the Start menu and desktop. Click it to start Baton again later." }
} catch { Say "Couldn't add the Baton shortcut ($($_.Exception.Message)). Run scripts\setup.ps1 to start Baton." }

Say "Starting Baton (close this window to stop). The server will print and open its address."
Say "Tip: turn on 'Start Baton when you log in' in Get started so you don't need this window."
node --no-warnings server/index.js --open
if ($LASTEXITCODE -ne 0) { throw "Baton exited with an error (exit $LASTEXITCODE)." }
