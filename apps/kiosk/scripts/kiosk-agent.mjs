/**
 * Stella Kiosk Agent — UI (static) + health endpoint + OTA software updates.
 * Serves kiosk UI on UI_PORT (47820), health on HEALTH_PORT (47821).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

process.on("uncaughtException", (err) => {
  console.error("[stella-agent] uncaughtException:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("[stella-agent] unhandledRejection:", err);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;

function loadJsonConfig() {
  const candidates = [
    process.env.STELLA_KIOSK_CONFIG,
    path.join(root, "kiosk.json"),
    path.join(process.env.ProgramData || "C:\\ProgramData", "StellaKiosk", "kiosk.json"),
  ].filter(Boolean);

  for (const file of candidates) {
    try {
      if (file && fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, "utf8"));
      }
    } catch {
      /* next */
    }
  }
  return {};
}

function readLocalSoftwareVersion() {
  const jsonPath = path.join(root, "version.json");
  if (fs.existsSync(jsonPath)) {
    try {
      const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      if (j?.softwareVersion) return String(j.softwareVersion);
    } catch {
      /* fall through */
    }
  }
  const verPath = path.join(root, "VERSION");
  if (fs.existsSync(verPath)) {
    try {
      const t = fs.readFileSync(verPath, "utf8").trim();
      if (t) return t;
    } catch {
      /* fall through */
    }
  }
  return "0";
}

const fileCfg = loadJsonConfig();
const hostname = String(fileCfg.hostname || fileCfg.kioskId || os.hostname())
  .trim()
  .toLowerCase();
const kioskId = String(fileCfg.kioskId || hostname).trim().toLowerCase();
const appVersion = String(fileCfg.appVersion || "0.1.0");
const healthPort = Number(fileCfg.healthPort || process.env.HEALTH_PORT || 47821);
const uiPort = Number(fileCfg.uiPort || process.env.UI_PORT || 47820);
const uiRoot = path.join(root, "ui");
let softwareVersion = readLocalSoftwareVersion();
let updateInProgress = false;
let updateFailCount = 0;
let nextUpdateAllowedAt = 0;

