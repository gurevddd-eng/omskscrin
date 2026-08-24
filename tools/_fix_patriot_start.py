"""Start patriot via remote-start.ps1; poll sync."""
from __future__ import annotations

import json
import sys
import time
import urllib.request

import paramiko

HOST = "10.192.1.6"
PASSWORD = "Mazambi47!"


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)

    print("=== remote-start ===", flush=True)
    _, o, e = c.exec_command(
        "cd /root/omskscrin && set -a && . ./.env && set +a && "
        "pwsh -NoProfile -File apps/server/scripts/remote-start.ps1 "
        "-Hostname patriotstela17.udhb.local "
        "-DeployUser $env:DEPLOY_USER -DeployPassword $env:DEPLOY_PASSWORD",
        timeout=180,
    )
    out = (o.read() + e.read()).decode("utf-8", "replace")
    sys.stdout.write(out.encode("ascii", "replace").decode())
    sys.stdout.flush()

    print("\n=== poll ===", flush=True)
    for i in range(24):
        try:
            with urllib.request.urlopen("http://patriotstela17.udhb.local:47821/health", timeout=8) as res:
                h = json.loads(res.read().decode())
        except Exception as ex:
            h = {"error": str(ex)}
        print(
            f"+{i*5:02d}s sync={h.get('syncStatus')} msg={h.get('syncMessage')} err={str(h.get('error',''))[:50]}",
            flush=True,
        )
        if h.get("syncStatus") == "ok" and "backing" not in str(h.get("syncMessage") or "").lower():
            print("SYNC_OK")
            break
        time.sleep(5)
    c.close()


if __name__ == "__main__":
    main()
