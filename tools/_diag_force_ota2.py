import paramiko
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("10.192.1.6", username="root", password="Mazambi47!", timeout=25, allow_agent=False, look_for_keys=False)

cmds = [
    "pm2 logs omskscrin --lines 500 --nostream 2>&1 | grep -F 'software-update' | tail -20",
    "pm2 logs omskscrin --lines 500 --nostream 2>&1 | grep -F 'req-13' | tail -10",
    "python3 - <<'PY'\nfrom pathlib import Path\np=Path('/root/omskscrin/data/deploy/current/version.json'); b=p.read_bytes(); print('bom', b[:3]==b'\\xef\\xbb\\xbf', 'len', len(b)); print(b[:80])\np2=Path('/root/omskscrin/data/deploy/current/VERSION'); print('VERSION', repr(p2.read_bytes()[:40]))\nPY",
    "curl -s http://127.0.0.1:8080/api/deploy/meta; echo",
]
for cmd in cmds:
    print("===", cmd[:70])
    _, out, err = c.exec_command(cmd, timeout=60)
    print(out.read().decode("utf-8", "replace"))
    e = err.read().decode("utf-8", "replace")
    if e.strip():
        print("ERR", e[:300])
c.close()
