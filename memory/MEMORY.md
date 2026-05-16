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
- **Main-development push policy**: until the last planned feature is complete, the owner allows direct pushes to `main` for main development work. Keep commits atomic and verified before pushing.
- **Remote repo**: https://github.com/GrosTony6970/MyClash (live, push to `main` directly — owner confirmed)
- **Production domain**: `myclash.fr` (confirmed; subdomains: `api.`, `admin.`, `app.`, `scoring.`).
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
- `apps/web-marketing/` — static Caddy marketing site. Production Docker copies only `apps/web-marketing/public/`, so `public/index.html` is the canonical served homepage; keep root `index.html` only as the editable/source mirror unless the Dockerfile changes.
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
- `deploy.sh` may self-heal safe Debian prerequisites with confirmation (apt basics + Docker Engine/Compose), then validate/repair production `.env` before build/deploy.
- Production env automation may generate local secrets and Supabase JWT keys, but must prompt for provider-owned values such as domain/email/Resend/SMTP instead of inventing them.

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

Magic-link auth remains the baseline. Google OAuth is available as an additional auth method for organizer login/signup and Person claims, through self-hosted Supabase GoTrue.

Three identity states:

- **Anonymous** — no cookie, public reads only. Can follow people via localStorage.
- **Guest** — typed their name, picked themselves from the organizer's roster, has a `guest_sessions` row + signed cookie. Bound to one Person. Can enroll workshops, mark favorites, follow people (server-side, this device), subscribe to push (this device only). Cannot edit, cannot use second device without re-picking name.
- **Claimed** — clicked a magic link sent to organizer-registered email. Joins `persons.claimed_by_user_id` to a Supabase `auth.users` row. Cross-device, can edit, can be promoted to global Fighter. Gets push notifications including for followed people.

Google OAuth details:

- Google Cloud Authorized redirect URI points to the self-hosted GoTrue callback: `https://app.myclash.fr/auth/v1/callback`.
- App callback URLs such as `https://admin.myclash.fr/auth/oauth/callback`, `https://admin.myclash.fr/signup/oauth/callback`, and `https://app.myclash.fr/auth/oauth/callback` belong in `GOTRUE_URI_ALLOW_LIST`, not in Google Cloud.
- Organizer signup via Google creates only an organization owner account, same as the existing signup flow.
- Workshop attendees and instructors use the Person-claim flow; they must already exist as organizer-created Persons before OAuth can link them. Do not create free-floating workshop/instructor identities from Google alone.

Key invariants:

- Only the organizer creates Persons. Participants cannot self-register.
- Person uniqueness within an event: `(event_id, lower(email))`.
- Claimed users can change their Supabase login email and all their claimed `persons.email` rows through a new-email confirmation workflow. Requests are stored in `person_email_change_requests` with SHA-256 token hashes and one active pending request per user.
- Public claimed users can sign in outside event context at `app.myclash.fr/login` and land in the event-independent `/me` personal space. This is for existing Supabase users from claim/signup flows only; it does not create free-floating participant self-registration.
- Guest sessions sign with `MYCLASH_GUEST_JWT_SECRET`, distinct from Supabase secret. They can never escalate to Supabase tokens.
- Event staff local accounts use a separate `mc_staff` httpOnly cookie signed with `MYCLASH_STAFF_JWT_SECRET`; they are event-scoped username+PIN accounts for scoring tablets and can only score assigned Lices.
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
- Claimed users can edit their own global `fighters` profile metadata, structured club links, and weapon selections, but event-scoped `persons` roster rows remain organizer-controlled.
- Fighter `date_of_birth` is private: owner/admin APIs may return it, public Fighter profile/career endpoints must not expose it.
- Referee statistics are attached to claimed user identity, not only Fighter identity, so referee-only users can still view their private referee dashboard. Public Fighter pages can show summarized referee stats when a Fighter can be resolved to a claimed user. Card distribution stats are credited to the assigned `arbitre_declarant` for the match.

Follow tiers:

- Anonymous → localStorage only, no notifications.
- Guest → server-stored, this device, no push.
- Claimed → server-stored, cross-device, push notifications when followed person's match starts (default 10 min lead, configurable per follow).

Follows are event-scoped (not global). The "watchlist view" at `/e/<eventSlug>/following` shows live state for all followed Persons.

