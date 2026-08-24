import paramiko
import json
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "10.192.1.6"
USER = "root"
PASSWORD = "Mazambi47!"
REMOTE = "/root/omskscrin"

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)


def run(cmd: str, timeout: int = 60) -> str:
    _, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    return (out + (("\nERR:\n" + err) if err.strip() else "")).strip()


print("=== files ===")
print(
    run(
        "ls -la "
        f"{REMOTE}/apps/server/dist/remoteSoftwareUpdate.js "
        f"{REMOTE}/apps/server/dist/softwareUpdatePending.js "
        f"{REMOTE}/apps/server/scripts/remote-force-update.ps1 "
        f"{REMOTE}/data/deploy/current/update.zip "
        f"{REMOTE}/data/deploy/current/version.json 2>&1"
    )
)

print("\n=== route in dist ===")
print(run(f"grep -n 'software-update' {REMOTE}/apps/server/dist/routes/kiosks.js | head -20"))

print("\n=== admin bundle has button? ===")
print(run(f"grep -o 'software-update' {REMOTE}/apps/admin/dist/assets/*.js | wc -l"))
print(run(f"grep -o 'Обновить ПО' {REMOTE}/apps/admin/dist/assets/*.js | wc -l"))

print("\n=== version ===")
print(run(f"cat {REMOTE}/data/deploy/current/version.json"))

print("\n=== kiosk versions sample ===")
print(
    run(
        f"cd {REMOTE}/apps/server && node --input-type=module -e \""
        "import { PrismaClient } from '@prisma/client';"
        "const p=new PrismaClient();"
        "const rows=await p.kiosk.findMany({select:{id:true,hostname:true,softwareVersion:true,lastSeenAt:true},orderBy:{name:'asc'}});"
        "console.log(JSON.stringify(rows,null,2));"
        "await p.\\$disconnect();\""
    )
)

print("\n=== recent software-update requests ===")
print(run("pm2 logs omskscrin --lines 200 --nostream 2>&1 | grep -i 'software-update\\|FORCE_\\|remoteSoftware' | tail -30"))

c.close()
