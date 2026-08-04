# Kinvo — System Architecture & Implementation Plan

Status: draft v1 · Owner: Lead Architecture · Scope: post-UI-prototype build-out

This document is the single source of truth for how Kinvo goes from a static UI
prototype to a production-grade, multi-tenant SaaS product. It is meant to be
revised as decisions get tested against reality — treat it as living, not frozen.

---

## 0. Framing decisions (read this before anything else)

The brief specified a tech stack and a list of concerns to plan for, but three
things were _implied, not stated_, and they change the shape of everything
below. Calling them out now instead of discovering them in Phase 4:

1. **This is multi-tenant from day one.** "Serve thousands of logistics
   companies" means every table that holds business data needs an
   `organizationId`, every query needs to be scoped by it, and auth tokens need
   to carry it. Retrofitting multi-tenancy after the schema exists is a
   rewrite, not a migration. We adopt **shared database, shared schema, row-level
   `organizationId` scoping** — not schema-per-tenant or database-per-tenant.
   Schema-per-tenant looks appealing for isolation but is an operational tax
   (migrations run N times, connection pool exhaustion, cross-tenant reporting
   becomes hard) that doesn't pay off until you have enterprise customers
   demanding physical isolation. We can revisit for a specific customer later;
   we should not pay that cost for customer #1.

2. **A real-time layer is mandatory, even though it wasn't listed.** The whole
   value proposition is "the manager supervises instead of dials." If a Yellow
   Zone escalation or a call outcome only shows up after a manual page refresh,
   the product doesn't do the thing it claims to do. We're adding **WebSockets
   (Socket.io)** to the stack for this reason — see §11.

3. **CALL-E must be integrated behind an interface, not called directly from
   business logic.** It's a hackathon-era third-party dependency: its API
   shape may change, sandbox reliability during a live demo is a real risk,
   and you will want to fake it in tests and in local dev. We treat it as a
   pluggable **Voice Provider** with one adapter implementation, not a library
   sprinkled through the codebase. See §10.

Two things in the brief I'm pushing back on directly:

- **"Repository pattern where appropriate" — appropriate means _not
  everywhere_.** Prisma's client is already a query-builder/data-mapper
  abstraction. Wrapping every model in a `ShipRepository` that just forwards
  to `prisma.ship.*` is ceremony with no payoff — nobody is swapping ORMs, and
  it makes call sites harder to read for no testability gain (you can mock
  Prisma directly, or better, hit a real test database). Repositories earn
  their keep only where query logic is genuinely complex and reused across
  services (e.g., "find drivers eligible for a ship" involves several joins
  and filters used by both the matching engine and the UI search endpoint).
  Default to calling Prisma from services; extract a repository only when a
  query is non-trivial and reused.

- **"Dependency injection where useful" — skip a DI framework.** InversifyJS /
  tsyringe-style container DI is a lot of decorator magic for a team this
  size. Plain constructor injection with a manual composition root
  (`container.ts` that wires concrete instances once at startup) gets you the
  same testability (swap a fake `VoiceProvider` in tests) with zero framework
  and no runtime reflection. Revisit only if the module graph gets
  genuinely tangled — it won't for this domain.

---

## 1. System Architecture