## Architecture quick reference

- **Monorepo**: pnpm + Turborepo.
- **Package manager**: pnpm 10.27.0 is the pinned toolchain for local, CI, and Docker builds; use `corepack pnpm ...` on Windows if an older global `pnpm` shim is still on PATH.
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
- **Pre-production gates** now enforce strict lint (`--max-warnings 0` for API + active web apps), high/critical `pnpm audit`, Vitest coverage (`pnpm coverage`), Playwright/Axe (`pnpm test:e2e`), Gitleaks, Trivy image scans, route/security/code-quality/DB/infra/observability reviews, and Phase 7 `pnpm perf:review` in CI. Local e2e uses `scripts/run-e2e.mjs` to manage Next dev server lifecycle on Windows because Playwright's built-in `webServer` teardown hung after tests passed. Current coverage thresholds are scoped to exercised implementation files (API excludes Nest structural files; web-scoring covers offline code), so all-files coverage remains a production-review follow-up decision.

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
| T-104f · Claimed Person email change workflow  | —         | ✅ done |
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

| Task                                                      | Commit    | Status              |
| --------------------------------------------------------- | --------- | ------------------- |
| T-301 · Pool generation (snake seeding + local search)    | `8a51abd` | ✅ done             |
| T-301 · Pool size configuration (poolCount or targetSize) | `8a51abd` | ✅ done             |
| T-302 · Berger table round-robin match generation         | `e250723` | ✅ done             |
| T-303 · Single-elimination bracket                        | `d6eb633` | ✅ done             |
| T-303 · Configurable bracket size                         | `d6eb633` | ✅ done             |
| T-303b · Arbitrary-size single-elim play-ins              | pending   | implemented locally |
| T-304 · Match-to-Lice scheduler                           | `87506b5` | ✅ done             |
| T-305 · Phases API                                        | `709b429` | ✅ done             |

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
| T-613 · Follow notifications scheduler       | `b51a05b` | ✅ done |

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

| Task                                     | Commit    | Status              |
| ---------------------------------------- | --------- | ------------------- |
| T-1201 · VAPID + subscription endpoints  | `ff8958e` | ✅ done             |
| T-1202 · Scheduled notification triggers | `8de77e2` | ✅ done             |
| T-1203 · Event-driven notifications      | `6326f05` | ✅ done             |
| T-1204 · Organizer event broadcasts      | pending   | implemented locally |
| T-1205 - Pool/bracket visibility publish | pending   | implemented locally |

## Build progress (Phase P13 - in progress)

| Task                           | Commit    | Status |
| ------------------------------ | --------- | ------ |
| T-1301 - Super admin dashboard | `777ac51` | done   |
| T-1302 - Fighter merge tool    | `e414bc3` | done   |
| T-1303 - Audit log UI          | `66b973a` | done   |
| T-1304 - Frozen results state  | `437d0c2` | done   |

## Build progress (Phase P14 - in progress)

| Task                         | Commit    | Status |
| ---------------------------- | --------- | ------ |
| T-1401 - Extract all strings | `cd036a1` | done   |
| T-1402 - French translation  | `bdec5bf` | done   |
| T-1403 - Accessibility pass  | `089518f` | done   |
| T-1404 - Performance pass    | pending   | done   |

**Current HEAD**: `089518f`
**Repo**: https://github.com/GrosTony6970/MyClash (push to `main` directly — owner confirmed)
**Next task**: T-1501 - Pre-event dry-run (`[needs O-201-O-206]`)

## Tech decisions locked in during implementation

