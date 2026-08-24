"""Force OTA itpc07 to latest package; unstick agent if needed."""
from __future__ import annotations

import json
import sys
import time
import urllib.request

import paramiko

HOST = "10.192.1.6"
PASSWORD = "Mazambi47!"
BASE = f"http://{HOST}:8080"
TARGET = "20260807-163635"
KID = "cmsip21ue0001s88t8pbv9z5v"


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)
    _, o, _ = c.exec_command("grep -E '^(ADMIN_LOGIN|ADMIN_PASSWORD)=' /root/omskscrin/.env | tr -d '\\r'")
    env = dict(line.split("=", 1) for line in o.read().decode().splitlines() if "=" in line)

    def api(path, method="GET", body=None, token=None, timeout=120):
        data = None
        headers = {"Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read().decode()
            return res.status, json.loads(raw) if raw else None

    _, auth = api("/api/auth/login", "POST", {"login": env["ADMIN_LOGIN"], "password": env["ADMIN_PASSWORD"]})
    token = auth["token"]
    _, ks = api("/api/kiosks", token=token)
    print("kiosks", len(ks) if isinstance(ks, list) else ks)
    if isinstance(ks, list):
        for x in ks:
            if "itpc07" in str(x.get("hostname", "")).lower() or x.get("id") == KID:
                print("hit", x.get("hostname"), x.get("softwareVersion"), x.get("id"))

    # Unstick: restart agent via WinRM force script (writes FORCE + restarts if needed)
    print("force via remote script...")
    _, o, e = c.exec_command(
        "cd /root/omskscrin && set -a && . ./.env && set +a && "
        f"pwsh -NoProfile -File apps/server/scripts/remote-force-update.ps1 "
        f"-Hostname itpc07.udhb.local -TargetVersion {TARGET} "
        "-DeployUser $env:DEPLOY_USER -DeployPassword $env:DEPLOY_PASSWORD",
        timeout=90,
    )
    print(o.read().decode("utf-8", "replace")[-600:])
    print(e.read().decode("utf-8", "replace")[-300:])

    headers = {"Accept": "application/json", "Authorization": f"Bearer {token}"}
    req = urllib.request.Request(BASE + f"/api/kiosks/{KID}/software-update", data=None, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            print("OTA", res.status, res.read().decode()[:400])
    except Exception as ex:
        print("OTA err", ex)

    for i in range(40):
        try:
            with urllib.request.urlopen("http://itpc07.udhb.local:47821/health", timeout=5) as res:
                h = json.loads(res.read().decode())
        except Exception as ex:
            h = {"error": str(ex)}
        print(f"+{i*3:02d}s ver={h.get('softwareVersion')} prog={h.get('updateInProgress')} err={str(h.get('error',''))[:40]}")
        if h.get("softwareVersion") == TARGET and not h.get("updateInProgress"):
            print("SUCCESS")
            break
        time.sleep(3)
    else:
        print("TIMEOUT")
    c.close()


if __name__ == "__main__":
    main()
