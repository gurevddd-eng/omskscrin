# Stella Kiosk - OS lockdown that can block Ctrl+Alt+Del (Keyboard Filter).
# Run as SYSTEM (StellaKioskAgent). ASCII-only for PS 5.1.
# LL hooks cannot catch CAD; WEKF / Client-KeyboardFilter can on supported editions.
param(
  [ValidateSet("on", "off")]
  [string]$Mode = "on"
)

$ErrorActionPreference = "Continue"
$root = Join-Path $env:ProgramData "StellaKiosk"
$rebootFlag = Join-Path $root "NEED_REBOOT_KEYFILTER"
$ns = "root\standardcimv2\embedded"

function Set-PolicyDword([string]$Path, [string]$Name, [int]$Value, [bool]$Remove) {
  try {
    if (-not (Test-Path $Path)) { New-Item -Path $Path -Force | Out-Null }
    if ($Remove) {
      Remove-ItemProperty -Path $Path -Name $Name -ErrorAction SilentlyContinue
    } else {
      New-ItemProperty -Path $Path -Name $Name -Value $Value -PropertyType DWord -Force | Out-Null
    }
  } catch {}
}

function Set-CadMenuPolicies([bool]$Lock) {
  $sys = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"
  $exp = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer"
  Set-PolicyDword $sys "DisableTaskMgr" 1 (-not $Lock)
  Set-PolicyDword $sys "DisableLockWorkstation" 1 (-not $Lock)
  Set-PolicyDword $sys "DisableChangePassword" 1 (-not $Lock)
  Set-PolicyDword $sys "HideFastUserSwitching" 1 (-not $Lock)
  Set-PolicyDword $exp "NoLogoff" 1 (-not $Lock)
  Set-PolicyDword $exp "NoClose" 1 (-not $Lock)
}

function Ensure-KeyboardFilterFeature {
  try {
    $f = Get-WindowsOptionalFeature -Online -FeatureName "Client-KeyboardFilter" -ErrorAction Stop
    if ($f.State -eq "Enabled") {
      Write-Output "KeyboardFilter feature: already enabled"
      return $true
    }
    Write-Output "KeyboardFilter feature: enabling (reboot required once, timeout 120s)..."
    $job = Start-Job -ScriptBlock {
      Enable-WindowsOptionalFeature -Online -FeatureName "Client-KeyboardFilter" -All -NoRestart -ErrorAction Stop | Out-Null
    }
    if (-not (Wait-Job $job -Timeout 120)) {
      Stop-Job $job -Force -ErrorAction SilentlyContinue
      Remove-Job $job -Force -ErrorAction SilentlyContinue
      Write-Output "KeyboardFilter feature: enable timed out (skip; Pro may not support)"
      return $false
    }
    try {
      Receive-Job $job -ErrorAction Stop | Out-Null
    } catch {
      Remove-Job $job -Force -ErrorAction SilentlyContinue
      Write-Output ("KeyboardFilter feature: enable failed - " + $_.Exception.Message)
      return $false
    }
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    Set-Content -Path (Join-Path $root "KEYFILTER_ENABLED_BY_STELLA") -Value "1" -Encoding ASCII
    Set-Content -Path $rebootFlag -Value "1" -Encoding ASCII
    Write-Output "KeyboardFilter feature: enabled; reboot needed for CAD block"
    return $false
  } catch {
    Write-Output ("KeyboardFilter feature: unavailable - " + $_.Exception.Message)
    return $false
  }
}

function Start-KeyboardFilterService {
  foreach ($name in @("MsKeyboardFilter", "MsKeyboardFilterSvc")) {
    $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
    if (-not $svc) { continue }
    try {
      Set-Service -Name $name -StartupType Automatic -ErrorAction SilentlyContinue
      if ($svc.Status -ne "Running") { Start-Service -Name $name -ErrorAction SilentlyContinue }
      Write-Output ("KeyboardFilter service: " + $name + " running")
      return $true
    } catch {}
  }
  return $false
}

function Set-WekfPredefined([string]$Id, [bool]$Block) {
  try {
    $obj = Get-WmiObject -Class WEKF_PredefinedKey -Namespace $ns -ErrorAction Stop |
      Where-Object { $_.Id -eq $Id }
    if (-not $obj) { return $false }
    $obj.Enabled = [bool]$Block
    $obj.Put() | Out-Null
    Write-Output ("WEKF " + $Id + " blocked=" + $Block)
    return $true
  } catch {
    return $false
  }
}

function Apply-WekfBlocks([bool]$Block) {
  # Ids vary by Windows build - try common names
  $ids = @(
    "Ctrl+Alt+Del",
    "Ctrl+Alt+Delete",
    "Ctrl+Esc",
    "Alt+Tab",
    "Alt+Esc",
    "Alt+F4",
    "Ctrl+Shift+Esc",
    "Win+L",
    "Windows+L",
    "Win+Tab",
    "Windows+Tab",
    "Win+D",
    "Windows+D",
    "Win+R",
    "Windows+R",
    "Win+E",
    "Windows+E",
    "Win+X",
    "Windows+X"
  )
  $ok = 0
  foreach ($id in $ids) {
    if (Set-WekfPredefined $id $Block) { $ok++ }
  }
  Write-Output ("WEKF predefined applied: " + $ok)
  return ($ok -gt 0)
}

Set-CadMenuPolicies ($Mode -eq "on")

if ($Mode -eq "off") {
  Apply-WekfBlocks $false | Out-Null
  foreach ($name in @("MsKeyboardFilter", "MsKeyboardFilterSvc")) {
    $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
    if (-not $svc) { continue }
    try { Stop-Service -Name $name -Force -ErrorAction SilentlyContinue } catch {}
    try { Set-Service -Name $name -StartupType Manual -ErrorAction SilentlyContinue } catch {}
  }
  foreach ($p in @("HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer")) {
    Set-PolicyDword $p "NoLogoff" 1 $true
    Set-PolicyDword $p "NoClose" 1 $true
  }
  Remove-Item -Path $rebootFlag -Force -ErrorAction SilentlyContinue
  Write-Output "lockdown-policies off"
  exit 0
}

$ready = Ensure-KeyboardFilterFeature
Start-KeyboardFilterService | Out-Null
$wekf = Apply-WekfBlocks $true

if ($wekf) {
  Remove-Item -Path $rebootFlag -Force -ErrorAction SilentlyContinue
  Write-Output "CAD block: Keyboard Filter active"
} elseif (-not $ready) {
  Write-Output "CAD block: pending reboot after Keyboard Filter install"
} else {
  Write-Output "CAD block: Keyboard Filter present but WEKF not ready (reboot or unsupported edition)"
  if (-not (Test-Path $rebootFlag)) {
    Set-Content -Path $rebootFlag -Value "1" -Encoding ASCII
  }
}

Write-Output "lockdown-policies on"
exit 0