- **Email provider**: Resend (SDK, not SMTP). Sender: `noreply@myclash.fr` (domain verified in Resend). `RESEND_API_KEY` in `.env`.
- **Cookie signing**: `@fastify/cookie` with `COOKIE_SECRET` env var. Auth cookies: `sb-access-token` + `sb-refresh-token` (httpOnly, Secure, SameSite=Lax).
- **Rate limiting**: `@nestjs/throttler` — global 60/min/IP; auth endpoints 10/hour/IP.
- **Supabase URL in Docker**: `http://kong:8000` (internal network). In dev without Docker: `http://localhost:8000`.
- **Next.js**: `output: 'standalone'` set on all three apps for minimal Docker images.
- **API Docker runtime image**: build shared workspace packages in Docker, install runtime dependencies in a separate prod-only stage, and do not copy full builder `node_modules` into the final image. This keeps pnpm/build tooling such as Vite/Vitest/esbuild out of production Trivy scans.
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
- **Single-elim bracket** (`single-elim.ts`): `singleElimBracket(n, options?)`. Default non-power-of-two fields use round-0 play-ins into the largest lower power-of-two main bracket (18 -> 16 main, 15v18 and 16v17 play-ins, seeds 1..14 direct). Exact powers stay standard. Explicit `options.bracketSize` keeps legacy power-of-two bye-slot behavior. Main elimination brackets are capped at 128 slots. Standard seeding: 1 vs size, 2 vs size-1, etc.
- **Match-to-Lice scheduler** (`apps/api/src/modules/schedule/match-scheduler.ts`): pure function, no DB. Greedy earliest-slot algorithm. Respects `minRestMinutes` (default 10) per fighter. Balances load across Lices (imbalancePercent ≤ 5%). Returns `scheduledAt` + `estimatedEndAt` per match. Configurable: `minRestMinutes`, `defaultMatchDurationMinutes`, `startTime`, `transitionMinutes`.
- All scheduling functions are **pure** (no DB, no I/O) and **deterministic** (seeded PRNG for local search).
- Subpath export: `@myclash/rulesets/dist/scheduling/index` (API uses `moduleResolution: node` so must use dist path, not subpath export).
- **Phases API** (`apps/api/src/modules/phases/`): `POST /tournaments/:tournamentId/generate-pools` and `POST /tournaments/:tournamentId/generate-bracket`. Both idempotent (409 if exists, `?force=true` to regenerate). `PhasesModule` registered in `AppModule`.

## CI & formatting

- **Prettier is enforced at commit time** via lint-staged + simple-git-hooks. `prettier --write` runs automatically on all staged `*.ts/tsx/js/jsx/json/md/yml/yaml` files before every commit. After a fresh clone, `pnpm install` triggers the `prepare` script which re-registers the hook.
- **`format:check` is in CI** inside the `lint` job (runs after `pnpm turbo run lint`). It will always pass because files are formatted at commit time.
- **Never run a bulk `prettier --write` on the whole repo again** — it's now handled per-file at commit time. The one-time bulk pass (`5ad7900`) was the last time this was needed.
- **CI uses Node.js 24** — opted in via `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` in the workflow env to avoid deprecation warnings from GitHub Actions runners.
- **Phase 2 security review remediation**: `docs/SECURITY_POSTURE.md` is the production-review security posture document. CI now runs `pnpm security:routes` to fail unclassified API controllers and `pnpm security:client-secrets` to fail server-only secret references in frontend source. API CORS is generated by `buildCorsOrigins()` and explicitly includes `app.${DOMAIN}`, `admin.${DOMAIN}`, `scoring.${DOMAIN}`, root domain, and localhost dev origins; no wildcard origin is used.

## Implementation notes (key decisions per task)

- **T-404 Realtime broadcast** (`packages/db/migrations/0004_realtime.sql`, `apps/api/src/modules/realtime/`): REPLICA IDENTITY FULL on exchanges/matches/match_events + idempotent addition to `supabase_realtime` publication. `Channels.*` factory functions for all 5 channel names. `RealtimeService` wraps `SupabaseService.service.channel().send()`. **Migration is numbered 0004** — BUILD_ORDER says 0003 but `0003_lookup_functions.sql` already existed.

- **T-405 Public live match view** (`apps/web-public/app/e/[eventSlug]/match/[matchId]/`): SSR server component + `MatchLiveView` client component subscribes to `postgres_changes` on `exchanges` + `matches` via Supabase Realtime. On reconnect (CLOSED→SUBSCRIBED), re-fetches REST API to catch missed changes. Supabase Realtime payloads use snake_case raw DB column names — conversion handled by `toExchangeRow()`.

- **T-401 Scoring app shell** (`apps/web-scoring/`): PWA with manifest, service worker stub, login page, Lice picker, network status bar.

