"""Deploy BOM fixes: PS1 writers, server dist (kiosk lookup), kiosk update.zip."""
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
    "apps/server/scripts/remote-push-config.ps1",
    "apps/server/scripts/remote-install.ps1",
    "apps/server/scripts/kiosk-local.ps1",
    "apps/server/src/routes/kiosks.ts",
    "apps/kiosk/scripts/kiosk-agent.mjs",
]


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 180) -> str:
    print(f"\n>>> {cmd[:160]}", flush=True)
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    chan = stdout.channel
    chan.settimeout(timeout)
    chunks: list[str] = []
    deadline = time.time() + timeout
    while True:
        if chan.recv_ready():
            chunks.append(chan.recv(65536).decode("utf-8", "replace"))
        if chan.recv_stderr_ready():
            chunks.append(chan.recv_stderr(65536).decode("utf-8", "replace"))
        if chan.exit_status_ready() and not chan.recv_ready() and not chan.recv_stderr_ready():
            break
        if time.time() > deadline:
            raise SystemExit("timed out")
        time.sleep(0.15)
    out = "".join(chunks)
    clean = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", out)
    sys.stdout.write(clean)
    sys.stdout.flush()
    code = chan.recv_exit_status()
    if code != 0:
        raise SystemExit(f"remote exit {code}")
    return clean


def ensure_dir(sftp, remote_dir: str) -> None:
    parts = remote_dir.strip("/").split("/")
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            sftp.stat(cur)
        except OSError:
            sftp.mkdir(cur)


def put_tree(sftp, local: Path, remote: str) -> int:
    n = 0
    for root, _dirs, files in os.walk(local):
        rel = Path(root).relative_to(local).as_posix()
        rdir = remote if rel == "." else f"{remote}/{rel}"
        ensure_dir(sftp, rdir)
        for name in files:
            sftp.put(str(Path(root) / name), f"{rdir}/{name}")
            n += 1
    return n


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()

    for rel in SRC:
        lp = LOCAL / rel
        rp = f"{REMOTE}/{rel.replace(chr(92), '/')}"
        ensure_dir(sftp, "/".join(rp.split("/")[:-1]))
        sftp.put(str(lp), rp)
        print(f"put {rel}")

    run(client, f"rm -rf {REMOTE}/apps/server/dist && mkdir -p {REMOTE}/apps/server/dist")
    print("server dist", put_tree(sftp, LOCAL / "apps/server/dist", f"{REMOTE}/apps/server/dist"))

    ensure_dir(sftp, f"{REMOTE}/data/deploy/current")
    for name in ["update.zip", "package.zip", "version.json", "VERSION", "agent.mjs"]:
        lp = LOCAL / "data/deploy/current" / name
        if lp.exists():
            sftp.put(str(lp), f"{REMOTE}/data/deploy/current/{name}")
            print(f"put deploy/{name} ({lp.stat().st_size} bytes)")

    sftp.close()
    run(client, "pm2 restart omskscrin && sleep 2 && curl -s http://127.0.0.1:8080/api/deploy/meta; echo")
    print("\nDONE")
    client.close()


if __name__ == "__main__":
    main()
