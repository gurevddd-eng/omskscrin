#!/usr/bin/env bash
# Install Stella Kiosk on Windows from Debian via OpenSSH (scp + remote PowerShell).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy-ssh-lib.sh
source "$SCRIPT_DIR/deploy-ssh-lib.sh"

parse_deploy_args "$@"

if [[ "$LOCAL_ONLY" -eq 1 ]]; then
  echo "LocalOnly install via SSH is not supported on Linux server" >&2
  exit 1
fi

PACKAGEDIR="${PACKAGEDIR:-${DEPLOY_PACKAGE_DIR:-data/deploy/current}}"
ZIP="${PACKAGEDIR}/package.zip"
if [[ ! -f "$ZIP" ]]; then
  echo "package.zip not found in $PACKAGEDIR. Run: pnpm pack:kiosk-deploy" >&2
  exit 1
fi

[[ -z "$KIOSKID" ]] && KIOSKID="$(echo "$HOSTNAME" | tr '[:upper:]' '[:lower:]')"

echo "STAGE:connecting"
echo "Connecting via SSH to ${HOSTNAME} as ${DEPLOY_USER} ..."

ensure_kiosk_dir "$HOSTNAME"

echo "STAGE:copying"
echo "Copying package.zip via scp ..."
run_scp "$ZIP" "${DEPLOY_USER}@${HOSTNAME}:${KIOSK_ROOT}/_package.zip"

TMP_PS=$(mktemp)
trap 'rm -f "$TMP_PS"' EXIT
cat > "$TMP_PS" <<'PSEOF'
param(
  [string]$Root,
  [string]$ServerUrl,
  [string]$KioskId,
  [string]$Hostname,
  [int]$HealthPort,
  [int]$UiPort,
  [string]$AppVersion
)
$ErrorActionPreference = "Stop"
foreach ($t in @("StellaKioskAgent","StellaKioskUI","StellaKioskStartNow","StellaKioskKeyBlock","StellaKioskKeyBlockNow")) {
  try { Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue } catch {}
  try { Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue } catch {}
}
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.CommandLine -and ($_.CommandLine -like "*StellaKiosk*" -or $_.CommandLine -like "*agent.mjs*")) {
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
  }
}
Start-Sleep -Seconds 1
$z = Join-Path $Root "_package.zip"
if (-not (Test-Path $z)) { throw "Zip not found: $z" }
foreach ($name in @("agent.mjs","install-local.ps1","ui","runtime","version.json","VERSION")) {
  $p = Join-Path $Root $name
  if (Test-Path $p) { Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue }
}
Expand-Archive -Path $z -DestinationPath $Root -Force
Remove-Item $z -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $Root "games") | Out-Null
$cfg = @{
  hostname = $Hostname.ToLower()
  kioskId = $KioskId.ToLower()
  serverUrl = $ServerUrl.TrimEnd("/")
  syncIntervalSec = 300
  idleTimeoutSec = 600
  heartbeatIntervalSec = 30
  healthPort = $HealthPort
  uiPort = $UiPort
  appVersion = $AppVersion
} | ConvertTo-Json
Set-Content -Path (Join-Path $Root "kiosk.json") -Value $cfg -Encoding UTF8
Write-Host "STAGE:installing"
$out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "install-local.ps1") -InstallRoot $Root -UiPort $UiPort -HealthPort $HealthPort -RemoteInvoke 2>&1
$code = $LASTEXITCODE
$text = ($out | Out-String).Trim()
if ($code -ne 0 -and $null -ne $code) { throw "install-local exit $code : $text" }
if ($text -notmatch "OK installed") { throw $text }
Write-Output "INSTALL_OK: $text"
PSEOF

echo "STAGE:configuring"
run_scp "$TMP_PS" "${DEPLOY_USER}@${HOSTNAME}:${KIOSK_ROOT}/_install-remote.ps1"

echo "STAGE:installing"
echo "Running install-local.ps1 on remote host ..."
run_ssh "$HOSTNAME" "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${KIOSK_ROOT}/_install-remote.ps1 -Root '${KIOSK_ROOT}' -ServerUrl '${SERVERURL}' -KioskId '${KIOSKID}' -Hostname '${HOSTNAME}' -HealthPort ${HEALTHPORT} -UiPort ${UIPORT} -AppVersion '${APPVERSION}'"

echo "STAGE:starting"
echo "STAGE:done"