- **T-402 Match clock** (`apps/web-scoring/src/components/MatchClock.tsx`, `apps/api/src/modules/matches/clock.service.ts`): clock state persisted as `match_events` rows. Reload-safe (recomputes from timeline). Drift correction on every render. Actions: start/halt/resume/end/reset_clock.

- **T-403 Exchange entry UI** (`apps/web-scoring/src/components/ExchangePad.tsx` → replaced by `ScoringPad.tsx`): tap-driven. Undo within 30s window (PATCH /exchanges/:id/void). Big buttons (min-h-[80px]) for glove use.

- **Afterblow scoring + ScoringPad** (outside BUILD_ORDER, added during P4): configurable afterblow mode (`full` | `deductive`) per tournament. `full` = both fighters score; `deductive` = only attacker scores but defender blow ALWAYS recorded in stats. Score buttons configurable per tournament (label, value, visibility). `ScoringPad` component replaced `ExchangePad` — buttons directly under each fighter, no choose-striker step. Clock guard: scoring blocked when clock is running; `clockTimeMs` recorded on each exchange. Types in `packages/types/src/scoring-config.ts`.

- **T-501–T-505 Offline sync** (`apps/web-scoring/`): IndexedDB outbox (Dexie), service worker, sync engine, reconciliation, sync status UI. Idempotent server-side via `client_uuid`.

- **T-601–T-612 Public app** (`apps/web-public/`): design tokens, theming engine, participant onboarding, persona-aware home, event detail + brackets + standings, lice live view, fighter/club pages, public schedule endpoint, privacy prefs, follows module, people search/profile, watchlist view.

- **T-613 Follow notification scheduler** (`apps/api/src/workers/follow-notification-scheduler.worker.ts`, `apps/api/src/modules/follows/`, `apps/api/src/modules/matches/`): when a match is scheduled or rescheduled, MyClash enqueues delayed notification jobs for claimed followers of the red/blue Persons with `notify_match_start=true`. Jobs use stable IDs `follow:match_starting:<matchId>:<followerUserId>` and replace old pending jobs on reschedule. Guests are ignored because they have no cross-device push. Unfollowing as a claimed user cancels pending match-start jobs for that followed Person. The follows service now uses the actual DB column names: `followed_person_id`, `follower_user_id`, `follower_guest_session_id`, `created_at`.

- **T-701–T-706 Admin app** (`apps/web-admin/`): org dashboard, new event 4-step wizard, theme editor with live preview, persons + registration management, pool & bracket management with fighter/referee conflict detection, manual exchange edit (audit-logged), schedule day-grid.

- **T-801–T-805 Workshops** (`apps/api/src/modules/workshops/`): workshops API, enrollment + waitlist, workshop public catalog, workshop admin, My Schedule unified view.

- **T-901–T-910 Referees** (`apps/api/src/modules/referees/`): referee qualifications API, pool assignment settings, referee auto-assignment engine (pure function), pool populator API, auto-assign referees endpoint, referee admin UI, pool populator UI, referee assignment UI, referee dashboard (public app), on-piste referee tools. Hard constraint `enforce_fighter_referee_no_overlap` cannot be disabled — a fighter cannot referee a pool whose time overlaps with their match.

- **T-1001–T-1004 Stats + Exports**: materialized view `mv_fighter_exchange_stats` with separate blow/point tracking. `hit_ratio` is blow-based (mode-independent); `point_ratio` is point-based. HEMA Ratings CSV export: `fighters.csv` (Name, Club, Nationality, Gender empty, HEMA Ratings ID) + `{tournament-slug}.csv` (Fighter1, Fighter2, Result1, Result2, Round). Round labels: `Pools` / `Top 64` / `Top 32` / `Top 16` / `Quarter-finals` / `Semi-finals` / `Gold Medal Match` / `Bronze Medal Match` (Bronze checked before Final in label matching).

- **T-1101 HEMA Ratings sync** (`apps/api/src/workers/hema-ratings-sync.worker.ts`, `packages/db/migrations/0011_hema_ratings.sql`): BullMQ daily cron (03:30 UTC) scrapes `hemaratings.com/fighters/` HTML (no public API exists). Parses fighter name + club + numeric ID from href `/fighters/details/NNN/`. Stores full snapshot as JSONB in `hema_ratings_snapshots` table. `WorkersModule` registered in `AppModule`. Redis connection via `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`. Migration 0011 adds table + GIN full-text index + RLS policies (service_role write, authenticated read).