```
                         ┌─────────────────────────┐
                         │   Web App (React SPA)   │
                         │  TanStack Router/Query   │
                         └────────────┬─────────────┘
                                      │ HTTPS (REST) + WSS (Socket.io)
                         ┌────────────▼─────────────┐
                         │        API Gateway        │
                         │  Express (stateless pods)│
                         │  authN/authZ, validation  │
                         └───┬───────────────────┬───┘
                 ┌───────────┘                   └───────────┐
      ┌──────────▼─────────┐                     ┌───────────▼──────────┐
      │   PostgreSQL         │                    │   Redis                │
      │  (Prisma ORM)        │                    │  queues + pub/sub +   │
      │  source of truth     │                    │  cache + rate-limit   │
      └──────────┬───────────┘                    └───────────┬───────────┘
                 │                                             │
                 │                                  ┌──────────▼───────────┐
                 │                                  │  Background Workers    │
                 │                                  │  (BullMQ processors)   │
                 │                                  │  - outbound call jobs  │
                 │                                  │  - webhook processing  │
                 │                                  │  - reminder campaigns  │
                 │                                  └──────────┬───────────┘
                 │                                             │
      ┌──────────▼───────────┐                      ┌──────────▼───────────┐
      │  Object Storage        │                     │  CALL-E (Voice AI)    │
      │  (S3-compatible)       │                     │  outbound/inbound     │
      │  driver docs, photos   │                     │  calls + webhooks     │
      └────────────────────────┘                     └────────────────────────┘
```

Key properties:

- **API is stateless.** Any pod can serve any request; session state lives in
  the JWT + Postgres, never in process memory. This is what makes horizontal
  scaling and rolling deploys safe.
- **Workers are a separate deployable from the API**, even though they share
  the same codebase (monorepo). Outbound call fan-out for a 300-driver ship
  should never compete with API request-handling threads for CPU/event-loop
  time.
- **Webhooks (from CALL-E) never do synchronous heavy work in the request
  handler.** They validate the signature, enqueue a job, and return 200
  immediately. Telephony providers retry aggressively on timeout; slow
  handlers cause duplicate processing.

---

## 2. Folder Structure

Monorepo, pnpm workspaces (Turborepo optional once build times hurt — not
needed at this size yet).

```
kinvo/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── health/          # liveness/readiness — Phase 0, infra-only, no business logic
│   │   │   │   ├── auth/            # login, refresh, registration
│   │   │   │   ├── organizations/
│   │   │   │   ├── users/
│   │   │   │   ├── ships/
│   │   │   │   ├── drivers/
│   │   │   │   ├── assignments/     # ship <-> driver engagement
│   │   │   │   ├── calls/           # call log + CALL-E webhook intake
│   │   │   │   ├── yellow-zone/
│   │   │   │   ├── campaigns/       # reminder campaigns
│   │   │   │   ├── documents/       # upload/verify
│   │   │   │   └── notifications/
│   │   │   │       each module: routes.ts, controller.ts, service.ts,
│   │   │   │       schemas.ts (Zod), repository.ts (only if warranted)
│   │   │   ├── core/
│   │   │   │   ├── middleware/      # auth, rbac, tenant-scope, error handler
│   │   │   │   ├── errors/          # AppError hierarchy
│   │   │   │   ├── events/          # internal event bus
│   │   │   │   ├── jobs/            # BullMQ queues + processors
│   │   │   │   ├── voice-provider/  # CALL-E adapter behind an interface
│   │   │   │   ├── storage/         # S3/Cloudinary adapter
│   │   │   │   ├── logger.ts
│   │   │   │   └── container.ts     # composition root (manual DI)
│   │   │   ├── config/              # env parsing (Zod-validated at boot)
│   │   │   └── server.ts
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   └── test/                    # integration tests (real test DB)
│   └── web/
│       ├── src/
│       │   ├── routes/              # TanStack Router route tree
│       │   ├── features/
│       │   │   ├── ships/           # components, hooks, api.ts, per feature
│       │   │   ├── drivers/
│       │   │   ├── yellow-zone/
│       │   │   ├── campaigns/
│       │   │   └── auth/
│       │   ├── components/ui/       # shadcn primitives, generic only
│       │   ├── lib/                 # api client, query client, socket client
│       │   └── stores/              # Zustand — UI state ONLY, never server data
│       └── test/
├── packages/
│   ├── contracts/                   # Zod schemas + inferred types, shared
│   │   └── src/{ship,driver,assignment,call,...}.schema.ts
│   └── config/                      # shared eslint/tsconfig
├── docker-compose.yml                # postgres, redis, api, worker, web
└── docs/
```

