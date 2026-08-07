# Pack kiosk deploy artifacts into data/deploy/current
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

Write-Host "Building kiosk UI..."
pnpm --filter @stella/kiosk build
if ($LASTEXITCODE -ne 0) { throw "kiosk build failed" }

$out = Join-Path $root "data\deploy\current"
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force -Path $out | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $out "ui") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $out "runtime") | Out-Null

Copy-Item (Join-Path $root "apps\kiosk\dist\*") (Join-Path $out "ui") -Recurse -Force
Copy-Item (Join-Path $root "apps\kiosk\scripts\kiosk-agent.mjs") (Join-Path $out "agent.mjs") -Force
Copy-Item (Join-Path $root "apps\kiosk\scripts\block-hotkeys.ps1") (Join-Path $out "block-hotkeys.ps1") -Force
Copy-Item (Join-Path $root "apps\kiosk\scripts\lockdown-policies.ps1") (Join-Path $out "lockdown-policies.ps1") -Force
Copy-Item (Join-Path $root "apps\kiosk\scripts\clear-policies.ps1") (Join-Path $out "clear-policies.ps1") -Force
Copy-Item (Join-Path $root "apps\server\scripts\install-local.ps1") (Join-Path $out "install-local.ps1") -Force

# Games folder scaffold (native .exe games for Tauri / future use)
$gamesDir = Join-Path $out "games"
New-Item -ItemType Directory -Force -Path $gamesDir | Out-Null
Set-Content (Join-Path $gamesDir "README.txt") -Value @"
Place game .exe files here (on the kiosk: C:\ProgramData\StellaKiosk\games\).
Example: games\demo\game.exe
Then set in kiosk.json:
  "game": { "title": "Play", "exe": "demo/game.exe", "args": [] }
"@ -Encoding UTF8

$manifest = @"
Stella Kiosk deploy package
==========================
Includes on remote install (C:\ProgramData\StellaKiosk):
  - agent.mjs          Node agent (health :47821, UI :47820)
  - block-hotkeys.ps1  Blocks Alt+Tab / Win+Tab in interactive session
  - ui/                Kiosk React SPA
  - runtime/node.exe   Portable Node (if present)
  - install-local.ps1  Registers Windows tasks + starts agent/UI
  - version.json       Software version for OTA
  - games/             Folder for local .exe games

Also configured by installer:
  - kiosk.json         Server URL, hostname, ports
  - StellaKioskAgent   Scheduled task (SYSTEM, at startup)
  - StellaKioskUI      Edge kiosk at logon
  - Power: monitor/standby timeout AC = 0

Prerequisites on kiosk PC:
  - Windows with WinRM (for remote install)
  - Microsoft Edge
  - Interactive user logged on (for Edge fullscreen)
"@
Set-Content (Join-Path $out "MANIFEST.txt") -Value $manifest -Encoding UTF8

$nodeTools = Join-Path $root "tools\node"
$nodeExe = Join-Path $nodeTools "node.exe"

function Expand-NodeFromZip($zipPath, $destDir) {
  $tmp = Join-Path $env:TEMP ("stella-node-" + [guid]::NewGuid().ToString("n"))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  Expand-Archive -Path $zipPath -DestinationPath $tmp -Force
  $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  if (-not $inner) { throw "Unexpected Node zip layout" }
  # Only node.exe needed to run agent.mjs
  Copy-Item (Join-Path $inner.FullName "node.exe") (Join-Path $destDir "node.exe") -Force
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path $nodeExe)) {
  Write-Host "Downloading portable Node.js (win-x64) into tools/node ..."
  New-Item -ItemType Directory -Force -Path $nodeTools | Out-Null
  $ver = "v22.14.0"
  $zipName = "node-$ver-win-x64.zip"
  $url = "https://nodejs.org/dist/$ver/$zipName"
  $zipPath = Join-Path $env:TEMP $zipName
  try {
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
    Expand-NodeFromZip $zipPath $nodeTools
  } catch {
    Write-Warning "Could not download Node: $($_.Exception.Message)"
  } finally {
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
  }
}

if (Test-Path $nodeExe) {
  Write-Host "Copying node.exe only (slim runtime)..."
  Copy-Item $nodeExe (Join-Path $out "runtime\node.exe") -Force
} elseif (Test-Path (Join-Path $nodeTools "node.exe")) {
  # after expand into tools/node directly as node.exe
  Copy-Item (Join-Path $nodeTools "node.exe") (Join-Path $out "runtime\node.exe") -Force
} else {
  Write-Warning "No portable Node - remote kiosks must have Node in PATH"
}

