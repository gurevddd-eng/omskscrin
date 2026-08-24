"""Force OTA on patriotstela17 to latest package."""
import re
import sys
import time

import paramiko

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("10.192.1.6", username="root", password="Mazambi47!", timeout=25, allow_agent=False, look_for_keys=False)
t = c.get_transport()
if t:
    t.set_keepalive(30)


def run(cmd, timeout=180):
    print(f"\n=== {cmd[:100]} ===", flush=True)
    _, stdout, stderr = c.exec_command(cmd, timeout=timeout)
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
            print("TIMEOUT", flush=True)
            break
        time.sleep(0.2)
    out = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", "".join(chunks))
    sys.stdout.write(out.encode("ascii", "replace").decode())
    sys.stdout.flush()
    return out


# Get kiosk id then POST software-update (needs auth — use WinRM force script instead)
run(
    r"""
cd /root/omskscrin
set -a; . ./.env; set +a
TARGET=$(cat data/deploy/current/VERSION | tr -d '\r\n')
echo "TARGET=$TARGET"
pwsh -NoProfile -File apps/server/scripts/remote-force-update.ps1 \
  -Hostname patriotstela17.udhb.local \
  -TargetVersion "$TARGET" \
  -DeployUser "$DEPLOY_USER" \
  -DeployPassword "$DEPLOY_PASSWORD"
"""
)

print("\nWaiting 25s for apply...", flush=True)
time.sleep(25)

run(
    r"""
cd /root/omskscrin
set -a; . ./.env; set +a
pwsh -NoProfile -Command '
$ErrorActionPreference = "Continue"
$u = $env:DEPLOY_USER; $p = $env:DEPLOY_PASSWORD
$sec = ConvertTo-SecureString $p -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($u, $sec)
$s = New-PSSession -ComputerName "patriotstela17.udhb.local" -Credential $cred -Authentication Negotiate
Invoke-Command -Session $s -ScriptBlock {
  $root = "C:\ProgramData\StellaKiosk"
  Write-Host ("VERSION=" + (Get-Content "$root\VERSION" -Raw).Trim())
  Write-Host ("FORCE=" + $(if (Test-Path "$root\FORCE_UPDATE") { (Get-Content "$root\FORCE_UPDATE" -Raw).Trim() } else { "gone" }))
  try { Write-Host (Invoke-WebRequest http://127.0.0.1:47821/health -UseBasicParsing -TimeoutSec 5).Content } catch { Write-Host $_.Exception.Message }
}
Remove-PSSession $s
'
"""
)
c.close()
