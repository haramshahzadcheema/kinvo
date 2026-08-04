# Kinvo

AI-powered communication platform for logistics and port operations. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system design,
architectural decisions, and phased milestone plan.

## Project status

**Phase 0 — Foundation.** Monorepo scaffold, shared contracts package,
Docker Compose local dev environment, CI skeleton. No business features yet
— see the milestone plan in `docs/ARCHITECTURE.md` for what's next.

## Structure

```
apps/
  api/                 Express + TypeScript REST API
  web/                 React + Vite + TypeScript dispatch manager UI
packages/
  contracts/           Shared Zod schemas + inferred types (api + web both import this)
  config/              Shared tsconfig
docs/
  ARCHITECTURE.md       System design, decisions log, milestone plan
  phases/               Per-phase completion records
```

## Prerequisites

- Node.js 20.x (see `.nvmrc`)
- pnpm 10.x (`corepack enable` will pick up the pinned version from `packageManager`)
- Docker + Docker Compose (primary local dev path)

## Running locally (Docker — recommended)

```bash
cp .env.example .env
docker compose up --build
```

- API: http://localhost:4000 (liveness: `/health/live`, readiness: `/health/ready`)
- Web: http://localhost:5173
- Postgres: localhost:5432 (`kinvo` / `kinvo` / db `kinvo`)
- Redis: localhost:6379

## Running locally (native, no Docker)

Requires Postgres and Redis running locally yourself.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env    # edit if your Postgres/Redis aren't on localhost defaults
cp apps/web/.env.example apps/web/.env

pnpm run build:contracts   # apps/web needs the compiled contracts package
pnpm run dev:api           # terminal 1
pnpm run dev:web           # terminal 2
```

## Common commands

```bash
pnpm run lint          # ESLint across all workspaces
pnpm run typecheck     # tsc --noEmit across all workspaces
pnpm run test          # Vitest across all workspaces
pnpm run build         # production build (contracts -> api -> web)
pnpm run format        # Prettier --write
pnpm run format:check  # Prettier --check (what CI runs)
```

## Notes on the current scaffold

- **Prisma is configured but has no models yet.** `prisma generate` refuses
  to run with zero models — that's a Prisma CLI constraint, not a bug here.
  Phase 1 introduces the first models (`Organization`, `User`,
  `RefreshToken`); until then, `apps/api/src/core/database.ts` uses the
  plain `pg` driver for the Postgres readiness check. See the decisions log
  in `docs/ARCHITECTURE.md` for the full reasoning.
- **`packages/contracts` is a pure ESM package.** Its only real runtime
  consumer is `apps/web` (bundled by Vite/Rollup, ESM-native); `apps/api`
  only ever does `import type` from it, which TypeScript erases entirely at
  compile time, so the CJS/ESM boundary never matters there.