$builtAt = (Get-Date).ToUniversalTime().ToString("o")
$softwareVersion = Get-Date -Format "yyyyMMdd-HHmmss"
$versionObj = @{
  softwareVersion = $softwareVersion
  appVersion      = "0.1.0"
  builtAt         = $builtAt
} | ConvertTo-Json -Compress
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText((Join-Path $out "version.json"), $versionObj, $utf8NoBom)
[System.IO.File]::WriteAllText((Join-Path $out "VERSION"), $softwareVersion, $utf8NoBom)

# OTA update zip (no Node runtime) — agent downloads this periodically
$updOut = Join-Path $out "update.zip"
if (Test-Path $updOut) { Remove-Item $updOut -Force }
$updStage = Join-Path $env:TEMP ("stella-upd-" + [guid]::NewGuid().ToString("n"))
New-Item -ItemType Directory -Force -Path $updStage | Out-Null
Copy-Item (Join-Path $out "agent.mjs") $updStage -Force
Copy-Item (Join-Path $out "block-hotkeys.ps1") $updStage -Force
Copy-Item (Join-Path $out "lockdown-policies.ps1") $updStage -Force
Copy-Item (Join-Path $out "clear-policies.ps1") $updStage -Force
Copy-Item (Join-Path $out "install-local.ps1") $updStage -Force
Copy-Item (Join-Path $out "version.json") $updStage -Force
Copy-Item (Join-Path $out "VERSION") $updStage -Force
Copy-Item (Join-Path $out "MANIFEST.txt") $updStage -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $out "ui") (Join-Path $updStage "ui") -Recurse -Force
if (Test-Path (Join-Path $out "games")) {
  Copy-Item (Join-Path $out "games") (Join-Path $updStage "games") -Recurse -Force
}Compress-Archive -Path (Join-Path $updStage "*") -DestinationPath $updOut -Force
Remove-Item $updStage -Recurse -Force -ErrorAction SilentlyContinue

# Full zip for first remote install (SMB), includes portable Node if present
$zipOut = Join-Path $out "package.zip"
if (Test-Path $zipOut) { Remove-Item $zipOut -Force }
$zipStage = Join-Path $env:TEMP ("stella-zip-" + [guid]::NewGuid().ToString("n"))
New-Item -ItemType Directory -Force -Path $zipStage | Out-Null
Copy-Item (Join-Path $out "agent.mjs") $zipStage -Force
Copy-Item (Join-Path $out "block-hotkeys.ps1") $zipStage -Force
Copy-Item (Join-Path $out "lockdown-policies.ps1") $zipStage -Force
Copy-Item (Join-Path $out "clear-policies.ps1") $zipStage -Force
Copy-Item (Join-Path $out "install-local.ps1") $zipStage -Force
Copy-Item (Join-Path $out "version.json") $zipStage -Force
Copy-Item (Join-Path $out "VERSION") $zipStage -Force
Copy-Item (Join-Path $out "MANIFEST.txt") $zipStage -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $out "ui") (Join-Path $zipStage "ui") -Recurse -Force
if (Test-Path (Join-Path $out "games")) {
  Copy-Item (Join-Path $out "games") (Join-Path $zipStage "games") -Recurse -Force
}
if (Test-Path (Join-Path $out "runtime\node.exe")) {
  New-Item -ItemType Directory -Force -Path (Join-Path $zipStage "runtime") | Out-Null
  Copy-Item (Join-Path $out "runtime\node.exe") (Join-Path $zipStage "runtime\node.exe") -Force
}
Compress-Archive -Path (Join-Path $zipStage "*") -DestinationPath $zipOut -Force
Remove-Item $zipStage -Recurse -Force -ErrorAction SilentlyContinue

$zipSize = [math]::Round((Get-Item $zipOut).Length / 1MB, 1)
$updSize = [math]::Round((Get-Item $updOut).Length / 1MB, 1)
Write-Host "Deploy package ready: $out"
Write-Host "softwareVersion: $softwareVersion"
Write-Host "update.zip: ${updSize} MB (OTA)"
Write-Host "package.zip: ${zipSize} MB (install)"
if (Test-Path (Join-Path $out "runtime\node.exe")) {
  Write-Host "runtime/node.exe: OK"
} else {
  Write-Host "runtime/node.exe: MISSING"
}
