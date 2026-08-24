"""Verify admin OTA path on itpc07: trigger + WinRM agent state + poll."""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import paramiko

HOST = "10.192.1.6"
USER = "root"
PASSWORD = "Mazambi47!"
REMOTE = "/root/omskscrin"
BASE = f"http://{HOST}:8080"
TARGET_HOST = "itpc07.udhb.local"


def ssh_connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)
    t = c.get_transport()
    if t:
        t.set_keepalive(30)
    return c


def run(client, cmd: str, timeout: int = 180) -> str:
    print(f"\n=== {cmd[:140].replace(chr(10), ' ')} ===", flush=True)
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
            print("TIMEOUT", flush=True)
            break
        time.sleep(0.2)
    out = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", "".join(chunks))
    sys.stdout.write(out.encode("ascii", "replace").decode())
    sys.stdout.flush()
    return out


def api(path: str, method: str = "GET", body=None, token=None, timeout=120):
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


def health(hostname: str, port: int):
    try:
        with urllib.request.urlopen(f"http://{hostname}:{port}/health", timeout=5) as res:
            return res.status, json.loads(res.read().decode())
    except Exception as e:
        return 0, {"error": str(e)}


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    client = ssh_connect()

    # admin password from server .env
    env_out = run(client, f"grep -E '^(ADMIN_LOGIN|ADMIN_PASSWORD)=' {REMOTE}/.env | tr -d '\\r'")
    env = {}
    for line in env_out.splitlines():
        if "=" in line and not line.startswith("="):
            k, _, v = line.partition("=")
            if k.strip() in ("ADMIN_LOGIN", "ADMIN_PASSWORD"):
                env[k.strip()] = v.strip().strip('"')
    login = env.get("ADMIN_LOGIN", "admin")
    password = env.get("ADMIN_PASSWORD", "admin")
    print(f"\nUsing admin login={login!r}", flush=True)

    st, auth = api("/api/auth/login", "POST", {"login": login, "password": password})
    print("login", st)
    if st != 200 or not isinstance(auth, dict) or "token" not in auth:
        print("AUTH FAIL", auth)
        return
    token = auth["token"]

    st, meta = api("/api/deploy/meta")
    target = meta["softwareVersion"]
    print("server package", target, "zip", bool(meta.get("updateZipPath") or meta.get("packageZipPath")))

    st, kiosks = api("/api/kiosks", token=token)
    k = next((x for x in kiosks if "itpc07" in x["hostname"].lower()), None)
    if not k:
        print("itpc07 not found")
        return
    kid = k["id"]
    hp = int(k.get("healthPort") or 47821)
    print(
        "kiosk",
        k["hostname"],
        "id",
        kid,
        "dbVer",
        k.get("softwareVersion"),
        "online",
        k.get("online"),
        "healthy",
        k.get("healthy"),
    )

    st, h = health(k["hostname"], hp)
    print("health before", st, h)

    # updates endpoint as agent would see
    kiosk_id = (h or {}).get("kioskId") or "itpc07"
    agent_ver = (h or {}).get("softwareVersion") or "?"
    st, upd = api(
        f"/api/kiosks/{urllib.parse.quote(kiosk_id)}/updates?softwareVersion={urllib.parse.quote(str(agent_ver))}"
    )
    print("updates as agent", st, upd)

    # Trigger like admin UI: POST without body (no Content-Type)
    print("\n=== POST /software-update (admin-like) ===", flush=True)
    headers = {"Accept": "application/json", "Authorization": f"Bearer {token}"}
    req = urllib.request.Request(
        BASE + f"/api/kiosks/{kid}/software-update", data=None, headers=headers, method="POST"
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            raw = res.read().decode()
            print(f"status={res.status} elapsed={time.time()-t0:.1f}s")
            print(raw[:2500])
            upd_res = json.loads(raw)
    except urllib.error.HTTPError as e:
        print(f"status={e.code} elapsed={time.time()-t0:.1f}s")
        print(e.read().decode()[:2500])
        upd_res = None

    # WinRM inspect agent state
    run(
        client,
        r"""
cd /root/omskscrin
set -a; . ./.env; set +a
pwsh -NoProfile -Command '
$ErrorActionPreference = "Continue"
$u = $env:DEPLOY_USER
$p = $env:DEPLOY_PASSWORD
$sec = ConvertTo-SecureString $p -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($u, $sec)
$cn = "itpc07.udhb.local"
$s = New-PSSession -ComputerName $cn -Credential $cred -Authentication Negotiate
Write-Host "SESSION_OK"
Invoke-Command -Session $s -ScriptBlock {
  $root = "C:\ProgramData\StellaKiosk"
  Write-Host "=== FILES ==="
  Get-ChildItem $root -Force -ErrorAction SilentlyContinue |
    Select-Object Name, Length, LastWriteTime |
    Format-Table -AutoSize | Out-String | Write-Host
  Write-Host "=== VERSION ==="
  if (Test-Path "$root\VERSION") { Write-Host ("VERSION: " + (Get-Content "$root\VERSION" -Raw).Trim()) }
  if (Test-Path "$root\version.json") { Get-Content "$root\version.json" -Raw | Write-Host }
  Write-Host "=== FLAGS ==="
  foreach ($f in @("FORCE_UPDATE","LAUNCH_UI","STOPPED","SOFTWARE_DISABLED","UPDATE_IN_PROGRESS")) {
    $p = Join-Path $root $f
    if (Test-Path $p) { Write-Host "$f = [$((Get-Content $p -Raw).Trim())]" }
    else { Write-Host "$f = (missing)" }
  }
  Write-Host "=== kiosk.json ==="
  if (Test-Path "$root\kiosk.json") { Get-Content "$root\kiosk.json" -Raw | Write-Host }
  Write-Host "=== AGENT CAPABILITIES ==="
  if (Test-Path "$root\agent.mjs") {
    Write-Host ("agent.mjs size: " + (Get-Item "$root\agent.mjs").Length)
    Write-Host ("FORCE_UPDATE: " + (Select-String -Path "$root\agent.mjs" -Pattern "FORCE_UPDATE" -SimpleMatch -Quiet))
    Write-Host ("force-update route: " + (Select-String -Path "$root\agent.mjs" -Pattern "/force-update" -SimpleMatch -Quiet))
    Write-Host ("applySoftwareUpdate: " + (Select-String -Path "$root\agent.mjs" -Pattern "applySoftwareUpdate" -SimpleMatch -Quiet))
  }
  Write-Host "=== HEALTH LOCAL ==="
  try {
    $h = Invoke-WebRequest -Uri "http://127.0.0.1:47821/health" -UseBasicParsing -TimeoutSec 5
    Write-Host $h.Content
  } catch { Write-Host ("health fail: " + $_.Exception.Message) }
  Write-Host "=== force-update LOCAL ==="
  try {
    $body = "{`"softwareVersion`":`"PROBE`"}"
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:47821/force-update" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing -TimeoutSec 5
    Write-Host ("force-update: " + $r.StatusCode + " " + $r.Content)
  } catch { Write-Host ("force-update fail: " + $_.Exception.Message) }
  Write-Host "=== agent.log tail ==="
  if (Test-Path "$root\agent.log") { Get-Content "$root\agent.log" -Tail 50 | ForEach-Object { Write-Host $_ } }
  elseif (Test-Path "$root\logs\agent.log") { Get-Content "$root\logs\agent.log" -Tail 50 | ForEach-Object { Write-Host $_ } }
  else { Write-Host "no agent.log" }
  Write-Host "=== NODE AGENT ==="
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
    if ($_.CommandLine -like "*agent*") {
      Write-Host ("PID=" + $_.ProcessId + " CMD=" + $_.CommandLine.Substring(0,[Math]::Min(220,$_.CommandLine.Length)))
    }
  }
}
Remove-PSSession $s
'
""",
        timeout=120,
    )

    print("\n=== poll health 90s ===", flush=True)
    for i in range(30):
        st, h2 = health(k["hostname"], hp)
        sw = (h2 or {}).get("softwareVersion") if isinstance(h2, dict) else None
        prog = (h2 or {}).get("updateInProgress") if isinstance(h2, dict) else None
        print(f"+{i*3:02d}s agent={sw} inProgress={prog}", flush=True)
        if sw == target:
            print("SUCCESS — agent reached", target)
            break
        time.sleep(3)
    else:
        print("TIMEOUT — agent still not on", target)

    # final DB state
    st, kiosks2 = api("/api/kiosks", token=token)
    k2 = next(x for x in kiosks2 if x["id"] == kid)
    print("db after", k2.get("softwareVersion"), "pending?", k2.get("softwareUpdatePending"))

    client.close()


if __name__ == "__main__":
    main()
