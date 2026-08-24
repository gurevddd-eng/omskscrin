"""Restart Stella agent + Edge on patriotstela17; wait for sync ok."""
from __future__ import annotations

import json
import sys
import time
import urllib.request

import paramiko

HOST = "10.192.1.6"
PASSWORD = "Mazambi47!"

PS1 = r"""
$ErrorActionPreference = "Continue"
$u = $env:DEPLOY_USER
$p = $env:DEPLOY_PASSWORD
$sec = ConvertTo-SecureString $p -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($u, $sec)
$s = New-PSSession -ComputerName "patriotstela17.udhb.local" -Credential $cred -Authentication Negotiate
Invoke-Command -Session $s -ScriptBlock {
  $root = "C:\ProgramData\StellaKiosk"
  Write-Host "Restart StellaKioskAgent..."
  schtasks /End /TN StellaKioskAgent 2>$null | Out-Null
  Get-Process node -EA SilentlyContinue | Where-Object {
    try { $_.Path -like "*StellaKiosk*" } catch { $false }
  } | Stop-Process -Force -EA SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -EA SilentlyContinue | ForEach-Object {
    if ($_.CommandLine -like "*StellaKiosk*edge-profile*") { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }
  }
  Start-Sleep -Seconds 2
  $idb = Join-Path $root "edge-profile\Default\IndexedDB"
  if (Test-Path $idb) { Remove-Item $idb -Recurse -Force -EA SilentlyContinue; Write-Host "IndexedDB cleared again" }
  Set-Content (Join-Path $root "LAUNCH_UI") ([string][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) -Encoding ASCII -Force
  schtasks /Run /TN StellaKioskAgent | Out-Null
  Start-Sleep -Seconds 6
  try { Write-Host ((Invoke-WebRequest http://127.0.0.1:47821/health -UseBasicParsing -TimeoutSec 5).Content) }
  catch { Write-Host ("health fail: " + $_.Exception.Message) }
}
Remove-PSSession $s
"""


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)
    sftp = c.open_sftp()
    with sftp.file("/tmp/patriot_restart.ps1", "w") as f:
        f.write(PS1)
    sftp.close()
    _, o, e = c.exec_command(
        "cd /root/omskscrin && set -a && . ./.env && set +a && pwsh -NoProfile -File /tmp/patriot_restart.ps1",
        timeout=120,
    )
    print((o.read() + e.read()).decode("utf-8", "replace").encode("ascii", "replace").decode())

    for i in range(24):
        try:
            with urllib.request.urlopen("http://patriotstela17.udhb.local:47821/health", timeout=8) as res:
                h = json.loads(res.read().decode())
        except Exception as ex:
            h = {"error": str(ex)}
        print(
            f"+{i*5:02d}s sync={h.get('syncStatus')} msg={h.get('syncMessage')} ver={h.get('softwareVersion')} err={str(h.get('error',''))[:40]}",
            flush=True,
        )
        st = h.get("syncStatus")
        msg = str(h.get("syncMessage") or "")
        if st == "ok" and "backing store" not in msg.lower() and "indexedDB" not in msg.lower():
            print("OK")
            break
        time.sleep(5)
    c.close()


if __name__ == "__main__":
    main()
