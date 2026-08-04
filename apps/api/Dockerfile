# Build context is the repository root (this is a pnpm workspace monorepo).
# docker build -f apps/api/Dockerfile .

FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /workspace

# --- deps: install once, cached as long as manifests don't change ---
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/config/package.json packages/config/package.json
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
CMD ["sh", "-c", "pnpm --filter @kinvo/contracts run build && pnpm --filter @kinvo/api run dev"]

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
FROM node:20-alpine AS runtime
RUN corepack enable
WORKDIR /workspace
ENV NODE_ENV=production
COPY --from=build /workspace ./
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --spider http://localhost:4000/health/live || exit 1
CMD ["node", "apps/api/dist/server.js"]
