# Local install on the kiosk PC (called after files are copied).
# ASCII-only: Windows PowerShell 5.1 mis-parses UTF-8 scripts without BOM.
param(
  [string]$InstallRoot = "$env:ProgramData\StellaKiosk",
  [string]$UiPort = "47820",
  [int]$HealthPort = 47821,
  # WinRM install: skip slow/hanging steps (lockdown, interactive Edge). Agent applies lockdown later.
  [switch]$RemoteInvoke
)

$ErrorActionPreference = "Stop"

function Write-Progress([string]$Msg) {
  [Console]::Out.WriteLine($Msg)
  [Console]::Out.Flush()
}
Write-Progress "install-local: preparing folders..."
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot "games") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot "ui") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot "runtime") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot "edge-profile") | Out-Null
Remove-Item -Path (Join-Path $InstallRoot "STOPPED") -Force -ErrorAction SilentlyContinue

# Default: block Alt+Tab / Win+Tab (agent + AtLogOn task)
Set-Content -Path (Join-Path $InstallRoot "BLOCK_KEYBOARD") -Value "1" -Encoding ASCII

$nodeExe = Join-Path $InstallRoot "runtime\node.exe"
if (-not (Test-Path $nodeExe)) {
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCmd) { $nodeExe = $nodeCmd.Source }
}
if (-not $nodeExe -or -not (Test-Path $nodeExe)) {
  throw "Node.js not found. Put portable Node into package\runtime or install Node on the kiosk."
}

$agent = Join-Path $InstallRoot "agent.mjs"
if (-not (Test-Path $agent)) {
  throw "agent.mjs not found in $InstallRoot"
}

$blockHotkeys = Join-Path $InstallRoot "block-hotkeys.ps1"

function Get-ConsoleUserId {
  $proc = Get-CimInstance Win32_Process -Filter "Name = 'explorer.exe'" -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $proc) { return $null }
  $owner = Invoke-CimMethod -InputObject $proc -MethodName GetOwner -ErrorAction SilentlyContinue
  if (-not $owner -or [string]::IsNullOrWhiteSpace($owner.User)) { return $null }
  if ($owner.Domain) { return "$($owner.Domain)\$($owner.User)" }
  return $owner.User
}

