"""Apply WU suppress policies on patriotstela17 via WinRM inline."""
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

# Also upload lockdown script into repo + deploy current on server
sftp = client.open_sftp()
local = r"C:\Users\dvgurev\Desktop\stella-udhb\apps\kiosk\scripts\lockdown-policies.ps1"
sftp.put(local, "/root/omskscrin/apps/kiosk/scripts/lockdown-policies.ps1")
try:
    sftp.put(local, "/root/omskscrin/data/deploy/current/lockdown-policies.ps1")
except Exception as e:
    print("deploy current put skip:", e)
sftp.close()

cmd = r'''
cd /root/omskscrin
set -a; . ./.env; set +a
pwsh -NoProfile -Command '
$ErrorActionPreference = "Stop"
$sec = ConvertTo-SecureString $env:DEPLOY_PASSWORD -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($env:DEPLOY_USER, $sec)
$s = New-PSSession -ComputerName "patriotstela17.udhb.local" -Credential $cred -Authentication Negotiate
Invoke-Command -Session $s -ScriptBlock {
  function Set-Dword([string]$Path, [string]$Name, [int]$Value) {
    if (-not (Test-Path $Path)) { New-Item -Path $Path -Force | Out-Null }
    New-ItemProperty -Path $Path -Name $Name -Value $Value -PropertyType DWord -Force | Out-Null
  }
  Set-Dword "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU" "NoAutoRebootWithLoggedOnUsers" 1
  Set-Dword "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU" "NoAutoUpdate" 1
  Set-Dword "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU" "AUOptions" 2
  Set-Dword "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate" "SetDisableUXWUAccess" 1
  Set-Dword "HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings" "RestartNotificationsAllowed2" 0
  Set-Dword "HKLM:\SOFTWARE\Policies\Microsoft\WindowsStore" "AutoDownload" 2
  # push updated lockdown script from server share via WinRM text
  Write-Host "WU policies applied"
  Get-ItemProperty "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU" | Format-List NoAutoRebootWithLoggedOnUsers,NoAutoUpdate,AUOptions | Out-String | Write-Host
  Write-Host ("RestartNotificationsAllowed2=" + (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings").RestartNotificationsAllowed2)
  Write-Host ("RebootPending=" + (Test-Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending"))
  # health
  try { (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:47821/health -TimeoutSec 3).Content } catch { $_ }
}
Remove-PSSession $s
'
'''

_, stdout, stderr = client.exec_command(cmd, timeout=120)
chan = stdout.channel
chan.settimeout(120)
chunks = []
end = time.time() + 120
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
client.close()
print("\nDONE")
