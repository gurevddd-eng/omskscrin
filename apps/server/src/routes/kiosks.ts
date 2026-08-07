import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { authenticate, requireRoles } from "../auth.js";
import { toFileDto } from "./files.js";
import {
  addMonitorClient,
  broadcastKioskRemoved,
  broadcastKioskUpsert,
  broadcastSnapshot,
  sendToClient,
} from "../monitorHub.js";
import {
  loadKioskSnapshot,
  mapKiosk,
  normalizeHostname,
  probeKioskById,
} from "../kioskProbe.js";
import { expandHostname, getEffectiveDeploy, refreshDeployCredentialsFromDb } from "../deployCredentials.js";
import { testWindowsHostConnection } from "../deployTest.js";
import { parseSpecs } from "./exhibits.js";
import { getGlobalAdsState, syncFingerprint } from "./ads.js";
import { getGlobalTimelineState } from "./timeline.js";
import { ensureSiteSettings } from "../siteSettings.js";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { cancelKioskInstall, clearInstallCancelRequest, deployPackageReady, startKioskInstall } from "../remoteInstall.js";
import { enrichKioskDto } from "../kioskDtoEnrich.js";
import { requestClearKioskPolicies } from "../remoteClearPolicies.js";
import { requestStartKioskRuntime } from "../remoteStart.js";
import { requestStopKioskRuntime } from "../remoteStop.js";
import { prepareKioskDeletion } from "../kioskDeletion.js";
import { uninstallKioskRuntime } from "../remoteUninstall.js";
import { pushKioskConfig } from "../remotePushConfig.js";
import { getDeployMeta, getDeployStatusDetail } from "../deployMeta.js";

function resolveKioskHostname(raw: string) {
  return expandHostname(normalizeHostname(raw), getEffectiveDeploy().domainSuffix);
}

function bumpSettingsVersion(current: string) {
  const n = Number(current);
  if (Number.isFinite(n)) return String(n + 1);
  return createHash("sha1").update(`${current}-${Date.now()}`).digest("hex").slice(0, 12);
}

const kioskSchema = z.object({
  hostname: z.string().min(1),
  name: z.string().min(1).optional(),
  healthPort: z.number().int().min(1).max(65535).optional(),
  uiPort: z.number().int().min(1).max(65535).optional(),
  serverUrl: z.union([z.string().url(), z.literal("")]).nullable().optional(),
  exhibitId: z.string().nullable().optional(),
  installSoftware: z.boolean().optional(),
});

const heartbeatSchema = z.object({
  contentVersion: z.string().nullable().optional(),
  syncStatus: z.enum(["ok", "error", "unknown"]).optional(),
  syncMessage: z.string().nullable().optional(),
  appVersion: z.string().nullable().optional(),
  hostname: z.string().optional(),
});