# Agent: SYSTEM, every boot (survives reboot; RestartCount=0 so admin Stop stays down)
Write-Progress "install-local: registering StellaKioskAgent task..."
$taskAgent = "StellaKioskAgent"
Unregister-ScheduledTask -TaskName $taskAgent -Confirm:$false -ErrorAction SilentlyContinue
$actionAgent = New-ScheduledTaskAction -Execute $nodeExe -Argument "`"$agent`"" -WorkingDirectory $InstallRoot
$triggerAgent = New-ScheduledTaskTrigger -AtStartup
$triggerAgent.Delay = "PT20S"
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settingsAgent = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 0
Register-ScheduledTask -TaskName $taskAgent -Action $actionAgent -Trigger $triggerAgent -Principal $principal -Settings $settingsAgent -Force | Out-Null
try { Enable-ScheduledTask -TaskName $taskAgent -ErrorAction SilentlyContinue } catch {}

# Keep display awake on AC (kiosk PCs) - backup current values first
$pwBackup = Join-Path $InstallRoot "powercfg-backup.txt"
if (-not (Test-Path -LiteralPath $pwBackup)) {
  try {
    $scheme = (powercfg /getactivescheme) -replace '.*GUID: ([a-f0-9-]+).*','$1'
    function Get-PowerTimeout([string]$Sub, [string]$Setting) {
      try {
        $out = powercfg /query $scheme $Sub $Setting 2>$null
        $line = $out | Where-Object { $_ -match 'Current AC Power Setting Index' } | Select-Object -First 1
        if ($line -match '0x([0-9a-f]+)') { return [Convert]::ToInt32($Matches[1], 16) }
      } catch {}
      return 0
    }
    $mon = Get-PowerTimeout 'SUB_VIDEO' 'VIDEOIDLE'
    $standby = Get-PowerTimeout 'SUB_SLEEP' 'STANDBYIDLE'
    $hib = Get-PowerTimeout 'SUB_SLEEP' 'HIBERNATEIDLE'
    @(
      "monitor-timeout-ac=$mon"
      "standby-timeout-ac=$standby"
      "hibernate-timeout-ac=$hib"
    ) | Set-Content -Path $pwBackup -Encoding ASCII
  } catch {}
}
try {
  powercfg /change monitor-timeout-ac 0 | Out-Null
  powercfg /change standby-timeout-ac 0 | Out-Null
  powercfg /change hibernate-timeout-ac 0 | Out-Null
} catch {}

Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.CommandLine -and ($_.CommandLine -like "*StellaKiosk*" -or $_.CommandLine -like "*agent.mjs*")) {
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
  }
}
Start-ScheduledTask -TaskName $taskAgent -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Progress "install-local: configuring Edge UI tasks..."
$edgeCandidates = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$edge = $edgeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
$consoleUser = Get-ConsoleUserId

$taskUi = "StellaKioskUI"
Unregister-ScheduledTask -TaskName $taskUi -Confirm:$false -ErrorAction SilentlyContinue

if ($edge) {
  # Disable Edge Visual Search hover button on images
try {
  $edgePol = "HKLM:\SOFTWARE\Policies\Microsoft\Edge"
  if (-not (Test-Path $edgePol)) { New-Item -Path $edgePol -Force | Out-Null }
  New-ItemProperty -Path $edgePol -Name "VisualSearchEnabled" -Value 0 -PropertyType DWord -Force | Out-Null
  New-ItemProperty -Path $edgePol -Name "QuickSearchShowMiniMenu" -Value 0 -PropertyType DWord -Force | Out-Null
} catch {}

  $uiArgs = "--user-data-dir=`"$InstallRoot\edge-profile`" --kiosk http://127.0.0.1:$UiPort/ --edge-kiosk-type=fullscreen --no-first-run --disable-session-crashed-bubble --noerrdialogs --check-for-update-interval=31536000 --disable-features=msEdgeSidebar,TranslateUI,InfiniteSessionRestore,msVisualSearch,EdgeShoppingCart,msEdgeDiscover,msEdgeFeedback,msSync,Sync,EdgeCollections,msShoppingFeature,EdgeSendFeedback --disable-pinch --overscroll-history-navigation=0 --disable-sync --disable-background-networking --disable-component-update --disable-breakpad --disable-crash-reporter --no-pings --metrics-recording-only"
  $actionUi = New-ScheduledTaskAction -Execute $edge -Argument $uiArgs
  $triggerUi = New-ScheduledTaskTrigger -AtLogOn
  $settingsUi = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  if ($consoleUser) {
    $principalUi = New-ScheduledTaskPrincipal -UserId $consoleUser -LogonType Interactive -RunLevel Highest
    Register-ScheduledTask -TaskName $taskUi -Action $actionUi -Trigger $triggerUi -Settings $settingsUi -Principal $principalUi -Force | Out-Null
  } else {
    Register-ScheduledTask -TaskName $taskUi -Action $actionUi -Trigger $triggerUi -Settings $settingsUi -Force | Out-Null
  }
  try { Enable-ScheduledTask -TaskName $taskUi -ErrorAction SilentlyContinue } catch {}

  if (-not $RemoteInvoke) {
  try {
    $once = "StellaKioskStartNow"
    Unregister-ScheduledTask -TaskName $once -Confirm:$false -ErrorAction SilentlyContinue
    if ($consoleUser) {
      $job = Start-Job -ScriptBlock {
        param($Once, $EdgePath, $Args, $User, $TaskUi)
        $action = New-ScheduledTaskAction -Execute $EdgePath -Argument $Args
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
        $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Highest
        if (Get-ScheduledTask -TaskName $TaskUi -ErrorAction SilentlyContinue) {
          Set-ScheduledTask -TaskName $TaskUi -Action $action -ErrorAction SilentlyContinue | Out-Null
        }
        Unregister-ScheduledTask -TaskName $Once -Confirm:$false -ErrorAction SilentlyContinue
        Register-ScheduledTask -TaskName $Once -Action $action -Principal $principal -Settings $settings -Force | Out-Null
        Start-ScheduledTask -TaskName $Once -ErrorAction Stop
        return "UI launched as $User"
      } -ArgumentList $once, $edge, $uiArgs, $consoleUser, $taskUi
      if (-not (Wait-Job $job -Timeout 20)) {
        Stop-Job $job -ErrorAction SilentlyContinue
        Write-Output "UI launch timed out; agent watchdog will start Edge for $consoleUser"
      } else {
        try {
          $msg = Receive-Job $job -ErrorAction Stop
          Write-Output $msg
        } catch {
          Write-Output "UI launch error: $($_.Exception.Message); agent watchdog will retry"
        }
      }
      Remove-Job $job -Force -ErrorAction SilentlyContinue
    } else {
      Write-Output "No interactive session (explorer); log on to the kiosk - agent will open Edge"
    }
  } catch {
    Write-Output "UI launch skipped: $($_.Exception.Message)"
  }
  } else {
    Write-Output "Remote install: Edge AtLogOn registered; immediate UI launch skipped (remote-install will kick Edge)"
  }
} else {
  Write-Output "WARN: Microsoft Edge not found. Install Edge, then use Start from admin."
}

