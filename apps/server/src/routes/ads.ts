import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { authenticate, requireRoles } from "../auth.js";
import { toFileDto } from "./files.js";
import { ensureSiteSettings } from "./settings.js";

const putSchema = z.object({
  adIds: z.array(z.string()),
});

function bumpVersion(current: string) {
  const n = Number(current);
  if (Number.isFinite(n)) return String(n + 1);
  return createHash("sha1").update(`${current}-${Date.now()}`).digest("hex").slice(0, 12);
}

export async function getGlobalAdsState() {
  const [settings, ads] = await Promise.all([
    ensureSiteSettings(),
    prisma.globalAd.findMany({
      orderBy: { sortOrder: "asc" },
      include: { file: true },
    }),
  ]);
  return {
    adIds: ads.map((a) => a.fileId),
    ads: ads.map((a) => toFileDto(a.file)),
    adsVersion: settings.adsVersion,
    settingsVersion: settings.settingsVersion,
    blockKeyboard: settings.blockKeyboard,
    softwareEnabled: settings.softwareEnabled,
    updatedAt: settings.updatedAt.toISOString(),
    files: ads.map((a) => a.file),
  };
}

export { syncFingerprint, ensureSiteSettings } from "./settings.js";

export async function registerAdsRoutes(app: FastifyInstance) {
  app.get("/api/ads", { preHandler: authenticate }, async () => {
    const state = await getGlobalAdsState();
    return {
      adIds: state.adIds,
      ads: state.ads,
      adsVersion: state.adsVersion,
      updatedAt: state.updatedAt,
    };
  });

  app.put("/api/ads", { preHandler: requireRoles("admin", "editor") }, async (request) => {
    const body = putSchema.parse(request.body);
    const settings = await ensureSiteSettings();

    await prisma.$transaction(async (tx) => {
      await tx.globalAd.deleteMany();
      if (body.adIds.length) {
        await tx.globalAd.createMany({
          data: body.adIds.map((fileId, sortOrder) => ({ fileId, sortOrder })),
        });
      }
      await tx.siteSettings.update({
        where: { id: "default" },
        data: { adsVersion: bumpVersion(settings.adsVersion) },
      });
    });

    const state = await getGlobalAdsState();
    return {
      adIds: state.adIds,
      ads: state.ads,
      adsVersion: state.adsVersion,
      updatedAt: state.updatedAt,
    };
  });
}
