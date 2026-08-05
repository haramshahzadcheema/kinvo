# Kinvo — Developer Setup Guide

Goal: clone the repo and be productive in under 10 minutes. If any step here
doesn't get you there, the guide is wrong — fix it in the same PR that hit
the problem.

For system design and _why_ things are built this way, see
[ARCHITECTURE.md](ARCHITECTURE.md). This doc is purely operational.

---

## 1. Required software

| Tool           | Version                                                  | Check with                             |
| -------------- | -------------------------------------------------------- | -------------------------------------- |
| Node.js        | 20.x (see `.nvmrc`)                                      | `node -v`                              |
| pnpm           | 10.x, pinned via `packageManager` in root `package.json` | `pnpm -v`                              |
| Docker Desktop | recent, with Compose v2+                                 | `docker -v` / `docker compose version` |
| Git            | any recent version                                       | `git --version`                        |

Node + pnpm: if you use `nvm`, run `nvm install` then `nvm use` in the repo
root to pick up `.nvmrc`. Then `corepack enable` — this reads the
`packageManager` field in `package.json` and gives you the exact pinned
pnpm version without a separate global install.

Docker is the **primary supported local dev path**. Native (no-Docker) dev
is documented below and works, but you're on your own for keeping a local
Postgres/Redis running and in sync with what CI expects.

## 2. Environment variables

Never commit a real `.env` file — only `.env.example` files are tracked.

| File                    | Used by                      | Notes                                                                            |
| ----------------------- | ---------------------------- | -------------------------------------------------------------------------------- |
| `.env.example` (root)   | `docker-compose.yml`         | Postgres user/password/db name for the compose Postgres container                |
| `apps/api/.env.example` | `apps/api` (native dev only) | `DATABASE_URL`, `REDIS_URL` point at `localhost` since there's no Docker network |
| `apps/web/.env.example` | `apps/web` (native dev only) | `VITE_API_URL`                                                                   |

When running via Docker Compose, `docker-compose.yml` injects the correct
in-network values (`postgres`, `redis` as hostnames) directly — you do not
need `apps/api/.env` for the Docker path, only for native dev.

`apps/api/.env.example` also carries the auth/token config added in Phase 1:
`JWT_ACCESS_SECRET` (min 32 chars — the app refuses to boot without one),
`JWT_ACCESS_TTL`, `REFRESH_TOKEN_TTL_DAYS`, `REFRESH_TOKEN_COOKIE_NAME`. The
checked-in example values are dev-only placeholders (`docker-compose.yml`
sets the same dev-only literal for the Docker path) — generate real random
secrets per environment for anything beyond a local machine.

## 3. First-time setup

### Option A — Docker (recommended)

```bash
git clone <repo-url>
cd kinvo
cp .env.example .env
docker compose up --build
```

Wait for all four services to report healthy/ready in the logs, then:

- Web: http://localhost:5173
- API: http://localhost:4000/health/live and http://localhost:4000/health/ready
- Postgres: `localhost:5432` (`kinvo` / `kinvo` / db `kinvo`)
- Redis: `localhost:6379`

That's it — Postgres, Redis, the API (hot-reload via `tsx watch`), and the
web dev server (Vite) are all running. The `api` container generates the
Prisma client and applies migrations against the dev database on every
startup, so the schema is always current — no separate manual step.

### Option B — Native (no Docker)

You need Postgres 16+ and Redis 7+ running yourself, reachable at whatever
you put in `apps/api/.env`.

```bash
git clone <repo-url>
cd kinvo
pnpm install

cp apps/api/.env.example apps/api/.env      # edit DATABASE_URL/REDIS_URL if not on localhost defaults
cp apps/web/.env.example apps/web/.env

pnpm run build:contracts   # apps/web does a real runtime import of @kinvo/contracts — build it once first
pnpm run dev:api           # terminal 1
pnpm run dev:web           # terminal 2
```

## 4. How to start development

- Docker running already (`docker compose up`)? Just edit files — both the
  API (`tsx watch`) and web (`Vite`) containers hot-reload on save via the
  bind-mounted source.
- Editing `packages/contracts`? Restart the `api` and `web` containers (or
  re-run `pnpm run build:contracts` natively) — it's a compiled dependency,
  not hot-reloaded across the package boundary in Phase 0.
- New backend module? Follow the existing `apps/api/src/modules/health/`
  layout: `*.routes.ts` → `*.controller.ts` → `*.service.ts`.

## 5. Common commands

```bash
pnpm run lint          # ESLint, all workspaces
pnpm run typecheck     # tsc --noEmit, all workspaces (builds contracts first)
pnpm run test          # Vitest, all workspaces (builds contracts first)
pnpm run build         # production build: contracts -> api -> web
pnpm run format        # Prettier --write
pnpm run format:check  # Prettier --check — this is what CI runs, not --write
```

Scoped to one workspace: `pnpm --filter @kinvo/api run <script>` (or
`@kinvo/web`, `@kinvo/contracts`).

## 6. How to run tests

```bash
pnpm run test                                   # everything
pnpm --filter @kinvo/api run test               # API only
pnpm --filter @kinvo/api exec vitest             # watch mode, API only
```

Unit tests (`test/unit/**`, `test/health.test.ts`, `test/request-context.test.ts`)
mock or don't touch infra at all. **Integration tests
(`test/integration/**`) hit a real Postgres** — deliberately, per the
testing strategy in `ARCHITECTURE.md` §18: a mocked Prisma client cannot
prove the tenant-scoping extension actually stops cross-tenant leaks, only
a real database can.

Integration tests run against a separate `kinvo_test` database, never the
`kinvo` dev database — this lets `resetDatabase()` (`test/support/db.ts`)
`TRUNCATE` freely between tests without ever touching your dev data.

