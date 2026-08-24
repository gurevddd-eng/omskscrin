"""Deploy chronicle + Start UI fixes to server (no kiosk reinstall)."""
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
    "apps/kiosk/src/App.tsx",
    "apps/kiosk/src/styles.css",
    "apps/kiosk/scripts/kiosk-agent.mjs",
    "apps/server/scripts/remote-start.ps1",
    "apps/server/src/remoteStart.ts",
]


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 900) -> str:
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
            raise SystemExit(f"timed out after {timeout}s")
        time.sleep(0.2)
    out = "".join(chunks)
    clean = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", out)
    sys.stdout.write(clean.encode("ascii", "replace").decode())
    sys.stdout.flush()
    code = chan.recv_exit_status()
    if code != 0:
        raise SystemExit(f"remote exit {code}")
    return clean


def main() -> None:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()
    for rel in FILES:
        print(f"put {rel}")
        sftp.put(str(LOCAL / rel), f"{REMOTE}/{rel}")
    sftp.close()

    run(client, f"cd {REMOTE} && pnpm --filter @stella/server build", timeout=180)
    run(client, f"cd {REMOTE} && pnpm pack:kiosk-deploy", timeout=700)
    run(client, "pm2 restart omskscrin && sleep 2 && curl -s http://127.0.0.1:8080/api/health; echo")
    run(client, f"cd {REMOTE} && cat data/deploy/current/version.json; echo")
    print("\nskip kiosk reinstall (server-only)")
    print("DONE")
    client.close()


if __name__ == "__main__":
    main()
