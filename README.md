# Kinvo

AI-powered communication platform for logistics and port operations. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system design,
architectural decisions, and phased milestone plan.

## Project status

A working port-logistics dispatch app: authentication and multi-tenant
organizations; ship/driver/truck-requirement and driver-assignment
management; automated outbound confirmation calls via CALL-E with webhook
and BullMQ-driven retry/reconciliation; a Yellow Zone escalation queue with
Socket.IO realtime updates; notifications; per-user appearance/notification
settings; and an Intelligence group (Timeline, Transcripts, Analytics,
rule-based Insights) plus Recruitment/Reminders campaigns. See
`docs/ARCHITECTURE.md`'s decisions log for the full build history and
current architecture.

## Structure

```
apps/
  api/                 Express + TypeScript REST API + BullMQ worker
  web/                 React + Vite + TypeScript dispatch manager UI
packages/
  contracts/           Shared Zod schemas + inferred types (api + web both import this)
  config/              Shared tsconfig
docs/
  ARCHITECTURE.md       System design, decisions log, milestone plan
  DEVELOPER_SETUP.md    Operational setup guide
  PHASE_0_AUDIT.md       Historical Phase 0 audit record
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

## Notes

- **`packages/contracts` is a pure ESM package** (`"type": "module"`), but
  `apps/api` compiles to CommonJS and does real runtime `require()` calls
  into it (Zod schemas passed to `validateBody`, realtime event-name
  constants — not just `import type`). This works because Node ≥20.19
  supports synchronous `require()` of ESM modules; `apps/web` imports it
  the more conventional way, bundled directly by Vite/Rollup.