let live = {
  contentVersion: null,
  syncStatus: "unknown",
  syncMessage: null,
  updatedAt: null,
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://127.0.0.1:${uiPort}`);
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";

  // Always serve live config from install root (not baked into UI build)
  if (rel === "/kiosk.json") {
    const cfgPath = [
      process.env.STELLA_KIOSK_CONFIG,
      path.join(root, "kiosk.json"),
      path.join(process.env.ProgramData || "C:\\ProgramData", "StellaKiosk", "kiosk.json"),
    ].find((p) => p && fs.existsSync(p));
    if (cfgPath) {
      fs.readFile(cfgPath, (err, data) => {
        if (err) {
          res.writeHead(500).end();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(data);
      });
      return;
    }
  }

  const filePath = path.normalize(path.join(uiRoot, rel));
  if (!filePath.startsWith(uiRoot)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      const index = path.join(uiRoot, "index.html");
      fs.readFile(index, (e2, html) => {
        if (e2) {
          res.writeHead(404).end("UI not found");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const healthServer = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${healthPort}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      hostname,
      kioskId,
      appVersion,
      softwareVersion,
      updateInProgress,
      contentVersion: live.contentVersion,
      syncStatus: live.syncStatus,
      syncMessage: live.syncMessage,
      updatedAt: live.updatedAt,
      uiPort,
      agent: "stella-kiosk-agent",
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/status") {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 64_000) req.destroy();
    });
    req.on("end", () => {
      try {
        const data = JSON.parse(raw || "{}");
        live = {
          contentVersion: data.contentVersion ?? live.contentVersion,
          syncStatus: data.syncStatus ?? live.syncStatus,
          syncMessage: data.syncMessage ?? live.syncMessage,
          updatedAt: new Date().toISOString(),
        };
        sendJson(res, 200, { ok: true });
      } catch {
        sendJson(res, 400, { ok: false });
      }
    });
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

const uiServer = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  serveStatic(req, res);
});

healthServer.listen(healthPort, "0.0.0.0", () => {
  console.log(`[stella-agent] health 0.0.0.0:${healthPort} hostname=${hostname}`);
});

uiServer.listen(uiPort, "127.0.0.1", () => {
  console.log(`[stella-agent] ui http://127.0.0.1:${uiPort}/ software=${softwareVersion}`);
});

// Heartbeat to central server (no CORS). Marks kiosk online even if Edge UI is closed.
const serverUrl = String(fileCfg.serverUrl || "")
  .trim()
  .replace(/\/$/, "");
const heartbeatSec = Math.max(15, Number(fileCfg.heartbeatIntervalSec || 30));
const syncIntervalSec = Math.max(30, Number(fileCfg.syncIntervalSec || 300));
const softwareCheckSec = Math.max(60, Number(fileCfg.softwareCheckIntervalSec || syncIntervalSec));

async function pushHeartbeat() {
  if (!serverUrl) return;
  try {
    await fetch(`${serverUrl}/api/kiosks/${encodeURIComponent(kioskId)}/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contentVersion: live.contentVersion,
        syncStatus: live.syncStatus,
        syncMessage: live.syncMessage,
        appVersion,
        hostname,
      }),
    });
  } catch (e) {
    console.warn("[stella-agent] heartbeat failed:", e instanceof Error ? e.message : e);
  }
}

function copyRecursive(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const ps = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true }
    );
    let err = "";
    ps.stderr.on("data", (d) => {
      err += d.toString();
    });
    ps.on("error", reject);
    ps.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err || `powershell exit ${code}`));
    });
  });
}

function fileSha(filePath) {
  if (!fs.existsSync(filePath)) return "";
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function scheduleAgentRestart() {
  console.log("[stella-agent] scheduling restart via StellaKioskAgent");
  const cmd =
    "timeout /t 4 /nobreak >nul & schtasks /Run /TN StellaKioskAgent >nul 2>&1";
  const child = spawn("cmd.exe", ["/c", cmd], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  setTimeout(() => process.exit(0), 1000);
}

async function downloadUpdateZip(url, dest) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 64) throw new Error("update zip too small");
  fs.writeFileSync(dest, buf);
}

async function applySoftwareUpdate(remoteVersion) {
  if (!serverUrl || updateInProgress) return;
  if (Date.now() < nextUpdateAllowedAt) {
    console.warn("[stella-agent] update skipped (backoff)");
    return;
  }
  updateInProgress = true;
  console.log(`[stella-agent] software update ${softwareVersion} → ${remoteVersion}`);

  const stamp = Date.now();
  const zipPath = path.join(os.tmpdir(), `stella-upd-${stamp}.zip`);
  const stage = path.join(os.tmpdir(), `stella-upd-stage-${stamp}`);

  try {
    await downloadUpdateZip(`${serverUrl}/api/deploy/update.zip`, zipPath);
    fs.mkdirSync(stage, { recursive: true });
    const zipEsc = zipPath.replace(/'/g, "''");
    const stageEsc = stage.replace(/'/g, "''");
    await runPowerShell(`Expand-Archive -LiteralPath '${zipEsc}' -DestinationPath '${stageEsc}' -Force`);

    let payload = stage;
    const entries = fs.readdirSync(stage);
    if (entries.length === 1 && fs.statSync(path.join(stage, entries[0])).isDirectory()) {
      payload = path.join(stage, entries[0]);
    }

    const uiSrc = path.join(payload, "ui");
    if (fs.existsSync(uiSrc)) {
      // Overwrite in place — do not delete ui/ first (Edge stays alive)
      copyRecursive(uiSrc, path.join(root, "ui"));
    }

    for (const name of ["version.json", "VERSION", "install-local.ps1"]) {
      const src = path.join(payload, name);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(root, name));
      }
    }

    const agentSrc = path.join(payload, "agent.mjs");
    const agentDest = path.join(root, "agent.mjs");
    let agentChanged = false;
    if (fs.existsSync(agentSrc)) {
      agentChanged = fileSha(agentSrc) !== fileSha(agentDest);
      if (agentChanged) {
        const tmp = path.join(root, "agent.mjs.new");
        fs.copyFileSync(agentSrc, tmp);
        fs.renameSync(tmp, agentDest);
      }
    }

    softwareVersion = readLocalSoftwareVersion() || remoteVersion;
    updateFailCount = 0;
    nextUpdateAllowedAt = 0;
    console.log(
      `[stella-agent] software update applied: ${softwareVersion}` +
        (agentChanged ? " (agent changed → restart)" : " (UI only, no restart)")
    );

    if (agentChanged) {
      scheduleAgentRestart();
      return;
    }
    updateInProgress = false;
  } catch (e) {
    updateFailCount += 1;
    const backoffMs = Math.min(60 * 60 * 1000, 60_000 * Math.pow(2, Math.min(updateFailCount, 5)));
    nextUpdateAllowedAt = Date.now() + backoffMs;
    console.warn(
      "[stella-agent] software update failed:",
      e instanceof Error ? e.message : e,
      `(backoff ${Math.round(backoffMs / 1000)}s)`
    );
    updateInProgress = false;
  } finally {
    try {
      fs.rmSync(zipPath, { force: true });
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(stage, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function checkSoftwareUpdate() {
  if (!serverUrl || updateInProgress) return;
  if (Date.now() < nextUpdateAllowedAt) return;
  try {
    const res = await fetch(
      `${serverUrl}/api/kiosks/${encodeURIComponent(kioskId)}/updates?softwareVersion=${encodeURIComponent(softwareVersion)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data.blockKeyboard === "boolean") {
      applyBlockKeyboardSetting(data.blockKeyboard);
    }
    if (typeof data.softwareEnabled === "boolean") {
      applySoftwareEnabledSetting(data.softwareEnabled);
    }
    const remote = String(data.softwareVersion || "").trim();
    if (!remote || remote === softwareVersion) return;
    await applySoftwareUpdate(remote);
  } catch (e) {
    console.warn("[stella-agent] update check failed:", e instanceof Error ? e.message : e);
  }
}

if (serverUrl) {
  console.log(`[stella-agent] heartbeat → ${serverUrl} every ${heartbeatSec}s`);
  console.log(`[stella-agent] software/settings check every ${softwareCheckSec}s (local=${softwareVersion})`);
  void pushHeartbeat();
  setInterval(() => void pushHeartbeat(), heartbeatSec * 1000);
  // Delay first OTA check so UI stays up after boot; also applies remote settings
  setTimeout(() => void checkSoftwareUpdate(), 15_000);
  setInterval(() => void checkSoftwareUpdate(), softwareCheckSec * 1000);
} else {
  console.warn("[stella-agent] no serverUrl in kiosk.json — heartbeat/updates disabled");
}

// —— UI lockdown: admin Stop → STOPPED; global Settings off → SOFTWARE_DISABLED ——
const stopFlagPath = path.join(
  process.env.ProgramData || "C:\\ProgramData",
  "StellaKiosk",
  "STOPPED"
);
const softwareDisabledPath = path.join(
  process.env.ProgramData || "C:\\ProgramData",
  "StellaKiosk",
  "SOFTWARE_DISABLED"
);

function isSoftwareDisabled() {
  try {
    return fs.existsSync(softwareDisabledPath);
  } catch {
    return false;
  }
}

function setSoftwareDisabledFlag(disabled) {
  try {
    fs.mkdirSync(path.dirname(softwareDisabledPath), { recursive: true });
    if (disabled) {
      fs.writeFileSync(softwareDisabledPath, `disabled ${new Date().toISOString()}`, "utf8");
      fs.writeFileSync(stopFlagPath, `stopped ${new Date().toISOString()}`, "utf8");
    } else {
      try {
        fs.unlinkSync(softwareDisabledPath);
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    console.warn("[stella-agent] SOFTWARE_DISABLED write failed:", e instanceof Error ? e.message : e);
  }
}

/** Per-kiosk STOPPED from before reboot can clear — unless global software disable is on. */
function clearStoppedIfFromPreviousBoot() {
  try {
    if (isSoftwareDisabled()) {
      console.log("[stella-agent] software globally disabled — keeping STOPPED across reboot");
      return;
    }
    if (!fs.existsSync(stopFlagPath)) return;
    const stoppedAt = fs.statSync(stopFlagPath).mtimeMs;
    const out = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "[int64]([DateTimeOffset](Get-CimInstance Win32_OperatingSystem).LastBootUpTime).ToUnixTimeMilliseconds()",
      ],
      { windowsHide: true, timeout: 8000, encoding: "utf8" }
    );
    const bootMs = Number(String(out).trim());
    if (Number.isFinite(bootMs) && stoppedAt < bootMs) {
      fs.unlinkSync(stopFlagPath);
      console.log("[stella-agent] cleared stale STOPPED from previous boot");
    }
  } catch (e) {
    console.warn(
      "[stella-agent] boot STOPPED check failed:",
      e instanceof Error ? e.message : e
    );
  }
}
clearStoppedIfFromPreviousBoot();

function edgeProfileDir() {
  return path.join(process.env.ProgramData || "C:\\ProgramData", "StellaKiosk", "edge-profile");
}

function edgeUiArgs() {
  const profile = edgeProfileDir();
  try {
    fs.mkdirSync(profile, { recursive: true });
  } catch {
    /* ignore */
  }
  return [
    `--user-data-dir=${profile}`,
    `--kiosk`,
    `http://127.0.0.1:${uiPort}/`,
    `--edge-kiosk-type=fullscreen`,
    `--no-first-run`,
    `--disable-session-crashed-bubble`,
    `--noerrdialogs`,
    `--check-for-update-interval=31536000`,
    `--disable-features=msEdgeSidebar,TranslateUI,InfiniteSessionRestore,msVisualSearch`,
    `--disable-pinch`,
    `--overscroll-history-navigation=0`,
  ].join(" ");
}

function findEdgeExe() {
  const candidates = [
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function isStopRequested() {
  try {
    return isSoftwareDisabled() || fs.existsSync(stopFlagPath);
  } catch {
    return false;
  }
}

function killEdgeUi() {
  const marker = `127.0.0.1:${uiPort}`;
  const script = `
Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.CommandLine -and $_.CommandLine -like '*${marker}*') {
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
  }
}
`;
  spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    windowsHide: true,
  });
}

function applySoftwareEnabledSetting(enabled) {
  const on = Boolean(enabled);
  if (on) {
    if (isSoftwareDisabled()) {
      setSoftwareDisabledFlag(false);
      try {
        fs.unlinkSync(stopFlagPath);
      } catch {
        /* ignore */
      }
      console.log("[stella-agent] softwareEnabled=ON — UI may start");
    }
  } else {
    setSoftwareDisabledFlag(true);
    stopKeyBlockProcesses();
    applyOsLockdownPolicies(false);
    killEdgeUi();
    console.log("[stella-agent] softwareEnabled=OFF — UI stopped, lockdown cleared (persists across reboot)");
  }
}

function isEdgeKioskRunning() {
  return new Promise((resolve) => {
    const marker = `127.0.0.1:${uiPort}`;
    const ps = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `$m='${marker}'; $ok=$false; Get-CimInstance Win32_Process -Filter \"Name = 'msedge.exe'\" -ErrorAction SilentlyContinue | ForEach-Object { if ($_.CommandLine -and $_.CommandLine -like \"*$m*\") { $ok=$true } }; if ($ok) { exit 0 } else { exit 1 }`,
      ],
      { windowsHide: true }
    );
    ps.on("close", (code) => resolve(code === 0));
    ps.on("error", () => resolve(false));
  });
}

function relaunchEdgeUi() {
  const edge = findEdgeExe();
  if (!edge) {
    console.warn("[stella-agent] Edge not found — cannot relaunch UI");
    return;
  }
  const args = edgeUiArgs();
  // Must run on the interactive desktop of the logged-on user (SYSTEM Session 0 is invisible).
  const script = `
$ErrorActionPreference = 'Stop'
$edge = '${edge.replace(/'/g, "''")}'
$uiArgs = '${args.replace(/'/g, "''")}'
$once = 'StellaKioskStartNow'
$taskUi = 'StellaKioskUI'

$proc = Get-CimInstance Win32_Process -Filter "Name = 'explorer.exe'" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) {
  Write-Output 'no-explorer'
  exit 2
}
$owner = Invoke-CimMethod -InputObject $proc -MethodName GetOwner -ErrorAction SilentlyContinue
if (-not $owner -or [string]::IsNullOrWhiteSpace($owner.User)) {
  Write-Output 'no-owner'
  exit 3
}
$user = if ($owner.Domain) { "$($owner.Domain)\\$($owner.User)" } else { $owner.User }

$action = New-ScheduledTaskAction -Execute $edge -Argument $uiArgs
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest

# Keep AtLogOn task updated for next reboot
if (Get-ScheduledTask -TaskName $taskUi -ErrorAction SilentlyContinue) {
  try { Enable-ScheduledTask -TaskName $taskUi -ErrorAction SilentlyContinue } catch {}
  Set-ScheduledTask -TaskName $taskUi -Action $action -ErrorAction SilentlyContinue | Out-Null
} else {
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  Register-ScheduledTask -TaskName $taskUi -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
}

Unregister-ScheduledTask -TaskName $once -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $once -Action $action -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $once -ErrorAction Stop
Write-Output "ok:$user"
`;
  const ps = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { windowsHide: true }
  );
  let out = "";
  ps.stdout?.on("data", (d) => {
    out += d.toString();
  });
  ps.stderr?.on("data", (d) => {
    out += d.toString();
  });
  ps.on("close", (code) => {
    const msg = out.trim().slice(0, 200);
    if (code === 0) console.log(`[stella-agent] Edge UI launched (${msg || "ok"})`);
    else console.warn(`[stella-agent] Edge UI launch failed code=${code} ${msg}`);
  });
  ps.on("error", (err) => {
    console.warn("[stella-agent] Edge UI launch spawn error:", err.message);
  });
}

