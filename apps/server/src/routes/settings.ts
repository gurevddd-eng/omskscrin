import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { authenticate, requireRoles } from "../auth.js";
import { config } from "../config.js";
import {
  getEffectiveDeploy,
  refreshDeployCredentialsFromDb,
  toDeployDto,
} from "../deployCredentials.js";
import { ensureSiteSettings } from "../siteSettings.js";
import {
  getEffectiveCorsOrigins,
  getRuntimeNetworkInfo,
  getSiteNetworkSettings,
  loadNetworkRuntimeFromDb,
  parseCorsOrigins,
} from "../networkSettings.js";

const putSchema = z.object({
  blockKeyboard: z.boolean(),
  softwareEnabled: z.boolean(),
});

const networkPutSchema = z.object({
  serverPublicUrl: z.union([z.string().url(), z.literal("")]).optional(),
  defaultHealthPort: z.number().int().min(1).max(65535).optional(),
  defaultUiPort: z.number().int().min(1).max(65535).optional(),
  corsOrigins: z.string().max(4000).optional(),
  probeIntervalMs: z.number().int().min(5000).max(600000).optional(),
  probeTimeoutMs: z.number().int().min(500).max(60000).optional(),
});

const deployPutSchema = z.object({
  deployUser: z.string().min(1).max(200),
  /** Omit or null = keep existing password; empty string clears */
  deployPassword: z.string().max(500).nullable().optional(),
  domainSuffix: z.string().min(1).max(200),
  deployTransport: z.enum(["auto", "ssh", "winrm"]),
});

function bumpVersion(current: string) {
  const n = Number(current);
  if (Number.isFinite(n)) return String(n + 1);
  return createHash("sha1").update(`${current}-${Date.now()}`).digest("hex").slice(0, 12);
}

export { ensureSiteSettings } from "../siteSettings.js";

export async function getSiteSettingsDto() {
  const s = await ensureSiteSettings();
  const network = await getSiteNetworkSettings();
  return {
    blockKeyboard: s.blockKeyboard,
    softwareEnabled: s.softwareEnabled,
    settingsVersion: s.settingsVersion,
    adsVersion: s.adsVersion,
    updatedAt: s.updatedAt.toISOString(),
    network: {
      serverPublicUrl: s.serverPublicUrl ?? "",
      effectiveServerPublicUrl: network.serverPublicUrl,
      defaultHealthPort: s.defaultHealthPort,
      defaultUiPort: s.defaultUiPort,
      corsOrigins: s.corsOrigins,
      effectiveCorsOrigins: await getEffectiveCorsOrigins(),
      probeIntervalMs: s.probeIntervalMs,
      probeTimeoutMs: s.probeTimeoutMs,
    },
  };
}

export function syncFingerprint(
  contentVersion: string | null | undefined,
  adsVersion: string,
  settingsVersion = "0",
  timelineVersion = "0"
) {
  return `${contentVersion ?? "0"}|${adsVersion}|${settingsVersion}|${timelineVersion}`;
}

export async function registerSettingsRoutes(app: FastifyInstance) {
  app.get("/api/settings", { preHandler: authenticate }, async () => getSiteSettingsDto());

  app.get("/api/system/network", { preHandler: authenticate }, async () => {
    const runtime = getRuntimeNetworkInfo();
    const site = await getSiteNetworkSettings();
    const effectiveCors = await getEffectiveCorsOrigins();
    return {
      runtime: {
        ...runtime,
        effectiveServerPublicUrl: site.serverPublicUrl,
        effectiveCorsOrigins: effectiveCors,
        probeIntervalMs: site.probeIntervalMs,
        probeTimeoutMs: site.probeTimeoutMs,
        defaultHealthPort: site.defaultHealthPort,
        defaultUiPort: site.defaultUiPort,
        envServerPublicUrl: config.serverPublicUrl,
        envCorsOrigins: config.corsOrigin,
      },
      endpoints: {
        api: `${site.serverPublicUrl}/api`,
        admin: `${runtime.bindUrl}/`,
        monitorSse: `${site.serverPublicUrl}${runtime.monitorStreamPath}?token=…`,
        kioskHealthDefault: `http://{hostname}:${site.defaultHealthPort}/health`,
        kioskUiDefault: `http://127.0.0.1:${site.defaultUiPort}/`,
        winRm: "5985 (TCP, не настраивается в админке)",
      },
      note:
        "PORT, HOST и SERVE_ADMIN читаются из .env при старте сервера. CORS из админки применяется после перезапуска.",
    };
  });

  app.put("/api/settings", { preHandler: requireRoles("admin", "editor") }, async (request) => {
    const body = putSchema.parse(request.body);
    const current = await ensureSiteSettings();
    await prisma.siteSettings.update({
      where: { id: "default" },
      data: {
        blockKeyboard: body.blockKeyboard,
        softwareEnabled: body.softwareEnabled,
        settingsVersion: bumpVersion(current.settingsVersion),
      },
    });
    return getSiteSettingsDto();
  });

  app.put("/api/settings/network", { preHandler: requireRoles("admin", "editor") }, async (request) => {
    const body = networkPutSchema.parse(request.body);
    const current = await ensureSiteSettings();
    const data: {
      serverPublicUrl?: string | null;
      defaultHealthPort?: number;
      defaultUiPort?: number;
      corsOrigins?: string;
      probeIntervalMs?: number;
      probeTimeoutMs?: number;
      settingsVersion: string;
    } = {
      settingsVersion: bumpVersion(current.settingsVersion),
    };

    if (body.serverPublicUrl !== undefined) {
      const v = body.serverPublicUrl.trim().replace(/\/$/, "");
      data.serverPublicUrl = v || null;
    }
    if (body.defaultHealthPort !== undefined) data.defaultHealthPort = body.defaultHealthPort;
    if (body.defaultUiPort !== undefined) data.defaultUiPort = body.defaultUiPort;
    if (body.corsOrigins !== undefined) {
      data.corsOrigins = parseCorsOrigins(body.corsOrigins).join(",");
    }
    if (body.probeIntervalMs !== undefined) data.probeIntervalMs = body.probeIntervalMs;
    if (body.probeTimeoutMs !== undefined) data.probeTimeoutMs = body.probeTimeoutMs;

    await prisma.siteSettings.update({ where: { id: "default" }, data });
    await loadNetworkRuntimeFromDb();
    return getSiteSettingsDto();
  });

  app.get("/api/settings/deploy", { preHandler: requireRoles("admin") }, async () => {
    await refreshDeployCredentialsFromDb();
    return toDeployDto(getEffectiveDeploy());
  });

  app.put("/api/settings/deploy", { preHandler: requireRoles("admin") }, async (request) => {
    const body = deployPutSchema.parse(request.body);
    const current = await ensureSiteSettings();
    const data: {
      deployUser: string;
      deployPassword?: string | null;
      domainSuffix: string;
      deployTransport: string;
    } = {
      deployUser: body.deployUser.trim(),
      domainSuffix: body.domainSuffix.trim().replace(/^\./, "") || "udhb.local",
      deployTransport: body.deployTransport,
    };
    if (body.deployPassword !== undefined && body.deployPassword !== null) {
      data.deployPassword = body.deployPassword;
    } else {
      // keep existing
      data.deployPassword = current.deployPassword;
    }
    await prisma.siteSettings.update({ where: { id: "default" }, data });
    const deploy = await refreshDeployCredentialsFromDb();
    return toDeployDto(deploy);
  });
}
