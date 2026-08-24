import paramiko
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("10.192.1.6", username="root", password="Mazambi47!", timeout=25, allow_agent=False, look_for_keys=False)


def run(cmd: str, timeout: int = 120) -> str:
    _, out, err = c.exec_command(cmd, timeout=timeout)
    return (out.read() + err.read()).decode("utf-8", "replace")


print("=== meta ===")
print(run("curl -s http://127.0.0.1:8080/api/deploy/meta; echo"))

print("=== software-update log lines ===")
print(
    run(
        "pm2 logs omskscrin --lines 400 --nostream 2>&1 | grep -F software-update | tail -30"
    )
)

print("=== FORCE / WinRM ===")
print(
    run(
        "pm2 logs omskscrin --lines 400 --nostream 2>&1 | grep -iE 'FORCE_|remote-force|WinRM nudge|software-update' | tail -40"
    )
)

print("=== deploy transport ===")
print(
    run(
        "curl -s http://127.0.0.1:8080/api/kiosks/deploy/status -H 'Authorization: Bearer invalid' | head -c 200; echo"
    )
)

c.close()
