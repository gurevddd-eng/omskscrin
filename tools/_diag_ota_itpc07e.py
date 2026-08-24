"""Print agent.mjs lines 60-100 and 520-600 from itpc07."""
from __future__ import annotations

import sys
import paramiko

HOST = "10.192.1.6"
PASSWORD = "Mazambi47!"

PS1 = r"""
$ErrorActionPreference = "Stop"
$u = $env:DEPLOY_USER
$p = $env:DEPLOY_PASSWORD
$sec = ConvertTo-SecureString $p -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($u, $sec)
$s = New-PSSession -ComputerName "itpc07.udhb.local" -Credential $cred -Authentication Negotiate
Invoke-Command -Session $s -ScriptBlock {
  $lines = Get-Content "C:\ProgramData\StellaKiosk\agent.mjs"
  Write-Host "=== 60-100 ==="
  for ($i=59; $i -le 99; $i++) { Write-Host ("{0}: {1}" -f ($i+1), $lines[$i]) }
  Write-Host "=== 520-600 ==="
  for ($i=519; $i -le 599; $i++) { Write-Host ("{0}: {1}" -f ($i+1), $lines[$i]) }
  Write-Host "=== readForce 80-100 ==="
  for ($i=79; $i -le 110; $i++) { Write-Host ("{0}: {1}" -f ($i+1), $lines[$i]) }
  Write-Host "=== parse test ==="
  $j = Get-Content "C:\ProgramData\StellaKiosk\kiosk.json" -Raw | ConvertFrom-Json
  Write-Host ("json hostname=[{0}] kioskId=[{1}] serverUrl=[{2}]" -f $j.hostname, $j.kioskId, $j.serverUrl)
  # simulate node load
  node -e "const fs=require('fs'); const c=JSON.parse(fs.readFileSync('C:/ProgramData/StellaKiosk/kiosk.json','utf8')); console.log('node hostname', c.hostname); console.log('node kioskId', c.kioskId);"
}
Remove-PSSession $s
"""

def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)
    sftp = c.open_sftp()
    with sftp.file("/tmp/itpc07_lines.ps1", "w") as f:
        f.write(PS1)
    sftp.close()
    _, stdout, stderr = c.exec_command(
        "cd /root/omskscrin && set -a && . ./.env && set +a && pwsh -NoProfile -File /tmp/itpc07_lines.ps1",
        timeout=90,
    )
    print((stdout.read() + stderr.read()).decode("utf-8", "replace").encode("ascii", "replace").decode())
    c.close()

if __name__ == "__main__":
    main()
