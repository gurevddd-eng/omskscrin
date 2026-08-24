import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { authenticate, requireRoles } from "../auth.js";
import { toFileDto } from "./files.js";
import { broadcastContentSync } from "../contentHub.js";

const specRowSchema = z.object({
  label: z.string(),
  value: z.string(),
});

const exhibitSchema = z.object({
  title: z.string().min(1),
  summary: z.string().optional(),
  body: z.string().optional(),
  specs: z.array(specRowSchema).optional(),
  heroImageId: z.string().nullable().optional(),
  videoId: z.string().nullable().optional(),
  audioId: z.string().nullable().optional(),
  galleryIds: z.array(z.string()).optional(),
  gameTitle: z.string().max(80).optional(),
  gameShareFolder: z.string().max(260).nullable().optional(),
  gameExe: z.string().max(260).nullable().optional(),
});

function parseExhibitBody(raw: unknown, partial: boolean) {
  const result = partial ? exhibitSchema.partial().safeParse(raw) : exhibitSchema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; ");
    const err = Object.assign(new Error(message || "Некорректные данные экспоната"), { statusCode: 400 });
    throw err;
  }
  return result.data;
}

/** Trim game fields; Prisma columns are non-null strings. */
function normalizeGameField(value: string | null | undefined): string {
  if (value == null) return "";
  return String(value).trim();
}

function bumpVersion(current: string) {
  const n = Number(current);
  if (Number.isFinite(n)) return String(n + 1);
  return createHash("sha1").update(`${current}-${Date.now()}`).digest("hex").slice(0, 12);
}

export function parseSpecs(raw: unknown): { label: string; value: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const r = row as { label?: unknown; value?: unknown };
      const label = typeof r.label === "string" ? r.label.trim() : "";
      const value = typeof r.value === "string" ? r.value.trim() : "";
      if (!label && !value) return null;
      return { label, value };
    })
    .filter((x): x is { label: string; value: string } => Boolean(x));
}

async function mapExhibit(id: string) {
  const e = await prisma.exhibit.findUnique({
    where: { id },
    include: {
      gallery: { orderBy: { sortOrder: "asc" }, include: { file: true } },
      heroImage: true,
      video: true,
      audio: true,
    },
  });
  if (!e) return null;
  return toExhibitDto(e);
}

function toExhibitDto(e: {
  id: string;
  title: string;
  summary: string;
  body: string;
  specs: unknown;
  heroImageId: string | null;
  videoId: string | null;
  audioId: string | null;
  contentVersion: string;
  updatedAt: Date;
  gameTitle: string;
  gameShareFolder: string;
  gameExe: string;
  gallery: { fileId: string; file: Parameters<typeof toFileDto>[0] }[];
  heroImage: Parameters<typeof toFileDto>[0] | null;
  video: Parameters<typeof toFileDto>[0] | null;
  audio: Parameters<typeof toFileDto>[0] | null;
}) {
  return {
    id: e.id,
    title: e.title,
    summary: e.summary,
    body: e.body,
    specs: parseSpecs(e.specs),
    heroImageId: e.heroImageId,
    galleryIds: e.gallery.map((g) => g.fileId),
    videoId: e.videoId,
    audioId: e.audioId,
    contentVersion: e.contentVersion,
    updatedAt: e.updatedAt.toISOString(),
    gameTitle: e.gameTitle || "Играть",
    gameShareFolder: e.gameShareFolder || "",
    gameExe: e.gameExe || "",
    heroImage: e.heroImage ? toFileDto(e.heroImage) : null,
    video: e.video ? toFileDto(e.video) : null,
    audio: e.audio ? toFileDto(e.audio) : null,
    gallery: e.gallery.map((g) => toFileDto(g.file)),
  };
}

