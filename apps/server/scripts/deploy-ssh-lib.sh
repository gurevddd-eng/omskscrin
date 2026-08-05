#!/usr/bin/env bash
# Shared SSH/SCP helpers: Debian server → Windows kiosk (OpenSSH Server on Windows).
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-}"
DEPLOY_PASSWORD="${DEPLOY_PASSWORD:-}"
DEPLOY_SSH_PORT="${DEPLOY_SSH_PORT:-22}"
DEPLOY_SSH_KEY_PATH="${DEPLOY_SSH_KEY_PATH:-}"
KIOSK_ROOT='C:/ProgramData/StellaKiosk'

ssh_base_args=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=30 -p "$DEPLOY_SSH_PORT")
if [[ -n "$DEPLOY_SSH_KEY_PATH" ]]; then
  ssh_base_args+=(-i "$DEPLOY_SSH_KEY_PATH")
fi

run_ssh() {
  local host="$1"
  shift
  if [[ -n "$DEPLOY_PASSWORD" ]] && command -v sshpass >/dev/null 2>&1; then
    SSHPASS="$DEPLOY_PASSWORD" sshpass -e ssh "${ssh_base_args[@]}" "${DEPLOY_USER}@${host}" "$@"
  else
    ssh "${ssh_base_args[@]}" "${DEPLOY_USER}@${host}" "$@"
  fi
}

run_scp() {
  local src="$1"
  local dest="$2"
  if [[ -n "$DEPLOY_PASSWORD" ]] && command -v sshpass >/dev/null 2>&1; then
    SSHPASS="$DEPLOY_PASSWORD" sshpass -e scp "${ssh_base_args[@]}" "$src" "$dest"
  else
    scp "${ssh_base_args[@]}" "$src" "$dest"
  fi
}

ensure_kiosk_dir() {
  local host="$1"
  run_ssh "$host" "powershell.exe -NoProfile -Command \"New-Item -ItemType Directory -Force -Path '$KIOSK_ROOT' | Out-Null\""
}

copy_kiosk_local_script() {
  local host="$1"
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ensure_kiosk_dir "$host"
  run_scp "${script_dir}/kiosk-local.ps1" "${DEPLOY_USER}@${host}:${KIOSK_ROOT}/kiosk-local.ps1"
}

copy_clear_policies_script() {
  local host="$1"
  local script_dir repo_root src
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  repo_root="$(cd "$script_dir/../.." && pwd)"
  src="$repo_root/apps/kiosk/scripts/clear-policies.ps1"
  if [[ ! -f "$src" ]]; then
    echo "clear-policies.ps1 not found at $src" >&2
    return 1
  fi
  ensure_kiosk_dir "$host"
  run_scp "$src" "${DEPLOY_USER}@${host}:${KIOSK_ROOT}/clear-policies.ps1"
  # hotkey script: stop re-enabling TaskMgr in user session
  src="$repo_root/apps/kiosk/scripts/block-hotkeys.ps1"
  if [[ -f "$src" ]]; then
    run_scp "$src" "${DEPLOY_USER}@${host}:${KIOSK_ROOT}/block-hotkeys.ps1"
  fi
}

run_kiosk_local() {
  local host="$1"
  shift
  copy_kiosk_local_script "$host"
  local args=()
  for arg in "$@"; do args+=("$(printf '%q' "$arg")"); done
  run_ssh "$host" "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${KIOSK_ROOT}/kiosk-local.ps1 ${args[*]}"
}

parse_deploy_args() {
  HOSTNAME=""
  LOCAL_ONLY=0
  DEPLOY_USER_ARG=""
  DEPLOY_PASSWORD_ARG=""
  UIPORT=47820
  HEALTHPORT=47821
  SERVERURL=""
  PACKAGEDIR=""
  KIOSKID=""
  APPVERSION="0.1.0"
  CONFIGJSON=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -Hostname) HOSTNAME="$2"; shift 2 ;;
      -LocalOnly) LOCAL_ONLY=1; shift ;;
      -DeployUser) DEPLOY_USER_ARG="$2"; shift 2 ;;
      -DeployPassword) DEPLOY_PASSWORD_ARG="$2"; shift 2 ;;
      -UiPort) UIPORT="$2"; shift 2 ;;
      -HealthPort) HEALTHPORT="$2"; shift 2 ;;
      -ServerUrl) SERVERURL="$2"; shift 2 ;;
      -PackageDir) PACKAGEDIR="$2"; shift 2 ;;
      -KioskId) KIOSKID="$2"; shift 2 ;;
      -AppVersion) APPVERSION="$2"; shift 2 ;;
      -ConfigJson) CONFIGJSON="$2"; shift 2 ;;
      *) echo "Unknown arg: $1" >&2; exit 2 ;;
    esac
  done

  if [[ -n "$DEPLOY_USER_ARG" ]]; then DEPLOY_USER="$DEPLOY_USER_ARG"; fi
  if [[ -n "$DEPLOY_PASSWORD_ARG" ]]; then DEPLOY_PASSWORD="$DEPLOY_PASSWORD_ARG"; fi

  if [[ -z "$HOSTNAME" ]]; then
    echo "Hostname required" >&2
    exit 2
  fi
  if [[ -z "$DEPLOY_USER" ]]; then
    echo "DEPLOY_USER required for SSH transport" >&2
    exit 2
  fi
}
