"""Deploy local tree to omskekran via SFTP (no GitHub from server), then build/pack/reinstall."""
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

# Paths relative to repo root to sync
SYNC_PATHS = [
    "apps/kiosk",
    "apps/admin/src",
    "apps/admin/index.html",
    "apps/admin/package.json",
    "apps/admin/tsconfig.json",
    "apps/admin/tsconfig.app.json",
    "apps/admin/tsconfig.node.json",
    "apps/admin/vite.config.ts",
    "apps/server/src",
    "apps/server/scripts",
    "apps/server/prisma",
    "apps/server/package.json",
    "apps/server/tsconfig.json",
    "packages/shared",
    "scripts",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "ecosystem.config.cjs",
]

SKIP_DIR_NAMES = {
    "node_modules",
    "dist",
    "target",
    ".git",
    "data",
    "tools",
    "src-tauri",
}


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 900) -> str:
    print(f"\n>>> {cmd[:140]}{'...' if len(cmd) > 140 else ''}")
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
            raise SystemExit(f"remote command timed out after {timeout}s")
        time.sleep(0.2)
    code = chan.recv_exit_status()
    out = "".join(chunks)
    clean = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", out)
    sys.stdout.write(clean.encode("ascii", "replace").decode())
    sys.stdout.flush()
    if code != 0:
        raise SystemExit(f"remote command failed with exit {code}")
    return clean


def ensure_remote_dir(sftp: paramiko.SFTPClient, remote_dir: str) -> None:
    parts = remote_dir.strip("/").split("/")
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)


def should_skip(path: Path) -> bool:
    return any(part in SKIP_DIR_NAMES for part in path.parts)


def upload_file(sftp: paramiko.SFTPClient, local: Path, remote: str) -> None:
    ensure_remote_dir(sftp, str(Path(remote).parent).replace("\\", "/"))
    sftp.put(str(local), remote)


def upload_path(sftp: paramiko.SFTPClient, rel: str) -> int:
    local = LOCAL / rel
    count = 0
    if not local.exists():
        print(f"skip missing {rel}")
        return 0
    if local.is_file():
        remote = f"{REMOTE}/{rel.replace(chr(92), '/')}"
        upload_file(sftp, local, remote)
        print(f"put {rel}")
        return 1
    for root, dirs, files in os.walk(local):
        root_path = Path(root)
        # prune skipped dirs in-place
        dirs[:] = [d for d in dirs if d not in SKIP_DIR_NAMES]
        for name in files:
            lp = root_path / name
            if should_skip(lp.relative_to(LOCAL)):
                continue
            rel_file = lp.relative_to(LOCAL).as_posix()
            remote = f"{REMOTE}/{rel_file}"
            upload_file(sftp, lp, remote)
            count += 1
    print(f"synced {rel} ({count} files)")
    return count


def main() -> None:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)
    transport = client.get_transport()
    if transport:
        transport.set_keepalive(30)

    sftp = client.open_sftp()
    total = 0
    for rel in SYNC_PATHS:
        total += upload_path(sftp, rel)
    sftp.close()
    print(f"\nuploaded {total} files")

    run(client, f"cd {REMOTE} && pnpm install", timeout=400)
    run(client, f"cd {REMOTE} && pnpm --filter @stella/server exec prisma generate", timeout=120)
    run(
        client,
        f"cd {REMOTE} && set -a && . ./.env && set +a && "
        "pnpm --filter @stella/server exec prisma migrate deploy",
        timeout=120,
    )
    run(client, f"cd {REMOTE} && pnpm build:prod", timeout=400)
    run(client, f"cd {REMOTE} && pnpm pack:kiosk-deploy", timeout=700)
    run(client, "pm2 restart omskscrin && sleep 2 && curl -s http://127.0.0.1:8080/api/health; echo", timeout=60)
    run(
        client,
        f"cd {REMOTE} && cat data/deploy/current/version.json; echo; "
        "ls -lh data/deploy/current/update.zip data/deploy/current/package.zip",
        timeout=30,
    )

    # Kiosk reinstall skipped — server package/OTA only
    print("\nskip kiosk reinstall (server-only deploy)")

    client.close()
    print("\nDONE")


if __name__ == "__main__":
    main()
