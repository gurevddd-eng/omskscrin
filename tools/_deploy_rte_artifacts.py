"""Upload prebuilt admin dist + kiosk OTA package (server has no npm registry)."""
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


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 120) -> str:
    print(f"\n>>> {cmd[:140]}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
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
            raise SystemExit("timeout")
        time.sleep(0.2)
    out = "".join(chunks)
    clean = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", out)
    sys.stdout.write(clean.encode("ascii", "replace").decode())
    sys.stdout.flush()
    code = chan.recv_exit_status()
    if code != 0:
        raise SystemExit(f"exit {code}")
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
    for root, dirs, files in os.walk(local):
        rel = Path(root).relative_to(local).as_posix()
        rdir = remote if rel == "." else f"{remote}/{rel}"
        ensure_dir(sftp, rdir)
        for name in files:
            lp = Path(root) / name
            rp = f"{rdir}/{name}"
            sftp.put(str(lp), rp)
            n += 1
    return n


def main() -> None:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()

    # Wipe old admin assets then upload new dist
    run(client, f"rm -rf {REMOTE}/apps/admin/dist && mkdir -p {REMOTE}/apps/admin/dist")
    n = put_tree(sftp, LOCAL / "apps/admin/dist", f"{REMOTE}/apps/admin/dist")
    print(f"admin dist files: {n}")

    # Source for future reference
    for rel in [
        "apps/admin/src/components/RichTextEditor.tsx",
        "apps/admin/src/pages/ExhibitsPage.tsx",
        "apps/admin/src/styles.css",
        "apps/admin/package.json",
        "apps/kiosk/src/App.tsx",
        "apps/kiosk/src/styles.css",
        "apps/kiosk/src/sanitizeHtml.ts",
        "apps/kiosk/package.json",
    ]:
        lp = LOCAL / rel
        rp = f"{REMOTE}/{rel.replace(chr(92), '/')}"
        parent = "/".join(rp.split("/")[:-1])
        ensure_dir(sftp, parent)
        sftp.put(str(lp), rp)
        print(f"put {rel}")

    ensure_dir(sftp, f"{REMOTE}/data/deploy/current")
    for name in ["update.zip", "package.zip", "version.json", "VERSION", "agent.mjs"]:
        lp = LOCAL / "data/deploy/current" / name
        if lp.exists():
            print(f"put deploy/{name}")
            sftp.put(str(lp), f"{REMOTE}/data/deploy/current/{name}")

    # Also sync ui folder if present in deploy current
    ui = LOCAL / "data/deploy/current" / "ui"
    if ui.is_dir():
        n = put_tree(sftp, ui, f"{REMOTE}/data/deploy/current/ui")
        print(f"deploy ui files: {n}")

    sftp.close()
    run(client, "pm2 restart omskscrin && sleep 2 && curl -s http://127.0.0.1:8080/api/health; echo")
    run(client, f"cd {REMOTE} && cat data/deploy/current/version.json; echo")
    print("DONE")
    client.close()


if __name__ == "__main__":
    main()
