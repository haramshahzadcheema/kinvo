# Build context is the repository root (this is a pnpm workspace monorepo).
# docker build -f apps/web/Dockerfile .
#
# This is a DEV-ONLY image, used by docker-compose for local hot-reload.
# Production does not run web in a container: per docs/ARCHITECTURE.md §16,
# the web app is built to static assets and served via a CDN, not Node.

FROM node:20-alpine
RUN corepack enable
WORKDIR /workspace

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 5173
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD wget --quiet --spider http://localhost:5173/ || exit 1
# @kinvo/web does a real runtime import from @kinvo/contracts (not type-only),
# so it needs the compiled dist/ present. Built on every container start,
# not baked into the image, because the compose bind mount would hide it.
CMD ["sh", "-c", "pnpm --filter @kinvo/contracts run build && pnpm --filter @kinvo/web run dev"]
