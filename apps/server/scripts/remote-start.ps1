# Start Stella Kiosk agent + Edge UI on a remote (or local) Windows host via WinRM.
param(
  [Parameter(Mandatory = $true)][string]$Hostname,
  [int]$UiPort = 47820,
  [int]$HealthPort = 47821,
  [string]$DeployUser = "",
  [string]$DeployPassword = "",
  [switch]$LocalOnly
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Stage([string]$Name) {
  [Console]::Out.WriteLine("STAGE:$Name")
  [Console]::Out.Flush()
}

function ConvertTo-NetUser([string]$User) {
  if ($User -match '^(.+)@(.+)$') { return "$($Matches[2])\$($Matches[1])" }
  return $User
}

$startBlock = {
  param(
    [int]$Port,
    [int]$HealthPort,
    [string]$RunAsUser,
    [string]$RunAsPassword
  )
  $ErrorActionPreference = "Stop"

  function Get-ConsoleUserId {
    $proc = Get-CimInstance Win32_Process -Filter "Name = 'explorer.exe'" -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if (-not $proc) { return $null }
    $owner = Invoke-CimMethod -InputObject $proc -MethodName GetOwner -ErrorAction SilentlyContinue
    if (-not $owner -or [string]::IsNullOrWhiteSpace($owner.User)) { return $null }
    if ($owner.Domain -and $owner.Domain -ne $env:COMPUTERNAME) {
      return "$($owner.Domain)\$($owner.User)"
    }
    if ($owner.Domain) { return "$($owner.Domain)\$($owner.User)" }
    return $owner.User
  }

  function Find-Edge {
    @(
      "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
      "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  }

  $root = Join-Path $env:ProgramData "StellaKiosk"
  if (-not (Test-Path (Join-Path $root "agent.mjs"))) {
    throw "StellaKiosk not installed at $root. Install software first."
  }

  # Allow Edge watchdog again after admin Start
  Remove-Item -Path (Join-Path $root "STOPPED") -Force -ErrorAction SilentlyContinue
  Remove-Item -Path (Join-Path $root "SOFTWARE_DISABLED") -Force -ErrorAction SilentlyContinue

  $taskAgent = "StellaKioskAgent"
  if (-not (Get-ScheduledTask -TaskName $taskAgent -ErrorAction SilentlyContinue)) {
    throw "Task $taskAgent missing. Install software first."
  }

  # Restart agent (SYSTEM AtStartup task - always leave Enabled for reboot)
  try { Enable-ScheduledTask -TaskName $taskAgent -ErrorAction SilentlyContinue } catch {}
  try { Stop-ScheduledTask -TaskName $taskAgent -ErrorAction SilentlyContinue } catch {}
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.CommandLine -and ($_.CommandLine -like "*StellaKiosk*" -or $_.CommandLine -like "*agent.mjs*")) {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
  # Drop temporary stop so watchdog may run Edge + keyblock
  Remove-Item -Path (Join-Path $root "STOPPED") -Force -ErrorAction SilentlyContinue
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
  if (-not $healthy) {
    throw "Agent task started but health :$HealthPort did not respond"
  }

  $edge = Find-Edge
  if (-not $edge) {
    return "OK agent healthy; Edge not found (install Edge, agent will retry UI)"
  }

  New-Item -ItemType Directory -Force -Path (Join-Path $root "edge-profile") | Out-Null
  $uiArgs = "--user-data-dir=`"$root\edge-profile`" --kiosk http://127.0.0.1:$Port/ --edge-kiosk-type=fullscreen --no-first-run --disable-session-crashed-bubble --noerrdialogs --check-for-update-interval=31536000 --disable-features=msEdgeSidebar,TranslateUI,InfiniteSessionRestore --disable-pinch --overscroll-history-navigation=0"

  # Close previous kiosk Edge windows (best effort, never block)
  Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.CommandLine -and $_.CommandLine -like "*127.0.0.1:$Port*") {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
  }

  $taskUi = "StellaKioskUI"
  $actionUi = New-ScheduledTaskAction -Execute $edge -Argument $uiArgs
  if (-not (Get-ScheduledTask -TaskName $taskUi -ErrorAction SilentlyContinue)) {
    $triggerUi = New-ScheduledTaskTrigger -AtLogOn
    Register-ScheduledTask -TaskName $taskUi -Action $actionUi -Trigger $triggerUi -Force | Out-Null
  } else {
    try { Enable-ScheduledTask -TaskName $taskUi -ErrorAction SilentlyContinue } catch {}
    Set-ScheduledTask -TaskName $taskUi -Action $actionUi -ErrorAction SilentlyContinue | Out-Null
  }

  $consoleUser = Get-ConsoleUserId
  $once = "StellaKioskStartNow"
  Unregister-ScheduledTask -TaskName $once -Confirm:$false -ErrorAction SilentlyContinue
  $launchHow = "queued via StellaKioskUI (agent watchdog)"

  # Interactive Edge start can hang under WinRM - hard timeout, agent watchdog will retry
  $launchJob = Start-Job -ScriptBlock {
    param($EdgePath, $Args, $Once, $ConsoleUser, $RunAsUser, $RunAsPassword, $TaskUi)
    $ErrorActionPreference = "Stop"
    $action = New-ScheduledTaskAction -Execute $EdgePath -Argument $Args
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
    if ($ConsoleUser) {
      $principal = New-ScheduledTaskPrincipal -UserId $ConsoleUser -LogonType Interactive -RunLevel Highest
      Register-ScheduledTask -TaskName $Once -Action $action -Principal $principal -Settings $settings -Force | Out-Null
      Start-ScheduledTask -TaskName $Once -ErrorAction Stop
      return "interactive task as $ConsoleUser"
    }
    if ($RunAsUser -and $RunAsPassword) {
      $netUser = $RunAsUser
      if ($RunAsUser -match '^(.+)@(.+)$') { $netUser = "$($Matches[2])\$($Matches[1])" }
      $principal = New-ScheduledTaskPrincipal -UserId $netUser -LogonType Interactive -RunLevel Highest
      Register-ScheduledTask -TaskName $Once -Action $action -Principal $principal -Settings $settings -Password $RunAsPassword -Force | Out-Null
      Start-ScheduledTask -TaskName $Once -ErrorAction Stop
      return "interactive task as $netUser (deploy creds)"
    }
    Start-ScheduledTask -TaskName $TaskUi -ErrorAction SilentlyContinue
    return "AtLogOn task triggered (no console user)"
  } -ArgumentList $edge, $uiArgs, $once, $consoleUser, $RunAsUser, $RunAsPassword, $taskUi

  if (Wait-Job -Job $launchJob -Timeout 25) {
    try {
      $launchHow = Receive-Job -Job $launchJob -ErrorAction Stop
    } catch {
      $launchHow = "Edge launch error: $($_.Exception.Message); agent will retry"
    }
  } else {
    Stop-Job -Job $launchJob -ErrorAction SilentlyContinue
    $launchHow = "Edge launch timed out (25s); agent watchdog will retry"
  }
  Remove-Job -Job $launchJob -Force -ErrorAction SilentlyContinue

  return "OK agent healthy; Edge launch: $launchHow"
}

$Hostname = $Hostname.Trim()
$cn = $env:COMPUTERNAME
if (-not $cn) { $cn = $env:HOSTNAME }
if (-not $cn) { $cn = [System.Net.Dns]::GetHostName() }
$localName = $cn.ToLower()
$isLocal = $LocalOnly -or ($Hostname.ToLower() -eq $localName) -or ($Hostname -eq "localhost") -or ($Hostname -eq "127.0.0.1")

$runAs = ""
$runPw = ""
if ($DeployUser) { $runAs = ConvertTo-NetUser $DeployUser; if ($DeployUser -match '@') { $runAs = $DeployUser } }
if ($DeployPassword) { $runPw = $DeployPassword }

if ($isLocal) {
  Write-Stage "connecting"
  Write-Stage "starting"
  $msg = & $startBlock -Port $UiPort -HealthPort $HealthPort -RunAsUser $DeployUser -RunAsPassword $DeployPassword
  Write-Stage "done"
  Write-Output "START_OK: $msg"
  exit 0
}

$cred = $null
if ($DeployUser -and $DeployPassword) {
  if ($DeployUser -match '^(DOMAIN\\|domain\\)') {
    throw "DEPLOY_USER looks like a placeholder. Use user@domain"
  }
  $sec = ConvertTo-SecureString $DeployPassword -AsPlainText -Force
  $cred = New-Object System.Management.Automation.PSCredential ($DeployUser, $sec)
}

$sessionParams = @{
  ComputerName  = $Hostname
  ErrorAction   = "Stop"
}
if ($cred) { $sessionParams.Credential = $cred }
if ($IsWindows) {
  $sessionParams.SessionOption = (New-PSSessionOption -OperationTimeout 0 -OpenTimeout 60000)
} else {
  $sessionParams.Authentication = "Negotiate"
}

Write-Stage "connecting"
Write-Host "Connecting via WinRM to $Hostname ..."
try {
  $session = New-PSSession @sessionParams
} catch {
  throw "WinRM connect failed to '$Hostname': $($_.Exception.Message)"
}

try {
  Write-Stage "starting"
  Write-Host "Starting agent and Edge UI on interactive desktop..."
  $result = Invoke-Command -Session $session -ScriptBlock $startBlock -ArgumentList $UiPort, $HealthPort, $DeployUser, $DeployPassword
  Write-Stage "done"
  Write-Output "START_OK: $result"
  exit 0
}
finally {
  if ($session) { Remove-PSSession $session -ErrorAction SilentlyContinue }
}
