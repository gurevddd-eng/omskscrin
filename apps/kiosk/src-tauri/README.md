# Stella Kiosk — native shell (Tauri)

Fullscreen Windows app that hosts the same React UI and can launch local `.exe` games.

## Requirements

1. [Rust](https://rustup.rs/) (MSVC toolchain on Windows)
2. WebView2 (usually already on Windows 10/11)
3. Node / pnpm (monorepo)

## Dev

```bash
pnpm --filter @stella/kiosk tauri:dev
```

## Production build

```bash
pnpm --filter @stella/kiosk tauri:build
```

Installer: `apps/kiosk/src-tauri/target/release/bundle/nsis/`

## Games

1. Put the game under `C:\ProgramData\StellaKiosk\games\`  
   Example: `C:\ProgramData\StellaKiosk\games\demo\game.exe`
2. In `kiosk.json` on the kiosk:

```json
"game": {
  "title": "Играть",
  "exe": "demo/game.exe",
  "args": []
}
```

Only `.exe` files inside `...\StellaKiosk\games\` are allowed.  
While the game runs, the kiosk window hides; after exit it returns fullscreen.

## Note

Edge+agent deploy still works for content-only kiosks. Tauri is needed for native `.exe` launch.
