"""Verify kiosk.json encoding and what agent actually loads."""
from __future__ import annotations

import sys
import paramiko

HOST = "10.192.1.6"
PASSWORD = "Mazambi47!"

PS1 = r"""
$ErrorActionPreference = "Continue"
$u = $env:DEPLOY_USER
$p = $env:DEPLOY_PASSWORD
$sec = ConvertTo-SecureString $p -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($u, $sec)
$s = New-PSSession -ComputerName "itpc07.udhb.local" -Credential $cred -Authentication Negotiate
Invoke-Command -Session $s -ScriptBlock {
  $root = "C:\ProgramData\StellaKiosk"
  $f = Join-Path $root "kiosk.json"
  $bytes = [IO.File]::ReadAllBytes($f)
  Write-Host ("kiosk.json bytes={0} hex_head={1}" -f $bytes.Length, ([BitConverter]::ToString($bytes[0..([Math]::Min(15,$bytes.Length-1))])))
  Write-Host ("os hostname=" + [System.Net.Dns]::GetHostName())
  Write-Host ("COMPUTERNAME=" + $env:COMPUTERNAME)

  Write-Host "=== node parse via runtime ==="
  $node = Join-Path $root "runtime\node.exe"
  $script = @'
const fs = require("fs");
const path = require("path");
const os = require("os");
const root = "C:\\ProgramData\\StellaKiosk";
function loadJsonConfig() {
  const candidates = [
    process.env.STELLA_KIOSK_CONFIG,
    path.join(root, "kiosk.json"),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      if (file && fs.existsSync(file)) {
        const raw = fs.readFileSync(file);
        console.log("raw_len", raw.length, "head", raw.slice(0,8).toString("hex"));
        const txt = raw.toString("utf8");
        console.log("txt_head", JSON.stringify(txt.slice(0,80)));
        return JSON.parse(txt);
      }
    } catch (e) {
      console.log("parse_fail", String(e));
    }
  }
  return {};
}
const c = loadJsonConfig();
console.log("cfg", JSON.stringify(c));
console.log("hostname_const", String(c.hostname || c.kioskId || os.hostname()).trim().toLowerCase());
console.log("kioskId_const", String(c.kioskId || c.hostname || os.hostname()).trim().toLowerCase());
console.log("FORCE", fs.existsSync(path.join(root, "FORCE_UPDATE")) ? fs.readFileSync(path.join(root, "FORCE_UPDATE"), "utf8").trim() : null);
'@
  $tmp = Join-Path $env:TEMP "stella-cfg-test.mjs"
  Set-Content -Path $tmp -Value $script -Encoding UTF8
  & $node $tmp 2>&1 | ForEach-Object { Write-Host $_ }

  Write-Host "=== try apply manually: download+note ==="
  # Check if updateInProgress stuck via forcing agent console - look at Event Log / redirect
  # Capture agent stdout by running one-shot apply simulation
  $apply = @'
const fs = require("fs");
const path = require("path");
const os = require("os");
const root = "C:\\ProgramData\\StellaKiosk";
const serverUrl = "http://omskekran.udhb.local";
(async () => {
  const url = serverUrl + "/api/deploy/update.zip";
  console.log("fetching", url);
  const res = await fetch(url);
  console.log("status", res.status, "ctype", res.headers.get("content-type"));
  const buf = Buffer.from(await res.arrayBuffer());
  console.log("size", buf.length);
  const dest = path.join(os.tmpdir(), "stella-manual-upd.zip");
  fs.writeFileSync(dest, buf);
  console.log("wrote", dest);
})().catch((e) => { console.error("fail", e); process.exit(1); });
'@
  $tmp2 = Join-Path $env:TEMP "stella-dl-test.mjs"
  Set-Content -Path $tmp2 -Value $apply -Encoding UTF8
  & $node $tmp2 2>&1 | ForEach-Object { Write-Host $_ }

  Write-Host "=== list listeners 47821 ==="
  netstat -ano | findstr ":47821"
  Write-Host "=== process owning health ==="
  $conn = Get-NetTCPConnection -LocalPort 47821 -ErrorAction SilentlyContinue | Select-Object -First 3
  foreach ($c in $conn) {
    $p = Get-Process -Id $c.OwningProcess -EA SilentlyContinue
    Write-Host ("pid={0} name={1} path={2}" -f $c.OwningProcess, $p.ProcessName, $p.Path)
    try {
      $proc = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $c.OwningProcess)
      Write-Host ("cmd=" + $proc.CommandLine)
    } catch {}
  }
}
Remove-PSSession $s
"""

def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)
    sftp = c.open_sftp()
    with sftp.file("/tmp/itpc07_cfg.ps1", "w") as f:
        f.write(PS1)
    sftp.close()
    _, stdout, stderr = c.exec_command(
        "cd /root/omskscrin && set -a && . ./.env && set +a && pwsh -NoProfile -File /tmp/itpc07_cfg.ps1",
        timeout=120,
    )
    print((stdout.read() + stderr.read()).decode("utf-8", "replace").encode("ascii", "replace").decode())
    c.close()

if __name__ == "__main__":
    main()
