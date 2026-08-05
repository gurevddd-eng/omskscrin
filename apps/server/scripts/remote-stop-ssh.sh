#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy-ssh-lib.sh
source "$SCRIPT_DIR/deploy-ssh-lib.sh"
parse_deploy_args "$@"
echo "STAGE:connecting"
echo "Connecting via SSH to ${HOSTNAME} ..."
run_kiosk_local "$HOSTNAME" -Action Stop -UiPort "$UIPORT" -HealthPort "$HEALTHPORT"
