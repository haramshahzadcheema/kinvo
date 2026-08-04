# Phase 0 Audit — Principal Engineer Review

Date: 2026-08-04 · Reviewer stance: adversarial, not the author of the code under review.

This audit does not defend Phase 0's implementation. It exists to answer one
question honestly: is this repository something a real engineering team
should build the next year of a company on. Findings are listed with
severity, impact, a recommendation, and when it must be fixed. Evidence for
every claim was gathered from the actual running system and repository, not
recalled from memory of writing it.

---

## Critical Findings

### C1 — Unauthenticated `/health/ready` performs real, unthrottled DB/Redis work

**Explanation:** `GET /health/ready` runs a live `SELECT 1` against Postgres
and a live `PING` against Redis on every single call, with no
authentication and no rate limiting anywhere in front of it.
**Business impact:** A misbehaving monitor, a scraper, or a trivial script
can drive unbounded load against the database purely through the health
endpoint — a self-inflicted denial of service that costs nothing for an
attacker to trigger.
**Technical impact:** At scale this endpoint amplifies into real connection
pool pressure. Health endpoints are usually the _first_ thing hit by
external actors (they're undocumented but guessable, unauthenticated by
design, and often exempted from WAF rules).
**Recommendation:** Add a lightweight rate limiter (even a fixed low
ceiling, e.g. 10 req/s per IP) in front of `/health/*` specifically, or
cache the readiness result for a short TTL (1-2s) instead of hitting DB/Redis
on every call.
**Fix by:** Immediately — this is live in the current build, not a future
risk.

### C2 — Git history is a single commit; nothing is bisectable or revertable

**Explanation:** The entire Phase 0 delivery — monorepo scaffold, Docker
setup, CI, the engineering-review fixes (devDependency dedup, naming,
logging consistency), and the Vite host-binding bugfix discovered during
verification — is one commit (`446c75c`, 68 files, ~11.8k lines).
**Business impact:** None yet (no collaborators, nothing shared), but this
pattern, if it continues, makes onboarding and code review materially
harder — a reviewer cannot approve "the scaffold" separately from "the
bugfix," and nothing here is `git revert`-able in isolation.
**Technical impact:** No `git bisect` value. The Vite fix and the
devDependency consolidation are genuinely independent units of work that
happened to land in the same commit only because they were discovered
during the same session — that's an accident of process, not a
justification.
**Recommendation:** Since nothing has been pushed to a remote yet, this is
the cheapest possible moment to fix: `git reset --soft` to before the
commit and re-commit in logical units (see §19 below for the exact split).
If you'd rather not rewrite it, at minimum commit to strict per-change
discipline starting now — every fix, no matter how small, gets its own
commit with a message that explains _why_, not just _what_.
**Fix by:** Before Phase 1 (free to fix now; increasingly awkward the more
commits stack on top of it).

### C3 — Multi-tenancy enforcement exists only as prose, not as code

