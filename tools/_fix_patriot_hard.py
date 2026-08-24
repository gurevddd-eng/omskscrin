"""Hard-reset Stella processes on patriotstela17."""
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
  Write-Host "=== before ==="
  Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match '^(node|msedge|powershell)\.exe$' -and $_.CommandLine -match 'StellaKiosk|agent\.mjs|block-hotkeys'
  } | ForEach-Object { Write-Host ("PID=" + $_.ProcessId + " " + $_.Name + " " + $_.CommandLine.Substring(0,[Math]::Min(120,$_.CommandLine.Length))) }

  schtasks /End /TN StellaKioskAgent 2>$null | Out-Null
  schtasks /End /TN StellaKioskKeyBlock 2>$null | Out-Null
  schtasks /End /TN StellaKioskKeyBlockNow 2>$null | Out-Null
  Start-Sleep -Seconds 1

  Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'StellaKiosk|agent\.mjs') -or
    ($_.Name -eq 'msedge.exe' -and $_.CommandLine -match 'StellaKiosk') -or
    ($_.Name -eq 'powershell.exe' -and $_.CommandLine -match 'block-hotkeys|StellaKioskShell|stella-shell')
  } | ForEach-Object {
    Write-Host ("KILL " + $_.ProcessId)
    Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue
  }
  Start-Sleep -Seconds 2

  foreach ($f in @("LAUNCH_UI","FORCE_UPDATE","OTA_SOFT_RELOAD","STOPPED")) {
    $p = Join-Path $root $f
    if (Test-Path $p) {
      try { Remove-Item $p -Force -EA Stop; Write-Host ("removed " + $f) }
      catch { Write-Host ("lock " + $f + ": " + $_.Exception.Message) }
    }
  }

  $idb = Join-Path $root "edge-profile\Default\IndexedDB"
  if (Test-Path $idb) {
    Remove-Item $idb -Recurse -Force -EA SilentlyContinue
    Write-Host "IndexedDB wiped"
  }

  Set-Content -Path (Join-Path $root "LAUNCH_UI") -Value ("launch " + (Get-Date).Ticks) -Encoding ASCII -Force
  Write-Host "LAUNCH_UI written"

  $run = schtasks /Run /TN StellaKioskAgent 2>&1 | Out-String
  Write-Host $run
  Start-Sleep -Seconds 8
  Write-Host "=== after ==="
  Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -match 'StellaKiosk\\agent\.mjs|127\.0\.0\.1:47820'
  } | ForEach-Object { Write-Host ("PID=" + $_.ProcessId + " " + $_.Name) }
  try { Write-Host ((Invoke-WebRequest http://127.0.0.1:47821/health -UseBasicParsing -TimeoutSec 5).Content) }
  catch { Write-Host ("health: " + $_.Exception.Message) }
  try {
    $net = Get-NetTCPConnection -LocalPort 47821 -EA SilentlyContinue | Select-Object -First 3
    $net | ForEach-Object { Write-Host ("port47821 state=" + $_.State + " pid=" + $_.OwningProcess) }
  } catch {}
}
Remove-PSSession $s
"""


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)
    sftp = c.open_sftp()
    with sftp.file("/tmp/patriot_hard.ps1", "w") as f:
        f.write(PS1)
    sftp.close()
    _, o, e = c.exec_command(
        "cd /root/omskscrin && set -a && . ./.env && set +a && pwsh -NoProfile -File /tmp/patriot_hard.ps1",
        timeout=150,
    )
    print((o.read() + e.read()).decode("utf-8", "replace").encode("ascii", "replace").decode())

    for i in range(30):
        try:
            with urllib.request.urlopen("http://patriotstela17.udhb.local:47821/health", timeout=8) as res:
                h = json.loads(res.read().decode())
        except Exception as ex:
            h = {"error": str(ex)}
        print(
            f"+{i*4:02d}s sync={h.get('syncStatus')} msg={h.get('syncMessage')} err={str(h.get('error',''))[:50]}",
            flush=True,
        )
        if h.get("syncStatus") == "ok":
            print("SYNC_OK")
            break
        if h.get("syncStatus") and "backing" not in str(h.get("syncMessage") or "").lower():
            # may still be downloading
            if h.get("syncStatus") != "error" or "частично" in str(h.get("syncMessage") or ""):
                pass
        time.sleep(4)
    c.close()


if __name__ == "__main__":
    main()
