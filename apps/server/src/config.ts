import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(root, ".env") });
dotenv.config();

const isProd = process.env.NODE_ENV === "production";

const jwtSecret = process.env.JWT_SECRET || "dev-secret";
if (isProd) {
  const weak = !process.env.JWT_SECRET || jwtSecret === "dev-secret" || jwtSecret === "dev-secret-change-me";
  if (weak) {
    throw new Error(
      "В production задайте сильный JWT_SECRET в .env (не оставляйте значение по умолчанию)."
    );
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("В production обязателен DATABASE_URL.");
  }
}

const adminDist = resolveRepoPath(
  process.env.ADMIN_DIST,
  path.join(root, "apps/admin/dist")
);

export const config = {
  isProd,
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || "0.0.0.0",
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || (isProd ? "12h" : "7d"),
  // Relative MEDIA_DIR must be from repo root (pnpm filter cwd is apps/server)
  mediaDir: resolveRepoPath(process.env.MEDIA_DIR, path.join(root, "data/media")),
  adminDist,
  serveAdmin: process.env.SERVE_ADMIN !== "0" && existsSync(path.join(adminDist, "index.html")),
  corsOrigin: (process.env.CORS_ORIGIN || (isProd ? "" : "*"))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  onlineThresholdMs: 2 * 60 * 1000,
  probeIntervalMs: Number(process.env.PROBE_INTERVAL_MS || 30000),
  probeTimeoutMs: Number(process.env.PROBE_TIMEOUT_MS || 2500),
  serverPublicUrl: (process.env.SERVER_PUBLIC_URL || `http://127.0.0.1:${process.env.PORT || 8080}`).replace(
    /\/$/,
    ""
  ),
  deployPackageDir: resolveRepoPath(
    process.env.DEPLOY_PACKAGE_DIR,
    path.join(root, "data/deploy/current")
  ),
  deployUser: normalizeDeployUser(process.env.DEPLOY_USER || ""),
  deployPassword: process.env.DEPLOY_PASSWORD || "",
  /** auto | winrm | ssh — управление Windows-киосками с Debian/Linux-сервера */
  deployTransport: normalizeDeployTransport(process.env.DEPLOY_TRANSPORT || "auto"),
  deployPowerShell: (process.env.DEPLOY_POWERSHELL || "").trim(),
  deploySshPort: Number(process.env.DEPLOY_SSH_PORT || 22),
  deploySshKeyPath: (process.env.DEPLOY_SSH_KEY_PATH || "").trim(),
};

function normalizeDeployTransport(raw: string): "auto" | "winrm" | "ssh" {
  const v = raw.trim().toLowerCase();
  if (v === "winrm" || v === "ssh") return v;
  return "auto";
}

function resolveRepoPath(raw: string | undefined, fallback: string) {
  if (!raw || !raw.trim()) return fallback;
  const p = raw.trim();
  if (path.isAbsolute(p)) return path.normalize(p);
  return path.resolve(root, p);
}

function normalizeDeployUser(raw: string) {
  let u = raw.trim().replace(/^["']|["']$/g, "");
  // .env often stores domain\\user → collapse to domain\user
  while (u.includes("\\\\")) u = u.replaceAll("\\\\", "\\");
  // allow domain/user
  if (/^[^\\/@]+\/[^\\/@]+$/.test(u)) {
    const [domain, user] = u.split("/");
    u = `${domain}\\${user}`;
  }
  return u;
}