export async function registerExhibitRoutes(app: FastifyInstance) {
  app.get("/api/exhibits", { preHandler: authenticate }, async (request) => {
    const q = request.query as { fields?: string };
    const slim = q.fields === "id,title" || q.fields === "summary";

    if (slim) {
      const list = await prisma.exhibit.findMany({
        orderBy: { updatedAt: "desc" },
        select: { id: true, title: true },
      });
      return list;
    }

    const list = await prisma.exhibit.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        gallery: { orderBy: { sortOrder: "asc" }, include: { file: true } },
        heroImage: true,
        video: true,
        audio: true,
      },
    });
    return list.map(toExhibitDto);
  });

  app.get("/api/exhibits/:id", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const exhibit = await mapExhibit(id);
    if (!exhibit) return reply.code(404).send({ error: "Not found" });
    return exhibit;
  });

  app.post("/api/exhibits", { preHandler: requireRoles("admin", "editor") }, async (request, reply) => {
    try {
      const body = parseExhibitBody(request.body, false);
      if (!body.title?.trim()) {
        return reply.code(400).send({ error: "title: Required" });
      }
      const specs = parseSpecs(body.specs ?? []) as Prisma.InputJsonValue;
      const created = await prisma.exhibit.create({
        data: {
          title: body.title.trim(),
          summary: body.summary ?? "",
          body: body.body ?? "",
          specs,
          heroImageId: body.heroImageId ?? null,
          videoId: body.videoId ?? null,
          audioId: body.audioId ?? null,
          gameTitle: normalizeGameField(body.gameTitle) || "Играть",
          gameShareFolder: normalizeGameField(body.gameShareFolder),
          gameExe: normalizeGameField(body.gameExe),
          contentVersion: "1",
          gallery: body.galleryIds
            ? {
                create: body.galleryIds.map((fileId, sortOrder) => ({ fileId, sortOrder })),
              }
            : undefined,
        },
      });
      return mapExhibit(created.id);
    } catch (err) {
      const status =
        err && typeof err === "object" && "statusCode" in err && typeof (err as { statusCode: unknown }).statusCode === "number"
          ? (err as { statusCode: number }).statusCode
          : 400;
      const message = err instanceof Error ? err.message : "Не удалось создать экспонат";
      return reply.code(status).send({ error: message });
    }
  });

  app.patch(
    "/api/exhibits/:id",
    { preHandler: requireRoles("admin", "editor") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const body = parseExhibitBody(request.body, true);
        const existing = await prisma.exhibit.findUnique({ where: { id } });
        if (!existing) return reply.code(404).send({ error: "Not found" });

        await prisma.$transaction(async (tx) => {
          if (body.galleryIds) {
            await tx.exhibitGallery.deleteMany({ where: { exhibitId: id } });
            await tx.exhibitGallery.createMany({
              data: body.galleryIds.map((fileId, sortOrder) => ({
                exhibitId: id,
                fileId,
                sortOrder,
              })),
            });
          }

          await tx.exhibit.update({
            where: { id },
            data: {
              title: body.title === undefined ? undefined : body.title.trim(),
              summary: body.summary,
              body: body.body,
              specs:
                body.specs === undefined
                  ? undefined
                  : (parseSpecs(body.specs) as Prisma.InputJsonValue),
              heroImageId: body.heroImageId === undefined ? undefined : body.heroImageId,
              videoId: body.videoId === undefined ? undefined : body.videoId,
              audioId: body.audioId === undefined ? undefined : body.audioId,
              gameTitle:
                body.gameTitle === undefined
                  ? undefined
                  : normalizeGameField(body.gameTitle) || "Играть",
              gameShareFolder:
                body.gameShareFolder === undefined
                  ? undefined
                  : normalizeGameField(body.gameShareFolder),
              gameExe: body.gameExe === undefined ? undefined : normalizeGameField(body.gameExe),
              contentVersion: bumpVersion(existing.contentVersion),
            },
          });
        });

        broadcastContentSync({ reason: "exhibit", exhibitId: id });
        return mapExhibit(id);
      } catch (err) {
        const status =
          err && typeof err === "object" && "statusCode" in err && typeof (err as { statusCode: unknown }).statusCode === "number"
            ? (err as { statusCode: number }).statusCode
            : 400;
        const message = err instanceof Error ? err.message : "Не удалось сохранить экспонат";
        return reply.code(status).send({ error: message });
      }
    }
  );

  app.delete(
    "/api/exhibits/:id",
    { preHandler: requireRoles("admin", "editor") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const linked = await prisma.kiosk.count({ where: { exhibitId: id } });
      if (linked > 0) {
        return reply.code(409).send({ error: "Exhibit is linked to kiosks" });
      }
      try {
        await prisma.exhibit.delete({ where: { id } });
        return { ok: true };
      } catch {
        return reply.code(404).send({ error: "Not found" });
      }
    }
  );
}
