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

| Entity                 | Key fields                                                                                                                                                                                                         | Notes                                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Organization`         | name, plan, createdAt                                                                                                                                                                                              | The tenant. Everything else hangs off this.                                                                                                                                                     |
| `User`                 | orgId, email, passwordHash, role, phone                                                                                                                                                                            | Role: `OWNER`, `ADMIN`, `DISPATCHER`, `VIEWER`                                                                                                                                                  |
| `RefreshToken`         | userId, tokenHash, expiresAt, revokedAt, replacedByTokenId                                                                                                                                                         | Enables rotation + reuse detection                                                                                                                                                              |
| `Ship`                 | orgId, shipName, company, eta, reportingTime, berth, gate, cargoType, status, notes                                                                                                                                | Status machine, see below. Field set finalized against the Kinvo.dc.html UI export in Phase 2 — see Decisions log. **No rate field** — a ship does not have one price, see below                |
| `TruckRequirement`     | shipId, destination, truckType, quantityNeeded, rate, rateCurrency, notes                                                                                                                                          | 1 ship → N rows; **destination and rate are both per-row**, not per-ship — real port trucking prices per destination/truck type, not per voyage — see the Phase 2 product-polish decision below |
| `DocumentRequirement`  | shipId, documentType, isRequired                                                                                                                                                                                   | What must be collected per ship — new UI screen, no prototype reference existed (see Decisions log)                                                                                             |
| `Driver`               | orgId, fullName, phone (unique per org), licenseNumber, nationalId, truckPlate, truckType, capacity, languages, preferredRoutes, preferredCompanies, rating, previousJobsCount, availability, currentShipId, notes | Reusable across ships. `currentShipId` is a nullable FK for future assignment display, not user-editable in Phase 2 (assignments are Phase 3 scope)                                             |
| `ShipDriverAssignment` | shipId, driverId, status, invitedAt, respondedAt, cancellationReason                                                                                                                                               | The join entity — one row per driver-per-ship engagement                                                                                                                                        |
| `AssignmentDocument`   | assignmentId, documentRequirementId, fileUrl, verifiedStatus                                                                                                                                                       | Ship-specific doc submissions                                                                                                                                                                   |
| `Call`                 | orgId, direction, providerCallId, assignmentId?, driverId?, status, recordingUrl, transcript, durationSeconds                                                                                                      | One row per CALL-E call, inbound or outbound                                                                                                                                                    |
| `YellowZoneItem`       | orgId, callId, shipId?, driverId?, reason, priority, status, assignedToUserId, resolutionNotes                                                                                                                     | The escalation queue                                                                                                                                                                            |
| `ReminderCampaign`     | shipId, scheduledAt, status, approvedByUserId, approvedAt                                                                                                                                                          | Approval gate before pre-arrival calls fire                                                                                                                                                     |
| `Notification`         | orgId, userId, type, payload(json), readAt                                                                                                                                                                         | In-app + drives websocket push                                                                                                                                                                  |
| `AuditLog`             | orgId, actorUserId, action, entityType, entityId, metadata(json)                                                                                                                                                   | Immutable, append-only                                                                                                                                                                          |

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

**Tenant scoping enforcement**: a Prisma **Client Extension** (`$extends`,
not the deprecated `$use` middleware API — see the Decisions log) that
auto-injects `organizationId` into every `where`/`data`/`create`/`update`
clause on tenant-scoped models, based on request-scoped context
(AsyncLocalStorage). Fails closed: if the extension runs against a
tenant-scoped model with no context bound, it throws rather than silently
running an unscoped query. This is the single highest-value security
control in a multi-tenant app — treat it as non-negotiable, not a
nice-to-have.

**Status (resolved, Phase 1):** implemented in `apps/api/src/core/prisma.ts`.
The AsyncLocalStorage primitive first built for Phase 0 audit finding C3 was
widened from a narrow tenant-context into a full **Current Context** object
— see §6a — and now lives in `apps/api/src/core/request-context.ts`
(`runWithRequestContext` / `getRequestContext`). The `authenticate`
middleware populates it once per request from the verified JWT; the Prisma
extension's `$allOperations` hook consumes it on every operation against a
model in `TENANT_SCOPED_MODELS` (currently `Membership`, `Invitation`,
`Ship`, `Driver` — every model added in a future phase that holds
organization-owned data belongs on that list the moment it exists).
`test/integration/tenant-isolation.test.ts`
proves the guarantee end-to-end: an authenticated request for Organization A
cannot see or mutate Organization B's rows, even via list endpoints that
pass no `where` clause at all — an earlier version of the extension only
merged `organizationId` in when the caller had already supplied a `where`,
which silently left `findMany()`-with-no-filter calls unscoped; the fix is
an explicit allowlist of operations that always get `where` merged in,
defaulting to `{}` rather than skipping the merge.

A documented, logged escape hatch (`withoutTenantScope`) exists for the
handful of legitimately pre-tenant-context operations — looking a user up
by email at login, creating the first Membership during registration,
resolving an Invitation by its token during acceptance. It operates on the
raw, unextended Prisma client rather than an ALS "bypass" flag: an earlier
implementation gating the extended client behind a bypass flag was
empirically unreliable across `$transaction`'s internal continuations.
Every call site supplies a `reason` and logs at `warn` — this must stay
rare, and any new call site outside auth/registration/invitation-acceptance
is a sign the operation should be redesigned to run inside a bound request
context instead.

**Sub-resources with no direct `organizationId` column (added Phase 2).**
`TruckRequirement` and `DocumentRequirement` belong to a `Ship`, not directly
to an `Organization` — they have no `organizationId` column of their own, so
they cannot be added to `TENANT_SCOPED_MODELS` (the extension's merge logic
needs that column to exist on the model). Adding a denormalized
`organizationId` to these tables purely to reuse the extension was
considered and rejected: it would duplicate a fact already derivable from
`shipId`, and create a way for the denormalized copy to drift from the
real owner if a ship were ever reparented. Instead, `ships.service.ts`
resolves and verifies the parent `Ship` through the tenant-scoped Prisma
client _first_, on every sub-resource operation, before touching the
sub-resource row — `resolveOwnedShip()` does this once and every
truck/document-requirement function starts from its result rather than
trusting a client-supplied `shipId` directly. A sub-resource ID that
belongs to a different ship, or to a ship owned by a different
organization, produces the identical 404 as one that doesn't exist at
all — same "invisible, not forbidden" principle as the rest of this
codebase's error handling, verified by
`test/integration/ships.test.ts`'s cross-tenant and cross-ship checks.

---

## 5. API Design

REST, versioned (`/api/v1`), resource-oriented, feature-module-aligned with
the folder structure. Representative surface:

```
POST   /api/v1/auth/register-organization
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
POST   /api/v1/auth/logout-all
POST   /api/v1/auth/accept-invitation
GET    /api/v1/auth/me

GET    /api/v1/organizations/members
PATCH  /api/v1/organizations/members/:membershipId
DELETE /api/v1/organizations/members/:membershipId
POST   /api/v1/organizations/invitations
GET    /api/v1/organizations/invitations
DELETE /api/v1/organizations/invitations/:invitationId

GET    /api/v1/ships                 ?search=&status=&page=&pageSize=&sortBy=&sortOrder=
POST   /api/v1/ships
GET    /api/v1/ships/:shipId
PATCH  /api/v1/ships/:shipId
DELETE /api/v1/ships/:shipId
PATCH  /api/v1/ships/:shipId/status   # explicit state-machine transition, Phase 2
POST   /api/v1/ships/:id/recruit      # triggers outbound call fan-out job, Phase 4

GET    /api/v1/ships/:shipId/truck-requirements
POST   /api/v1/ships/:shipId/truck-requirements
PATCH  /api/v1/ships/:shipId/truck-requirements/:truckRequirementId
DELETE /api/v1/ships/:shipId/truck-requirements/:truckRequirementId

GET    /api/v1/ships/:shipId/document-requirements
POST   /api/v1/ships/:shipId/document-requirements
PATCH  /api/v1/ships/:shipId/document-requirements/:documentRequirementId
DELETE /api/v1/ships/:shipId/document-requirements/:documentRequirementId

GET    /api/v1/drivers               ?search=&availability=&page=&pageSize=&sortBy=&sortOrder=
POST   /api/v1/drivers
GET    /api/v1/drivers/:driverId
PATCH  /api/v1/drivers/:driverId
DELETE /api/v1/drivers/:driverId

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
- `authenticate` middleware reads the verified JWT's claims and puts them in
  AsyncLocalStorage for the Prisma tenant-scoping extension to pick up — the
  client never supplies `organizationId` on a request; it's derived, never
  trusted from input.

## 6a. Current Context

Every authenticated request resolves a **Current Context** object exactly
once — in the `authenticate` middleware, from the verified access token's
claims — and binds it to AsyncLocalStorage via `runWithRequestContext`:

```ts
interface RequestContext {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: Role;
}
```

Downstream services never re-query these values; they call
`getRequestContext()` (throws if called with no context bound — fail
closed, same principle as tenant scoping) or receive `req.context` directly
in a controller. This is also what the Prisma tenant-scoping extension
reads to inject `organizationId`.

Deliberately **no separate `Session` table** in Phase 1 — a session's
identity is entirely reconstructable from a valid `RefreshToken` row
(`userId`, `familyId`, `userAgent`, `ip`, `createdAt`, `revokedAt`). An
"Active Sessions" page (list + "log out this device") is addable later as a
pure read + targeted-revoke over the existing `RefreshToken` table, with
zero schema changes — this constraint shaped the `RefreshToken` model's
columns from the start rather than being retrofitted.

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

This section originally sketched an assumed design before any CALL-E
research existed (signature-verified webhooks, an `initiateCall`/
`sendReminder`/`cancelCall` interface). Phase 4 began with a deep technical
spike against the real `@call-e/calle` SDK (source, not just docs) before
writing any production code — see "Phase 4 backend: CALL-E voice
orchestration" in the Decisions log for what that spike found and why the
design below differs from the original sketch in several material ways.

```
core/voice/
  ├── VoiceProvider.ts            # interface: requestConfirmationCall(), getCallOutcome(), parseWebhookSignal()
  ├── CallEAdapter.ts             # concrete implementation against @call-e/calle
  ├── FakeVoiceProvider.ts        # in-memory double for tests / local dev without a CALL-E account
  ├── confirmationResultSchema.ts # the JSON Schema sent to CALL-E as resultSchema
  └── outcomeTranslation.ts       # pure CALL-E Call -> Kinvo VoiceCallOutcome mapping (unit tested directly)

core/queue/
  ├── queueConnection.ts   # BullMQ's own ioredis connection (maxRetriesPerRequest: null — see §14)
  └── queues.ts            # voice-calls, voice-webhook-events, voice-reconciliation queue definitions

modules/voice/
  ├── voice.service.ts     # placeCallForAssignment, executeCallPlacement, processWebhookSignal, reconcileStaleAttempts
  ├── voice.controller.ts  # HTTP handlers for both the dispatcher action and the webhook intake
  ├── voice.routes.ts      # POST /assignments/:id/voice-calls (authenticated) + POST /webhooks/call-e (public)
  └── voice.workers.ts     # BullMQ Worker registration, run only from apps/api/src/worker.ts
```

- Business logic depends only on the `VoiceProvider` interface, injected via
  the composition root (`core/container.ts`) — CALL-E is the first
  implementation, not the only one this was designed for. The interface
  deliberately hides every CALL-E-specific concept (Calls vs. Goal Runs,
  recipients, `structured_result`, ...) behind Kinvo's own 6-state
  `VoiceCallOutcome` vocabulary (`confirmed | declined | unreachable |
  ambiguous | system_error | pending`).
- **Webhooks carry no signature.** Verified three independent ways during
  the spike (the current docs, a dated changelog entry, and a
  `@deprecated` HMAC verifier still shipped in the SDK with an explicit
  "not signed" comment) — directly contradicting the original design's
  signature-verification assumption. The real security model: treat every
  webhook delivery as an untrusted, unauthenticated ping that names a call
  id, then re-fetch that call's state from CALL-E over the authenticated
  API connection before acting on anything. `POST /webhooks/call-e`
  therefore does the minimum — parse just enough to know which call to
  check, enqueue a job, acknowledge 200 — and never reads or trusts the
  body's own claims about call status.
- **No separate "in-flight call" concept was needed on top of
  `AssignmentAttempt`.** A `VoiceCallPlacement` row is written the moment a
  call is placed (before any outcome is known) and is the thing
  reconciliation and crash-recovery query against; the actual
  `AssignmentAttempt` is only created once a terminal outcome exists,
  exactly mirroring how a human dispatcher's own `logAttempt` already
  worked. This is what let Phase 4 extend `assignments.service.ts`'s
  existing `confirmAssignment`/`rejectAssignment`/`logAttempt` (via a new
  `AttemptActor` discriminated union — `{ source: 'human' }` vs.
  `{ source: 'system', provider, externalCallId }`) instead of building a
  parallel state machine next to it.
- **Idempotency is four independent, defense-in-depth layers**, documented
  in full in `voice.service.ts`'s module comment: the BullMQ job id, CALL-E's
  own `idempotencyKey` (derived from a per-assignment-per-round
  `callAttemptRef`, not a random value, so a genuine retry after an earlier
  round already resolved is never mistaken for a duplicate of the first),
  `AssignmentAttempt.externalCallId`'s unique constraint, and
  `VoiceWebhookEvent`'s id-as-primary-key. Verified under true concurrency
  (two different terminal webhook event types for the same call, processed
  by two different worker slots at the same instant), not just sequential
  replay — see `test/integration/voice.test.ts`.
- **Reconciliation is Kinvo's own timeout policy, not CALL-E's.** A call
  still `pending` when reconciliation checks it is left alone if it's
  within `VOICE_RECONCILE_STALE_AFTER_MINUTES`; past that budget, Kinvo
  itself forces a `system_error` outcome rather than waiting forever — this
  matters because CALL-E's `canceled` status has no corresponding webhook
  event at all (verified from the OpenAPI schema), so that one terminal
  state can only ever be discovered by polling.

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

**Non-negotiable the moment there is more than one API instance**: Socket.io
requires the `@socket.io/redis-adapter` to broadcast across pods. Without
it, a client connected to pod A never receives an event triggered by a
webhook that landed on pod B — the broadcast silently stays local to
whichever instance handled it. This fails quietly, not loudly: no error,
just a manager who doesn't see an escalation. Since framing decision #2
calls real-time "mandatory," treat wiring the Redis adapter as part of
_making Socket.io horizontally scalable_, not as an optional hardening
step — it must land before Phase 5 (Yellow Zone) ever runs on more than a
single instance. (Flagged in the Phase 0 audit, `docs/PHASE_0_AUDIT.md`
finding H2.)

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

**Status (Phase 1):** the `AuditLog` table itself is out of scope for Phase 1
(no placeholder entities — see the Phase 1 scoping decision below), but the
architecture the full audit service will slot into already exists and is
exercised today: `AuditLogger` (`apps/api/src/core/audit/audit-logger.ts`)
is a one-method interface (`record(event: AuditEvent): void`), backed for
now by a structured `pino` log line. Every event Phase 1's auth/org modules
consider audit-worthy (login, logout, logout-all, org registration,
invitation sent/accepted/revoked, role changed, membership removed) already
emits through this interface with a typed `AuditEventType`
(`apps/api/src/core/audit/audit-events.ts`). Swapping the pino-backed
implementation for one that also persists to a real `AuditLog` table later
is a change to `createAuditLogger`'s single implementation, not a change to
any call site.

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

Redis + BullMQ, built out in Phase 4 for the CALL-E voice orchestration
subsystem — see §10 and the Decisions log for the full design and the
research behind it. Queues (`apps/api/src/core/queue/queues.ts`):

- `voice-calls` — one job per automated confirmation call to place, enqueued
  by `voice.service.ts`'s `placeCallForAssignment`; job id is derived from a
  per-assignment-per-round `callAttemptRef` so a duplicate enqueue for the
  same round is a safe no-op at the queue layer, before it ever reaches
  CALL-E.
- `voice-webhook-events` — processes an already-parsed CALL-E webhook signal;
  job id is the provider's own event id, so a duplicate delivery never even
  enqueues a second job.