**Why `packages/contracts` matters**: define each entity's Zod schema once.
The API uses it to validate requests; the frontend imports the _same_ schema
for React Hook Form validation and gets the TS type via `z.infer`. This is
the difference between "frontend and backend types drift within three sprints"
and "they cannot drift, because there's only one definition."

---

## 3. Database Schema & 4. Entity Relationships

Core entities (fields abbreviated to what matters architecturally — full
column list belongs in the Prisma schema, not this doc):

| Entity                 | Key fields                                                                                                    | Notes                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `Organization`         | name, plan, createdAt                                                                                         | The tenant. Everything else hangs off this.              |
| `User`                 | orgId, email, passwordHash, role, phone                                                                       | Role: `OWNER`, `ADMIN`, `DISPATCHER`, `VIEWER`           |
| `RefreshToken`         | userId, tokenHash, expiresAt, revokedAt, replacedByTokenId                                                    | Enables rotation + reuse detection                       |
| `Ship`                 | orgId, name, destination, etaAt, reportingTime, rate, rateUnit, status                                        | Status machine, see below                                |
| `TruckRequirement`     | shipId, truckType, quantityNeeded                                                                             | 1 ship → N requirement rows                              |
| `DocumentRequirement`  | shipId, documentType, isRequired                                                                              | What must be collected per ship                          |
| `Driver`               | orgId, name, phone (unique per org), licenseNumber, vehiclePlate, status                                      | Reusable across ships                                    |
| `ShipDriverAssignment` | shipId, driverId, status, invitedAt, respondedAt, cancellationReason                                          | The join entity — one row per driver-per-ship engagement |
| `AssignmentDocument`   | assignmentId, documentRequirementId, fileUrl, verifiedStatus                                                  | Ship-specific doc submissions                            |
| `Call`                 | orgId, direction, providerCallId, assignmentId?, driverId?, status, recordingUrl, transcript, durationSeconds | One row per CALL-E call, inbound or outbound             |
| `YellowZoneItem`       | orgId, callId, shipId?, driverId?, reason, priority, status, assignedToUserId, resolutionNotes                | The escalation queue                                     |
| `ReminderCampaign`     | shipId, scheduledAt, status, approvedByUserId, approvedAt                                                     | Approval gate before pre-arrival calls fire              |
| `Notification`         | orgId, userId, type, payload(json), readAt                                                                    | In-app + drives websocket push                           |
| `AuditLog`             | orgId, actorUserId, action, entityType, entityId, metadata(json)                                              | Immutable, append-only                                   |

**Relationships**

```
Organization 1───N User
Organization 1───N Ship
Organization 1───N Driver
Ship          1───N TruckRequirement
Ship          1───N DocumentRequirement
Ship          1───N ShipDriverAssignment ───N:1─── Driver
ShipDriverAssignment 1───N AssignmentDocument ───N:1─── DocumentRequirement
Ship          1───0/1 ReminderCampaign
Call          N:1 Driver (nullable — inbound calls may arrive before match)
Call          N:1 ShipDriverAssignment (nullable)
Call          1───0/1 YellowZoneItem
User          1───N Notification
User          1───N AuditLog (as actor)
```

