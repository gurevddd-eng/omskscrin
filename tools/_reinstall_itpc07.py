"""Reinstall Stella Kiosk on itpc07 only (repair missing scheduled tasks)."""
import re
import sys
import time

import paramiko

HOST = "10.192.1.6"
USER = "root"
PASSWORD = "Mazambi47!"


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
    transport = client.get_transport()
    if transport:
        transport.set_keepalive(30)

    install = r"""
set -a
. /root/omskscrin/.env
set +a
cd /root/omskscrin
PUB="${SERVER_PUBLIC_URL:-http://10.192.1.6}"
pwsh -NoProfile -File apps/server/scripts/remote-install.ps1 \
  -Hostname itpc07.udhb.local \
  -ServerUrl "$PUB" \
  -PackageDir "$PWD/data/deploy/current" \
  -DeployUser "$DEPLOY_USER" \
  -DeployPassword "$DEPLOY_PASSWORD"
"""
    run(client, install, timeout=900)

    start = r"""
set -a
. /root/omskscrin/.env
set +a
cd /root/omskscrin/apps/server
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/remote-start.ps1 \
  -Hostname itpc07.udhb.local \
  -DeployUser "$DEPLOY_USER" \
  -DeployPassword "$DEPLOY_PASSWORD"
"""
    run(client, start, timeout=90)
    client.close()
    print("\nDONE")


if __name__ == "__main__":
    main()
