"""Deploy immediate content push (SSE) + kiosk OTA package."""
import json
import os
import re
import sys
import time
from pathlib import Path

import paramiko

HOST = "10.192.1.6"
USER = "root"
PASSWORD = "Mazambi47!"
REMOTE = "/root/omskscrin"
LOCAL = Path(r"C:\Users\dvgurev\Desktop\stella-udhb")

SRC = [
    "apps/server/src/contentHub.ts",
    "apps/server/src/routes/exhibits.ts",
    "apps/server/src/routes/ads.ts",
    "apps/server/src/routes/timeline.ts",
    "apps/server/src/routes/settings.ts",
    "apps/server/src/routes/kiosks.ts",
    "apps/server/src/networkSettings.ts",
    "apps/kiosk/src/App.tsx",
    "apps/kiosk/src/sync.ts",
]


def run(client, cmd, timeout=300):
    print(f"\n>>> {cmd[:140]}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    chan = stdout.channel
    chan.settimeout(timeout)
    chunks = []
    deadline = time.time() + timeout
    while True:
        if chan.recv_ready():
            chunks.append(chan.recv(65536).decode("utf-8", "replace"))
        if chan.recv_stderr_ready():
            chunks.append(chan.recv_stderr(65536).decode("utf-8", "replace"))
        if chan.exit_status_ready() and not chan.recv_ready() and not chan.recv_stderr_ready():
            break
        if time.time() > deadline:
            raise SystemExit("timeout")
        time.sleep(0.2)
    out = "".join(chunks)
    sys.stdout.write(re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", out).encode("ascii", "replace").decode())
    sys.stdout.flush()
    code = chan.recv_exit_status()
    if code != 0:
        raise SystemExit(f"exit {code}")


def ensure(sftp, remote_dir):
    parts = remote_dir.strip("/").split("/")
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            sftp.stat(cur)
        except OSError:
            sftp.mkdir(cur)


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()
    for rel in SRC:
        lp = LOCAL / rel
        rp = f"{REMOTE}/{rel}"
        ensure(sftp, "/".join(rp.split("/")[:-1]))
        print(f"put {rel}")
        sftp.put(str(lp), rp)

    ensure(sftp, f"{REMOTE}/data/deploy/current")
    for name in ["update.zip", "package.zip", "version.json", "VERSION", "agent.mjs"]:
        lp = LOCAL / "data/deploy/current" / name
        if lp.exists():
            print(f"put deploy/{name}")
            sftp.put(str(lp), f"{REMOTE}/data/deploy/current/{name}")
    vj = LOCAL / "data/deploy/current" / "version.json"
    if vj.exists():
        data = json.loads(vj.read_text(encoding="utf-8-sig"))
        with sftp.file(f"{REMOTE}/data/deploy/current/version.json", "w") as f:
            f.write(json.dumps(data, ensure_ascii=False))

    ui = LOCAL / "data/deploy/current" / "ui"
    if ui.is_dir():
        for root, dirs, files in os.walk(ui):
            rel = Path(root).relative_to(ui).as_posix()
            rdir = f"{REMOTE}/data/deploy/current/ui" if rel == "." else f"{REMOTE}/data/deploy/current/ui/{rel}"
            ensure(sftp, rdir)
            for name in files:
                sftp.put(str(Path(root) / name), f"{rdir}/{name}")
        print("ui synced")
    sftp.close()

    run(client, f"cd {REMOTE} && pnpm --filter @stella/server build", timeout=180)
    run(client, "pm2 restart omskscrin && sleep 2 && curl -s http://127.0.0.1:8080/api/health; echo")
    run(client, f"cd {REMOTE} && cat data/deploy/current/version.json; echo")
    print("DONE")
    client.close()


if __name__ == "__main__":
    main()