- `voice-reconciliation` — a single recurring sweep job (via BullMQ's
  `upsertJobScheduler`, not a hand-rolled `setInterval`) that re-checks
  placements which never got a terminal webhook and force-times-out ones
  stuck well past `VOICE_RECONCILE_STALE_AFTER_MINUTES`.

`campaigns` and `notifications-fanout`, mentioned in an earlier draft of
this section, are not part of Phase 4 — they belong to features (reminder
campaigns, the internal notification bus) that haven't been built yet and
would be added as their own queues on top of this same BullMQ setup when
their phase arrives, not retrofitted into the voice queues above.

**BullMQ needs its own Redis connection, not the Phase 0 health-check/cache
one.** `apps/api/src/core/redis.ts`'s singleton is configured with
`maxRetriesPerRequest: 1`; BullMQ requires `maxRetriesPerRequest: null` on
any connection it uses for blocking commands and throws at startup
otherwise. This was flagged in the Phase 0 audit (`docs/PHASE_0_AUDIT.md`
finding H3) well before Phase 4 existed; `core/queue/queueConnection.ts` is
that flag acted on — a second, dedicated `ioredis` connection used by
nothing else.

Workers run as a separate process/container from the API, exactly as
planned back in Phase 1 scaffolding — `apps/api/src/worker.ts` is a second
entrypoint into the *same* `apps/api` package (not a separate `apps/worker`
package: extracting shared core code to support that would have been a much
larger, riskier restructuring than a worker process actually required),
deployed as a second `docker-compose` service built from the same image
with a different command (`dev:worker` instead of `dev`).

