import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { config } from "../config.js";
import { authenticate, requireRoles } from "../auth.js";

function fileUrl(id: string) {
  return `/api/files/${id}`;
}

export function toFileDto(file: {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}) {
  return {
    id: file.id,
    filename: file.filename,
    mimeType: file.mimeType,
    size: file.size,
    url: fileUrl(file.id),
  };
}

export async function registerFileRoutes(app: FastifyInstance) {
  await mkdir(config.mediaDir, { recursive: true });

  app.post(
    "/api/files",
    { preHandler: requireRoles("admin", "editor") },
    async (request, reply) => {
      const part = await request.file();
      if (!part) {
        return reply.code(400).send({ error: "File required" });
      }

      const hash = createHash("sha256");
      const storedName = `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(part.filename)}`;
      const dest = path.join(config.mediaDir, storedName);
      const write = createWriteStream(dest);

      part.file.on("data", (chunk: Buffer) => hash.update(chunk));
      await pipeline(part.file, write);

      const { size } = await import("node:fs/promises").then((fs) => fs.stat(dest));
      const created = await prisma.mediaFile.create({
        data: {
          filename: part.filename,
          storedName,
          mimeType: part.mimetype,
          size,
          hash: hash.digest("hex"),
        },
      });

      return toFileDto(created);
    }
  );

  app.get("/api/files/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const file = await prisma.mediaFile.findUnique({ where: { id } });
    if (!file) return reply.code(404).send({ error: "Not found" });
    const full = path.join(config.mediaDir, file.storedName);
    if (!existsSync(full)) {
      request.log.error({ full, mediaDir: config.mediaDir }, "media file missing on disk");
      return reply.code(404).send({ error: "File missing on disk" });
    }
    const stream = createReadStream(full);
    return reply
      .header("Cache-Control", "public, max-age=86400")
      .type(file.mimeType || "application/octet-stream")
      .send(stream);
  });

  app.get(
    "/api/files/:id/meta",
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const file = await prisma.mediaFile.findUnique({ where: { id } });
      if (!file) return reply.code(404).send({ error: "Not found" });
      return toFileDto(file);
    }
  );
}
