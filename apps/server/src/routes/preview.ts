import type { FastifyInstance } from "fastify";
import type { GameShareDto, GameShareFolder } from "@stella/shared";
import { prisma } from "../prisma.js";
import { authenticate } from "../auth.js";
import { ensureSiteSettings } from "../siteSettings.js";
import { buildKioskManifest, exhibitMediaInclude } from "../kioskManifest.js";

function parseGameShareFolders(raw: unknown): GameShareFolder[] {
  if (!Array.isArray(raw)) return [];
  const out: GameShareFolder[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as { name?: unknown; exes?: unknown };
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name) continue;
    const exes = Array.isArray(r.exes)
      ? r.exes.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];
    out.push({ name, exes });
  }
  return out;
}

export async function registerPreviewRoutes(app: FastifyInstance) {
  app.get("/api/exhibits/:id/preview-manifest", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const exhibit = await prisma.exhibit.findUnique({
      where: { id },
      include: exhibitMediaInclude,
    });
    if (!exhibit) return reply.code(404).send({ error: "Not found" });
    return buildKioskManifest({
      kioskId: "preview",
      hostname: "preview",
      exhibit,
    });
  });

  app.get("/api/game-share", { preHandler: authenticate }, async (): Promise<GameShareDto> => {
    const settings = await ensureSiteSettings();
    return {
      unc: settings.gameShareUnc,
      folders: parseGameShareFolders(settings.gameShareFolders),
      scannedAt: settings.gameShareScannedAt?.toISOString() ?? null,
      sourceHostname: settings.gameShareSource ?? null,
    };
  });
}
