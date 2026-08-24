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
  # Keep Task Manager (Ctrl+Shift+Esc) and Run (Win+R) for service access
  Set-PolicyDword $sys "DisableTaskMgr" 1 $true
  Set-PolicyDword $sys "DisableLockWorkstation" 1 (-not $Lock)
  Set-PolicyDword $sys "DisableChangePassword" 1 (-not $Lock)
  Set-PolicyDword $sys "HideFastUserSwitching" 1 (-not $Lock)
  Set-PolicyDword $exp "NoLogoff" 1 (-not $Lock)
  Set-PolicyDword $exp "NoClose" 1 (-not $Lock)
  # Win+R / Run dialog allowed — other Win chords still blocked via WEKF + LL hook
  Set-PolicyDword $exp "NoWinKeys" 1 $true
  Set-PolicyDword $exp "NoRun" 1 $true
  Set-PolicyDword $exp "NoViewContextMenu" 1 (-not $Lock)
  Set-PolicyDword $exp "NoTrayContextMenu" 1 (-not $Lock)
  Set-PolicyDword $exp "NoFind" 1 (-not $Lock)
  Set-PolicyDword $exp "NoControlPanel" 1 (-not $Lock)
  Set-PolicyDword $exp "NoChangeStartMenu" 1 (-not $Lock)
  Set-PolicyDword $exp "TaskbarLockAll" 1 (-not $Lock)
}

function Set-PolicyString([string]$Path, [string]$Name, [string]$Value, [bool]$Remove) {
  try {
    if (-not (Test-Path $Path)) { New-Item -Path $Path -Force | Out-Null }
    if ($Remove) {
      Remove-ItemProperty -Path $Path -Name $Name -ErrorAction SilentlyContinue
    } else {
      New-ItemProperty -Path $Path -Name $Name -Value $Value -PropertyType String -Force | Out-Null
    }
  } catch {}
}

