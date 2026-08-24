"""List kiosks via psql on omskekran."""
import re
import sys
import time

import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("10.192.1.6", username="root", password="Mazambi47!", timeout=20, allow_agent=False, look_for_keys=False)


def run(cmd, timeout=60):
    print(f"\n=== {cmd[:120]} ===")
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    chan = stdout.channel
    chan.settimeout(timeout)
    chunks = []
    end = time.time() + timeout
    while True:
        if chan.recv_ready():
            chunks.append(chan.recv(65536).decode("utf-8", "replace"))
        if chan.recv_stderr_ready():
            chunks.append(chan.recv_stderr(65536).decode("utf-8", "replace"))
        if chan.exit_status_ready() and not chan.recv_ready() and not chan.recv_stderr_ready():
            break
        if time.time() > end:
            break
        time.sleep(0.1)
    out = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", "".join(chunks))
    sys.stdout.write(out.encode("ascii", "replace").decode())
    sys.stdout.flush()
    return out


# Pull DATABASE_URL and query
run(
    r"""
cd /root/omskscrin
set -a; . ./.env; set +a
# strip quotes if any
URL="$DATABASE_URL"
psql "$URL" -c "SELECT hostname, \"kioskId\", name, \"probeStatus\", \"installStatus\", \"lastSeenAt\" FROM \"Kiosk\" ORDER BY hostname;"
"""
)

# Also try from server package cwd
run(
    r"""
cd /root/omskscrin/apps/server
set -a; . /root/omskscrin/.env; set +a
node --input-type=module -e '
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const rows = await p.kiosk.findMany({ orderBy: { hostname: "asc" } });
console.log(JSON.stringify(rows.map(k => ({hostname:k.hostname,kioskId:k.kioskId,name:k.name,probe:k.probeStatus,install:k.installStatus})), null, 2));
console.log("TOTAL", rows.length);
await p.\$disconnect();
'
"""
)
client.close()
