#!/usr/bin/env bash
# Pack kiosk deploy artifacts on Debian/Linux (Windows kiosks target).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "Building kiosk UI..."
pnpm --filter @stella/kiosk build

OUT="$ROOT/data/deploy/current"
rm -rf "$OUT"
mkdir -p "$OUT/ui" "$OUT/runtime" "$OUT/games"

cp -r apps/kiosk/dist/* "$OUT/ui/"
cp apps/kiosk/scripts/kiosk-agent.mjs "$OUT/agent.mjs"
cp apps/kiosk/scripts/block-hotkeys.ps1 "$OUT/block-hotkeys.ps1"
cp apps/kiosk/scripts/lockdown-policies.ps1 "$OUT/lockdown-policies.ps1"
cp apps/kiosk/scripts/clear-policies.ps1 "$OUT/clear-policies.ps1"
cp apps/server/scripts/install-local.ps1 "$OUT/install-local.ps1"

cat > "$OUT/games/README.txt" <<'EOF'
Place game .exe files here (on the kiosk: C:\ProgramData\StellaKiosk\games\).
EOF

NODE_TOOLS="$ROOT/tools/node"
NODE_EXE="$NODE_TOOLS/node.exe"
VER="v22.14.0"
ZIP_NAME="node-${VER}-win-x64.zip"

if [[ ! -f "$NODE_EXE" ]]; then
  echo "Downloading portable Node.js (win-x64) ..."
  mkdir -p "$NODE_TOOLS"
  TMP_ZIP="$(mktemp)"
  curl -fsSL "https://nodejs.org/dist/${VER}/${ZIP_NAME}" -o "$TMP_ZIP"
  TMP_DIR="$(mktemp -d)"
  unzip -q "$TMP_ZIP" -d "$TMP_DIR"
  INNER="$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -1)"
  cp "$INNER/node.exe" "$NODE_EXE"
  rm -rf "$TMP_ZIP" "$TMP_DIR"
fi

if [[ -f "$NODE_EXE" ]]; then
  cp "$NODE_EXE" "$OUT/runtime/node.exe"
  echo "runtime/node.exe: OK"
else
  echo "WARNING: No portable Node - kiosks must have Node in PATH"
fi

BUILT_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
SOFTWARE_VERSION="$(date -u +"%Y%m%d-%H%M%S")"
printf '{"softwareVersion":"%s","appVersion":"0.1.0","builtAt":"%s"}\n' "$SOFTWARE_VERSION" "$BUILT_AT" > "$OUT/version.json"
echo "$SOFTWARE_VERSION" > "$OUT/VERSION"

(
  cd "$OUT"
  zip -qr update.zip agent.mjs block-hotkeys.ps1 lockdown-policies.ps1 clear-policies.ps1 install-local.ps1 version.json VERSION ui games 2>/dev/null || true
  zip -qr package.zip agent.mjs block-hotkeys.ps1 lockdown-policies.ps1 clear-policies.ps1 install-local.ps1 version.json VERSION ui games runtime 2>/dev/null || true
)

echo "Deploy package ready: $OUT"
echo "softwareVersion: $SOFTWARE_VERSION"
ls -lh "$OUT/package.zip" "$OUT/update.zip" 2>/dev/null || true
