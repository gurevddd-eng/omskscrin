#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy-ssh-lib.sh
source "$SCRIPT_DIR/deploy-ssh-lib.sh"
parse_deploy_args "$@"

if [[ -z "$CONFIGJSON" ]]; then
  echo "ConfigJson required" >&2
  exit 2
fi

echo "STAGE:connecting"
echo "Connecting via SSH to ${HOSTNAME} ..."

# JSON may contain quotes — write to temp file and scp
TMP_JSON=$(mktemp)
trap 'rm -f "$TMP_JSON"' EXIT
printf '%s' "$CONFIGJSON" > "$TMP_JSON"
ensure_kiosk_dir "$HOSTNAME"
run_scp "$TMP_JSON" "${DEPLOY_USER}@${HOSTNAME}:${KIOSK_ROOT}/_kiosk-config.json"

copy_kiosk_local_script "$HOSTNAME"
run_ssh "$HOSTNAME" "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"\$j = Get-Content -Raw -Path '${KIOSK_ROOT}/_kiosk-config.json'; & '${KIOSK_ROOT}/kiosk-local.ps1' -Action Push -ConfigJson \$j -HealthPort ${HEALTHPORT}\""
