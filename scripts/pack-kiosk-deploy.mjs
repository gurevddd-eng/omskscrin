#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform === "win32") {
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts/pack-kiosk-deploy.ps1")],
    { stdio: "inherit", cwd: root }
  );
  process.exit(r.status ?? 1);
}

const r = spawnSync("bash", [path.join(root, "scripts/pack-kiosk-deploy.sh")], {
  stdio: "inherit",
  cwd: root,
});
process.exit(r.status ?? 1);