**ESM/CJS interop gap, found only by actually running the stack (resolved
2026-08-06).** `@call-e/calle` ships ESM-only (an `import` condition only in
its `package.json` `exports` map, no `require`), while `apps/api` itself has
no `"type": "module"` and runs under `tsx`/`tsc`'s CommonJS output. A
top-level `import { CalleClient } from '@call-e/calle'` compiles to a
`require()` call and crashes with `ERR_PACKAGE_PATH_NOT_EXPORTED` the moment
the module loads — invisible to `tsc --noEmit` and to Vitest (neither
actually performs a real CJS `require()` of that package), and only
surfaced when the Docker `worker`/`api` containers were started for real.
Fixed in `CallEAdapter.ts` with a lazy, memoized dynamic `import()` — this
keeps `createCallEAdapter` synchronous (so `container.ts`'s construction and
every test call site stay untouched) while still using the
officially-supported Node interop path for loading an ESM-only package from
CommonJS. The lesson generalizes: any future provider adapter pulling in an
ESM-only SDK needs the same pattern, and `tsc`/`vitest` passing is not
sufficient evidence that a real process boots — this is exactly why task
tracking for this phase included a live Docker verification step, not just
a green test suite.

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
REFRESH_TOKEN_TTL_DAYS, REFRESH_TOKEN_COOKIE_NAME
CORS_ORIGIN
CALLE_API_KEY, CALLE_BASE_URL (optional)
VOICE_CALLS_CONCURRENCY, VOICE_WEBHOOK_CONCURRENCY
VOICE_RECONCILE_STALE_AFTER_MINUTES, VOICE_RECONCILE_INTERVAL_MINUTES
STORAGE_PROVIDER (s3|cloudinary), STORAGE_BUCKET, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY, STORAGE_REGION
SENTRY_DSN (optional, Phase 7)
```

**Status (Phase 1):** implemented in `apps/api/src/config/env.ts`, Zod-
validated at boot exactly as specified. Only `JWT_ACCESS_SECRET` and
`JWT_ACCESS_TTL` exist for tokens — there is no `JWT_REFRESH_SECRET`/
`JWT_REFRESH_TTL` pair, because refresh tokens are **not** JWTs: per §6,
they're opaque random values, stored hashed, compared by hash lookup. A
"refresh token secret" would imply verifying a signature, which is the
wrong mental model for an opaque-token-plus-rotation design. `STORAGE_*`
remains unimplemented, correctly — it belongs to a later documents/upload
phase, not Phase 1.

**Status (Phase 4):** the CALL-E vars landed with a different name and
shape than this section originally sketched, once real research replaced
assumption. No `CALL_E_WEBHOOK_SECRET` exists at all — CALL-E's webhook
deliveries carry no signature (verified from the SDK source, not the
docs; see §10), so there is nothing to hold a secret for. `CALLE_API_KEY`
is required everywhere except the test environment (enforced by a schema
`.refine`, not left to convention) since `core/container.ts` wires a real
`CallEAdapter` in every other environment and a `FakeVoiceProvider` in
test. `CALLE_BASE_URL` stays optional — only needed to override CALL-E's
default API host.

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
- **Redis is a hard, day-one dependency for every authenticated request, not
  a scale-later concern (updated 2026-08-06).** This section originally
  framed Redis's availability as "load-bearing once you're past one API
  instance," which was accurate when its only jobs were rate limiting and
  health checks — an outage degraded those, nothing else. That stopped
  being true the moment JWT revocation shipped (see the Phase 3 final
  pre-merge remediation section above): `authenticate.ts` now calls the
  Redis-backed `TokenRevocationStore` on **every single authenticated
  request**, and — deliberately, for the right security reason — **fails
  closed** (`503`) if that call errors, rather than silently skipping the
  revocation check. A revocation check that silently no-ops during a Redis
  blip would mean a role change or member removal simply doesn't take
  effect for as long as the outage lasts, which defeats the entire point of
  building it. So the tradeoff is correct; what changed is that it moved
  Redis from "degrades a convenience feature" to "single instance of Redis
  going down takes the whole API down," with a single instance, no
  failover, and `maxRetriesPerRequest: 1` (`core/redis.ts`) — appropriate
  for local dev, not for production, as-is.

  **Mitigation: run Redis as a managed service with built-in automatic
  failover**, not a bespoke self-hosted Sentinel cluster — consistent with
  this document's existing "managed Postgres, not self-hosted" philosophy
  (§16): automated failover and operational simplicity are worth more here
  than the marginal hosting-cost savings of running it yourself, and this
  product's current scale doesn't justify the operational overhead of
  running and monitoring a 3+-node Sentinel quorum by hand. Any of the
  following satisfy this (pick based on existing cloud-provider
  relationship, same "RDS/Neon/Supabase-class" flexibility already applied
  to Postgres in §16):
  - **AWS ElastiCache for Redis, Multi-AZ with automatic failover enabled**
    — the natural choice if Postgres is already RDS; failover to a replica
    typically completes in well under a minute, and ElastiCache manages the
    endpoint DNS so `REDIS_URL` doesn't need to change on failover.
  - **Upstash** — serverless Redis with built-in high availability and a
    generous free tier; a reasonable default if there's no existing AWS
    footprint, since it needs no cluster to provision or patch.
  - **Redis Cloud (Redis Inc.'s own managed offering)** — comparable HA
    guarantees, worth a look if pricing or region coverage favor it over
    the two above.

  Do **not** solve this by weakening `authenticate.ts`'s fail-closed
  behavior (e.g. falling back to "treat as not revoked" on a Redis error)
  — that silently reopens the exact staleness window this feature exists to
  close, trading a rare, honest `503` for a much worse, silent security
  regression.

  **Left as a follow-up, not required by this decision:** `core/redis.ts`'s
  `maxRetriesPerRequest: 1` means a single transient blip — even one a
  managed Multi-AZ failover would ride through in seconds — can still
  surface as a user-visible `503` before the connection recovers. Once a
  managed HA Redis is in place, revisit this constant (a small bounded
  retry count, or `ioredis`'s built-in exponential-backoff `retryStrategy`)
  to trade a few hundred milliseconds of added latency during a failover
  for fewer spurious `503`s — not done here, since it's an independent
  tuning decision from the HA topology itself and shouldn't block on it.

---

## Milestones

Each phase ends with something you can click through end-to-end and demo —
not a partially-wired feature.

**Phase 0 — Foundation**
pnpm monorepo scaffold, `packages/contracts`, Docker Compose (Postgres,
Redis), CI skeleton (lint/typecheck/test on PR), env validation. _Ends with_:
`docker compose up` gives a running API returning `200` on `/health` and a
Vite dev server serving a blank shell.

**Phase 1 — Authentication & Multi-tenancy** (implemented)
`Organization`, `User`, `Membership`, `RefreshToken`, `Invitation` models +
migration; register-org, login, refresh (rotation + reuse detection),
logout, logout-all, accept-invitation, me; JWT access tokens + the Current
Context primitive (§6a); Prisma Client Extension tenant scoping (§4); fixed-
role RBAC (`OWNER`/`ADMIN`/`DISPATCHER`/`VIEWER`); audit-logging interface
(§12). Strictly scoped per the product owner's explicit instruction: no
`Driver`, `Ship`, `Call`, or other Phase-2+ entities — Phase 1 proves the
tenant-scoping pattern on `Organization`/`User`/`Membership` alone, nothing
placeholder. `User.email` is globally unique (one platform identity per
person); organization access is granted via `Membership`, not by email.
**Also completed as part of this phase (see Decisions log): the Phase 0
`pg`-based database shim was retired entirely** — the real Prisma client
now backs the readiness check (`prisma.$queryRaw`), and `core/database.ts`
plus the `pg` dependency are deleted. No dual data-access paths remain.
Proven via `test/integration/` against a real Postgres, including
cross-tenant isolation. _Ends with_: a real login/registration flow backed
by a real database, issuing tokens that scope every subsequent request to
the right organization — and an integration test suite that proves it,
not just asserts it.

**Phase 2 — Ship & Driver Management** (implemented)
Full schema for `Ship`, `TruckRequirement`, `DocumentRequirement`, `Driver`

- migration; production CRUD for all four (filtering, search, sort,
  pagination, RBAC-enforced, tenant-isolated per §4's sub-resource pattern);
  explicit `Ship` status-transition endpoint enforcing the state machine from
  §4 in the service layer; existing prototype's ship and driver screens
  rewired to real data via TanStack Query, replacing every mock — includes a
  new `AuthScreen` (sign-up/sign-in) since Phase 1 shipped no frontend auth
  UI, and an in-memory (not `localStorage`) access-token store with
  silent-refresh-on-mount session recovery. Strictly scoped per the product
  owner's explicit instruction: no assignments, notifications, Yellow Zone,
  reminder campaigns, scheduling, or CALL-E integration — those remain
  Phase 3+. Proven via `test/integration/ships.test.ts` and `drivers.test.ts`
  (34 tests: CRUD, validation, RBAC, tenant isolation, status transitions,
  search/filter/sort/pagination, concurrency) plus a live walkthrough against
  the running Docker stack (create ship with a truck requirement → add a
  document requirement → transition status → create/update/delete a driver).
  See the Decisions log for the TruckRequirement shape, DocumentRequirement
  UI, and Ship/Driver field-set decisions made during this phase. _Ends
  with_: a manager can create a ship with requirements and see a real driver
  roster, fully persisted.

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

**Phase 5 — Yellow Zone escalation queue** (implemented; re-scoped from
"Inbound Calls" — see the Phase 5 entry below in the Decisions log for why)
`YellowZoneItem` model + state machine (`PENDING → IN_REVIEW →
RESOLVED`/`DISMISSED`), escalation classification, transactional escalation
integrated into Phase 4's existing `SYSTEM_ERROR` outcome path, Socket.io
real-time push (publish/subscribe split across the API and worker
processes, Redis-backed), Yellow Zone review UI, dashboard integration.
_Ends with_: an unresolved outbound CALL-E call becomes a secure,
tenant-isolated Yellow Zone item, appears live in the dispatcher's queue
without a page refresh, and can be claimed and resolved safely from the UI.

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
owner same day; executed and resolved in Phase 1 — see below).**
`prisma generate` hard-refuses to run with zero models
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

**Resolved (Phase 1).** All six steps above are done: `core/database.ts`
and the `pg`/`@types/pg` dependencies are deleted; `apps/api/src/core/prisma.ts`
is the only data-access layer; the readiness check and shutdown hook both
use the generated Prisma client. Confirmed via `grep` that nothing in the
codebase imports `core/database.ts` or `pg`.

**Tenant-scoping mechanism corrected: Prisma Client Extensions (`$extends`),
not `$use` middleware (resolved, Phase 1).** §4's original text specified a
Prisma `$use` middleware for tenant scoping. `$use` is deprecated as of
Prisma 4.16 and does not compose reliably with `$transaction` the way this
system needs. The Phase 1 implementation uses `$extends` instead — see §4's
Status note and `apps/api/src/core/prisma.ts`. Functionally equivalent for
this system's purposes (both hook every query); `$extends` is simply the
non-deprecated, forward-compatible API for it.

**Phase 1 scope, `User.email` uniqueness, and the 12 binding refinements
(resolved 2026-08-05, per explicit product-owner direction).** Phase 1 was
deliberately restricted to `Organization`, `User`, `Membership`,
`RefreshToken`, `Invitation` — no `Driver`, `Ship`, `Call`, `YellowZoneItem`,
`Notification`, or other Phase-2+ entity, even as a placeholder. The
reasoning: a schema-only table with no business logic is exactly the kind
of "looks done, isn't" artifact this project's engineering discipline rules
out; those entities land in Phase 2 when they're actually implemented.
`User.email` is globally unique (a staff member has one platform identity;
multi-organization membership is expressed via multiple `Membership` rows,
not multiple accounts) — `Driver.phone`, by contrast, stays organization-
scoped per the driver-pool-scope decision above, since drivers are not
platform identities. The product owner's Phase 1 approval also bound: the
`Membership` table stays a real table (not collapsed onto `User`); refresh
tokens use family-based rotation + reuse detection; no `Session` table
(see §6a); fixed-role RBAC only, no dynamic permission system; a Current
Context object resolved once per request (§6a); audit-event interfaces
built now even though the persisted `AuditLog` table is deferred (§12).

**Prisma engine binaries crash on `node:20-alpine` without the `openssl`
package — root cause and fix (resolved 2026-08-05).** First surfaced during
Phase 1 live-stack verification: `apps/api/Dockerfile`'s `dev` target ran
`prisma migrate deploy` against the compose Postgres and failed with
`Error: Could not parse schema engine response: SyntaxError: Unexpected
token 'E', "Error load"... is not valid JSON`, preceded by `prisma:warn
Prisma failed to detect the libssl/openssl version to use... Defaulting to
"openssl-1.1.x"`.

_Root cause._ Prisma ships its query/schema/migration engines as separate
precompiled Rust binaries (not JS), one variant per platform +
libc + OpenSSL ABI (e.g. `linux-musl-openssl-3.0.x`). At `prisma generate`
/ CLI invocation time, Prisma detects which variant to fetch/run by
shelling out to `openssl version`. `node:20-alpine` does not install the
`openssl` package (the CLI binary) by default — Alpine 3.18+ ships OpenSSL
3.x libraries as transitive deps of other packages, but not the `openssl`
binary itself unless something explicitly depends on it. Detection failed,
Prisma guessed the wrong ABI (`openssl-1.1.x`, which Alpine 3.23 — the
version this image resolves to — doesn't ship at all; Alpine dropped
OpenSSL 1.1.x years ago), and the resulting engine binary crashed
immediately on startup instead of running: its native crash output ("Error
load...") isn't the JSON-RPC response the Prisma CLI's parent process
expects on stdout, hence the "could not parse" error. The CLI's error
message is a symptom two layers removed from the actual fault.

_Why this is a genuinely different failure mode than "does Node work on
Alpine," and why `node -e "..."` succeeding is not evidence against it._
Node.js's official binary **statically links OpenSSL into the `node`
executable itself** — confirmed by `ldd $(which node)` inside the built
image showing no dynamic `libssl`/`libcrypto` dependency at all. Node,
npm, and pnpm's own crypto usage were never at risk. Prisma's engines are a
**separate set of binaries with their own, independent, dynamic linkage**
against whatever OpenSSL the OS provides. "Node runs fine" and "Prisma's
engine binary runs fine" are unrelated claims on this image; Phase 1 is
the first place this codebase actually exercises a Prisma engine binary
inside a container, which is why nothing before it could have caught this.

_Why Phase 0 never showed it._ Phase 0 deliberately had zero Prisma models
(see the pg-shim decision above) — `prisma generate` hard-refuses to run
with an empty schema, and the readiness check used the `pg` driver
directly, so no Prisma engine binary was ever invoked inside a container
until Phase 1 added real models and the Dockerfile's `dev` CMD started
calling `prisma generate` / `prisma migrate deploy`. This was not a latent
bug Phase 0 missed; the code path that triggers it did not exist yet.

_The fix, and why it's the correct one, not a workaround._ `RUN apk add
--no-cache openssl` in both `apps/api/Dockerfile` stages that start from
`node:20-alpine` (`base`, and `runtime` — which builds from the bare base
image directly rather than inheriting from `base`). This is not
"reinstalling something Alpine forgot" — it restores the one piece Prisma's
own detection genuinely needs (the `openssl` CLI) so detection succeeds and
the correct engine variant is used, rather than papering over the symptom
(e.g., pinning `binaryTargets` in `schema.prisma` to force a specific ABI
without fixing why detection failed, which would silently break again on
the next Prisma version that changes its default engine set). Verified:
after the fix, `openssl version` inside the container reports `OpenSSL
3.5.7`, `prisma generate` and `prisma migrate deploy` both complete
cleanly, and `docker compose ps` shows all four services healthy end to
end.

_Would a Debian-based image (`node:20-slim`/`node:20`) have avoided this?_
Yes — Debian-based images ship glibc and typically have OpenSSL's shared
libraries and CLI present or trivially available via `apt`, and it's the
image family Prisma's own documentation examples default to, so this
specific failure mode is less commonly hit there. That is not, on its own,
a reason to switch: Alpine's musl base is materially smaller (this
project's runtime image size is already a known, separately tracked
concern — see the `KNOWN LIMITATION` comment on the Dockerfile's `runtime`
stage), and the actual fix here is one `RUN` line, not an architecture
change. Switching base image families to dodge a one-line fix would be
over-correcting. Revisit only if a _second_, unrelated musl/glibc-specific
compatibility issue shows up — one data point is a fix, two is a pattern
worth re-evaluating the base image over.

_Future implications._ Any future native/compiled dependency added to
`apps/api` (image processing, PDF generation, a different DB driver with
native bindings, etc.) should be checked for the same class of issue before
assuming "works on my machine" (which is typically Debian/glibc or macOS)
implies "works in the Alpine container." The `RUN apk add --no-cache
openssl` lines are now the canonical place to add any future
system-package dependency an engine/native-binary dependency needs —
don't scatter ad hoc `apk add` calls across stages if another one becomes
necessary; consolidate in `base` (and mirror in `runtime` only because it
deliberately doesn't inherit from `base`).

**`Ship`/`Driver` field set follows the Kinvo.dc.html prototype export, not
this document's original abstract sketch (resolved 2026-08-05, Phase 2).**
§3's original table listed a minimal, illustrative field set (`name`,
`destination`, `etaAt`, ... for `Ship`; `name`, `phone`, `licenseNumber`,
`vehiclePlate` for `Driver`) written before any real UI existed to bind
against. Phase 2 implementation instead read the actual static-HTML
prototype export (`Kinvo.dc.html`, a no-code design-tool export using
`{{ }}`/`<sc-if>`/`<sc-for>` binding syntax — reference only, never
executed) field-by-field, since that document is what the product owner
actually approved as the UI, and building a schema the real screens can't
populate would be exactly the "looks done, isn't" gap this project's
discipline rules out. The result: `Ship` gained `company`, `berth`, `gate`,
`cargoType`, `rateCurrency`; `Driver` gained `nationalId`, `capacity`,
`languages`, `preferredRoutes`, `preferredCompanies`, `rating`,
`previousJobsCount`. §3's table above now reflects the real, implemented
field set — treat it as authoritative over this note going forward.

**`TruckRequirement` shape — destination lives on the requirement row, not
the ship (resolved 2026-08-05, Phase 2, per explicit product-owner
choice).** Three sources disagreed on where "destination" belongs: this
document's abstract sketch put it on `Ship` (one destination per ship);
the product owner's Phase 2 prompt's example ("5 Flatbeds, 2 Containers, 4
Dump Trucks") implied one destination per ship with multiple truck-type
rows; the actual Kinvo.dc.html export showed multiple destination rows per
ship, each independently needing a truck type and quantity. Rather than
guess, this was surfaced to the product owner directly before writing any
schema code; the explicit answer was **"both — destination AND truck type
per row"** — i.e. `TruckRequirement` carries `(shipId, destination,
truckType, quantityNeeded)` as one row per destination-per-truck-type
combination, not a separate `ShipDestination` join entity. This is the
hybrid shape now in `schema.prisma` and reflected in §3's table.

**`DocumentRequirement` gets a new UI screen — no prototype reference
existed for it (resolved 2026-08-05, Phase 2, per explicit product-owner
choice).** Unlike `TruckRequirement`, the Kinvo.dc.html export had no
document-requirements UI to match against — the product owner's Phase 2
prompt introduced the concept (`CNIC, License, Vehicle Registration, Port
Entry Pass`) without a corresponding screen in the static export. Surfaced
as a second question alongside the TruckRequirement one rather than
inventing a UI unilaterally; the explicit answer was **"design a new UI
screen for it."** The result is the "Document requirements" section inside
`ShipDetailDrawer.tsx` (`apps/web/src/features/ships/ShipDetailDrawer.tsx`)
— add/remove a free-text `documentType` per ship, `isRequired` defaulting
to `true`, no hardcoded document-type list per the product owner's
"do not hardcode, store them relationally" instruction.

**Sub-resources without a direct `organizationId` cannot join
`TENANT_SCOPED_MODELS` — resolved via parent-first resolution instead
(resolved 2026-08-05, Phase 2).** See §4's "Sub-resources with no direct
`organizationId` column" note above for the mechanism
(`resolveOwnedShip()` / `resolveOwnedTruckRequirement()` /
`resolveOwnedDocumentRequirement()` in `ships.service.ts`). Recorded here
because it's a pattern every future ship-scoped or driver-scoped
sub-resource (e.g. `AssignmentDocument` in Phase 3) should follow, not a
one-off: resolve and tenant-check the parent through the extension first,
never add a denormalized `organizationId` purely to reuse the extension
on a child table.

**Proactive fix: `Driver.phone` unique-constraint race handled from day
one, not discovered via chaos testing (resolved 2026-08-05, Phase 2).**
Phase 1's chaos-testing round (see the refresh-token and invitation-
acceptance races above) established that any `@@unique` constraint reached
by concurrent requests needs its Postgres `P2002` error translated to a
clean `409 Conflict`, not left to surface as a raw Prisma error or a
generic 500. Rather than wait to rediscover this the same way for
`Driver.phone` (which is `@@unique([organizationId, phone])`), the Phase 2
implementation applies the lesson proactively:
`translatePhoneConflict()` in `drivers.service.ts` catches `P2002` on
create/update and maps it to `ConflictError` before it reaches the client.
Covered by a concurrency test in `test/integration/drivers.test.ts`
("under concurrent creates with the same phone, exactly one succeeds and
no request 500s") mirroring the equivalent Phase 1 tests.

---

## Phase 2 refinement pass

After Phase 2's initial Definition of Done was met (schema, CRUD, tests,
live verification — see the Milestones entry above), a second pass
reviewed the shipped feature set against the actual operating reality of a
port-logistics dispatcher, not just its own stated requirements. Changes
from this pass are additive, non-breaking, and each justified against one
test: does it reduce phone-call volume or a real operational error, for a
dispatcher using this today — not a hypothetical future phase. Entries
below are added as each refinement lands; this is a working log, not a
one-time summary.

**Per-truck-type rate on `TruckRequirement` (resolved 2026-08-05).**
`Ship.rate`/`Ship.rateCurrency` (added in Phase 2's initial pass) is a
single flat number for an entire voyage. In real port operations,
different destinations and different truck types command different
fares on the same voyage — "what's the fare for a Flatbed to Salalah" is
one of the exact recurring dispatcher phone questions this product exists
to eliminate, and the original schema could not answer it per
destination/truck-type, only per ship. `TruckRequirement.rate` (nullable
`Decimal(10,2)`) was added as a per-row override: `Ship.rate` remains the
voyage's base/display rate, and a requirement with no override falls back
to it. Currency is **not** duplicated onto `TruckRequirement` — a single
voyage is quoted in one currency (`Ship.rateCurrency`), never split
per-row, so a per-row currency field would add complexity with no real
business referent.

This is additive and backward-compatible: existing ships created before
this change keep displaying their ship-level rate exactly as before (every
requirement's `rate` is `null`, so the UI falls back to `Ship.rate` for
all of them); nothing about the original Phase 2 contract is broken.
Migration: `20260805120349_truck_requirement_rate`. Frontend
(`ShipsPage.tsx`'s create-ship destination rows, `ShipDetailDrawer.tsx`'s
truck-requirement list and add-row) shows the effective rate per row —
the override when set, `Ship.rate` labeled "(base rate)" when not — so a
dispatcher glancing at a ship's requirement list always sees a real number
per row, never a blank they have to go look up elsewhere. Covered by
`test/integration/ships.test.ts` (override rate persists distinctly from
the ship's base rate; a requirement with no override returns `rate: null`
from the API, with the base-rate fallback being a display concern handled
in the frontend, not duplicated server-side data). Verified live against
the running Docker stack: a ship with one overridden requirement (25000)
and one non-overridden requirement correctly displayed the base rate
(20000) with the "(base rate)" label only on the fallback row.

**Ship search now matches truck-requirement destinations, not just
shipName/company (resolved 2026-08-05).** `listShips`'s search only
queried `shipName`/`company` — confirmed by reading the code before
changing it. A dispatcher's most common lookup ("who's got trucks going to
Salalah?") was unanswerable by search, since destination lives on
`TruckRequirement`, a separate table, not on `Ship` itself. Added a third
`OR` clause using Prisma's relation filter —
`truckRequirements: { some: { destination: { contains, mode: insensitive } } }`
— alongside the existing two. No schema change; the query stays inside
`Ship`'s existing tenant-scoped `where`, so no new tenant-isolation
surface was introduced. Frontend search placeholder updated to "Search
ship, company, or destination" so the capability is discoverable, not
hidden. Covered by a new test in `test/integration/ships.test.ts`
("searches by a truck requirement destination, not just ship
name/company") and verified live: searching "Islamabad" and
case-insensitive "lahore" (both destinations on truck requirements, not
in the ship's name or company) correctly returned the ship; a term
matching nothing ("Peshawar") correctly returned an empty list, proving
the filter is selective, not a no-op.

## Phase 2 product-polish pass

A further pass on top of the refinement pass above, focused on making
Phase 2 feel like dispatcher software rather than generated CRUD, and on
correcting a modeling mistake identified during review. Same rule as
every other entry in this log: every change here is justified against
whether it reduces a dispatcher's phone-call volume or click count, not
decoration for its own sake.

**`Ship.rate`/`Ship.rateCurrency` deleted; rate now lives entirely on
`TruckRequirement` (resolved 2026-08-05).** The per-requirement rate
added in the prior refinement pass (immediately above) kept a ship-level
`rate` as a "base rate" that per-row rates could override or fall back
to. On review this was wrong, not just imperfect: a ship does not have
one price. A single voyage recruiting Flatbeds to one destination and
Container Chassis to another is quoted two different real fares — there
is no meaningful "base" to fall back to, and displaying one invited
exactly the kind of dispatcher confusion ("is that the real price or a
placeholder?") this product exists to eliminate. Fix: `Ship.rate` and
`Ship.rateCurrency` are deleted outright; `TruckRequirement` gains
`rateCurrency` (previously only had `rate`) and `notes` (free text, e.g.
"High priority" — a dispatcher's per-requirement remark, not a new
workflow concept). A requirement with no rate set displays "Rate not
set" — an honest gap, not an invented number. Migration
`20260805131408_truck_requirement_currency_notes_ship_rate_removed`
(hand-authored via `prisma migrate diff` and applied with `migrate
deploy`, since `migrate dev` refuses to run non-interactively against a
migration that drops a populated column — dropped one pre-existing test
ship's rate value in the dev database, which is disposable seed data,
not a concern in a schema that's still inside its first working day).
Currency is still not duplicated per destination-and-truck-type-and-row
in a way that would let one voyage mix currencies — `rateCurrency` lives
once per requirement (not shared across a ship) because that is the
actual unit rate is quoted at; the UI currently always writes `'PKR'`
when a rate is set (real product for Pakistani port companies), leaving
the field itself general enough to support other currencies later
without another migration. Verified live: a ship with one requirement
priced at 80,000 and no ship-level rate anywhere in the payload; a
requirement with no rate correctly shows "Rate not set" instead of a
fallback number (confirmed via `test/integration/ships.test.ts` and a
live walkthrough against the running stack).

**Ship creation redesigned as destination cards, not table rows (resolved
2026-08-05).** `ShipsPage.tsx`'s "Add Ship" form previously modeled each
truck requirement as one row in a cramped `grid-cols-[2fr_1fr_1fr_auto]`
layout — a pattern that stopped scaling the moment `rate` and `notes`
were added (five-plus fields in one horizontal row reads like a
spreadsheet, not a form). Each destination is now its own bordered card
(`Destination N` header, Destination/Truck Type/Quantity/Rate/Notes,
delete button), matching the shape of an actual real-world requirement a
dispatcher is entering one at a time. `Ship information` also gained ETA
and Reporting Time (`datetime-local`) inputs — both fields already
existed in the schema since Phase 2's first pass but were never exposed
in the create form, an oversight this pass corrects since they answer
two more of the phone questions this product is meant to eliminate
("when should I report?").

**Dashboard quick-stats on both Ships and Drivers screens (resolved
2026-08-05).** A dispatcher opening Kinvo should see operational status
before doing anything else — "how many ships are recruiting," "how many
drivers are idle right now" — not just an empty list waiting for a
search. `useShipStats`/`useDriverStats`
(`apps/web/src/features/{ships,drivers}/useShips.ts`,`useDrivers.ts`)
each fire four parallel count-only queries through the _existing_
tenant-scoped/RBAC'd list endpoint (`pageSize: 1`, only `.total` is
read) — Ships: Recruiting/Confirmed/In Progress/Completed; Drivers:
Idle/On Call/Confirmed/Escalated (the driver stats double as clickable
availability filters, replacing the old static color-key legend with
live counts). No new backend endpoint: four cheap, indexed `COUNT`
queries reusing infrastructure that already existed, not a dedicated
aggregate route built speculatively ahead of proven need. Deliberately
not implemented: "Completed Today" (would need date-range filtering the
API doesn't have yet) — shown as a plain "Completed" total instead of
faking a "today" scope that isn't real.

**Driver list gains a `truckType` filter (resolved 2026-08-05).**
`truckType` was stored and displayed on every driver but not filterable
— confirmed by reading `drivers.service.ts` before changing it. "Which
idle Flatbeds do I have?" was a daily dispatcher question with no way to
ask it through the UI. Added `truckType` to `driverListQuerySchema` and
an `equals`/insensitive `where` clause in `listDrivers` (a driver's truck
type is one specific value, not free-text search, so `equals` is correct
where the ship-destination search earlier used `contains`). Frontend
filter input added alongside the existing search box, with a "Clear
filters" affordance once any filter is active.

**Responsive pass across ships, drivers, and the app shell (resolved
2026-08-05).** Every screen touched in this pass was rebuilt with mobile
in mind rather than retrofitted:

- App shell (`App.tsx`): header wraps instead of overflowing on narrow
  screens; the organization name and "name · role" text hide below the
  `sm` breakpoint (secondary information, not needed to operate the
  app one-handed); main content padding scales down on mobile.
- Ships/Drivers grids and stat strips: `grid-cols-1` on mobile up to
  `grid-cols-3`/`grid-cols-4` on desktop via Tailwind breakpoints, never
  a fixed column count that forces horizontal scroll.
- Driver table: renders as an actual `<table>`-like grid on `sm:` and
  above, and as stacked cards below it (`sm:hidden` / `hidden sm:block`
  pair) — a data table genuinely doesn't work at 375px width, so this is
  two purpose-built layouts sharing one data source, not one layout
  squeezed to fit.
- Both detail drawers (`ShipDetailDrawer.tsx`, `DriverDetailDrawer.tsx`):
  full-screen (`h-full w-full`, no rounded corners/backdrop margin) below
  `sm:`, the original centered modal card above it — matches how every
  native mobile app handles a detail view, and avoids a modal-inside-a-
  scrollbar situation on a small viewport.
- `AuthScreen.tsx` needed no changes — already `max-w-sm` with `px-4` on
  its outer container from Phase 2's first pass, confirmed by reading it
  before deciding not to touch it.

Verified via `resize_window` at the `mobile` (375×812) and `desktop`
presets against the running stack: create-ship, open-drawer, add-driver,
and the driver-table/card layout switch were all exercised at both
sizes with no horizontal scroll and no non-functional controls.
Deliberately **not** built: a hamburger menu. There are two navigation
items (Ships, Drivers); a collapsible menu for two items is exactly the
kind of default developer-habit chrome this pass was told to remove, not
add — the existing pill-button nav already wraps cleanly at 375px.

**Loading skeletons and richer empty states (resolved 2026-08-05).**
Both list screens previously rendered a bare "Loading ships…" /
"Loading…" text string, and empty states were a single line of gray
text ("No ships yet — create one to get started."). Replaced with
shape-matching skeleton blocks (`animate-pulse` over card/row-shaped
`div`s, `ShipListSkeleton`/`DriverListSkeleton`/`DrawerSkeleton`/
`DriverDrawerSkeleton`) so the layout doesn't jump between the loading
and loaded states, and with a heading + explanatory line + primary CTA
button for empty states (distinguishing "no data at all" from "no
results for your current filters," which need different messages and
different — or absent — CTAs).

**Explicitly deferred, and why.** Full WCAG accessibility audit: native
`<button>`/`<input>` elements with visible labels already cover the
common cases; a systematic pass (focus-trap in drawers, full ARIA
labeling, contrast audit) is real work that deserves its own scoped
pass, not a rushed addendum to this one. List virtualization: every list
in this product today is a handful of rows; virtualizing them would be
optimizing a problem that doesn't exist yet, the same YAGNI reasoning
this document has applied consistently since Phase 0. A `licenseExpiry`
field and driver `isActive` soft-deactivation (compliance and roster-
hygiene gaps identified during the review that produced this list) were
not built in this pass — real, justified, but scoped out to keep this
change reviewable; next candidates for a future iteration, not
forgotten.

## Phase 2 navigation and dashboard pass

Follows a self-critique against the same "developer-built CRUD, not
premium dispatch software" bar — see the review conducted before this
pass started. Every item below traces to a specific finding in that
review, not a stylistic preference.

**Ship drawer redesigned: destination cards with a real ship-information
panel (resolved 2026-08-05).** The single worst screen identified by the
review — truck requirements rendered as one run-on text line
(`Lahore — 5x Flatbed · 25000 PKR`). `ShipDetailDrawer.tsx` now opens
with an information grid (Cargo/Berth/Gate/ETA/Reporting time, `—` for
unset fields) and renders each destination as its own card (destination
name, truck type/quantity subline, rate prominently in the ship's teal
accent, notes as a separate quoted block). Explicitly **not** added:
Confirmed/Remaining counts per destination — that requires knowing which
drivers are assigned to which requirement, i.e. the `ShipDriverAssignment`
model, which is Phase 3. Faking it with placeholder zeros was considered
and rejected — it would violate the no-placeholder discipline this
project has held since Phase 0 for the sake of matching a UI mockup.

**Ships list now surfaces ETA and an "arriving soon" signal (resolved
2026-08-05).** The review's other Critical finding: ETA existed in the
schema and the create form but was invisible on every ship card, making
"what's arriving soonest" — the first question a dispatcher asks —
unanswerable without opening every card. `formatDateTime`/`isWithinHours`
(`apps/web/src/lib/format.ts`, shared with the dashboard) now drive an
ETA line on each card and an amber "Arriving soon" badge + accent border
when a non-completed/cancelled ship's ETA falls within 48 hours.

**Ships page gains filter chips and a sort control, matching the Drivers
page pattern (resolved 2026-08-05).** The review flagged a real
inconsistency: Drivers' stat chips were clickable filters, Ships' were
purely decorative — the same interaction taught on one screen silently
stopped working on the next. Ships' four stat cards (Recruiting/
Confirmed/In Progress/Completed) are now toggleable filters wired into
`listShips`'s existing `status` query param, plus a sort `<select>`
(ETA soonest / Newest / Name / Status) using the `sortBy`/`sortOrder`
params the API already supported but no UI exposed.

**`updatedAt` added as a sortable field on both list endpoints (resolved
2026-08-05).** Minimal, additive: one more enum value on
`shipListQuerySchema`/`driverListQuerySchema`'s `sortBy`, no service code
change needed since both services already do
`orderBy: { [query.sortBy]: query.sortOrder }` generically. Added
specifically to support the dashboard's "Recently updated" panel.

**Real navigation shell: sidebar (desktop) + slide-out drawer (mobile)
(resolved 2026-08-05).** Two pill buttons in a header bar is a tab
switcher, not navigation — the review's other High-priority finding.
`App.tsx`'s `Shell` now renders a collapsible left sidebar on `md:` and
above (Dashboard/Ships/Drivers live; Assignments/Calls/Notifications/
Settings rendered disabled with a "Soon" badge — honest about what
doesn't exist yet, not hidden) and a slide-out drawer below `md:`
(hamburger trigger, backdrop click **and** Escape key both close it,
current page highlighted). Icons are a small hand-rolled inline-SVG set
(`components/icons.tsx`) — no icon library dependency for seven glyphs.
Verified live at the `mobile` (375×812) preset: drawer opens, highlights
the active page, navigates and auto-closes on selection.

**Dashboard is now its own landing view, not the Ships list with stats
bolted on (resolved 2026-08-05).** `features/dashboard/DashboardPage.tsx`
is the default tab. Panels: operational stat strip (Recruiting/In
Progress ship counts, Idle/On Call driver counts), "Today's operations"
(ships whose ETA or reporting time falls on the current calendar date),
"Upcoming ETAs" (next 5 active ships by ETA ascending), "Recently
updated" (last 3 ships + last 3 drivers by `updatedAt` descending), and
"Quick actions" (Create Ship / Add Driver, which navigate to the target
page **and** auto-open its create form in one click — see below). All
data comes from the existing list endpoints with small `pageSize`
values; no dedicated dashboard/aggregate API route, same reasoning as
`useShipStats`/`useDriverStats`.

_Honesty note on "Recently updated":_ this reads real `updatedAt`
timestamps — it is not a fabricated feed — but it cannot say _what_
changed on a ship or driver, only _that_ something did and _when_. A
true activity feed needs the `AuditLog` table, which Phase 1 explicitly
deferred (see "Phase 1 scope" above). Labeled and scoped accordingly
rather than presented as more than it is.

**Quick Actions deep-link into a create form, not just the page (resolved
2026-08-05).** A first pass would have made Dashboard → Ships → "+ Add
Ship" a 3-step path to create a ship, one step worse than the old
Ships-as-landing-page flow. `Shell` lifts one-shot `shipAutoOpen`/
`driverAutoOpen` flags: a Quick Action sets the target tab and the
matching flag; `ShipsPage`/`DriversPage` read it only as their
`useState` **initial** value (`showAddShip/showAddDriver`), and `Shell`
resets the flag via a `useEffect` immediately after the render that used
it — so a later manual tab switch back to the same page never
re-triggers the form. Verified live: "+ Create ship operation" on the
dashboard opens Ships with the create form already visible, one click.

**Explicitly deferred from this pass, and why:** a true activity feed
(needs `AuditLog`, Phase 1 decision); Confirmed/Remaining per destination
and any shortage indicator (needs `ShipDriverAssignment`, Phase 3);
`licenseExpiry`/driver `isActive` (carried over from the prior pass,
still real, still scoped out to keep changes reviewable).

## Phase 2 final review pass

A self-critical pass treating the existing implementation as another
team's work to audit, not code to defend. Four real, verifiable defects
were found and fixed; each is recorded with how it was found, not just
what changed, since the finding method matters more than the fix here.

**`Ship.notes` and `Driver.notes` existed in the schema and API with zero
UI exposure (resolved 2026-08-05).** Found by grep, not inspection —
searching both create forms for `notes` turned up only per-destination
truck-requirement notes; the ship-level and driver-level `notes` columns
(present since the very first Phase 2 schema) were never rendered or
settable anywhere in the frontend. A dispatcher could not record "customs
hold pending" on a ship or "prefers night shift" on a driver despite the
backend fully supporting it. Fixed by adding a Notes field to the ship
create form and to both entities' new edit forms (below); verified live
that a note written in the ship edit form persists and displays.

**Neither Ship nor Driver had any way to correct details after creation
(resolved 2026-08-05) — the most severe finding of this pass.** The
`updateShip`/`updateDriver` endpoints existed and were tested since
Phase 2's first pass, but no frontend affordance ever called them for
anything beyond status/availability transitions. A dispatcher who
mistyped a berth number or a driver's phone digit had no path to fix it
short of deleting and recreating the record — for a ship, that also
destroys its destinations and documents. This is not a cosmetic gap; it
is a workflow a real dispatcher hits routinely and a production tool
cannot lack. Fixed: both `ShipDetailDrawer.tsx` and
`DriverDetailDrawer.tsx` gained an "Edit" mode — a form pre-filled from
current values, mapped through `updateShip`/`updateDriver` on save, with
optional text fields sent as `null` when cleared (distinct from `create`,
where an empty field means "don't set it" — on `edit` it means "clear
it," a deliberate difference in the same form pattern). Covered by new
assertions in `test/integration/ships.test.ts` and `drivers.test.ts`
(the existing "updates fields" tests now also assert `notes` round-trips
through `PATCH`); verified live end-to-end for both entities against the
running stack, including fields (ship `berth`/`cargoType`, driver
`licenseNumber`) that had never been settable post-creation before this
pass.

**Document-requirement add-row was always visible while the destination
add-row was a toggle — same drawer, two behaviors (resolved
2026-08-05).** Found by re-reading `ShipDetailDrawer.tsx` fresh rather
than trusting that a screen redesigned two passes ago was still
internally consistent — it wasn't. Fixed by giving document requirements
the same "+ Add document" / "Cancel" toggle pattern destinations already
had. The ship-details info panel also had no section heading while
"Destinations" and "Document requirements" both did; added a "Ship
details" heading so all three sections in the drawer follow one pattern.

**No visible keyboard-focus indicator on any text input across the
entire application (resolved 2026-08-05) — the single highest-value
accessibility finding.** Every input/select in the app sets
`outline-none` for its custom border styling and never supplied a
replacement focus style. A keyboard-only user tabbing through any form —
exactly the "use only keyboard" scenario this review's dispatcher-day
exercise calls for — got zero visual feedback about which field had
focus. One global rule (`input:focus-visible, select:focus-visible,
textarea:focus-visible { outline: 2px solid #1E7A8C; ... }` in
`index.css`) fixes it everywhere at once rather than patching a focus
class onto every one of the 40+ individual `<input>` occurrences across
the codebase. Verified via a computed-style check on a live input
(`outline: 2px solid rgb(30, 122, 140)` applied on focus).

