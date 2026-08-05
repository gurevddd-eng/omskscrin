# Clear Stella lockdown policies on a remote (or local) Windows host via WinRM/SSH.

param(

  [Parameter(Mandatory = $true)][string]$Hostname,

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



$clearScriptPath = Join-Path $PSScriptRoot "..\..\kiosk\scripts\clear-policies.ps1"

$clearScriptContent = ""

if (Test-Path -LiteralPath $clearScriptPath) {

  $clearScriptContent = Get-Content -LiteralPath $clearScriptPath -Raw -Encoding UTF8

}



$clearBlock = {

  param([string]$ScriptContent)

  $root = Join-Path $env:ProgramData "StellaKiosk"

  New-Item -ItemType Directory -Force -Path $root | Out-Null

  $dest = Join-Path $root "clear-policies.ps1"

  if ($ScriptContent -and $ScriptContent.Trim()) {

    Set-Content -Path $dest -Value $ScriptContent -Encoding UTF8

  }

  if (Test-Path -LiteralPath $dest) {

    $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $dest -InstallRoot $root 2>&1

    return ($out | Out-String).Trim()

  }



  Set-Content -Path (Join-Path $root "LOCKDOWN_SUPPRESS") -Value ("cleared " + (Get-Date).ToString("o")) -Encoding ASCII

  Set-Content -Path (Join-Path $root "BLOCK_KEYBOARD") -Value "0" -Encoding ASCII

  foreach ($t in @("StellaKioskKeyBlock", "StellaKioskKeyBlockNow")) {

    try { Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue } catch {}

    try { Disable-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue } catch {}

  }

  foreach ($p in @(

      "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System",

      "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"

    )) {

    foreach ($n in @("DisableTaskMgr", "DisableLockWorkstation", "DisableChangePassword", "HideFastUserSwitching")) {

      try { Remove-ItemProperty -Path $p -Name $n -ErrorAction SilentlyContinue } catch {}

    }

  }

  return "OK policies cleared (inline fallback)"

}



$Hostname = $Hostname.Trim()

$cn = $env:COMPUTERNAME
if (-not $cn) { $cn = $env:HOSTNAME }
if (-not $cn) { $cn = [System.Net.Dns]::GetHostName() }
$localName = $cn.ToLower()

$isLocal = $LocalOnly -or ($Hostname.ToLower() -eq $localName) -or ($Hostname -eq "localhost") -or ($Hostname -eq "127.0.0.1")



if ($isLocal) {

  Write-Stage "clearing"

  $msg = & $clearBlock $clearScriptContent

  Write-Stage "done"

  Write-Output "CLEAR_OK: $msg"

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

  Write-Stage "clearing"

  Write-Host "Clearing lockdown policies (push latest clear-policies.ps1)..."

  $result = Invoke-Command -Session $session -ScriptBlock $clearBlock -ArgumentList $clearScriptContent

  Write-Stage "done"

  Write-Output "CLEAR_OK: $result"

  exit 0

}

finally {

  if ($session) { Remove-PSSession $session -ErrorAction SilentlyContinue }

}