**Status machines** (model as enums with an explicit transition table enforced
in the service layer, not left implicit — this is where "who cancelled and
why" bugs come from if skipped):

- `Ship`: `DRAFT → RECRUITING → CONFIRMED → IN_PROGRESS → COMPLETED`, with
  `CANCELLED` reachable from any pre-`COMPLETED` state.
- `ShipDriverAssignment`: `INVITED → CALLING → CONFIRMED | REJECTED`,
  `CONFIRMED → CANCELLED_BY_DRIVER → (replacement recruitment triggers a new
assignment row, doesn't mutate the old one — you want the history)`.
- `YellowZoneItem`: `PENDING → IN_REVIEW → RESOLVED | DISMISSED`.

**Tenant scoping enforcement**: a Prisma middleware (`$use`) that
auto-injects `organizationId` into every `where` clause based on
request-scoped context (AsyncLocalStorage), so a developer forgetting to
scope a query fails closed rather than leaking cross-tenant data. This is
the single highest-value security control in a multi-tenant app — treat it
as non-negotiable, not a nice-to-have.

---

## 5. API Design

REST, versioned (`/api/v1`), resource-oriented, feature-module-aligned with
the folder structure. Representative surface:

```
POST   /api/v1/auth/register-organization
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout

GET    /api/v1/ships                 ?status=&page=
POST   /api/v1/ships
GET    /api/v1/ships/:id
PATCH  /api/v1/ships/:id
POST   /api/v1/ships/:id/recruit     # triggers outbound call fan-out job

GET    /api/v1/drivers               ?search=&status=
POST   /api/v1/drivers
PATCH  /api/v1/drivers/:id

GET    /api/v1/ships/:id/assignments
PATCH  /api/v1/assignments/:id       # manual override by manager

POST   /api/v1/documents/upload-url  # returns pre-signed URL
POST   /api/v1/documents/:id/confirm

GET    /api/v1/yellow-zone           ?status=pending
PATCH  /api/v1/yellow-zone/:id       # resolve/dismiss/reassign

POST   /api/v1/ships/:id/campaigns
PATCH  /api/v1/campaigns/:id/approve

POST   /api/v1/webhooks/call-e       # signature-verified, provider callback
```

Cross-cutting on every authenticated route: `authenticate` →
`attachTenantContext` → `authorize(roles)` → Zod `validate(schema)` →
controller. Pagination via cursor (not offset) on list endpoints once tables
grow — `Call` will be the largest table by an order of magnitude.

---

## 6. Authentication Flow

- Access token: JWT, 15 min TTL, carries `userId`, `organizationId`, `role`.
- Refresh token: opaque random value, stored **hashed** in `RefreshToken`,
  delivered as an `httpOnly`, `Secure`, `SameSite=Strict` cookie — never in
  JS-readable storage (kills the XSS-steals-the-token class of bug).
- Rotation on every refresh; if a already-used/revoked refresh token is
  presented, treat it as a reuse/theft signal and revoke the entire token
  family for that user, forcing re-login.
- `attachTenantContext` middleware reads `organizationId` off the verified
  JWT and puts it in AsyncLocalStorage for the Prisma tenant-scoping
  middleware to pick up — the client never supplies `organizationId` on a
  request; it's derived, never trusted from input.

## 7. User Roles

| Role         | Can do                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `OWNER`      | Everything `ADMIN` can, plus billing/org settings, cannot be removed by others                      |
| `ADMIN`      | Manage users, all ship/driver/campaign operations                                                   |
| `DISPATCHER` | Create/manage ships, drivers, assignments, resolve Yellow Zone — the primary persona from the brief |
| `VIEWER`     | Read-only — for auditors, client-facing status views later                                          |

RBAC as a small declarative table (`role → permitted actions`) checked in
middleware, not scattered `if (user.role === 'ADMIN')` checks through
controllers.

## 8. State Management Strategy (Frontend)

- **Server state**: TanStack Query, full stop. It is the cache; do not
  mirror ships/drivers/calls into a Zustand/Redux store — that's the classic
  "two sources of truth silently disagree" bug generator.
- **Real-time sync**: Socket.io events (`assignment.updated`,
  `yellow_zone.created`, `call.completed`) call
  `queryClient.invalidateQueries` (or `setQueryData` for high-frequency
  updates like call status) — the socket is a cache-invalidation signal, not
  a parallel state system.
- **Client/UI-only state** (active filters, modal open/closed, selected
  rows): Zustand, small and local to a feature.
- **Forms**: React Hook Form + Zod resolver, schema imported from
  `packages/contracts` — same schema the API validates against.

## 9. File Upload Strategy

Client requests a pre-signed upload URL (`POST /documents/upload-url` with
`{ documentType, mimeType }`) → uploads directly to S3-compatible storage
from the browser → confirms completion (`POST /documents/:id/confirm`) which
the backend verifies (HEAD request to storage) before marking the document
`PENDING_VERIFICATION`. Express never proxies file bytes — keeps API pods
lightweight and avoids multipart body-size tuning. Enforce mime-type and
size limits both client-side (fast feedback) and server-side (the only limit
that matters for security) at signed-URL issuance.

## 10. CALL-E Integration Architecture

```
core/voice-provider/
  ├── VoiceProvider.ts       # interface: initiateCall(), sendReminder(), cancelCall()
  ├── CallEAdapter.ts        # concrete implementation against CALL-E SDK
  └── FakeVoiceProvider.ts   # for local dev / tests / demo fallback
```

- Business logic (e.g. `ships.recruit()`) depends on the `VoiceProvider`
  interface only, injected via the composition root. Swapping providers, or
  running the entire demo against `FakeVoiceProvider` if the live sandbox
  flakes mid-demo, is a one-line config change.
- **Webhook intake**: `POST /webhooks/call-e` verifies the provider's
  signature header, does the absolute minimum (persist raw event,
  acknowledge 200), and enqueues a `processCallEvent` job. All state
  transitions (assignment confirmed, driver rejected, escalate to Yellow
  Zone) happen in the worker, idempotently (keyed on provider event ID —
  webhooks _will_ be delivered more than once).
- Escalation classification (routine vs. Yellow Zone) is whatever signal
  CALL-E's payload gives us (e.g. confidence score / explicit escalation
  flag) mapped to a `YellowZoneItem` creation — kept as a single mapping
  function so the classification rule can change without touching the
  webhook plumbing.

