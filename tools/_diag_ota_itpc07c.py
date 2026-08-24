"""itpc07 OTA: upload PS1 to server, run via WinRM, poll health."""
from __future__ import annotations

import json
import sys
import time
import urllib.request

import paramiko

HOST = "10.192.1.6"
PASSWORD = "Mazambi47!"
TARGET = "20260807-153637"

PS1 = r"""
$ErrorActionPreference = "Continue"
$u = $env:DEPLOY_USER
$p = $env:DEPLOY_PASSWORD
$sec = ConvertTo-SecureString $p -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($u, $sec)
$s = New-PSSession -ComputerName "itpc07.udhb.local" -Credential $cred -Authentication Negotiate
Write-Host "SESSION_OK"
Invoke-Command -Session $s -ScriptBlock {
  $root = "C:\ProgramData\StellaKiosk"
  Write-Host "=== FORCE patterns in agent.mjs ==="
  Select-String -Path "$root\agent.mjs" -Pattern "FORCE_UPDATE watch|setInterval\(tryApply|softwareCheckIntervalSec|Math\.max\(" |
    ForEach-Object { Write-Host ("{0}: {1}" -f $_.LineNumber, $_.Line.Trim().Substring(0, [Math]::Min(140, $_.Line.Trim().Length))) }

  Write-Host "=== FORCE file ==="
  if (Test-Path "$root\FORCE_UPDATE") {
    $fi = Get-Item "$root\FORCE_UPDATE"
    Write-Host ("age_sec={0} content=[{1}]" -f [int]((Get-Date) - $fi.LastWriteTime).TotalSeconds, (Get-Content $fi.FullName -Raw).Trim())
  } else { Write-Host "missing" }

  Write-Host "=== download update.zip ==="
  try {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    Invoke-WebRequest -Uri "http://omskekran.udhb.local/api/deploy/update.zip" -OutFile "$env:TEMP\stella-test-upd.zip" -UseBasicParsing -TimeoutSec 60
    Write-Host ("OK ms={0} size={1}" -f $sw.ElapsedMilliseconds, (Get-Item "$env:TEMP\stella-test-upd.zip").Length)
  } catch {
    Write-Host ("FAIL dns-name: " + $_.Exception.Message)
    try {
      Invoke-WebRequest -Uri "http://10.192.1.6:8080/api/deploy/update.zip" -OutFile "$env:TEMP\stella-test-upd2.zip" -UseBasicParsing -TimeoutSec 60
      Write-Host ("OK via IP size=" + (Get-Item "$env:TEMP\stella-test-upd2.zip").Length)
    } catch { Write-Host ("FAIL IP: " + $_.Exception.Message) }
  }

  Write-Host "=== heartbeat ids ==="
  foreach ($id in @("itpc07", "itpc07.udhb.local")) {
    try {
      $body = '{"softwareVersion":"20260807-144814","hostname":"itpc07","appVersion":"0.1.0"}'
      $r = Invoke-WebRequest -Uri ("http://omskekran.udhb.local/api/kiosks/{0}/heartbeat" -f $id) -Method POST -Body $body -ContentType "application/json" -UseBasicParsing -TimeoutSec 10
      Write-Host ("{0} -> {1} {2}" -f $id, $r.StatusCode, $r.Content.Substring(0, [Math]::Min(180, $r.Content.Length)))
    } catch { Write-Host ("{0} FAIL {1}" -f $id, $_.Exception.Message) }
  }

  Write-Host "=== node agents ==="
  Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -match "StellaKiosk|agent\.mjs" } |
    ForEach-Object { Write-Host ("PID={0} CMD={1}" -f $_.ProcessId, $_.CommandLine) }

  Write-Host "=== restart StellaKioskAgent ==="
  schtasks /End /TN StellaKioskAgent 2>$null | Out-Null
  Get-Process node -ErrorAction SilentlyContinue | Where-Object {
    try { $_.Path -like "*StellaKiosk*" } catch { $false }
  } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  Set-Content -Path "$root\FORCE_UPDATE" -Value "20260807-153637" -Encoding Ascii -Force
  schtasks /Run /TN StellaKioskAgent | Out-String | Write-Host
  Start-Sleep -Seconds 4
  try {
    $h = Invoke-WebRequest -Uri "http://127.0.0.1:47821/health" -UseBasicParsing -TimeoutSec 5
    Write-Host ("health: " + $h.Content)
  } catch { Write-Host ("health FAIL: " + $_.Exception.Message) }
}
Remove-PSSession $s
"""


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)

    sftp = c.open_sftp()
    with sftp.file("/tmp/itpc07_ota_diag.ps1", "w") as f:
        f.write(PS1)
    sftp.close()

    print("=== run remote ps1 ===", flush=True)
    _, stdout, stderr = c.exec_command(
        "cd /root/omskscrin && set -a && . ./.env && set +a && pwsh -NoProfile -File /tmp/itpc07_ota_diag.ps1",
        timeout=180,
    )
    out = (stdout.read() + stderr.read()).decode("utf-8", "replace")
    sys.stdout.write(out.encode("ascii", "replace").decode())
    sys.stdout.flush()

    print("\n=== poll health ===", flush=True)
    for i in range(40):
        try:
            with urllib.request.urlopen("http://itpc07.udhb.local:47821/health", timeout=5) as res:
                h = json.loads(res.read().decode())
        except Exception as e:
            h = {"error": str(e)}
        print(
            f"+{i*3:02d}s ver={h.get('softwareVersion')} inProgress={h.get('updateInProgress')} kioskId={h.get('kioskId')} err={h.get('error')}",
            flush=True,
        )
        if h.get("softwareVersion") == TARGET:
            print("SUCCESS")
            break
        time.sleep(3)
    else:
        print("STILL STUCK")

    # FORCE still there?
    _, stdout, stderr = c.exec_command(
        "cd /root/omskscrin && set -a && . ./.env && set +a && pwsh -NoProfile -Command "
        "\"$s=New-PSSession itpc07.udhb.local -Credential (New-Object PSCredential($env:DEPLOY_USER,(ConvertTo-SecureString $env:DEPLOY_PASSWORD -AsPlainText -Force))) -Authentication Negotiate; "
        "Invoke-Command -Session $s -ScriptBlock { if (Test-Path C:\\ProgramData\\StellaKiosk\\FORCE_UPDATE) { Get-Content C:\\ProgramData\\StellaKiosk\\FORCE_UPDATE } else { 'FORCE gone' }; "
        "Get-Content C:\\ProgramData\\StellaKiosk\\VERSION }; Remove-PSSession $s\"",
        timeout=60,
    )
    print("\n=== final VERSION/FORCE ===")
    print((stdout.read() + stderr.read()).decode("utf-8", "replace"))
    c.close()


if __name__ == "__main__":
    main()