**Explanation:** §4 of `ARCHITECTURE.md` calls the Prisma
auto-`organizationId`-scoping middleware "the single highest-value security
control in a multi-tenant app." It does not exist. There are no models yet,
so it can't — but that also means the single most important guarantee this
entire business depends on has zero test coverage, zero implementation, and
nothing preventing Phase 1 from being built without it if nobody insists.
**Business impact:** A cross-tenant data leak (Organization A sees
Organization B's ships/drivers) is the kind of bug that ends a logistics
SaaS company's trust with its customers overnight.
**Technical impact:** Retrofitting tenant scoping after query patterns are
established across a dozen modules is materially more expensive than
building it as the very first piece of Phase 1.
**Recommendation:** This is not optional scope for "later in Phase 1" — it
should be the _first_ commit of Phase 1, built alongside the first model,
with an integration test that explicitly proves a query scoped to
Organization A cannot return Organization B's rows even if a developer
forgets to add a `where: { organizationId }` clause by hand.
**Fix by:** Immediately upon starting Phase 1 — this is a gate, not a task.

---

## High Priority Findings

### H1 — Phase 0's own code contradicts the documented DI/composition-root architecture

**Explanation:** `ARCHITECTURE.md` explicitly rejects a DI framework in
favor of "plain constructor injection with a manual composition root... gets
you the same testability (swap a fake `VoiceProvider` in tests)." But
`health.service.ts` hard-imports `checkDatabaseConnection` and
`checkRedisConnection` as singleton module functions, and the existing test
suite achieves "testability" by using `vi.mock()` to hijack the module
system — not by injecting a fake collaborator through a constructor or
parameter. These are meaningfully different patterns.
**Business impact:** None directly, but it sets the example every future
module will copy.
**Technical impact:** The whole reason the architecture doc rejected a DI
framework was to keep "swap `FakeVoiceProvider` for the CALL-E adapter"
simple. If the only precedent in the codebase is "import the singleton,
`vi.mock()` it in tests," a Phase 4 engineer has no working example of the
actual promised pattern (a constructor-injected, runtime-swappable
`VoiceProvider`) to copy from — they'll copy what's there, and the demo
safety net the architecture doc promised won't exist.
**Recommendation:** Before Phase 1 introduces its first real service (auth),
build one small, real example of the composition-root pattern — even
trivial — so it's the thing engineers copy, not the health-check shortcut.
**Fix by:** Before Phase 1's service layer is written.

### H2 — Real-time layer (Socket.io) has no horizontal-scaling story

**Explanation:** Framing decision #2 in `ARCHITECTURE.md` calls real-time
updates "mandatory." Nothing in the architecture doc or the codebase
addresses that Socket.io requires the Redis adapter
(`@socket.io/redis-adapter`) the moment there is more than one API replica
— without it, a Yellow Zone escalation broadcast reaches only the clients
connected to the _same_ pod that received the webhook that triggered it.
**Business impact:** The core "manager supervises instead of dials" value
proposition silently breaks the moment the API scales past one instance —
and it will fail silently (no error, just a manager who doesn't see an
escalation) rather than loudly.
**Technical impact:** This is exactly the kind of gap that surfaces during
a demo or a real incident, not during development (single dev instance
never has this problem).
**Recommendation:** Decide and document the Redis-adapter requirement now,
in `ARCHITECTURE.md` §11, so Phase 5 doesn't ship single-instance-only
real-time and call it done.
**Fix by:** Documented before Phase 1 ends; implemented before Phase 5
(Yellow Zone) ships to more than a single instance.

### H3 — Hidden Redis configuration conflict that will break BullMQ in Phase 4

**Explanation:** `apps/api/src/core/redis.ts` configures the shared Redis
client with `maxRetriesPerRequest: 1`. BullMQ's documentation requires
`maxRetriesPerRequest: null` on any Redis connection it uses for blocking
commands — reusing this singleton for a Phase 4 `Queue`/`Worker` will throw
at runtime.
**Business impact:** None yet — this is a landmine, not a live bug.
**Technical impact:** A Phase 4 engineer who naively imports the existing
`redis` singleton for BullMQ will hit a cryptic runtime error and lose time
diagnosing a config incompatibility that a one-line note would have
prevented.
**Recommendation:** Document this explicitly in `ARCHITECTURE.md` §14
(Background Jobs) now: BullMQ needs its own Redis connection, separate from
the health-check/cache connection, with `maxRetriesPerRequest: null`.
**Fix by:** Before Phase 4 (document now, since it's nearly free).

### H4 — No dependency or secret scanning in CI

**Explanation:** `.github/workflows/ci.yml` runs lint/typecheck/test/build
and nothing else. There is no `pnpm audit`, no Dependabot/Renovate config,
no secret-scanning (gitleaks/trufflehog), no CodeQL.
**Business impact:** For a product that will hold logistics companies'
operational data and eventually PII (driver phone numbers, CNIC/license
numbers), shipping with zero automated dependency-vulnerability visibility
is a real, avoidable risk.
**Technical impact:** None today (small dependency tree), but this compounds
— the later it's added, the more existing vulnerable transitive
dependencies need triage at once.
**Recommendation:** Add Dependabot (near-zero effort, GitHub-native) and a
`pnpm audit --audit-level=high` CI step now, while the dependency tree is
small enough that findings are trivial to act on.
**Fix by:** Before Phase 1.

### H5 — Docker Compose doesn't actually gate on api/web being _ready_, only _started_

**Explanation:** Neither `apps/api/Dockerfile` nor `apps/web/Dockerfile`
declares a `HEALTHCHECK`. `docker compose ps` confirms this: `postgres` and
`redis` show `(healthy)`, `api` and `web` only show `Up` — Docker has no way
to know if they're actually serving traffic. `web`'s `depends_on: - api`
has no `condition: service_healthy` (it can't, since api has no
healthcheck to depend on), so `web` starts as soon as the `api` _container_
exists, not once it's actually accepting connections.
**Business impact:** None locally (both happen to start fast enough), but
this is exactly the kind of ordering assumption that causes flaky
deploys/restarts under real infrastructure load.
**Technical impact:** Any future k8s/ECS deployment copying this compose
file's assumptions inherits the same gap unless someone notices and fixes
it independently.
**Recommendation:** Add `HEALTHCHECK` instructions to both Dockerfiles using
the existing `/health/live` (and for api, `/health/ready`) endpoints, and
change `web`'s `depends_on` to `condition: service_healthy`.
**Fix by:** Before Phase 1 (cheap, and the endpoints already exist).

### H6 — `apps/api/Dockerfile`'s "production" image ships full devDependencies

Already identified and documented as a tracked limitation during Phase 0
(see the `KNOWN LIMITATION` comment in the Dockerfile and
`ARCHITECTURE.md`). Repeating here because a real audit shouldn't let a
self-reported limitation quietly disappear from view: this is real,
unfixed, and must not slip past Phase 7 without a plan.
**Fix by:** Phase 7 (as already scheduled) — flagged here to confirm it
wasn't dropped.

---

## Medium Priority Findings

- **`packages/config` isn't a real workspace dependency.** `apps/api` and
  `apps/web` reference its `tsconfig.base.json` via a relative path
  (`../../packages/config/...`), not a declared `"@kinvo/config":
"workspace:*"` dependency. This works today, but it means pnpm's
  dependency graph doesn't know these packages relate — any future tooling
  that computes "affected packages" from the dependency graph (Turborepo,
  Nx, remote caching) will silently miss this relationship. _Fix before
  adopting any graph-aware build tool._

- **`build`'s manual `build:contracts &&` prefix is redundant; `typecheck`
  and `test`'s are not — verified empirically, correcting an earlier draft
  of this finding.** `pnpm -r run build` alone (no manual prefix) already
  builds `packages/contracts` before `apps/api`/`apps/web`, because pnpm
  resolves execution order from the `workspace:*` dependency graph
  automatically for a script every package shares. So the root `"build"`
  script's explicit `build:contracts &&` prefix is unnecessary and could be
  simplified to `pnpm -r --if-present run build`. But `typecheck` and
  `test` are genuinely different: `packages/contracts`'s own
  `typecheck`/`test` scripts (`tsc --noEmit`, `vitest run`) don't emit
  `dist/`, so even with correct topological ordering, `apps/api`/
  `apps/web` still can't resolve `@kinvo/contracts`'s compiled output
  without an explicit build first — confirmed by deleting `dist/` and
  running `pnpm -r --if-present run typecheck` in isolation, which fails
  with `TS2307: Cannot find module '@kinvo/contracts'`. _Fix: simplify
  `build` only; leave `typecheck`/`test` as they are._

- **No OpenAPI/API contract documentation.** Two endpoints exist today; at
  10+ endpoints across auth/ships/drivers/etc., "read the source" stops
  scaling as a contract-discovery method, especially once external
  integrations exist. Consider `zod-to-openapi` given Zod is already the
  validation layer.

- **Error response `details` field has no redaction boundary.** Any future
  `throw new ConflictError('msg', someInternalObject)` gets serialized
  straight into the client response with no allowlist or sanitization
  step. Nothing stops accidental data leakage through this field.

- **No log redaction configured.** `pino` supports redaction paths natively;
  none are configured. The moment real secrets (JWT secrets, DB
  credentials in connection strings) flow through code that logs objects
  containing them, they leak into logs. Configure redaction _before_ Phase
  1 introduces JWT secrets and password hashes.

- **Repository hygiene: pre-existing prototype export files were committed
  into the engineering monorepo without a deliberate decision.**
  `Kinvo.dc.html`, `image-slot.js`, `support.js`, `.thumbnail`, and
  `uploads/*.png` were carried over from the original prototype directory
  and committed via `git add -A` without evaluating whether they belong in
  an engineering repo going forward (vs. a separate design-assets
  location, or not tracked at all). This should have been an explicit
  call, not a default.

- **`.gitignore` contains a stale, inapplicable rule.** `apps/api/prisma/
dev.db` is a SQLite convention; this project uses Postgres exclusively.
  Trivial, but a senior reviewer would notice it and question whether the
  rest of the config was copy-pasted without full intent.

- **No pre-commit hooks / Conventional Commits enforcement.** Lint/format
  are CI-only gates today; nothing stops a bad commit from landing locally
  before CI catches it. Not blocking, but slows feedback loop and this
  session's own commit message format wasn't enforced by anything.

- **5 of 6 `AppError` subclasses are completely untested.** Only
  `NotFoundError` is exercised by the test suite; the generic `if (err
instanceof AppError)` branch in `errorHandler.ts` has real behavioral
  coverage for exactly one subclass. A bug specific to `ValidationError`,
  `ConflictError`, etc. would not be caught today.

- **No React error boundary at the app root.** Any uncaught render error
  currently white-screens the app with no fallback UI.

- **No bundle/code-splitting strategy established.** The Phase 0 blank
  shell already ships a 237KB (70KB gzip) single JS bundle. Not urgent, but
  worth deciding a route-based code-splitting convention before Phase 2
  adds real screens, not after the bundle has grown unmanageable.

---

## Low Priority Findings

- Helmet's default CSP/HSTS headers are sent on a pure JSON API where they're
  largely irrelevant (CSP matters for HTML responses) — harmless, but a
  reviewer will ask why they're there.
- `AppError.ts` is the one PascalCase filename in an otherwise camelCase
  file-naming codebase (`errorHandler.ts`, `notFound.ts`) — no stated
  convention, one unexplained outlier.
- No test coverage reporting/thresholds wired into CI.
- No multi-arch (amd64/arm64) Docker build consideration.
- No CHANGELOG or release/versioning strategy yet.

---

## Scalability Assessment

| Tier            | Verdict                        | What breaks first                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 10 users        | Fine                           | Nothing                                                                                                                                                                                                                                                                                                                                                                                                |
| 100 users       | Fine                           | Nothing                                                                                                                                                                                                                                                                                                                                                                                                |
| 1,000 users     | Fine                           | Connection pool defaults become worth tuning explicitly, not yet urgent                                                                                                                                                                                                                                                                                                                                |
| 10,000 users    | **Starts breaking**            | No rate limiting anywhere = one bad actor degrades service for everyone; C1's health-check amplification becomes a real vector; zero load testing has ever been performed                                                                                                                                                                                                                              |
| 100,000 users   | **Breaks hard**                | The moment the API needs >1 replica (likely well before this tier for a multi-org SaaS), Socket.io silently stops broadcasting cross-pod (H2) — the product's core real-time promise fails without an error. `Call` table (highest-volume by design) has no partitioning/archival plan implemented. Webhook idempotency (Phase 4, unbuilt) becomes load-bearing the moment retries multiply at volume. |
| 1,000,000 users | Full re-architecture territory | Expected and out of scope for a pre-Phase-1 audit — no team should be planning for this tier yet, and none of today's findings are specific to it.                                                                                                                                                                                                                                                     |

**Headline finding:** this architecture breaks the moment it needs a second
API replica, because the one thing explicitly declared "mandatory" (§0,
framing decision 2 — real-time) has no horizontal-scaling implementation
plan, only a single-instance implicit assumption.

## CALL-E Readiness

The `VoiceProvider` interface doesn't exist in code yet, so it can't be
directly critiqued — but Phase 0 has already established a precedent (H1)
that actively works against the pattern the architecture doc promises for
it. The BullMQ/Redis configuration conflict (H3) is a concrete, specific
landmine that will cost real debugging time in Phase 4 if not documented
now. Net assessment: the _plan_ for CALL-E integration is sound; the
codebase has not yet demonstrated it can execute that plan, and has one
habit (H1) and one hidden trap (H3) that need correcting first.

## Product Workflow Readiness (Ship → Recruit → CALL-E → Yellow Zone → Reminder → Emergency Recruitment)

The documented entity model (`Ship`, `ShipDriverAssignment`, `Call`,
`YellowZoneItem`, `ReminderCampaign`) maps cleanly to every step of this
workflow, including the "replacement recruitment creates a new assignment
row rather than mutating the old one" detail for the cancellation branch.
Nothing in the current codebase contradicts this plan. But zero code
proves it — the honest assessment is "the plan is architecturally sound,
untested," not "verified ready."

---

## §19 — Git & Repository Audit

**Commit history:** one commit (`446c75c`), root branch, no PRs, no
branches. Message quality is good (clear body, explains rationale) but the
commit itself bundles at least four logically separate units of work:
(1) the monorepo/Docker/CI scaffold, (2) the health-check feature,
(3) the engineering-review cleanup (devDependency dedup, naming,
consistency fixes), and (4) the Vite host-binding bugfix discovered during
verification. A senior team would not consider this professional
granularity — it would be fine as _one_ commit if it represented one
coherent delivery, but it silently absorbed fixes discovered after the
"initial scaffold" was already functionally complete.

**Recommended split**, since nothing is pushed and rewriting local-only
history is entirely safe right now:

1. `chore: scaffold pnpm monorepo (apps/api, apps/web, packages/contracts, packages/config)`
2. `feat(api): liveness/readiness health check with live Postgres/Redis connectivity`
3. `chore: add Docker Compose, Dockerfiles, and CI workflow`
4. `refactor: consolidate duplicated devDependency versions to workspace root`
5. `fix(web): Vite dev server not binding to all interfaces in Docker`
6. `docs: architecture decisions log and developer setup guide`

This is a recommendation, not something to execute silently — it changes
history and should be a deliberate choice, confirmed before running.

**Repository cleanliness:** `.gitignore` is mostly solid (node_modules,
build output, `.env`, editor files, local Claude settings) but contains one
irrelevant rule (SQLite `dev.db` in a Postgres-only project) and the
initial commit swept in pre-existing prototype-export assets
(`Kinvo.dc.html`, `image-slot.js`, `support.js`, `.thumbnail`,
`uploads/*.png`) without a deliberate decision about whether they belong in
the engineering monorepo going forward.

**No secrets committed** — verified: only `.env.example` files are tracked,
real `.env` files are correctly ignored.

**No LICENSE, CONTRIBUTING.md, CODEOWNERS, PR template, or issue
templates.** All absent. None are blocking for a private, pre-team repo,
but all are real gaps the moment this is opened to more than one engineer.

## §20 — Repository Hygiene Summary

| Item                           | Status                                    |
| ------------------------------ | ----------------------------------------- |
| Secrets tracked                | None found ✓                              |
| Lockfile committed             | `pnpm-lock.yaml` ✓                        |
| LICENSE                        | Missing ✗                                 |
| CONTRIBUTING.md                | Missing ✗                                 |
| CODEOWNERS                     | Missing ✗                                 |
| PR template                    | Missing ✗                                 |
| Issue templates                | Missing (optional)                        |
| `.env.example` files           | Present at root, `apps/api`, `apps/web` ✓ |
| Folder/file naming consistency | One outlier (`AppError.ts`)               |
| Package naming consistency     | Consistent (`@kinvo/*`) ✓                 |
| Untracked-but-should-be        | None found                                |
| Tracked-but-shouldn't-be       | Prototype export assets, unreviewed       |

## §21 — Recommended Git Workflow

Trunk-based development with short-lived feature branches; every PR
requires CI green (lint/typecheck/test/build, plus the dependency/secret
scanning recommended in H4) and at least one reviewer approval once the
team is more than one person; squash-merge to keep `main` history one
commit per logical PR; Conventional Commits (`feat:`, `fix:`, `chore:`,
`docs:`, `refactor:`) enforced via `commitlint` + a `commit-msg` hook once
that's worth the setup cost (not urgent solo); branch protection on `main`
the moment this is pushed to GitHub (require status checks, disallow direct
pushes); versioning via git tags per production deploy rather than semver
package versioning, since this is an application, not a published library.

## §22 — Final CTO Sign-off

**Comfortable making this public today?** No. `uploads/*` contains
unreviewed pasted assets from the original prototype export whose contents
were never audited for sensitivity, there's no LICENSE, and the commit
history isn't something you'd want as a first public impression. None of
this is hard to fix — it's a "don't, until reviewed" not a "can't."

**Comfortable hiring five engineers tomorrow to build the next year on
this?** Qualified yes, conditional on the Critical and High findings above
landing first — specifically C3 (tenant scoping must be real, tested code
before any business model exists) and H1 (the DI pattern must be
demonstrated correctly once, before five people independently guess at it
five different ways).

**Comfortable deploying this to production today?** No — but that's
expected and correct for a Phase 0 foundation with no business logic yet.
The real question is whether anything here is _actively wrong_ in a way
that causes rework later, and the honest answer is: two things (H2, H3)
are exactly that kind of landmine, both cheap to defuse now and expensive
to discover mid-Phase-4.