# Hotkey block AtLogOn (agent also keeps it alive after boot)
Write-Progress "install-local: registering keyblock tasks..."
$taskKey = "StellaKioskKeyBlock"
Unregister-ScheduledTask -TaskName $taskKey -Confirm:$false -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "StellaKioskKeyBlockNow" -Confirm:$false -ErrorAction SilentlyContinue
if (Test-Path $blockHotkeys) {
  $actionKey = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$blockHotkeys`""
  $triggerKey = New-ScheduledTaskTrigger -AtLogOn
  $settingsKey = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  if ($consoleUser) {
    $principalKey = New-ScheduledTaskPrincipal -UserId $consoleUser -LogonType Interactive -RunLevel Highest
    Register-ScheduledTask -TaskName $taskKey -Action $actionKey -Trigger $triggerKey -Settings $settingsKey -Principal $principalKey -Force | Out-Null
    if (-not $RemoteInvoke) {
      $onceKey = "StellaKioskKeyBlockNow"
      Register-ScheduledTask -TaskName $onceKey -Action $actionKey -Principal $principalKey -Settings $settingsKey -Force | Out-Null
      try { Start-ScheduledTask -TaskName $onceKey -ErrorAction SilentlyContinue } catch {}
    }
    Write-Output "KeyBlock registered AtLogOn for $consoleUser"
  } else {
    Register-ScheduledTask -TaskName $taskKey -Action $actionKey -Trigger $triggerKey -Settings $settingsKey -Force | Out-Null
    Write-Output "KeyBlock AtLogOn registered (will start after user logon)"
  }
  try { Enable-ScheduledTask -TaskName $taskKey -ErrorAction SilentlyContinue } catch {}
} else {
  Write-Output "WARN: block-hotkeys.ps1 missing - Alt+Tab block unavailable until package update"
}

# Keyboard Filter / CAD policies (SYSTEM) - may need one reboot after first enable
$lockdownPolicies = Join-Path $InstallRoot "lockdown-policies.ps1"
if ($RemoteInvoke) {
  Write-Output "Remote install: lockdown-policies deferred (agent applies after start)"
} elseif (Test-Path $lockdownPolicies) {
  Write-Progress "install-local: applying lockdown-policies (may take up to 2 min)..."
  try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $lockdownPolicies -Mode on
    Write-Output "lockdown-policies applied"
  } catch {
    Write-Output "WARN: lockdown-policies failed: $($_.Exception.Message)"
  }
} else {
  Write-Output "WARN: lockdown-policies.ps1 missing"
}

Write-Progress "install-local: waiting for agent health..."
$healthOk = $false
try {
  $h = Invoke-RestMethod -Uri "http://127.0.0.1:$HealthPort/health" -TimeoutSec 3
  if ($h.ok) { $healthOk = $true }
} catch {}

Write-Output "INSTALLED: agent=$([bool](Test-Path $agent)) ui=$([bool](Test-Path (Join-Path $InstallRoot 'ui\index.html'))) node=$([bool](Test-Path $nodeExe)) edge=$([bool]$edge) keyblock=$([bool](Test-Path $blockHotkeys)) health=$healthOk"
Write-Output "OK installed at $InstallRoot"
exit 0
