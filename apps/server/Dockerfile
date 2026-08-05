FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN pnpm install --filter @stella/server... --frozen-lockfile=false

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @stella/shared build \
 && pnpm --filter @stella/server prisma:generate \
 && pnpm --filter @stella/server build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=build /app /app
WORKDIR /app/apps/server
EXPOSE 8080
CMD ["sh", "-c", "pnpm prisma:migrate && pnpm prisma:seed && node dist/index.js"]