## 11. Notification Architecture

Internal event bus (start as a plain Node `EventEmitter` inside one process;
graduate to Redis pub/sub the moment there's more than one API instance,
since an in-process emitter can't fan out across pods) — producers
(webhook worker, campaign scheduler) emit domain events
(`yellow_zone.created`, `assignment.cancelled`), and consumers subscribe
independently:

- Persist a `Notification` row (in-app inbox, survives disconnects).
- Push over Socket.io to connected clients in that `organizationId`'s room.
- (Future) SMS/email digest for high-priority escalations if no manager is
  online — out of scope for MVP but the event-bus shape supports adding it
  without touching producers.

## 12. Logging

Structured JSON logs via `pino`, one line per event, request-correlated via
an `AsyncLocalStorage`-carried request ID (also returned to the client as
`X-Request-Id` for support correlation). Two distinct streams, don't
conflate them:

- **Operational logs** (pino, stdout → log aggregator later): debugging,
  ephemeral, fine to be verbose.
- **Audit log** (`AuditLog` table): business-meaningful actions
  (who approved a campaign, who resolved a Yellow Zone item) — persisted,
  immutable, queryable by the product itself, not just ops.

## 13. Error Handling

`AppError` base class (`NotFoundError`, `ValidationError`, `ConflictError`,
`UnauthorizedError`, `ForbiddenError`) thrown from services, caught by one
Express error-handling middleware that maps to HTTP status + a consistent
JSON error shape (`{ error: { code, message, requestId } }`). Zod validation
failures are caught centrally and reformatted the same way — controllers
never hand-write error responses. No stack traces or internal messages
leak in production responses; full detail goes to the log, keyed by
`requestId`.

## 14. Background Jobs

Redis + BullMQ. Queues:

- `outbound-calls` — fan-out one job per driver when a ship enters
  `RECRUITING`; rate-limited concurrency (don't blow past CALL-E's own rate
  limits).
- `webhook-events` — processes CALL-E callbacks idempotently.
- `campaigns` — fires approved reminder campaigns at `scheduledAt`
  (delayed jobs), one job per confirmed assignment.
- `notifications-fanout` — persists + broadcasts events from the internal
  bus (kept as a queue rather than fire-and-forget so a Socket.io hiccup
  doesn't lose a notification).

Workers run as a separate process/container from the API from day one, even
in Phase 1 scaffolding — trivial to do early, expensive to retrofit once code
assumes it's always in-request.

## 15. Security Considerations

In priority order for this domain:

1. **Tenant isolation** (§4) — the one that causes headline-news breaches if
   missed.
2. **Webhook signature verification** on the CALL-E callback — otherwise
   anyone can POST fake "driver confirmed" events.
3. **RBAC enforced server-side** on every mutating route — the UI hiding a
   button is not access control.
4. Rate limiting (`express-rate-limit` + Redis store) on `/auth/*` and
   `/webhooks/*` specifically.
5. Refresh token rotation + reuse detection (§6).
6. Zod validation at every input boundary — body, query params, and route
   params.
7. `helmet` defaults, strict CORS allowlist (no `*` in production).
8. Argon2 (preferred over bcrypt for new systems) for password hashing.
9. Signed URLs for uploads are short-lived and scoped to one object key —
   never a general-purpose bucket credential handed to the client.
10. Secrets via environment variables injected by the deploy platform, never
    committed; `.env.example` checked in, `.env` gitignored.

## 16. Deployment Architecture

- **Local dev**: `docker-compose.yml` — Postgres, Redis, `api`, `worker`,
  `web` (Vite dev server). One command up.
- **Production**: API and worker as separate container deployments (so
  worker concurrency scales independently of request throughput) behind a
  managed load balancer; managed Postgres (not self-hosted — RDS/Neon/
  Supabase-class, automated backups matter more than saving the hosting
  cost); managed Redis; frontend built to static assets served via CDN
  (Vercel/Netlify/Cloudflare Pages) rather than served by Express — no
  reason to make Node serve static files.
- Database migrations run as a release step (`prisma migrate deploy`)
  gated in CI before the new API image is promoted, never run ad hoc against
  prod.

## 17. Environment Variables

Parsed and validated with Zod at process boot (`config/env.ts`) — the app
should refuse to start with a missing/malformed var, not fail confusingly at
first use.

```
NODE_ENV, PORT, LOG_LEVEL
DATABASE_URL
REDIS_URL
JWT_ACCESS_SECRET, JWT_ACCESS_TTL
JWT_REFRESH_SECRET, JWT_REFRESH_TTL
CORS_ORIGIN
CALL_E_API_KEY, CALL_E_WEBHOOK_SECRET, CALL_E_BASE_URL
STORAGE_PROVIDER (s3|cloudinary), STORAGE_BUCKET, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY, STORAGE_REGION
SENTRY_DSN (optional, Phase 7)
```

## 18. Testing Strategy

Pyramid, weighted toward the middle — this domain's risk is in workflow
correctness (state transitions, webhook idempotency), not pure functions:

- **Unit**: domain/service logic (status transition rules, RBAC permission
  table, escalation classification mapping) — Vitest.
- **Integration**: API routes against a real Postgres (docker-compose test
  db or Testcontainers) — this catches the tenant-scoping middleware
  actually working, which a mocked-Prisma unit test cannot.
- **Webhook contract tests**: fixture-based, replaying recorded/representative
  CALL-E payloads including duplicate-delivery to prove idempotency.
- **Frontend component tests**: Vitest + Testing Library for feature
  components with non-trivial logic (forms, status displays).
- **E2E** (Playwright): one suite covering the golden path from the brief
  end-to-end (create ship → invite drivers → confirm → Yellow Zone →
  approve campaign) against a seeded environment with `FakeVoiceProvider`.

Don't chase coverage percentage; chase "is the core workflow from the brief
provably correct."

## 19. CI/CD Strategy

GitHub Actions:

- On every PR: install, typecheck, lint, unit + integration tests (spin up
  Postgres/Redis as service containers), `prisma migrate diff` check against
  main to catch drift.
- On merge to `main`: build and push Docker images (api, worker), deploy to
  **staging** automatically, run the Playwright E2E suite against staging.
- **Production**: manual promotion (a human clicks deploy) — this is a
  logistics product moving real money/trucks; automatic prod deploys on
  green CI is the wrong risk tradeoff at this stage.

## 20. Scaling Strategy

- API: stateless, horizontally scaled behind the load balancer — scale on
  request latency/CPU.
- Workers: scaled independently on **queue depth**, not request metrics —
  a 500-driver ship recruitment burst is a worker-scaling event, not an API
  one.
- Postgres: index every foreign key and every `(organizationId, status)`
  pair up front (these are the query patterns on day one, not an
  optimization for later). Read replica for dashboard/reporting queries once
  `Call` volume makes it necessary — don't build it before there's a
  measured need.
- `Call` will be the highest-volume, fastest-growing table by a wide margin
  (every ring, every webhook event) — plan for time-based partitioning or
  periodic archival before it becomes a problem, not after.
- Redis: also backs rate limiting and pub/sub, so its own availability
  becomes load-bearing once you're past one API instance — run it managed,
  not on a laptop-grade container, past Phase 1.

---

## Milestones

Each phase ends with something you can click through end-to-end and demo —
not a partially-wired feature.

**Phase 0 — Foundation**
pnpm monorepo scaffold, `packages/contracts`, Docker Compose (Postgres,
Redis), CI skeleton (lint/typecheck/test on PR), env validation. _Ends with_:
`docker compose up` gives a running API returning `200` on `/health` and a
Vite dev server serving a blank shell.

**Phase 1 — Authentication & Multi-tenancy**
`Organization`, `User`, `RefreshToken` models + migration; register-org,
login, refresh, logout; JWT + tenant-context middleware; RBAC scaffold.
**Also mandatory for this phase's completion (see Decisions log): retire the
Phase 0 `pg`-based database shim entirely** — generate the real Prisma
client, migrate the readiness check to `prisma.$queryRaw`, delete
`core/database.ts` and the `pg` dependency. Phase 1 is not done while both
data-access paths exist side by side. _Ends with_: a real login screen
backed by a real database, issuing tokens that scope subsequent requests to
the right organization.

**Phase 2 — Ship & Driver Management**
Full schema for `Ship`, `TruckRequirement`, `DocumentRequirement`, `Driver`;
CRUD endpoints; wire the existing prototype's ship-creation and driver-list
screens to real data via TanStack Query. _Ends with_: a manager can create a
ship with requirements and see a real driver roster, fully persisted.

**Phase 3 — Assignments & Manual Workflow**
`ShipDriverAssignment`, `AssignmentDocument`; invite/confirm/reject/cancel
transitions; document upload flow (pre-signed URLs). No AI calling yet —
managers can manually mark outcomes. _Ends with_: the full recruitment
workflow works end-to-end operated by a human, which is also your demo
fallback if live telephony misbehaves.

**Phase 4 — CALL-E Outbound Integration**
`VoiceProvider` interface + `CallEAdapter`, `outbound-calls` queue, `Call`
model, webhook intake + idempotent processing. _Ends with_: creating a ship
and clicking "recruit" places real automated calls, and assignment statuses
update live from call outcomes.

**Phase 5 — Inbound Calls & Yellow Zone**
Inbound webhook handling, escalation classification, `YellowZoneItem`,
Socket.io real-time push, Yellow Zone review UI. _Ends with_: an inbound call
CALL-E can't resolve shows up live in the manager's Yellow Zone queue and can
be resolved from the UI.

**Phase 6 — Reminder Campaigns & Notifications**
`ReminderCampaign`, approval gate, `campaigns` queue, cancellation →
replacement-recruitment loop, `Notification` model + inbox. _Ends with_: the
complete 11-step workflow from the brief runs start to finish, including
the cancellation/replacement branch.

**Phase 7 — Hardening**
Security pass (rate limiting, signature verification audit, CORS lockdown),
structured logging + request correlation, test coverage on the golden path

- webhook idempotency, CI/CD to staging with manual prod promotion, DB
  indexing pass. _Ends with_: a deployable, demo-safe, production-credible
  build.

---

## Decisions log

**Driver pool scope (resolved 2026-08-04).** Drivers are organization-scoped
for V1 — each logistics company manages its own independent driver database.
`Driver.phone` is unique **per organization**, not globally, which keeps
permissions, privacy, and every query (`WHERE organizationId = ? AND phone =
?`) simple and consistent with the tenant-scoping model in §4. A global
`Driver` entity with cross-org memberships (a driver marketplace) is
explicitly out of scope for this project and would be a deliberate schema
redesign, not an incremental change, if ever pursued.

**CALL-E integration — spike required before Phase 4 (added 2026-08-04).**
Nothing in §10 should be treated as confirmed until validated against the
real CALL-E documentation and sandbox. Before any Phase 4 production code is
written, run a time-boxed technical spike (target: one day) and produce a
short written record answering:

- What do webhook payloads actually look like, per event type?
- What is the full event lifecycle for an outbound call and an inbound call?
- How are webhook requests authenticated/signed, and how do we verify them?
- What is CALL-E's retry behavior on webhook delivery failure (backoff,
  attempt count, timeout window)?
- What idempotency key(s) does CALL-E provide, if any — or do we need to
  derive one ourselves?
- What happens on a timeout or dropped call mid-conversation?
- What failure modes exist on CALL-E's side (rate limits, sandbox outages,
  malformed responses) and how should the adapter degrade?
