import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { authenticate, requireRoles } from "../auth.js";
import { config } from "../config.js";

const loginSchema = z.object({
  login: z.string().min(1),
  password: z.string().min(1),
});

const userSchema = z.object({
  login: z.string().min(1),
  password: z.string().min(4).optional(),
  role: z.enum(["admin", "editor", "viewer"]),
  active: z.boolean().optional(),
});

function toUser(u: { id: string; login: string; role: string; active: boolean; superAdmin: boolean }) {
  return { id: u.id, login: u.login, role: u.role, active: u.active, superAdmin: u.superAdmin };
}

async function requireSuperAdmin(request: FastifyRequest, reply: FastifyReply) {
  const actor = await prisma.user.findUnique({ where: { id: request.user.id } });
  if (!actor?.superAdmin) {
    reply.code(403).send({ error: "Super admin required" });
    return null;
  }
  return actor;
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post("/api/auth/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { login: body.login } });
    if (!user || !user.active) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }
    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: "Invalid credentials" });

    const token = await reply.jwtSign(
      {
        id: user.id,
        login: user.login,
        role: user.role,
      },
      { expiresIn: config.jwtExpiresIn }
    );

    return { token, user: toUser(user) };
  });

  app.get("/api/auth/me", { preHandler: authenticate }, async (request) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.id } });
    if (!user) return { error: "Not found" };
    return toUser(user);
  });

  app.get("/api/users", { preHandler: requireRoles("admin") }, async () => {
    const users = await prisma.user.findMany({ orderBy: { login: "asc" } });
    return users.map(toUser);
  });

  app.post("/api/users", { preHandler: requireRoles("admin") }, async (request, reply) => {
    const body = userSchema.parse(request.body);
    if (!body.password) {
      return reply.code(400).send({ error: "Password required" });
    }
    const passwordHash = await bcrypt.hash(body.password, 10);
    try {
      const user = await prisma.user.create({
        data: {
          login: body.login,
          passwordHash,
          role: body.role,
          active: body.active ?? true,
          superAdmin: false,
        },
      });
      return toUser(user);
    } catch {
      return reply.code(409).send({ error: "Login already exists" });
    }
  });

  app.patch("/api/users/:id", { preHandler: requireRoles("admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = userSchema.partial().parse(request.body);
    const data: {
      login?: string;
      role?: "admin" | "editor" | "viewer";
      active?: boolean;
      passwordHash?: string;
    } = {};
    if (body.login) data.login = body.login;
    if (body.role) data.role = body.role;
    if (typeof body.active === "boolean") data.active = body.active;
    if (body.password) {
      const actor = await requireSuperAdmin(request, reply);
      if (!actor) return;
      if (body.password.length < 4) {
        return reply.code(400).send({ error: "Password must be at least 4 characters" });
      }
      data.passwordHash = await bcrypt.hash(body.password, 10);
    }

    try {
      const user = await prisma.user.update({ where: { id }, data });
      return toUser(user);
    } catch {
      return reply.code(404).send({ error: "Not found" });
    }
  });

  app.delete("/api/users/:id", { preHandler: requireRoles("admin") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (id === request.user.id) {
      return reply.code(400).send({ error: "Cannot delete yourself" });
    }
    try {
      await prisma.user.delete({ where: { id } });
      return { ok: true };
    } catch {
      return reply.code(404).send({ error: "Not found" });
    }
  });
}
