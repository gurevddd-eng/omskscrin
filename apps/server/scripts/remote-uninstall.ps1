# Fully uninstall Stella Kiosk from a remote (or local) Windows host via WinRM.
# Stops agent/Edge, removes scheduled tasks, clears lockdown policies, deletes ProgramData\StellaKiosk.
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

$uninstallBlock = {
  param([int]$Port, [int]$HealthPort)
  $ErrorActionPreference = "Continue"

  $root = Join-Path $env:ProgramData "StellaKiosk"

  $tasks = @(
    "StellaKioskAgent",
    "StellaKioskUI",
    "StellaKioskStartNow",
    "StellaKioskKeyBlock",
    "StellaKioskKeyBlockNow"
  )
  foreach ($t in $tasks) {
    try { Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue } catch {}
    try { Disable-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue } catch {}
    try { Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue } catch {}
  }

  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.CommandLine -and ($_.CommandLine -like "*StellaKiosk*" -or $_.CommandLine -like "*agent.mjs*")) {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.CommandLine -and (
        $_.CommandLine -like "*block-hotkeys.ps1*" -or
        $_.CommandLine -like "*lockdown-policies.ps1*"
      )) {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
  Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.CommandLine -and (
        $_.CommandLine -like "*127.0.0.1:$Port*" -or
        $_.CommandLine -like "*StellaKiosk\edge-profile*"
      )) {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
  }

  Start-Sleep -Milliseconds 800

  # Full policy cleanup while scripts still exist
  $clearPolicies = Join-Path $root "clear-policies.ps1"
  if (Test-Path -LiteralPath $clearPolicies) {
    try {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $clearPolicies -InstallRoot $root 2>&1 | Out-Null
    } catch {}
  } else {
    # Fallback inline cleanup
    foreach ($p in @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System",
        "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"
      )) {
      try { Remove-ItemProperty -Path $p -Name "DisableTaskMgr" -ErrorAction SilentlyContinue } catch {}
      try { Remove-ItemProperty -Path $p -Name "DisableLockWorkstation" -ErrorAction SilentlyContinue } catch {}
      try { Remove-ItemProperty -Path $p -Name "DisableChangePassword" -ErrorAction SilentlyContinue } catch {}
      try { Remove-ItemProperty -Path $p -Name "HideFastUserSwitching" -ErrorAction SilentlyContinue } catch {}
    }
    foreach ($p in @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer",
        "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer"
      )) {
      try { Remove-ItemProperty -Path $p -Name "NoLogoff" -ErrorAction SilentlyContinue } catch {}
      try { Remove-ItemProperty -Path $p -Name "NoClose" -ErrorAction SilentlyContinue } catch {}
    }
    try {
      $ns = "root\standardcimv2\embedded"
      $keys = Get-WmiObject -Class WEKF_PredefinedKey -Namespace $ns -ErrorAction Stop
      foreach ($k in $keys) {
        if ($k.Enabled) {
          try { $k.Enabled = $false; $k.Put() | Out-Null } catch {}
        }
      }
    } catch {}
  }

  if (Test-Path -LiteralPath $root) {
    try {
      Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction Stop
    } catch {
      Start-Sleep -Milliseconds 500
      try { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction Stop } catch {
        return "PARTIAL: files locked ($($_.Exception.Message))"
      }
    }
  }

  $agentAlive = $false
  try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:$HealthPort/health" -TimeoutSec 2
    if ($h.ok) { $agentAlive = $true }
  } catch {}
  if ($agentAlive) {
    throw "Agent still responds on :$HealthPort after uninstall"
  }
  if (Test-Path -LiteralPath $root) {
    return "PARTIAL: folder still exists"
  }
  return "OK StellaKiosk removed"
}

$Hostname = $Hostname.Trim()
$localName = $env:COMPUTERNAME.ToLower()
$isLocal = $LocalOnly -or ($Hostname.ToLower() -eq $localName) -or ($Hostname -eq "localhost") -or ($Hostname -eq "127.0.0.1")

if ($isLocal) {
  Write-Stage "uninstalling"
  $msg = & $uninstallBlock -Port $UiPort -HealthPort $HealthPort
  Write-Stage "done"
  Write-Output "UNINSTALL_OK: $msg"
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
Write-Host "Connecting via WinRM to $Hostname ..."
try {
  $session = New-PSSession @sessionParams
} catch {
  throw "WinRM connect failed to '$Hostname': $($_.Exception.Message)"
}

try {
  Write-Stage "uninstalling"
  Write-Host "Uninstalling Stella Kiosk..."
  $result = Invoke-Command -Session $session -ScriptBlock $uninstallBlock -ArgumentList $UiPort, $HealthPort
  Write-Stage "done"
  Write-Output "UNINSTALL_OK: $result"
  exit 0
}
finally {
  if ($session) { Remove-PSSession $session -ErrorAction SilentlyContinue }
}
