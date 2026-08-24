"""Direct WinRM: download update.zip on kiosk and apply, then restart agent."""
import re
import sys
import time

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("10.192.1.6", username="root", password="Mazambi47!", timeout=25, allow_agent=False, look_for_keys=False)
t = c.get_transport()
if t:
    t.set_keepalive(30)


def run(cmd, timeout=300):
    print(f"\n=== {cmd[:100]} ===", flush=True)
    _, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    chan = stdout.channel
    chan.settimeout(timeout)
    chunks = []
    end = time.time() + timeout
    while True:
        if chan.recv_ready():
            chunks.append(chan.recv(65536).decode("utf-8", "replace"))
        if chan.recv_stderr_ready():
            chunks.append(chan.recv_stderr(65536).decode("utf-8", "replace"))
        if chan.exit_status_ready() and not chan.recv_ready() and not chan.recv_stderr_ready():
            break
        if time.time() > end:
            print("TIMEOUT", flush=True)
            break
        time.sleep(0.2)
    out = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", "".join(chunks))
    sys.stdout.write(out.encode("ascii", "replace").decode())
    sys.stdout.flush()
    return out


# Upload fixed remote-force + new agent into deploy, pack already done locally — re-pack first via note
# Apply OTA directly on kiosk via WinRM (bypass flaky agent apply loop)
run(
    r"""
cd /root/omskscrin
set -a; . ./.env; set +a
TARGET=$(tr -d '\r\n' < data/deploy/current/VERSION)
echo TARGET=$TARGET
pwsh -NoProfile -Command '
$ErrorActionPreference = "Stop"
$u = $env:DEPLOY_USER
$p = $env:DEPLOY_PASSWORD
$sec = ConvertTo-SecureString $p -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($u, $sec)
$cn = "patriotstela17.udhb.local"
$s = New-PSSession -ComputerName $cn -Credential $cred -Authentication Negotiate
Write-Host "SESSION_OK"
$target = (Get-Content /root/omskscrin/data/deploy/current/VERSION -Raw).Trim()
# pass target from outside
' 
"""
)
# Simpler: one pwsh file invoked with env
run(
    r"""
cd /root/omskscrin
set -a; . ./.env; set +a
export TARGET=$(tr -d '\r\n' < data/deploy/current/VERSION)
pwsh -NoProfile -Command '
$ErrorActionPreference = "Stop"
$u = $env:DEPLOY_USER
$p = $env:DEPLOY_PASSWORD
$target = $env:TARGET
$sec = ConvertTo-SecureString $p -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($u, $sec)
$s = New-PSSession -ComputerName "patriotstela17.udhb.local" -Credential $cred -Authentication Negotiate
Write-Host "SESSION_OK target=$target"
Invoke-Command -Session $s -ArgumentList $target -ScriptBlock {
  param($Version)
  $ErrorActionPreference = "Stop"
  $root = "C:\ProgramData\StellaKiosk"
  $node = Join-Path $root "runtime\node.exe"
  Write-Host "Stopping agent..."
  schtasks /End /TN StellaKioskAgent 2>$null | Out-Null
  Start-Sleep -Seconds 2
  Get-Process node -ErrorAction SilentlyContinue | Where-Object {
    try { $_.Path -like "*StellaKiosk*" } catch { $false }
  } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1

  $cfg = Get-Content (Join-Path $root "kiosk.json") -Raw | ConvertFrom-Json
  $url = $cfg.serverUrl.TrimEnd("/") + "/api/deploy/update.zip"
  $zip = Join-Path $env:TEMP "stella-manual-ota.zip"
  $stage = Join-Path $env:TEMP "stella-manual-ota-stage"
  Write-Host "Downloading $url ..."
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 120
  Write-Host ("zip bytes=" + (Get-Item $zip).Length)
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  Expand-Archive -LiteralPath $zip -DestinationPath $stage -Force
  $payload = $stage
  $entries = Get-ChildItem $stage
  if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) { $payload = $entries[0].FullName }
  Write-Host "payload=$payload"
  if (Test-Path (Join-Path $payload "ui")) {
    Copy-Item (Join-Path $payload "ui\*") (Join-Path $root "ui") -Recurse -Force
  }
  foreach ($name in @("version.json","VERSION","agent.mjs","install-local.ps1","block-hotkeys.ps1","lockdown-policies.ps1","clear-policies.ps1")) {
    $src = Join-Path $payload $name
    if (Test-Path $src) {
      Copy-Item $src (Join-Path $root $name) -Force
      Write-Host "copied $name"
    }
  }
  if (Test-Path (Join-Path $payload "games")) {
    Copy-Item (Join-Path $payload "games\*") (Join-Path $root "games") -Recurse -Force
  }
  Remove-Item (Join-Path $root "FORCE_UPDATE") -Force -ErrorAction SilentlyContinue
  Set-Content -Path (Join-Path $root "LAUNCH_UI") -Value ([string][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) -Encoding Ascii -Force
  Write-Host ("VERSION now=" + (Get-Content (Join-Path $root "VERSION") -Raw).Trim())
  schtasks /Run /TN StellaKioskAgent | Out-Null
  Start-Sleep -Seconds 4
  try {
    Write-Host (Invoke-WebRequest http://127.0.0.1:47821/health -UseBasicParsing -TimeoutSec 5).Content
  } catch {
    Write-Host ("health: " + $_.Exception.Message)
  }
}
Remove-PSSession $s
Write-Host DONE
'
"""
)
c.close()