**One-time setup before tests will pass:**

- Docker Compose users: `kinvo_test` is created automatically the first
  time the `postgres` container initializes against a fresh volume (see
  `docker/postgres-init/`). If you already had the `postgres-data` volume
  from before this existed, run `docker compose down -v` once and bring it
  back up.
- Native (no Docker) users: create it yourself —
  `createdb -U kinvo -h localhost kinvo_test` (or the equivalent in your
  Postgres client).

Either way, apply migrations to `kinvo_test` before running tests, and
again after pulling any change that adds a new migration:

```bash
DATABASE_URL=postgresql://kinvo:kinvo@localhost:5432/kinvo_test \
  pnpm --filter @kinvo/api exec prisma migrate deploy
```

Integration tests share one database and reset it via `TRUNCATE` in
`beforeEach` — `vitest.config.ts` sets `fileParallelism: false` so two test
files' `TRUNCATE`s never race each other. Don't remove that setting to
"speed up" the suite; it'll deadlock instead.

## 7. How to build

```bash
pnpm run build
```

Order matters and is handled for you: `packages/contracts` builds first
(both `apps/api` and `apps/web` depend on its compiled output), then `apps/api`
(`tsc`) and `apps/web` (`tsc --noEmit` + `vite build`) build in parallel.

Production API image: `docker build -f apps/api/Dockerfile --target runtime .`
— see the `KNOWN LIMITATION` comment in that Dockerfile before relying on it
for a real deployment; it isn't dependency-pruned yet (tracked for Phase 7).

## 8. How to reset the database

```bash
pnpm --filter @kinvo/api exec prisma migrate reset
```

This drops the `kinvo` dev database, reapplies all migrations, and runs the
seed script (once one exists — Phase 1 has no seed data yet, an honest gap,
not an oversight). Point `DATABASE_URL` at `kinvo_test` first if you want to
reset the test database instead:

```bash
DATABASE_URL=postgresql://kinvo:kinvo@localhost:5432/kinvo_test \
  pnpm --filter @kinvo/api exec prisma migrate reset
```

Don't use `docker compose down -v` for a routine reset — it nukes the entire
Postgres data volume (both `kinvo` and `kinvo_test`, plus loses the
`docker-entrypoint-initdb.d` one-time init having already run, so
`kinvo_test` won't exist again until the container starts fresh). Reach for
`docker compose down -v` only when you actually want that, e.g. verifying
the `docker/postgres-init/` script itself.

## 9. Troubleshooting

**`docker compose up` says `web` is running, but `http://localhost:5173`
connects then hangs / gives "empty reply from server"**
The Vite dev server bound to loopback only inside the container instead of
all interfaces — check `docker compose logs web` for `➜ Network: use --host
to expose` (means it's loopback-only) vs. `➜ Network: http://<ip>:5173/`
(means it's correctly exposed). This is fixed via `server.host: true` in
`apps/web/vite.config.ts` — if you see the broken variant, something
reverted that config or is overriding it with a `--host` CLI flag again.
Don't reintroduce `pnpm run dev -- --host 0.0.0.0` in the Dockerfile: pnpm
was observed forwarding a literal `--` into Vite's argv, which Vite's CLI
parser treats as "positional args from here," silently discarding the flag.

**`Cannot find module '@kinvo/contracts'` (native dev, or `apps/web` build
fails with a missing-export error)**
Contracts hasn't been built yet, or is stale. Run `pnpm run build:contracts`.
This is a compiled workspace package, not a symlinked source import — Vite/
Rollup resolve it via `dist/`, not `src/`.

**`ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` after `pnpm install`, mentioning
"Ignored build scripts"**
pnpm blocks postinstall scripts for new dependencies by default as a
supply-chain safety measure. If a legitimate new dependency needs one, add
it to `pnpm.onlyBuiltDependencies` in the root `package.json`, then
`pnpm install` again. Don't reach for `--ignore-scripts` or disabling this
protection wholesale.

**Docker containers can't reach each other / `ECONNREFUSED` between `api`
and `postgres`/`redis`**
Confirm you're using the hostnames `postgres`/`redis` (the compose service
names), not `localhost`, inside container-to-container config — this is
already handled by `docker-compose.yml`'s `environment:` block, so this
usually means a `.env` file got bind-mounted in and is overriding the
compose-provided value. (It shouldn't: Node's `--env-file` does not override
already-set process env vars, and compose sets them before the process
starts — but if you've changed the dev command, re-verify that ordering.)

**Docker Desktop won't start / `docker info` reports the daemon
unreachable, even though `docker` and `docker compose` CLIs are installed**
On Windows, check `Get-Service com.docker.service` — if it's `Stopped` and
you're not running as Administrator, the service can't be started from a
non-elevated session. If Docker Desktop's own logs
(`%LOCALAPPDATA%\Docker\log\host\com.docker.backend.exe.log`) show an error
like `initializing Inference manager: listening on unix://.../dockerInference:
remove ...: The file cannot be accessed by the system`, a stale AF_UNIX
socket reparse point is blocking startup. Neither `Remove-Item` nor `del`
can clear it without elevation. Fix: run Docker Desktop's own **Troubleshoot
→ Clean / Purge data** (or `fsutil reparsepoint delete` on the specific
file) from an **elevated** PowerShell session, or simply reboot — a reboot
releases the stuck handle. This is a known class of Docker Desktop on
Windows issue, not something specific to this repo.

**Want a completely clean slate?**

```bash
docker compose down -v
rm -rf node_modules apps/*/node_modules packages/*/node_modules packages/contracts/dist apps/*/dist
pnpm install
pnpm run build:contracts
```
