"""Admin OTA itpc07 → 155811 (post BOM fix verification)."""
from __future__ import annotations

import json
import sys
import time
import urllib.request

import paramiko

HOST = "10.192.1.6"
PASSWORD = "Mazambi47!"
BASE = f"http://{HOST}:8080"
TARGET = "20260807-160614"


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)
    _, o, _ = c.exec_command("grep -E '^(ADMIN_LOGIN|ADMIN_PASSWORD)=' /root/omskscrin/.env | tr -d '\\r'")
    env = dict(line.split("=", 1) for line in o.read().decode().splitlines() if "=" in line)
    c.close()

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

    st, auth = api("/api/auth/login", "POST", {"login": env["ADMIN_LOGIN"], "password": env["ADMIN_PASSWORD"]})
    token = auth["token"]
    st, kiosks = api("/api/kiosks", token=token)
    k = next(x for x in kiosks if "itpc07" in x["hostname"].lower())
    print("before", k.get("softwareVersion"), "kioskId", k.get("kioskId"))

    headers = {"Accept": "application/json", "Authorization": f"Bearer {token}"}
    req = urllib.request.Request(
        BASE + f"/api/kiosks/{k['id']}/software-update", data=None, headers=headers, method="POST"
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=120) as res:
        body = res.read().decode()
        print(f"OTA {res.status} in {time.time()-t0:.1f}s")
        print(body[:600])

    for i in range(30):
        with urllib.request.urlopen("http://itpc07.udhb.local:47821/health", timeout=5) as res:
            h = json.loads(res.read().decode())
        print(f"+{i*3:02d}s ver={h.get('softwareVersion')} inProgress={h.get('updateInProgress')} id={h.get('kioskId')}")
        if h.get("softwareVersion") == TARGET:
            print("SUCCESS")
            return
        time.sleep(3)
    print("TIMEOUT")


if __name__ == "__main__":
    main()