- **T-1102 HEMA Ratings registration link** (`apps/api/src/modules/hema-ratings/`, `apps/api/src/modules/registrations/`, `apps/web-admin/src/components/HemaRatingsSuggest.tsx`): admin registration modal searches latest HEMA Ratings snapshot and can select a profile. Registration creation always resolves a global Fighter: reuses existing `persons.global_fighter_id`, or creates a Fighter from Person data. If a HEMA Ratings profile is selected, `fighters.hema_ratings_id` is set; if not, Fighter is still created without a HEMA ID. Weighted Rating is weapon-category-specific and deferred to T-1103/enrichment.

- **T-1103 HEMA Ratings profile + seeding** (`apps/api/src/modules/hema-ratings/`, `apps/api/src/workers/hema-ratings-sync.worker.ts`, `apps/api/src/modules/phases/`, `apps/web-public/app/fighters/[slug]/page.tsx`): daily sync enriches only linked `fighters.hema_ratings_id` profiles by scraping detail pages. Profile data stores rating rows with weapon/category/rank/Weighted Rating/last competed in the latest snapshot JSON. Public fighter profiles show HEMA profile link, rating rows, and last synced. Pool generation and pool-populator use same-weapon, non-stale (<2 years) Weighted Rating as `skillRating`; category is displayed but ignored for seeding; stale/no-match ratings fall back to seed/bib/registration order.

