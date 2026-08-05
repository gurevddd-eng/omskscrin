# Push kiosk.json to a remote (or local) Windows host and restart agent.
param(
  [Parameter(Mandatory = $true)][string]$Hostname,
  [Parameter(Mandatory = $true)][string]$ConfigJson,
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

$pushBlock = {
  param([string]$Json, [int]$Port)
  $root = Join-Path $env:ProgramData "StellaKiosk"
  if (-not (Test-Path (Join-Path $root "agent.mjs"))) {
    throw "StellaKiosk not installed at $root"
  }
  Set-Content -Path (Join-Path $root "kiosk.json") -Value $Json -Encoding UTF8

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
      $h = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
      if ($h.ok) { return "OK config pushed, agent healthy on :$Port" }
    } catch {}
  }
  return "OK config pushed; agent health :$Port pending"
}

$Hostname = $Hostname.Trim()
$localName = $env:COMPUTERNAME.ToLower()
$isLocal = $LocalOnly -or ($Hostname.ToLower() -eq $localName) -or ($Hostname -eq "localhost") -or ($Hostname -eq "127.0.0.1")

if ($isLocal) {
  Write-Stage "pushing"
  $msg = & $pushBlock -Json $ConfigJson -Port $HealthPort
  Write-Stage "done"
  Write-Output "PUSH_OK: $msg"
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
  SessionOption = (New-PSSessionOption -OperationTimeout 0 -OpenTimeout 60000)
}
if ($cred) { $sessionParams.Credential = $cred }

Write-Stage "connecting"
try {
  $session = New-PSSession @sessionParams
} catch {
  throw "WinRM connect failed to '$Hostname': $($_.Exception.Message)"
}

try {
  Write-Stage "pushing"
  $result = Invoke-Command -Session $session -ScriptBlock $pushBlock -ArgumentList $ConfigJson, $HealthPort
  Write-Stage "done"
  Write-Output "PUSH_OK: $result"
  exit 0
}
finally {
  if ($session) { Remove-PSSession $session -ErrorAction SilentlyContinue }
}
