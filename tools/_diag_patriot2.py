"""Deeper look at patriotstela17: pending reboot, Edge crashes, power, WU UX."""
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
    print(f"\n=== ... ===")
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
pwsh -NoProfile -Command '
$ErrorActionPreference = "Continue"
$sec = ConvertTo-SecureString $env:DEPLOY_PASSWORD -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($env:DEPLOY_USER, $sec)
$s = New-PSSession -ComputerName "patriotstela17.udhb.local" -Credential $cred -Authentication Negotiate
Invoke-Command -Session $s -ScriptBlock {
  function Say([string]$t){ Write-Host $t }

  Say "=== PENDING REBOOT ==="
  $keys = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired",
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending",
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootInProgress",
    "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager"
  )
  foreach ($k in $keys) {
    if (Test-Path $k) { Say ("EXISTS " + $k) } else { Say ("no " + $k) }
  }
  try {
    $sm = Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager" -Name PendingFileRenameOperations -ErrorAction SilentlyContinue
    if ($sm.PendingFileRenameOperations) { Say ("PendingFileRenameOperations count=" + @($sm.PendingFileRenameOperations).Count) }
  } catch {}

  Say "=== POWER / IDLE ==="
  powercfg /query SCHEME_CURRENT SUB_SLEEP 2>$null | Select-String -Pattern "Current AC|Current DC|Sleep|Hibernate|Display" | ForEach-Object { Say $_.Line.Trim() }
  try { Get-Content C:\ProgramData\StellaKiosk\powercfg-backup.txt -ErrorAction SilentlyContinue | ForEach-Object { Say ("backup: " + $_) } } catch {}

  Say "=== EDGE ARGS ==="
  Get-CimInstance Win32_Process -Filter "Name = ''msedge.exe''" -ErrorAction SilentlyContinue |
    Select-Object -First 2 ProcessId, CommandLine |
    ForEach-Object { Say ("pid=" + $_.ProcessId + " " + $_.CommandLine) }

  Say "=== APP ERRORS Edge last 3d ==="
  try {
    Get-WinEvent -FilterHashtable @{LogName="Application"; ProviderName="Application Error","Windows Error Reporting"; StartTime=(Get-Date).AddDays(-3)} -MaxEvents 30 -ErrorAction SilentlyContinue |
      Where-Object { $_.Message -match "msedge|Edge|chrome" } |
      Select-Object -First 10 |
      ForEach-Object { Say ($_.TimeCreated.ToString("s") + " " + (($_.Message -replace "\s+"," ").Substring(0,[Math]::Min(180,$_.Message.Length)))) }
  } catch { Say $_.Exception.Message }

  Say "=== WU / USER32 last 7d ==="
  try {
    Get-WinEvent -FilterHashtable @{LogName="System"; StartTime=(Get-Date).AddDays(-7)} -MaxEvents 200 -ErrorAction SilentlyContinue |
      Where-Object { $_.Id -in 1074,1076,6005,6006,6008,41 -or $_.ProviderName -match "WindowsUpdate|Restart|User32" } |
      Select-Object -First 15 |
      ForEach-Object { Say ($_.TimeCreated.ToString("s") + " Id=" + $_.Id + " " + $_.ProviderName + " " + (($_.Message -replace "\s+"," ").Substring(0,[Math]::Min(140,$_.Message.Length)))) }
  } catch { Say $_.Exception.Message }

  Say "=== ASSIGNED ACCESS / SHELL ==="
  try {
    Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\AssignedAccessConfiguration" -ErrorAction SilentlyContinue | Format-List | Out-String | Write-Host
  } catch {}
  try {
    $shell = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" -ErrorAction SilentlyContinue).Shell
    Say ("Winlogon.Shell=" + $shell)
  } catch {}

  Say "=== KIOSK.JSON ==="
  Get-Content C:\ProgramData\StellaKiosk\kiosk.json -Raw

  Say "=== NODE AGENT CMD ==="
  Get-CimInstance Win32_Process -Filter "Name = ''node.exe''" -ErrorAction SilentlyContinue |
    ForEach-Object { Say ("pid=" + $_.ProcessId + " " + $_.CommandLine) }
}
Remove-PSSession $s
'
""",
    timeout=180,
)
client.close()
print("DONE")