let edgeWatchBusy = false;
const launchUiFlagPath = path.join(
  process.env.ProgramData || "C:\\ProgramData",
  "StellaKiosk",
  "LAUNCH_UI"
);

function consumeLaunchUiFlag() {
  try {
    if (!fs.existsSync(launchUiFlagPath)) return false;
    fs.unlinkSync(launchUiFlagPath);
    return true;
  } catch {
    return false;
  }
}

async function watchEdgeUi() {
  if (edgeWatchBusy) return;
  if (isStopRequested()) {
    stopKeyBlockProcesses();
    return;
  }
  edgeWatchBusy = true;
  try {
    const forceLaunch = consumeLaunchUiFlag();
    const running = await isEdgeKioskRunning();
    if (forceLaunch || !running) {
      console.warn(
        forceLaunch
          ? "[stella-agent] LAUNCH_UI flag — starting Edge"
          : "[stella-agent] Edge UI missing — restarting (close only from admin)"
      );
      relaunchEdgeUi();
    }
    await ensureKeyBlockRunning();
  } catch (e) {
    console.warn("[stella-agent] Edge watch failed:", e instanceof Error ? e.message : e);
  } finally {
    edgeWatchBusy = false;
  }
}

// —— OS keyboard block (LL hook + Keyboard Filter for Ctrl+Alt+Del) ——
const programDataRoot = path.join(process.env.ProgramData || "C:\\ProgramData", "StellaKiosk");
const blockKeyboardFlagPath = path.join(programDataRoot, "BLOCK_KEYBOARD");
const lockdownSuppressPath = path.join(programDataRoot, "LOCKDOWN_SUPPRESS");
const keyBlockScriptPath = path.join(root, "block-hotkeys.ps1");
const lockdownPoliciesPath = path.join(root, "lockdown-policies.ps1");
let wantKeyBlock = true;
let lastPoliciesMode = null;

