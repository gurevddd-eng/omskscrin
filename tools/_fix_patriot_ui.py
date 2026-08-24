"""Check and force-refresh UI on patriotstela17 after deploy."""
import re
import sys
import time

import paramiko

HOST = "10.192.1.6"
USER = "root"
PASSWORD = "Mazambi47!"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)
t = client.get_transport()
if t:
    t.set_keepalive(30)


def run(cmd: str, timeout: int = 240) -> str:
    print(f"\n>>> {cmd[:140]}")
    _, stdout, _ = client.exec_command(cmd, timeout=timeout)
    chan = stdout.channel
    chan.settimeout(timeout)
    chunks: list[str] = []
    end = time.time() + timeout
    while True:
        if chan.recv_ready():
            chunks.append(chan.recv(65536).decode("utf-8", "replace"))
        if chan.recv_stderr_ready():
            chunks.append(chan.recv_stderr(65536).decode("utf-8", "replace"))
        if chan.exit_status_ready() and not chan.recv_ready() and not chan.recv_stderr_ready():
            break
        if time.time() > end:
            print("TIMEOUT")
            break
        time.sleep(0.2)
    out = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", "".join(chunks))
    sys.stdout.write(out.encode("ascii", "replace").decode())
    sys.stdout.flush()
    return out


run("cat /root/omskscrin/data/deploy/current/version.json; echo; ls -la /root/omskscrin/data/deploy/current/ui/assets/")

# Diagnose installed files + agent software version
run(
    r"""
cd /root/omskscrin
set -a; . ./.env; set +a
pwsh -NoProfile -File - <<'EOF'
$ErrorActionPreference = 'Continue'
$sec = ConvertTo-SecureString $env:DEPLOY_PASSWORD -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($env:DEPLOY_USER, $sec)
$s = New-PSSession -ComputerName 'patriotstela17.udhb.local' -Credential $cred -Authentication Negotiate
Invoke-Command -Session $s -ScriptBlock {
  $root = 'C:\ProgramData\StellaKiosk'
  Write-Host '=== version.json ==='
  if (Test-Path "$root\version.json") { Get-Content "$root\version.json" -Raw } else { 'MISSING' }
  Write-Host '=== UI assets ==='
  Get-ChildItem "$root\ui\assets" -ErrorAction SilentlyContinue |
    Select-Object Name, Length, LastWriteTime |
    Format-Table -AutoSize | Out-String | Write-Host
  Write-Host '=== CSS first bytes (theme check) ==='
  $css = Get-ChildItem "$root\ui\assets\*.css" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($css) {
    Write-Host $css.FullName
    $raw = Get-Content $css.FullName -Raw
    if ($raw -match '--bg:\s*([^;]+)') { Write-Host ("--bg=" + $Matches[1]) }
    if ($raw -match 'rail__nav-hint') { Write-Host 'HAS_NAV_HINT_CLASS' } else { Write-Host 'NO_NAV_HINT_CLASS' }
  } else { Write-Host 'NO_CSS' }
  Write-Host '=== agent health ==='
  try { (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:47821/health -TimeoutSec 4).Content }
  catch { $_.Exception.Message }
  Write-Host '=== local UI index ==='
  try {
    $h = Invoke-WebRequest -UseBasicParsing http://127.0.0.1:47820/ -TimeoutSec 4
    Write-Host $h.Content.Substring(0, [Math]::Min(500, $h.Content.Length))
  } catch { $_.Exception.Message }
  Write-Host '=== edge ==='
  Get-Process msedge -ErrorAction SilentlyContinue |
    Select-Object Id, StartTime | Format-Table -AutoSize | Out-String | Write-Host
}
Remove-PSSession $s
EOF
"""
)

client.close()
print("\nDONE_DIAG")
