# Run Stella kiosk actions locally on a Windows PC (invoked via SSH from Debian server).
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Start", "Stop", "Uninstall", "ClearPolicies", "Push")]
  [string]$Action,
  [int]$UiPort = 47820,
  [int]$HealthPort = 47821,
  [string]$ConfigJson = "",
  [string]$DeployUser = "",
  [string]$DeployPassword = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Stage([string]$Name) {
  [Console]::Out.WriteLine("STAGE:$Name")
  [Console]::Out.Flush()
}

switch ($Action) {
  "Start" {
    Write-Stage "starting"
    $root = Join-Path $env:ProgramData "StellaKiosk"
    if (-not (Test-Path (Join-Path $root "agent.mjs"))) {
      throw "StellaKiosk not installed at $root. Install software first."
    }
    Remove-Item -Path (Join-Path $root "STOPPED") -Force -ErrorAction SilentlyContinue
    Remove-Item -Path (Join-Path $root "SOFTWARE_DISABLED") -Force -ErrorAction SilentlyContinue

    $taskAgent = "StellaKioskAgent"
    if (-not (Get-ScheduledTask -TaskName $taskAgent -ErrorAction SilentlyContinue)) {
      throw "Task $taskAgent missing. Install software first."
    }
    try { Enable-ScheduledTask -TaskName $taskAgent -ErrorAction SilentlyContinue } catch {}
    try { Stop-ScheduledTask -TaskName $taskAgent -ErrorAction SilentlyContinue } catch {}
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.CommandLine -and ($_.CommandLine -like "*StellaKiosk*" -or $_.CommandLine -like "*agent.mjs*")) {
        try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
    Start-Sleep -Milliseconds 800
    Start-ScheduledTask -TaskName $taskAgent -ErrorAction Stop
    foreach ($t in @("StellaKioskUI", "StellaKioskKeyBlock")) {
      try { Enable-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue } catch {}
    }

    $deadline = (Get-Date).AddSeconds(15)
    $healthy = $false
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 800
      try {
        $h = Invoke-RestMethod -Uri "http://127.0.0.1:$HealthPort/health" -TimeoutSec 2
        if ($h.ok) { $healthy = $true; break }
      } catch {}
    }
    if (-not $healthy) { throw "Agent task started but health :$HealthPort did not respond" }

    $edge = @(
      "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
      "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $edge) {
      Write-Stage "done"
      Write-Output "START_OK: OK agent healthy; Edge not found"
      exit 0
    }

    New-Item -ItemType Directory -Force -Path (Join-Path $root "edge-profile") | Out-Null
    $uiArgs = "--user-data-dir=`"$root\edge-profile`" --kiosk http://127.0.0.1:$UiPort/ --edge-kiosk-type=fullscreen --no-first-run --disable-session-crashed-bubble --noerrdialogs --check-for-update-interval=31536000 --disable-features=msEdgeSidebar,TranslateUI,InfiniteSessionRestore,msVisualSearch --disable-pinch --overscroll-history-navigation=0"
    Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.CommandLine -and $_.CommandLine -like "*127.0.0.1:$UiPort*") {
        try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
    $taskUi = "StellaKioskUI"
    $actionUi = New-ScheduledTaskAction -Execute $edge -Argument $uiArgs
    if (-not (Get-ScheduledTask -TaskName $taskUi -ErrorAction SilentlyContinue)) {
      $triggerUi = New-ScheduledTaskTrigger -AtLogOn
      Register-ScheduledTask -TaskName $taskUi -Action $actionUi -Trigger $triggerUi -Force | Out-Null
    } else {
      Set-ScheduledTask -TaskName $taskUi -Action $actionUi -ErrorAction SilentlyContinue | Out-Null
    }
    Start-ScheduledTask -TaskName $taskUi -ErrorAction SilentlyContinue
    Write-Stage "done"
    Write-Output "START_OK: OK agent healthy; Edge UI triggered"
    exit 0
  }

  "Stop" {
    Write-Stage "stopping"
    $root = Join-Path $env:ProgramData "StellaKiosk"
    New-Item -ItemType Directory -Force -Path $root | Out-Null
    Set-Content -Path (Join-Path $root "STOPPED") -Value ("stopped " + (Get-Date).ToString("o")) -Encoding ASCII
    foreach ($t in @("StellaKioskAgent", "StellaKioskUI", "StellaKioskStartNow", "StellaKioskKeyBlockNow", "StellaKioskKeyBlock")) {
      try { Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue } catch {}
    }
    foreach ($t in @("StellaKioskAgent", "StellaKioskUI", "StellaKioskKeyBlock")) {
      try { Enable-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue } catch {}
    }
    foreach ($t in @("StellaKioskStartNow", "StellaKioskKeyBlockNow")) {
      try { Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue } catch {}
    }
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.CommandLine -and ($_.CommandLine -like "*StellaKiosk*" -or $_.CommandLine -like "*agent.mjs*")) {
        try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
    Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.CommandLine -and $_.CommandLine -like "*127.0.0.1:$UiPort*") {
        try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
    Start-Sleep -Milliseconds 1200
    $agentAlive = $false
    try {
      $h = Invoke-RestMethod -Uri "http://127.0.0.1:$HealthPort/health" -TimeoutSec 2
      if ($h.ok) { $agentAlive = $true }
    } catch {}
    if ($agentAlive) { throw "Agent still responds on :$HealthPort after stop" }
    Write-Stage "done"
    Write-Output "STOP_OK: OK agent and Edge UI stopped"
    exit 0
  }

  "Uninstall" {
    Write-Stage "uninstalling"
    $root = Join-Path $env:ProgramData "StellaKiosk"
    foreach ($t in @("StellaKioskAgent", "StellaKioskUI", "StellaKioskStartNow", "StellaKioskKeyBlock", "StellaKioskKeyBlockNow")) {
      try { Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue } catch {}
      try { Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue } catch {}
    }
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.CommandLine -and ($_.CommandLine -like "*StellaKiosk*" -or $_.CommandLine -like "*agent.mjs*")) {
        try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
    Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.CommandLine -and ($_.CommandLine -like "*127.0.0.1:$UiPort*" -or $_.CommandLine -like "*StellaKiosk\edge-profile*")) {
        try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
    $clearPolicies = Join-Path $root "clear-policies.ps1"
    if (Test-Path -LiteralPath $clearPolicies) {
      try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $clearPolicies -InstallRoot $root 2>&1 | Out-Null } catch {}
    }
    if (Test-Path -LiteralPath $root) {
      Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction Stop
    }
    Write-Stage "done"
    Write-Output "UNINSTALL_OK: OK StellaKiosk removed"
    exit 0
  }

  "ClearPolicies" {
    Write-Stage "clearing"
    $root = Join-Path $env:ProgramData "StellaKiosk"
    New-Item -ItemType Directory -Force -Path $root | Out-Null
    $clearPolicies = Join-Path $root "clear-policies.ps1"
    if (-not (Test-Path -LiteralPath $clearPolicies)) {
      throw "clear-policies.ps1 not found on kiosk — run deploy copy first"
    }
    $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $clearPolicies -InstallRoot $root 2>&1
    $msg = ($out | Out-String).Trim()
    if ($msg -notmatch "OK policies cleared") {
      throw $msg
    }
    Write-Stage "done"
    Write-Output "CLEAR_OK: $msg"
    exit 0
  }

  "Push" {
    Write-Stage "pushing"
    if (-not $ConfigJson) { throw "ConfigJson required for Push" }
    $root = Join-Path $env:ProgramData "StellaKiosk"
    if (-not (Test-Path (Join-Path $root "agent.mjs"))) {
      throw "StellaKiosk not installed at $root"
    }
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText((Join-Path $root "kiosk.json"), $ConfigJson, $utf8)
    $taskAgent = "StellaKioskAgent"
    try { Stop-ScheduledTask -TaskName $taskAgent -ErrorAction SilentlyContinue } catch {}
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.CommandLine -and ($_.CommandLine -like "*StellaKiosk*" -or $_.CommandLine -like "*agent.mjs*")) {
        try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
    Start-Sleep -Milliseconds 800
    Start-ScheduledTask -TaskName $taskAgent -ErrorAction SilentlyContinue
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 800
      try {
        $h = Invoke-RestMethod -Uri "http://127.0.0.1:$HealthPort/health" -TimeoutSec 2
        if ($h.ok) {
          Write-Stage "done"
          Write-Output "PUSH_OK: OK config pushed, agent healthy on :$HealthPort"
          exit 0
        }
      } catch {}
    }
    Write-Stage "done"
    Write-Output "PUSH_OK: OK config pushed; agent health pending"
    exit 0
  }
}