function isLockdownSuppressed() {
  try {
    return fs.existsSync(lockdownSuppressPath);
  } catch {
    return false;
  }
}

function readBlockKeyboardFlag() {
  try {
    if (!fs.existsSync(blockKeyboardFlagPath)) return false;
    const v = fs.readFileSync(blockKeyboardFlagPath, "utf8").trim().toLowerCase();
    return v === "1" || v === "true" || v === "on";
  } catch {
    return false;
  }
}

function writeBlockKeyboardFlag(enabled) {
  try {
    fs.mkdirSync(programDataRoot, { recursive: true });
    fs.writeFileSync(blockKeyboardFlagPath, enabled ? "1" : "0", "utf8");
  } catch (e) {
    console.warn("[stella-agent] BLOCK_KEYBOARD write failed:", e instanceof Error ? e.message : e);
  }
}

function applyOsLockdownPolicies(enabled) {
  if (!fs.existsSync(lockdownPoliciesPath)) {
    console.warn("[stella-agent] lockdown-policies.ps1 missing — Ctrl+Alt+Del may still open");
    return;
  }
  const mode = enabled ? "on" : "off";
  if (lastPoliciesMode === mode) return;
  lastPoliciesMode = mode;
  const scriptPath = lockdownPoliciesPath.replace(/'/g, "''");
  const ps = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      lockdownPoliciesPath,
      "-Mode",
      mode,
    ],
    { windowsHide: true }
  );
  let out = "";
  ps.stdout?.on("data", (d) => {
    out += d.toString();
  });
  ps.stderr?.on("data", (d) => {
    out += d.toString();
  });
  ps.on("close", (code) => {
    const msg = out.trim().replace(/\s+/g, " ").slice(0, 300);
    if (code === 0) console.log(`[stella-agent] lockdown-policies ${mode}: ${msg || "ok"}`);
    else console.warn(`[stella-agent] lockdown-policies ${mode} failed code=${code} ${msg}`);
  });
}