- **T-1201 VAPID + notification subscriptions** (`scripts/ensure-vapid-env.mjs`, `infra/scripts/deploy.sh`, `apps/api/src/modules/notifications/`, `apps/web-public/app/notifications/`): deploy now checks both `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in `.env`; if either is missing/empty, it generates a new P-256 VAPID pair, updates existing `.env` keys in place, and ensures `VAPID_SUBJECT=mailto:${LETSENCRYPT_EMAIL}` by default. API exposes public `GET /api/v1/notifications/vapid-public-key`, authenticated `POST /api/v1/notifications/subscribe`, and authenticated `DELETE /api/v1/notifications/subscribe/:id`. Public `/notifications` registers `apps/web-public/public/sw.js`, asks browser permission, stores the Push subscription for claimed users, and can disable the browser subscription.

- **T-1202 Scheduled notification triggers** (`apps/api/src/workers/notification-scheduler.worker.ts`, `apps/api/src/modules/notifications/`, match/workshop/referee hooks): BullMQ queue `notification-scheduler` schedules delayed Web Push jobs with stable job IDs `notification:<kind>:<entityId>:<userId>` so schedule changes replace old jobs. Supported reminder kinds: `match_starting`, `workshop_starting`, `referee_starting`. Lead times come from `notification_preferences` (`match_starting_minutes_before`, `workshop_starting_minutes_before`, `referee_starting_minutes_before`) with defaults 10/15/10 minutes. `GET/PATCH /api/v1/notifications/preferences` exposes user preference configuration. Delivery uses `web-push` with VAPID keys and current `push_subscriptions`.

- **T-1203 Event-driven notifications** (`apps/api/src/modules/notifications/event-handlers/`, `apps/api/src/workers/notification-scheduler.worker.ts`): immediate BullMQ jobs use the same queue with stable IDs `notification:<kind>:<entityId>:<userId>` and delay 0. Supported event kinds: `assignment_changed`, `workshop_cancelled`, `waitlist_promoted`, `results_published`. Delayed reminders replace old jobs, but immediate events suppress duplicates while completed jobs remain in BullMQ for 24h. Worker delivery uses push when enabled and subscriptions exist; otherwise event jobs with an email address fall back to `MailService.sendNotification`. Hooks: referee assignment lock sends assignment-changed + delayed referee reminder, workshop waitlist promotion sends promotion notice, session status `cancelled` sends cancellation notices, and tournament status `completed` sends results-published notices.

- **T-1204 Organizer event broadcasts** (`packages/db/migrations/0021_event_broadcast_notifications.sql`, `apps/api/src/modules/notifications/broadcast-notifications.*`, `apps/web-admin/app/org/[slug]/events/[eventId]/notifications/`, `apps/web-public/app/notifications/`): organizers with admin+ role can send immediate event broadcasts to all event Persons, fighters, referees, or selected Persons. Broadcasts persist durable history (`event_broadcast_notifications`, `event_broadcast_recipients`) with severity `info|warning|alert`; claimed recipients get push first and disabled/no-subscription/unclaimed recipients use bilingual email fallback. Public `/notifications` now shows claimed-user broadcast history.

- **T-1205 Pool/bracket visibility publishing** (`packages/db/migrations/0022_phase_visibility.sql`, `apps/api/src/modules/phases/`, `apps/api/src/modules/persons/public-schedule.service.ts`, `apps/api/src/modules/events/`, `apps/web-admin/app/org/[slug]/events/[eventId]/{pools,bracket,notifications}/`): generated pool and bracket phases default to hidden while existing phases are backfilled as published. Public/participant reads hide unpublished phase data, while organizer/admin surfaces can still manage it. Admin+ organizers can publish/unpublish phases; unpublishing after running/paused/completed matches requires confirmation and audit logging. Publish actions expose editable tournament-scoped broadcast drafts for fighters+referees.

- **T-1301 Super admin dashboard** (`apps/api/src/modules/admin/`, `apps/web-admin/app/admin/`, `packages/db/migrations/0001_init.sql`): extends the T-009c super-admin org surface with an explicit organization approve alias, Supabase Auth admin user disable/enable, metadata-only community ruleset moderation, and platform feature flags. New tables: `ruleset_submissions` and `feature_flags`, both super-admin-only via RLS. Community ruleset approval does not execute submitted code; runtime registration remains a code/deploy process.

- **T-1302 Fighter merge tool** (`apps/api/src/modules/fighters/merge.service.ts`, `apps/web-admin/app/admin/fighters/`, `packages/db/migrations/0012_fighter_merge.sql`): super-admin-only fighter merge now soft-deletes source profiles with `merged_into_fighter_id`, `merged_at`, `deleted_at`, and `merge_reverted_at`, moves Person/Registration/workshop instructor references to the kept Fighter, fills blank target profile fields from source, and stores undo snapshots in `audit_log.payload_json`. Revert is audit-driven and allowed for 30 days. The old hard-delete merge endpoint is replaced by guarded controller routes.

- **T-1303 Audit log UI** (`apps/api/src/modules/admin/admin-audit-log.service.ts`, `apps/web-admin/app/admin/audit-log/`, `packages/db/migrations/0013_audit_log_indexes.sql`): super-admin audit log viewer reads existing `audit_log` rows with exact actor/action/entity type/date filters, server-side pagination, and CSV export capped at 5000 rows. API routes live under `/api/v1/admin/audit-log` and are guarded by `SuperAdminGuard`; no new audit-history table was added.

- **T-1304 Frozen results state** (`apps/api/src/modules/matches/frozen-results.guard.ts`, `apps/api/src/modules/admin/exchange-edit-requests.*`, `apps/web-admin/app/admin/exchange-edit-requests/`, `packages/db/migrations/0014_exchange_edit_requests.sql`): event results freeze when `events.status = 'completed'`. Organizer void/revert exchange actions become `exchange_edit_requests` pending super-admin review; new exchange creation after freeze returns conflict. Super-admin approval applies stored void/revert and recomputes scores; rejection stores reason, audits, and sends `exchange_edit_rejected` notification.

- **T-1305 Super-admin AI data quality assistant** (`apps/api/src/modules/admin/platform-ai-settings.*`, `apps/api/src/modules/admin/ai-data-quality.*`, `apps/web-admin/app/admin/{ai-settings,data-quality}/`, `packages/db/migrations/0030_super_admin_ai_data_quality.sql`): super-admin AI tools use a shared platform BYOK key in `platform_ai_settings`, separate from organizer `organization_ai_settings`. Manual scans create deterministic duplicate/global identity candidates first, send minimized evidence to the configured provider for strict-JSON ranking, persist review-only findings with stable fingerprints, and log usage in `platform_ai_usage_log` with `feature = 'super_admin_data_quality'`.
- **T-1213 Organizer AI tournament setup assistant** (`apps/api/src/modules/organizer-ai-assistant/`, `apps/web-admin/app/org/[slug]/events/[eventId]/ai-assistant/`, `packages/db/migrations/0031_organizer_ai_assistant.sql`): organizer AI tools use organization BYOK plus event spend caps, never the super-admin platform key. V1 is draft-and-review only: strict-JSON AI drafts persist proposed actions for tournament config, pools, brackets, match-grid schedule, and referee assignments, then organizers apply them through existing deterministic services.
- **T-1214 Natural-language tournament query** (`apps/api/src/modules/tournament-query/`, `apps/web-admin/app/org/[slug]/events/[eventId]/TournamentQueryPanel.tsx`, `packages/db/migrations/0033_tournament_query.sql`): organizer tournament queries use organization BYOK plus event spend caps, never the super-admin platform key. The LLM only selects one typed whitelisted read-only tool; deterministic backend handlers query tournament-scoped views for fighters, matches, pools, lices, referees, schedule status, and rankings. English and French questions/suggested prompts are supported.

- **T-1401 Extract all strings** (`packages/i18n/`, `eslint-rules/no-literal-string.mjs`, all frontend app layouts): shared i18n runtime exports `Locale`, `defaultLocale`, English/French fallback message trees, `getMessages`, `createTranslator`, and default `t`. Frontend roots now set `html lang` from i18n, wrap children in app-local `I18nProvider`, and use message keys for static metadata. Hardcoded JSX/string-prop lint is enforced in all three frontend apps through a local ESLint rule with a committed baseline for pre-existing literals; new unbaselined JSX text or watched props fail lint.

- **T-1402 French translation** (`packages/i18n/src/index.ts`): replaced `fr = en` alias with full French object reviewed by the native-speaking project author. HEMA → AMHE in French copy (`événements d'AMHE`). `Messages` type changed from `typeof en` (literal string types due to `as const`) to `DeepString<typeof en>` — a mapped type that relaxes leaf types to `string` while preserving key structure — so `fr satisfies Messages` compiles without requiring exact English string literals. `defaultLocale` remains `'en'`. Key-parity enforced at build time via existing `collectKeys` assertion in `index.test.ts`.