export async function registerKioskRoutes(app: FastifyInstance) {
  const refreshTimer = setInterval(async () => {
    try {
      broadcastSnapshot((await loadKioskSnapshot()).map(enrichKioskDto));
    } catch (err) {
      app.log.error(err);
    }
  }, 5000);
  app.addHook("onClose", async () => clearInterval(refreshTimer));

  app.get("/api/kiosks/monitor/stream", async (request, reply) => {
    const q = request.query as { token?: string };
    const token = q.token || request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    try {
      await app.jwt.verify(token);
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(": connected\n\n");
    addMonitorClient(reply.raw);

    try {
      const kiosks = await loadKioskSnapshot();
      sendToClient(reply.raw, "snapshot", { kiosks, at: new Date().toISOString() });
    } catch (err) {
      app.log.error(err);
      sendToClient(reply.raw, "error", { message: "Failed to load snapshot" });
    }

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`: ping ${Date.now()}\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 15000);

    request.raw.on("close", () => clearInterval(heartbeat));
  });

  app.get("/api/kiosks", { preHandler: authenticate }, async () => {
    const list = await loadKioskSnapshot();
    return list.map(enrichKioskDto);
  });

  app.get("/api/kiosks/deploy/status", { preHandler: authenticate }, async () => getDeployStatusDetail());

  app.post(
    "/api/kiosks/test-connection",
    { preHandler: requireRoles("admin", "editor") },
    async (request) => {
      const body = z.object({ hostname: z.string().min(1) }).parse(request.body);
      await refreshDeployCredentialsFromDb();
      return testWindowsHostConnection(body.hostname);
    }
  );

  /** Wipe Stella from all kiosk PCs (tasks, folder, keyboard policies) and reset global lockdown settings. */
  app.post(
    "/api/kiosks/rollback-all",
    { preHandler: requireRoles("admin", "editor") },
    async (request) => {
      const body = z
        .object({
          /** Also delete kiosk rows from admin DB (default: keep for reinstall) */
          removeFromAdmin: z.boolean().optional(),
        })
        .parse(request.body ?? {});

      const list = await prisma.kiosk.findMany({
        orderBy: { hostname: "asc" },
        select: { id: true, hostname: true, name: true },
      });

      const results: Array<{
        id: string;
        hostname: string;
        name: string;
        ok: boolean;
        message: string;
        removedFromAdmin: boolean;
      }> = [];

      for (const k of list) {
        const un = await uninstallKioskRuntime(k.id);
        let removedFromAdmin = false;
        if (body.removeFromAdmin) {
          try {
            await prisma.kiosk.delete({ where: { id: k.id } });
            broadcastKioskRemoved(k.id);
            removedFromAdmin = true;
          } catch {
            /* keep row if already gone */
          }
        } else {
          // Clear install status so UI does not look "running"
          try {
            await prisma.kiosk.update({
              where: { id: k.id },
              data: {
                installStatus: "idle",
                installStage: "idle",
                installMessage: un.ok ? "Откат: софт снят с ПК" : `Откат с ошибкой: ${un.message}`,
                syncStatus: "unknown",
                syncMessage: un.ok ? "софт удалён с ПК" : un.message,
              },
            });
            const probed = await probeKioskById(k.id);
            if (probed) broadcastKioskUpsert(probed);
          } catch {
            /* ignore */
          }
        }
        results.push({
          id: k.id,
          hostname: k.hostname,
          name: k.name,
          ok: un.ok,
          message: un.message,
          removedFromAdmin,
        });
      }

      const settings = await ensureSiteSettings();
      await prisma.siteSettings.update({
        where: { id: "default" },
        data: {
          softwareEnabled: true,
          blockKeyboard: false,
          settingsVersion: bumpSettingsVersion(settings.settingsVersion),
        },
      });

      const okCount = results.filter((r) => r.ok).length;
      return {
        ok: results.length === 0 || okCount === results.length,
        total: results.length,
        okCount,
        failCount: results.length - okCount,
        results,
        settings: {
          softwareEnabled: true,
          blockKeyboard: false,
        },
        message:
          results.length === 0
            ? "Киосков в списке нет — ограничения в настройках сброшены"
            : `Откат: ${okCount}/${results.length} ПК очищены; клавиатура и глобальный выкл. сброшены`,
      };
    }
  );

  app.post("/api/kiosks", { preHandler: requireRoles("admin", "editor") }, async (request, reply) => {
    const body = kioskSchema.parse(request.body);
    await refreshDeployCredentialsFromDb();
    const hostname = resolveKioskHostname(body.hostname);
    if (!hostname) return reply.code(400).send({ error: "hostname required" });

    try {
      const k = await prisma.kiosk.create({
        data: {
          hostname,
          kioskId: hostname,
          name: body.name?.trim() || hostname,
          healthPort: body.healthPort ?? 47821,
          uiPort: body.uiPort ?? 47820,
          serverUrl: body.serverUrl ?? null,
          exhibitId: body.exhibitId ?? null,
          installStatus: body.installSoftware ? "queued" : "idle",
          installStage: body.installSoftware ? "queued" : "idle",
          installMessage: body.installSoftware ? "В очереди" : null,
        },
        include: { exhibit: { select: { title: true } } },
      });
      const dto = mapKiosk(k);
      broadcastKioskUpsert(dto);
      void probeKioskById(k.id);
      if (body.installSoftware) {
        void startKioskInstall(k.id);
      }
      return dto;
    } catch {
      return reply.code(409).send({ error: "hostname / kioskId already exists" });
    }
  });

  app.patch(
    "/api/kiosks/:id",
    { preHandler: requireRoles("admin", "editor") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = kioskSchema.partial().parse(request.body);
      const data: {
        hostname?: string;
        kioskId?: string;
        name?: string;
        healthPort?: number;
        uiPort?: number;
        serverUrl?: string | null;
        exhibitId?: string | null;
      } = {};
      if (body.hostname) {
        await refreshDeployCredentialsFromDb();
        const hostname = resolveKioskHostname(body.hostname);
        data.hostname = hostname;
        data.kioskId = hostname;
      }
      if (body.name !== undefined) data.name = body.name;
      if (body.healthPort !== undefined) data.healthPort = body.healthPort;
      if (body.uiPort !== undefined) data.uiPort = body.uiPort;
      if (body.serverUrl !== undefined) {
        const v = body.serverUrl?.trim().replace(/\/$/, "");
        data.serverUrl = v || null;
      }
      if (body.exhibitId !== undefined) data.exhibitId = body.exhibitId;

      try {
        const k = await prisma.kiosk.update({
          where: { id },
          data,
          include: { exhibit: { select: { title: true } } },
        });
        const dto = mapKiosk(k);
        broadcastKioskUpsert(dto);
        if (body.hostname || body.healthPort || body.uiPort) void probeKioskById(id);
        return dto;
      } catch {
        return reply.code(404).send({ error: "Not found" });
      }
    }
  );

  app.post(
    "/api/kiosks/:id/probe",
    { preHandler: requireRoles("admin", "editor", "viewer") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const dto = await probeKioskById(id);
      if (!dto) return reply.code(404).send({ error: "Not found" });
      return dto;
    }
  );

  app.post(
    "/api/kiosks/:id/install",
    { preHandler: requireRoles("admin", "editor") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = await prisma.kiosk.findUnique({
        where: { id },
        include: { exhibit: { select: { title: true } } },
      });
      if (!existing) return reply.code(404).send({ error: "Not found" });

      clearInstallCancelRequest(id);

      const queued = await prisma.kiosk.update({
        where: { id },
        data: {
          installStatus: "queued",
          installStage: "queued",
          installMessage: "В очереди",
          lastInstallAt: new Date(),
        },
        include: { exhibit: { select: { title: true } } },
      });
      const dto = mapKiosk(queued);
      broadcastKioskUpsert(dto);
      void startKioskInstall(id);
      return dto;
    }
  );

  app.post(
    "/api/kiosks/:id/install/cancel",
    { preHandler: requireRoles("admin", "editor") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const dto = await cancelKioskInstall(id);
      if (!dto) return reply.code(404).send({ error: "Not found" });
      return dto;
    }
  );

  app.post(
    "/api/kiosks/:id/start",
    { preHandler: requireRoles("admin", "editor") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await requestStartKioskRuntime(id);
      if (!result.kiosk && result.message === "Not found") {
        return reply.code(404).send({ error: "Not found" });
      }
      if (!result.ok) {
        return reply.code(400).send({ error: result.message, kiosk: result.kiosk });
      }
      return {
        ok: true,
        alreadyRunning: result.alreadyRunning,
        message: result.message,
        kiosk: result.kiosk,
      };
    }
  );

  app.post(
    "/api/kiosks/:id/stop",
    { preHandler: requireRoles("admin", "editor") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await requestStopKioskRuntime(id);
      if (!result.kiosk && result.message === "Not found") {
        return reply.code(404).send({ error: "Not found" });
      }
      if (!result.ok) {
        return reply.code(400).send({ error: result.message, kiosk: result.kiosk });
      }
      return {
        ok: true,
        alreadyRunning: result.alreadyRunning,
        message: result.message,
        kiosk: result.kiosk,
      };
    }
  );

  app.post(
    "/api/kiosks/:id/clear-policies",
    { preHandler: requireRoles("admin", "editor") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await requestClearKioskPolicies(id);
      if (!result.kiosk && result.message === "Not found") {
        return reply.code(404).send({ error: "Not found" });
      }
      if (!result.ok) {
        return reply.code(400).send({ error: result.message, kiosk: result.kiosk });
      }
      return {
        ok: true,
        alreadyRunning: result.alreadyRunning,
        message: result.message,
        kiosk: result.kiosk,
      };
    }
  );

  app.post(
    "/api/kiosks/:id/push-config",
    { preHandler: requireRoles("admin", "editor") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await pushKioskConfig(id);
      if (!result.kiosk && result.message === "Not found") {
        return reply.code(404).send({ error: "Not found" });
      }
      if (!result.ok) {
        return reply.code(400).send({ error: result.message, kiosk: result.kiosk });
      }
      return { ok: true, message: result.message, kiosk: result.kiosk };
    }
  );

  app.delete(
    "/api/kiosks/:id",
    { preHandler: requireRoles("admin", "editor") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const q = request.query as { purge?: string };
      const purge = q.purge !== "0" && q.purge !== "false";

      const existing = await prisma.kiosk.findUnique({
        where: { id },
        include: { exhibit: { select: { title: true } } },
      });
      if (!existing) return reply.code(404).send({ error: "Not found" });

      const prep = await prepareKioskDeletion(id);
      if (!prep.ok) {
        return reply.code(409).send({ error: prep.message });
      }

      let uninstallMessage: string | null = null;
      if (purge) {
        const un = await uninstallKioskRuntime(id);
        uninstallMessage = un.message;
        if (!un.ok) {
          return reply.code(400).send({
            error: un.message,
            hint: "Софт с ПК не снят. Повторите или удалите только из админки: DELETE ?purge=0",
          });
        }
      }

      try {
        await prisma.kiosk.delete({ where: { id } });
        broadcastKioskRemoved(id);
        return {
          ok: true,
          purged: purge,
          message: purge
            ? uninstallMessage || "Киоск удалён из админки, софт снят с ПК"
            : "Киоск удалён только из админки",
        };
      } catch {
        return reply.code(404).send({ error: "Not found" });
      }
    }
  );

  app.get("/api/kiosks/:kioskId/manifest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { kioskId } = request.params as { kioskId: string };
    const key = normalizeHostname(kioskId);
    const kiosk = await prisma.kiosk.findFirst({
      where: { OR: [{ kioskId: key }, { hostname: key }, { kioskId }, { hostname: kioskId }] },
      include: {
        exhibit: {
          include: {
            gallery: { orderBy: { sortOrder: "asc" }, include: { file: true } },
            heroImage: true,
            video: true,
            audio: true,
          },
        },
      },
    });

    if (!kiosk) return reply.code(404).send({ error: "Kiosk not found" });

    const exhibit = kiosk.exhibit;
    const globalAds = await getGlobalAdsState();
    const timeline = await getGlobalTimelineState();
    const filesMap = new Map<
      string,
      { id: string; filename: string; mimeType: string; size: number; hash: string }
    >();

    if (exhibit?.heroImage) filesMap.set(exhibit.heroImage.id, exhibit.heroImage);
    if (exhibit?.video) filesMap.set(exhibit.video.id, exhibit.video);
    if (exhibit?.audio) filesMap.set(exhibit.audio.id, exhibit.audio);
    for (const g of exhibit?.gallery ?? []) filesMap.set(g.file.id, g.file);
    for (const f of globalAds.files) filesMap.set(f.id, f);
    for (const f of timeline.files) filesMap.set(f.id, f);

    const files = [...filesMap.values()].map((f) => ({
      ...toFileDto(f),
      hash: f.hash,
    }));

    return {
      kioskId: kiosk.kioskId,
      hostname: kiosk.hostname,
      exhibit: exhibit
        ? {
            id: exhibit.id,
            title: exhibit.title,
            summary: exhibit.summary,
            body: exhibit.body,
            specs: parseSpecs(exhibit.specs),
            heroImageId: exhibit.heroImageId,
            galleryIds: exhibit.gallery.map((g) => g.fileId),
            videoId: exhibit.videoId,
            audioId: exhibit.audioId,
            contentVersion: exhibit.contentVersion,
            updatedAt: exhibit.updatedAt.toISOString(),
          }
        : null,
      adIds: globalAds.adIds,
      adsVersion: globalAds.adsVersion,
      timelinePages: timeline.pages.map((p) => ({
        id: p.id,
        label: p.label,
        sortOrder: p.sortOrder,
        imageIds: p.imageIds,
      })),
      timelineVersion: timeline.timelineVersion,
      blockKeyboard: globalAds.blockKeyboard,
      softwareEnabled: globalAds.softwareEnabled,
      settingsVersion: globalAds.settingsVersion,
      files,
      contentVersion: exhibit?.contentVersion ?? null,
      serverTime: new Date().toISOString(),
    };
  });

  app.get("/api/deploy/meta", async () => {
    const meta = getDeployMeta();
    return {
      softwareVersion: meta.softwareVersion,
      appVersion: meta.appVersion,
      builtAt: meta.builtAt,
      hasUpdateZip: Boolean(meta.updateZipPath),
      hasPackageZip: Boolean(meta.packageZipPath),
      updateUrl: "/api/deploy/update.zip",
      packageUrl: "/api/deploy/package.zip",
      serverTime: new Date().toISOString(),
    };
  });

  app.get("/api/deploy/update.zip", async (_request, reply) => {
    const meta = getDeployMeta();
    const file = meta.updateZipPath || meta.packageZipPath;
    if (!file || !existsSync(file)) {
      return reply.code(404).send({ error: "Update package not found. Run pnpm pack:kiosk-deploy." });
    }
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", 'attachment; filename="stella-kiosk-update.zip"');
    reply.header("X-Software-Version", meta.softwareVersion);
    return reply.send(createReadStream(file));
  });

  app.get("/api/deploy/package.zip", async (_request, reply) => {
    const meta = getDeployMeta();
    if (!meta.packageZipPath || !existsSync(meta.packageZipPath)) {
      return reply.code(404).send({ error: "Deploy package not found. Run pnpm pack:kiosk-deploy." });
    }
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", 'attachment; filename="stella-kiosk-package.zip"');
    reply.header("X-Software-Version", meta.softwareVersion);
    return reply.send(createReadStream(meta.packageZipPath));
  });

  app.get("/api/kiosks/:kioskId/updates", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { kioskId } = request.params as { kioskId: string };
    const key = normalizeHostname(kioskId);
    const kiosk = await prisma.kiosk.findFirst({
      where: { OR: [{ kioskId: key }, { hostname: key }, { kioskId }, { hostname: kioskId }] },
      include: { exhibit: { select: { contentVersion: true } } },
    });
    if (!kiosk) return reply.code(404).send({ error: "Kiosk not found" });

    const meta = getDeployMeta();
    const q = request.query as { softwareVersion?: string };
    const localSw = String(q.softwareVersion || "").trim();
    const updateAvailable = Boolean(localSw && localSw !== meta.softwareVersion && meta.updateZipPath);
    const ads = await getGlobalAdsState();
    const timeline = await getGlobalTimelineState();
    const contentVersion = kiosk.exhibit?.contentVersion ?? null;

    return {
      kioskId: kiosk.kioskId,
      contentVersion,
      adsVersion: ads.adsVersion,
      timelineVersion: timeline.timelineVersion,
      settingsVersion: ads.settingsVersion,
      blockKeyboard: ads.blockKeyboard,
      softwareEnabled: ads.softwareEnabled,
      syncFingerprint: syncFingerprint(
        contentVersion,
        ads.adsVersion,
        ads.settingsVersion,
        timeline.timelineVersion
      ),
      softwareVersion: meta.softwareVersion,
      appVersion: meta.appVersion,
      updateAvailable: localSw ? updateAvailable : Boolean(meta.updateZipPath || meta.packageZipPath),
      packageUrl: "/api/deploy/update.zip",
      serverTime: new Date().toISOString(),
    };
  });

  app.post("/api/kiosks/:kioskId/heartbeat", async (request, reply) => {
    const { kioskId } = request.params as { kioskId: string };
    const body = heartbeatSchema.parse(request.body ?? {});
    const key = normalizeHostname(kioskId);
    try {
      const existing = await prisma.kiosk.findFirst({
        where: { OR: [{ kioskId: key }, { hostname: key }, { kioskId }, { hostname: kioskId }] },
      });
      if (!existing) return reply.code(404).send({ error: "Kiosk not found" });

      const k = await prisma.kiosk.update({
        where: { id: existing.id },
        data: {
          lastSeenAt: new Date(),
          contentVersion: body.contentVersion === undefined ? undefined : body.contentVersion,
          syncStatus: body.syncStatus,
          syncMessage: body.syncMessage === undefined ? undefined : body.syncMessage,
          appVersion: body.appVersion === undefined ? undefined : body.appVersion,
          hostname: body.hostname ? normalizeHostname(body.hostname) : undefined,
        },
        include: { exhibit: { select: { title: true } } },
      });
      const dto = mapKiosk(k);
      broadcastKioskUpsert(dto);
      return dto;
    } catch {
      return reply.code(404).send({ error: "Kiosk not found" });
    }
  });
}
