"""Fix patriotstela17: clear corrupted Edge IndexedDB and relaunch UI."""
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
  $profile = Join-Path $root "edge-profile"
  Write-Host "Stopping Edge..."
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -EA SilentlyContinue | ForEach-Object {
    if ($_.CommandLine -and $_.CommandLine -like "*StellaKiosk*edge-profile*") {
      Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue
    }
  }
  Start-Sleep -Seconds 2
  # Wipe corrupted IndexedDB (media cache) — keep rest of profile
  $idb = Join-Path $profile "Default\IndexedDB"
  if (Test-Path $idb) {
    Write-Host "Removing IndexedDB..."
    Remove-Item -LiteralPath $idb -Recurse -Force -EA SilentlyContinue
  }
  $idb2 = Join-Path $profile "Default\File System"
  if (Test-Path $idb2) {
    Remove-Item -LiteralPath $idb2 -Recurse -Force -EA SilentlyContinue
  }
  # Drop Service Worker caches that can also break offline media
  foreach ($n in @("Service Worker","Cache","Code Cache","GPUCache")) {
    $p = Join-Path $profile ("Default\" + $n)
    if (Test-Path $p) { Remove-Item -LiteralPath $p -Recurse -Force -EA SilentlyContinue; Write-Host ("cleared " + $n) }
  }
  Set-Content -Path (Join-Path $root "LAUNCH_UI") -Value ([string][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) -Encoding ASCII -Force
  Write-Host "LAUNCH_UI set"
  Start-Sleep -Seconds 5
  try {
    $h = Invoke-WebRequest http://127.0.0.1:47821/health -UseBasicParsing -TimeoutSec 5
    Write-Host $h.Content
  } catch { Write-Host ("health: " + $_.Exception.Message) }
  $edge = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -EA SilentlyContinue | Where-Object { $_.CommandLine -like "*47820*" }
  Write-Host ("edge_kiosk_procs=" + @($edge).Count)
}
Remove-PSSession $s
Write-Host "DONE"
"""


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)
    sftp = c.open_sftp()
    with sftp.file("/tmp/patriot_fix_idb.ps1", "w") as f:
        f.write(PS1)
    sftp.close()
    _, o, e = c.exec_command(
        "cd /root/omskscrin && set -a && . ./.env && set +a && pwsh -NoProfile -File /tmp/patriot_fix_idb.ps1",
        timeout=120,
    )
    print((o.read() + e.read()).decode("utf-8", "replace").encode("ascii", "replace").decode())

    print("=== poll sync ===")
    for i in range(20):
        try:
            with urllib.request.urlopen("http://patriotstela17.udhb.local:47821/health", timeout=8) as res:
                h = json.loads(res.read().decode())
        except Exception as ex:
            h = {"error": str(ex)}
        print(
            f"+{i*5:02d}s sync={h.get('syncStatus')} msg={h.get('syncMessage')} err={h.get('error','')[:50]}",
            flush=True,
        )
        msg = str(h.get("syncMessage") or "")
        if h.get("syncStatus") == "ok" and "indexedDB" not in msg.lower() and "backing store" not in msg.lower():
            print("SYNC OK")
            break
        time.sleep(5)
    c.close()


if __name__ == "__main__":
    main()
