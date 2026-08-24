"""One-shot: upload local data/deploy/current OTA pack to Debian server."""
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


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 90) -> str:
    print(f"\n>>> {cmd[:160]}")
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


def main() -> None:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        HOST, username=USER, password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False
    )
    sftp = client.open_sftp()
    ensure_dir(sftp, f"{REMOTE}/data/deploy/current")
    for name in ["update.zip", "package.zip", "version.json", "VERSION", "agent.mjs"]:
        lp = LOCAL / "data/deploy/current" / name
        if not lp.exists():
            print(f"SKIP missing {name}")
            continue
        print(f"put {name} ({lp.stat().st_size} bytes)")
        sftp.put(str(lp), f"{REMOTE}/data/deploy/current/{name}")
    sftp.close()

    run(
        client,
        "python3 - <<'PY'\n"
        "from pathlib import Path\n"
        "p = Path('/root/omskscrin/data/deploy/current')\n"
        "for name in ('version.json', 'VERSION'):\n"
        "    b = (p / name).read_bytes()\n"
        "    if b.startswith(b'\\xef\\xbb\\xbf'):\n"
        "        (p / name).write_bytes(b[3:])\n"
        "        print('stripped', name)\n"
        "    else:\n"
        "        print('ok', name)\n"
        "print((p / 'version.json').read_text())\n"
        "PY",
    )
    run(client, "curl -s http://127.0.0.1:8080/api/deploy/meta; echo")
    print("\nDONE")
    client.close()


if __name__ == "__main__":
    main()