function applyBlockKeyboardSetting(enabled) {
  const next = Boolean(enabled);

  if (isLockdownSuppressed()) {
    wantKeyBlock = false;
    lastPoliciesMode = null;
    writeBlockKeyboardFlag(false);
    stopKeyBlockProcesses();
    applyOsLockdownPolicies(false);
    if (!next) {
      try {
        fs.unlinkSync(lockdownSuppressPath);
      } catch {
        /* ignore */
      }
    }
    return;
  }

  if (next === wantKeyBlock) {
    writeBlockKeyboardFlag(next);
    applyOsLockdownPolicies(next);
    return;
  }
  wantKeyBlock = next;
  writeBlockKeyboardFlag(next);
  console.log(`[stella-agent] blockKeyboard=${wantKeyBlock ? "on" : "off"}`);
  applyOsLockdownPolicies(wantKeyBlock);
  if (!wantKeyBlock) stopKeyBlockProcesses();
}

function isKeyBlockRunning() {
  return new Promise((resolve) => {
    const ps = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `$ok=$false; Get-CimInstance Win32_Process -Filter \"Name = 'powershell.exe'\" -ErrorAction SilentlyContinue | ForEach-Object { if ($_.CommandLine -and $_.CommandLine -like '*block-hotkeys.ps1*') { $ok=$true } }; if ($ok) { exit 0 } else { exit 1 }`,
      ],
      { windowsHide: true }
    );
    ps.on("close", (code) => resolve(code === 0));
    ps.on("error", () => resolve(false));
  });
}

