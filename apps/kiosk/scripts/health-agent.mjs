import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function loadJsonConfig() {
  const candidates = [
    process.env.STELLA_KIOSK_CONFIG,
    path.join(root, "public", "kiosk.json"),
    path.join(process.cwd(), "kiosk.json"),
  ].filter(Boolean);

  for (const file of candidates) {
    try {
      if (file && fs.existsSync(file)) {
        return JSON.parse(stripBom(fs.readFileSync(file, "utf8")));
      }
    } catch {
      /* try next */
    }
  }
  return {};
}

const fileCfg = loadJsonConfig();
const hostname = String(fileCfg.hostname || fileCfg.kioskId || os.hostname())
  .trim()
  .toLowerCase();
const kioskId = String(fileCfg.kioskId || hostname).trim().toLowerCase();
const appVersion = String(fileCfg.appVersion || "0.1.0");
const port = Number(fileCfg.healthPort || process.env.HEALTH_PORT || 47821);

/** Optional live status posted by UI (same machine). */
let live = {
  contentVersion: null,
  syncStatus: "unknown",
  syncMessage: null,
  updatedAt: null,
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

  if (req.method === "GET" && url.pathname === "/health") {
    const body = JSON.stringify({
      ok: true,
      hostname,
      kioskId,
      appVersion,
      contentVersion: live.contentVersion,
      syncStatus: live.syncStatus,
      syncMessage: live.syncMessage,
      updatedAt: live.updatedAt,
      agent: "stella-kiosk-health",
    });
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(body);
    return;
  }

  if (req.method === "OPTIONS" && url.pathname === "/status") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
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
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(port, "0.0.0.0", () => {
  console.log(
    `[stella-health] listening on 0.0.0.0:${port} hostname=${hostname} kioskId=${kioskId}`
  );
});
