"""Diagnose why images fail on patriotstela17."""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

import paramiko

HOST = "10.192.1.6"
PASSWORD = "Mazambi47!"
BASE = f"http://{HOST}:8080"
NAME = "patriotstela17"


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)
    _, o, _ = c.exec_command("grep -E '^(ADMIN_LOGIN|ADMIN_PASSWORD)=' /root/omskscrin/.env | tr -d '\\r'")
    env = dict(line.split("=", 1) for line in o.read().decode().splitlines() if "=" in line)

    def api(path, method="GET", body=None, token=None, timeout=60):
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

    _, auth = api("/api/auth/login", "POST", {"login": env["ADMIN_LOGIN"], "password": env["ADMIN_PASSWORD"]})
    token = auth["token"]
    _, ks = api("/api/kiosks", token=token)
    k = next((x for x in ks if NAME in str(x.get("hostname", "")).lower() or NAME in str(x.get("name", "")).lower()), None)
    if not k:
        print("NOT FOUND")
        for x in ks:
            print("-", x.get("hostname"), x.get("softwareVersion"), x.get("syncStatus"), x.get("syncMessage"))
        return
    print("kiosk", json.dumps({
        "hostname": k.get("hostname"),
        "id": k.get("id"),
        "online": k.get("online"),
        "softwareVersion": k.get("softwareVersion"),
        "contentVersion": k.get("contentVersion"),
        "syncStatus": k.get("syncStatus"),
        "syncMessage": k.get("syncMessage"),
        "probeStatus": k.get("probeStatus"),
        "probeMessage": k.get("probeMessage"),
        "exhibitTitle": k.get("exhibitTitle"),
        "healthPort": k.get("healthPort"),
        "uiPort": k.get("uiPort"),
        "lastSeenAt": k.get("lastSeenAt"),
    }, ensure_ascii=False, indent=2))

    host = k["hostname"]
    hp = int(k.get("healthPort") or 47821)
    try:
        with urllib.request.urlopen(f"http://{host}:{hp}/health", timeout=8) as res:
            h = json.loads(res.read().decode())
        print("health", json.dumps(h, ensure_ascii=False, indent=2))
    except Exception as e:
        print("health FAIL", e)
        h = {}

    kid = h.get("kioskId") or k.get("kioskId") or host
    st, man = api(f"/api/kiosks/{urllib.request.quote(str(kid))}/manifest")
    if st != 200:
        # try FQDN / admin id variants
        for alt in [host, k.get("kioskId"), "patriotstela17", "patriotstela17.udhb.local"]:
            if not alt:
                continue
            st, man = api(f"/api/kiosks/{urllib.request.quote(str(alt))}/manifest")
            print("manifest try", alt, st)
            if st == 200:
                break
    else:
        print("manifest", st)

    if isinstance(man, dict) and st == 200:
        files = man.get("files") or []
        print("manifest files", len(files), "exhibit", (man.get("exhibit") or {}).get("title"), "cv", man.get("contentVersion"))
        # probe first few file downloads
        for f in files[:5]:
            fid = f.get("id")
            url = f"{BASE}/api/files/{fid}/content"
            try:
                req = urllib.request.Request(url, method="GET")
                with urllib.request.urlopen(req, timeout=20) as res:
                    n = len(res.read(64 * 1024))
                    print(f"  file {fid[:12]}… {f.get('filename')} HTTP {res.status} read={n} size={f.get('size')}")
            except Exception as e:
                print(f"  file {fid[:12]}… FAIL {e}")
    else:
        print("manifest body", man)

    # WinRM: local cache + kiosk.json + recent agent/UI
    ps1 = r"""
$ErrorActionPreference = "Continue"
$u = $env:DEPLOY_USER
$p = $env:DEPLOY_PASSWORD
$sec = ConvertTo-SecureString $p -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($u, $sec)
$s = New-PSSession -ComputerName "patriotstela17.udhb.local" -Credential $cred -Authentication Negotiate
Invoke-Command -Session $s -ScriptBlock {
  $root = "C:\ProgramData\StellaKiosk"
  Write-Host "=== VERSION / kiosk.json ==="
  if (Test-Path "$root\VERSION") { Write-Host ("VERSION=" + (Get-Content "$root\VERSION" -Raw).Trim()) }
  if (Test-Path "$root\kiosk.json") {
    $b = [IO.File]::ReadAllBytes("$root\kiosk.json")
    Write-Host ("kiosk.json hex=" + [BitConverter]::ToString($b[0..([Math]::Min(5,$b.Length-1))]))
    Write-Host (Get-Content "$root\kiosk.json" -Raw)
  }
  Write-Host "=== media cache ==="
  $cache = @(
    (Join-Path $root "ui\cache"),
    (Join-Path $root "cache"),
    (Join-Path $env:LOCALAPPDATA "StellaKiosk"),
    (Join-Path $root "ui\media")
  )
  foreach ($d in $cache) {
    if (Test-Path $d) {
      $items = Get-ChildItem $d -Recurse -File -EA SilentlyContinue
      Write-Host ("CACHE " + $d + " files=" + @($items).Count + " bytes=" + (($items | Measure-Object Length -Sum).Sum))
    } else { Write-Host ("missing " + $d) }
  }
  Get-ChildItem $root -Directory -EA SilentlyContinue | ForEach-Object { Write-Host ("DIR " + $_.Name) }
  Write-Host "=== health ==="
  try { (Invoke-WebRequest http://127.0.0.1:47821/health -UseBasicParsing -TimeoutSec 5).Content } catch { Write-Host $_.Exception.Message }
  Write-Host "=== edge ==="
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -EA SilentlyContinue | Select-Object -First 3 | ForEach-Object {
    Write-Host ("edge pid=" + $_.ProcessId + " " + ($_.CommandLine.Substring(0,[Math]::Min(160,$_.CommandLine.Length))))
  }
}
Remove-PSSession $s
"""
    sftp = c.open_sftp()
    with sftp.file("/tmp/patriot_img_diag.ps1", "w") as f:
        f.write(ps1)
    sftp.close()
    _, o, e = c.exec_command(
        "cd /root/omskscrin && set -a && . ./.env && set +a && pwsh -NoProfile -File /tmp/patriot_img_diag.ps1",
        timeout=120,
    )
    out = (o.read() + e.read()).decode("utf-8", "replace")
    sys.stdout.write(out.encode("ascii", "replace").decode())
    c.close()


if __name__ == "__main__":
    # urllib.parse.quote
    import urllib.parse
    urllib.request.quote = urllib.parse.quote
    main()