function stopKeyBlockProcesses() {
  const script = `
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.CommandLine -and $_.CommandLine -like '*block-hotkeys.ps1*') {
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
  }
}
try { Stop-ScheduledTask -TaskName 'StellaKioskKeyBlockNow' -ErrorAction SilentlyContinue } catch {}
try { Unregister-ScheduledTask -TaskName 'StellaKioskKeyBlockNow' -Confirm:$false -ErrorAction SilentlyContinue } catch {}
if (Test-Path (Join-Path $env:ProgramData 'StellaKiosk\\BLOCK_KEYBOARD')) {
  $v = (Get-Content (Join-Path $env:ProgramData 'StellaKiosk\\BLOCK_KEYBOARD') -Raw -ErrorAction SilentlyContinue)
  if ($v -match '^(0|false|off)') {
    try { Disable-ScheduledTask -TaskName 'StellaKioskKeyBlock' -ErrorAction SilentlyContinue } catch {}
    foreach ($p in @(
      'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System',
      'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System'
    )) {
      try { Remove-ItemProperty -Path $p -Name 'DisableTaskMgr' -ErrorAction SilentlyContinue } catch {}
    }
  }
}
`;
  spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    windowsHide: true,
  });
}

function relaunchKeyBlock() {
  if (!fs.existsSync(keyBlockScriptPath)) {
    console.warn("[stella-agent] block-hotkeys.ps1 missing — OS hotkeys not blocked");
    return;
  }
  writeBlockKeyboardFlag(true);
  const scriptPath = keyBlockScriptPath.replace(/'/g, "''");
  const script = `
$ErrorActionPreference = 'Stop'
$ps1 = '${scriptPath}'
$once = 'StellaKioskKeyBlockNow'
$task = 'StellaKioskKeyBlock'

$proc = Get-CimInstance Win32_Process -Filter "Name = 'explorer.exe'" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Output 'no-explorer'; exit 2 }
$owner = Invoke-CimMethod -InputObject $proc -MethodName GetOwner -ErrorAction SilentlyContinue
if (-not $owner -or [string]::IsNullOrWhiteSpace($owner.User)) { Write-Output 'no-owner'; exit 3 }
$user = if ($owner.Domain) { "$($owner.Domain)\\$($owner.User)" } else { $owner.User }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \`"$ps1\`"")
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
$trigger = New-ScheduledTaskTrigger -AtLogOn

# Persistent AtLogOn task (survives reboot)
if (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) {
  try { Enable-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue } catch {}
  Set-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -Principal $principal -ErrorAction SilentlyContinue | Out-Null
} else {
  Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
}

Unregister-ScheduledTask -TaskName $once -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $once -Action $action -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $once -ErrorAction Stop
Write-Output "ok:$user"
`;
  const ps = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { windowsHide: true }
  );
  let out = "";
  ps.stdout?.on("data", (d) => {
    out += d.toString();
  });
  ps.stderr?.on("data", (d) => {
    out += d.toString();
  });
  ps.on("close", (code) => {
    const msg = out.trim().slice(0, 200);
    if (code === 0) console.log(`[stella-agent] hotkey block launched (${msg || "ok"})`);
    else console.warn(`[stella-agent] hotkey block launch failed code=${code} ${msg}`);
  });
}

async function ensureKeyBlockRunning() {
  if (isStopRequested() || !wantKeyBlock || isLockdownSuppressed()) return;
  if (!readBlockKeyboardFlag()) return;
  const running = await isKeyBlockRunning();
  if (!running) relaunchKeyBlock();
}

// Respect manual policy clear + flag file on disk
if (isLockdownSuppressed() || !readBlockKeyboardFlag()) {
  wantKeyBlock = false;
}
writeBlockKeyboardFlag(wantKeyBlock);
applyOsLockdownPolicies(wantKeyBlock);
setTimeout(() => void watchEdgeUi(), 2_000);
setInterval(() => void watchEdgeUi(), 8_000);
console.log(`[stella-agent] Edge UI watchdog on (interactive session); stop flag ${stopFlagPath}`);
console.log(`[stella-agent] OS keyboard block (all keys + Keyboard Filter CAD) enabled=${wantKeyBlock}`);

