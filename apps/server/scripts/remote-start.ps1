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

  function Test-AgentHealthy([int]$Hp) {
    try {
      $h = Invoke-RestMethod -Uri "http://127.0.0.1:$Hp/health" -TimeoutSec 1
      return [bool]$h.ok
    } catch {
      return $false
    }
  }

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

  try { Enable-ScheduledTask -TaskName $taskAgent -ErrorAction SilentlyContinue | Out-Null } catch {}
  foreach ($t in @("StellaKioskUI", "StellaKioskKeyBlock")) {
    try { Enable-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue | Out-Null } catch {}
  }

  $alreadyHealthy = Test-AgentHealthy $HealthPort
  if (-not $alreadyHealthy) {
    # Cold start only — restarting a healthy agent was the main Start UI delay
    try { Stop-ScheduledTask -TaskName $taskAgent -ErrorAction SilentlyContinue } catch {}
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.CommandLine -and ($_.CommandLine -like "*StellaKiosk*" -or $_.CommandLine -like "*agent.mjs*")) {
        try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
    Start-Sleep -Milliseconds 400
    Start-ScheduledTask -TaskName $taskAgent -ErrorAction Stop

    $deadline = (Get-Date).AddSeconds(8)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 350
      if (Test-AgentHealthy $HealthPort) { $alreadyHealthy = $true; break }
    }
    if (-not $alreadyHealthy) {
      throw "Agent task started but health :$HealthPort did not respond"
    }
  }

  # Do NOT Register/Start interactive Edge tasks under WinRM — they hang the session.
  # Agent watchdog reads LAUNCH_UI and opens Edge on the console session.
  function Test-EdgeUi([int]$Port) {
    try {
      $procs = Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" -ErrorAction SilentlyContinue
      foreach ($p in $procs) {
        if ($p.CommandLine -and (
            $p.CommandLine -like "*127.0.0.1:$Port*" -or
            $p.CommandLine -like "*StellaKiosk\edge-profile*"
          )) {
          return $true
        }
      }
    } catch {}
    return $false
  }

  $edge = Find-Edge
  if (-not $edge) {
    return "OK agent healthy; Edge binary not found (install Edge)"
  }

  if (Test-EdgeUi $Port) {
    return "OK agent healthy; Edge UI already running"
  }

  # Best-effort: clear stale Edge so watchdog launches cleanly
  try {
    Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.CommandLine -and ($_.CommandLine -like "*127.0.0.1:$Port*" -or $_.CommandLine -like "*StellaKiosk\edge-profile*")) {
        try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
  } catch {}

  $bust = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  try {
    Set-Content -Path (Join-Path $root "LAUNCH_UI") -Value ([string]$bust) -Encoding ascii -Force
  } catch {
    throw "Failed to write LAUNCH_UI flag: $($_.Exception.Message)"
  }

  try { Enable-ScheduledTask -TaskName "StellaKioskUI" -ErrorAction SilentlyContinue | Out-Null } catch {}

  # Wait until Edge is actually on the interactive desktop — do not report success early
  $deadline = (Get-Date).AddSeconds(28)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 400
    if (Test-EdgeUi $Port) {
      return "OK agent healthy; Edge UI running"
    }
  }

  throw "Agent healthy but Edge UI did not start within 28s (check interactive session / explorer)"
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
