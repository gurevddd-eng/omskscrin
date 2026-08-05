# Stop Stella Kiosk agent + Edge UI on a remote (or local) Windows host via WinRM.
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

$stopBlock = {
  param([int]$Port, [int]$HealthPort)
  $ErrorActionPreference = "Continue"

  $root = Join-Path $env:ProgramData "StellaKiosk"
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  # Prevent agent watchdog from relaunching Edge after admin Stop
  Set-Content -Path (Join-Path $root "STOPPED") -Value ("stopped " + (Get-Date).ToString("o")) -Encoding ASCII

  $taskAgent = "StellaKioskAgent"
  $taskUi = "StellaKioskUI"
  $once = "StellaKioskStartNow"
  $keyOnce = "StellaKioskKeyBlockNow"
  $keyTask = "StellaKioskKeyBlock"

  # Stop running instances but KEEP Agent/UI/KeyBlock ENABLED so they return after reboot.
  foreach ($t in @($taskAgent, $taskUi, $once, $keyOnce, $keyTask)) {
    try { Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue } catch {}
  }
  foreach ($t in @($taskAgent, $taskUi, $keyTask)) {
    try { Enable-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue } catch {}
  }
  foreach ($t in @($once, $keyOnce)) {
    try { Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue } catch {}
  }

  # Kill agent node processes
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.CommandLine -and ($_.CommandLine -like "*StellaKiosk*" -or $_.CommandLine -like "*agent.mjs*")) {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
  }

  # Kill OS hotkey blocker
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.CommandLine -and $_.CommandLine -like "*block-hotkeys.ps1*") {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
  }

  # Kill Edge kiosk windows for this UI port
  Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.CommandLine -and $_.CommandLine -like "*127.0.0.1:$Port*") {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
  }

  # Second pass after disable (RestartCount may briefly respawn)
  Start-Sleep -Milliseconds 1200
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.CommandLine -and ($_.CommandLine -like "*StellaKiosk*" -or $_.CommandLine -like "*agent.mjs*")) {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
  }

  $agentAlive = $false
  try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:$HealthPort/health" -TimeoutSec 2
    if ($h.ok) { $agentAlive = $true }
  } catch {}

  if ($agentAlive) {
    throw "Agent still responds on :$HealthPort after stop"
  }

  return "OK agent and Edge UI stopped"
}

$Hostname = $Hostname.Trim()
$cn = $env:COMPUTERNAME
if (-not $cn) { $cn = $env:HOSTNAME }
if (-not $cn) { $cn = [System.Net.Dns]::GetHostName() }
$localName = $cn.ToLower()
$isLocal = $LocalOnly -or ($Hostname.ToLower() -eq $localName) -or ($Hostname -eq "localhost") -or ($Hostname -eq "127.0.0.1")

if ($isLocal) {
  Write-Stage "stopping"
  $msg = & $stopBlock -Port $UiPort -HealthPort $HealthPort
  Write-Stage "done"
  Write-Output "STOP_OK: $msg"
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
  Write-Stage "stopping"
  Write-Host "Stopping agent and Edge UI..."
  $result = Invoke-Command -Session $session -ScriptBlock $stopBlock -ArgumentList $UiPort, $HealthPort
  Write-Stage "done"
  Write-Output "STOP_OK: $result"
  exit 0
}
finally {
  if ($session) { Remove-PSSession $session -ErrorAction SilentlyContinue }
}
