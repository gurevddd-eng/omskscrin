import { mkdir } from "node:fs/promises";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerExhibitRoutes } from "./routes/exhibits.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerKioskRoutes } from "./routes/kiosks.js";
import { registerAdsRoutes } from "./routes/ads.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerTimelineRoutes } from "./routes/timeline.js";
import { startKioskProbeLoop } from "./kioskProbe.js";
import { loadNetworkRuntimeFromDb } from "./networkSettings.js";
import { refreshDeployCredentialsFromDb } from "./deployCredentials.js";

async function main() {
  await mkdir(config.mediaDir, { recursive: true });
  await loadNetworkRuntimeFromDb();
  await refreshDeployCredentialsFromDb();

  const app = Fastify({
    logger: config.isProd ? { level: "info" } : true,
  });

  const allowList = config.corsOrigin;
  await app.register(cors, {
    origin: (origin, cb) => {
      // same-origin / server-to-server / agent (no Origin header)
      if (!origin) return cb(null, true);
      // Kiosk UI always runs on loopback (Edge → API on LAN)
      if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) {
        return cb(null, true);
      }
      if (allowList.length === 0 || allowList.includes("*")) return cb(null, true);
      if (allowList.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
  });
  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024 * 1024 } });
  await app.register(fastifyStatic, {
    root: config.mediaDir,
    decorateReply: true,
    serve: false,
  });

  app.get("/api/health", async () => ({
    ok: true,
    mode: config.isProd ? "production" : "development",
    admin: config.serveAdmin,
  }));

  await registerAuthRoutes(app);
  await registerFileRoutes(app);
  await registerExhibitRoutes(app);
  await registerAdsRoutes(app);
  await registerTimelineRoutes(app);
  await registerSettingsRoutes(app);
  await registerKioskRoutes(app);

  if (config.serveAdmin) {
    await app.register(fastifyStatic, {
      root: config.adminDist,
      prefix: "/",
      decorateReply: false,
      wildcard: false,
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api")) {
        return reply.code(404).send({ error: "Not found" });
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html", config.adminDist);
    });

    app.log.info(`Admin SPA: ${config.adminDist}`);
  } else {
    app.log.warn(
      "Admin SPA не найдена (apps/admin/dist). Соберите: pnpm --filter @stella/admin build"
    );
  }

  const probeTimer = startKioskProbeLoop();
  app.addHook("onClose", async () => clearInterval(probeTimer));

  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    `Омскэкран server ${config.isProd ? "PRODUCTION" : "dev"} on http://${config.host}:${config.port}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
