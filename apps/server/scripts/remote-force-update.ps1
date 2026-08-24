# Signal Stella Kiosk agent to apply OTA immediately (writes FORCE_UPDATE flag).
param(
  [Parameter(Mandatory = $true)][string]$Hostname,
  [Parameter(Mandatory = $true)][string]$TargetVersion,
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

$block = {
  param([string]$Version)
  $ErrorActionPreference = "Stop"
  $root = Join-Path $env:ProgramData "StellaKiosk"
  if (-not (Test-Path $root)) {
    throw "StellaKiosk not installed"
  }
  $flag = Join-Path $root "FORCE_UPDATE"
  Set-Content -Path $flag -Value $Version.Trim() -Encoding Ascii -Force
  # Do NOT write LAUNCH_UI here: that races with OTA (Edge restart mid-copy).
  # Agent watches FORCE_UPDATE every ~1s — prefer live apply without bounce.

  $healthPort = 47821
  try {
    $cfgPath = Join-Path $root "kiosk.json"
    if (Test-Path $cfgPath) {
      $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
      if ($cfg.healthPort) { $healthPort = [int]$cfg.healthPort }
    }
  } catch { }

  $agentLive = $false
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$healthPort/health" -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) { $agentLive = $true }
  } catch { }

  if ($agentLive) {
    return "FORCE_UPDATE written ($Version); agent live — apply without restart"
  }

  # Agent down: quick restart (no multi-second sleeps)
  $null = & schtasks.exe /End /TN "StellaKioskAgent" 2>$null
  Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
    try { $_.Path -like "*StellaKiosk*" } catch { $false }
  } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 400
  $run = & schtasks.exe /Run /TN "StellaKioskAgent" 2>&1
  if ($LASTEXITCODE -ne 0) {
    return "FORCE_UPDATE written ($Version); agent restart failed: $run"
  }
  return "FORCE_UPDATE written ($Version); agent restarted"
}

$Hostname = $Hostname.Trim()
$cn = $env:COMPUTERNAME
if (-not $cn) { $cn = $env:HOSTNAME }
if (-not $cn) { $cn = [System.Net.Dns]::GetHostName() }
$localName = $cn.ToLower()
$isLocal = $LocalOnly -or ($Hostname.ToLower() -eq $localName) -or ($Hostname -eq "localhost") -or ($Hostname -eq "127.0.0.1")

if ($isLocal) {
  Write-Stage "starting"
  $msg = & $block -Version $TargetVersion
  Write-Stage "done"
  Write-Output "FORCE_OK: $msg"
  exit 0
}

$cred = $null
if ($DeployUser -and $DeployPassword) {
  $sec = ConvertTo-SecureString $DeployPassword -AsPlainText -Force
  $cred = New-Object System.Management.Automation.PSCredential ($DeployUser, $sec)
}

$sessionParams = @{
  ComputerName = $Hostname
  ErrorAction  = "Stop"
}
if ($cred) { $sessionParams.Credential = $cred }
if ($IsWindows) {
  $sessionParams.SessionOption = (New-PSSessionOption -OperationTimeout 0 -OpenTimeout 60000)
} else {
  $sessionParams.Authentication = "Negotiate"
}

Write-Stage "connecting"
Write-Host "Connecting via WinRM to $Hostname ..."
$session = New-PSSession @sessionParams
try {
  Write-Stage "starting"
  $result = Invoke-Command -Session $session -ScriptBlock $block -ArgumentList $TargetVersion
  Write-Stage "done"
  Write-Output "FORCE_OK: $result"
  exit 0
}
finally {
  if ($session) { Remove-PSSession $session -ErrorAction SilentlyContinue }
}
