"""Why patriotstela17 stays on old softwareVersion after admin OTA click."""
import re
import sys
import time

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(
    "10.192.1.6",
    username="root",
    password="Mazambi47!",
    timeout=25,
    allow_agent=False,
    look_for_keys=False,
)
t = c.get_transport()
if t:
    t.set_keepalive(30)


def run(cmd: str, timeout: int = 180) -> str:
    print(f"\n=== {cmd[:120]} ===", flush=True)
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


run(
    r"""
cd /root/omskscrin
set -a; . ./.env; set +a
echo "=== meta ==="
curl -s http://127.0.0.1:8080/api/deploy/meta; echo
psql "$DATABASE_URL" -c "SELECT hostname, \"softwareVersion\", \"appVersion\", \"lastSeenAt\", \"probeStatus\" FROM \"Kiosk\" WHERE hostname ILIKE '%patriot%';"
"""
)

run(
    r"""
cd /root/omskscrin
set -a; . ./.env; set +a
pwsh -NoProfile -Command '
$ErrorActionPreference = "Continue"
$u = $env:DEPLOY_USER
$p = $env:DEPLOY_PASSWORD
$sec = ConvertTo-SecureString $p -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($u, $sec)
$cn = "patriotstela17.udhb.local"
$s = New-PSSession -ComputerName $cn -Credential $cred -Authentication Negotiate
Write-Host "SESSION_OK"
Invoke-Command -Session $s -ScriptBlock {
  $root = "C:\ProgramData\StellaKiosk"
  Write-Host "=== FILES ==="
  Get-ChildItem $root -Force -ErrorAction SilentlyContinue |
    Select-Object Name, Length, LastWriteTime |
    Format-Table -AutoSize | Out-String | Write-Host
  Write-Host "=== VERSION ==="
  if (Test-Path "$root\version.json") { Get-Content "$root\version.json" -Raw }
  if (Test-Path "$root\VERSION") { Write-Host ("VERSION file: " + (Get-Content "$root\VERSION" -Raw)) }
  Write-Host "=== FLAGS ==="
  foreach ($f in @("FORCE_UPDATE","LAUNCH_UI","STOPPED","SOFTWARE_DISABLED")) {
    $p = Join-Path $root $f
    if (Test-Path $p) { Write-Host "$f = [$((Get-Content $p -Raw).Trim())]" }
    else { Write-Host "$f = (missing)" }
  }
  Write-Host "=== AGENT HAS FORCE? ==="
  if (Test-Path "$root\agent.mjs") {
    $has = Select-String -Path "$root\agent.mjs" -Pattern "FORCE_UPDATE" -SimpleMatch -Quiet
    Write-Host ("agent contains FORCE_UPDATE: " + $has)
    $has2 = Select-String -Path "$root\agent.mjs" -Pattern "applySoftwareUpdate" -SimpleMatch -Quiet
    Write-Host ("agent contains applySoftwareUpdate: " + $has2)
    Write-Host ("agent.mjs size: " + (Get-Item "$root\agent.mjs").Length)
  }
  Write-Host "=== HEALTH ==="
  try {
    $h = Invoke-WebRequest -Uri "http://127.0.0.1:47821/health" -UseBasicParsing -TimeoutSec 5
    Write-Host $h.Content
  } catch { Write-Host ("health fail: " + $_.Exception.Message) }
  Write-Host "=== NODE / TASK ==="
  Get-Process node -ErrorAction SilentlyContinue | Select-Object Id, StartTime, Path | Format-Table -AutoSize | Out-String | Write-Host
  schtasks /Query /TN StellaKioskAgent /V /FO LIST 2>$null | Select-String -Pattern "Status|Last Run|Task To Run|Last Result" | ForEach-Object { $_.Line }
  Write-Host "=== KIOSK.JSON serverUrl ==="
  if (Test-Path "$root\kiosk.json") {
    Get-Content "$root\kiosk.json" -Raw
  }
  Write-Host "=== TRY DOWNLOAD update.zip ==="
  try {
    $cfg = Get-Content "$root\kiosk.json" -Raw | ConvertFrom-Json
    $url = ($cfg.serverUrl.TrimEnd("/") + "/api/deploy/update.zip")
    Write-Host "URL $url"
    $tmp = Join-Path $env:TEMP "stella-ota-test.zip"
    $sw = [Diagnostics.Stopwatch]::StartNew()
    Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing -TimeoutSec 60
    $sw.Stop()
    Write-Host ("download ok bytes=" + (Get-Item $tmp).Length + " ms=" + $sw.ElapsedMilliseconds)
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  } catch {
    Write-Host ("download FAIL: " + $_.Exception.Message)
  }
  Write-Host "=== AGENT LOG TAIL (if any) ==="
  $logs = @(
    "$root\agent.log",
    "$root\logs\agent.log",
    "$env:TEMP\stella-agent.log"
  )
  foreach ($lp in $logs) {
    if (Test-Path $lp) {
      Write-Host "--- $lp ---"
      Get-Content $lp -Tail 40
    }
  }
  Get-ChildItem "$env:TEMP" -Filter "stella*" -ErrorAction SilentlyContinue |
    Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize | Out-String | Write-Host
}
Remove-PSSession $s
'
"""
)

c.close()
print("\nDONE", flush=True)