- **T-1403 Accessibility pass** (`tests/a11y/`, `apps/web-scoring/app/offline/page.tsx`, `apps/web-public/app/e/[eventSlug]/page.tsx`): Playwright/Axe coverage now checks the five critical BUILD_ORDER flows with color contrast enabled, page/console error capture, and keyboard assertions for skip links and representative controls. Fixed the scoring offline page runtime error by making it a client component and moving offline strings into `@myclash/i18n`; the event placeholder main is focusable for skip-link activation.
- **T-1404 / Phase 7 Performance pass** (`docs/PERFORMANCE_REVIEW.md`, `scripts/check-performance-review.mjs`, `scripts/check-bundle-budgets.mjs`, `scripts/perf-load-smoke.mjs`, `tests/perf/`): repo-local checks cover SQL query review classification, DB EXPLAIN workload presence, bundle budget tooling, Playwright LCP/CLS smoke checks for public/admin/scoring shells, and configurable load-test tooling. Live p95, full load-test, `pg_stat_statements`, and real INP evidence remain owner-side sign-off items.

- **Super admin system versions** (`apps/api/src/modules/admin/system-versions.*`, `apps/web-admin/app/admin/system-versions/`, `scripts/generate-system-versions.mjs`): super admins can view app/workspace/framework/container/infrastructure versions at `/admin/system-versions`. Deploy writes `data/system-versions.json` from `VERSION`, package manifests, compose image tags, and deploy commit metadata; the API mounts it read-only and falls back to repo files in local dev. No Docker socket is exposed.

- **Super admin backup management** (`apps/api/src/modules/admin/backups.*`, `apps/web-admin/app/admin/backups/`, `infra/ops-runner/`): super admins can view local/S3 backup inventory, trigger backups, download artifacts, upload backup files for staging, and start confirmation-gated restores at `/admin/backups`. Destructive host-level work is isolated in the internal `ops-runner` service with `OPS_RUNNER_SECRET`; the public API talks to it over the private Docker network and does not mount the Docker socket.

