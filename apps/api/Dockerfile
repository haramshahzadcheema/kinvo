# Build context is the repository root (this is a pnpm workspace monorepo).
# docker build -f apps/api/Dockerfile .

FROM node:25-alpine AS base
# Prisma's query/schema engines shell out to `openssl version` to pick the
# right engine binary (openssl-1.1.x vs openssl-3.0.x) — node:20-alpine
# doesn't ship the openssl CLI by default, so detection silently falls back
# to a guess that doesn't match what's actually on the image, and the
# engine binary crashes at runtime instead of failing at build time.
# Confirmed empirically: without this, `prisma migrate deploy` fails with
# "Could not parse schema engine response" — the engine process itself
# errored out before ever producing the JSON-RPC response the CLI expects.
RUN apk add --no-cache openssl
RUN corepack enable
WORKDIR /workspace

# --- deps: install once, cached as long as manifests don't change ---
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/config/package.json packages/config/package.json
# @prisma/client's postinstall runs `prisma generate`, which reads the
# schema — it must be present before `pnpm install`, or client generation
# silently no-ops and every Prisma import fails at runtime with a
# did-you-forget-to-generate error.
COPY apps/api/prisma apps/api/prisma
RUN pnpm install --frozen-lockfile

# --- dev: hot-reload target used by docker-compose for local development ---
FROM deps AS dev
COPY . .
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD wget --quiet --spider http://localhost:4000/health/live || exit 1
# The docker-compose bind mount overlays anything built at image-construction
# time, so @kinvo/contracts is (re)built on every container start rather than
# baked into the image — this also means editing packages/contracts/src and
# restarting the container picks up the change without a manual rebuild.
# Same reasoning applies to Prisma: `generate` re-runs against whatever
# schema.prisma the bind mount currently has (so a schema edit doesn't need
# an image rebuild to take effect), and `migrate deploy` applies any
# pending migrations against the compose Postgres so a fresh `docker compose
# up` gets a real, queryable schema without a separate manual step.
CMD ["sh", "-c", "pnpm --filter @kinvo/contracts run build && pnpm --filter @kinvo/api exec prisma generate && pnpm --filter @kinvo/api exec prisma migrate deploy && pnpm --filter @kinvo/api run dev"]

# --- build: compiles contracts + api to plain JS ---
FROM deps AS build
COPY . .
RUN pnpm --filter @kinvo/contracts run build && pnpm --filter @kinvo/api run build

# --- runtime ---
# KNOWN LIMITATION (tracked for Phase 7 hardening, not yet fixed): this
# copies the entire build-stage /workspace, which still has devDependencies
# (eslint, vitest, typescript, prisma CLI, tsx, ...) and apps/web's deps in
# node_modules — it is not actually minimal. The correct fix is a pruned
# `pnpm install --prod` (or `pnpm deploy`) stage that ships only apps/api's
# production deps + compiled dist. Deferred rather than shipped untested:
# this environment currently has no working Docker daemon to verify a
# rewritten runtime stage against, and an unverified Dockerfile change is
# worse than a documented, correct-but-not-yet-lean one. Do not let this
# linger past Phase 7.
FROM node:25-alpine AS runtime
# Same reasoning as the `base` stage above — this stage builds from
# node:20-alpine directly rather than from `base`, so it needs its own copy.
RUN apk add --no-cache openssl
RUN corepack enable
WORKDIR /workspace
ENV NODE_ENV=production
COPY --from=build /workspace ./
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --spider http://localhost:4000/health/live || exit 1
CMD ["node", "apps/api/dist/server.js"]
