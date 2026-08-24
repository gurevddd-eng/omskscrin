"""Check StellaKiosk install state on itpc07."""
import re
import sys
import time

import paramiko

HOST = "10.192.1.6"
USER = "root"
PASSWORD = "Mazambi47!"


def run(client, cmd, timeout=90):
    print(f"\n>>> {cmd[:120]}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    chan = stdout.channel
    chan.settimeout(timeout)
    chunks = []
    deadline = time.time() + timeout
    while True:
        if chan.recv_ready():
            chunks.append(chan.recv(65536).decode("utf-8", "replace"))
        if chan.recv_stderr_ready():
            chunks.append(chan.recv_stderr(65536).decode("utf-8", "replace"))
        if chan.exit_status_ready() and not chan.recv_ready() and not chan.recv_stderr_ready():
            break
        if time.time() > deadline:
            raise SystemExit("timeout")
        time.sleep(0.2)
    out = "".join(chunks)
    clean = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", out)
    sys.stdout.write(clean.encode("ascii", "replace").decode())
    sys.stdout.flush()
    return clean


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=20, allow_agent=False, look_for_keys=False)
    script = r"""
set -a
. /root/omskscrin/.env
set +a
pwsh -NoProfile -Command '
$ErrorActionPreference="Stop"
$u=$env:DEPLOY_USER; $p=$env:DEPLOY_PASSWORD
$sec=ConvertTo-SecureString $p -AsPlainText -Force
$cred=New-Object System.Management.Automation.PSCredential($u,$sec)
$s=New-PSSession -ComputerName "itpc07.udhb.local" -Credential $cred -Authentication Negotiate
try {
  Invoke-Command -Session $s -ScriptBlock {
    $root = Join-Path $env:ProgramData "StellaKiosk"
    Write-Output ("hostname=" + $env:COMPUTERNAME)
    Write-Output ("root_exists=" + (Test-Path $root))
    if (Test-Path $root) {
      Write-Output ("agent_mjs=" + (Test-Path (Join-Path $root "agent.mjs")))
      Get-ChildItem $root -ErrorAction SilentlyContinue | Select-Object -First 20 Name,Length | ForEach-Object { Write-Output ("file=" + $_.Name) }
    }
    foreach ($t in @("StellaKioskAgent","StellaKioskUI","StellaKioskKeyBlock")) {
      $task = Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
      if ($task) { Write-Output ("task=" + $t + " state=" + $task.State) }
      else { Write-Output ("task=" + $t + " MISSING") }
    }
    try {
      $h = Invoke-RestMethod -Uri "http://127.0.0.1:47821/health" -TimeoutSec 2
      Write-Output ("health=" + ($h | ConvertTo-Json -Compress))
    } catch {
      Write-Output "health=DOWN"
    }
  }
} finally {
  Remove-PSSession $s -ErrorAction SilentlyContinue
}
'
"""
    run(client, script, timeout=90)
    client.close()


if __name__ == "__main__":
    main()
