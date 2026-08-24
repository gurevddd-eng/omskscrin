$ErrorActionPreference = "Continue"
$sec = ConvertTo-SecureString $env:DEPLOY_PASSWORD -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($env:DEPLOY_USER, $sec)
$cn = "patriotstela17.udhb.local"
$s = New-PSSession -ComputerName $cn -Credential $cred -Authentication Negotiate

Invoke-Command -Session $s -ScriptBlock {
  $root = "C:\ProgramData\StellaKiosk"
  Write-Host "=== version.json ==="
  if (Test-Path "$root\version.json") { Get-Content "$root\version.json" -Raw } else { "MISSING" }

  Write-Host "=== UI assets ==="
  Get-ChildItem "$root\ui\assets" -ErrorAction SilentlyContinue |
    Select-Object Name, Length, LastWriteTime |
    Format-Table -AutoSize | Out-String | Write-Host

  Write-Host "=== CSS theme check ==="
  $css = Get-ChildItem "$root\ui\assets\*.css" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($css) {
    Write-Host $css.Name
    $raw = Get-Content $css.FullName -Raw
    if ($raw -match "--bg:\s*([^;]+)") { Write-Host ("--bg=" + $Matches[1].Trim()) } else { Write-Host "NO_BG_VAR" }
    if ($raw -match "rail__nav-hint") { Write-Host "HAS_NAV_HINT" } else { Write-Host "NO_NAV_HINT" }
    if ($raw -match "#e4e4e7") { Write-Host "HAS_LIGHT_GRAY" } else { Write-Host "NO_LIGHT_GRAY" }
  } else {
    Write-Host "NO_CSS"
  }

  Write-Host "=== agent health ==="
  try {
    (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:47821/health" -TimeoutSec 4).Content
  } catch {
    $_.Exception.Message
  }

  Write-Host "=== UI served index ==="
  try {
    $h = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:47820/" -TimeoutSec 4
    Write-Host $h.Content.Substring(0, [Math]::Min(400, $h.Content.Length))
  } catch {
    $_.Exception.Message
  }

  Write-Host "=== edge procs ==="
  Get-Process msedge -ErrorAction SilentlyContinue |
    Select-Object Id, StartTime |
    Format-Table -AutoSize | Out-String | Write-Host
}

Remove-PSSession $s
