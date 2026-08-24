$ErrorActionPreference = "Continue"
$sec = ConvertTo-SecureString $env:DEPLOY_PASSWORD -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($env:DEPLOY_USER, $sec)
$s = New-PSSession -ComputerName "patriotstela17.udhb.local" -Credential $cred -Authentication Negotiate

$result = Invoke-Command -Session $s -ScriptBlock {
  $root = "C:\ProgramData\StellaKiosk"
  $profile = Join-Path $root "edge-profile"
  $port = 47820

  Write-Host "=== index.html ==="
  Get-Content (Join-Path $root "ui\index.html") -Raw

  Write-Host "=== stop Edge (kiosk profile) ==="
  Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.CommandLine -and ($_.CommandLine -like "*$profile*" -or $_.CommandLine -like "*127.0.0.1:$port*")) {
      Write-Host ("kill pid=" + $_.ProcessId)
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2

  Write-Host "=== clear Stella edge-profile cache ==="
  if (Test-Path $profile) {
    foreach ($rel in @(
      "Default\Cache",
      "Default\Code Cache",
      "Default\GPUCache",
      "Default\Service Worker",
      "ShaderCache",
      "GrShaderCache"
    )) {
      $p = Join-Path $profile $rel
      if (Test-Path $p) {
        Write-Host "remove $rel"
        Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue
      }
    }
  } else {
    Write-Host "no edge-profile yet"
  }

  Write-Host "=== ensure agent healthy ==="
  $ok = $false
  for ($i = 0; $i -lt 10; $i++) {
    try {
      $h = (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:47821/health" -TimeoutSec 2).Content
      Write-Host $h
      $ok = $true
      break
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  if (-not $ok) {
    schtasks /Run /TN "StellaKioskAgent" | Out-Null
    Start-Sleep -Seconds 4
  }

  $edge = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1

  $uiArgs = "--user-data-dir=`"$profile`" --kiosk http://127.0.0.1:$port/?nocache=20260807-044519 --edge-kiosk-type=fullscreen --no-first-run --disable-session-crashed-bubble --noerrdialogs --check-for-update-interval=31536000 --disable-features=msEdgeSidebar,TranslateUI,InfiniteSessionRestore,msVisualSearch --disable-pinch --overscroll-history-navigation=0 --disk-cache-size=1"

  Write-Host "=== launch Edge via once task ==="
  $once = "StellaKioskUI_RefreshOnce"
  Unregister-ScheduledTask -TaskName $once -Confirm:$false -ErrorAction SilentlyContinue
  $action = New-ScheduledTaskAction -Execute $edge -Argument $uiArgs
  $principal = New-ScheduledTaskPrincipal -UserId "PATRIOTSTELA17\user" -LogonType Interactive -RunLevel Highest
  try {
    $principal = New-ScheduledTaskPrincipal -GroupId "Users" -LogonType Interactive
  } catch {}

  # Prefer console user if detectable
  $consoleUser = $null
  try {
    $cs = (Get-CimInstance Win32_ComputerSystem).UserName
    if ($cs) { $consoleUser = $cs }
  } catch {}
  Write-Host ("consoleUser=" + $consoleUser)

  if ($consoleUser) {
    $principal = New-ScheduledTaskPrincipal -UserId $consoleUser -LogonType Interactive -RunLevel Limited
  }

  Register-ScheduledTask -TaskName $once -Action $action -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName $once
  Start-Sleep -Seconds 5
  Unregister-ScheduledTask -TaskName $once -Confirm:$false -ErrorAction SilentlyContinue

  Write-Host "=== edge after ==="
  Get-Process msedge -ErrorAction SilentlyContinue |
    Select-Object Id, StartTime |
    Format-Table -AutoSize | Out-String | Write-Host

  "REFRESH_OK"
}

Write-Host $result
Remove-PSSession $s
