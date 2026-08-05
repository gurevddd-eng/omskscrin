# Stella Kiosk - remove ALL lockdown policies and restore OS defaults.

# Run locally on kiosk or via WinRM/SSH. ASCII-only for PS 5.1.

param(

  [string]$InstallRoot = "",

  [switch]$KeepKeyboardFilterFeature

)



$ErrorActionPreference = "Continue"

if (-not $InstallRoot -or -not $InstallRoot.Trim()) {

  $InstallRoot = Join-Path $env:ProgramData "StellaKiosk"

}



$root = $InstallRoot

$ns = "root\standardcimv2\embedded"

$suppressFlag = Join-Path $root "LOCKDOWN_SUPPRESS"

$blockFlag = Join-Path $root "BLOCK_KEYBOARD"



function Remove-PolicyDword([string]$Path, [string]$Name) {

  try { Remove-ItemProperty -Path $Path -Name $Name -ErrorAction SilentlyContinue } catch {}

}



function Clear-RegistryPathPolicies([string]$BasePath) {

  foreach ($p in @(

      "$BasePath\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System",

      "$BasePath\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer"

    )) {

    if ($p -like "Registry::*") {

      $rp = $p

    } else {

      $rp = $p

    }

    foreach ($n in @("DisableTaskMgr", "DisableLockWorkstation", "DisableChangePassword", "HideFastUserSwitching")) {

      Remove-PolicyDword $rp $n

    }

    foreach ($n in @("NoLogoff", "NoClose")) {

      Remove-PolicyDword $rp $n

    }

  }

}



function Clear-RegistryLockdown {

  Clear-RegistryPathPolicies "HKLM:"

  Clear-RegistryPathPolicies "HKCU:"

  # All loaded user profiles (interactive + others)

  Get-ChildItem -Path Registry::HKEY_USERS -ErrorAction SilentlyContinue |

    Where-Object { $_.PSChildName -match '^S-1-5-21-' } |

    ForEach-Object {

      $sid = $_.PSChildName

      Clear-RegistryPathPolicies "Registry::HKEY_USERS\$sid"

    }

}



function Clear-WekfBlocks {

  try {

    $keys = Get-WmiObject -Class WEKF_PredefinedKey -Namespace $ns -ErrorAction Stop

    foreach ($k in $keys) {

      if ($k.Enabled) {

        try {

          $k.Enabled = $false

          $k.Put() | Out-Null

        } catch {}

      }

    }

    return $true

  } catch {

    return $false

  }

}



function Stop-KeyboardFilterServices {

  foreach ($name in @("MsKeyboardFilter", "MsKeyboardFilterSvc")) {

    $svc = Get-Service -Name $name -ErrorAction SilentlyContinue

    if (-not $svc) { continue }

    try { Stop-Service -Name $name -Force -ErrorAction SilentlyContinue } catch {}

    try { Set-Service -Name $name -StartupType Manual -ErrorAction SilentlyContinue } catch {}

  }

}



function Stop-KeyBlockTasks {

  foreach ($t in @("StellaKioskKeyBlock", "StellaKioskKeyBlockNow")) {

    try { Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue } catch {}

    try { Disable-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue } catch {}

    try { Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue } catch {}

  }

}



function Stop-HotkeyBlockProcesses {

  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue | ForEach-Object {

    if ($_.CommandLine -and (

        $_.CommandLine -like "*block-hotkeys.ps1*" -or

        $_.CommandLine -like "*lockdown-policies.ps1*"

      )) {

      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}

    }

  }

}



function Restore-PowerSettings {

  $backup = Join-Path $root "powercfg-backup.txt"

  if (Test-Path -LiteralPath $backup) {

    try {

      $lines = Get-Content -LiteralPath $backup -Encoding ASCII -ErrorAction Stop

      foreach ($line in $lines) {

        if ($line -match '^monitor-timeout-ac=(\d+)$') {

          powercfg /change monitor-timeout-ac $Matches[1] | Out-Null

        } elseif ($line -match '^standby-timeout-ac=(\d+)$') {

          powercfg /change standby-timeout-ac $Matches[1] | Out-Null

        } elseif ($line -match '^hibernate-timeout-ac=(\d+)$') {

          powercfg /change hibernate-timeout-ac $Matches[1] | Out-Null

        }

      }

      return "restored from backup"

    } catch {}

  }

  try {

    powercfg /change monitor-timeout-ac 15 | Out-Null

    powercfg /change standby-timeout-ac 0 | Out-Null

    powercfg /change hibernate-timeout-ac 0 | Out-Null

    return "defaults (monitor 15 min)"

  } catch {

    return "powercfg skipped"

  }

}



New-Item -ItemType Directory -Force -Path $root | Out-Null



# Tell agent not to re-apply lockdown while server blockKeyboard still ON

Set-Content -Path $suppressFlag -Value ("cleared " + (Get-Date).ToString("o")) -Encoding ASCII

Set-Content -Path $blockFlag -Value "0" -Encoding ASCII



Stop-HotkeyBlockProcesses

Stop-KeyBlockTasks



$lockdown = Join-Path $root "lockdown-policies.ps1"

if (Test-Path -LiteralPath $lockdown) {

  try {

    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $lockdown -Mode off 2>&1 | Out-Null

  } catch {}

}



Clear-RegistryLockdown

$wekf = Clear-WekfBlocks

Stop-KeyboardFilterServices



if (-not $KeepKeyboardFilterFeature) {

  $marker = Join-Path $root "KEYFILTER_ENABLED_BY_STELLA"

  if (Test-Path -LiteralPath $marker) {

    try {

      Disable-WindowsOptionalFeature -Online -FeatureName "Client-KeyboardFilter" -Remove -NoRestart -ErrorAction SilentlyContinue | Out-Null

    } catch {}

    Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue

  }

}



Remove-Item -Path (Join-Path $root "NEED_REBOOT_KEYFILTER") -Force -ErrorAction SilentlyContinue



$power = Restore-PowerSettings

Write-Output ("OK policies cleared; suppress=1; WEKF=" + $wekf + "; power=" + $power + "; logoff may refresh Start menu")


