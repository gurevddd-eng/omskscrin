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
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

process.on("uncaughtException", (err) => {
  console.error("[stella-agent] uncaughtException:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("[stella-agent] unhandledRejection:", err);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;

/** Join UNC / Windows paths without path.join eating the leading \\. */
function joinWinPath(...parts) {
  const cleaned = parts
    .map((p, i) => {
      let s = String(p || "").replace(/\//g, "\\");
      if (i === 0) return s.replace(/[\\\/]+$/, "");
      return s.replace(/^[\\\/]+/, "").replace(/[\\\/]+$/, "");
    })
    .filter((s, i) => s || i === 0);
  if (!cleaned.length) return "";
  const head = cleaned[0];
  const rest = cleaned.slice(1).filter(Boolean);
  if (!rest.length) return head;
  return `${head}\\${rest.join("\\")}`;
}

function isPathInside(parent, child) {
  const p = path.resolve(parent).toLowerCase();
  const c = path.resolve(child).toLowerCase();
  const sep = path.sep.toLowerCase() === "\\" ? "\\" : path.sep;
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/** Serve local file with HTTP Range (required for HTML5 video seek). */
function serveFileWithRanges(req, res, filePath, contentType) {
  let st;
  try {
    st = fs.statSync(filePath);
  } catch {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Media not found" }));
    return;
  }
  const size = st.size;
  const mime = contentType || "application/octet-stream";
  const range = String(req.headers.range || "");
  const baseHeaders = {
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=3600",
  };

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
    if (m) {
      let start = m[1] ? Number(m[1]) : 0;
      let end = m[2] ? Number(m[2]) : size - 1;
      if (!Number.isFinite(start)) start = 0;
      if (!Number.isFinite(end) || end >= size) end = size - 1;
      if (start > end || start >= size) {
        res.writeHead(416, { ...baseHeaders, "Content-Range": `bytes */${size}` });
        res.end();
        return;
      }
      const chunk = end - start + 1;
      res.writeHead(206, {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(chunk),
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
  }

  res.writeHead(200, { ...baseHeaders, "Content-Length": String(size) });
  fs.createReadStream(filePath).pipe(res);
}

function processExists(pid) {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** PowerShell Set-Content -Encoding UTF8 writes a BOM that breaks JSON.parse. */
function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function readJsonFile(file) {
  return JSON.parse(stripBom(fs.readFileSync(file, "utf8")));
}

function loadJsonConfig() {
  const candidates = [
    process.env.STELLA_KIOSK_CONFIG,
    path.join(root, "kiosk.json"),
    path.join(process.env.ProgramData || "C:\\ProgramData", "StellaKiosk", "kiosk.json"),
  ].filter(Boolean);

  for (const file of candidates) {
    try {
      if (file && fs.existsSync(file)) {
        return readJsonFile(file);
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
      const j = readJsonFile(jsonPath);
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
let gameLaunchInProgress = false;
let lastHeartbeatAt = 0;
let lastSpaContactAt = 0;
let lastKeyblockRelaunchAt = 0;
let lastEdgeRelaunchAt = 0;
let gameCopy = {
  status: "idle",
  folder: null,
  percent: null,
  copiedBytes: null,
  totalBytes: null,
  message: null,
  updatedAt: null,
};
const omskekranRoot = path.join(process.env.ProgramData || "C:\\ProgramData", "omskekran");
const contentRoot = path.join(omskekranRoot, "content");
const gamesRoot = path.join(omskekranRoot, "games");
// Central CMS base used for proxying media to the kiosk UI.
const cmsBaseUrl = String(fileCfg.serverUrl || "").trim().replace(/\/$/, "");
const forceUpdatePath = path.join(
  process.env.ProgramData || "C:\\ProgramData",
  "StellaKiosk",
  "FORCE_UPDATE"
);
const PS_HIDDEN = ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass"];

function readForceUpdateFlag() {
  try {
    if (!fs.existsSync(forceUpdatePath)) return null;
    const v = fs.readFileSync(forceUpdatePath, "utf8").trim();
    return v || null;
  } catch {
    return null;
  }
}

function clearForceUpdateFlag() {
  try {
    if (fs.existsSync(forceUpdatePath)) fs.unlinkSync(forceUpdatePath);
  } catch {
    /* ignore */
  }
}

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

const healthServer = http.createServer(async (req, res) => {
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
    // SPA polls this every ~3s while Edge UI is open — used instead of PowerShell process scans
    lastSpaContactAt = Date.now();
    sendJson(res, 200, {
      ok: true,
      hostname,
      kioskId,
      appVersion,
      softwareVersion,
      updateInProgress,
      gameCopy,
      contentVersion: live.contentVersion,
      syncStatus: live.syncStatus,
      syncMessage: live.syncMessage,
      updatedAt: live.updatedAt,
      uiPort,
      agent: "stella-kiosk-agent",
    });
    return;
  }

  // Serve media to kiosk UI.
  // MVP: proxy to CMS, with simple on-disk cache at C:\\ProgramData\\omskekran\\content.
  if (req.method === "GET" && url.pathname.startsWith("/media/")) {
    const id = decodeURIComponent(url.pathname.slice("/media/".length));
    if (!cmsBaseUrl) {
      sendJson(res, 404, { error: "CMS base URL missing" });
      return;
    }

    try {
      fs.mkdirSync(contentRoot, { recursive: true });
    } catch {
      /* ignore */
    }

    const safeName = String(id).replace(/[\\/:*?"<>|]+/g, "_");
    const diskPath = path.join(contentRoot, safeName);
    const metaPath = `${diskPath}.meta.json`;

    // Fast path: local disk cache (with Range — needed for video scrubbing)
    try {
      if (fs.existsSync(diskPath) && fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        const ct = meta?.mimeType || "application/octet-stream";
        serveFileWithRanges(req, res, diskPath, ct);
        return;
      }
    } catch {
      /* fall through to proxy */
    }

    try {
      const r = await fetch(`${cmsBaseUrl}/api/files/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (!r.ok) {
        sendJson(res, r.status || 404, { error: "Media not found" });
        return;
      }
      const ct = r.headers.get("content-type") || "application/octet-stream";
      const buf = Buffer.from(await r.arrayBuffer());
      try {
        fs.writeFileSync(diskPath, buf);
        fs.writeFileSync(metaPath, JSON.stringify({ mimeType: ct, size: buf.length }), "utf8");
      } catch {
        /* ignore cache write errors — still serve */
      }
      // After first full download, serve via Range-capable path
      if (fs.existsSync(diskPath)) {
        serveFileWithRanges(req, res, diskPath, ct);
        return;
      }
      res.writeHead(200, {
        "Content-Type": ct,
        "Accept-Ranges": "bytes",
        "Content-Length": String(buf.length),
        "Access-Control-Allow-Origin": "*",
      });
      res.end(buf);
    } catch (e) {
      sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  // Admin «Обновить ПО» → server POSTs here for immediate apply (faster than WinRM)
  if (req.method === "POST" && url.pathname === "/force-update") {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 8_000) req.destroy();
    });
    req.on("end", () => {
      let target = "";
      try {
        const body = JSON.parse(raw || "{}");
        target = String(body.softwareVersion || body.target || "").trim();
      } catch {
        /* ignore */
      }
      if (!target) target = readForceUpdateFlag() || "";
      if (!target) {
        sendJson(res, 400, { ok: false, error: "softwareVersion required" });
        return;
      }
      try {
        fs.mkdirSync(path.dirname(forceUpdatePath), { recursive: true });
        fs.writeFileSync(forceUpdatePath, target, "utf8");
      } catch (e) {
        sendJson(res, 500, {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        applying: true,
        target,
        softwareVersion,
        updateInProgress,
      });
      console.log(`[stella-agent] /force-update → ${target} (HTTP nudge)`);
      void applySoftwareUpdate(target, { force: true });
    });
    return;
  }

  // Launch local .exe from copied game folder
  // UI → agent → (robocopy UNC → ProgramData\\omskekran\\games) → run exe → restore Edge UI
  if (req.method === "POST" && url.pathname === "/launch-game") {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 64_000) req.destroy();
    });
    req.on("end", async () => {
      if (updateInProgress || gameLaunchInProgress || isStopRequested()) {
        sendJson(res, 423, { ok: false, error: "Киоск занят, попробуйте позже" });
        return;
      }

      try {
        const body = JSON.parse(raw || "{}");
        const folder = String(body.folder || "").trim();
        const exe = String(body.exe || "").trim();
        if (!folder || !exe) {
          sendJson(res, 400, { ok: false, error: "Не указаны папка и файл игры" });
          return;
        }

        const uncRoot =
          String(fileCfg.gameShareUnc || process.env.STELLA_GAME_SHARE_UNC || gameShareUncRoot || "").trim() ||
          "\\\\HYDRALISK3\\Patriot\\Игры парк победы";
        const uncFolder = joinWinPath(uncRoot, folder);

        fs.mkdirSync(omskekranRoot, { recursive: true });
        fs.mkdirSync(gamesRoot, { recursive: true });

        const localFolder = path.join(gamesRoot, folder);
        fs.mkdirSync(localFolder, { recursive: true });

        gameCopy = {
          status: "copying",
          folder,
          percent: null,
          copiedBytes: null,
          totalBytes: null,
          message: `Копирование с ${uncFolder}`,
          updatedAt: new Date().toISOString(),
        };

        // Incremental copy (best-effort). If share is down — keep last copy.
        const runRobocopy = () =>
          new Promise((resolve) => {
            const args = [
              uncFolder,
              localFolder,
              "/E",
              "/COPY:DAT",
              "/DCOPY:DAT",
              "/XO",
              "/R:1",
              "/W:2",
              "/NFL",
              "/NDL",
              "/NJH",
              "/NJS",
              "/NP",
            ];
            const ps = spawn("robocopy", args, { windowsHide: true });
            ps.on("close", (code) => resolve(code ?? 1));
            ps.on("error", () => resolve(1));
          });

        const robocode = await runRobocopy();
        // Robocopy: 0..7 are success (0=no change, 1..7 are copied/needs attention)
        const okCopy = robocode >= 0 && robocode <= 7;
        if (!okCopy) {
          console.warn(`[stella-agent] robocopy code=${robocode} unc=${uncFolder}`);
        }

        const safeExeRel = exe.replace(/[\/\\]+/g, path.sep);
        const candidates = [
          path.resolve(path.join(localFolder, safeExeRel)),
          path.resolve(path.join(localFolder, path.basename(safeExeRel))),
        ];
        let localExePath = candidates.find((p) => isPathInside(localFolder, p) && fs.existsSync(p)) || null;
        if (!localExePath) {
          // Fallback: search by basename under copied folder (depth 4)
          const want = path.basename(safeExeRel).toLowerCase();
          const stack = [localFolder];
          let depth = 0;
          while (stack.length && depth < 200) {
            depth += 1;
            const dir = stack.pop();
            let entries = [];
            try {
              entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
              continue;
            }
            for (const e of entries) {
              const full = path.join(dir, e.name);
              if (e.isFile() && e.name.toLowerCase() === want) {
                localExePath = full;
                break;
              }
              if (e.isDirectory() && !e.name.startsWith(".")) stack.push(full);
            }
            if (localExePath) break;
          }
        }

        if (!localExePath || !isPathInside(localFolder, localExePath)) {
          gameCopy = {
            status: "error",
            folder,
            percent: null,
            copiedBytes: null,
            totalBytes: null,
            message: `Игра не найдена (robocopy=${robocode})`,
            updatedAt: new Date().toISOString(),
          };
          sendJson(res, 404, {
            ok: false,
            error: okCopy
              ? `Игра не найдена: нет файла «${exe}» в папке «${folder}»`
              : `Нет доступа к шаре или игра не скопирована (код ${robocode}). Проверьте «${uncFolder}»`,
          });
          return;
        }

        gameCopy = {
          status: "launching",
          folder,
          percent: 100,
          copiedBytes: null,
          totalBytes: null,
          message: path.basename(localExePath),
          updatedAt: new Date().toISOString(),
        };

        gameLaunchInProgress = true;
        killEdgeUi();

        const cached = readCachedConsoleUser() || "";
        const exeEsc = String(localExePath).replace(/'/g, "''");
        const cwdEsc = String(path.dirname(localExePath)).replace(/'/g, "''");
        const cachedEsc = String(cached).replace(/'/g, "''");

        const taskName = `StellaKioskGameOnce`;
        const script = `
$ErrorActionPreference = 'Stop'
function Resolve-User {
  $ErrorActionPreference = 'SilentlyContinue'
  $proc = Get-CimInstance Win32_Process -Filter "Name = 'explorer.exe'" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($proc) {
    $o = Invoke-CimMethod -InputObject $proc -MethodName GetOwner -ErrorAction SilentlyContinue
    if ($o -and $o.User) {
      if ($o.Domain) { return "$($o.Domain)\\$($o.User)" }
      return $o.User
    }
  }
  Get-CimInstance Win32_Process | ForEach-Object {
    if ($_.SessionId -gt 0 -and $_.Name -match '^(msedge|sihost|taskhostw|ApplicationFrameHost|ShellExperienceHost)\\.exe$') {
      $o = Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue
      if ($o -and $o.User -and $o.User -notin @('SYSTEM','LOCAL SERVICE','NETWORK SERVICE')) {
        if ($o.Domain) { return "$($o.Domain)\\$($o.User)" }
        return $o.User
      }
    }
  }
  $cached = '${cachedEsc}'
  if ($cached) { return $cached }
  return $null
}

$user = Resolve-User
if (-not $user) { exit 2 }

$exe = '${exeEsc}'
$cwd = '${cwdEsc}'
$task = '${taskName}'

try { Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue | Out-Null } catch {}

$action = New-ScheduledTaskAction -Execute $exe -WorkingDirectory $cwd
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances Parallel
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(2)

Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $task -ErrorAction Stop | Out-Null

for ($i=0; $i -lt 200000; $i++) {
  $info = Get-ScheduledTaskInfo -TaskName $task -ErrorAction SilentlyContinue
  if (-not $info) { break }
  if ($info.State -ne 'Running') { break }
  Start-Sleep -Milliseconds 500
}

try { Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue | Out-Null } catch {}
Write-Output 'ok'
`;

        await new Promise((resolve, reject) => {
          const ps = spawn(
            "powershell.exe",
            [...PS_HIDDEN, "-Command", script],
            { windowsHide: true, stdio: "ignore" }
          );
          ps.on("error", (err) => reject(err));
          ps.on("close", (code) => {
            if (code === 0) resolve(null);
            else reject(new Error(code === 2 ? "Нет пользователя за консолью" : `Не удалось запустить игру (код ${code})`));
          });
        });

        gameCopy = {
          status: "idle",
          folder,
          percent: null,
          copiedBytes: null,
          totalBytes: null,
          message: null,
          updatedAt: new Date().toISOString(),
        };
        relaunchEdgeUi();
        gameLaunchInProgress = false;
        sendJson(res, 200, { ok: true });
      } catch (e) {
        gameLaunchInProgress = false;
        gameCopy = {
          status: "error",
          folder: null,
          percent: null,
          copiedBytes: null,
          totalBytes: null,
          message: e instanceof Error ? e.message : String(e),
          updatedAt: new Date().toISOString(),
        };
        try {
          relaunchEdgeUi();
        } catch {
          /* ignore */
        }
        sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
      }
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
const softwareCheckSec = Math.max(
  5,
  Number(fileCfg.softwareCheckIntervalSec || 5)
);

// —— Game share listing (for admin folder picker) ——
const gameShareUncRoot = String(
  process.env.STELLA_GAME_SHARE_UNC || "\\\\HYDRALISK3\\Patriot\\Игры парк победы"
).trim();
let gameShareFolders = [];
let gameShareScanBusy = false;
let lastGameShareScanAt = 0;

async function walkFolderForExes(rootDir, folderBaseDir, depthLeft, out) {
  if (out.length >= 80) return;
  if (depthLeft < 0) return;
  const entries = await fs.promises.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (out.length >= 80) break;
    const full = path.join(rootDir, e.name);
    if (e.isFile()) {
      if (String(e.name).toLowerCase().endsWith(".exe")) {
        out.push(path.relative(folderBaseDir, full));
      }
      continue;
    }
    if (e.isDirectory() && depthLeft > 0) {
      await walkFolderForExes(full, folderBaseDir, depthLeft - 1, out);
    }
  }
}

async function scanGameShareFolders() {
  const now = Date.now();
  if (gameShareScanBusy) return;
  // avoid ultra-frequent scans
  if (now - lastGameShareScanAt < 2 * 60 * 1000) return;
  gameShareScanBusy = true;
  try {
    const top = await fs.promises.readdir(gameShareUncRoot, { withFileTypes: true }).catch(() => null);
    if (!top) return;
    const folders = [];
    for (const e of top) {
      if (!e.isDirectory()) continue;
      if (folders.length >= 200) break;
      const folderName = String(e.name);
      const folderPath = joinWinPath(gameShareUncRoot, folderName);
      const exes = [];
      await walkFolderForExes(folderPath, folderPath, 3, exes);
      // only keep folders that actually contain executables
      if (exes.length) folders.push({ name: folderName, exes });
    }
    gameShareFolders = folders;
    lastGameShareScanAt = now;
  } catch {
    /* keep last listing */
  } finally {
    gameShareScanBusy = false;
  }
}

// Initial scan + periodic refresh
void scanGameShareFolders();
setInterval(() => void scanGameShareFolders(), 5 * 60 * 1000);

async function pushHeartbeat() {
  if (!serverUrl) return;
  try {
    const res = await fetch(`${serverUrl}/api/kiosks/${encodeURIComponent(kioskId)}/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contentVersion: live.contentVersion,
        syncStatus: live.syncStatus,
        syncMessage: live.syncMessage,
        appVersion,
        softwareVersion,
        hostname,
        gameShare: gameShareFolders.length ? { folders: gameShareFolders } : undefined,
      }),
    });
    if (!res.ok) return;
    try {
      const data = await res.json();
      const target = String(data.targetSoftwareVersion || "").trim();
      if (
        data.updateAvailable &&
        target &&
        !updateInProgress &&
        (target !== softwareVersion || data.forceUpdate)
      ) {
        // Outdated or admin-forced: bypass backoff so "Обновить ПО" / drift always retry.
        void applySoftwareUpdate(target, {
          force: Boolean(data.forceUpdate) || target !== softwareVersion,
        });
      }
    } catch {
      /* ignore body parse */
    }
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
      [...PS_HIDDEN, "-Command", script],
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
    "timeout /t 1 /nobreak >nul & schtasks /Run /TN StellaKioskAgent >nul 2>&1";
  const child = spawn("cmd.exe", ["/c", cmd], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  setTimeout(() => process.exit(0), 400);
}

async function downloadUpdateZip(url, dest) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`download ${res.status}`);
  if (res.body && typeof Readable.fromWeb === "function") {
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  } else {
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
  }
  const size = fs.statSync(dest).size;
  if (size < 64) throw new Error("update zip too small");
}

function extractUpdateZip(zipPath, stage) {
  // tar.exe (Windows 10+) is much faster than PowerShell Expand-Archive
  try {
    execFileSync("tar.exe", ["-xf", zipPath, "-C", stage], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  } catch {
    /* fallback */
  }
  const zipEsc = zipPath.replace(/'/g, "''");
  const stageEsc = stage.replace(/'/g, "''");
  return runPowerShell(
    `Expand-Archive -LiteralPath '${zipEsc}' -DestinationPath '${stageEsc}' -Force`
  );
}

async function applySoftwareUpdate(remoteVersion, opts = {}) {
  const force = Boolean(opts.force);
  if (!serverUrl || updateInProgress) return;
  if (!force && Date.now() < nextUpdateAllowedAt) {
    console.warn("[stella-agent] update skipped (backoff)");
    return;
  }
  // Admin left FORCE_UPDATE but files already match — clear flag, don't loop OTA.
  if (force && remoteVersion && remoteVersion === softwareVersion) {
    clearForceUpdateFlag();
    console.log(`[stella-agent] FORCE_UPDATE cleared (already on ${softwareVersion})`);
    void pushHeartbeat();
    return;
  }
  if (force) nextUpdateAllowedAt = 0;
  updateInProgress = true;
  console.log(
    `[stella-agent] software update ${softwareVersion} → ${remoteVersion}` +
      (force ? " (forced)" : "")
  );

  const stamp = Date.now();
  const zipPath = path.join(os.tmpdir(), `stella-upd-${stamp}.zip`);
  const stage = path.join(os.tmpdir(), `stella-upd-stage-${stamp}`);

  try {
    await downloadUpdateZip(`${serverUrl}/api/deploy/update.zip`, zipPath);
    fs.mkdirSync(stage, { recursive: true });
    await extractUpdateZip(zipPath, stage);

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

    for (const name of [
      "version.json",
      "VERSION",
      "install-local.ps1",
      "block-hotkeys.ps1",
      "lockdown-policies.ps1",
      "clear-policies.ps1",
    ]) {
      const src = path.join(payload, name);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(root, name));
      }
    }

    const gamesSrc = path.join(payload, "games");
    if (fs.existsSync(gamesSrc)) {
      copyRecursive(gamesSrc, path.join(root, "games"));
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
    clearForceUpdateFlag();
    console.log(
      `[stella-agent] software update applied: ${softwareVersion}` +
        (agentChanged ? " (agent changed → restart)" : " (UI only, no restart)")
    );

    // Admin "Обновляется…" clears on heartbeat — don't wait up to 30s
    try {
      await pushHeartbeat();
    } catch {
      /* ignore */
    }

    if (agentChanged) {
      // Next agent boot should hard-restart Edge (new watchdog kills then launches)
      try {
        fs.writeFileSync(path.join(root, "LAUNCH_UI"), String(Date.now()), "utf8");
      } catch {
        /* ignore */
      }
      scheduleAgentRestart();
      // Safety: if process fails to exit, allow another OTA attempt later
      setTimeout(() => {
        updateInProgress = false;
      }, 12_000);
      return;
    }
    // UI-only OTA: keep Edge alive — SPA reloads via health poll (seconds, not Edge bounce)
    console.log("[stella-agent] UI-only OTA applied — soft reload (Edge stays up)");
    try {
      fs.writeFileSync(path.join(root, "OTA_SOFT_RELOAD"), softwareVersion, "utf8");
    } catch {
      /* ignore */
    }
    lastPoliciesMode = null;
    applyOsLockdownPolicies(wantKeyBlock);
    // New block-hotkeys.ps1 only takes effect after the LL-hook process restarts
    if (wantKeyBlock && !isLockdownSuppressed()) {
      stopKeyBlockProcesses();
      setTimeout(() => {
        if (wantKeyBlock && !isLockdownSuppressed() && readBlockKeyboardFlag()) {
          relaunchKeyBlock();
        }
      }, 1_200);
    }
    updateInProgress = false;
    // Old SPA without 3s health poll: fall back to Edge relaunch
    const softVer = softwareVersion;
    setTimeout(() => {
      try {
        const p = path.join(root, "OTA_SOFT_RELOAD");
        if (!fs.existsSync(p)) return;
        if (fs.readFileSync(p, "utf8").trim() !== softVer) return;
        fs.unlinkSync(p);
        console.log("[stella-agent] soft reload timeout — relaunching Edge");
        relaunchEdgeUi();
      } catch {
        /* ignore */
      }
    }, 8_000);
  } catch (e) {
    updateFailCount += 1;
    const backoffMs = Math.min(10 * 60 * 1000, 30_000 * Math.pow(2, Math.min(updateFailCount, 4)));
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
  const forcedLocal = readForceUpdateFlag();
  if (forcedLocal) {
    // Always apply when admin forced — even if version stamp already matches
    await applySoftwareUpdate(forcedLocal, { force: true });
    return;
  }
  // Do not bail on backoff before talking to the server — forceUpdate / new
  // target must still be visible; backoff only skips the actual apply.
  try {
    const res = await fetch(
      `${serverUrl}/api/kiosks/${encodeURIComponent(kioskId)}/updates?softwareVersion=${encodeURIComponent(softwareVersion)}`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      console.warn(`[stella-agent] update check HTTP ${res.status}`);
      return;
    }
    const data = await res.json();
    if (typeof data.blockKeyboard === "boolean") {
      applyBlockKeyboardSetting(data.blockKeyboard);
    }
    if (typeof data.softwareEnabled === "boolean") {
      applySoftwareEnabledSetting(data.softwareEnabled);
    }
    const remote = String(data.softwareVersion || "").trim();
    if (!remote) return;
    if (remote === softwareVersion && !data.forceUpdate) return;
    if (data.updateAvailable === false && !data.forceUpdate) {
      console.warn(
        `[stella-agent] remote software ${remote} differs but update zip missing on server`
      );
      return;
    }
    await applySoftwareUpdate(remote, { force: Boolean(data.forceUpdate) });
  } catch (e) {
    console.warn("[stella-agent] update check failed:", e instanceof Error ? e.message : e);
  }
}

function watchForceUpdateFlag() {
  const tryApply = () => {
    if (!serverUrl || updateInProgress) return;
    const target = readForceUpdateFlag();
    if (!target) return;
    void applySoftwareUpdate(target, { force: true });
  };
  setInterval(tryApply, 250);
  try {
    const dir = path.dirname(forceUpdatePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.watch(dir, { persistent: true }, (_evt, filename) => {
      if (!filename) return;
      if (String(filename).toUpperCase() !== "FORCE_UPDATE") return;
      tryApply();
    });
    console.log("[stella-agent] FORCE_UPDATE watch on (immediate OTA)");
  } catch (e) {
    console.warn(
      "[stella-agent] FORCE_UPDATE fs.watch failed:",
      e instanceof Error ? e.message : e
    );
  }
}

if (serverUrl) {
  console.log(`[stella-agent] heartbeat → ${serverUrl} every ${heartbeatSec}s`);
  console.log(`[stella-agent] software/settings check every ${softwareCheckSec}s (local=${softwareVersion})`);
  void pushHeartbeat();
  setInterval(() => void pushHeartbeat(), heartbeatSec * 1000);
  watchForceUpdateFlag();
  // Check for OTA immediately, then every softwareCheckSec (default 5s)
  void checkSoftwareUpdate();
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
        ...PS_HIDDEN,
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
    `http://127.0.0.1:${uiPort}/?v=${encodeURIComponent(softwareVersion || "0")}`,
    `--edge-kiosk-type=fullscreen`,
    `--no-first-run`,
    `--disable-session-crashed-bubble`,
    `--noerrdialogs`,
    `--check-for-update-interval=31536000`,
    `--disable-features=msEdgeSidebar,TranslateUI,InfiniteSessionRestore,msVisualSearch,EdgeShoppingCart,msEdgeDiscover,msEdgeFeedback,msSync,Sync,EdgeCollections,msShoppingFeature,EdgeSendFeedback`,
    `--disable-pinch`,
    `--overscroll-history-navigation=0`,
    `--disable-popup-blocking`,
    `--disable-sync`,
    `--disable-background-networking`,
    `--disable-client-side-phishing-detection`,
    `--disable-component-update`,
    `--disable-default-apps`,
    `--disable-domain-reliability`,
    `--disable-breakpad`,
    `--disable-crash-reporter`,
    `--no-pings`,
    `--metrics-recording-only`,
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
  try {
    execFileSync(
      "powershell.exe",
      [
        ...PS_HIDDEN,
        "-Command",
        `$m='${marker}'; Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" -EA SilentlyContinue | ForEach-Object { if ($_.CommandLine -and $_.CommandLine -like "*$m*") { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue } }`,
      ],
      { windowsHide: true, timeout: 6_000 }
    );
  } catch {
    /* best effort */
  }
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
    ensureConsoleUserCached();
    ensureExplorerShell();
  } else {
    setSoftwareDisabledFlag(true);
    stopKeyBlockProcesses();
    applyOsLockdownPolicies(false);
    killEdgeUi();
    ensureExplorerShell();
    console.log("[stella-agent] softwareEnabled=OFF — UI stopped, Explorer on");
  }
}

function isEdgeKioskRunning() {
  // Prefer SPA /health pings (no PowerShell window). Fall back only if silent too long.
  if (Date.now() - lastSpaContactAt < 12_000) return Promise.resolve(true);
  return Promise.resolve(false);
}

const consoleUserPath = path.join(
  process.env.ProgramData || "C:\\ProgramData",
  "StellaKiosk",
  "CONSOLE_USER"
);
let explorerReady = false;

function readCachedConsoleUser() {
  try {
    const v = fs.readFileSync(consoleUserPath, "utf8").trim();
    return v || null;
  } catch {
    return null;
  }
}

function writeCachedConsoleUser(user) {
  try {
    fs.mkdirSync(path.dirname(consoleUserPath), { recursive: true });
    fs.writeFileSync(consoleUserPath, String(user).trim(), "utf8");
  } catch {
    /* ignore */
  }
}

/** Resolve interactive DOMAIN\\user without requiring explorer.exe. */
function resolveInteractiveUserPs(cachedUser) {
  const cached = String(cachedUser || "").replace(/'/g, "''");
  return `
$ErrorActionPreference = 'SilentlyContinue'
function Emit-User([string]$u) {
  if ([string]::IsNullOrWhiteSpace($u)) { return $false }
  if ($u -match '^(NT AUTHORITY\\\\|Window Manager\\\\|IIS APPPOOL\\\\)') { return $false }
  Write-Output $u.Trim()
  return $true
}
$cs = Get-CimInstance Win32_ComputerSystem
if ($cs -and $cs.UserName) { if (Emit-User $cs.UserName) { exit 0 } }
$proc = Get-CimInstance Win32_Process -Filter "Name = 'explorer.exe'" | Select-Object -First 1
if ($proc) {
  $o = Invoke-CimMethod -InputObject $proc -MethodName GetOwner
  if ($o -and $o.User) {
    $u = if ($o.Domain) { "$($o.Domain)\\$($o.User)" } else { $o.User }
    if (Emit-User $u) { exit 0 }
  }
}
Get-CimInstance Win32_Process | ForEach-Object {
  if ($_.SessionId -gt 0 -and $_.Name -match '^(msedge|sihost|taskhostw|ApplicationFrameHost|ShellExperienceHost)\\.exe$') {
    $o = Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue
    if ($o -and $o.User -and $o.User -notin @('SYSTEM','LOCAL SERVICE','NETWORK SERVICE')) {
      $u = if ($o.Domain) { "$($o.Domain)\\$($o.User)" } else { $o.User }
      if (Emit-User $u) { exit 0 }
    }
  }
}
$cached = '${cached}'
if ($cached) { if (Emit-User $cached) { exit 0 } }
Write-Output 'no-user'
exit 2
`;
}

function ensureConsoleUserCached() {
  try {
    const out = execFileSync(
      "powershell.exe",
      [
        ...PS_HIDDEN,
        "-Command",
        resolveInteractiveUserPs(readCachedConsoleUser()),
      ],
      { windowsHide: true, timeout: 10_000, encoding: "utf8" }
    );
    const user = String(out || "").trim().split(/\r?\n/).filter(Boolean).pop();
    if (user && user !== "no-user") {
      writeCachedConsoleUser(user);
      return user;
    }
  } catch {
    /* ignore */
  }
  return readCachedConsoleUser();
}

function setExplorerAutoRestart(enabled) {
  try {
    execFileSync(
      "reg.exe",
      [
        "add",
        "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon",
        "/v",
        "AutoRestartShell",
        "/t",
        "REG_SZ",
        "/d",
        enabled ? "1" : "0",
        "/f",
      ],
      { windowsHide: true, stdio: "ignore" }
    );
  } catch {
    /* ignore */
  }
}

/** Full Explorer shell: desktop + taskbar visible, process kept running. */
function ensureExplorerShell() {
  setExplorerAutoRestart(true);
  const user = ensureConsoleUserCached() || readCachedConsoleUser();
  const userEsc = String(user || "").replace(/'/g, "''");
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$pol = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer'
if (Test-Path $pol) { Remove-ItemProperty -Path $pol -Name 'NoDesktop' -ErrorAction SilentlyContinue }

function Start-ExplorerIfNeeded {
  if (Get-Process -Name explorer -ErrorAction SilentlyContinue) { return 'already' }
  $user = '${userEsc}'
  if (-not $user) {
    Start-Process -FilePath explorer.exe -ErrorAction SilentlyContinue | Out-Null
    return 'local'
  }
  $once = 'StellaKioskStartExplorer'
  $action = New-ScheduledTaskAction -Execute 'explorer.exe'
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances Parallel
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
  Unregister-ScheduledTask -TaskName $once -Confirm:$false -ErrorAction SilentlyContinue
  Register-ScheduledTask -TaskName $once -Action $action -Principal $principal -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName $once -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800
  Unregister-ScheduledTask -TaskName $once -Confirm:$false -ErrorAction SilentlyContinue
  return "started:$user"
}

$ex = Start-ExplorerIfNeeded
$user = '${userEsc}'
$inner = @'
$ErrorActionPreference = "SilentlyContinue"
$adv = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced"
if (-not (Test-Path $adv)) { New-Item -Path $adv -Force | Out-Null }
New-ItemProperty -Path $adv -Name "HideIcons" -Value 0 -PropertyType DWord -Force | Out-Null
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class StellaTrayShow {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string w);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a, uint b, IntPtr c, uint d);
}
"@
foreach ($cls in @("Shell_TrayWnd","Shell_SecondaryTrayWnd")) {
  $h = [StellaTrayShow]::FindWindow($cls, $null)
  if ($h -ne [IntPtr]::Zero) { [void][StellaTrayShow]::ShowWindow($h, 5) }
}
[void][StellaTrayShow]::SystemParametersInfo(0x0014, 0, [IntPtr]::Zero, 3)
'@
if ($user) {
  $tmp = Join-Path $env:TEMP ('stella-shell-show-' + [guid]::NewGuid().ToString('n') + '.ps1')
  Set-Content -Path $tmp -Value $inner -Encoding ASCII
  $once = 'StellaKioskShellChrome'
  $arg = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $tmp + '"'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances Parallel -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
  Unregister-ScheduledTask -TaskName $once -Confirm:$false -ErrorAction SilentlyContinue
  Register-ScheduledTask -TaskName $once -Action $action -Principal $principal -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName $once -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 900
  Unregister-ScheduledTask -TaskName $once -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item -Path $tmp -Force -ErrorAction SilentlyContinue
}
Write-Output ("explorer-shell ok=$ex")
`;
  // Non-blocking — sync PowerShell here freezes OTA / health on the agent event loop
  const ps = spawn(
    "powershell.exe",
    [...PS_HIDDEN, "-Command", script],
    { windowsHide: true }
  );
  ps.on("error", () => {});
  ps.on("close", (code) => {
    if (!explorerReady) {
      console.log(`[stella-agent] Explorer shell ensured (full desktop/taskbar) code=${code ?? "?"}`);
    }
    explorerReady = true;
  });
}

function suppressExplorerShell() {
  // Kept for call sites — no longer hides/kills Explorer
  ensureExplorerShell();
}

function restoreExplorerShell() {
  ensureExplorerShell();
}

function relaunchEdgeUi() {
  const edge = findEdgeExe();
  if (!edge) {
    console.warn("[stella-agent] Edge not found — cannot relaunch UI");
    return;
  }
  // Always close existing kiosk Edge first — IgnoreNew previously left stale UI on screen after OTA
  killEdgeUi();
  // Corrupted Chromium IndexedDB → "backing store" errors and blank gallery images
  try {
    const idb = path.join(edgeProfileDir(), "Default", "IndexedDB");
    if (fs.existsSync(idb)) fs.rmSync(idb, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  const args = edgeUiArgs();
  const cached = readCachedConsoleUser() || "";
  // Must run on the interactive desktop of the logged-on user (SYSTEM Session 0 is invisible).
  // Do NOT require explorer.exe — console user may be resolved via Edge/sihost.
  const script2 = `
$ErrorActionPreference = 'Stop'
$edge = '${edge.replace(/'/g, "''")}'
$uiArgs = '${args.replace(/'/g, "''")}'
$once = 'StellaKioskStartNow'
$taskUi = 'StellaKioskUI'
$cachePath = '${consoleUserPath.replace(/'/g, "''")}'
$cached = '${cached.replace(/'/g, "''")}'

function Resolve-User {
  $ErrorActionPreference = 'SilentlyContinue'
  $cs = Get-CimInstance Win32_ComputerSystem
  if ($cs -and $cs.UserName) { return $cs.UserName }
  $proc = Get-CimInstance Win32_Process -Filter "Name = 'explorer.exe'" | Select-Object -First 1
  if ($proc) {
    $o = Invoke-CimMethod -InputObject $proc -MethodName GetOwner
    if ($o -and $o.User) {
      if ($o.Domain) { return "$($o.Domain)\\$($o.User)" }
      return $o.User
    }
  }
  Get-CimInstance Win32_Process | ForEach-Object {
    if ($_.SessionId -gt 0 -and $_.Name -match '^(msedge|sihost|taskhostw|ApplicationFrameHost)\\.exe$') {
      $o = Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue
      if ($o -and $o.User -and $o.User -notin @('SYSTEM','LOCAL SERVICE','NETWORK SERVICE')) {
        if ($o.Domain) { return "$($o.Domain)\\$($o.User)" }
        return $o.User
      }
    }
  }
  if ($cached) { return $cached }
  return $null
}

$user = Resolve-User
if (-not $user) {
  Write-Output 'no-user'
  exit 2
}
try { Set-Content -Path $cachePath -Value $user -Encoding ASCII -Force } catch {}

$action = New-ScheduledTaskAction -Execute $edge -Argument $uiArgs
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances Parallel
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest

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
    [...PS_HIDDEN, "-Command", script2],
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
    if (code === 0) {
      console.log(`[stella-agent] Edge UI launched (${msg || "ok"})`);
      const m = /ok:(.+)$/m.exec(msg);
      if (m?.[1]) writeCachedConsoleUser(m[1].trim());
    } else console.warn(`[stella-agent] Edge UI launch failed code=${code} ${msg}`);
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
    restoreExplorerShell();
    return;
  }
  edgeWatchBusy = true;
  try {
    if (updateInProgress) return;
    if (gameLaunchInProgress) return;
    ensureConsoleUserCached();
    if (!explorerReady) ensureExplorerShell();
    const forceLaunch = consumeLaunchUiFlag();
    const running = await isEdgeKioskRunning();
    if (forceLaunch || !running) {
      const now = Date.now();
      if (!forceLaunch && now - lastEdgeRelaunchAt < 20_000) {
        /* wait for SPA health ping / Edge boot */
      } else {
        lastEdgeRelaunchAt = now;
        console.warn(
          forceLaunch
            ? "[stella-agent] LAUNCH_UI flag — starting Edge"
            : "[stella-agent] Edge UI missing — restarting (close only from admin)"
        );
        relaunchEdgeUi();
      }
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
    if (!fs.existsSync(blockKeyboardFlagPath)) return true; // floor default: locked
    const v = fs.readFileSync(blockKeyboardFlagPath, "utf8").trim().toLowerCase();
    return v === "1" || v === "true" || v === "on";
  } catch {
    return true;
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
      ...PS_HIDDEN,
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
    try {
      const pidPath = path.join(programDataRoot, "KEYBLOCK.pid");
      if (fs.existsSync(pidPath)) {
        const pid = Number(String(fs.readFileSync(pidPath, "utf8")).trim());
        if (processExists(pid)) {
          resolve(true);
          return;
        }
      }
    } catch {
      /* fall through */
    }
    resolve(false);
  });
}

function stopKeyBlockProcesses() {
  try {
    const pidPath = path.join(programDataRoot, "KEYBLOCK.pid");
    if (fs.existsSync(pidPath)) {
      const pid = Number(String(fs.readFileSync(pidPath, "utf8")).trim());
      if (processExists(pid)) {
        try {
          process.kill(pid);
        } catch {
          /* ignore */
        }
      }
      try {
        fs.unlinkSync(pidPath);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
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
  spawn("powershell.exe", [...PS_HIDDEN, "-Command", script], {
    windowsHide: true,
    stdio: "ignore",
  });
}

function relaunchKeyBlock() {
  if (!fs.existsSync(keyBlockScriptPath)) {
    console.warn("[stella-agent] block-hotkeys.ps1 missing — OS hotkeys not blocked");
    return;
  }
  writeBlockKeyboardFlag(true);
  const scriptPath = keyBlockScriptPath.replace(/'/g, "''");
  const cached = (readCachedConsoleUser() || "").replace(/'/g, "''");
  const cachePath = consoleUserPath.replace(/'/g, "''");
  const script = `
$ErrorActionPreference = 'Stop'
$ps1 = '${scriptPath}'
$once = 'StellaKioskKeyBlockNow'
$task = 'StellaKioskKeyBlock'
$cachePath = '${cachePath}'
$cached = '${cached}'

function Resolve-User {
  $ErrorActionPreference = 'SilentlyContinue'
  $cs = Get-CimInstance Win32_ComputerSystem
  if ($cs -and $cs.UserName) { return $cs.UserName }
  $proc = Get-CimInstance Win32_Process -Filter "Name = 'explorer.exe'" | Select-Object -First 1
  if ($proc) {
    $o = Invoke-CimMethod -InputObject $proc -MethodName GetOwner
    if ($o -and $o.User) {
      if ($o.Domain) { return "$($o.Domain)\\$($o.User)" }
      return $o.User
    }
  }
  Get-CimInstance Win32_Process | ForEach-Object {
    if ($_.SessionId -gt 0 -and $_.Name -match '^(msedge|sihost|taskhostw|ApplicationFrameHost)\\.exe$') {
      $o = Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue
      if ($o -and $o.User -and $o.User -notin @('SYSTEM','LOCAL SERVICE','NETWORK SERVICE')) {
        if ($o.Domain) { return "$($o.Domain)\\$($o.User)" }
        return $o.User
      }
    }
  }
  if ($cached) { return $cached }
  return $null
}

$user = Resolve-User
if (-not $user) { Write-Output 'no-user'; exit 2 }
try { Set-Content -Path $cachePath -Value $user -Encoding ASCII -Force } catch {}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \`"$ps1\`"")
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances Parallel -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
$trigger = New-ScheduledTaskTrigger -AtLogOn

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
    [...PS_HIDDEN, "-Command", script],
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
  if (running) return;
  const now = Date.now();
  // Avoid spawning PowerShell every watchdog tick when keyblock keeps failing
  if (now - lastKeyblockRelaunchAt < 45_000) return;
  lastKeyblockRelaunchAt = now;
  relaunchKeyBlock();
}

// Respect manual policy clear + flag file on disk
if (isLockdownSuppressed() || !readBlockKeyboardFlag()) {
  wantKeyBlock = false;
}
writeBlockKeyboardFlag(wantKeyBlock);
applyOsLockdownPolicies(wantKeyBlock);
setTimeout(() => void watchEdgeUi(), 1_000);
setInterval(() => void watchEdgeUi(), 3_000);
// LAUNCH_UI from admin Start — react within ~1s, not only on the 8s watchdog tick
setInterval(() => {
  try {
    if (fs.existsSync(launchUiFlagPath)) void watchEdgeUi();
  } catch {
    /* ignore */
  }
}, 1_000);
try {
  fs.watchFile(launchUiFlagPath, { interval: 400 }, () => {
    void watchEdgeUi();
  });
} catch {
  /* ignore */
}
console.log(`[stella-agent] Edge UI watchdog on (interactive session); stop flag ${stopFlagPath}`);
console.log(`[stella-agent] OS keyboard block (all keys + Keyboard Filter CAD) enabled=${wantKeyBlock}`);

