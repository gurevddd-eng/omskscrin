"""Push remote-start fix to server, rebuild, smoke-test itpc07 Start UI."""
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
FILES = [
    "apps/server/scripts/remote-start.ps1",
    "apps/server/src/remoteStart.ts",
]


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 300) -> str:
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
    code = chan.recv_exit_status()
    out = "".join(chunks)
    clean = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", out)
    sys.stdout.write(clean.encode("ascii", "replace").decode())
    sys.stdout.flush()
    if code != 0:
        raise SystemExit(f"exit {code}")
    return clean


def main() -> None:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        HOST,
        username=USER,
        password=PASSWORD,
        timeout=20,
        allow_agent=False,
        look_for_keys=False,
    )
    sftp = client.open_sftp()
    for rel in FILES:
        lp = LOCAL / rel
        rp = f"{REMOTE}/{rel.replace(chr(92), '/')}"
        print(f"put {rel}")
        sftp.put(str(lp), rp)
    sftp.close()

    run(client, f"cd {REMOTE} && pnpm --filter @stella/server build", timeout=180)
    run(client, "pm2 restart omskscrin && sleep 2 && curl -s http://127.0.0.1:8080/api/health; echo")

    smoke = r"""
set -a
. /root/omskscrin/.env
set +a
cd /root/omskscrin/apps/server
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/remote-start.ps1 \
  -Hostname itpc07.udhb.local \
  -DeployUser "$DEPLOY_USER" \
  -DeployPassword "$DEPLOY_PASSWORD"
"""
    run(client, smoke, timeout=90)
    client.close()
    print("DONE")


if __name__ == "__main__":
    main()