- Given the above, does the `VoiceProvider` interface / adapter / webhook
  design in §10 still hold, or does it need to change?

If the spike's findings contradict any assumption in §10, this document gets
updated **before** Phase 4 implementation starts — we are not building
production call-handling logic on guessed webhook semantics.

**Phase 0 database health check uses `pg`, not Prisma — explicitly temporary,
migration mandated for Phase 1 (added 2026-08-04, confirmed with product
owner same day).** `prisma generate` hard-refuses to run with zero models
defined — this is a CLI constraint, not a config problem, confirmed
empirically while building Phase 0. Rather than add a throwaway model just
to unblock the tool (which would be exactly the kind of placeholder these
rules rule out), Phase 0's Postgres readiness check
(`apps/api/src/core/database.ts`) uses the plain `pg` driver directly.
Prisma's schema file, datasource config, and `prisma validate`/`prisma
format` tooling are still in place and exercised by CI — only client
generation is deferred.

This is a stopgap, not a second permanent data-access layer. The product
owner has explicitly required that it be retired the moment it's no longer
necessary, not left to linger. **Phase 1 must include, as part of its own
completion criteria (not a follow-up, not "later"):**

1. Add `Organization`, `User`, `RefreshToken` models to `schema.prisma`.
2. Re-add `@prisma/client` as an `apps/api` dependency and run `prisma
generate` for real.
3. Run the first real `prisma migrate dev` (this also produces the
   migration history the empty Phase-0 schema couldn't).
4. **Delete `apps/api/src/core/database.ts` and the `pg` dependency
   entirely** — rewrite the readiness check's Postgres probe as
   `prisma.$queryRaw\`SELECT 1\`` against the generated client.
5. Update `apps/api/src/modules/health/health.service.ts` and
   `apps/api/src/server.ts` (shutdown hook: `pool.end()` →
   `prisma.$disconnect()`) accordingly.
6. Confirm nothing in the codebase still imports from `core/database.ts` or
   depends on `pg` before considering Phase 1 done.

Phase 1 is not complete while both a `pg` pool and a Prisma client exist
side by side — that would be exactly the "duplicate database layer" /
carried-forward technical debt this note exists to prevent.