function Set-EdgeKioskPolicies([bool]$Lock) {
  $edgePol = "HKLM:\SOFTWARE\Policies\Microsoft\Edge"
  $remove = -not $Lock

  # Chrome / Edge UI escapes, telemetry, sync, feedback
  Set-PolicyDword $edgePol "VisualSearchEnabled" 0 $remove
  Set-PolicyDword $edgePol "QuickSearchShowMiniMenu" 0 $remove
  Set-PolicyDword $edgePol "DownloadRestrictions" 3 $remove
  Set-PolicyDword $edgePol "AllowDeletingBrowserHistory" 0 $remove
  Set-PolicyDword $edgePol "HideRestoreDialogEnabled" 1 $remove
  Set-PolicyDword $edgePol "BrowserGuestModeEnabled" 0 $remove
  Set-PolicyDword $edgePol "BrowserAddProfileEnabled" 0 $remove
  Set-PolicyDword $edgePol "BrowserSignin" 0 $remove
  Set-PolicyDword $edgePol "ConfigureOnPremisesAccountAutoSignIn" 0 $remove
  Set-PolicyDword $edgePol "SyncDisabled" 1 $remove
  Set-PolicyDword $edgePol "PasswordManagerEnabled" 0 $remove
  Set-PolicyDword $edgePol "AutofillAddressEnabled" 0 $remove
  Set-PolicyDword $edgePol "AutofillCreditCardEnabled" 0 $remove
  Set-PolicyDword $edgePol "PaymentMethodQueryEnabled" 0 $remove
  Set-PolicyDword $edgePol "DeveloperToolsAvailability" 2 $remove
  Set-PolicyDword $edgePol "UserFeedbackAllowed" 0 $remove
  Set-PolicyDword $edgePol "MetricsReportingEnabled" 0 $remove
  Set-PolicyDword $edgePol "PersonalizationReportingEnabled" 0 $remove
  Set-PolicyDword $edgePol "SendSiteInfoToImproveServices" 0 $remove
  Set-PolicyDword $edgePol "SpellcheckEnabled" 0 $remove
  Set-PolicyDword $edgePol "TranslateEnabled" 0 $remove
  Set-PolicyDword $edgePol "HubsSidebarEnabled" 0 $remove
  Set-PolicyDword $edgePol "EdgeCollectionsEnabled" 0 $remove
  Set-PolicyDword $edgePol "EdgeShoppingAssistantEnabled" 0 $remove
  Set-PolicyDword $edgePol "ShoppingEnabled" 0 $remove
  Set-PolicyDword $edgePol "ShowMicrosoftRewardsExperience" 0 $remove
  Set-PolicyDword $edgePol "ShowRecommendationsEnabled" 0 $remove
  Set-PolicyDword $edgePol "SpotlightExperiencesAndRecommendationsEnabled" 0 $remove
  Set-PolicyDword $edgePol "MicrosoftEdgeInsiderPromotionEnabled" 0 $remove
  Set-PolicyDword $edgePol "HideFirstRunExperience" 1 $remove
  Set-PolicyDword $edgePol "HideInternetExplorerRedirectUXForIncompatibleSitesEnabled" 1 $remove
  Set-PolicyDword $edgePol "DefaultBrowserSettingEnabled" 0 $remove
  Set-PolicyDword $edgePol "BookmarkBarEnabled" 0 $remove
  Set-PolicyDword $edgePol "FavoritesBarEnabled" 0 $remove
  Set-PolicyDword $edgePol "ShowHomeButton" 0 $remove
  Set-PolicyDword $edgePol "VerticalTabsAllowed" 0 $remove
  Set-PolicyDword $edgePol "SearchSuggestEnabled" 0 $remove
  Set-PolicyDword $edgePol "AddressBarMicrosoftSearchInBingProviderEnabled" 0 $remove
  Set-PolicyDword $edgePol "AlternateErrorPagesEnabled" 0 $remove
  Set-PolicyDword $edgePol "ResolveNavigationErrorsUseWebService" 0 $remove
  Set-PolicyDword $edgePol "NetworkPredictionOptions" 2 $remove
  Set-PolicyDword $edgePol "TyposquattingCheckerEnabled" 0 $remove
  Set-PolicyDword $edgePol "InPrivateModeAvailability" 1 $remove
  Set-PolicyDword $edgePol "AllowSystemNotifications" 0 $remove
  Set-PolicyDword $edgePol "PromotionalTabsEnabled" 0 $remove
  Set-PolicyDword $edgePol "NewTabPageQuickLinksEnabled" 0 $remove
  Set-PolicyDword $edgePol "NewTabPageContentEnabled" 0 $remove
  Set-PolicyDword $edgePol "EdgeEnhanceImagesEnabled" 0 $remove
  Set-PolicyDword $edgePol "AADWebSiteSSOUsingThisProfileEnabled" 0 $remove
  Set-PolicyDword $edgePol "ExperimentationAndConfigurationServiceControl" 2 $remove
  Set-PolicyDword $edgePol "ComponentUpdatesEnabled" 0 $remove
  Set-PolicyDword $edgePol "BackgroundModeEnabled" 0 $remove
  Set-PolicyDword $edgePol "StartupBoostEnabled" 0 $remove
  Set-PolicyDword $edgePol "SleepingTabsEnabled" 0 $remove
  Set-PolicyDword $edgePol "EfficiencyModeEnabled" 0 $remove
  Set-PolicyDword $edgePol "GuidedSwitchEnabled" 0 $remove
  Set-PolicyDword $edgePol "EdgeFollowEnabled" 0 $remove
  Set-PolicyDword $edgePol "CryptoWalletEnabled" 0 $remove
  Set-PolicyDword $edgePol "WalletDonationEnabled" 0 $remove
  Set-PolicyDword $edgePol "RelatedMatchesCloudServiceEnabled" 0 $remove

  # Stay on local Stella UI only
  Set-PolicyString $edgePol "HomepageLocation" "http://127.0.0.1:47820/" $remove
  Set-PolicyString $edgePol "NewTabPageLocation" "http://127.0.0.1:47820/" $remove
  Set-PolicyDword $edgePol "RestoreOnStartup" 4 $remove
  Set-PolicyDword $edgePol "HomepageIsNewTabPage" 0 $remove
  try {
    if (-not (Test-Path $edgePol)) { New-Item -Path $edgePol -Force | Out-Null }
    if ($remove) {
      Remove-ItemProperty -Path $edgePol -Name "ConfigureKeyboardShortcuts" -ErrorAction SilentlyContinue
    } else {
      $shortcuts = '{"disabled":["Ctrl+N","Ctrl+Shift+N","Ctrl+T","Ctrl+Shift+T","Ctrl+W","Ctrl+Shift+W","Ctrl+L","Alt+D","F6","Ctrl+E","Ctrl+K","Ctrl+H","Ctrl+J","Ctrl+Shift+Delete","Ctrl+Shift+I","Ctrl+Shift+J","F12","Ctrl+,","Alt+E","Alt+F","Ctrl+Shift+B"]}'
      New-ItemProperty -Path $edgePol -Name "ConfigureKeyboardShortcuts" -PropertyType String -Value $shortcuts -Force | Out-Null
    }
  } catch {}

  # Windows diagnostic / feedback (helps stop "куда Edge отправляет данные")
  $dataCol = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection"
  Set-PolicyDword $dataCol "AllowTelemetry" 0 $remove
  Set-PolicyDword $dataCol "DoNotShowFeedbackNotifications" 1 $remove
  Set-PolicyDword "HKLM:\SOFTWARE\Policies\Microsoft\Windows\CloudContent" "DisableWindowsConsumerFeatures" 1 $remove
  Set-PolicyDword "HKLM:\SOFTWARE\Policies\Microsoft\Windows\CloudContent" "DisableSoftLanding" 1 $remove
  Set-PolicyDword "HKLM:\SOFTWARE\Policies\Microsoft\Windows\CloudContent" "DisableWindowsSpotlightFeatures" 1 $remove
  Set-PolicyDword "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\DataCollection" "AllowTelemetry" 0 $remove

  # URL allowlist — local Stella UI + content server (from kiosk.json)
  # Explicitly block edge:// / chrome:// / ms-settings (diagnostic, sync, feedback hubs)
  try {
    if (-not (Test-Path $edgePol)) { New-Item -Path $edgePol -Force | Out-Null }
    if (-not $Lock) {
      Remove-ItemProperty -Path $edgePol -Name "URLAllowlist" -ErrorAction SilentlyContinue
      Remove-ItemProperty -Path $edgePol -Name "URLBlocklist" -ErrorAction SilentlyContinue
    } else {
      $allow = New-Object System.Collections.Generic.List[string]
      foreach ($u in @(
          "http://127.0.0.1:47820",
          "http://127.0.0.1:47820/*",
          "http://localhost:47820",
          "http://localhost:47820/*",
          "about:blank"
        )) { $allow.Add($u) }
      try {
        $cfgPath = Join-Path $root "kiosk.json"
        if (Test-Path $cfgPath) {
          $cfg = Get-Content $cfgPath -Raw -ErrorAction Stop | ConvertFrom-Json
          if ($cfg.serverUrl) {
            $uri = [Uri]$cfg.serverUrl
            $origin = $uri.GetLeftPart([System.UriPartial]::Authority)
            if ($origin) {
              $allow.Add($origin)
              $allow.Add(($origin + "/*"))
            }
          }
        }
      } catch {}
      $block = [string[]]@(
        "*",
        "edge://*",
        "chrome://*",
        "chrome-extension://*",
        "edge-extension://*",
        "extension://*",
        "devtools://*",
        "microsoft-edge:*",
        "ms-settings:*",
        "ms-availablenetworks:*",
        "file://*"
      )
      New-ItemProperty -Path $edgePol -Name "URLAllowlist" -PropertyType MultiString -Value $allow.ToArray() -Force | Out-Null
      New-ItemProperty -Path $edgePol -Name "URLBlocklist" -PropertyType MultiString -Value $block -Force | Out-Null
    }
  } catch {}
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
    "Win",
    "Windows",
    "Win+L",
    "Windows+L",
    "Win+Tab",
    "Windows+Tab",
    "Win+D",
    "Windows+D",
    "Win+X",
    "Windows+X",
    "Win+I",
    "Windows+I",
    "Win+S",
    "Windows+S",
    "Win+A",
    "Windows+A",
    "Win+K",
    "Windows+K"
  )
  $ok = 0
  foreach ($id in $ids) {
    if (Set-WekfPredefined $id $Block) { $ok++ }
  }
  # Service access: Task Manager, Run, File Explorer
  foreach ($id in @("Ctrl+Shift+Esc", "Win+R", "Windows+R", "Win+E", "Windows+E")) {
    if (Set-WekfPredefined $id $false) { $ok++ }
  }
  Write-Output ("WEKF predefined applied: " + $ok)
  return ($ok -gt 0)
}

Set-CadMenuPolicies ($Mode -eq "on")
Set-EdgeKioskPolicies ($Mode -eq "on")

# Suppress Windows Update reboot prompts / auto-restart on kiosk
$wuAu = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU"
$wuPol = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate"
$wuUx = "HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings"
$storePol = "HKLM:\SOFTWARE\Policies\Microsoft\WindowsStore"
Set-PolicyDword $wuAu "NoAutoRebootWithLoggedOnUsers" 1 ($Mode -eq "off")
Set-PolicyDword $wuAu "NoAutoUpdate" 1 ($Mode -eq "off")
Set-PolicyDword $wuAu "AUOptions" 2 ($Mode -eq "off")
Set-PolicyDword $wuPol "SetDisableUXWUAccess" 1 ($Mode -eq "off")
Set-PolicyDword $wuUx "RestartNotificationsAllowed2" 0 ($Mode -eq "off")
Set-PolicyDword $storePol "AutoDownload" 2 ($Mode -eq "off")

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
    Set-PolicyDword $p "NoWinKeys" 1 $true
    Set-PolicyDword $p "NoRun" 1 $true
  }
  Set-PolicyDword "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer" "NoDesktop" 1 $true
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
