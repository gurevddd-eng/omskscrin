"""Hotfix itpc07: rewrite kiosk.json without BOM, FORCE_UPDATE, restart, trigger admin OTA."""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

import paramiko

HOST = "10.192.1.6"
PASSWORD = "Mazambi47!"
BASE = f"http://{HOST}:8080"
TARGET = "20260807-153637"

PS1 = r"""
$ErrorActionPreference = "Stop"
$u = $env:DEPLOY_USER
$p = $env:DEPLOY_PASSWORD
$sec = ConvertTo-SecureString $p -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($u, $sec)
$s = New-PSSession -ComputerName "itpc07.udhb.local" -Credential $cred -Authentication Negotiate
Invoke-Command -Session $s -ScriptBlock {
  $root = "C:\ProgramData\StellaKiosk"
  $path = Join-Path $root "kiosk.json"
  $raw = [IO.File]::ReadAllBytes($path)
  Write-Host ("before_hex=" + [BitConverter]::ToString($raw[0..([Math]::Min(5,$raw.Length-1))]))
  $txt = [Text.Encoding]::UTF8.GetString($raw).TrimStart([char]0xFEFF)
  $obj = $txt | ConvertFrom-Json
  # ensure FQDN ids
  if (-not $obj.hostname) { $obj | Add-Member hostname "itpc07.udhb.local" }
  else { $obj.hostname = "itpc07.udhb.local" }
  if (-not $obj.kioskId) { $obj | Add-Member kioskId "itpc07.udhb.local" }
  else { $obj.kioskId = "itpc07.udhb.local" }
  if (-not $obj.serverUrl) { $obj | Add-Member serverUrl "http://omskekran.udhb.local" }
  $json = $obj | ConvertTo-Json -Compress
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [IO.File]::WriteAllText($path, $json, $utf8)
  $raw2 = [IO.File]::ReadAllBytes($path)
  Write-Host ("after_hex=" + [BitConverter]::ToString($raw2[0..([Math]::Min(5,$raw2.Length-1))]))
  Write-Host ("json=" + $json)

  Set-Content -Path (Join-Path $root "FORCE_UPDATE") -Value "20260807-153637" -Encoding Ascii -Force

  schtasks /End /TN StellaKioskAgent 2>$null | Out-Null
  Get-Process node -ErrorAction SilentlyContinue | Where-Object {
    try { $_.Path -like "*StellaKiosk*" } catch { $false }
  } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  schtasks /Run /TN StellaKioskAgent | Out-Null
  Start-Sleep -Seconds 4
  $h = Invoke-WebRequest -Uri "http://127.0.0.1:47821/health" -UseBasicParsing -TimeoutSec 5
  Write-Host ("health=" + $h.Content)
}
Remove-PSSession $s
Write-Host "HOTFIX_OK"
"""


def api(path, method="GET", body=None, token=None, timeout=120):
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read().decode()
            return res.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def health():
    try:
        with urllib.request.urlopen("http://itpc07.udhb.local:47821/health", timeout=5) as res:
            return json.loads(res.read().decode())
    except Exception as e:
        return {"error": str(e)}


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)

    sftp = c.open_sftp()
    with sftp.file("/tmp/itpc07_hotfix.ps1", "w") as f:
        f.write(PS1)
    sftp.close()

    print("=== hotfix BOM + restart ===", flush=True)
    _, stdout, stderr = c.exec_command(
        "cd /root/omskscrin && set -a && . ./.env && set +a && pwsh -NoProfile -File /tmp/itpc07_hotfix.ps1",
        timeout=120,
    )
    print((stdout.read() + stderr.read()).decode("utf-8", "replace").encode("ascii", "replace").decode())

    h = health()
    print("health after hotfix:", h, flush=True)

    # login + optional admin nudge
    env_out = ""
    _, o, _ = c.exec_command("grep -E '^(ADMIN_LOGIN|ADMIN_PASSWORD)=' /root/omskscrin/.env | tr -d '\\r'")
    env_out = o.read().decode()
    env = dict(line.split("=", 1) for line in env_out.splitlines() if "=" in line)
    st, auth = api(
        "/api/auth/login",
        "POST",
        {"login": env.get("ADMIN_LOGIN", "admin"), "password": env.get("ADMIN_PASSWORD", "")},
    )
    token = auth["token"]
    st, kiosks = api("/api/kiosks", token=token)
    k = next(x for x in kiosks if "itpc07" in x["hostname"].lower())
    print("trigger admin software-update", k["id"], flush=True)
    headers = {"Accept": "application/json", "Authorization": f"Bearer {token}"}
    req = urllib.request.Request(
        BASE + f"/api/kiosks/{k['id']}/software-update", data=None, headers=headers, method="POST"
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=120) as res:
        print(f"OTA status={res.status} elapsed={time.time()-t0:.1f}s")
        print(res.read().decode()[:800])

    print("=== poll ===", flush=True)
    for i in range(40):
        h = health()
        print(
            f"+{i*3:02d}s ver={h.get('softwareVersion')} inProgress={h.get('updateInProgress')} kioskId={h.get('kioskId')}",
            flush=True,
        )
        if h.get("softwareVersion") == TARGET:
            print("SUCCESS")
            break
        time.sleep(3)
    else:
        print("FAILED")

    c.close()


if __name__ == "__main__":
    main()