**Considered and explicitly rejected in this pass:** adding a `notes`
field to the driver quick-add form, to mirror the ship create form. Ship
creation is already a multi-field planning action; driver quick-add is
deliberately four fields (name/phone/plate/type) matching how a
dispatcher actually captures a driver — mid-phone-call, fast, refine
later. Now that driver Edit exists, "refine later" is a real path, not a
dead end, so the asymmetry between the two create forms is a considered
UX decision, not an inconsistency to fix.

## Phase 3 backend: Assignment (driver ↔ truck-requirement engagement)

A pre-implementation design review (treating the drafted Phase 3 spec as
another team's proposal to challenge, not a plan to execute) produced
three real changes before any schema was written, plus a fourth decision
made mid-build once the ship-cascade requirement was fully understood.

**Assignment is a flat top-level resource (`/api/v1/assignments`), not
nested under ships or truck requirements (decided before implementation,
2026-08-06).** The drafted spec implied nesting
(`/ships/:shipId/truck-requirements/:id/assignments`), matching how
`TruckRequirement`/`DocumentRequirement` nest under `Ship`. But the spec
also required two views nesting can't serve without a second router
anyway: a cross-ship "call list" (`GET /assignments?status=PENDING`, every
pending outreach across the whole organization, for a dispatcher working
the phones) and a per-driver history (`GET /assignments?driverId=X`, for
the driver detail drawer). A 4-level nested URL for the primary CRUD
operations plus a second flat router for the two list views that matter
most would be worse than one consistent flat resource. `Assignment`
represents a relationship between two independent aggregates (a
`TruckRequirement` and a `Driver`) rather than a child owned by one parent
the way a truck requirement is owned by its ship — REST's "nest owned
sub-resources" rule doesn't actually apply here. Tenant ownership is still
resolved the same relational way as `TruckRequirement`/`DocumentRequirement`
(§4's pattern): through `truckRequirement.ship.organizationId`, never a
denormalized column, via `resolveOwnedAssignment` in
`assignments.service.ts`. No new RBAC actions were added — `Assignment`
reuses `ships:read`/`ships:manage` for the same reason
`TruckRequirement` does (see `core/rbac/permissions.ts`).

**Assignment carries `agreedRate` only, no `agreedCurrency` (the
product owner's own suggestion, adopted after critical review, not
adopted by default — 2026-08-06).** The suggestion was: since
`TruckRequirement` already owns `rate`/`currency` for the requirement as
posted, an individual assignment negotiating a different rate with one
driver still negotiates in the same currency — a requirement posted in
USD does not suddenly get settled in EUR because one driver haggled the
number. Reviewed for the counterargument (a multi-currency corridor where
a requirement might genuinely be filled by drivers paid in different
currencies) and rejected: nothing else in the Phase 2 schema supports
per-driver currency at all — `TruckRequirement.currency` is a single
enum column, not a list — so an `agreedCurrency` field would imply
capability the rest of the schema doesn't have, and would let the app
silently commit to a real-world business rule (currency can vary
per-driver within one requirement) that was never actually a stated
requirement. If cross-currency negotiation ever becomes real, it is a
`TruckRequirement`-level modeling change (e.g., multiple currency-tagged
sub-postings), not a field to bolt onto `Assignment`. Adopted as
specified.

**`AssignmentAttempt` is a separate append-only table, not a counter or
a JSON blob on `Assignment` (decided before implementation,
2026-08-06).** Phase 4's CALL-E integration needs full outreach history —
every no-answer, busy signal, and wrong-number, in order, each with its
own timestamp — to drive retry/backoff logic and to show a dispatcher
"we've tried this driver 3 times today." A counter can't answer "when was
the last attempt" and a JSON blob on `Assignment` can't be queried or
indexed. The table carries a nullable, unique, currently-unpopulated
`externalCallId` specifically as a Phase 4 seam — Phase 3 never writes it,
but the column exists now so Phase 4's webhook handler doesn't need a
migration to start recording it. `AttemptOutcome.SYSTEM_ERROR` is reserved
the same way: a real enum value Phase 3's manual-outreach UI never
produces, present only so Phase 4 has somewhere to record a CALL-E-side
failure without a schema change at integration time.

**Ship cancellation/completion cascades into Assignment and Driver via
direct Prisma calls inside `ships.service.ts`, not by calling into
`assignments.service.ts` (decided during implementation, 2026-08-06).**
`assignments.service.ts` already imports from `ships.service.ts` for
tenant resolution (`resolveTenantScopedTruckRequirement`); having
`ships.service.ts` call back into `assignments.service.ts` for the
cascade would create a circular module dependency. Cancelling or
completing a ship needs to: bulk-transition its live `Assignment` rows
to `CANCELLED`/`COMPLETED` and reset the affected drivers'
`availability` back to `IDLE` (clearing `currentShipId`) — this is
mechanical enough (`updateMany` on both tables) not to need the state
machine or per-transition side effects `assignments.service.ts` enforces
for direct, single-assignment actions. `cascadeShipCancellation` and
`cascadeShipCompletion` live in `ships.service.ts` as the two functions
that own this cross-entity effect.

**Business rules enforced on `TruckRequirement` mutation once
assignments exist, added during implementation once the interaction was
traced through (2026-08-06).** `updateTruckRequirement` now blocks
changing `destination`/`truckType` once any assignment is
`PENDING`/`CONFIRMED` (a driver agreed to one destination; silently
retargeting the requirement after they've committed is a correctness
bug, not a feature), and blocks reducing `quantityNeeded` below the
current `CONFIRMED` count (with the confirmed count in the 409 payload
so the frontend can render a specific message, not a generic conflict).
`removeTruckRequirement` proactively counts active assignments before
attempting the delete (clean 409 with a specific message) and additionally
catches Postgres FK violation (`P2003`) as defense-in-depth — the
`onDelete: Restrict` on `Assignment.truckRequirementId` guarantees the
database itself refuses the delete either way, so the proactive check is
about giving a good error message, not about correctness. Verified by four
dedicated tests in `assignments.test.ts`'s "ship + truck requirement side
effects from assignments" block.

All of the above shipped with the full Phase 3b backend (schema,
migrations including a hand-authored partial unique index for
"one active engagement per driver+requirement pair," Zod contracts,
service/controller/routes, container/app wiring) covered by 26 new
integration tests plus zero regressions in the pre-existing 117, and a
clean `typecheck`/`lint`/`build` across all three workspaces.

## Phase 3 frontend: assignment UI surfaces

**`AssignmentRow` and `useAssignmentRowActions` are extracted into shared
files (`features/assignments/AssignmentRow.tsx`,
`useAssignmentRowActions.ts`) rather than duplicated per surface (added
2026-08-06).** The assignment state machine's UI — status badge, the
per-status action buttons, the inline reason/attempt forms — is identical
whether it's shown embedded in a ship's truck-requirement card
(`TruckRequirementDrivers.tsx`) or in the flat cross-ship
`AssignmentsPage.tsx`. The only real difference is context: the flat page
needs to say which ship/destination each row belongs to (`showContext`
prop) since rows from many requirements are interleaved, while the
ship-drawer embed already has that context from its surrounding card.
Extracting once two call sites existed (not preemptively) avoided
~150 lines of duplicated JSX and, more importantly, duplicated race-prone
mutation-state bookkeeping (`rowAction`/`reasonInput`/`attemptOutcome`)
that would have been easy to let drift between the two copies.

**The Assignments nav item is real, not a placeholder — it's the flat
"call list" the Assignment API's flat-resource shape (see the Phase 3
backend decisions above) was built to serve.** It defaults to filtering
on `PENDING`, since that's the actual queue a dispatcher works from, with
one-click toggle filters for `CONFIRMED`/`REJECTED`/`NO_SHOW` and a "show
all statuses" escape hatch. Every action available in the ship drawer
(confirm/reject/withdraw/cancel/no-show/log attempt) works identically
here — verified live that confirming an assignment from this page updates
the same React Query cache the ship drawer reads, with no separate
invalidation logic needed since both surfaces call the same
`useAssignmentMutations`.

**`DriverDetailDrawer`'s new "Assignment history" section is read-only —
deliberately not given the same action buttons as the other two surfaces
(added 2026-08-06).** A driver's history view answers "what has this
driver been invited to and how did it go," not "let me manage an
engagement from here" — the latter already has two homes. Adding a third
place capable of triggering `confirm`/`cancel`/etc. would let the same
state machine be driven from three independent UI trees for no real
dispatcher benefit, and every future change to the transition rules would
need to be checked against three call sites instead of two. Considered
and rejected.

**Dashboard's new "Shortages" panel required zero new backend calls.**
`confirmedCount`/`pendingCount` are already present on every
`TruckRequirementDto` returned by the existing `GET /ships` list endpoint
(computed server-side, see the Phase 3 backend section above) — the panel
just filters `useShips`'s already-fetched data for
`confirmedCount < quantityNeeded` across non-terminal ships. Placed first
in the dashboard's panel grid, ahead of "Today's operations," since an
under-staffed destination is a more urgent "what needs your attention"
signal than a scheduling reminder.

**Docker dev-container caveat, not a code defect (discovered during this
phase's live verification, 2026-08-06):** the `api`/`web` containers'
`tsx watch` / Vite dev servers did not pick up several rounds of source
edits made via the host filesystem during this session — verified by
comparing a live `GET /ships/:id` response (missing `confirmedCount`)
against the same code on disk (which had it). This is the well-known
Windows-bind-mount-into-Linux-container inotify gap: file-change events
from the NTFS-backed bind mount don't reliably reach the container's
file watcher. Restarting the containers (`docker compose restart api
web`) always picked up current disk content immediately, since the
container's startup command rebuilds/regenerates from scratch every time
— this is a "restart after editing while the stack is already running"
operational note for local development, not a bug to fix in the
Dockerfile or compose config.

## Phase 3 final review pass

A self-critical pass over the finished Phase 3 work — schema through
frontend — treating it as another team's PR to audit, per the same
discipline as the Phase 2 final review pass above. One real defect and
one real (if minor) UI-state bug were found and fixed; both are recorded
here with how they were found.

**`AssignmentDto` had no way to show what a `PENDING` assignment was
actually offering once `agreedRate` was null (resolved 2026-08-06).**
`agreedRate: null` means "use the truck requirement's posted rate" per
`createAssignmentRequestSchema`'s own comment, but nothing on the
`Assignment` DTO carried that posted rate — only `driverName`/`shipName`/
`destination`/`truckType` were denormalized onto it. This was invisible
in the ship drawer (where the embedded panel had the parent
`TruckRequirement`'s rate available as a prop) but broke exactly the
surface Phase 3 was built to add: the flat cross-ship `AssignmentsPage`,
which has no parent truck requirement in scope and rendered "Rate not
set" for every assignment using the posted rate — the majority case,
since an explicit `agreedRate` override is the exception, not the rule.
Found by using the newly-built Assignments page live rather than trusting
the ship-drawer test coverage to generalize. Fixed by denormalizing
`rate`/`rateCurrency` onto `AssignmentDto` itself (same reasoning as the
other denormalized fields, see `assignment.schema.ts`), which also let
`AssignmentRow` drop its external `rate`/`rateCurrency` props entirely —
the DTO is now self-sufficient, which is a real simplification, not just
a bug fix. Verified live: the flat page now shows "PKR 25,000" for a
`PENDING` assignment on a requirement with a posted rate, where it
previously showed "Rate not set".

**Switching the status filter on the Assignments page could leave a
stale, half-filled reject/cancel/log-attempt form in state (resolved
2026-08-06).** `useAssignmentRowActions`'s `rowAction` state is keyed by
assignment id and shared across the whole page; switching the status
filter unmounts the row whose form was open without clearing that state,
so returning to the same filter later could resurface an open form with
previously-typed text. Never a data-corruption risk (nothing is
submitted until the dispatcher explicitly confirms), but a real,
findable UI inconsistency — caught by reasoning through the interaction
rather than by any test (there is no frontend test coverage for this
component; see the note below). Fixed with a `changeStatusFilter` wrapper
that closes any open row action before switching. Not applicable to the
ship-drawer's embedded panel, which scopes one `useAssignmentRowActions`
instance to one truck requirement with nothing else to switch away from.

**Considered and explicitly deferred, not fixed:** frontend unit/component
tests. This project's established testing discipline (see §18 and the
Phase 2 passes above) is backend integration tests against a real
database plus live browser verification for the frontend, not a
component-test suite — `apps/web/src/test/App.test.tsx` remains the only
frontend test file, covering app-shell auth flows, consistent with the
pattern already set in Phase 2. Phase 3's frontend work was verified live
instead (every state transition, both the ship-drawer and flat-page
surfaces, desktop and mobile viewports — see the verification note
below), matching how `ShipDetailDrawer`/`DriverDetailDrawer` were
verified when they shipped. Adding a component-test framework now would
be a project-wide tooling decision, not a Phase 3-scoped fix.

**Verification performed for this pass:** full `typecheck`/`lint`/`test`
(150 tests: 143 API integration, 5 contracts, 2 web)/`build` across all
three workspaces, clean on every run after each fix; live verification in
a real browser (registered a fresh test organization, created a ship
with a truck requirement, created a driver, and exercised invite →
confirm → cancel-with-required-reason → re-approach-after-cancellation →
log-attempt → reject-with-optional-reason end to end, from both the ship
drawer and the flat Assignments page, confirming both surfaces share one
cache and stay in sync) at both a 1280×900 desktop viewport and a
390×844 mobile viewport. One operational discovery (not a code defect,
recorded above): the dev containers require a restart after host-side
source edits to reliably pick them up on this Windows/Docker setup.

**Verdict: Phase 3 is production-ready.** Tenant isolation, RBAC, and the
assignment state machine are enforced server-side and independently
verified by 26 dedicated integration tests (including a real concurrent-
confirm race and a real partial-unique-index conflict) plus zero
regressions in the pre-existing 117. The frontend surfaces (ship drawer,
flat Assignments page, dashboard shortages panel, driver history) all
read from and write to the same backend through the same shared hooks,
verified live rather than assumed. No placeholders, TODOs, or dead code
remain from this phase's work.

## Phase 3 hardening pass

A brutal, adversarial architecture review (treating Phase 3 as production
code a Staff Engineer had to approve, not code to defend) found four
blocking correctness/scalability defects and three lower-severity
inconsistencies. Each was fixed individually — smallest possible change,
existing tests re-verified unchanged, new tests added for the specific
defect — never a broad refactor. Full suite (159 tests across all three
workspaces) and `typecheck`/`lint`/`build` stayed green after every single
fix, not just at the end.

**Blocker 1 — Driver.availability could drift from the truth and cause a
real double-booking (resolved 2026-08-06).** `PATCH /drivers/:id` let
`availability`/`currentShipId` be set to anything, with zero awareness of
a live `CONFIRMED` `Assignment`. A dispatcher marking a genuinely-busy
driver "Idle" made them reappear in the driver picker's IDLE-only filter,
inviting a real double-booking. Fixed in `drivers.service.ts`'s
`updateDriver`: while a driver has a live `CONFIRMED` assignment,
`availability` can't move away from `CONFIRMED` and `currentShipId` can't
change, except through the assignment workflow itself
(`cancelAssignment`/`markNoShow`), which already clears both correctly.
Considered and rejected: deriving `availability` entirely from `Assignment`
data — `ON_CALL`/`ESCALATED` have no equivalent to derive from, so a
stored column would still be needed either way.

**Blocker 2 — the ship-cancellation/completion cascades were not race-safe,
and had a separate, deterministic over-broad-reset bug (resolved
2026-08-06).** `cascadeShipCancellation`/`cascadeShipCompletion` selected a
snapshot of "active" assignment/driver ids, then updated by that captured
id list — an assignment independently transitioned in the gap between
select and update would get silently overwritten back to
`CANCELLED`/`COMPLETED`. Separately, cancellation reset *every* driver from
a `PENDING`-or-`CONFIRMED` capture to `IDLE`, even though only `CONFIRMED`
ever touched availability — clobbering an unrelated, independently-set
`ON_CALL`/`ESCALATED` flag on a driver whose only connection was a
still-`PENDING` invite. Fixed by filtering the destructive `updateMany`s by
a live condition re-checked at write time (the same technique
`confirmAssignment` already used), and scoping the driver reset to only
drivers who had a genuinely `CONFIRMED` engagement, re-checked against
`currentShipId` at write time.

**Blocker 3 — no index served the flat Assignments page's default query
(resolved 2026-08-06).** `GET /assignments?status=PENDING` had no direct
path to one organization's rows — tenant scoping only existed via a
`truckRequirement.ship.organizationId` join. Corrected from the review's
own overstated diagnosis ("no usable index at all" — a join-driven plan
was actually available, just one that scaled with an org's *entire*
historical volume, not its pending rows) before fixing it: denormalized
`organizationId` directly onto `Assignment` (immutable once set, same
pattern as `Ship`/`Driver`), added it to the tenant-scoping extension, and
indexed `[organizationId, status]`. Verified with a real `EXPLAIN` against
the dev database that the new index satisfies both predicates as a direct
`Index Cond`. The riskiest part of this fix — whether ALS request-context
propagates reliably into `tx.*` calls inside `$transaction` for a
newly-tenant-scoped model — was verified empirically (via the
already-passing concurrent-confirm test exercising the identical shape for
`Driver`) before, not after, making the change.

**Blocker 4 — `updateShipStatus` and `cancelAssignment`/`markNoShow` could
leave inconsistent state on a crash mid-sequence (resolved 2026-08-06).**
Each performed its primary write, then a second, logically-dependent write
as a separate, non-transactional follow-up call — a crash between the two
had no reconciliation path. Fixed by wrapping each full sequence in one
`$transaction`, reusing the `TransactionClient` typing convention already
established in `organizations.service.ts` rather than inventing a new one.

**Non-blocker: `deleteDriver` had no defense against its own FK constraint
(resolved 2026-08-06).** `Assignment.driverId`'s `onDelete: Restrict` (added
in Phase 3) made deleting a driver with any assignment history throw a raw,
uncaught 500 — `removeTruckRequirement` had already been given the correct
proactive-check-plus-`P2003`-fallback shape for the identical situation in
the same phase; `deleteDriver` was simply missed. Fixed by applying the
exact same shape, not a new one.

**Non-blocker, investigated and found to need no code change: the
hand-authored partial unique index's migration-tooling visibility.** The
review's proposed remediation — "needs a CI check that asserts the
constraint exists" — turned out to already exist: `createAssignment` has no
application-level duplicate check, so **rejects creating a second active
assignment for the same driver and requirement** is a direct, unmediated
proof of the constraint. Verified, not assumed: dropped the index on the
test database, confirmed that exact test fails with the precise expected
signature (`409` becomes `201`), then restored it and confirmed the suite
was clean again. No second check was added — it would be duplicate
coverage for the same fact.

**Non-blocker: `POST /assignments/:id/attempts` returned the whole parent
Assignment instead of the attempt it actually creates (resolved
2026-08-06).** Verified before changing it that nothing depended on the old
shape — `useAssignmentMutations`'s `logAttempt` only invalidates queries on
success, never reads the mutation's return value — making this a safe,
non-breaking correction rather than a real API contract risk. Now returns
the created `AssignmentAttemptDto` directly; confirmed live in the browser
that the UI updates identically either way.

## Phase 3 final pre-merge remediation

A second, more adversarial pre-merge audit (explicitly instructed to try to
REJECT the merge) found two new blocker-class concurrency defects the
hardening pass above had missed, plus several other issues spanning
concurrency, security, performance, and API correctness. Every finding was
investigated from the actual code (not from this document's own claims),
fixed, covered with a new regression test, and the fix's blast radius was
explicitly checked against every dependent caller before moving on — full
suite, `typecheck`, and `lint --max-warnings=0` stayed green after each one.
An independent, from-scratch re-audit (a fresh reviewer with no memory of
this session's own fixes) then verified all of it and found two further
Medium-severity gaps, also fixed below. Final tally: 165/165 tests passing,
clean `typecheck`/`lint` across all three workspaces, verified live against
the running Docker stack.

**Blocker 5 — `updateShipStatus` and `cancelAssignment`/`markNoShow` could
deadlock under real concurrent load, despite Blocker 4's earlier
transaction-wrapping fix (resolved 2026-08-06).** Wrapping each function's
sequence in its own `$transaction` (Blocker 4) fixed crash-safety but left
their *lock acquisition order* inverted: `updateShipStatus` locks
Ship → Assignment → Driver; `cancelAssignment`/`markNoShow` locked
Assignment → Driver → (conditionally) Ship. Two transactions each wanting a
lock the other already holds is Postgres's definition of a deadlock
(SQLSTATE `40P01`, Prisma error `P2034`) — confirmed reachable by tracing
both code paths' lock order line-by-line, not assumed. Fixed by having
`cancelAssignment`/`markNoShow` take a `FOR UPDATE` lock on the parent Ship
row first, unconditionally, pinning the order to Ship → Assignment → Driver
on every path through the function (`lockShipRow`,
`assignments.service.ts`). `P2034` also now maps to a `409 CONCURRENT_UPDATE`
in `errorHandler.ts` as defense-in-depth, rather than falling through to a
generic 500. New concurrency test fires both operations at the same
ship/assignment pair simultaneously and asserts neither ever 500s.

**Blocker 6 — TOCTOU race in `updateDriver`'s active-assignment guard
(resolved 2026-08-06).** The guard's read (does this driver have a live
`CONFIRMED` assignment?) and the eventual write were two separate, unlocked
statements — a concurrent `confirmAssignment`/`cancelAssignment` could land
in the gap, letting a plain availability edit silently overwrite a driver
that had just become genuinely committed to a job (or vice versa). Fixed by
locking the driver row (`FOR UPDATE`) as the transaction's first statement,
re-checking the guard inside the same transaction as the write. Verified
this introduces no new deadlock cycle: the lock only ever touches Driver,
never Assignment or Ship, so it can't be the reverse half of a cycle with
`confirmAssignment` (Assignment → Driver) or the Ship-first functions above.

**Non-blocker: `rejectAssignment` was not transactional (resolved
2026-08-06).** Its conditional status update and its attempt-log write were
two independent statements, unlike the identically-shaped `confirmAssignment`
right above it. Wrapped in one `$transaction`, matching the sibling function.

**Non-blocker: the audit log was structured `pino` output only, not
persisted or queryable (resolved 2026-08-06).** Added a new `AuditLogEntry`
table and made `AuditLogger.record` async and DB-persisting, with an
optional `tx` parameter so a caller already inside a transaction (e.g.
`revertShipIfNowShort`'s ship-status revert) can commit its audit entry
atomically with the business write it describes. Deliberately has **no**
foreign keys to `User`/`Organization` — a departure from this schema's usual
"add an FK for every actor reference" convention, made because an audit
trail must remain forensically meaningful even after the actor's membership
is removed or (in a future feature) the organization itself is deleted; an
FK with `onDelete: Cascade` would silently erase the very trail describing
that deletion.

**Non-blocker: JWT access tokens carried stale role/membership claims for
up to `JWT_ACCESS_TTL` after a role change or removal, with no revocation
path (resolved 2026-08-06).** `authenticate.ts` never re-resolves role from
the database (a deliberate Phase 1 tradeoff — see §6a), so a token issued
just before a demotion or removal stayed fully valid, at the old privilege
level, until it naturally expired. Closed with a Redis-backed revocation
store (`token-revocation.ts`): `updateMemberRole`/`removeMember` mark a
membership revoked; `authenticate.ts` checks every request against it,
failing closed (503) if Redis itself is unreachable rather than silently
skipping the check. A real precision bug was caught and fixed while
building this: JWT's standard `iat` claim is whole-seconds only, and
comparing it against a millisecond-precision revocation timestamp
incorrectly rejected a token minted in the same wall-clock second as the
revocation (the common case — a client refreshing immediately after a role
change) — caught by a failing integration test before it shipped, fixed by
signing a custom millisecond-precision `issuedAtMs` claim instead of relying
on `iat`.

**Non-blocker: `SHIP_INCLUDE` fetched every historical assignment just to
reduce two counts in JS (resolved 2026-08-06).** Scaled with a requirement's
entire lifetime assignment volume (including terminal
REJECTED/WITHDRAWN/CANCELLED rows) instead of its currently-live rows.
Replaced with `loadRequirementCounts`, a single `groupBy` query filtered to
`CONFIRMED`/`PENDING` and batched across an entire page of ships at once —
one query per list response, not one per ship or per requirement.

**Non-blocker: `SYSTEM_ERROR` attempt outcome had no server-side enforcement
against human dispatchers (resolved 2026-08-06).** `SYSTEM_ERROR` is
reserved for Phase 4's CALL-E webhook to report a call-platform failure —
the frontend already excluded it from its outcome picker, but that's a UI
courtesy, not enforcement; a direct request to `POST /assignments/:id/attempts`
could still set it. Fixed at the contract layer: a new
`humanLoggableAttemptOutcomeSchema` (`attemptOutcomeSchema.exclude(['SYSTEM_ERROR'])`)
now backs the request schema, so the exclusion is enforced by Zod validation
regardless of client. The frontend's outcome list is now derived from this
same schema instead of a separately hand-maintained array.

**Non-blocker: `apiClient.ts` had no request timeout (resolved
2026-08-06).** A hung backend or dropped connection left every in-flight
query/mutation pending indefinitely, with React Query never settling and no
way for the UI to surface an error. Added `AbortSignal.timeout(15_000)`,
translated to a genuine `ApiError` (distinguishing a timeout from a generic
network failure) so every existing `isApiError(err) ? err.message : ...`
call site gets a sensible message with no changes needed at the call site.

**Independent re-audit finding — no ship-status guard on
`createAssignment`/`confirmAssignment` (resolved 2026-08-06).** Neither
function checked the parent ship's status. A ship's own cancellation/
completion cascade only touches assignments that existed at the moment it
ran — a brand-new assignment created against the same (now-terminal)
requirement afterward was invisible to it, and could even be confirmed,
permanently marking a driver `CONFIRMED`/unavailable against a shipment
that will never move again, with no system-driven recovery path. Fixed with
an `assertShipAcceptsAssignments` guard (rejects `COMPLETED`/`CANCELLED`) in
both functions — proactively in `createAssignment`, and again as
defense-in-depth inside `confirmAssignment`'s existing transaction.

**Independent re-audit finding — TOCTOU race in `updateTruckRequirement`'s
two business-rule guards (resolved 2026-08-06).** The destination/truckType
lock and the quantityNeeded floor were each a plain `count()` followed by a
separate, unlocked `update()` — unlike every other guard fixed in this
remediation round, this one had no database constraint backstop either (the
sibling `removeTruckRequirement` has its FK `Restrict` as a real safety
net; this didn't). A concurrent `createAssignment`/`confirmAssignment`
landing in the gap could silently violate the exact invariant the guard
exists to enforce. Closed by having all three operations —
`updateTruckRequirement`, `createAssignment`, and `confirmAssignment` —
take the same `FOR UPDATE` lock on the truck requirement row
(`lockTruckRequirementRow`) as their first step, so whichever one acquires
it first fully serializes the others against it. Verified this introduces
no new deadlock cycle: all three take this lock as their very first
statement, before touching Assignment or Driver, so none of them can be
holding a later-acquired resource while waiting on an earlier one held by a
different transaction.

**Both follow-ups flagged above have since been closed (2026-08-06).**
`revertShipIfNowShort` now uses the same `loadRequirementCounts`/`groupBy`
query as the `SHIP_INCLUDE` fix (exported from `ships.service.ts` and
threaded through with `tx`, since this call runs inside
`cancelAssignment`'s/`markNoShow`'s transaction) instead of fetching a
ship's full historical assignment set — new regression test builds real
terminal-status history (REJECTED/WITHDRAWN) alongside live CONFIRMED
assignments on the same requirement and confirms the shortage check still
reflects only the live ones. Separately, the Redis day-one-dependency
question raised by JWT revocation is addressed in §20's Scaling Strategy
above: run Redis as managed, HA-capable infrastructure (ElastiCache
Multi-AZ / Upstash / Redis Cloud) rather than a single unmanaged instance,
with `authenticate.ts`'s fail-closed behavior kept exactly as-is — the
mitigation is in the infrastructure's availability, not in weakening the
security guarantee.

## Phase 4 backend: CALL-E voice orchestration

Built research-first, at the user's explicit direction: a deep technical
spike against the real `@call-e/calle` SDK (source code, not just
documentation), then a from-scratch distributed-systems analysis of CALL-E
as an external system (state machine, failure model, consistency model,
concurrency, idempotency, recovery, security threat model), both completed
and reported on *before* any Phase 4 production code was written. Several
of the spike's findings directly contradicted this document's original,
assumption-based §10/§14 sketches — see those sections above for the
corrected design; this entry covers what the research found, why the
design differs from the original sketch, and what was actually built and
verified.

**What the spike found that changed the design.** (1) CALL-E's webhook
deliveries carry no signature — confirmed three independent ways (current
docs, a dated changelog entry, and a `@deprecated` HMAC verifier still
shipped in the SDK with an explicit "not signed" comment), directly
contradicting the original signature-verification assumption. (2) The SDK
exposes two API surfaces — ad-hoc Calls (webhook-capable, carries arbitrary
`metadata`) and Goal Runs (poll-only, **no webhook mechanism exists
anywhere in the schema**, requires authoring a reusable "Goal" through a
separate tool first) — Calls was chosen as Phase 4's integration surface;
Goal Runs is a tracked future migration, not a commitment made without
verifying it first. (3) The SDK ships zero retry logic of its own — every
network call site throws immediately on failure — which is why every
`VoiceProvider.getCallOutcome` implementation must let transport errors
propagate for BullMQ's own retry/backoff to handle, rather than absorbing
them. (4) `CallStatus: canceled` has no corresponding webhook event type at
all, which is why reconciliation (polling) is load-bearing, not a backstop
for an already-complete webhook flow. (5) `@call-e/calle` ships ESM-only —
this one wasn't caught by the spike; it surfaced only when the Docker
stack was actually started for real (see §14's ESM/CJS interop entry).

**Architectural decisions made in response, each with a concrete reason to
prefer it over the obvious alternative:**

- *Treat every webhook as an untrusted signal, never a source of truth.*
  Given no signature exists, the only sound design is: extract just enough
  from the delivery to know which call to check (an id), then re-fetch
  that call's authoritative state over the already-authenticated API
  connection. This is why `VoiceProvider.parseWebhookSignal` returns almost
  nothing, and why `CallEAdapter`'s webhook-body schema validates down to
  `{ id, type, data: { id } }` and nothing more.
- *A separate `VoiceCallPlacement` record, not folding "in flight" into
  `AssignmentAttempt`.* `AssignmentAttempt.outcome` is NOT NULL by design
  (Phase 3) — an attempt is a *completed* fact, never a placeholder for one
  still pending. Rather than widening that column's meaning, a new,
  minimal table records the moment a call is placed; the actual
  `AssignmentAttempt` is only created once a terminal outcome exists. This
  is also what let reconciliation and crash-recovery work at all — without
  a durable "we placed this call" record, nothing could answer "which
  calls are we still waiting on?"
- *Extending `assignments.service.ts`, not building a parallel state
  machine.* A new `AttemptActor` discriminated union
  (`{ source: 'human' }` vs. `{ source: 'system', provider,
  externalCallId }`) lets the existing, already-hardened
  `confirmAssignment`/`rejectAssignment`/`logAttempt` be called by the
  voice worker without impersonating a human dispatcher, defaulting to
  `{ source: 'human' }` for zero behavioral change at every existing HTTP
  call site. This is the "existing codebase first" principle applied
  directly: the alternative (a second confirm/reject/log path duplicating
  Phase 3's transaction and locking logic) would have doubled the surface
  area needing the same concurrency guarantees re-proven from scratch.
- *A per-assignment-per-round `callAttemptRef`, not a random idempotency
  key or a fixed one.* A fixed key (e.g. the assignment id alone) would
  make a legitimate later retry — after an earlier round already resolved
  UNREACHABLE and a dispatcher wants to try again — collide with the first
  round's idempotency key and silently return the old, already-resolved
  call. A random key per placement *attempt* (rather than per *round*)
  would fail to collapse a genuine duplicate enqueue (two rapid clicks
  before the first round resolves) into one real call. Deriving it from
  the count of prior placements for that assignment gets both properties
  right with no new schema.
- *Four independent idempotency layers, not one.* BullMQ job id, CALL-E's
  own idempotency key, `AssignmentAttempt.externalCallId`'s uniqueness, and
  `VoiceWebhookEvent`'s id-as-primary-key each guard against a different
  failure mode (duplicate enqueue, duplicate real API call, two different
  terminal signals for the same call, literal duplicate delivery) — see
  `voice.service.ts`'s module comment for the full mapping. Verified under
  true concurrency, not just sequential replay: a self-audit pass after
  the initial implementation found that two different terminal webhook
  event types for the same call, processed by two different worker
  concurrency slots at the same instant, could throw an unhandled unique-
  constraint violation out of `applyVoiceOutcome`. Fixed by catching that
  specific violation as an expected, benign race rather than an error, and
  covered with a dedicated `Promise.all`-based concurrency test — the
  earlier sequential version of the same test had not caught it.

**Self-audit findings, fixed before this phase was called done:** (1) the
new public `/webhooks/call-e` endpoint had no rate limiting, unlike every
other public/unauthenticated endpoint in this codebase (auth, health) —
added, sized generously relative to auth's since a real CALL-E account
under load can legitimately fire many terminal events per minute. (2) the
true-concurrency race described above. (3) `VoiceCallPlacement` was missing
its foreign key to `Assignment` (inconsistent with `VoiceWebhookEvent`'s own
relation to `AssignmentAttempt`) — added, `onDelete: Cascade` matching the
existing precedent. (4) live verification against the actual Docker stack
(not just `tsc`/Vitest, which cannot execute a real CommonJS `require()` of
an ESM-only package) surfaced the `@call-e/calle` ESM/CJS interop crash
documented in §14 — fixed with a lazy dynamic `import()`, then re-verified
live: full org → ship → driver → assignment → voice-call flow exercised
against the running stack, including the real `CallEAdapter` code path
hitting CALL-E with a deliberately-invalid placeholder key and failing
cleanly (a logged, retried `CalleAuthenticationError`, not a crash).

**Final state (first gate):** 206/206 tests passing (166 pre-Phase-4 plus 40
new — 18 pure-function unit tests for `outcomeTranslation`, 22 integration
tests covering placement, HTTP surface, outcome resolution including true
concurrency, and reconciliation), clean `typecheck`/`lint` across all three
workspaces, verified live against the running Docker stack including the
new `worker` service.

**Product gap closed in the same audit round: Phase 4 had no UI.** The
backend could place and resolve calls; nothing let a dispatcher trigger one,
see one in progress, or tell an automated attempt apart from a manual one —
`AssignmentAttemptDto` didn't even expose the `provider` column the schema
already had. Closed by: adding `provider` to `AssignmentAttemptDto` and a
new `pendingVoiceCall: { provider, placedAt } | null` to `AssignmentDto`
(computed from an unresolved `VoiceCallPlacement`, the one piece of
operational visibility a support engineer gets from the API without DB
access); a "Call driver" button on `AssignmentRow.tsx` wired to the existing
authenticated action endpoint; a live "Calling since HH:MM" indicator and a
disabled/relabeled button state while a call is in flight; an "Automated ·
call-e" badge on attempt history; and self-clearing polling
(`refetchInterval`, gated on any row actually having a call in flight, so it
never runs once nothing is pending) so the status updates without a manual
refresh. Live-verified end to end via browser automation, including
resolving the anomaly where the poll appeared not to fire — traced to
`document.visibilityState === "hidden"` in the automation tool's own
non-displayed pane, which is exactly the condition TanStack Query's
`focusManager` is designed to suppress background polling for (the same
behavior Gmail/Slack rely on); not a defect in the implementation.

**Second gate audit — one more real defect found and fixed:
`translateCallToOutcome` wasn't actually defensive against a malformed
provider response (resolved 2026-08-07).** The function's own doc comment
already promised "every branch resolves to a VoiceCallOutcome rather than
throwing" — true for every `status` value, but not for a response whose
`recipients` field was missing or wrong-shaped, which the SDK's compile-time
`Call` type doesn't protect against at runtime. An uncaught `TypeError`
there degrades two different ways depending on the caller: forever-repeating,
never-resolving log spam from `reconcileStaleAttempts` (which catches and
logs per-placement, but the malformed response never stops recurring), or a
silently dead-lettered BullMQ job from `processWebhookSignal` (which has no
such catch) — retried five times against a response shape that retrying
can't fix. Fixed with a single outer `try/catch` around the whole
translation, converting any unexpected exception into a terminal
`system_error` outcome — the same reaction the function already gives a
recognized-but-unrecognized status value. Three new unit tests cover it
directly (missing `recipients`, a malformed entry inside `recipients`, and
the existing malformed-`structuredResult` case, which was already safe via
`zod`'s `safeParse` and needed no fix).

**Considered and deliberately not changed at the time:** no `restart` policy
existed on any `docker-compose.yml` service (postgres, redis, api, worker,
or web) — this predated Phase 4 and applied uniformly across the whole dev
stack, so fixing it only for the two Phase 4 services would have been an
inconsistent, unjustified special case. Addressed repo-wide during the
Phase 0→4 consolidation pass instead (`restart: unless-stopped` on all five
services) — see that section below. The already-documented
production-Dockerfile limitation in `apps/api/Dockerfile`'s own comment is
unrelated and still outstanding.

**Final state (second gate):** 209/209 tests passing, clean
`typecheck`/`lint`/`build` across all three workspaces, live-verified
against the full Docker stack a second time (health, malformed webhook,
duplicate webhook collapsed to one processed job via BullMQ's own job-id
dedup, worker boot log confirming the reconciliation scheduler registered).

**Repository consolidation — a genuine reproducibility gap found and fixed
(resolved 2026-08-07).** Verifying the repo builds from its *tracked*
content alone (a fresh `git clone` + `pnpm install`, not the working
directory's already-populated `node_modules`) surfaced a real bug: `prisma
generate`'s output (`.prisma/client`) lands in a different location
depending on how it's invoked. Run via `pnpm --filter @kinvo/api exec
prisma generate` (or an equivalent `pnpm run <script>` targeting the
package) it lands nested inside the pnpm store, which apps/api's `tsc`
correctly resolves — this is the path every `build`/`prisma:generate` call
in this project had always used, which is why the gap was invisible all
session. Run via pnpm's own `postinstall` lifecycle hook — the first fix
attempted here — it lands hoisted at the workspace root instead, which
`tsc` does *not* resolve, producing dozens of `Property 'x' does not exist
on type 'PrismaClient'` errors from a plain `pnpm install` alone. Confirmed
by reproducing the failure twice (once at a deeply nested path, once at
`C:\kverify` to rule out an unrelated Windows path-length issue) and then
fixing it properly: no `postinstall` hook (removed after proving it
generates to the wrong location); instead, `pnpm run prisma:generate` (new
root script, delegating to apps/api's existing one) is now an explicit
prerequisite of the root `typecheck`, `lint`, and `test` scripts, matching
the `build:contracts` prerequisite pattern already used by the same
scripts. Re-verified end to end from a completely fresh clone: `pnpm
install` → `typecheck`/`lint`/`test` (209/209)/`build`, all green, with
nothing carried over from any prior working directory state.

## Phase 4 frontend: Calls UI

**Gap found before writing any code.** A full inspection of `apps/web`
(not an assumption) found the Calls nav item already present in
`App.tsx`'s `NAV_ITEMS` but permanently disabled (`comingSoon: true`, no
`'calls'` case in the `Tab` union, no render branch) — Phase 4's backend
(webhook, queue, reconciliation, the assignment-level "place a call" /
"see the active call" UI from the prior Phase 4.5 session) was real and
tested, but there was no dedicated place to see CALL-E's outreach across
every ship. Verdict: **partial**, not missing and not complete — assignment
integration existed, a standalone Calls surface did not.

**Backend additions (only what the UI genuinely needed, nothing invented).**
Two new read-only endpoints, both under `authorize('ships:read')` — the
same permission every other read view over this data already uses, no new
RBAC action introduced: `GET /api/v1/voice-calls` (paginated, filterable by
`outcome`, reads `AssignmentAttempt WHERE provider IS NOT NULL` — that
table already carried everything a resolved-call history needs and is
cleanly paginatable by a real DB column) and `GET /api/v1/voice-calls/active`
(reads `VoiceCallPlacement WHERE resolvedAt IS NULL`, deliberately
unpaginated but capped at 50, since it's bounded in practice by
`VOICE_CALLS_CONCURRENCY`). Kept as two purpose-fit queries rather than one
UNION feed: the two tables are linked only by a shared `externalCallId`
*value*, not a formal Prisma relation, so a single paginated feed across
both would need an awkward hand-rolled UNION for no real benefit over two
small, honest queries. Tenant isolation is enforced the same way
`voice.service.ts` already enforces it elsewhere in this module (neither
table is in `TENANT_SCOPED_MODELS`): explicit `assignment: { organizationId
}` relation filters, not the Prisma Client Extension. Covered by 5 new
integration tests, including one that plants two organizations' calls and
asserts org A's list never contains org B's row.

**Frontend.** `apps/web/src/features/calls/` — `CallsPage.tsx`,
`useCalls.ts`, `api.ts`, `statusStyles.ts` — built entirely from existing
design-system patterns (`StatCard`/`Panel` from `DashboardPage`, the
parallel-`pageSize:1`-queries stat-count pattern and conditional-polling
pattern from `useAssignments`), reusing `ATTEMPT_OUTCOME_LABEL` from
`assignments/statusStyles.ts` rather than inventing new outcome vocabulary
for the same underlying fact. Deliberately **read-only**: no "call again"
action on a history row, because that DTO doesn't carry the assignment's
*current* status (it can have changed since the call happened), and
offering an action against a possibly-stale assignment would risk a
duplicate/incorrect placement — call-initiation stays exclusively on the
Assignment resource, where current state is authoritative. A "View in
Assignments" button was added to the call detail modal (satisfying the
"navigate assignment↔call" requirement) via the same `onNavigate` prop
convention `DashboardPage` already uses; the reverse link (an Assignment
row deep-linking to its own filtered call history) was scoped out —
`AssignmentsPage`/`CallsPage` have no single-record deep-linking today, and
adding it is a larger change than "a small change," which the task's own
scope rule ruled out.

**Live verification, not just source review.** Ran the actual stack
(`dev:api` + `dev:web` against the real dev Postgres/Redis) and drove it
through a real browser: empty state, a genuinely placed call (202 Accepted
from the real endpoint, including a double-click that both went through as
202s — proving the UI does not itself dedupe; the backend's existing
idempotency ref is what actually protects against a duplicate placement),
an injected API-down state (confirmed the error path renders "Could not
load call history" / "Could not load active calls" rather than hiding the
failure), the resolved-call list, outcome filtering, the in-flight
"Calling now" card, both branches of the detail modal, the new
cross-navigation button landing on Assignments, and a mobile (375px)
layout check. No console errors, no failed requests, no hardcoded/fake
data anywhere — every number on the page traces to a real endpoint. (Local
dev has no real CALL-E credentials, so two resolved outcomes and one active
placement were seeded directly into the dev database to exercise rendering
paths a fresh empty DB can't reach; removed after verification — this
does not substitute for the 5 integration tests, which exercise the same
code paths against real HTTP requests.)

**Second, independent audit pass** (as a reviewer who hadn't seen the
implementation): checked for dead buttons, hidden errors, duplicate-action
risk, stale modal state, authorization gaps, and backend/UI contract
mismatches. One real gap found and fixed — the missing
"navigate assignment↔call" link, added as above. Everything else held up:
tenant isolation is server-enforced and test-covered, not a client-side
filter; the provider name shown (`"call-e"`) is a label, never a secret,
and CALL-E's real API key never reaches the browser; loading/empty/error
states are all explicit, not silently swallowed. One accepted, narrow
limitation, not fixed: `useActiveCalls`'s conditional polling (same
pattern as `useAssignments`) stops entirely once it observes zero active
calls, so a call placed by a *different* tab/session while this page sits
idle at zero won't appear until the page remounts — identical, pre-existing
behavior to the pattern it was copied from, not something introduced here.

## Phase 0→4 repository consolidation

Two genuine issues found during a final consolidation pass over the whole
Phase 0→4 baseline (git history, working tree, secrets, and a re-run of the
adversarial test list against what already existed), both fixed:

1. **Missing `docker-compose.yml` restart policies (repo-wide).** Flagged
   as "considered and deliberately not changed" during the Phase 4 gate
   audit above, specifically because fixing it only for the two Phase 4
   services would have been an inconsistent special case — the right fix
   was always repo-wide. Added `restart: unless-stopped` to all five
   services (postgres, redis, api, worker, web). Verified with
   `docker compose config --quiet`.
2. **A wrong test count in the Calls UI consolidation commit message**
   (claimed 219/219; the actual, re-verified count was 216 — 214 backend +
   2 frontend). Corrected by amending that commit before it left this
   machine; not a code defect, just an arithmetic error caught on review.

Everything else audited in this pass — tenant isolation, webhook trust
model, idempotency, outcome-translation determinism, secret handling,
CALL-E abstraction boundary — held up against the full adversarial list
(duplicate click/job/webhook, concurrent webhook, cross-tenant access,
malformed webhook, provider error propagation, stale/missed-webhook
reconciliation, a call resolving concurrently with a human action, expired
auth, empty/API-down/mobile Calls page) with no further changes needed;
Redis/DB-restart resilience for the voice queues specifically relies on
BullMQ/ioredis's own reconnect behavior and wasn't re-proven with a live
container kill in this pass (general infra chaos testing was done in
Phase 1). Final state: 216/216 tests, clean typecheck/lint/build across all
three workspaces, working tree clean.

## Phase 5: Yellow Zone escalation queue + realtime

**The product decision this phase pivots on.** The original brief called
this "Inbound Calls & Yellow Zone." A planning pass against the actually-
installed `@call-e/calle@0.6.0` SDK's own generated OpenAPI types found
`WebhookEventType` is a closed enum — `call.completed | call.failed |
call.result_validation_failed` — with no inbound-call concept anywhere in
the schema, and `CalleCalls` (the SDK's only call-related class) exposes
only `create/get/listEvents/waitForResult/createAndWait`, all outbound.
CALL-E cannot receive a call and hand it to Kinvo; it can only place
outbound confirmation calls, exactly as Phase 4 already uses it. Presented
as a blocking decision with three options; the user chose **Option A**:
re-scope Yellow Zone to be fed by unresolved *outbound* calls — the
`SYSTEM_ERROR` `AssignmentAttempt`s Phase 4 already produces when a call
fails, times out, or CALL-E can't judge the outcome — rather than a literal
inbound-call feature that has no implementation path against the real
provider. Nothing about Phase 4's actual call-placement behavior changed;
only what happens *after* a call ends up `SYSTEM_ERROR` is new.

**Schema and state machine.** `YellowZoneItem` (new model) denormalizes
`driverId`/`shipId`/`destination`/`truckType` onto the row itself, the same
way `AssignmentAttempt.provider` already does — a dispatcher's queue needs
to render without joining back through `Assignment → TruckRequirement →
Ship` on every list request. `assignmentAttemptId` is unique, which is the
actual duplicate-escalation guard (defense in depth: `AssignmentAttempt` is
itself only ever created once per terminal webhook/reconciliation event, so
the uniqueness is mostly never exercised, but a webhook replay racing a
reconciliation sweep is exactly the scenario it exists for). Status walks
`PENDING → IN_REVIEW → RESOLVED` or `PENDING/IN_REVIEW → DISMISSED`, each
transition using the codebase's established `updateMany({where: {id,
status: X}})` + `count === 0 → 409` pattern (`assignments.service.ts`'s
`confirmAssignment`/`rejectAssignment` precedent) rather than a plain
`update()` — proven under real concurrency with a `Promise.all` double-claim
test, exactly one request wins. `YellowZoneItem` was deliberately added to
`TENANT_SCOPED_MODELS` (unlike `AssignmentAttempt`/`VoiceCallPlacement`,
deliberately excluded) because a dispatcher's queue is a direct top-level
list/filter access pattern — the same shape as `Ship`/`Driver` — not a
sub-resource always reached through an already-owned parent.

**Escalation is transactional with the triggering attempt, not
best-effort.** `assignments.service.ts`'s `logAttempt` gained an optional
trailing `tx?: TransactionClient` parameter (mirroring `auditLogger.record`'s
own shape), so `voice.service.ts`'s new `logSystemErrorWithEscalation`
wraps both the `SYSTEM_ERROR` `AssignmentAttempt` write and the
`YellowZoneItem` creation in one `prisma.$transaction`. A dispatcher can
never see "confirmed" flip to a failure that has no corresponding queue
entry, or a queue entry for an attempt that didn't actually get persisted.
`classifyEscalation(reason)` — a pure, total function pattern-matching on
the real reason strings `outcomeTranslation.ts` already produces — assigns
`HIGH`/`MEDIUM`/`LOW`, defaulting safely to `MEDIUM` for anything
unrecognized rather than throwing.

**Realtime: a publish/subscribe split, not a single Socket.io server.**
`voiceService`/`yellowZoneService` are constructed once by
`createContainer()`, which runs in three different entrypoints —
`server.ts` (has an `http.Server`, can host a real Socket.io `Server`),
`worker.ts` (a pure BullMQ processor, **no** HTTP server, yet this is
exactly where escalations are created, since reconciliation and webhook
processing are worker-invoked), and the test harness. A single Socket.io
`Server` instance can't exist in the worker process at all. Solved by
splitting the realtime layer in two: `core/realtime/socketServer.ts`
(subscribe-side, API-process-only, accepts browser connections, wired to
Redis via `@socket.io/redis-adapter` for multi-instance correctness) and
`core/realtime/emitter.ts` (publish-side, used by *both* processes via
`@socket.io/redis-emitter`, which speaks the same Redis pub/sub protocol the
adapter listens on without needing a Socket.io `Server` instance at all).
The emitter's Redis connection is a module-level singleton — an earlier
draft constructed a fresh `ioredis` client per `createContainer()` call,
which would have opened a new connection on every one of the ~254 test
setups; caught in design review, not in production.

Socket auth reuses REST auth's exact verification logic —
`resolveAuthenticatedContext(token, tokenRevocationStore)` was extracted
into its own module specifically so the Socket.io handshake middleware and
`authenticate.ts` can never drift on what "authenticated" means. Room
membership (`org:${organizationId}`) is derived only from this verified
context; the client's handshake payload is never trusted for it, even if it
supplies its own `organizationId`. Every Yellow Zone socket event carries
only enough to key a TanStack Query cache invalidation (`['yellow-zone']`)
— never data the UI trusts directly. REST + Postgres remain the sole source
of truth; a client that never received a socket event still sees correct
data on its next fetch.

**Security audit (live, against the running dev stack, beyond what the
automated suite already covers).** Registered a second, fully separate
organization and attempted every verb (`GET` by id, `LIST`, `stats`,
`claim`, `resolve`, `dismiss`) against another org's real `YellowZoneItem`
rows — every one returned `404 Yellow Zone item not found` (never `403`,
matching the existing "invisible, not forbidden" convention from Phase 1's
own tenant-isolation tests), with no data leakage in any response body.
Invited and authenticated as a `VIEWER` in the target org: list/stats/get
all `200`, `claim`/`dismiss` both cleanly `403 Role VIEWER is not permitted
to perform "yellow-zone:manage"`. Confirmed input validation (empty
`resolutionNotes` → `400`), invalid state transitions (resolving an
already-resolved item → `409`), no token → `401`, and a SQL-injection-style
path segment → a clean `404` via Prisma's parameterization, no stack trace,
no 500. Socket-level cross-tenant isolation, revoked-membership rejection,
and the "client-supplied `organizationId` is never trusted" property are
covered by `test/integration/realtime.test.ts`'s 7 automated tests, which
this pass re-read rather than re-implemented by hand.

**Live verification — the full pipeline, proven with a real timing-based
failure, not a seeded row.** `FakeVoiceProvider` (already existing,
documented as "local development without a real CALL-E account") was
selected by temporarily running the api/worker processes with `NODE_ENV=
test` and a shortened `VOICE_RECONCILE_STALE_AFTER_MINUTES=1` /
`VOICE_RECONCILE_INTERVAL_MINUTES=1` (both reverted immediately after — see
git history, not left in any committed config). A real assignment's call
was placed through the real `POST /assignments/:id/voice-calls` endpoint,
left to sit `pending` (exactly like a real CALL-E call that never gets a
webhook), and the worker's own reconciliation sweep — running on its normal
schedule, not invoked directly — converted it to `SYSTEM_ERROR` and created
the escalation for real. With the Yellow Zone page already open and
untouched, the "Needs attention" count went `0 → 1` and the row appeared
with the correct `LOW` priority (matching `classifyEscalation`'s "did not
reach a terminal state within N minutes" branch) purely from the socket
push — confirmed by reading `read_network_requests`, which showed the
`GET /yellow-zone/stats` + `GET /yellow-zone` refetches TanStack Query's
invalidation triggers, with zero manual interaction. Repeated for a second
and third escalation to exercise claim → resolve and claim → dismiss
end-to-end through the actual UI, including the "Confirm resolve" button
correctly staying disabled until notes are non-empty, and the "Reconnecting…"
banner genuinely appearing when the API process was killed mid-session and
clearing again once it came back, socket.io-client's own reconnection
handling it with no page reload.

**Two real bugs found and fixed during this live pass, both outside what
the automated suite could catch since it never keeps a component mounted
across a mutation the way an actual dispatcher session does:**

1. *Yellow Zone detail modal went stale after `claim`.* `YellowZonePage`
   held the open item as a `useState` snapshot captured at click-open time;
   claiming (which deliberately keeps the modal open, unlike resolve/
   dismiss, so a dispatcher can move straight into resolving) invalidated
   the list query correctly, but the still-open modal never re-read the
   fresh data — it kept showing "Unclaimed" and a live "Claim" button after
   a successful claim. Fixed by having the claim mutation's own response
   (the endpoints already return the updated `YellowZoneItemDto`) flow back
   into the parent's selection state via a new `onClaimed` callback, rather
   than relying on the list refetch to somehow reach a detached snapshot.
2. *`AuthProvider`'s silent-refresh-on-mount raced itself under React 18
   StrictMode.* Every dev-mode mount runs the effect twice
   (mount → cleanup → mount); the existing `cancelled` guard only stops the
   *discarded* invocation's own state update, not its `fetch()` from
   reaching the server. Since the refresh-token cookie is single-use/
   rotating, both invocations' concurrent `POST /auth/refresh` calls raced
   for the same cookie — one redeemed it (`200`), the other got a spurious
   `401` — and because response ordering doesn't have to match effect
   ordering, the *live* invocation could be the one that lost, incorrectly
   signing a genuinely-authenticated user out on a hard reload. Pre-existing
   since Phase 1, only surfaced now because this phase's live-verification
   loop reloaded the app far more times in a row than prior phases' manual
   spot-checks did. Fixed with a module-level in-flight-promise singleton in
   `auth.tsx` so the second invocation awaits the first real request instead
   of firing its own; verified with three consecutive hard reloads, each
   producing exactly one `200` refresh call. (Two separate browser tabs
   racing the same rotating cookie is a related, lower-priority scenario
   this fix does not address — it would need cross-tab coordination, e.g. a
   `BroadcastChannel`-based leader election, and is unrelated to the
   StrictMode bug actually reported; left as known future work.)

**What Yellow Zone deliberately does not do.** No polling — the list/stats
queries rely on TanStack Query's normal mount/focus refetch plus the socket
invalidation, matching the doc comment's own reasoning ("realtime-driven...
polling would just be redundant traffic on top of a signal that already
exists"). No RBAC-based UI hiding — action buttons render regardless of
role and the backend's `403` is the actual enforcement, matching the
convention already established across every other page in this codebase
(confirmed by grep before writing the page, not assumed). No inbound-call
UI of any kind, since the underlying capability doesn't exist against the
real provider — a future CALL-E account tier or API version that adds true
inbound support would be a genuinely new integration, not an extension of
this phase's data model.

**Final state:** 256/256 tests (254 backend + 2 frontend, including 17 new
Yellow Zone integration tests, 7 new realtime tests, and 12 new
classification unit tests), clean typecheck/lint/build across all three
workspaces, Phases 0–4 untouched and still fully green, working tree
reviewed for unrelated changes before commit.

## Phase 5 hardening pass

A dedicated adversarial audit against the already-implemented, already-
committed Phase 5 — re-verifying every claim against actual source rather
than trusting the section above (including catching two inaccuracies in
that section's own doc comments, see below) — found one real production
gap, several product-semantics decisions that had been left implicit
rather than made, and a genuine frontend test-coverage hole. Fixed here;
nothing was rebuilt or redesigned.

**The one real bug: socket reconnect could get permanently stuck on a
stale token.** `connectSocket` (`apps/web/src/lib/socket.ts`) originally
passed `auth: { token }` as a static object captured once at connection
time. Socket.io-client replays that exact object on every automatic
reconnect attempt — so a socket that outlived one disconnect/reconnect
cycle past `JWT_ACCESS_TTL` (15 minutes; not a contrived scenario for a
dispatcher's tab left open a whole shift) would reconnect with an expired
token forever, since nothing in this app refreshes the access token
proactively. Fixed with the callback form of socket.io's `auth` option,
reading `apiClient.ts`'s current token fresh on every attempt, plus a
`connect_error` handler in `RealtimeProvider.tsx` that reuses
`auth.tsx`'s existing `refreshSession()` (exported for exactly this, not
a second refresh implementation) to redeem a fresh token the moment a
reconnect is rejected for an expired one, then retries immediately rather
than waiting out socket.io's own backoff. If the refresh itself fails —
the refresh-token cookie is genuinely dead, not just the access token —
this deliberately does nothing further: there is no session left to
recover, and inventing a second recovery path would be exactly the
parallel auth system the fix was scoped to avoid. Proven with
`apps/web/src/lib/socket.test.ts` (the live-read half) and
`RealtimeProvider.test.tsx` (the refresh-and-retry half, including that
a failed refresh doesn't force a retry and that concurrent connect_error
events don't stack a second refresh call) — a full real-socket-against-a-
real-server-with-a-genuinely-expired-token end-to-end run was not
performed (would need either live JWT-expiry manipulation inside a
running integration test or a multi-minute real wait); the fix is proven
by direct test of the actual new logic and code inspection, not a fake
full-stack demonstration.

**Product decisions made explicit, not guessed at.** The original Phase 5
pass shipped two real ambiguities without resolving them:

- *Can a different dispatcher finish a colleague's claimed item?* Yes,
  intentionally — kept as-is (no code change), because `assignments.
  service.ts`'s own `confirmAssignment`/`rejectAssignment`/
  `cancelAssignment`/`markNoShow` never gate on `createdByUserId` either;
  every action on a shared resource in this codebase is available to any
  teammate with the right RBAC permission, not just whoever touched it
  first. Documented directly above `claimYellowZoneItem` in
  `yellow-zone.service.ts`, and proven with two new regression tests
  (`test/integration/yellow-zone.test.ts`'s "shared ownership" describe
  block) rather than left as an untested assumption.
- *No way to release a claim.* An `IN_REVIEW` item that its claimant never
  finishes had no path back to `PENDING` — it just silently dropped out of
  the "needs attention" signal forever. Added `PATCH /yellow-zone/:id/
  unclaim`, using the same conditional-`updateMany`-plus-affected-row-count
  pattern every other transition here already uses. Deliberately
  claimant-only (unlike resolve/dismiss) — releasing is "let go of what I
  grabbed," a materially more disruptive action to hand to a bystander than
  finishing already-claimed work, since it can strand whoever's mid-call
  with the driver. The frontend hides the "Release" button from non-
  claimants for clarity; the actual enforcement is server-side, matching
  the codebase's existing button-hiding-is-not-authorization convention.

**Assignment/Yellow Zone linkage: informative, not coupling.** Resolving
or dismissing a Yellow Zone item still deliberately never touches
`Assignment.status` — "operator acknowledged an automation failure" and
"the assignment itself is resolved" remain two separate facts, and
auto-mutating one from the other risks a much worse class of bug than the
one being fixed (a Yellow Zone action silently confirming/rejecting an
assignment the dispatcher never actually verified). What changed:
`YellowZoneItemDto` gained an additive `assignmentStatus` field (a wider
Prisma `select`, no schema migration — the join was already being walked
for every other field), and the detail modal now shows an informational
hint ("The underlying assignment is already Confirmed — this item may
just need dismissing") when a human resolved the real problem through the
normal Assignments flow while the escalation sat open. Repeated-escalation
grouping for one assignment (the same audit's other UX finding) was
deliberately **not** built in this pass — it needs a real query-shape
decision (a per-item related-count computation interacting with
pagination) that deserves its own focused pass, not a bolt-on here; tracked
as a known gap, not fixed.

**Frontend test coverage: the actual gap that let the modal-staleness bug
through.** Backend Yellow Zone coverage was already thorough; the
frontend had exactly two generic smoke tests for the whole app. Added
`YellowZonePage.test.tsx` (18 cases covering every state-machine
transition, loading/error/empty states, the 409-claim-race UX below, and
— explicitly — the exact "modal stays stale after claim" regression this
whole pass started from) plus `socket.test.ts`/`RealtimeProvider.test.tsx`
(6 cases for the P0 fix itself). Building these surfaced a real, general
gap in the project's own test setup: `@testing-library/react`'s
auto-cleanup hook never self-registers in this repo's Vitest config
(`test.globals` isn't set, so there's no global `afterEach` for it to
attach to), meaning a rendered tree from one test stayed mounted into the
next test in the same file — invisible for `App.test.tsx`'s two tests
(they assert non-overlapping text) but a guaranteed false failure the
moment two tests in one file render overlapping content, exactly what a
real Yellow Zone test suite does constantly. Fixed once, project-wide, in
`src/test/setup.ts` (`afterEach(cleanup)`), not duplicated per test file.

**Claim-race UX.** A `409` on claim (someone else claimed it first) used
to surface as a raw error string with a dead "Claim" button still showing.
Now fetches the item's real current state and feeds it through the same
`onClaimed` plumbing the successful-claim path already uses, with a
plain-language message — "Someone else just claimed this item — showing
its current status" — rather than inventing a second update path for the
failure case.

**Documentation corrections** (code was already correct; the comments
describing it weren't): `YellowZoneItem`'s schema comment claimed
`driverId`/`shipId` let the queue "render without joining back through
Assignment" — false; `toYellowZoneItemDto` always joins through
`assignmentAttempt → assignment → driver/truckRequirement/ship`
regardless, and neither column is used for filtering. `socketServer.ts`'s
comment claimed the frontend "reconnects with a fresh token on every
REST-triggered refresh" — also false as originally written (no such
trigger existed anywhere in the app); now accurate, describing the actual
mechanism this pass built.

**Explicitly deferred, not fixed — matching this pass's own "harden, don't
redesign" scope:** repeated-escalation grouping (see above); Yellow
Zone-specific rate limiting (consistent with ships/drivers/assignments,
none of which have any either); the Redis adapter's untested multi-instance
behavior (correct by construction with one API instance, genuinely
untested with two — no second instance exists in this repo's Docker
topology to test against); the dead-code P2002 guard in
`createEscalationForAttempt` around `assignmentAttemptId` (harmless
defense-in-depth; the real protection for the concurrent-webhook race it
was written for is `AssignmentAttempt.externalCallId`'s own unique
constraint, one layer up); general REST-layer 401-triggers-refresh-and-
retry (a larger, pre-existing, Phase-1-era gap this pass's socket fix
does not extend to — the socket fix reuses the existing refresh mechanism
reactively on its own failure signal, it does not add one to `apiClient.ts`
itself).

**Final state:** 261 backend tests + 26 frontend tests, all passing;
clean typecheck/lint/build across all three workspaces; Phases 0–4 and
the original Phase 5 implementation unchanged in behavior throughout.

## Phase 6: Notifications / Inbox

An in-app notification/inbox system, reusing 100% of Phase 5's realtime
infrastructure (same Socket.io server, same Redis adapter, same
handshake-time JWT auth) rather than standing up any second delivery
mechanism. Section 11's original sketch above ("start as a plain Node
EventEmitter... graduate to Redis pub/sub") is now fully stale — Phase 5
built the Redis-backed layer directly and this phase's `Notification`
model matches that pre-existing sketch's data shape (`orgId, userId,
type, payload, readAt`) closely enough that no redesign was needed, just
an implementation.

**Explicit scope narrowing.** `docs/ARCHITECTURE.md`'s own Milestones
section bundles `ReminderCampaign` + approval-gate + campaign-queue with
`Notification` + inbox under one Phase 6 entry. This pass built only the
notification/inbox slice — the campaign/reminder half is a materially
different feature (scheduled outbound messaging with an approval
workflow, not an event-driven inbox) and is explicitly deferred, not
silently dropped.

**Data model — user-specific, not org-wide.** `Notification` has both
`organizationId` and `userId`, and is the first model in this codebase
needing dual-layer scoping: the `TENANT_SCOPED_MODELS` Prisma extension
(`core/prisma.ts`) auto-injects `organizationId` on every query, but has
no concept of `userId` — every service method in
`notification.service.ts` additionally filters `userId: context.userId`
explicitly, by hand, on top of that. Proven with dedicated tests for
both layers independently: tenant isolation (list, cross-org mark-read,
mark-all-read scoping) and user isolation within one organization (a
second dispatcher in the same org can't see or mark read a colleague's
notification).

**Idempotency is a database constraint, not application logic.**
`@@unique([userId, targetType, targetId, type])` — `targetId` (the
`YellowZoneItem.id`) is itself the natural dedup key, since one
`YellowZoneItem` can only ever produce one `YELLOW_ZONE_ESCALATED`
notification per recipient. `createForRecipients` catches Prisma's
P2002 as a safe no-op per recipient rather than pre-checking existence,
mirroring `createEscalationForAttempt`'s own existing idempotency
pattern one layer up. Proven with a duplicate-webhook-delivery test that
asserts no duplicate row is created.

**Transactional: notification creation, not just escalation creation.**
`voice.service.ts`'s `logSystemErrorWithEscalation` creates the
`AssignmentAttempt`, the `YellowZoneItem` escalation, AND the
`Notification` rows for every eligible recipient inside the same
`prisma.$transaction`. Realtime emits (`YELLOW_ZONE_CREATED` to the org
room, `NOTIFICATION_CREATED` per-recipient to each `user:${userId}`
room) happen only after that transaction resolves — a socket push can
never announce a notification that a rolled-back transaction made not
actually exist.

**Recipient targeting is deliberate, not "notify everyone."** Every
`ACTIVE` membership with role OWNER, ADMIN, or DISPATCHER gets notified
on `yellow_zone.escalated`; VIEWER is excluded (no `yellow-zone:manage`
capability, so a notification would just be noise with no action behind
it). Membership is evaluated at escalation time, not retroactively — a
user invited after an escalation fired does not receive it
retroactively, live-verified by inviting a fresh dispatcher mid-session
and confirming their inbox started empty despite two prior escalations
already existing in the same org.

**Audit event vs. notification — a deliberate distinction, not every
event notifies.** Only `yellow_zone.escalated` produces a notification.
`claimed`/`unclaimed`/`resolved`/`dismissed` remain audit-only: they're
already visible live in the Yellow Zone queue itself (Phase 5's realtime
invalidation), and a notification for each would be noise a dispatcher
watching that queue doesn't need. No new `AuditEventType` values were
added for notification creation or read state either — a notification
is a derived artifact of an already-audited fact (the escalation), and
per-read audit logging would flood the audit log with "User opened
notification," which is a UI action, not a business event.

**RBAC is ownership-based, not role-based — a deliberate asymmetry
from every other Phase 0–5 module.** Notification routes have no
`authorize()` call and no new RBAC `Action` entries. Every authenticated
member, including VIEWER, can read and manage their own inbox — the
boundary is `userId === context.userId` in the service layer, not a
role check, because "can I see my own notifications" is a materially
different question from "can I manage this resource." Proven with a
test asserting every role, VIEWER included, gets 200 (not 403) on its
own empty inbox.

**Realtime rooms: user-targeted, not org-broadcast.** `socketServer.ts`
now joins every authenticated connection to both `org:${organizationId}`
(existing, Phase 5) and a new `user:${userId}` room from the same
verified-token handshake. `emitter.ts` gained `emitToUser` alongside the
existing `emitToOrganization`, sharing the same Redis-backed `Emitter`
singleton — broadcasting a private notification into the org room would
leak it to every teammate's client, not just the intended recipient.
Live-verified: two users in the same org, only the targeted one's socket
receives `notification.created`.

**Frontend: invalidate-on-event, same pattern as Yellow Zone.**
`RealtimeProvider.tsx` treats `notification.created`/`notification.read`
exactly like Phase 5's Yellow Zone events — a signal to invalidate the
`['notifications']` query key and refetch, never a payload the UI trusts
directly. Clicking a notification marks it read (best-effort — failure
doesn't block navigation) then navigates to the Yellow Zone tab, not a
specific item, matching the existing "View in Assignments" button's own
precedent (no per-item deep-link parameter exists in this router).

**Live verification, not just automated tests.** Against the real
running stack (`FakeVoiceProvider`, temporarily shortened reconciliation
window, reverted after): three real escalations delivered live
notifications with zero manual refresh in an already-open browser tab;
read state persisted across a hard browser refresh; a second recipient
(freshly invited mid-session) received an independent notification for
the same escalation while the first recipient's unread count was
unaffected by the second's mark-all-read; a brand-new organization
registered mid-session showed zero notifications despite three
escalations existing elsewhere; and a full sign-out/sign-in cycle
correctly recovered the exact prior unread state with no leakage.

**Final state:** 277 backend tests + 36 frontend tests, all passing;
clean typecheck/lint/build across all three workspaces; Phases 0–5
unchanged in behavior throughout.
