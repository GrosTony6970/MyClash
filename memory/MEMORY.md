# MEMORY.md

> Persistent thematic memory for the AI agent working on MyClash.
>
> **Read this at the start of every session.** Update it whenever new project understanding emerges. Organized by theme, never by chronology. No duplication; merge similar info; remove obsolete info.
>
> See `AGENTS.md` for the maintenance protocol.

---

## Project identity

- **Name**: MyClash
- **Mission**: Free, open-source platform for HEMA (Historical European Martial Arts) event management and result publication.
- **License**: AGPL-3.0
- **Owner**: Project author (a HEMA practitioner / Solution Architect, based in Bessenay, FR; affiliated with Lyon AMHE).
- **Local repo path** (Windows, owner's machine): `F:\Github Repo\MyClash`
- **Remote repo**: https://github.com/GrosTony6970/MyClash (live, push to `main` directly — owner confirmed)
- **Production domain**: `myclash.fr` (confirmed; subdomains: `api.`, `admin.`, `scoring.`).
- **Production hosting**: OVH VPS (same provider as MyFAL — pattern reuse intended).
- **Authoritative spec**: `docs/ARCHITECTURE.md`.
- **Reference live beta** (companion app for Lyon AMHE's "Fosse aux Lions"): `https://myfal.lyonamhe.fr/` — confirms personas, "My Schedule" UX, push notifications.
- **Reference prior art**: hemaScorecard (https://github.com/SeanFranklin/hemaScorecard) — MyClash is _not_ a clone; key differentiators in `myclash.md`.
- **Reference deployment pattern**: `https://github.com/GrosTony6970/MyFAL` — owner's existing OVH VPS deployment to reuse where possible.

## Hierarchy & terminology (CRITICAL — see docs/HIERARCHY.md)

```
Organization → Event → Tournament → Phase → Match → Exchange
                  └── Workshop
```

- **Event** = the gathering (FAL 2026, Swordfish 2027). Has venue, dates, roster.
- **Tournament** = a competition within an event (Longsword Open). One weapon, one ruleset.
- **Workshop** = a teaching session within an event.
- Persons + Workshops are scoped to an Event. Registrations + Phases + Matches are scoped to a Tournament.
- Public app URLs: `app.myclash.fr/e/<event-slug>/t/<tournament-slug>`.
- Pre-v1.4 docs may use the old terminology where "Tournament" was the gathering — `docs/HIERARCHY.md` is authoritative; if anything conflicts with it, the HIERARCHY doc wins.

## Repo layout

- `memory/` — agent persistent memory (this folder). MEMORY.md, PROMPT_LOG.md, LESSONS_LEARNED.md, plus thematic notes in `memory/notes/`.
- `docs/` — project documentation (ARCHITECTURE.md, BUILD_ORDER.md, OWNER_TASKS.md, RUNBOOK.md, etc.).
- `infra/scripts/` — bash scripts that run **on the OVH VPS** (deploy, rollback, start, stop, refresh, status, destroy, backup, restore, vps-bootstrap). All source `infra/scripts/lib/log.sh`.
- `scripts/` — cross-platform Node scripts that run **on the developer's Windows machine** (e.g. `deploy.ts` SSH wrapper).
- `apps/` — three Next.js apps + NestJS api (and worker).
- `packages/` — shared workspaces (rulesets, db, ui, types, design-tokens, i18n, api-client).
- Root: `README.md`, `AGENTS.md`, `myclash.md`, `LICENSE`, `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.env.deploy.example`, `.gitattributes`.

Three files are intentionally at root: `README.md` (GitHub convention), `AGENTS.md` (so AI coders find it), `myclash.md` (product reference). Everything else is grouped by purpose.

## Deployment patterns (inherited from MyFAL)

The owner runs MyFAL on an OVH VPS using a proven pattern. MyClash deploy scripts and compose files inherit these conventions:

**Bash scripts (`infra/scripts/*.sh`):**

- Color-coded logging helpers (`ok`, `err`, `warn`, `hdr`) in `infra/scripts/lib/log.sh`, sourced by every script.
- `set -Eeuo pipefail` on every bash script.
- Explicit `docker compose --env-file .env -f infra/docker-compose.prod.yml ...` everywhere.
- `.env` validation before any operation; abort with helpful message if missing.
- Idempotent file initialization (`[[ -f X ]] || touch X`, `: > log.txt`).
- Health check loops (RETRIES × DELAY) with clear failure messages.
- Auto-generation of VAPID keys if missing in `.env`.

**Compose conventions:**

- Traefik 3.6.x, label-based routing, cert resolver named `letsencrypt`.
- ACME storage at `/data/acme.json` (production) or `/data/acme-staging.json` (`--dev-certs` overlay).
- TLS challenge via port 443 (`tlschallenge=true`).
- Container names: `myclash-<service>` (prefix from `COMPOSE_PROJECT_NAME=myclash`).
- Healthchecks: `node -e "require('http').get(...).on('error',()=>process.exit(1))"` — no curl/wget binary needed.
- Env vars: `DOMAIN` (singular), `LETSENCRYPT_EMAIL`, `TZ`, `COMPOSE_PROJECT_NAME`. Optional vars with `${VAR:-}` defaults.
- Volume mounts: `./data/<service>` for persistent state, `./logs/<service>` for logs.
- Logging: `json-file` driver, `max-size: 10m`, `max-file: 3` on every service.
- Shared compress middleware: `myclash-compress@docker`.

**MyClash additions beyond MyFAL:**

- Postgres migrations with abort-on-failure (MyFAL is JSON-file-backed, no migrations).
- `pg_dump` to `backups/pre-deploy/<timestamp>.sql.gz` before every deploy.
- `flock` on `.deploy.lock` (concurrent deploys impossible).
- Explicit `rollback.sh` script (restore DB + reset git).
- `.last-deploy.json` deploy metadata.
- Cross-platform Windows wrapper (`scripts/deploy.ts`) for `pnpm deploy:prod`.
- Multi-service stack (Postgres, Redis, Supabase services, NestJS api, worker, three Next.js apps) vs MyFAL's single Node app.

Trigger: manual deploy from the owner's Windows machine. No auto-deploy in v1.

## Identity model (two-tier)

**v1 ships without Google OAuth.** Magic-link auth only.

Three identity states:

- **Anonymous** — no cookie, public reads only. Can follow people via localStorage.
- **Guest** — typed their name, picked themselves from the organizer's roster, has a `guest_sessions` row + signed cookie. Bound to one Person. Can enroll workshops, mark favorites, follow people (server-side, this device), subscribe to push (this device only). Cannot edit, cannot use second device without re-picking name.
- **Claimed** — clicked a magic link sent to organizer-registered email. Joins `persons.claimed_by_user_id` to a Supabase `auth.users` row. Cross-device, can edit, can be promoted to global Fighter. Gets push notifications including for followed people.

Key invariants:

- Only the organizer creates Persons. Participants cannot self-register.
- Person uniqueness within an event: `(event_id, lower(email))`.
- Guest sessions sign with `MYCLASH_GUEST_JWT_SECRET`, distinct from Supabase secret. They can never escalate to Supabase tokens.
- `persons.claim_status` is one of: `unclaimed`, `guest_active`, `claimed`.
- The lookup endpoint masks email (`j***@g***.com`) and is rate-limited per IP.
- Fuzzy name search via Postgres `pg_trgm` on `unaccent(given_name)` and `unaccent(family_name)`.
- **On guest→claimed migration, follows transfer atomically** in the same transaction as the claim. User never loses their watchlist.

CSV import shape (organizer roster):

```
given_name,family_name,email,club,hema_ratings_id,event_codes,roles
```

Returns structured report with created/updated/duplicates/invalid/new_clubs.

## Following & public profiles

Anyone can search for any participant and view their public profile (schedule, results). Follows form a private "watchlist."

Privacy defaults:

- **Match schedule** + **referee assignments** + **workshop enrollments** are all public by default (they're part of the event's shared experience).
- **Email** is always masked publicly.
- A Person can opt out per category: `hide_workshops_publicly`, `allow_being_followed`.

Follow tiers:

- Anonymous → localStorage only, no notifications.
- Guest → server-stored, this device, no push.
- Claimed → server-stored, cross-device, push notifications when followed person's match starts (default 10 min lead, configurable per follow).

Follows are event-scoped (not global). The "watchlist view" at `/e/<eventSlug>/following` shows live state for all followed Persons.

## Architecture quick reference

- **Monorepo**: pnpm + Turborepo.
- **Stack**: Next.js 15 (3 apps) + NestJS + Postgres (via Supabase) + Redis + Drizzle ORM + Supabase Realtime + Auth + Storage.
- **Three frontends** (separate Next.js apps in monorepo):
  - `apps/web-public` — public/spectator/competitor PWA (mobile-first)
  - `apps/web-scoring` — scorekeeper PWA (tablet-first, **offline-first**)
  - `apps/web-admin` — organizer admin + super admin (desktop-first)
- **Deploy**: Docker Compose with Traefik. Hosted on a single OVH VPS for v1.
- **Realtime**: Supabase Realtime (Postgres LISTEN/NOTIFY). Read-side only.
- **Offline**: IndexedDB outbox (Dexie) on the scoring app. Idempotent server-side via `client_uuid`.

## Dev environment notes

- **Owner's local OS**: Windows (path `F:\Github Repo\MyClash`).
- **Implication**: Use cross-platform tooling. Avoid `bash`-only scripts at the repo root; prefer Node-based scripts (`scripts/*.ts` run via `pnpm`) so Windows + Linux + macOS work identically.
- **Line endings**: enforce LF via `.gitattributes` (`* text=auto eol=lf`) to prevent Windows-checkout corrupting Docker entrypoint shell scripts.
- **Scripts that _must_ be bash** (e.g. server-side deploy scripts running on the OVH VPS) live in `infra/scripts/` and are clearly labeled.
- **CI** runs on Ubuntu (GitHub Actions default).

## Domain language (HEMA-specific)

- **Lice**: a piste / fighting arena. Tournaments have multiple Lices running in parallel.
- **Pool**: a round-robin group; each fighter fights every other fighter in the pool.
- **Bracket**: elimination phase tree.
- **Exchange**: the atomic scoring unit (one engagement). Types: `clean`, `afterblow`, `double`, `no_exchange`.
- **Afterblow**: a retaliation strike landing within a window after being hit; partial credit for the receiver.
- **Double**: both fighters strike simultaneously; counts toward a penalty.
- **Workshop**: a teaching session running alongside the competition; first-class entity.
- **Referee roles** (3 distinct roles per pool):
  - `arbitre_declarant` — Lead/Director referee
  - `arbitre_assesseur` — Assessor referee
  - `arbitre_table` — Table referee (timing/scoring oversight)

## Personas (non-exclusive — a user can be several at once)

- **Competitor** — registered to fight in events
- **Referee** — qualified for one or more roles in this event
- **Workshop attendee** — enrolled in workshop sessions
- **Scorekeeper** — assigned to a Lice, records exchanges
- **Accompanist** — follows favorite fighters, no direct involvement
- **Public** — anonymous spectator
- **Organizer** — manages an event with one or more tournaments inside it (admin app)
- **Super admin** — platform-level (the project owner)

The unified **My Schedule** view aggregates all of a user's commitments and surfaces conflicts.

## TF_v1 ruleset (canonical)

- Score = `(Wins × 3 + TargetPoints) / (TimesHit + n(n−1)/3)` where n = double count.
- Tiebreakers: Wins desc → Doubles asc → TimesHit asc → Seed asc.
- Reference truth: `https://lyonamhe.fr/resultat_fal2026.html` (FAL 2026). The implementation **must** reproduce these published scores byte-for-byte. This is enforced by a golden test in `packages/rulesets/test/tf_v1.fal2026.test.ts`.
- Per-exchange data is the source of truth; aggregate scores are always derived.

## Pool population & referee assignment (v1 feature)

- Pool generation honors **school separation** (configurable) and **skill balance** (configurable, uses HEMA Ratings per-weapon → overall → seed → registration order).
- Referee assignment satisfies hard constraints (no fighter-referee overlap, qualification required) and configurable soft constraints (no back-to-back duties, dedicated-referee rest, workshop conflict warnings, rating-based ordering, workload balance).
- Each pool needs **3 referees**, one per role.
- Auto-assignment always returns a feasibility report: assigned cells, warnings, missing cells with rejection reasons.
- Manual override always available; warnings recompute live.
- Full spec: `docs/ARCHITECTURE.md` §11quater.

## Build progress (Phase P0 — completed 29-04-2026)

| Task                                                | Commit          | Status  |
| --------------------------------------------------- | --------------- | ------- |
| T-001 · Initialize monorepo                         | `e559a40`       | ✅ done |
| T-002 · ARCHITECTURE.md + BUILD_ORDER.md            | already in repo | ✅ done |
| T-003 · Scaffold three Next.js 15 apps              | `bd00faa`       | ✅ done |
| T-004 · Scaffold NestJS API                         | `5620cbe`       | ✅ done |
| T-005 · Shared package skeletons                    | `3e9c12d`       | ✅ done |
| T-006 · Docker Compose + Traefik + Postgres + Redis | `014a199`       | ✅ done |
| T-007 · Self-hosted Supabase services               | `03da7cf`       | ✅ done |
| T-008 · CI pipeline (GitHub Actions + CodeQL)       | `69e0429`       | ✅ done |
| T-009 · Auth integration (magic-link + /me)         | `43be026`       | ✅ done |
| T-009b · Organizer signup                           | `75d5995`       | ✅ done |
| T-009c · Super admin org management                 | `3e3f7c5`       | ✅ done |

## Build progress (Phase P0.5 — completed 29-04-2026)

| Task                                 | Commit    | Status  |
| ------------------------------------ | --------- | ------- |
| T-051..T-059 · Deployment automation | `38d5b10` | ✅ done |
| T-055 · VPS bootstrap (interactive)  | `13ffe57` | ✅ done |

## Build progress (Phase P1 — completed 29-04-2026)

| Task                                           | Commit    | Status  |
| ---------------------------------------------- | --------- | ------- |
| T-101 · DB schema (Drizzle)                    | `393fa0a` | ✅ done |
| T-102 · RLS policies                           | `a941f4f` | ✅ done |
| T-103 · Seed script                            | `55a118e` | ✅ done |
| T-104 · Persons CRUD + CSV import              | `d03f7e8` | ✅ done |
| T-104b · Person lookup (pg_trgm)               | `db2b296` | ✅ done |
| T-104c · Guest session module                  | `0690394` | ✅ done |
| T-104d · /api/v1/me unified identity           | `1c8481f` | ✅ done |
| T-104e · Fighters & Clubs API                  | `a9daf10` | ✅ done |
| T-105 · Organizations & Events/Tournaments API | `e00ae6a` | ✅ done |
| T-106 · Lices, Registrations API               | `d2a231d` | ✅ done |
| T-107 · API client scaffold                    | `2060b3c` | ✅ done |

## Build progress (Phase P2 — completed 29-04-2026)

| Task                                           | Commit    | Status  |
| ---------------------------------------------- | --------- | ------- |
| T-201 · Ruleset plugin contract                | `783303f` | ✅ done |
| T-202 · TF_v1 pure functions                   | `783303f` | ✅ done |
| T-203 · FAL 2026 fixture (aggregate fallback)  | `6f84ee1` | ✅ done |
| T-204 · TF_v1 golden test (115 tests)          | `6f84ee1` | ✅ done |
| T-205 · TF_v1_no_afterblow + Generic_PointsCap | `3897f73` | ✅ done |
| T-206 · Server-side scoring service            | `814013f` | ✅ done |

## Build progress (Phase P3 — completed 30-04-2026)

| Task                                                      | Commit    | Status  |
| --------------------------------------------------------- | --------- | ------- |
| T-301 · Pool generation (snake seeding + local search)    | `8a51abd` | ✅ done |
| T-301 · Pool size configuration (poolCount or targetSize) | `8a51abd` | ✅ done |
| T-302 · Berger table round-robin match generation         | `e250723` | ✅ done |
| T-303 · Single-elimination bracket                        | `d6eb633` | ✅ done |
| T-303 · Configurable bracket size                         | `d6eb633` | ✅ done |
| T-304 · Match-to-Lice scheduler                           | `87506b5` | ✅ done |
| T-305 · Phases API                                        | `709b429` | ✅ done |

## Build progress (Phase P4 — completed 01-05-2026)

| Task                                | Commit    | Status  |
| ----------------------------------- | --------- | ------- |
| T-401 · Scoring app shell           | `d781fa6` | ✅ done |
| T-402 · Match clock component       | `c758d60` | ✅ done |
| T-403 · Exchange entry UI           | `709b429` | ✅ done |
| T-404 · Realtime broadcast (server) | `fe15da0` | ✅ done |
| T-405 · Public live match view      | `520b903` | ✅ done |

## Build progress (Phase P5 — completed 01-05-2026)

| Task                                 | Commit    | Status  |
| ------------------------------------ | --------- | ------- |
| T-501 · IndexedDB outbox (Dexie)     | `b9b3c30` | ✅ done |
| T-502 · Service worker offline cache | `7454c0d` | ✅ done |
| T-503 · Sync engine                  | `7454c0d` | ✅ done |
| T-504 · Reconciliation               | `c1124cc` | ✅ done |
| T-505 · Sync status UI               | `c1124cc` | ✅ done |

## Build progress (Phase P6 — completed 01-05-2026)

| Task                                         | Commit    | Status  |
| -------------------------------------------- | --------- | ------- |
| T-601 · Design tokens + shared UI components | `214246b` | ✅ done |
| T-602 · Per-event theming engine             | `14019d7` | ✅ done |
| T-603 · Participant onboarding               | `50f672c` | ✅ done |
| T-604 · Persona-aware home                   | `fb2d517` | ✅ done |
| T-605 · Event detail + brackets + standings  | `3eef6f9` | ✅ done |
| T-606 · Lice live view                       | `d14c409` | ✅ done |
| T-607 · Fighter/Club pages                   | `d14c409` | ✅ done |
| T-608 · Public schedule endpoint             | `81fddce` | ✅ done |
| T-609 · Privacy preferences                  | `81fddce` | ✅ done |
| T-610 · Follows module                       | `362e2ba` | ✅ done |
| T-611 · People search/profile UI             | `362e2ba` | ✅ done |
| T-612 · Watchlist view                       | `0104d12` | ✅ done |

## Build progress (Phase P7 — completed 02-05-2026)

| Task                                        | Commit    | Status  |
| ------------------------------------------- | --------- | ------- |
| T-701 · Org dashboard + New Event wizard    | `673b9f7` | ✅ done |
| T-702 · Theme editor with live preview      | `327aa6e` | ✅ done |
| T-703 · Persons + registration management   | `66e8fe6` | ✅ done |
| T-704 · Pool & bracket management           | `22244a2` | ✅ done |
| T-705 · Manual exchange edit (audit-logged) | `a02a286` | ✅ done |
| T-706 · Schedule day-grid                   | `e8e9580` | ✅ done |

## Build progress (Phase P8 — completed 02-05-2026)

| Task                             | Commit    | Status  |
| -------------------------------- | --------- | ------- |
| T-801 · Workshops API            | `dfcad5d` | ✅ done |
| T-802 · Enrollment + waitlist    | `dfcad5d` | ✅ done |
| T-803 · Workshop public catalog  | `dba9dd9` | ✅ done |
| T-804 · Workshop admin           | `dba9dd9` | ✅ done |
| T-805 · My Schedule unified view | `e9b9242` | ✅ done |

## Build progress (Phase P9 — completed 02-05-2026)

| Task                                                  | Commit    | Status  |
| ----------------------------------------------------- | --------- | ------- |
| T-901 · Referee qualifications API                    | `f0b9961` | ✅ done |
| T-902 · Pool assignment settings                      | `f0b9961` | ✅ done |
| T-903 · Referee auto-assignment engine                | `3c42ceb` | ✅ done |
| T-903 · Hard constraint: no simultaneous pool overlap | `4e438a2` | ✅ done |
| T-904 · Pool populator API                            | `7bfbbec` | ✅ done |
| T-905 · Auto-assign referees endpoint                 | `7bfbbec` | ✅ done |
| T-906 · Referee admin UI                              | `7bfbbec` | ✅ done |
| T-907 · Pool populator UI                             | `3dcba59` | ✅ done |
| T-908 · Referee assignment UI                         | `3dcba59` | ✅ done |
| T-909 · Referee dashboard (public app)                | `7a47bbf` | ✅ done |
| T-910 · On-piste referee tools                        | `7a47bbf` | ✅ done |

## Build progress (Phase P10 — completed 02-05-2026)

| Task                                                       | Commit    | Status            |
| ---------------------------------------------------------- | --------- | ----------------- |
| T-1001 · Materialized views for fighter exchange stats     | `1a3dfbd` | ✅ done           |
| T-1002 · Tournament stats overview API                     | `1a3dfbd` | ✅ done           |
| T-1003 · Stats page UI (public)                            | `a811b8a` | ✅ done           |
| T-1004 · Exports — CSV / JSON / HEMA Ratings format        | `3b9aab8` | ✅ done           |
| T-1004 · fix: round labels (Gold Medal Match, Top 32, etc) | `4819dfd` | ✅ done           |
| T-1005 · PDF export                                        | —         | ⏭ skipped (user) |

## Build progress (Phase P11 — in progress)

| Task                                             | Commit    | Status  |
| ------------------------------------------------ | --------- | ------- |
| T-1101 · Daily sync job (BullMQ cron + snapshot) | `0fd14a3` | ✅ done |
| T-1102 · Search & link UI in registration        | `7a60caa` | ✅ done |
| T-1103 · HEMA Ratings on fighter profile         | `9ea2f80` | ✅ done |

## Build progress (Phase P12 — in progress)

| Task                                     | Commit    | Status  |
| ---------------------------------------- | --------- | ------- |
| T-1201 · VAPID + subscription endpoints  | `ff8958e` | ✅ done |
| T-1202 · Scheduled notification triggers | current   | ✅ done |
| T-1203 · Event-driven notifications      | —         | ⬜ next |

**Current HEAD**: current local `main`
**Repo**: https://github.com/GrosTony6970/MyClash (push to `main` directly — owner confirmed)
**Next task**: T-1203 · Event-driven notifications

## Tech decisions locked in during implementation

- **Email provider**: Resend (SDK, not SMTP). Sender: `noreply@myclash.fr` (domain verified in Resend). `RESEND_API_KEY` in `.env`.
- **Cookie signing**: `@fastify/cookie` with `COOKIE_SECRET` env var. Auth cookies: `sb-access-token` + `sb-refresh-token` (httpOnly, Secure, SameSite=Lax).
- **Rate limiting**: `@nestjs/throttler` — global 60/min/IP; auth endpoints 10/hour/IP.
- **Supabase URL in Docker**: `http://kong:8000` (internal network). In dev without Docker: `http://localhost:8000`.
- **Next.js**: `output: 'standalone'` set on all three apps for minimal Docker images.
- **ESLint**: flat config (`eslint.config.mjs`) at root + per-app configs with `parserOptions.project` for typed linting.
- **Vitest**: used for all unit tests. `passWithNoTests: true` on packages without tests yet (rulesets, etc.).
- **NestJS testing in Vitest**: use direct instantiation (`new Service(mockDep1, mockDep2)`) rather than `Test.createTestingModule()` — the NestJS DI container doesn't resolve `useValue` mocks reliably in Vitest without `emitDecoratorMetadata` being active in the test runner.

## Ruleset engine

- The `@myclash/rulesets` package must be **built** (`pnpm --filter @myclash/rulesets build`) before the API can typecheck against it. The API uses `moduleResolution: node` which resolves to `dist/`, not `src/`. In CI, the `build-packages` job runs before `typecheck`.
- The TF_v1 golden test (T-204) is sacred — if it fails, fix the engine, not the fixture. Two entries in the FAL 2026 fixture have `_published_score` notes where the source page shows a different value than the formula produces (rounding boundary artifacts at 1.545 and 1.645).
- `doublePenalty(0)` returns `-0` in JavaScript if implemented as `n*(n-1)/3`. Guard with `if (n <= 1) return 0` to avoid `-0 !== 0` test failures.

## Key env vars (canonical list — see .env.example for full list)

Required for the API to start:

- `SUPABASE_URL` — Kong gateway URL (`http://kong:8000` in Docker, `http://localhost:8000` in dev)
- `SUPABASE_ANON_KEY` — JWT signed with `SUPABASE_JWT_SECRET`, role=anon
- `SUPABASE_SERVICE_ROLE_KEY` — JWT signed with `SUPABASE_JWT_SECRET`, role=service_role
- `SUPABASE_JWT_SECRET` — ≥32 chars, used by GoTrue + PostgREST + NestJS
- `RESEND_API_KEY` — Resend API key (re_xxx...)
- `MAIL_FROM` — `noreply@myclash.fr`
- `COOKIE_SECRET` — 32-byte hex string for cookie signing
- `MYCLASH_GUEST_JWT_SECRET` — separate from Supabase secret
- `POSTGRES_PASSWORD` — Postgres password
- `DOMAIN` — `myclash.fr` in prod, `myclash.localhost` in dev
- `REDIS_HOST` — Redis host (default `localhost`; `redis` in Docker)
- `REDIS_PORT` — Redis port (default `6379`)
- `REDIS_PASSWORD` — optional; uncomment in `.env.example` if Redis requires auth

## Themes — see linked thematic notes when they exist

- _(none yet — when a topic grows beyond what fits here, create `docs/notes/<topic>.md` and link it here)_

- FAL 2026 raw per-exchange data: must be sourced by the project owner (see `docs/OWNER_TASKS.md` O-102). If unavailable, the golden test falls back to aggregate-level reproduction.
- HEMA Ratings export format: to be confirmed with HEMA Ratings maintainers (O-103).
- Beta event partner: TBD (O-104).

## Things explicitly out of scope for v1

- Multi-scorekeeper conflict resolution.
- Native mobile apps.
- Live video integration.
- AI-assisted refereeing.
- HEMA Ratings push API.

## Maintenance notes for the agent

- When you learn something durable about the project, decide:
  - Fits in one of the sections above? → update in place (merge, don't duplicate).
  - Doesn't fit and is small? → add a new section (with a clear thematic title).
  - Doesn't fit and is large? → create `docs/notes/<topic>.md` and link to it from the "Themes" section.
- When information becomes obsolete, **delete or correct it**. Stale memory is worse than no memory.
- Cross-check against `LESSONS_LEARNED.md` — if a piece of information represents a _rule_ the agent should follow, it belongs there, not here.

## Scheduling algorithms (Phase P3)

- **Pool generation** (`packages/rulesets/src/scheduling/`): snake seeding + local search. Accepts `poolCount` (explicit) or `targetSize` (e.g. 8 fighters/pool → auto-compute count). Default `targetSize=8`. Actual sizes balanced within ±1.
- **Berger tables** (`berger.ts`): circle method round-robin. `bergerSchedule(n, options)` → `BergerMatch[]`. Labels: `L{lice}-P{pool}-M{seq}`. Odd N handled with bye.
- **Single-elim bracket** (`single-elim.ts`): `singleElimBracket(n, options?)`. Default bracket size = next power of 2. Override with `options.bracketSize` (must be power of 2 and ≥ n). Standard seeding: 1 vs size, 2 vs size-1, etc. Byes protect top seeds.
- **Match-to-Lice scheduler** (`apps/api/src/modules/schedule/match-scheduler.ts`): pure function, no DB. Greedy earliest-slot algorithm. Respects `minRestMinutes` (default 10) per fighter. Balances load across Lices (imbalancePercent ≤ 5%). Returns `scheduledAt` + `estimatedEndAt` per match. Configurable: `minRestMinutes`, `defaultMatchDurationMinutes`, `startTime`, `transitionMinutes`.
- All scheduling functions are **pure** (no DB, no I/O) and **deterministic** (seeded PRNG for local search).
- Subpath export: `@myclash/rulesets/dist/scheduling/index` (API uses `moduleResolution: node` so must use dist path, not subpath export).
- **Phases API** (`apps/api/src/modules/phases/`): `POST /tournaments/:tournamentId/generate-pools` and `POST /tournaments/:tournamentId/generate-bracket`. Both idempotent (409 if exists, `?force=true` to regenerate). `PhasesModule` registered in `AppModule`.

## CI & formatting

- **Prettier is enforced at commit time** via lint-staged + simple-git-hooks. `prettier --write` runs automatically on all staged `*.ts/tsx/js/jsx/json/md/yml/yaml` files before every commit. After a fresh clone, `pnpm install` triggers the `prepare` script which re-registers the hook.
- **`format:check` is in CI** inside the `lint` job (runs after `pnpm turbo run lint`). It will always pass because files are formatted at commit time.
- **Never run a bulk `prettier --write` on the whole repo again** — it's now handled per-file at commit time. The one-time bulk pass (`5ad7900`) was the last time this was needed.
- **CI uses Node.js 24** — opted in via `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` in the workflow env to avoid deprecation warnings from GitHub Actions runners.

## Implementation notes (key decisions per task)

- **T-404 Realtime broadcast** (`packages/db/migrations/0004_realtime.sql`, `apps/api/src/modules/realtime/`): REPLICA IDENTITY FULL on exchanges/matches/match_events + idempotent addition to `supabase_realtime` publication. `Channels.*` factory functions for all 5 channel names. `RealtimeService` wraps `SupabaseService.service.channel().send()`. **Migration is numbered 0004** — BUILD_ORDER says 0003 but `0003_lookup_functions.sql` already existed.

- **T-405 Public live match view** (`apps/web-public/app/e/[eventSlug]/match/[matchId]/`): SSR server component + `MatchLiveView` client component subscribes to `postgres_changes` on `exchanges` + `matches` via Supabase Realtime. On reconnect (CLOSED→SUBSCRIBED), re-fetches REST API to catch missed changes. Supabase Realtime payloads use snake_case raw DB column names — conversion handled by `toExchangeRow()`.

- **T-401 Scoring app shell** (`apps/web-scoring/`): PWA with manifest, service worker stub, login page, Lice picker, network status bar.

- **T-402 Match clock** (`apps/web-scoring/src/components/MatchClock.tsx`, `apps/api/src/modules/matches/clock.service.ts`): clock state persisted as `match_events` rows. Reload-safe (recomputes from timeline). Drift correction on every render. Actions: start/halt/resume/end/reset_clock.

- **T-403 Exchange entry UI** (`apps/web-scoring/src/components/ExchangePad.tsx` → replaced by `ScoringPad.tsx`): tap-driven. Undo within 30s window (PATCH /exchanges/:id/void). Big buttons (min-h-[80px]) for glove use.

- **Afterblow scoring + ScoringPad** (outside BUILD_ORDER, added during P4): configurable afterblow mode (`full` | `deductive`) per tournament. `full` = both fighters score; `deductive` = only attacker scores but defender blow ALWAYS recorded in stats. Score buttons configurable per tournament (label, value, visibility). `ScoringPad` component replaced `ExchangePad` — buttons directly under each fighter, no choose-striker step. Clock guard: scoring blocked when clock is running; `clockTimeMs` recorded on each exchange. Types in `packages/types/src/scoring-config.ts`.

- **T-501–T-505 Offline sync** (`apps/web-scoring/`): IndexedDB outbox (Dexie), service worker, sync engine, reconciliation, sync status UI. Idempotent server-side via `client_uuid`.

- **T-601–T-612 Public app** (`apps/web-public/`): design tokens, theming engine, participant onboarding, persona-aware home, event detail + brackets + standings, lice live view, fighter/club pages, public schedule endpoint, privacy prefs, follows module, people search/profile, watchlist view.

- **T-701–T-706 Admin app** (`apps/web-admin/`): org dashboard, new event 4-step wizard, theme editor with live preview, persons + registration management, pool & bracket management with fighter/referee conflict detection, manual exchange edit (audit-logged), schedule day-grid.

- **T-801–T-805 Workshops** (`apps/api/src/modules/workshops/`): workshops API, enrollment + waitlist, workshop public catalog, workshop admin, My Schedule unified view.

- **T-901–T-910 Referees** (`apps/api/src/modules/referees/`): referee qualifications API, pool assignment settings, referee auto-assignment engine (pure function), pool populator API, auto-assign referees endpoint, referee admin UI, pool populator UI, referee assignment UI, referee dashboard (public app), on-piste referee tools. Hard constraint `enforce_fighter_referee_no_overlap` cannot be disabled — a fighter cannot referee a pool whose time overlaps with their match.

- **T-1001–T-1004 Stats + Exports**: materialized view `mv_fighter_exchange_stats` with separate blow/point tracking. `hit_ratio` is blow-based (mode-independent); `point_ratio` is point-based. HEMA Ratings CSV export: `fighters.csv` (Name, Club, Nationality, Gender empty, HEMA Ratings ID) + `{tournament-slug}.csv` (Fighter1, Fighter2, Result1, Result2, Round). Round labels: `Pools` / `Top 64` / `Top 32` / `Top 16` / `Quarter-finals` / `Semi-finals` / `Gold Medal Match` / `Bronze Medal Match` (Bronze checked before Final in label matching).

- **T-1101 HEMA Ratings sync** (`apps/api/src/workers/hema-ratings-sync.worker.ts`, `packages/db/migrations/0011_hema_ratings.sql`): BullMQ daily cron (03:30 UTC) scrapes `hemaratings.com/fighters/` HTML (no public API exists). Parses fighter name + club + numeric ID from href `/fighters/details/NNN/`. Stores full snapshot as JSONB in `hema_ratings_snapshots` table. `WorkersModule` registered in `AppModule`. Redis connection via `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`. Migration 0011 adds table + GIN full-text index + RLS policies (service_role write, authenticated read).

- **T-1102 HEMA Ratings registration link** (`apps/api/src/modules/hema-ratings/`, `apps/api/src/modules/registrations/`, `apps/web-admin/src/components/HemaRatingsSuggest.tsx`): admin registration modal searches latest HEMA Ratings snapshot and can select a profile. Registration creation always resolves a global Fighter: reuses existing `persons.global_fighter_id`, or creates a Fighter from Person data. If a HEMA Ratings profile is selected, `fighters.hema_ratings_id` is set; if not, Fighter is still created without a HEMA ID. Weighted Rating is weapon-category-specific and deferred to T-1103/enrichment.

- **T-1103 HEMA Ratings profile + seeding** (`apps/api/src/modules/hema-ratings/`, `apps/api/src/workers/hema-ratings-sync.worker.ts`, `apps/api/src/modules/phases/`, `apps/web-public/app/fighters/[slug]/page.tsx`): daily sync enriches only linked `fighters.hema_ratings_id` profiles by scraping detail pages. Profile data stores rating rows with weapon/category/rank/Weighted Rating/last competed in the latest snapshot JSON. Public fighter profiles show HEMA profile link, rating rows, and last synced. Pool generation and pool-populator use same-weapon, non-stale (<2 years) Weighted Rating as `skillRating`; category is displayed but ignored for seeding; stale/no-match ratings fall back to seed/bib/registration order.

- **T-1201 VAPID + notification subscriptions** (`scripts/ensure-vapid-env.mjs`, `infra/scripts/deploy.sh`, `apps/api/src/modules/notifications/`, `apps/web-public/app/notifications/`): deploy now checks both `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in `.env`; if either is missing/empty, it generates a new P-256 VAPID pair, updates existing `.env` keys in place, and ensures `VAPID_SUBJECT=mailto:${LETSENCRYPT_EMAIL}` by default. API exposes public `GET /api/v1/notifications/vapid-public-key`, authenticated `POST /api/v1/notifications/subscribe`, and authenticated `DELETE /api/v1/notifications/subscribe/:id`. Public `/notifications` registers `apps/web-public/public/sw.js`, asks browser permission, stores the Push subscription for claimed users, and can disable the browser subscription.

- **T-1202 Scheduled notification triggers** (`apps/api/src/workers/notification-scheduler.worker.ts`, `apps/api/src/modules/notifications/`, match/workshop/referee hooks): BullMQ queue `notification-scheduler` schedules delayed Web Push jobs with stable job IDs `notification:<kind>:<entityId>:<userId>` so schedule changes replace old jobs. Supported reminder kinds: `match_starting`, `workshop_starting`, `referee_starting`. Lead times come from `notification_preferences` (`match_starting_minutes_before`, `workshop_starting_minutes_before`, `referee_starting_minutes_before`) with defaults 10/15/10 minutes. `GET/PATCH /api/v1/notifications/preferences` exposes user preference configuration. Delivery uses `web-push` with VAPID keys and current `push_subscriptions`; email fallback remains deferred to T-1203.
