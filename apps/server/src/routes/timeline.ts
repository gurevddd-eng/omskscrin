import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TIMELINE_MAX_IMAGES } from "@stella/shared";
import { prisma } from "../prisma.js";
import { authenticate, requireRoles } from "../auth.js";
import { toFileDto } from "./files.js";
import { ensureSiteSettings } from "../siteSettings.js";
import { broadcastContentSync } from "../contentHub.js";

const pageInputSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  label: z.string().trim().min(1).max(32),
  imageIds: z.array(z.string()).max(TIMELINE_MAX_IMAGES),
});

const putSchema = z.object({
  pages: z.array(pageInputSchema).max(20),
});

function bumpVersion(current: string) {
  const n = Number(current);
  if (Number.isFinite(n)) return String(n + 1);
  return createHash("sha1").update(`${current}-${Date.now()}`).digest("hex").slice(0, 12);
}

export async function getGlobalTimelineState() {
  const [settings, pages] = await Promise.all([
    ensureSiteSettings(),
    prisma.timelinePage.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        images: { orderBy: { sortOrder: "asc" }, include: { file: true } },
      },
    }),
  ]);

  const dtoPages = pages.map((p, idx) => ({
    id: p.id,
    label: p.label,
    sortOrder: p.sortOrder ?? idx,
    imageIds: p.images.map((i) => i.fileId),
    images: p.images.map((i) => toFileDto(i.file)),
  }));

  const files = pages.flatMap((p) => p.images.map((i) => i.file));

  return {
    pages: dtoPages,
    timelineVersion: settings.timelineVersion || "1",
    updatedAt: settings.updatedAt.toISOString(),
    files,
  };
}

export async function registerTimelineRoutes(app: FastifyInstance) {
  app.get("/api/timeline", { preHandler: authenticate }, async () => {
    const state = await getGlobalTimelineState();
    return {
      pages: state.pages,
      timelineVersion: state.timelineVersion,
      updatedAt: state.updatedAt,
    };
  });

  app.put("/api/timeline", { preHandler: requireRoles("admin", "editor") }, async (request) => {
    const body = putSchema.parse(request.body);
    const settings = await ensureSiteSettings();

    await prisma.$transaction(async (tx) => {
      await tx.timelinePageImage.deleteMany();
      await tx.timelinePage.deleteMany();

      for (let i = 0; i < body.pages.length; i++) {
        const page = body.pages[i]!;
        const pageId = page.id?.trim() || randomUUID().replace(/-/g, "").slice(0, 24);
        await tx.timelinePage.create({
          data: {
            id: pageId,
            label: page.label,
            sortOrder: i,
          },
        });
        const ids = page.imageIds.slice(0, TIMELINE_MAX_IMAGES);
        if (ids.length) {
          await tx.timelinePageImage.createMany({
            data: ids.map((fileId, sortOrder) => ({ pageId, fileId, sortOrder })),
          });
        }
      }

      await tx.siteSettings.update({
        where: { id: "default" },
        data: { timelineVersion: bumpVersion(settings.timelineVersion || "1") },
      });
    });

    const state = await getGlobalTimelineState();
    broadcastContentSync({ reason: "timeline" });
    return {
      pages: state.pages,
      timelineVersion: state.timelineVersion,
      updatedAt: state.updatedAt,
    };
  });
}
