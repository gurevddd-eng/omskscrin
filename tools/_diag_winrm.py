"""Diagnose WinRM reachability to patriotstela17 from omskekran."""
import re
import sys

import paramiko

HOST = "10.192.1.6"
USER = "root"
PASSWORD = "Mazambi47!"
TARGET = "patriotstela17.udhb.local"


def run(client, cmd, timeout=60):
    print(f"\n=== {cmd[:100]} ===")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = (stdout.read() + stderr.read()).decode("utf-8", "replace")
    clean = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", out)
    sys.stdout.write(clean.encode("ascii", "replace").decode())
    sys.stdout.flush()
    return clean


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=20, allow_agent=False, look_for_keys=False)

    run(client, f"getent hosts {TARGET} || true; dig +short {TARGET} A 2>/dev/null || true; ping -c 2 -W 2 {TARGET} 2>&1 | tail -n 5")
    run(client, f"timeout 3 bash -c 'echo >/dev/tcp/{TARGET}/5985' 2>&1; echo exit:$?; nc -vz -w 3 {TARGET} 5985 2>&1; nc -vz -w 3 {TARGET} 5986 2>&1")
    # Compare with working host
    run(client, "getent hosts itpc07.udhb.local || true; nc -vz -w 3 itpc07.udhb.local 5985 2>&1")

    # Try WinRM with same creds as .env (don't print password)
    script = r'''
set -a
. /root/omskscrin/.env
set +a
pwsh -NoProfile -Command "
\$ErrorActionPreference='Stop'
\$u=\$env:DEPLOY_USER
\$p=\$env:DEPLOY_PASSWORD
Write-Host \"DEPLOY_USER=\$u\"
\$sec=ConvertTo-SecureString \$p -AsPlainText -Force
\$cred=New-Object System.Management.Automation.PSCredential(\$u,\$sec)
try {
  \$s=New-PSSession -ComputerName 'patriotstela17.udhb.local' -Credential \$cred -Authentication Negotiate
  Write-Host 'SESSION_OK'
  Invoke-Command -Session \$s -ScriptBlock { hostname; whoami }
  Remove-PSSession \$s
} catch {
  Write-Host ('SESSION_FAIL: ' + \$_.Exception.Message)
  if (\$_.Exception.InnerException) { Write-Host ('INNER: ' + \$_.Exception.InnerException.Message) }
}
"
'''
    run(client, script, timeout=90)
    client.close()


if __name__ == "__main__":
    main()