- **Organizer event/tournament archives** (`apps/api/src/modules/exports/archive.*`, `apps/web-admin/app/org/[slug]/events/[eventId]/archive/`): organization admins can export event or tournament archives as JSON or ZIP bundles with optional scoring data, download tournament CSV reports, preview uploaded archives, and restore them as new copies after typing `RESTORE MYCLASH ARCHIVE`. Organizer archives are app-data archives only; platform/server backup remains super-admin-only.

- **League / Tournois Federal** (`apps/api/src/modules/leagues/`, `packages/db/migrations/0015_leagues.sql`, `apps/web-admin/app/admin/leagues/`, `apps/web-public/app/leagues/`): cross-event yearly leagues aggregate approved tournament contributions by global Fighter ID. Scoring supports `ffamhe_tf_2026` (`max(0, 17 - rank)`) and custom rank-to-points tables, with whitelisted tie-breakers. Organizer tournament attachment is request/approval based; official recomputation runs on event completion and persists league standings for fast admin/public reads.

- **Penalty Management / Cartons** (`packages/rulesets/src/penalties/`, `apps/api/src/modules/penalties/`, `packages/db/migrations/0016_penalties.sql`, `apps/web-scoring/src/components/PenaltyPanel.tsx`): penalty rulesets are first-class event/tournament configuration. Built-in `ffamhe_tf_2026` is seeded from `ffamhe_tf_2026.csv`; custom rulesets can be imported from CSV. Match penalties are immutable timeline rows with `client_uuid`; red cards derive a `-1` score delta, black cards complete the match with the opponent as winner, and the second black card creates a pending tournament review for organizer confirmation.
- **Forfeit / forfait workflow** (`packages/rulesets/src/forfeits.ts`, `apps/api/src/modules/matches/match-forfeits.service.ts`, `packages/db/migrations/0032_match_forfeits.sql`): forfeits are durable match outcome rows, not fake exchanges. TF/FFAMHE defaults: injury keeps current points and asks can-continue; voluntary and first black card are 0-6 and ask can-continue; second black card and conduct/violence are 0-6 and disqualify. `canContinue=false` in pools auto-forfeits later unstarted matches; bracket play-ins and round 2+ walk over; main bracket round 1 can pull the next eligible pool non-qualifier before match start. Voiding is allowed only before downstream dependent matches start.

## Production review gates

- Phase 3 code quality adds committed gates: `pnpm quality:todos`, `pnpm quality:api-docs`, `pnpm quality:complexity`, and `pnpm quality:shared-types`. CI runs them after lint.
- API errors are normalized through a global NestJS exception filter returning `{ statusCode, code, message, details?, path, method, timestamp, requestId? }`.
- API bootstrap registers process-level logging for unhandled promise rejections and uncaught exceptions; uncaught exceptions fail fast after logging.
- Complexity hotspots are accepted for v1 only through `docs/code-quality-complexity-baseline.json`; new unreviewed files over 400 lines or functions over 50 lines fail the quality gate.
- Phase 4 database review adds `pnpm db:review`, `pnpm db:perf:fixture`, live `pnpm db:migrations:replay`, and live `pnpm db:perf:explain`. Rollback policy is PITR/restore via backup/restore scripts, not down migrations; PgBouncer is deferred for v1 unless connection pressure appears.
- Phase 5 infrastructure review is scoped to production containers plus Traefik edge/TLS because VPS hardening is owner-confirmed done. `pnpm infra:review` is the repo-local gate; live `pnpm infra:edge -- --domain myclash.fr` records redirect/TLS/HSTS evidence after deploy. Digest pinning remains a known issue unless registry access is available to pin `tag@sha256`.
- Self-hosted Supabase Realtime uses `_realtime` for internal Ecto metadata. Compose must set `DB_AFTER_CONNECT_QUERY='SET search_path TO _realtime'`, provide `DB_ENC_KEY` from `SUPABASE_REALTIME_DB_ENC_KEY`, and provision `_realtime` via DB init plus migration so existing volumes and fresh volumes both work.
- Phase 6 observability uses Sentry Cloud plus external uptime monitoring. `pnpm observability:review` checks Sentry env/doc/wiring prerequisites; API logs JSON request events with redaction and captures 5xx/process failures to Sentry when `SENTRY_DSN_API` is set. Next apps have per-app Sentry DSNs. Production sign-off still needs owner DSNs, uptime checks, and staging Sentry smoke-test evidence.
