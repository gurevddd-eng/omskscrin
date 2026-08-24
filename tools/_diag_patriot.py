"""Diagnose patriotstela17: agent, Edge, Windows Update, reboot prompts."""
import re
import sys
import time

import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("10.192.1.6", username="root", password="Mazambi47!", timeout=25, allow_agent=False, look_for_keys=False)
t = client.get_transport()
if t:
    t.set_keepalive(30)


def run(cmd, timeout=180):
    print(f"\n=== {cmd[:100]} ===")
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
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
            print("TIMEOUT")
            break
        time.sleep(0.2)
    out = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", "".join(chunks))
    sys.stdout.write(out.encode("ascii", "replace").decode())
    sys.stdout.flush()
    return out


# DB row + probe
run(
    r"""
cd /root/omskscrin
set -a; . ./.env; set +a
psql "$DATABASE_URL" -c "SELECT hostname, \"kioskId\", \"probeStatus\", \"probeMessage\", \"installStatus\", \"syncStatus\", \"syncMessage\", \"lastSeenAt\", \"contentVersion\", \"appVersion\" FROM \"Kiosk\" WHERE hostname ILIKE '%patriot%';"
"""
)

# WinRM remote diagnostics
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
try {
  $s = New-PSSession -ComputerName $cn -Credential $cred -Authentication Negotiate
} catch {
  Write-Host ("SESSION_FAIL: " + $_.Exception.Message)
  exit 1
}
Write-Host "SESSION_OK"
Invoke-Command -Session $s -ScriptBlock {
  Write-Host "=== HOST ==="
  hostname
  whoami
  Write-Host "=== UPTIME / BOOT ==="
  try {
    $os = Get-CimInstance Win32_OperatingSystem
    Write-Host ("LastBoot: " + $os.LastBootUpTime)
    Write-Host ("Local: " + (Get-Date))
  } catch {}
  Write-Host "=== STELLA FILES ==="
  $root = "C:\ProgramData\StellaKiosk"
  Get-ChildItem $root -ErrorAction SilentlyContinue | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize | Out-String | Write-Host
  foreach ($f in @("STOPPED","SOFTWARE_DISABLED","NEED_REBOOT_KEYFILTER","BLOCK_KEYBOARD","LOCKDOWN_SUPPRESS","version.json","kiosk.json")) {
    $p = Join-Path $root $f
    if (Test-Path $p) {
      Write-Host ("FILE $f EXISTS")
      if ($f -match "json|STOPPED|BLOCK") {
        try { Write-Host ((Get-Content $p -Raw -ErrorAction SilentlyContinue).Substring(0, [Math]::Min(400, (Get-Item $p).Length))) } catch {}
      }
    } else { Write-Host ("FILE $f missing") }
  }
  Write-Host "=== TASKS ==="
  Get-ScheduledTask -TaskName "Stella*" -ErrorAction SilentlyContinue | ForEach-Object {
    $i = $_ | Get-ScheduledTaskInfo
    Write-Host ($_.TaskName + " State=" + $_.State + " LastResult=" + $i.LastTaskResult + " LastRun=" + $i.LastRunTime)
  }
  Write-Host "=== PROCESSES ==="
  Get-Process node, msedge, powershell -ErrorAction SilentlyContinue | Select-Object Name, Id, StartTime | Format-Table -AutoSize | Out-String | Write-Host
  Write-Host "=== HEALTH ==="
  try { (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:47821/health -TimeoutSec 3).Content } catch { Write-Host ("health fail: " + $_.Exception.Message) }
  try { (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:47820/ -TimeoutSec 3).StatusCode } catch { Write-Host ("ui fail: " + $_.Exception.Message) }
  Write-Host "=== WINDOWS UPDATE ==="
  try {
    $au = Get-ItemProperty "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU" -ErrorAction SilentlyContinue
    if ($au) { $au | Format-List NoAutoRebootWithLoggedOnUsers, AUOptions, NoAutoUpdate | Out-String | Write-Host }
    else { Write-Host "No WU AU policy key" }
  } catch { Write-Host $_.Exception.Message }
  try {
    $ux = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings" -ErrorAction SilentlyContinue
    if ($ux) { Write-Host ("RestartNotificationsAllowed2=" + $ux.RestartNotificationsAllowed2) }
  } catch {}
  Write-Host "=== RECENT REBOOT / WU EVENTS ==="
  try {
    Get-WinEvent -FilterHashtable @{LogName="System"; Id=1074,6008,41; StartTime=(Get-Date).AddDays(-2)} -MaxEvents 8 -ErrorAction SilentlyContinue |
      ForEach-Object { Write-Host ($_.TimeCreated.ToString("s") + " Id=" + $_.Id + " " + ($_.Message -replace "\s+"," ").Substring(0, [Math]::Min(160, $_.Message.Length))) }
  } catch { Write-Host ("events: " + $_.Exception.Message) }
  Write-Host "=== AGENT LOG TAIL (if any) ==="
  $logs = @(
    (Join-Path $root "agent.log"),
    (Join-Path $root "logs\agent.log"),
    (Join-Path $env:TEMP "stella-agent.log")
  )
  foreach ($lp in $logs) {
    if (Test-Path $lp) {
      Write-Host ("LOG " + $lp)
      Get-Content $lp -Tail 40 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
    }
  }
}
Remove-PSSession $s
'
""",
    timeout=180,
)

client.close()
print("\nDONE")
