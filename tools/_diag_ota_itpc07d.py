"""Extract agent OTA/kioskId logic from itpc07; check FORCE handling."""
from __future__ import annotations

import sys

import paramiko

HOST = "10.192.1.6"
PASSWORD = "Mazambi47!"

PS1 = r"""
$ErrorActionPreference = "Continue"
$u = $env:DEPLOY_USER
$p = $env:DEPLOY_PASSWORD
$sec = ConvertTo-SecureString $p -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($u, $sec)
$s = New-PSSession -ComputerName "itpc07.udhb.local" -Credential $cred -Authentication Negotiate
Invoke-Command -Session $s -ScriptBlock {
  $root = "C:\ProgramData\StellaKiosk"
  Write-Host "=== kiosk.json ==="
  Get-Content "$root\kiosk.json" -Raw
  Write-Host "=== agent size/mtime ==="
  $a = Get-Item "$root\agent.mjs"
  Write-Host ("size={0} mtime={1}" -f $a.Length, $a.LastWriteTime)

  Write-Host "=== lines around kioskId/hostname ==="
  $lines = Get-Content "$root\agent.mjs"
  for ($i=0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "kioskId|hostname|FORCE_UPDATE|checkSoftware|applySoftware|serverUrl|softwareCheck") {
      Write-Host ("{0}: {1}" -f ($i+1), $lines[$i])
    }
  }

  Write-Host "=== task action ==="
  $t = Get-ScheduledTask -TaskName StellaKioskAgent -EA SilentlyContinue
  if ($t) {
    $t.Actions | ForEach-Object { Write-Host ("Execute={0} Args={1} WorkDir={2}" -f $_.Execute, $_.Arguments, $_.WorkingDirectory) }
  }

  Write-Host "=== env STELLA ==="
  Write-Host ("STELLA_KIOSK_CONFIG=" + [Environment]::GetEnvironmentVariable("STELLA_KIOSK_CONFIG","Machine"))
  Write-Host ("STELLA_KIOSK_CONFIG_user=" + [Environment]::GetEnvironmentVariable("STELLA_KIOSK_CONFIG","User"))

  Write-Host "=== FORCE now ==="
  if (Test-Path "$root\FORCE_UPDATE") { Get-Content "$root\FORCE_UPDATE" -Raw } else { Write-Host "gone" }
  Write-Host "=== VERSION ==="
  Get-Content "$root\VERSION" -Raw
}
Remove-PSSession $s
"""


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)
    sftp = c.open_sftp()
    with sftp.file("/tmp/itpc07_agent_code.ps1", "w") as f:
        f.write(PS1)
    sftp.close()
    _, stdout, stderr = c.exec_command(
        "cd /root/omskscrin && set -a && . ./.env && set +a && pwsh -NoProfile -File /tmp/itpc07_agent_code.ps1",
        timeout=120,
    )
    out = (stdout.read() + stderr.read()).decode("utf-8", "replace")
    sys.stdout.write(out.encode("ascii", "replace").decode())
    c.close()


if __name__ == "__main__":
    main()
