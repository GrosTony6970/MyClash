# MyClash — Architecture & Build Specification

> **Free, open-source platform for managing and publishing results of Historical European Martial Arts (HEMA) events.**
>
> This document is the master architectural reference for MyClash. It is written to be both human-readable and consumable by an AI coding agent (Claude Code, Cursor, Aider) as the project's anchor specification.
>
> **Companion docs:**
>
> - `myclash.md` (root) — functional/design understanding of the app (product-level).
> - `CLAUDE.md` (root) — the agent contract: hard rules, which docs are authoritative, workflow, verification.
> - `DESIGN.md` (root) — canonical UI design language.
> - `docs/ENGINEERING_LESSONS.md` — reusable rules distilled from past mistakes, by area.
>
> **Status:** Draft v1.4 · **Owner:** Project author · **License:** AGPL-3.0
> **Production domain:** `myclash.fr`

---

## Table of Contents

Every `##` section appears here. Sections are cited elsewhere by number (`§14`), so the numbering is
a contract: **renumber an existing section only after repointing every citation to it.** The
`bis`/`ter`/`quater` suffixes mark sections inserted after their neighbours were already cited —
ugly, but cheaper than renumbering. Append new sections at the end instead.

- [1. Project Overview](#1-project-overview)
- [2. Product Surfaces](#2-product-surfaces)
- [3. Tech Stack & Rationale](#3-tech-stack--rationale)
- [4. High-Level System Architecture](#4-high-level-system-architecture)
- [5. Data Model](#5-data-model)
- [6. TF_v1 Ruleset Specification](#6-tf_v1-ruleset-specification)
- [7. Scoring Engine & Ruleset Plugin System](#7-scoring-engine--ruleset-plugin-system)
- [7bis. Ruleset authoring, sharing and pinning](#7bis-ruleset-authoring-sharing-and-pinning)
- [8. Statistics Module](#8-statistics-module)
- [8bis. The League (cross-event standings)](#8bis-the-league-cross-event-standings)
- [9. Real-Time Architecture](#9-real-time-architecture)
- [10. Offline-First Scoring (PWA + IndexedDB)](#10-offline-first-scoring-pwa--indexeddb)
- [11. HEMA Ratings Integration](#11-hema-ratings-integration)
- [11bis. Workshops Module](#11bis-workshops-module)
- [11ter. Push Notifications](#11ter-push-notifications)
- [11quater. Pool Population & Referee Assignment](#11quater-pool-population--referee-assignment)
- [11sexies. Bracket Auto-Advance](#11sexies-bracket-auto-advance)
- [11quinquies. Following & Public Profiles](#11quinquies-following--public-profiles)
- [12. Authentication & Identity](#12-authentication--identity)
- [13. Per-Event Theming](#13-per-event-theming)
- [14. API Surface](#14-api-surface)
- [15. Frontend Routes](#15-frontend-routes)
- [16. Internationalization](#16-internationalization)
- [17. Deployment (Docker Compose + Traefik)](#17-deployment-docker-compose--traefik)
- [18. Repository Structure (Monorepo)](#18-repository-structure-monorepo)
- [19. Development Roadmap](#19-development-roadmap)
- [20. Conventions & Standards](#20-conventions--standards)
- [21. AI Coder Instructions](#21-ai-coder-instructions)
- [22. Open Questions / Future Work](#22-open-questions--future-work)
- [23. Referee Financial Compensation (T-1209)](#23-referee-financial-compensation-t-1209)
- [24. Event Schedule Planner (T-1210)](#24-event-schedule-planner-t-1210)
- [25. Live Schedule View (T-1211)](#25-live-schedule-view-t-1211)
- [26. AI Infrastructure (T-1212)](#26-ai-infrastructure-t-1212)

---

## 1. Project Overview

### 1.1 Mission

MyClash is a free, open-source platform that lets any HEMA event organizer:

- Create and run tournaments end-to-end (registration → pools → eliminations → publication).
- Score matches at the piste (called **Lice**) with per-exchange granularity, even on flaky venue wifi.
- Publish live results, brackets, rankings, and rich post-event statistics.
- Offer a per-event public-facing experience (themed mini-app) for spectators and competitors.

It replaces the workflow people currently piece together with `hemaScorecard` + spreadsheets + static HTML pages (cf. `https://lyonamhe.fr/resultat_fal2026.html`).

### 1.2 Why this is not a clone of hemaScorecard

|              | hemaScorecard         | MyClash                                                                                         |
| ------------ | --------------------- | ----------------------------------------------------------------------------------------------- |
| Scoring      | Per-match final score | Per-exchange (every clean hit, afterblow, double captured)                                      |
| Statistics   | Pool standings only   | Full exchange-level analytics, target zones, double-rate evolution, "deep hunters" leaderboards |
| Public app   | None (HTML export)    | Per-event themed PWA with 3 personas (Competitor / Accompanist / Public)                        |
| Mobile       | Desktop-first         | Mobile-first PWA, installable                                                                   |
| Live         | Manual refresh        | Realtime broadcast (sub-second)                                                                 |
| Offline      | None                  | Scoring tablet works fully offline, syncs on reconnect                                          |
| Identity     | Per-event             | Global fighter profiles, linkable to HEMA Ratings                                               |
| Multi-tenant | Single-event install  | Platform with per-event theming                                                                 |

### 1.3 Constraints

- **Free for organizers and competitors.** No paywalled features.
- **Self-hostable.** Single `docker compose up`.
- **Open source.** Public Git repository.
- **No vendor lock-in.** Standard Postgres, no proprietary cloud services in the critical path.

---

## 2. Product Surfaces

MyClash is **five distinct surfaces** sharing one backend:

### 2.1 Public/Spectator App (PWA, mobile-first)

Per-event themed (logo, colors, history pages, club directory). Personas chosen during onboarding — **non-exclusive: a single user can be Competitor + Referee + Workshop Attendee simultaneously**. The "My Schedule" view aggregates whichever apply.

- **Competitor** — "my next match", "my pool standings", "my results", "where I need to be".
- **Referee** — today's assigned matches, my piste schedule, on-piste tools (start clock, call halt/warning, request scorekeeper attention).
- **Workshop Attendee** — selected workshops, capacity status, conflicts with my matches/refereeing.
- **Accompanist** — follow favorite fighters, live tracking on multiple Lices.
- **Public** — discover HEMA, event editorial, schedule, club directory.

The **"My Schedule"** view is the unified personal view (matches the beta companion app at `https://myfal.lyonamhe.fr/`). It overlays:

- My fights (as competitor)
- My refereeing assignments
- My selected workshops
- Conflict markers when any two overlap
- Day filter (Saturday/Sunday)
- "Focus on me" vs "Show all" toggle

Reference design: the prototype HTML (Cinzel + Inter typography, red/blue HEMA palette, gold accents, shield motifs). This design system is **canonical** and ports directly to the production app. Beta companion app at `https://myfal.lyonamhe.fr/` is the reference for "My Schedule" interaction.

### 2.2 Scorekeeper App (PWA, tablet-first, offline-tolerant)

Used at each Lice by a designated scorekeeper. One device per Lice. Functions:

- View current match assignment (red vs blue, weapon, ruleset).
- Match clock (start/pause/halt/resume).
- Per-exchange entry: clean hit (red/blue, 1pt/2pt), afterblow (with retaliation value), double, no-exchange.
- Undo last exchange.
- Finalize match → push to backend.
- Works fully offline; queues exchanges to IndexedDB; syncs when network returns.

### 2.3 Organizer Admin (responsive web, desktop-first)

Per-organizer team. Functions:

- Create event, configure tournaments (weapon/category), select rulesets, configure theming.
- Register fighters (with link to global profile / HEMA Ratings).
- Generate pools (configurable seeding) and elimination brackets (single elim, double elim, swiss).
- Assign matches to Lices, manage piste schedule.
- Review and edit scores (with audit trail).
- Publish results, generate statistics page, export to HEMA Ratings format.

### 2.4 Super Admin (responsive web)

Platform-level admin (you). Functions:

- Approve and manage organizer accounts.
- Enable/disable organizers.
- Moderate global fighter profiles (merge duplicates, handle disputes).
- Manage rulesets (approve community-submitted rulesets).
- Platform-wide stats and monitoring.
- Feature flags.

### 2.5 Marketing Site (prerendered, apex domain)

`myclash.fr` — commercial landing page. **Astro 6**, prerendered to `dist/` and served by Caddy. It
imports no `@myclash/ui` and no `theme.css`, which is why it is still on the legacy design language
(see `docs/design/known-deviations.md`, D4). Content:

- Product pitch and feature overview.
- How-it-works flow.
- Donation / support section (HelloAsso link).
- Login CTA → `app.myclash.fr`.

App: `apps/web-marketing/` — Astro pages under `src/pages/`, built with `astro build` to `dist/`. Served by Caddy (`FROM caddy:2-alpine`, generated Caddyfile). No Next.js runtime. `/terms` and `/privacypolicy` must answer without a redirect — `LEGAL_POLICIES` in `packages/types/src/legal.ts` publishes those paths and `apps/web-marketing/test/site.test.mjs` asserts them.

---

## 3. Tech Stack & Rationale

### 3.1 Decisions

| Layer                         | Choice                                                          | Rationale                                                                                                                                                                                     |
| ----------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend (all PWAs)           | **Next.js 16** (App Router) + TypeScript + Tailwind + shadcn/ui | SSR for fast public results pages; PWA support; mature ecosystem; TypeScript end-to-end                                                                                                       |
| Backend                       | **NestJS 11** + TypeScript                                      | Modular, opinionated, excellent for domain-rich apps; first-class WebSocket gateway; matches user preference                                                                                  |
| Database                      | **PostgreSQL 17** (via Supabase)                                | Deeply relational domain; `LISTEN/NOTIFY` for realtime; mature tooling; AGPL-friendly                                                                                                         |
| ORM                           | **None** — PostgREST + raw SQL                                  | Reads go through `SupabaseService`; migrations are hand-written SQL. A Drizzle mirror was carried until 2026-08 and deleted: nothing imported it and it had drifted from the SQL it described |
| Realtime                      | **Supabase Realtime** (Phoenix Channels)                        | Postgres-native broadcast on row changes; zero glue code for the read-side                                                                                                                    |
| Auth                          | **Supabase Auth** (email magic link + Google OAuth)             | Self-hostable, JWT-based, integrates with Postgres RLS                                                                                                                                        |
| Object Storage                | **Supabase Storage** (S3-compatible)                            | Fighter photos, event logos, podium photos                                                                                                                                                    |
| Background jobs               | **BullMQ** (Redis-backed)                                       | Stats recomputation, HEMA Ratings sync, exports                                                                                                                                               |
| Cache + pub/sub               | **Redis 8**                                                     | BullMQ + L2 cache for ranking queries                                                                                                                                                         |
| Reverse proxy                 | **Traefik v3**                                                  | Automatic Let's Encrypt, label-based config, native Docker integration                                                                                                                        |
| Container                     | **Docker + Docker Compose**                                     | User requirement                                                                                                                                                                              |
| Monorepo tool                 | **pnpm workspaces** + **Turborepo**                             | Fast, simple, well-supported                                                                                                                                                                  |
| Client state                  | **TanStack Query** (React Query) + **Zustand**                  | Server state vs UI state separation                                                                                                                                                           |
| Forms                         | **React Hook Form** + **Zod**                                   | Schema validation shared with backend                                                                                                                                                         |
| Heavy compute                 | Main thread                                                     | Web Workers were the plan and are NOT implemented — no `new Worker(` and no Comlink anywhere in the repo                                                                                      |
| Local-first storage (scoring) | **IndexedDB** (via Dexie.js)                                    | Offline exchange queue                                                                                                                                                                        |
| Charts                        | **Recharts** + **D3** for custom viz                            | Statistics page                                                                                                                                                                               |
| Testing                       | **Vitest** (unit) + **Playwright** (E2E)                        | Modern, fast                                                                                                                                                                                  |
| CI/CD                         | **GitHub Actions**                                              | Standard                                                                                                                                                                                      |

### 3.2 Why Supabase + NestJS together (not "one or the other")

- **Supabase** handles: auth, storage, realtime broadcast, the Postgres database itself.
- **NestJS** handles: business logic, ruleset engine, bracket generation, statistics aggregation, HEMA Ratings sync, complex transactions.

The Next.js frontends talk to **NestJS for mutations** and to **Supabase Realtime for live read-side subscriptions**. Reads can also go through NestJS for aggregation endpoints. This split avoids cramming domain logic into Postgres functions while keeping realtime trivial.

### 3.3 Frontend "multi-threading"

Two mechanisms, each addressing a different concern:

1. **Server Components (Next.js)** — public results pages render server-side, ship minimal JS.
2. **Realtime subscriptions** — the UI listens to Supabase Realtime channels per Lice / per match, pushing updates without polling.

Web Workers were the third and are not implemented; §3.1 records that. Heavy compute runs
server-side.

---

## 4. High-Level System Architecture

```
                           ┌────────────────────────────────┐
                           │            Traefik             │
                           │   (TLS, routing, Let's Enc.)   │
                           └─┬──────┬──────┬──────────┬─────┘
                             │      │      │          │
                  ┌──────────▼──┐ ┌─▼────┐ ┌─▼──────┐ ┌─▼─────────┐
                  │  Next.js    │ │ Next │ │ Next   │ │ Supabase  │
                  │  (Public/   │ │ (Sco-│ │ (Admin │ │ (Auth,    │
                  │  Spectator) │ │ ring)│ │ + Super│ │ Storage,  │
                  │             │ │      │ │ Admin) │ │ Realtime) │
                  └──────────┬──┘ └─┬────┘ └─┬──────┘ └─┬─────────┘
                             │      │        │           │
                             └──────┴────┬───┴───────────┘
                                         │
                                  ┌──────▼─────────┐
                                  │    NestJS API  │
                                  │  (REST + WS)   │
                                  └──────┬─────────┘
                                         │
                       ┌─────────────────┼─────────────────┐
                       │                 │                 │
                ┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼──────┐
                │  PostgreSQL │   │    Redis    │   │ HEMA Ratings│
                │  (Supabase) │   │ (cache+jobs)│   │ (pull-only) │
                └─────────────┘   └─────────────┘   └─────────────┘
```

### 4.1 Service responsibilities

| Service             | Responsibility                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `web-public`        | Public/Spectator + Competitor PWA. SSR public pages (`/e/[eventSlug]/...`).                                  |
| `web-staff`         | Scorekeeper PWA. Heavily client-side, IndexedDB-backed.                                                      |
| `web-admin`         | Organizer Admin + Super Admin SPA-like experience.                                                           |
| `web-marketing`     | Astro, prerendered and served by Caddy — `myclash.fr` apex landing page.                                     |
| `api`               | NestJS — domain logic, REST + WebSocket gateway, BullMQ producer.                                            |
| `worker`            | NestJS in worker mode (`--worker`) — BullMQ consumer (stats, exports, Ratings sync, notifications).          |
| `db`                | Postgres 17 from the Supabase image (`supabase/postgres:17.6.1.160`), with the Supabase init scripts.        |
| `redis`             | Redis 8 — cache + BullMQ queue + pub/sub. 512 MB max, appendonly.                                            |
| `supabase-auth`     | GoTrue — email magic link + Google OAuth, JWT-based session.                                                 |
| `supabase-realtime` | Phoenix Channels broadcasting Postgres row changes to subscribers.                                           |
| `supabase-storage`  | S3-compatible object storage for fighter photos, club logos.                                                 |
| `supabase-rest`     | PostgREST over the public schema, served at `/rest/v1`.                                                      |
| `traefik`           | Reverse proxy + TLS termination (Let's Encrypt). Routes by hostname to every public-facing service.          |
| `ops-runner`        | Bearer-authed sidecar with `/var/run/docker.sock` mounted. Backups, restore, container lifecycle. See §17.4. |

> The three frontends could be a single Next.js app with route-based feature flags. **Decision: keep them as three apps in the monorepo**, sharing UI components via a `packages/ui` workspace. This isolates the scoring app (offline-first, very different UX) and the admin app (heavier, desktop-first) from the lean public PWA.
>
> Neither stack includes Kong. Earlier Supabase self-hosting setups used Kong as an API gateway; MyClash fronts every Supabase service directly through Traefik labels in **both** production and local dev. Kong was removed from the dev compose along with `infra/supabase/kong.yml`, so dev now exercises the same edge path that serves production.

---

## 5. Data Model

### 5.1 Core entities (ER overview)

The competition chain runs **organization → event → tournament → phase → match → exchange**. An `event`
is the real-world gathering ("Dijon Open 2026"); a `tournament` is one weapon × category bracket inside
it ("Longsword Open"). Relationships below are the actual foreign keys — see
`packages/db/migrations/0001_init.sql`.

```mermaid
erDiagram
  organizations ||--o{ events : hosts
  organizations ||--o{ organization_members : "admins"
  events ||--o{ tournaments : contains
  events ||--o{ persons : "event-scoped roster"
  events ||--o{ lices : "pistes"
  tournaments ||--o{ phases : "pool / elimination"
  tournaments ||--o{ registrations : "entry list"
  phases ||--o{ pools : "pool phase"
  phases ||--o{ bracket_slots : "elimination phase"
  phases ||--o{ matches : schedules
  pools ||--o{ pool_members : seats
  pools |o--o{ matches : "pool bouts"
  matches ||--o{ exchanges : "atomic scoring unit"
  matches ||--o{ match_events : "timeline"
  matches }o--|| lices : "assigned piste"
  registrations }o--|| persons : "who is entered"
  registrations }o--o| global_persons : "cross-event identity"
  pool_members }o--|| registrations : "seats"
  persons }o--o| global_persons : "deduped at import"
  persons }o--o| clubs : "affiliation"
  tournaments }o--o| custom_rulesets : "pinned by (code, version)"
```

Three relationships are easy to get wrong, so they are worth stating explicitly:

- **`persons` vs `global_persons`.** `persons` is the organizer-created roster row, scoped to **one
  event**. `global_persons` is the cross-event identity a person is deduplicated onto at import. The FK
  is `persons.global_person_id` — migration `0023` renamed both the table (`fighters` →
  `global_persons`) and this column (`global_fighter_id` → `global_person_id`,
  `0023_global_persons.sql:37`). A `global_fighter_id` anywhere in code or docs predates that
  migration and is wrong.
- **A match hangs off a phase, not off a pool.** `matches.phase_id` is `NOT NULL` while `pool_id` and
  `bracket_slot_id` are both nullable — a pool bout carries `pool_id`, an elimination bout carries
  `bracket_slot_id`. Note `phase_id` has no FK constraint, only the `NOT NULL`.
- **The ruleset is a pin, not a join.** `tournaments` stores `ruleset_code` + `ruleset_version` as a
  _pointer_ resolved at read time, not a foreign key. That choice has real consequences — see §7bis.

### 5.2 Tables

**The schema is `packages/db/migrations/`** — numbered, checksummed raw SQL, applied by
`packages/db/scripts/migrate.mjs`. There is no ORM and no schema mirror: `packages/db/src/index.ts` records
why the Drizzle one was deleted, and `packages/db/src/index.ts:1-22` is worth reading before
anyone proposes reintroducing it.

The section that stood here was 365 lines of hand-copied `CREATE TABLE` covering about 25 of
the ~130 tables, labelled by its own closing paragraph as predating "several shipped feature
waves", and pointing at a directory that no longer exists. It is not restated. To read a table,
read its migration; to see the shape the tests hold, read
`apps/api/src/common/testing/migration-schema.ts`, which replays the migrations.

Whole families that a route- or table-listing will not tell you about: venues and their areas
and lices; event arrivals, gear checks, passes and feedback; match forfeits and penalties with
their own versioned rulesets; Swiss rounds and entrants; leagues and cross-event standings;
directory groups; the AI provider/usage/budget tables; runtime health samples; and the privacy
surface — legal acceptances, retention settings, erasure log, deletion requests.

What is **not** derivable from the DDL, and so belongs here:

- **A match hangs off a phase, not a pool.** `matches.phase_id` is `NOT NULL` while `pool_id`
  and `bracket_slot_id` are both nullable — a pool bout carries `pool_id`, an elimination bout
  carries `bracket_slot_id`. `phase_id` has no FK constraint, only the `NOT NULL`.
- **The ruleset is a pin, not a join.** `tournaments` stores `ruleset_code` + `ruleset_version`
  as a pointer resolved at read time. Consequences in §7bis.
- **RLS is the only boundary.** Without a policy a table is world-readable — PostgREST exposes
  `public` as `anon`. Views and functions bypass RLS: an unpinned view runs as its `BYPASSRLS`
  owner, so a view over a policed table is still a hole.
- **Migration numbering is max+1**, and applied migrations are never edited — the runner
  checksums them and throws when one changes. `0001_init.sql` and `0085` still contain colour
  values the product has since abandoned; that is history, not live config.
- **Pool match labels are `L{lice}-P{pool}-M{seq}`, zero-padded** to the pool's width
  (`berger.ts`). Three reads sort that column as text in SQL; unpadded, `M10` sorts before `M2`.

Significant families and their migrations:

- **Leagues / Classement** — `leagues`, `league_organization_roles`, `league_user_roles`, plus league–tournament links, membership requests, groups and scoring systems (migrations `0015_leagues.sql`, `0069_league_membership_requests.sql`, and later). Cross-event standings aggregated from linked tournaments.
- **Directory groups (People Hub)** — `directory_groups`, `directory_group_members` (migration `0114_directory_groups.sql`). User-curated groups of global persons for the `/me` people hub.
- **AI subsystem** — organization-level AI provider settings, usage/budget tracking, organizer chatbot, and generated content: `ai_generated_content` (migration `0119_generated_content.sql` — the table is `ai_generated_content`; only the filename says `generated_content`) plus `fighter_ai_settings` (migration `0120_fighter_ai_settings.sql`) for fighter self-service AI, alongside the AI provider/usage tables (migrations `0115`–`0118`).
- **Referee compensation** — see §23 (migration `0027_referee_compensation.sql`).

### 5.3 Exchange semantics

The `exchanges` table is the single source of truth. The match score is **always derived** from non-voided exchanges; never stored independently. This guarantees the score is consistent with the visible exchange list and statistics computations.

**Type meanings:**

| `type`        | Meaning                                      | Score effect (TF_v1)                                                       |
| ------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| `clean`       | One fighter struck, no afterblow             | first striker gains `first_strike_value`; opponent +0                      |
| `afterblow`   | First strike, then retaliation within window | first striker gains `first_strike_value`; opponent gains `afterblow_value` |
| `double`      | Both struck simultaneously                   | neither gains points; counted toward double penalty                        |
| `no_exchange` | Halt, off-target, warning, etc.              | no score effect                                                            |

**Statistics columns derivation** (matching the lyonamhe.fr layout):

For fighter F in event E:

- `Dbl` = count(exchanges where match involves F and type='double')
- `✓1` = count(type='clean', first_striker=F, first_strike_value=1)
- `✓1-1` = count(type='afterblow', first_striker=F, first_strike_value=1)
- `✓2`, `✓2-1` analogous for value=2
- `✗1` = count(type='clean', first_striker=opponent_of(F), first_strike_value=1)
- `✗1-1` = count(type='afterblow', first_striker=opponent_of(F), first_strike_value=1) — F received afterblow opportunity? **NO** — `✗1-1` means F received first hit AND landed afterblow. Re-checking source page legend: "✗ indicates that the combatant received the first touch". So `✗1-1` = F was hit first (1pt) and F landed afterblow. = count(type='afterblow', first_striker=opponent_of(F), first_strike_value=1). The afterblow_value is F's afterblow; that's what makes the row.
- `Total` = sum of all above
- `Ratio` = Dbl / Total

**Current implementation (migration 0128): computed on-read** via the `fighter_exchange_stats(tournament_id)` Postgres function, scoped to one tournament. (The original `mv_fighter_exchange_stats` materialized view was dropped: its refresh trigger only `pg_notify`'d a channel with no listener, so it served stale data; the on-read function is always fresh and nets afterblow points correctly for both scoring modes.)

### 5.4 Match-level statistics (timing)

From `match_events` and `exchanges`:

- **Match duration (active)**: sum of intervals between `start`/`resume` and `halt`/`end`. Persisted as `matches.duration_active_ms` when the `end` clock action fires.
- **Match duration (total)**: `ended_at - started_at`. Persisted as `matches.duration_total_ms` when the `end` clock action fires.
- **Judging overhead**: `duration_total_ms − duration_active_ms` — time spent outside active fighting (deliberation, cards, border calls). Available to organisers via the match list (`GET /api/v1/matches?phaseId=...`).
- **Time between exchanges**: `exchanges.duration_since_prev_ms`, computed at insert.
- **Currently running matches**: `matches WHERE status='running'`, indexed for the live view.

The scoring pad displays both the active fight clock and a secondary "Temps total" wall-clock elapsed timer that ticks continuously once a match starts (including during halts), giving referees real-time awareness of judging pace.

### 5.4bis Venues, and what `event_kind` changes

`docs/HIERARCHY.md` is authoritative on vocabulary and carries two facts this document used to
imply the opposite of.

**A Venue is a place; a Lice is where matches happen, and they are not the same tree.** An
organization owns Venues, each with optional Venue Areas and a `venue_lices` catalogue of reusable
names. An Event owns Lices (`lices.event_id` required), each pointing at its physical home through
nullable `venue_id` / `area_id` — nullable because an operator may create a lice before linking it.
**A Venue Lice is not a Lice**: it is setup data that event creation copies from, and nothing is
ever scheduled onto one. Served by `apps/api/src/modules/venues/`.

**`events.event_kind` is `standard | test | club`** (migration `0162`). It is not cosmetic: `test`
and `club` events are excluded from public listings, which is why `GET /events/:slug` returning 404
for one is the policy working. Anything counting or listing events has to say which kinds it means.

**Swiss is a first-class format**, alongside pools, single-elim and double-elim — not a variant of
one. It has its own tables (`swiss_rounds`, `swiss_entrants`), its own module
(`apps/api/src/modules/swiss/`), and its own staffing path.

### 5.5 Lifecycle state machines

> **What is actually enforced.** The `CHECK` constraints below restrict the _set of legal values_; they
> do not constrain transitions. Nor does the service layer — `MatchesService.updateStatus` writes
> whichever legal value it is handed and only attaches side effects (`started_at` on `running`,
> `ended_at` + winner on `completed`). The diagrams therefore describe the **intended** lifecycle, which
> is a convention the API and UI follow, not an invariant the system guarantees.
>
> `tournaments.status` is looser still: it has **no `CHECK` constraint at all**, as noted in migration
> `0138`. Its values (`draft`, `published`, `running`, `completed`) exist only in application code.

**Event** — the organiser-facing publish flow. `archived` is reachable from any state (an event can be
shelved before it ever runs).

```mermaid
stateDiagram-v2
  [*] --> draft: organiser creates
  draft --> published: publish (becomes publicly visible)
  published --> running: event day begins
  running --> completed: all tournaments finished
  completed --> archived: archive
  draft --> archived: abandon
  published --> archived: cancel
```

**Match** — the scoring flow. `paused` is a halt (deliberation, cards, border calls) and returns to
`running`; `voided` annuls a bout without deleting it, preserving its exchanges.

```mermaid
stateDiagram-v2
  [*] --> scheduled: bracket / pool generated
  scheduled --> running: pad starts the bout (stamps started_at)
  running --> paused: halt
  paused --> running: resume
  running --> completed: result recorded (stamps ended_at + winner)
  scheduled --> voided: annulled
  running --> voided: annulled
  completed --> voided: annulled after the fact
```

**Registration** — a fighter's entry in one tournament.

```mermaid
stateDiagram-v2
  [*] --> registered: entry accepted
  registered --> checked_in: present on the day
  registered --> withdrawn: pulls out
  checked_in --> withdrawn: pulls out on the day
  checked_in --> disqualified: DQ
  registered --> disqualified: DQ
```

The remaining status columns follow the same shape and are not drawn separately:

| Table                  | States                                                     |
| ---------------------- | ---------------------------------------------------------- |
| `workshops`            | `draft → published → running → completed`                  |
| `workshop_sessions`    | `scheduled → running → completed`, `cancelled`             |
| `workshop_enrollments` | `intent → confirmed`, `waitlisted`, `cancelled`, `refused` |
| `leagues`              | `draft → published → archived`                             |
| `organizations`        | `active`, `suspended`                                      |
| `event_staff_accounts` | `active`, `disabled`                                       |

Every request/approval table — `exchange_edit_requests`, `deletion_requests`,
`global_person_claim_requests`, `league_membership_requests`, `league_tournament_links`,
`tournament_penalty_reviews` — shares a trivial `pending → approved | rejected` shape (with
`withdrawn`/`removed`/`dismissed` variants), so none is drawn.

---

## 6. TF_v1 Ruleset Specification

This is the canonical ruleset shipped with MyClash.

### 6.1 Per-fighter aggregates

For fighter F in pool/event:

```
wins(F)              = count of matches where winner_registration_id = F
target_points(F)     = Σ first_strike_value where F was first striker (clean OR afterblow)
                     + Σ afterblow_value     where F landed afterblow
times_hit(F)         = count of clean exchanges where F was the receiver
                     + count of afterblow exchanges where F received the afterblow
                       (NOTE: in afterblow, the FIRST striker receives the afterblow)
doubles(F)           = count of double exchanges in F's matches
n_doubles(F)         = doubles(F)
```

### 6.2 Score formula

```
WIN_BONUS         = 3
DOUBLE_PENALTY(n) = n * (n - 1) / 3        -- a(n) = n(n-1)/3, n = total doubles
SCORE(F)          = (wins(F) * WIN_BONUS + target_points(F))
                  / (times_hit(F) + DOUBLE_PENALTY(n_doubles(F)))
```

**Edge cases:**

- If denominator = 0 (no hits received, no doubles): SCORE = numerator (treat as if denominator = 1). Document this explicitly.
- Score is rounded to 1 decimal for display, but stored as full precision.

### 6.3 Ranking & tiebreakers

Sort fighters by:

1. `SCORE(F)` descending
2. `wins(F)` descending
3. `doubles(F)` ascending
4. `times_hit(F)` ascending
5. Stable: `registration.seed` ascending (or `bib_number` as fallback)

### 6.4 Cross-check with reference page

Spot-checked against `https://lyonamhe.fr/resultat_fal2026.html` Pool ranking, e.g.:

> Thibaud Jacquier-Bret: V=4, Pts+=37, Pts−=10, Dbl=2, Score=4.6
> SCORE = (4 × 3 + 37) / (10 + 2×1/3) = 49 / 10.67 = 4.59 ≈ **4.6** ✓

Implementation must reproduce these scores byte-for-byte.

### 6.5 Configurable parameters (in `events.ruleset_config`)

```json
{
  "win_bonus": 3,
  "afterblow_window_ms": 1000,
  "target_values": {
    "deep_target": 2,
    "shallow_target": 1
  },
  "match_format": {
    "first_to_points": null,
    "time_limit_seconds": 180,
    "max_doubles": 3
  },
  "double_penalty_formula": "n*(n-1)/3"
}
```

`double_penalty_formula` is a whitelisted expression key; the engine maps it to a server function (no `eval`).

Forfeits are ruleset behavior, not fake exchanges. TF/FFAMHE defaults are: injury keeps current points and asks whether the fighter can continue; voluntary and first black card award a 0-6 loss and ask whether the fighter can continue; second black card and conduct/violence award a 0-6 loss and disqualify the registration. Active forfeits are stored in `match_forfeits`, drive `matches.status/winner_registration_id`, and may be voided only before downstream dependent matches start. In pools, `canContinue=false` auto-forfeits later unstarted pool matches. In brackets, play-ins and round 2+ become walkovers; main bracket round 1 can replace an unstarted forfeiting fighter with the next eligible pool-ranked non-qualifier.

---

## 7. Scoring Engine & Ruleset Plugin System

### 7.1 Plugin contract (TypeScript)

```ts
// packages/rulesets/src/types.ts
export interface Ruleset {
  code: string; // "TF_v1"
  version: string; // "1.0.0"
  displayName: string;

  /** Compute one match's score from its exchanges */
  computeMatchScore(match: Match, exchanges: Exchange[], config: unknown): MatchScore;

  /** Decide if a match has ended (first-to-N, max-doubles) */
  isMatchOver(match: Match, score: MatchScore, config: unknown): MatchEndDecision;

  /** Compute pool standings from all matches */
  computePoolStandings(
    pool: Pool,
    matches: Match[],
    registrations: Registration[],
    config: unknown,
  ): PoolStandingRow[];

  /** Declarative standings columns, and the tiebreak chain applied over them */
  standingsColumns: StandingsColumn[];
  rankingChain: RankingRule[];
  metadata?: RulesetMetadata;
}
```

Three things the contract used to declare and no longer does, because nothing called them:

- **`configSchema: ZodSchema`** had no production reader at all — only a test that existed
  because the field did. A ruleset validates its own config inside its own methods.
- **`isMatchOver`'s `clockMs`**, and the `time_limit` branch both built-ins hung off it. The only
  production call passed a literal `0`, so that branch could never fire. A single fight that runs
  out of time is completed by `ClockService`, which sets no winner and no end reason.
- **`computeFinalRanking?`** was implemented by no ruleset and called by nobody. The real
  final-ranking authority is a free function in `@myclash/rules`, and no ruleset influences it.

`isMatchOver` also takes the SCORE rather than the exchanges. It used to re-derive the score for
itself, so every bout was scored twice — and the caller adds penalties to its own copy afterwards,
so the decision was made from a number nobody would ever see.

### 7.2 Built-in rulesets shipped at v1.0

- **TF_v1** — the canonical ruleset spec'd in §6.
- **Generic_PointsCap** — first-to-N points, no algorithm score (for clubs that just want simple pool play).

(These two are the only rulesets registered today; see `packages/rulesets/src/index.ts`. Data-driven `FormulaRuleset` variants are also supported via the registry.)

Additional rulesets are added by:

1. Implementing the contract in `packages/rulesets/src/<code>.ts`.
2. Registering it in the ruleset registry.
3. Super Admin approval (DB row in `rulesets` table marks it `published`).

### 7.3 Where the engine runs

- **Server side (NestJS)** — authoritative. All persisted scores, standings, and rankings are computed server-side.
- **Client side** — NOT the engine. `@myclash/rulesets` is deliberately NOT a dependency of `apps/web-staff` or `packages/ui`, and must not become one. See "Seed, don't resolve" below.

#### Seed, don't resolve

**The pad never resolves a ruleset.** A tournament's scoring buttons are SEEDED
into `tournaments.scoring_config_json` when the tournament is created
(`buildScoringButtons` off the ruleset's grammar), and the pad renders that seed.
It sends RAW button values; the server nets them under the tournament's afterblow
mode at read.

That is the whole reason offline scoring works on a federation's own custom
ruleset. `ruleset-resolver.service.ts` can fall back to a DB-driven
`FormulaRuleset` built from a stored AST — unreachable from a tablet with no
network, and it must never become a pad dependency.

`tests/e2e/08-offline-custom-ruleset.spec.ts` is the executable form of this
rule: it authors a ruleset with `+3`/`+1` targets and asserts the pad shows those
buttons and NO `+2` — a `+2` would mean the pad had fallen back to the federal
default rather than rendering the seed.

#### What arithmetic the pad IS allowed

**The pad may run pure catalogue arithmetic over data it already fetches. It must
never need the engine.**

"The engine" means the AST-driven `FormulaRuleset` that
`ruleset-resolver.service.ts` builds from a stored definition. It needs a
database, so it is unreachable from a tablet in a dead hall, and it must never
become a pad dependency. That is the whole content of this rule; everything else
is a consequence.

A PENALTY ruleset is not the engine. It is a catalogue of rows — entries, the
card each occurrence carries, and per-card point values — that the pad already
fetches in full from `GET /matches/:id/penalty-ruleset` and caches on the tablet.
Reading arithmetic off a table you already hold is not resolving a ruleset.

Allowed, all pure, and reachable from the pad so it and the server call the SAME
function rather than reasoning separately. The home is `@myclash/rules` for the
scoring core and `@myclash/types` for the rest; `@myclash/types` re-exports what
moved, so a caller importing from either resolves the one implementation.

`@myclash/rules` exists for exactly this list. It has ZERO runtime dependencies —
not even zod — which is what lets a rule live in one place instead of being copied
into whichever package a caller could already reach. `pnpm quality:package-purity`
enforces both halves of this section: that the package stays dependency-free, and
that `@myclash/rulesets` never becomes a dependency of `apps/web-staff` or
`packages/ui`. Before that gate existed the rule above was prose only.

| Function                                             | The pad uses it to                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `computeAfterblowDeltas` (`@myclash/rules`)          | label the afterblow buttons, and net a queued hit's provisional delta                   |
| `computePenaltySanction` (via `resolveEntryCard`)    | show which card an entry will ACTUALLY produce for this fighter                         |
| `penaltyScoreDelta` + the ruleset's per-card columns | price a queued card into the provisional score                                          |
| `effectiveTimeLimitSeconds` (`@myclash/rules`)       | pick the phase time limit the bout is actually counting against                         |
| `displayClockMs` (`@myclash/rules`)                  | turn elapsed active time into the numeral on the clock                                  |
| `pointCapWinnerColor` (`@myclash/rules`)             | paint the score gold when a side reaches the cap                                        |
| `applyScoringDirection` (`@myclash/rules`)           | read a `reverse_zero_loses` score down from the cap, on the pad and the bout-flow chart |

`packages/types/src/penalties.ts` argues this boundary at length in its own
docblock and is the place to read next. Two rules keep the list honest: every
entry is a function the SERVER also calls on the same input, and none of them
may reach for a database. Anything failing either test belongs server-side.

**The table above is the gate, not a description of one.** `pnpm
quality:package-purity` parses these rows and refuses any value that reaches the
pad from `@myclash/rules` without one — whether imported directly or re-exported
through `@myclash/types`, which every pad surface imports freely. Type-only
imports are ignored: a type erases at compile time and cannot be called.

That rule exists because the extraction created the risk it closes. The formula
evaluator used to be unreachable from the pad by accident of packaging — it sat
beside zod. Now it is pure and reachable, so nothing but this list stops pad code
from evaluating a custom ruleset's formula locally and printing a real score,
which hard rule 1 forbids. Adding a row is how you grant permission, and the row
has to carry its reason.

The provisional score itself remains display-only —
`apps/web-staff/src/offline/pending-events.ts` computes it for rows still in the
outbox, and nothing derived on the pad is ever stored. Hard rule 1 is unchanged:
the server is the only thing that DERIVES a persisted score.

---

## 7bis. Ruleset authoring, sharing and pinning

§6 specifies the TF_v1 format and §7 the engine that executes a ruleset. This section covers the
**self-service lifecycle** around them: how an organisation authors its own ruleset, how one becomes
visible to other organisations, and what it means for a tournament to "use" one.

### 7bis.1 Two orthogonal axes

The most common misreading is that submitting a ruleset for review is a _status_. It is not.
`custom_rulesets.status` (`draft | published | archived`) and its sharing state are carried by
**separate columns**, added in migration `0055`:

```mermaid
stateDiagram-v2
  direction LR
  state "status — is this definition usable?" as S {
    [*] --> draft
    draft --> published: publish
    published --> archived: delist
    draft --> archived: abandon
    archived --> published: restore
  }
```

```mermaid
flowchart LR
  A["org-scoped<br/>owner_organization_id = org<br/>usable on that org's tournaments immediately"]
  A -->|"POST :id/submit<br/>sets submitted_for_review_at"| B["awaiting review"]
  B -->|"POST :id/approve-public"| C["public_visibility = TRUE<br/>appears in every org's catalog"]
  B -->|"POST :id/reject-submission"| D["rejected_reason set<br/>stays org-scoped, can be fixed + resubmitted"]
  D -->|"resubmit"| B
```

The practical consequence: **an organisation never waits for approval to use its own ruleset.** Review
governs only whether the ruleset appears in the platform-wide catalog for _other_ organisations.
`owner_organization_id IS NULL` denotes a platform-level ruleset.

> `ruleset_submissions` is a **dead table**. It survives in the schema and in the GDPR export table list,
> but no ruleset code path reads or writes it — `submitted_for_review_at` is the only submission route.

### 7bis.2 Two authoring paths

| Path           | Storage                      | Resolves as                                               |
| -------------- | ---------------------------- | --------------------------------------------------------- |
| **Formula**    | `score_formula` (AST)        | a `FormulaRuleset` built from the stored grammar          |
| **Coded fork** | `base_code` + `base_version` | short-circuits to `registry.get(base_code, base_version)` |

The coded fork exists because TF*v1's ranking (score, then wins, doubles, timesHit, seed) is an
algorithm, not an expression — re-authoring it as a formula AST is explicitly ruled out, since the DSL
cannot carry its tiebreak chain. A fork that wants TF_v1's **maths** with different **parameters**
therefore keeps pointing at the coded engine while supplying its own config. `base_version` pins \_which*
coded version the fork tracks, so a later TF_v1@2.0.0 cannot silently change a fork of 1.0.0.

### 7bis.3 A pin is a pointer, resolved at read time

`tournaments.ruleset_code` + `ruleset_version` is a **pointer**, not a foreign key. Standings resolve it
on every read, which is the single most important consequence in this section: **changing the pointer
re-ranks results that are already recorded.**

```mermaid
flowchart TD
  T["tournament<br/>ruleset_code + ruleset_version"] --> R{"resolver"}
  R -->|"base_code set"| REG["coded registry<br/>registry.get(base_code, base_version)"]
  R -->|"otherwise"| FR["FormulaRuleset<br/>built from score_formula"]
  REG --> EFF["effective behaviour<br/>= definition + config + afterblowMode"]
  FR --> EFF
  P["penalty_ruleset_version<br/>(immutable snapshot)"] --> EFF
  EFF --> H["sha256 → ruleset_content_hash"]
  H --> TH["tournaments.ruleset_content_hash<br/>current — recomputed on any pin change"]
  H --> MH["matches.ruleset_content_hash<br/>FROZEN at match generation"]
```

`(code, version)` identifies the _definition_; the content hash identifies the _effective behaviour_.
Two TF_v1 tournaments with different `winBonus` resolve to the same engine but hash differently. The
match-level copy is frozen when the match is generated, so a scored match permanently records which
behaviour produced it.

Because a live pointer change rewrites recorded standings, mid-event re-pinning is not a plain update —
it is an audited ceremony (typed confirmation, mandatory justification, org-owner or super-admin,
blocked on completed/archived tournaments). `tournament_ruleset_repins` is its append-only record:
actor, from → to, the per-bucket diff, whether ranking stayed compatible, and the materialised
before/after placings.

### 7bis.4 Immutability and delisting

Two rules keep a pinned definition from shifting under a tournament:

- **Versions are snapshotted.** Publishing captures the payload immutably (`custom_ruleset_versions` for
  scoring, `penalty_ruleset_versions` for penalties). Rollback copies a snapshot back onto the parent
  rather than overwriting destructively. `is_frozen` flips `TRUE` the moment a tournament pins the
  ruleset, after which the edit-guard refuses further edits.
- **Delist ≠ delete.** Deleting a ruleset that any tournament pins would 400 that tournament's
  standings, so the service **soft-archives** it instead: the row leaves every picker and list but stays
  resolvable forever. Only an unreferenced ruleset is truly deleted. System and default rulesets cannot
  be deleted at all.

### 7bis.5 Endpoint surface

| Actor            | Endpoints                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Organisation** | `GET catalog` · `POST fork` · `POST validate` · `PATCH :id` · `DELETE :id` (soft-archives if referenced) · `POST :id/submit` · `GET :id/export` · `POST import`                         |
| **Super admin**  | `POST :id/publish` / `:id/unpublish` · `GET :id/versions` · `POST :id/versions/:versionId/rollback` · `POST :id/set-default` · `POST :id/approve-public` · `POST :id/reject-submission` |

---

## 8. Statistics Module

### 8.1 What we display (mirroring lyonamhe.fr layout)

**Event-level hero numbers:**

- Total participants
- Total matches
- Doubles rate (%)
- Number of events
- Number of clubs

**Per-event:**

- Podium (top 3 with photos)
- Final classification table
- Pool phase classification (V / Pts+ / Pts− / Dbl / Score)
- Charts:
  - Distribution of exchanges (clean / afterblow / double, stacked)
  - Exchanges by weapon (if multi-event)
  - Target zones (1pt vs 2pt distribution)
  - Evolution of double rate over the day (line chart, X = match index, Y = doubles%)
  - Top 5 "Deep Target Hunters" (most 2pt hits)
- Per-fighter detailed exchange table (Dbl / ✓1 / ✓1-1 / ✓2 / ✓2-1 / ✗1 / ✗1-1 / ✗2 / ✗2-1 / Total / Ratio)

**Special awards:**

- Prix Technique (judge-decided, not computed)

### 8.2 Computation strategy

- **Hot path (live)**: realtime updates push deltas; UI maintains incremental aggregates.
- **Per-fighter exchange aggregates**: computed on-read by the `fighter_exchange_stats(tournament_id)` Postgres function (migration 0128) — always fresh, no materialization/refresh. (Superseded the `mv_fighter_exchange_stats` materialized view from `0010`/`0110`/`0113`, which went stale because its refresh trigger had no listener.)
- Event- and tournament-level aggregates are served from plain `vw_tournament_query_*` views (fighters, pools, matches, exchange summary, referees), not a materialized event summary.
- Public stats page reads these views directly (fast).

### 8.3 Export formats

- **HTML** — static page, like the reference, generated server-side.
- **PDF** — via Puppeteer in the worker.
- **CSV** — full match + exchange dump.
- **JSON** — full event data (for archival, HEMA Ratings submission).
- **HEMA Ratings format** — see §11.

---

## 8bis. The League (cross-event standings)

A **League** is the only mechanic in the product that spans Events. Everything in
§5 stops at an Event boundary; a League reaches across a season, collects the
results of Tournaments held at different Events by different organisations, and
turns them into standings.

### 8bis.1 What a League is made of

| Table                            | Holds                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `leagues`                        | the season itself: name, slug, `season_year`, `status`, `scoring_config`, `finalized_at`           |
| `league_groups`                  | the organiser's own divisions (`name`, `sort_order`), unique per League                            |
| `league_tournament_links`        | which Tournaments count, and whether the link is `requested` / `approved` / `rejected` / `removed` |
| `league_membership_requests`     | a club or organisation asking to join                                                              |
| `league_organization_roles`      | which organisations may manage the League                                                          |
| `league_user_roles`              | which individual users may manage it                                                               |
| `league_scoring_systems`         | the registry of named point tables (`code`, `points_by_rank`, `tie_breakers`)                      |
| `league_scoring_system_versions` | immutable published snapshots of those tables, addressed `code@version`                            |
| `league_tournament_results`      | one row per Fighter per counted Tournament — the contribution                                      |
| `league_rankings`                | the computed standings rows                                                                        |

`leagues.status` runs `draft → published → archived` (§5.5). `finalized_at` is
separate from `status` and means the season is **frozen**.

### 8bis.2 How a result becomes a standing

1. A Tournament is **linked** to a League. The link starts `requested`, and only
   an `approved` link counts.
2. When the Tournament is decided, its final ranking produces one
   **contribution** per Fighter: a place, a `resultKind`, and the double-hit
   count. `resultKind` is what separates a real bronze from a semi-final loss
   with no bronze match, so no phantom medal is awarded.
3. Each contribution earns points from the League's scoring system —
   `pointsForRank`. The FFAMHE TF 2026 table awards 16 down to 1 across ranks
   1–16, and nothing after rank 16.
4. Each contribution is assigned a **ranking group key** — `groupKey` — which
   decides which table it belongs in.
5. Contributions are added up per Fighter per group, ordered by the League's
   tie-breaker chain, and written to `league_rankings`.

Steps 3–5 are pure and live in `@myclash/rules/results`. Only the gathering and
the writing are in `apps/api`.

### 8bis.3 Ranking dimensions: how many tables a League has

`scoring_config.rankingDimensions` decides the shape of the whole season:

| Value             | Produces                                         |
| ----------------- | ------------------------------------------------ |
| `weapon`          | one table per weapon; every group merged into it |
| `weapon_category` | one table per weapon **per League group**        |
| `group`           | one table per group, weapon ignored              |

`weapon_category` is a historical name, not a description: it meant
`tournaments.category` until migration 0049 dropped that column, and has meant
the League group ever since. The stored value is deliberately left alone —
renaming it would need a migration over every League's `scoring_config` for a
string only developers read.

A Tournament linked with no group normalises to `unknown`, so ungrouped
Tournaments share a table rather than falling out of the standings entirely.

**Each table is a separate competition and is numbered on its own.** Two Fighters
level on every configured tie-breaker share a place and the next one down skips
it (1, 2, 2, 4). The chain then ends in a fighter-name comparison whose only job
is to make the order reproducible — it is never a ranking rule, and it compares
by code point rather than by locale so a standing cannot depend on which machine
computed it.

### 8bis.4 Scoring systems are pinned, not copied

`leagues.scoring_system` may be:

- `custom` — the League carries its own `customPointsByRank` inline, no lookup;
- `code` — resolves to the registry's current row (pre-0087 behaviour);
- `code@version` — resolves to that published snapshot in
  `league_scoring_system_versions`, falling back to the current row if the
  snapshot is missing.

This is the same "a pin is a pointer, resolved at read time" rule as §7bis.3,
applied to a season rather than to a ruleset. `resolveConfig` is the one method
on `LeagueScoringService` that does I/O; the rest of the class delegates to the
pure core.

### 8bis.5 Freshness: a League table is stale by default

**Recompute is never triggered by a Match completing.** The only callers are an
Event status change, the status-ticker worker, and the two manual endpoints. A
League table is therefore out of date by default, and fresh only for as long as
nothing has been fought since the last recompute — the inverse of what a reader
assumes when they open a standings page, which is why freshness is a computed
report rather than a stored flag.

| State            | Meaning                                                          |
| ---------------- | ---------------------------------------------------------------- |
| `frozen`         | `finalized_at` is set. The table is frozen on purpose.           |
| `never_computed` | Linked Tournaments exist but recompute has never run.            |
| `fresh`          | Nothing has changed in any linked Tournament since the last run. |
| `stale`          | At least one linked Tournament changed after the last run.       |

Finalizing a season freezes it; reopening it resumes recompute.

### 8bis.6 Endpoint surface

Public reads are gated on `public_visibility` **and** `status = 'published'`; the
`admin/` twins are gated on League-manage permission instead, so an organiser can
still see a draft season's standings.

| Route                                               | Purpose                                     |
| --------------------------------------------------- | ------------------------------------------- |
| `GET /leagues`, `/leagues/:slug`                    | discovery                                   |
| `GET /leagues/:id/standings`                        | the tables, per ranking group               |
| `GET /leagues/:id/club-standings`                   | the same results aggregated by club         |
| `GET /leagues/:id/final-report.csv` / `.print.html` | end-of-season output                        |
| `GET /admin/leagues/:id/recompute-preflight`        | what a recompute would refuse or warn about |
| `POST /admin/leagues/:id/recompute`                 | run one                                     |
| `POST /admin/leagues/:id/finalize` / `reopen`       | freeze and unfreeze the season              |

### 8bis.7 Where the code lives

- **`@myclash/rules/results`** — every rule: `pointsForRank`, `groupKey`,
  `medalFor`, `compareRankings`, `tiedOnChain`,
  `computeRankingsFromContributions`, `normalizeScoringConfig`,
  `aggregateClubStandings`, `computeLeagueFreshness` and
  `decidingTiebreakBetween`. Pure, and callable from a test with plain object
  literals.
- **`apps/api/src/modules/leagues`** — everything that touches the database:
  gathering contributions, resolving a pinned scoring system, replacing the
  rankings, and the authorization around all of it.

---

## 9. Real-Time Architecture

### 9.1 What is broadcast

| Channel                | Payload                                                    | Subscribers                             |
| ---------------------- | ---------------------------------------------------------- | --------------------------------------- |
| `event:{id}`           | high-level events (match started, ended, podium published) | public app, admin                       |
| `event:{id}:standings` | pool standings deltas                                      | public app, admin                       |
| `lice:{id}:current`    | current/next match on a Lice                               | public app, admin, accompanist views    |
| `match:{id}:exchanges` | new exchange, voided exchange, score update                | public app, scorekeeper (other devices) |
| `match:{id}:clock`     | clock state changes                                        | public app, scorekeeper                 |

### 9.2 Mechanism

- **Read-side**: clients subscribe via Supabase Realtime. Postgres `LISTEN/NOTIFY` on row changes (`exchanges`, `matches`, `match_events`) is bridged to clients with sub-second latency. RLS policies filter what each user sees.
- **Write-side**: clients write through NestJS, which writes to Postgres in a transaction. The realtime broadcast is a side-effect of the row change, not a separate publish step. This makes "what's broadcast" and "what's persisted" trivially consistent.

```mermaid
sequenceDiagram
  autonumber
  participant W as Scoring pad (writer)
  participant A as NestJS API
  participant DB as Postgres
  participant RT as supabase-realtime
  participant S as Spectator / admin (reader)

  S->>RT: subscribe match:{id}:exchanges
  Note over S,RT: wss://app.${DOMAIN}/realtime/v1/websocket<br/>Traefik rewrites → /socket/websocket
  W->>A: POST exchange
  A->>DB: INSERT inside a transaction
  DB-->>A: committed
  A-->>W: 201
  DB->>RT: row change (replication / NOTIFY)
  RT->>S: broadcast, filtered by RLS
```

There is **no publish call anywhere in the API** — step 6 happens because the row changed. That is the
property worth protecting: a code path cannot broadcast something it failed to persist, or persist
something it forgot to broadcast. It also means a write that rolls back is never seen by subscribers.

### 9.3 Backpressure

Per-channel rate limit on the Realtime side (Supabase config). Clients debounce UI updates to ≤30 fps.

---

## 10. Offline-First Scoring (PWA + IndexedDB)

### 10.1 Why this is non-negotiable

HEMA events happen in sports halls, basements, and convention centers with hostile wifi. If the scorekeeper's tablet drops connection mid-match and the app stops working, the entire event jams up. Offline-first is **the** quality bar for the scoring app.

### 10.2 Architecture

Implemented in [`apps/web-staff/src/offline/`](../apps/web-staff/src/offline/) — `db.ts` (Dexie
schema: `outbox` + `synced`), `outbox.ts`, `sync.ts` (`SyncEngine`), `reconcile.ts`.

The write is **durable-first**: the exchange lands in the IndexedDB outbox before any network call, so
closing the tab or losing wifi mid-bout cannot lose it.

```mermaid
sequenceDiagram
  autonumber
  participant P as Scoring pad
  participant O as IndexedDB outbox
  participant E as SyncEngine
  participant A as NestJS API

  P->>O: enqueue(exchange) — durable write first
  P->>P: optimistic local apply (UI updates immediately — see pending-events.ts)
  E->>O: getAllPending() — insertion order
  loop each pending entry
    E->>A: POST /matches/{id}/exchanges { clientUuid, sequence, … }
    alt 2xx
      A-->>E: created
      E->>O: markSynced() → moves to `synced` table
    else 409 conflict
      A-->>E: already exists (idempotent on clientUuid)
      E->>O: markSynced() — treated as success
    else 400 terminal
      A-->>E: rejected (stale sequence, round awaiting advance, …)
      E->>O: dropTerminal() — retrying can never succeed
    else 5xx / network
      A-->>E: failure
      E->>O: markFailed() — stays queued, retried later
    end
  end
```

The `clientUuid` is what makes the retry safe: the server keys idempotency on it, so a duplicate POST
after a flaky response is a no-op rather than a double-scored exchange.

**Sync status**, surfaced prominently on the pad (`SyncStatus` in `sync.ts`):

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> syncing: outbox has entries
  syncing --> idle: queue fully drained
  syncing --> offline: consecutive NETWORK failures hit the cap
  syncing --> error: consecutive SERVER failures hit the cap
  syncing --> error: drain finished with entries still pending
  offline --> syncing: connectivity returns
  error --> syncing: retry
```

The split between `offline` and `error` is deliberate: a network failure means "keep waiting, this will
resolve", whereas a server failure means "something needs a human". Both leave the exchanges queued.

> One behaviour worth knowing at the pad: a **400 is terminal** — the entry is dropped from the outbox
> with a console warning rather than retried, because retrying a stale sequence or a round awaiting
> advance can never succeed and would block the whole queue behind it.

### 10.3 Conflict resolution

- Each exchange carries a **client-generated UUID** (`exchange_id`) and a monotonic **client sequence number**.
- Server is idempotent: inserting an exchange with an existing UUID is a no-op.
- If server has a newer exchange list (e.g. another scorekeeper edited via admin), the local app reconciles by replaying server state and re-applying any local pending exchanges. Since exchanges are append-only with explicit sequence, conflicts are bounded.
- **Voids** are never destructive: a voided exchange remains in the table with `voided=true`. Replays do not lose data.

### 10.4 PWA requirements

- Service Worker pre-caches the scoring app shell. There is NO ruleset bundle and
  there must not be — see "Seed, don't resolve" in §7.3.
- The Service Worker **resolves a synthetic `503 { error: 'offline' }`** for every
  `/api/` call rather than throwing, and caches no API response. Any client code
  branching on `!res.ok` is therefore on the OFFLINE path as often as the
  not-found one: classify with `classifySyncFailure` before concluding a record
  is gone. Setup data (the tournament's scoring rules, the penalty catalogue) is
  cached separately in IndexedDB by `offline/cached-reads.ts`; live match state
  never is.
- Manifest installs as standalone tablet app.
- The app must explicitly indicate its sync status prominently — the scorekeeper must always know. The implemented states are `idle | syncing | offline | error` (see the state machine in §10.2).

---

## 11. HEMA Ratings Integration

### 11.1 Scope (v1)

**Pull-only.** MyClash periodically syncs from HEMA Ratings:

- Fighter index (name, club, country, current rating).
- Allows organizers to **link** a MyClash fighter profile to a HEMA Ratings ID at registration time.
- Surface current rating on fighter profiles and in admin registration UI ("this fighter is rated 1450 longsword").

### 11.2 Mechanism

- Daily BullMQ cron job pulls the public dataset.
- Stored in `hema_ratings_snapshots` with timestamp.
- `fighters.hema_ratings_id` is the canonical link.
- Search: full-text search on the latest snapshot to suggest matches when registering.

### 11.3 Export format (for organizers to manually submit)

A "HEMA Ratings export" button on the event page produces a CSV / JSON in the format HEMA Ratings curators expect (to be confirmed with them). Schema:

```json
{
  "event": { "name": "...", "date": "...", "location": "..." },
  "event": { "weapon": "longsword", "category": "open" },
  "matches": [
    {
      "red": { "name": "...", "hema_ratings_id": "..." },
      "blue": { "name": "...", "hema_ratings_id": "..." },
      "phase": "pool" | "elimination",
      "winner": "red" | "blue" | "double_out",
      "red_score": 7, "blue_score": 5
    }
  ]
}
```

### 11.4 Future (v2+)

Direct API push if/when HEMA Ratings exposes one.

---

## 11bis. Workshops Module

### 11bis.1 Concept

Many HEMA events run **workshops in parallel** with the competition (technique, source study, conditioning, judging seminars). MyClash treats workshops as first-class entities, not as bolted-on schedule items.

A user can be a **competitor** AND a **workshop attendee** AND a **referee** at the same event — these personas are non-exclusive.

### 11bis.2 Domain model

- **Workshop** = the thing being taught (title, description, instructor, level, language, capacity, category).
- **WorkshopSession** = a concrete time-and-place instance. A single Workshop can have multiple sessions (Saturday 10:00 AND Sunday 14:00).
- **WorkshopEnrollment** = a user's intent to attend a session. Capacity-managed: when full, new enrollments go to waitlist.

### 11bis.3 Schedule conflict detection

When a user views their **My Schedule**, the system computes their personal schedule items in priority order:

1. **Match assignments** (as competitor) — hard, cannot reschedule.
2. **Referee assignments** — hard, cannot reschedule.
3. **Workshop enrollments** — soft, user choice.

For any pair `(item_a, item_b)` where time ranges overlap, the UI flags a **conflict**. Workshops are flagged with explicit "Conflicts with Match #L1-P3-M5" annotations. The user can:

- Cancel the workshop enrollment.
- Acknowledge the conflict (warning persists, but user proceeds).

**Schedule resolution algorithm (server side):**

```ts
async function getUserSchedule(userId: string, eventId: string): Promise<ScheduleItem[]> {
  const matches = await getCompetitorMatches(userId, eventId);
  const refereeAssgs = await getRefereeAssignments(userId, eventId);
  const workshops = await getEnrolledWorkshopSessions(userId, eventId);

  const items: ScheduleItem[] = [
    ...matches.map(toScheduleItem),
    ...refereeAssgs.map(toScheduleItem),
    ...workshops.map(toScheduleItem),
  ];

  // Annotate conflicts: any two items with overlapping [starts_at, ends_at]
  for (const a of items)
    for (const b of items) {
      if (a.id !== b.id && rangesOverlap(a, b)) {
        a.conflicts.push(b.id);
      }
    }

  return items.sort(byStartTime);
}
```

Match times for conflict detection use a **buffer** (e.g. ±15 min) since match start times are estimates.

### 11bis.4 Capacity management

- `workshops.capacity` = max attendees per session (NULL = unlimited).
- New enrollment when seats remain → `status='confirmed'`.
- New enrollment when full → `status='waitlisted'` with `position=N`.
- When a confirmed enrollment cancels → top of waitlist auto-promotes (BullMQ job, sends notification).
- Organizer can manually promote/demote.

### 11bis.5 Public discovery

- `/e/[eventSlug]/workshops` — browsable workshop catalog with filters (day, category, language, level, instructor).
- Workshop detail page with description, instructor bio, sessions, "Add to my schedule" button.
- Anonymous browsing allowed; enrollment requires login.

### 11bis.6 Organizer admin

- Admin UI for creating workshops, adding instructors, scheduling sessions.
- Drag-drop session scheduler showing Lices + venue rooms in a single timeline.
- Roster view per session (confirmed, waitlisted), with check-in.
- Cancel session → all enrollees notified (push + email).

---

## 11ter. Push Notifications

### 11ter.1 Scope (v1)

Web Push (VAPID), no native app. Users opt in from their profile screen. Preferences stored in `notification_preferences`.

### 11ter.2 Triggers

| Event                               | Default lead time | Toggleable |
| ----------------------------------- | ----------------- | ---------- |
| Your match starts                   | 10 min before     | yes        |
| Your refereeing slot starts         | 10 min before     | yes        |
| Your workshop starts                | 15 min before     | yes        |
| Your match assignment changed       | immediate         | yes        |
| Workshop you enrolled in cancelled  | immediate         | always on  |
| Promoted from waitlist to confirmed | immediate         | always on  |
| Final results published             | immediate         | yes        |
| Organizer event broadcast           | immediate         | global     |

### 11ter.3 Implementation

- BullMQ scheduled jobs ("delayed jobs") created when a match/session schedule changes.
- Job picks the user's `push_subscriptions`, sends via `web-push` library with VAPID keys.
- Offline-tolerant: if a user's device is offline, the push is queued by the OS; delivered on reconnect.
- Falls back to email for users with `enabled=false` for push but who opted in to email.
- Organizers can send event-scoped broadcasts with severity `info`, `warning`, or `alert` to all event Persons, fighters, referees, fighters+referees, or selected Persons. Broadcasts persist in `event_broadcast_notifications` and `event_broadcast_recipients`; claimed users get push first, while unclaimed/no-push recipients receive email fallback.
- Broadcasts may include `tournamentId` for tournament-scoped fighter/referee targeting. Pool/bracket publish flows use this to open editable "ready" notification drafts without auto-sending.
- **Scheduling alone is not enough.** A delayed job carries the time the schedule had when it was
  enqueued, so every subsequent reschedule leaves a stale alert in the queue.
  `apps/api/src/modules/notifications/match-alert-refresher.service.ts` is the reconciliation half:
  it re-derives the alerts a match should have and drops the ones it should not. Anything that
  moves a match in time has to go through it.

---

## 11quater. Pool Population & Referee Assignment

This is a v1 feature. The organizer admin gets two assistant tools — pool populator and referee assigner — both **constraint-driven and configurable**, both producing **assignments + a feasibility report** so the organizer always knows what worked, what failed, and why.

### 11quater.1 Pool Populator — not built

The version of this section that stood here specified an algorithm (`K = max(50, fighters * 2)`
iterations), an endpoint (`POST /events/:id/populate-pools`) and a UI (`/pool-populator`, with
live cost recomputation on drag). **None of the three exists in the repo.** It was a design
sketch presented as a shipped v1 feature, which is worse than an absent section.

Pools are generated today by `apps/api/src/modules/phases/` — see `berger.ts` for the round
construction and the pool match labels.

### 11quater.2 Referee Assignment

The hardest piece.

**A role IS a `referee_skills.id` — there is no fixed set of three.** Migration `0041` introduced
the `referee_skills` table and `0042_referee_qualifications_role_open.sql:6` dropped the `CHECK`
that had pinned `role` to three literals, so a federation can define its own. `0060_staffing_slot_config.sql`
then replaced the hard-coded trio with a **config-driven slot list**: each `(tournament, phase_type)`
carries 1..6 slots, each slot allowing one or more skill ids. `StaffingService.getResolvedConfig`
resolves in three steps:

1. `tournament_slot_config` rows for `(tournament, phase_type)`
2. `event_slot_config_default` rows for `(event, phase_type)`
3. a hard-coded floor of three slots — `arbitre_declarant`, `arbitre_assesseur`, `arbitre_table`

Step 3 is why the legacy trio still appears everywhere: it is the fallback for events that never
open the Staffing tab, not the model. Anything that assumes exactly three roles is reading the
floor and mistaking it for the rule.

| Floor role (canonical code) | French display    | English gloss                            |
| --------------------------- | ----------------- | ---------------------------------------- |
| `arbitre_declarant`         | Arbitre déclarant | Lead/Director referee                    |
| `arbitre_assesseur`         | Arbitre assesseur | Assessor referee                         |
| `arbitre_table`             | Arbitre de table  | Table referee (timing/scoring oversight) |

A user has zero or more `referee_qualifications` rows per event, each naming a skill id. `rating=5`
is highly trusted; `rating=1` is novice. `referee_assignments.role` also stores a skill id, which is
why `0060` needed no data migration.

**Match-level assignment is a separate concern.** `apps/api/src/modules/referees/referee-match-assignments.*`
serves `GET events/:eventId/referee-match-assignments` — a referee assigned to one bout rather than to
a pool or a lice. Compensation counts it as 1, where a pool assignment expands to every completed match
in the pool.

**Inputs:**

- The pool schedule (every `(pool_id, lice_id, starts_at, ends_at)` tuple).
- The event's match schedule (so we know when each fighter is on the piste).
- All `referee_qualifications` for the event.
- All workshop enrollments per user (soft conflict).
- `pool_assignment_settings`.

**Hard constraints** (assignment is rejected if violated):

- A fighter cannot referee a pool whose time overlaps with a match they're fighting in. (`enforce_fighter_referee_no_overlap`)
- A user must hold an active `referee_qualifications` row for the role being assigned.

**Soft constraints** (cost function, configurable on/off):

- **No back-to-back referee duties.** If `enforce_referee_no_back_to_back=true`, assigning the same user to two consecutive pool slots on the same Lice incurs high cost. `referee_rest_min_slots` controls the gap (default 1).
- **Dedicated referee rest.** Same constraint applies even to users with no fighter registration, when `enforce_dedicated_referee_rest=true`.
- **Workshop conflict.** If the user has a confirmed workshop session in the same time window, cost increases (warning, not rejection).
- **Prefer high-rated referees.** When `prefer_high_rated_referees=true`, candidates are sorted by `rating` descending before being assigned.
- **Workload balance.** Across the event, distribute refereeing duties evenly among qualified users.

**Algorithm (greedy with backtracking):**

```
1. Build the schedule grid: list of (pool_id, role, slot_start, slot_end) cells.
2. Sort cells by constraint tightness (fewest eligible candidates first).
3. For each cell:
   a. Get candidates: users with active qualification for this role.
   b. Filter HARD-conflicted candidates (fighter in this pool's matches at this time).
   c. Score remaining candidates:
        score = rating_weight * rating
              - back_to_back_penalty (if assigned to adjacent slot)
              - workload_penalty (more existing assignments = higher penalty)
              - workshop_conflict_penalty (if soft conflict)
   d. Assign top-scored candidate; record any soft-conflicts in `conflicts_jsonb`.
   e. If no candidates: leave UNASSIGNED, continue.
4. Optional backtracking: if N cells unassigned, try reordering and retry once.
5. Return assignments + missing-role report.
```

**Output:**

- Assignments persisted to `referee_assignments` with `auto_assigned=true`.
- A **missing-role report**, structured for the admin UI:
  ```json
  {
    "assigned": 18,
    "missing": [
      {
        "pool_id": "...",
        "pool_label": "Longsword Pool A",
        "lice": "Lice 1",
        "starts_at": "2026-05-09T10:30:00Z",
        "role": "arbitre_assesseur",
        "candidates_considered": 4,
        "rejection_reasons": {
          "fighter_overlap": 2,
          "back_to_back": 2,
          "no_qualified_users": 0
        }
      }
    ],
    "warnings": [
      {
        "assignment_id": "...",
        "type": "workshop_conflict",
        "details": "Conflicts with workshop 'Sword & Buckler intro' at 11:00"
      }
    ]
  }
  ```
- Manual override is always available — the admin can drag any qualified user into any cell; the system recomputes warnings live.

### 11quater.3 Iteration loop

The auto-assign is **one-click + always overridable**. The expected workflow:

1. Organizer clicks "Auto-assign referees".
2. UI shows: assigned cells (green), warning cells (amber, with reason on hover), unassigned cells (red, with rejection reasons).
3. Organizer fixes red cells manually, ignores or fixes amber cells.
4. When done, clicks "Lock assignments" — referee_assignments rows transition to `assigned`, push notifications go out (subject to user prefs).

### 11quater.4 Referee rating maintenance

- Qualifications and ratings are **per event** (a referee may be `rating=5` for `arbitre_table` at one event, `rating=3` at another with a stricter organizer).
- The organizer admin has a "Referee Pool" page where they can:
  - Add/remove qualified users.
  - Set role(s) per user.
  - Set rating per role per user.
  - Add notes.
- A platform-level `referee_qualifications_global` view aggregates ratings across events to suggest defaults when adding a referee to a new event. (Implementation deferred — heuristic average of last N events.)

---

## 11sexies. Bracket Auto-Advance

### 11sexies.1 Overview

When a match completes, `BracketAdvanceService.onMatchCompleted(matchId)` fires automatically (fire-and-forget, errors logged). It looks up the match's `bracket_slot_id`, resolves the slot's position within the phase, and writes the winner (and loser, for bronze/LB routes) into downstream `bracket_slots`. When both sides of a slot are filled, a new `scheduled` match is created for that slot. This gives referees a zero-touch experience: complete match → next match appears automatically.

### 11sexies.2 Bracket types

Single-elimination defaults to arbitrary-size play-ins for non-power-of-two fields. For `n` qualified fighters, the main bracket is the largest power of two below `n`; `n - p` round-0 play-in matches are created from the lowest seeds, and the highest `p - (n - p)` seeds enter the main bracket directly. Example: 18 fighters create two play-ins (`15v18`, `16v17`) feeding the seed-15 and seed-16 slots in the Round of 16. Explicit `bracketSize` keeps the legacy power-of-two bye-slot behavior. Main elimination brackets are capped at 128 slots.

| Type          | Description                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `single_elim` | Standard single-elimination with bronze medal match. `source_a_type = 'loser_of'` on bronze.                                                                                     |
| `double_elim` | Double-elimination: WB (rounds 1..wbRounds), LB (rounds wbRounds+1..wbRounds+lbRounds), GF (wbRounds+lbRounds+1). Optional reset. `wbRounds`/`lbRounds` in `phases.config_json`. |

### 11sexies.3 Ref string format

Slot references stored in `bracket_slots.source_a_ref` / `source_b_ref`:

| Phase type          | Format                                | Example   |
| ------------------- | ------------------------------------- | --------- |
| `single_elim`       | `R{r}P{p}`                            | `R2P3`    |
| `double_elim` WB    | `WBR{r}P{p}`                          | `WBR1P4`  |
| `double_elim` LB    | `LBR{k}P{p}` (k = LB-round 1-indexed) | `LBR2P1`  |
| `double_elim` GF    | `GF`                                  | `GF`      |
| `double_elim` Reset | `GFRESET`                             | `GFRESET` |

`BracketAdvanceService.buildSelfRef()` constructs the current slot's ref; `advanceFromSlot()` queries `bracket_slots WHERE source_a_ref='winner of {ref}' OR source_b_ref='loser of {ref}'`.

### 11sexies.4 Configuration flags (`phases.config_json`)

- `autoAdvance` (boolean, default `true`): when `false`, the service exits immediately — every slot must be filled via the override endpoint.
- `grandFinalReset` (boolean, default `false`): when `true`, a RESET slot is generated in the double_elim bracket structure.
- `wbRounds`, `lbRounds` (numbers): stored at bracket generation time for double_elim phases.

### 11sexies.5 Override endpoint

```
PATCH /api/v1/bracket-slots/:slotId   [organizer+]
Body: { registrationAId?: string | null, registrationBId?: string | null }
```

Setting a value to `null` cancels the assignment and voids the downstream match if it hasn't started. This gives organisers full control on top of automatic advancement.

### 11sexies.6 Bye handling

Bye slots (`source_b_type = 'bye'`) have `registration_a_id` pre-filled by the generator. `advanceByeSlots(phaseId)` runs immediately after bracket generation to propagate seeded fighters into their downstream slots so round-2 matches can form as soon as the other seed completes.

---

## 11quinquies. Following & Public Profiles

A user — anonymous, guest, or claimed — can search for any fighter or referee in the event, view their schedule and results, and follow them to build a personal "watchlist." This is the mechanism behind the **Accompanist** persona and is also useful for any user who wants to track friends, students, or rivals.

### 11quinquies.1 Privacy model

Three categories of information, three different defaults:

| Information                                    | Visibility                                           | Why                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Match schedule** (when, where, against whom) | Always public                                        | Happens at the piste in front of everyone                                               |
| **Referee assignments** (when, where, role)    | Always public                                        | Same — happens in shared space                                                          |
| **Workshop enrollments**                       | Public by default; opt-out available                 | Workshops are part of the event's shared experience; users who want privacy can opt out |
| **Email address**                              | Always masked publicly; full visible only to oneself | Anti-harvesting                                                                         |
| **Following relationships**                    | Private; never shown to the followed person          | Avoids implied social relationships                                                     |

Persons can opt out of being followed entirely (`person_privacy.allow_being_followed = false`). When that flag is set, their public profile remains visible (you can still find them and see their schedule) but the Follow button is hidden.

### 11quinquies.2 Following capabilities by tier

| Capability                                            | Anonymous                | Guest                    | Claimed                  |
| ----------------------------------------------------- | ------------------------ | ------------------------ | ------------------------ |
| View any person's public profile                      | ✅                       | ✅                       | ✅                       |
| View any person's match schedule                      | ✅                       | ✅                       | ✅                       |
| View any person's referee schedule                    | ✅                       | ✅                       | ✅                       |
| View their own workshop schedule                      | n/a                      | ✅                       | ✅                       |
| View someone else's workshop schedule                 | ✅ unless they opted out | ✅ unless they opted out | ✅ unless they opted out |
| Follow someone (build a watchlist)                    | localStorage only        | server, this device      | server, cross-device     |
| Push notification when followed person's match starts | ❌                       | ❌                       | ✅ (opt-in per follow)   |
| Manage privacy preferences                            | n/a                      | n/a                      | ✅                       |

The localStorage-only path for anonymous users is intentional — it gives a quality-of-life feature without lying about cross-device sync. To get sync, the user upgrades to guest by picking their own name on onboarding. To get push notifications, they claim.

### 11quinquies.3 Guest-to-claimed migration

When a guest session is upgraded to claimed via magic link:

```
BEGIN;
  UPDATE follows
     SET follower_user_id = :new_user_id,
         follower_guest_session_id = NULL
   WHERE follower_guest_session_id = :guest_session_id;
  -- (also: workshop enrollments, push subscriptions, persona selections)
COMMIT;
```

This happens atomically in the claim handler so the user never "loses" their follow list. If the participant has guest sessions on multiple devices and claims from one, all those sessions' follows merge into the claimed account. Subsequent guest sessions on new devices are ignored once the Person is claimed (the device pulls the canonical follow list from the server instead).

### 11quinquies.4 Public profile page

`/e/<eventSlug>/people/<personId>` — accessible to anyone. Shows:

- Name, club, photo (if uploaded), HEMA Ratings (if linked).
- Role badges: Competitor / Referee / Workshop lead — based on what's actually true for this event.
- **Today's items** — next match, next referee slot, currently-running match (with live score).
- **Schedule** — full chronological list of matches + referee slots (+ workshops only if shared).
- **Results** — pool standings, elimination progress, summary stats from the lyonamhe.fr-style stats module.
- **Follow button** — prominent if `allow_being_followed = true`; hidden otherwise.

### 11quinquies.5 People search

`/e/<eventSlug>/people` — list/search interface. Same fuzzy lookup as onboarding (T-104b) but returns the richer public payload:

```json
{
  "id": "...",
  "given_name": "Jean",
  "family_name": "Dupont",
  "club_label": "Lyon AMHE",
  "photo_url": null,
  "role_badges": ["competitor", "referee"],
  "next_event_at": "2027-05-09T10:30:00Z",
  "follow_state": "not_following" | "following" | "blocked"
}
```

Filters: by role (competitor / referee / workshop lead / instructor), by club, by event.

### 11quinquies.6 The watchlist view

`/e/<eventSlug>/following` (or as a filter in `/my-schedule`) — list of all followed Persons with their next/current item:

- Avatar, name, club.
- Live state: `Live now (Lice 2)` / `Next: Pool A · 11:15 · Lice 1` / `Done — see results`.
- Recently-finished matches show a 5-minute "Just won 7-3 vs Marie L." sticky.
- Tap → that person's public profile.

Always sorted by upcoming time, then by live state. Refreshed via the same realtime channels that drive the live Lice view.

### 11quinquies.7 Follow notifications (claimed users only)

When a followed Person's match is scheduled to start within `notify_lead_time_minutes` (default 10), a web push notification is sent:

> 🔔 **Jean Dupont fights in 10 min** — Pool A vs Marie Lefèvre on Lice 2

Same scheduling mechanism as the user's own match notifications (BullMQ delayed jobs). Idempotent on `(user_id, match_id, notification_kind)` so rescheduling a match doesn't duplicate.

Per-follow toggles (set on the Follow button's "..." menu):

- ☑ Notify me when their match starts
- ☐ Notify me when their referee slot starts
- ☐ Notify me when their workshop starts (only if they share workshops)

---

## 12. Authentication & Identity

MyClash uses a **two-tier identity model**: organizer-created Persons (the canonical roster) and Supabase Auth users (people who have claimed their profiles). Most participants never need to claim — they get the full event experience as guests.

### 12.1 The model

**Person** — created by the organizer. Holds name, email, club, optional HEMA Ratings link. Lives in `persons` table, scoped to one event. The Person row exists _before_ the user ever touches the app.

**Guest session** — created when a participant types their name, finds themselves in the roster, and confirms. Lives in `guest_sessions`, bound to one Person, stored as a signed httpOnly cookie + server row. Lasts until event end + 7 days.

**Claimed account** — created when the participant clicks a magic link sent to the email the organizer registered. Joins `persons.claimed_by_user_id` to a Supabase `auth.users` row. Persists across events and devices.

The progression is opt-in at every step, and most participants stop at Guest:

```mermaid
stateDiagram-v2
  [*] --> Anonymous: opens a public event page
  Anonymous --> Guest: finds own name in the roster<br/>(signed httpOnly cookie + guest_sessions row)
  Guest --> Claimed: clicks the magic link sent<br/>to the organiser-registered email
  Anonymous --> Claimed: logs in directly on a new device
  Claimed --> Claimed: any device, any event

  note right of Anonymous
    Read-only: schedule,
    brackets, results
  end note
  note right of Guest
    "My next match", workshop
    enrolment, referee confirm.
    One device — no sync.
  end note
  note right of Claimed
    Crosses devices, edits own
    profile, can hold org roles
  end note
```

The line between Guest and Claimed is drawn at **anything that crosses devices or grants editing
rights** — see the capability matrix in §12.2.

**Runtime identity resolution.** Those three product-level tiers map onto four identity kinds the global
`AuthGuard` resolves on every request ([`auth.guard.ts`](../apps/api/src/common/auth/auth.guard.ts)). A
fourth kind, `staff`, has no place in the progression above: it is an event-scoped scorekeeper/referee
login issued from a PIN, not a participant identity.

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant G as AuthGuard (global)
  participant S as SupabaseService
  participant H as Route handler

  C->>G: request
  Note over G: identity is resolved ALWAYS,<br/>before the @Public() check
  G->>S: Bearer token? verify JWT locally
  alt valid access token
    S-->>G: claimed { userId, email }
  else guest cookie verifies
    G-->>G: guest { guestSessionId, personId, eventId }
  else staff cookie verifies
    G-->>G: staff { staffId, eventId }
  else nothing verifies
    G-->>G: anonymous
  end
  G->>G: attach identity to request

  alt identity is not anonymous
    G->>H: allow
  else route is @Public()
    G->>H: allow
  else AUTH_GUARD_MODE=enforce
    G-->>C: 401 Authentication required
  else shadow (default)
    G->>G: log "would-401"
    G->>H: allow
  end
```

Three details that matter:

- **Precedence is claimed → guest → staff.** The first mechanism that verifies wins; an expired or
  forged cookie falls through to the next rather than failing the request.
- **Identity is resolved before `@Public()`, never after.** `@Public()` gates only the _throw_, which
  keeps `identity` a total function on every request. Short-circuiting earlier would leave it undefined
  on the highest-traffic routes and let a later `identity ?? anonymous` quietly reinstate fail-open.
- **The guard verifies the access token locally**, without a GoTrue round-trip. The round-trip (with
  local-JWT fallback on GoTrue outage) lives in `SupabaseService.getAuthUser`, used where freshness
  matters — see §12.5.

`AUTH_GUARD_MODE` defaults to `shadow`: the guard logs what it _would_ have rejected instead of
rejecting, so the enforcement flip can be made once the would-401 log is clean.

### 12.2 Capability matrix

| Capability                                  | Anonymous | Guest             | Claimed              |
| ------------------------------------------- | --------- | ----------------- | -------------------- |
| Browse public schedule, brackets, results   | ✅        | ✅                | ✅                   |
| See "my next match", "my pool"              | ❌        | ✅                | ✅                   |
| Enroll/cancel workshop sessions             | ❌        | ✅                | ✅                   |
| Confirm/decline referee assignment          | ❌        | ✅                | ✅                   |
| Mark favorite fighters (accompanist)        | ❌        | ✅ (this device)  | ✅ (synced)          |
| Subscribe to push notifications             | ❌        | ✅ (this device)  | ✅ (cross-device)    |
| Use a second device                         | ❌        | ❌ (re-pick name) | ✅ (login link)      |
| Edit own profile (display name, bio, photo) | ❌        | ❌                | ✅                   |
| Change login / roster email                 | ❌        | ❌                | ✅ (new-email link)  |
| Promote Person → global Fighter profile     | ❌        | ❌                | ✅                   |
| See full email address (instead of mask)    | ❌        | ❌                | ✅ (own only)        |
| Access organizer admin                      | ❌        | ❌                | ✅ (if granted role) |

The line between Guest and Claimed is deliberately drawn at **anything that crosses devices or grants editing rights**. Casual users never need to claim. Power users get a one-time magic link.

### 12.3 First-arrival flow (the critical UX)

1. Participant opens `app.myclash.fr/e/<event>` on their phone.
2. Onboarding asks: "What's your name?" (single text input, not separated into first/last — easier on mobile).
3. As they type, the app debounces and queries the lookup endpoint:
   ```
   GET /api/v1/events/:id/persons/lookup?q=jean+dup
   →  [
        { id, given_name, family_name, club_label, masked_email },
        ...
      ]
   ```
4. Match list appears with **club name visible, email masked** (`j***@gmail.com`). The combination of name + club is sufficient to disambiguate in 99% of HEMA cases.
5. Participant taps their entry.
6. Server creates a `guest_sessions` row, sets a signed httpOnly cookie (`mc_guest=<jwt>`), returns the Person details.
7. UI: "Welcome Jean. Your matches are in the schedule. Want to get push notifications and use this profile on your tablet too? [Send me a login link] [Maybe later]"

If "Send me a login link": email goes to the organizer-registered address. Click → claimed account. From then on, no name typing, just email-based login.

### 12.4 Edge cases

**"I'm not in the list"** — the lookup endpoint returns an `[I'm none of these]` option. Tapping it surfaces:

> _Only people pre-registered by the organizer can use this app. If you should be in the list, please find an organizer at the registration desk._

This is intentional — preventing self-registration is what makes guest sessions safe. Without it, anyone could type "Pierre Lambert" and act as Pierre.

**Name collision (two Jean Dupont)** — the lookup shows both with club names. If both are at the same club, masked emails plus a creation-date hint disambiguate. Worst case: force the magic link.

**Spelling variations** — the lookup uses fuzzy matching (Postgres `pg_trgm` similarity). "jean" finds "Jean", "Jéan", "Jean-Pierre". The organizer's CSV import should normalize accents (`unaccent`) on the lookup side, but preserve the original spelling for display.

**Switching devices as a Guest** — the participant types their name again on the new device. They get a fresh guest session on Person X. Push subscriptions are per-session (per-device), so each device subscribes independently. That's fine — Guest is explicitly "this device only."

**Email typos by the organizer** — if the participant's email in the roster is wrong, they can't claim. The organizer admin has an "edit person" form. After a participant has claimed a profile, they can change their login/roster email through `/e/<eventSlug>/profile/email`; the new email must confirm by link before Supabase Auth and all claimed Person rows are updated.

### 12.5 Implementation notes

- The lookup endpoint uses Postgres `pg_trgm` indexes on `unaccent(given_name)` and `unaccent(family_name)`.
- Guest session JWTs are signed with a separate secret from Supabase auth (`MYCLASH_GUEST_JWT_SECRET`) to keep them strictly bounded — they never grant access to anything beyond their Person.
- All admin actions (organizer/super) require **Supabase claimed accounts** with the appropriate `OrganizationMembership` row. Guest sessions cannot administer anything, ever.
- Email masking: show first character + asterisks + domain first character + `***` + TLD. `jean.dupont@gmail.com` → `j***@g***.com`.
- RLS policies key off `auth.uid()` for claimed actions and a JWT claim `mc_guest_person_id` for guest actions.

### 12.5bis Authorization on the write path — where the boundary actually is

**`AuthGuard` is authentication only.** A 200 from it means "we know who you are", never "you may
do this". It is global, so every route needs identity unless marked `@Public()`.

Authorization lives in the service layer, behind `assertOrgRole` — and this is the part that is
easy to get wrong: **every event-scoped write goes through the service-role Supabase client, which
is `BYPASSRLS`.** RLS does not apply on that path. The service-layer assertion is not defence in
depth; it is the whole boundary. A write that skips it is unguarded, whatever the table's policies
say.

`apps/api/src/common/auth/event-authz.ts` is the shared form, resolving the org from the row rather
than trusting the request. `MANAGE_EVENT_ROLE` is `'editor'`.

**There is no platform-role bypass, deliberately.** A platform admin who is not a member of the org
is refused, matching staff, leagues and workshops. `events.assertOwnerOrSuperAdmin` is not a
counter-example — that guards ruleset re-pinning, a `super_admin`-exact data-integrity override.
An admin who must edit a customer's schedule gets added to the organisation.

Two related failure modes worth knowing: `@PlatformRole` on a `GET` is a silent no-op, and a guard
that resolves the event by a params **name** fails open on a route that spells the param
differently. `apps/api/src/common/event-readonly/` resolves by path for exactly that reason —
`EventReadonlyGuard` blocks writes to archived and completed events, with
`@AllowOnArchived()` / `@BlockOnCompleted()` as the deliberate exceptions.

### 12.6 Roles (unchanged from earlier draft)

```
PlatformRole:
  - super_admin     : you; full platform access
  - none            : default

OrganizationRole:
  - owner           : full org control, billing (future), member mgmt
  - admin           : event creation, all org events
  - editor          : assigned events only
  - scorekeeper     : assigned Lices only (records exchanges)
  - referee         : assigned Lices/matches (calls actions on the piste)
  - workshop_lead   : can edit workshop content for assigned workshops
  - read_only       : view-only access (e.g. press, partners)

ImplicitRole (no row needed, derived from claim status + relations):
  - competitor      : Person has registrations in this event
  - workshop_attendee : Person has workshop_enrollments in this event
  - public          : anonymous or unclaimed without other roles
```

OrganizationRole grants always require a **claimed** account. They are never given to guest sessions.

### 12.7 Authentication mechanisms (v1)

- **Magic link via SMTP** (Supabase Auth) — primary mechanism for claimed accounts. Used for organizer login, super admin, and Person claim. Email is the canonical identity.
- **Email + password** (Supabase Auth) — also enabled for organizer accounts, for users who prefer a password to magic-link emails. Available at signup and login.
- **Guest session** (signed cookie + server row) — for participants who only want to find their schedule.
- **Google OAuth** — **deferred**, not in v1. Magic link covers the same use case without requiring 2–4 weeks of Google verification review.

### 12.7bis Organizer signup (open)

**Anyone can sign up to become a event organizer.** No invitation required, no super-admin approval gate at signup time. Super admin retains the power to suspend or remove organizer accounts post-hoc (see §12.7ter).

**Signup flow** (at `https://admin.myclash.fr/signup`):

1. User chooses a method:
   - **Magic link**: enters email + display name → receives link → click → account created.
   - **Email + password**: enters email + display name + password → account created → email verification link sent (must verify before creating events).
2. On account creation, the system **auto-creates a personal Organization** with:
   - `slug`: derived from display name (`jean-dupont`, with collision handling).
   - `name`: `"<display_name>'s organization"` (the user can rename it any time).
   - `status`: `active` (no manual approval needed).
   - The user becomes the `owner` of this Organization (`organization_members.role = 'owner'`).
3. They land on the org dashboard at `/org/<slug>` ready to create their first event.

**What an organizer can do** without further approval:

- Create one or more **Events** (the multi-day gathering, e.g. "FAL 2026") — _terminology TBD pending owner decision_.
- Within each event, create competitions, workshops, schedule, venue.
- Import the participant roster (manual + CSV).
- Run the event end-to-end (registrations → pools → brackets → scoring → results).
- Invite team members to their organization (admin, editor, scorekeeper, referee — see §12.6 roles).

**What an organizer cannot do**:

- See or edit any other organization's data.
- Modify global Fighter profiles created by other organizations (only the organization that originated a Person can edit its details; once the Person is claimed and promoted to a global Fighter, the Fighter is editable by the claimed user).
- Bypass platform-wide RLS policies.

**Default `OrganizationRole.owner` capabilities** include creating events, theming, importing rosters, generating brackets, scoring (or assigning scorekeepers), publishing results, exporting to HEMA Ratings format. They are the admin of their own events.

### 12.7ter Super admin — organizer management

The super admin (project owner) has a dashboard at `https://admin.myclash.fr/admin/organizations` to manage all organizer accounts:

- **List**: every organization with member count, event count, last activity, status.
- **Inspect**: drill into any org to see members, events, and audit log entries.
- **Actions**:
  - **Suspend** an organization (`status = 'suspended'`) — its events become read-only-public; members cannot create new content, but existing data stays visible.
  - **Reactivate** a suspended organization.
  - **Delete** (hard) — for spam / abuse cases. Cascades to events, but global Fighter profiles and Persons that have been claimed by users are preserved (re-attached to a "deleted org" placeholder for data integrity).
  - **Promote a user to super admin** (granting `platform_roles.role = 'super_admin'`).
  - **Reset organization owner** — if the original owner loses access, super admin can re-assign ownership to another member.

**No automatic approval gate at signup** means super admin's job is reactive moderation, not bottleneck approval. This is acceptable because:

- Email verification deters bots.
- Suspending a bad actor is fast (one click, immediate effect).
- Real HEMA events are a small community; bad actors are rare and easily identified.

### 12.7quater User account types — summary

| Account type              | How created                                       | Capabilities                                                                |
| ------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------- |
| **Anonymous**             | No account                                        | Public reads, localStorage follows                                          |
| **Guest**                 | Picked self from organizer's roster               | Per-event guest capabilities                                                |
| **Claimed (participant)** | Magic link to organizer-registered email          | Cross-device, edit own profile                                              |
| **Organizer**             | Self-signup (magic link or email+password)        | Owns one organization, can create events                                    |
| **Organizer team member** | Invited by an existing organizer                  | Per-org role: admin, editor, scorekeeper, referee, workshop_lead, read_only |
| **Super admin**           | Promoted by another super admin (or DB bootstrap) | Platform-wide moderation                                                    |

The Claimed-Participant and Organizer paths can converge: a Person who claims their profile on event day is a "claimed account"; if they later self-sign-up as an organizer at a different event, the same `auth.users` row is reused.

### 12.8 CSV import for the organizer roster

The organizer admin imports persons via a two-pass wizard:

1. **Preview** (`POST /api/v1/events/:eventId/persons/import/preview`) — dry run, no writes.
2. **Commit** (`POST /api/v1/events/:eventId/persons/import`) — applies, accepts optional `decisions[]` JSON field.

**CSV columns (email optional since T-1208):**

```csv
given_name,family_name,email,club,club_abv,club_city,hema_ratings_id,event_codes,roles
Jean,Dupont,jean@example.com,Lyon AMHE,LAMHE,Lyon,12345,longsword-open,competitor
Marie,Lefèvre,,Cercle PRMD,CPRMD,,,,competitor
Pierre,Martin,,,,,,,referee
```

- `email` is **optional**; when absent, duplicate detection falls back to case-insensitive full-name match.
- `club_abv` — short abbreviation (e.g. `DFDA`). Club lookup: exact abbreviation match > trigram name similarity ≥ 0.85 (`high`) > ≥ 0.40 (`medium`) > auto-create unverified.
- `club_city` — stored on auto-created clubs.
- `event_codes` are semicolon-separated event slugs; auto-creates a registration row per code.
- `roles` semicolon-separated set: `competitor`, `referee`, `workshop_lead`.

**Preview response shape (`ImportPreviewResponse`):**

```json
{
  "summary": { "toCreate": 42, "toLink": 3, "duplicates": 1, "invalid": 1 },
  "newClubs": ["Hammaborg"],
  "rows": [
    {
      "index": 0,
      "givenName": "Jean",
      "familyName": "Dupont",
      "email": "jean@example.com",
      "status": "ok",
      "clubResolution": {
        "confidence": "exact_abv",
        "resolvedName": "Lyon AMHE",
        "abbreviation": "LAMHE"
      },
      "globalPersonMatch": {
        "id": "...",
        "displayName": "Jean Dupont",
        "clubName": "Lyon AMHE",
        "abbreviation": "LAMHE",
        "email": "j***@gmail.com"
      },
      "defaultAction": "link"
    }
  ]
}
```

When a row has `globalPersonMatch`, the organizer can override `defaultAction` (`link` | `create_new`) before committing. The `decisions[]` array is sent as a JSON form field alongside the re-uploaded file.

**Commit response shape (`CsvImportReport`):**

```json
{
  "created": 44,
  "updated": 0,
  "duplicates": [{ "row": 12, "name": "Jean Dupont", "existingEmail": "j***@gmail.com" }],
  "invalid": [{ "row": 18, "reason": "Missing given_name", "raw": ",Martin,,,,," }],
  "newClubsForReview": ["Hammaborg"]
}
```

Manual creation uses the same form, single-row, in `/org/[orgSlug]/events/[eventId]/persons/new`.

---

## 13. Per-Event Theming

### 13.1 Scope

Each event can customize:

- Logo, hero image, favicon.
- Color palette (primary, secondary, accent, background).
- Display font (the prototype uses Cinzel; allow per-event override).
- Event-specific landing copy (Markdown).
- Custom pages (history, location, partners, media kit) — Markdown with frontmatter.
- Club directory (curated list of nearby clubs with descriptions, like the prototype).
- "Discipline" pages (history of longsword, sidesword, etc.) — Markdown.

### 13.2 URL shape

- Event public site: `/e/{event-slug}`
- Tournament page: `/e/{event-slug}/t/{tournament-slug}`
- Match page: `/e/{event-slug}/match/{match-id}`
- Lice live view: `/e/{event-slug}/lice/{lice-name}`
- Fighter profile (in event context): `/e/{event-slug}/fighters/{fighter-slug}`

(See §15.1 for the authoritative route tree.)

Global (cross-event):

- Fighter profile: `/fighters/{slug}`
- Club: `/clubs/{slug}`
- Events index: `/events`

### 13.3 Implementation

- Theme stored in DB (`themes` table).
- CSS variables injected at the layout level for the `/e/[eventSlug]/...` route group.
- Custom CSS field (sandboxed, vetted) for advanced tweaks.

---

## 14. API Surface

### 14.1 Style

- REST for CRUD, JSON request/response.
- WebSocket gateway (NestJS `@WebSocketGateway`) for scoring events that need bi-directional flow.
- All endpoints versioned under `/api/v1/...`.
- All endpoints documented via OpenAPI (Swagger UI at `/api/docs` in dev).

### 14.2 Where the endpoints are

There is no inventory here. The route surface changes weekly and a copied list of it rots
without any gate noticing — the version this replaced documented fourteen routes that had
been retired or never built (`populate-pools`, `auto-assign-referees`, `final-ranking`, five
stats endpoints) and omitted roughly forty that exist.

Three places carry the real surface, all of them derived rather than typed by hand:

- **Live**: Swagger UI at `/api/docs` in dev, generated from the running app.
- **In the repo**: every route is a decorator on a controller —
  `grep -rnE "@(Get|Post|Put|Patch|Delete)\(" apps/api/src/modules`.
- **Typed**: `packages/api-client`, generated from the OpenAPI document and held against the
  live routes by `pnpm quality:openapi-drift`.

What belongs here, because none of it is derivable from a route list:

- **Scope is the Event, not the Tournament.** Referee qualifications, staffing slot config,
  compensation and `my-schedule` are all `events/:eventId/…`. Several were tournament-scoped
  early on and moved; a `tournaments/:id/` path for any of them is a pre-migration artefact.
- **Upserts are `PUT`, not `POST` + `PATCH`.** Referee qualifications and slot config replace
  the whole set for a scope in one call.
- **`GET /events/:slug` is public and hides `test` and `club` events by design** — see the
  `event_kind` matrix (migration `0162`). A 404 there is the policy working, not a bug.
- **5xx response messages are scrubbed.** A deliberate 503 will not say why unless it carries
  the operational-exception marker, which is the only opt-out.
- **`/health` answers only on `api.${DOMAIN}`.** The global prefix exclusion is host-bound.

### 14.3 Rate limits

Enforced by `ThrottlerModule` in `apps/api/src/app.module.ts`; the shared profiles
live in `apps/api/src/common/throttling/throttle-profiles.ts`. Limits are per
client IP unless stated otherwise, and IPs listed in `THROTTLE_IP_WHITELIST` skip
all of them.

| Scope                                                                  | Limit                                                |
| ---------------------------------------------------------------------- | ---------------------------------------------------- |
| Default — every route, reads and writes alike                          | 120 req/min/IP                                       |
| Login, magic link, password-reset-confirm                              | 10 req/hour/IP                                       |
| Login **per email** — `password-login` + `public-login` share a bucket | 10 req/hour                                          |
| Signup, password-reset request                                         | 5 req/hour/IP                                        |
| Admin reads — `/admin/users`, fighter merge audit-log                  | 600 req/min/IP                                       |
| Catalog reads — `/clubs`, `/global-persons`                            | 300 req/min/IP                                       |
| Event persons lookup                                                   | 30 req/min/IP                                        |
| AI natural-language query                                              | 60/hour per (tournament, user); admin-settable 1–500 |

`req.ip` is resolved through `trustProxy: 1` on the Fastify adapter, so it is the
address Traefik observed rather than a client-supplied `X-Forwarded-For` entry.

Two limits worth knowing about: the throttler store is in-memory, so counters are
per API container and reset on every redeploy; and there is no edge-level
(Traefik) rate limiting, so the Nest guard is the only limiter in front of the API.
There are no per-user or per-org limiters, and scoring writes get the default.

---

## 15. Frontend Routes

There is no route tree here. Next.js App Router **is** the route tree: a directory under
`app/` is a route, so any copy of it is a second source of truth that drifts in silence. The
version this replaced named `/pool-populator` and `/scorekeepers` (never built), spelled the
staff segment `/lice` when it is `lices`, and omitted roughly thirty-five routes that exist.

To read the surface: `find apps/<app>/app -name 'page.tsx'`.

What is worth stating, because none of it is derivable from the directory names:

- **`web-public` is the only SSR surface.** Public event pages under `/e/[eventSlug]/…` are
  server-rendered for indexability. `web-admin` and `web-staff` are client-heavy.
- **One URL serves two languages.** `web-public` resolves the locale from the `mc_locale`
  cookie, then `Accept-Language` — there is no locale in the path, so `hreflang` cannot be
  emitted at all. A known deviation, not an oversight: `docs/design/known-deviations.md`, D10.
- **`/display/*` is a surface, not an app.** Three projector routes span `web-admin` and
  `web-public`; they share the `--color-stage` token and are documented in
  `docs/design/display-kiosk.md`.
- **`web-staff` scores at `/matches/[matchId]`, top-level** — not nested under the lice.
  `/lices` and `/lices/[liceId]` are the piste screens; both are chrome and take `chromeScope`.

---

## 16. Internationalization

**Status (as of v0.14):** English and French both shipped.

### Library

Custom `@myclash/i18n` package (`packages/i18n/`) — not `next-intl` or `i18next`. Rationale: shared across all apps (Next.js + NestJS) without a React dependency in the core translation layer.

- `packages/i18n/src/messages/{en,fr}/<namespace>.ts` — **the data**, one module per namespace per locale (fr is a **full French translation**, not an `fr = en` alias). Each `fr` module is `satisfies DeepString<typeof en<Ns>>`, so a missing or extra key is a tsc error.
- `packages/i18n/src/runtime.ts` — **the implementation, with none of the data**: `createTranslator`, `negotiateLocale`, `defaultLocale`, `LOCALE_COOKIE`, `SUPPORTED_LOCALES`. Anything that ships to a browser imports `@myclash/i18n/runtime`, because importing them from the package root drags every namespace along behind them.
- `packages/i18n/src/surfaces/{staff,public,admin}.ts` — **per-surface bundles**, exported as `@myclash/i18n/staff` / `/public` / `/admin`. Each app's client provider imports its own; that is what stops all 6,418 keys reaching every bundle. Of 6,418: staff resolves 480, public 1,765, admin 5,257.
- `packages/i18n/src/index.ts` — composes the lot and re-exports the runtime, so the package's public API is unchanged. Importing **this** pulls every namespace: correct on the server and in tests, wrong in a client module.
- `apps/{web-public,web-admin,web-staff}/src/i18n/I18nProvider.tsx` — the React context provider is **per-app** (one copy in each Next.js app), not in the package.

### ESLint enforcement

Custom `no-literal-string` rule in `eslint-rules/no-literal-string.mjs` — fails the build on any hardcoded user-facing string not routed through `t()`. A `// i18n-exempt` escape hatch exists for technical strings (error codes, test IDs).

`eslint-rules/` holds five more rules registered per app, including `no-raw-api-fetch.mjs` — the ratchet that keeps new `fetch` calls inside the `@myclash/api-client` seam. The ~867 that predate it are listed in `eslint-rules/no-raw-api-fetch-baseline.json`, which only ever shrinks; `eslint-rules/no-raw-api-fetch.test.mjs` asserts the rule fires, is switched on in all three apps, and that the list did not grow.

### Locale routing

Each Next.js app wraps its root layout with its own `src/i18n/I18nProvider`, a six-line client module binding the shared provider from `@myclash/next-i18n/client` to that app's surface, and renders `<html lang={locale}>` from `resolveServerLocale()`. `defaultLocale` is `'en'` — EN is the source/default locale; the client `useI18n()` hook is locale-aware. Multi-locale URL routing is deferred to v2.

### Adding a string

1. Add the key to `packages/i18n/src/messages/en/<namespace>.ts`
2. Add the French translation at the matching path in `messages/fr/<namespace>.ts`; every key must exist in both — the FR module is typed against the EN one, and `packages/i18n/src/t-key-references.test.ts` fails on misses either way
3. Use `t('key')` in the component via the `useI18n()` hook — never the module-level `t`, which is bound to `defaultLocale` and is banned in client components by `myclash/no-module-translator-in-client`
4. If the key belongs to a namespace a surface does not yet carry, add it to that surface in `packages/i18n/src/surfaces/`

---

## 17. Deployment (Docker Compose + Traefik)

### Topology at a glance

Three views of the production stack. They are generated from
[`infra/docker-compose.prod.yml`](../infra/docker-compose.prod.yml), which stays authoritative — the
tables in §17.1 below carry the image tags and roles, so these diagrams deliberately do not repeat them.

#### Edge and request routing

Six public hostnames fan out into 17 routers. What a flat table cannot show is **priority**: on
`app.${DOMAIN}` a request is tested against `/api/v1` (30) before `/realtime/v1/api` (25) before the
`/realtime/v1`, `/auth/v1`, `/rest/v1` and `/storage/v1` prefixes (20), and only falls through to
web-public (1) if nothing else matched.

```mermaid
flowchart LR
  NET([Internet])

  NET -->|":80 → 301 https"| TR
  NET -->|":443"| TR

  TR["<b>traefik</b><br/>TLS · Let's Encrypt<br/>GeoBlock → Fail2Ban →<br/>security-headers → compress"]

  TR --> H_MK{{"${DOMAIN}<br/>www.${DOMAIN}"}}
  TR --> H_APP{{"app.${DOMAIN}"}}
  TR --> H_ADM{{"admin.${DOMAIN}"}}
  TR --> H_SCO{{"staff.${DOMAIN}"}}
  TR --> H_API{{"api.${DOMAIN}"}}
  TR --> H_DASH{{"traefik.${DOMAIN}"}}

  H_MK -->|"all · www → apex"| MKT
  H_APP -->|"/api/v1 · 30"| API
  H_APP -->|"/realtime/v1/api · 25"| RT
  H_APP -->|"/realtime/v1 · 20"| RT
  H_APP -->|"/auth/v1 · 20 🔒"| AUTH
  H_APP -->|"/rest/v1 · 20"| REST
  H_APP -->|"/storage/v1 · 20"| STOR
  H_APP -->|"catch-all · 1"| PUB
  H_ADM -->|"/api/v1 · 30"| API
  H_ADM -->|"/scoring · 30"| SCO
  H_ADM -->|"/storage/v1 · 20"| STOR
  H_ADM -->|"catch-all · 1"| ADM
  H_SCO -->|"/api/v1 · 30 🔒"| API
  H_SCO -->|"/scoring · 30"| SCO
  H_SCO -->|"catch-all"| SCO
  H_API -->|"all"| API
  H_DASH -->|"basic-auth"| DASH["api@internal<br/>dashboard"]

  MKT["web-marketing :80"]
  PUB["web-public :3000"]
  ADM["web-admin :3000"]
  SCO["web-staff :3000"]
  API["api :4000"]
  AUTH["supabase-auth :9999"]
  REST["supabase-rest :3000"]
  RT["supabase-realtime :4000"]
  STOR["supabase-storage :5000"]
```

🔒 marks the two paths guarded by Fail2Ban. They are guarded precisely because the application-level
throttler cannot reach them: `/auth/v1` proxies straight to GoTrue without passing through NestJS, and
staff PIN login carries no `@Throttle` override (see §14.3). Port 80 exists only to redirect to 443, and
**Traefik is the only container that publishes ports**.

#### Internal service dependencies

Everything below sits on the single `myclash` bridge network and is unreachable from outside except
through Traefik.

```mermaid
flowchart TD
  subgraph EDGE["edge"]
    TR["traefik"]
  end

  subgraph APP["application"]
    PUB["web-public"]
    ADM["web-admin"]
    SCO["web-staff"]
    MKT["web-marketing"]
    API["api :4000"]
    WRK["worker<br/>(api image, --worker)"]
    OPS["ops-runner :4075"]
  end

  subgraph DATA["data + Supabase"]
    DB[("db :5432<br/>Postgres 17")]
    RDS[("redis :6379")]
    AUTH["supabase-auth :9999"]
    REST["supabase-rest :3000"]
    RT["supabase-realtime :4000"]
    STOR["supabase-storage :5000"]
  end

  TR --> PUB & ADM & SCO & MKT & API & AUTH & REST & RT & STOR

  PUB -.->|"SSR only"| API
  ADM -.->|"SSR only"| API
  SCO -.->|"SSR only"| API

  API --> DB
  API --> RDS
  API -->|"internal auth"| AUTH
  API -->|"bearer"| OPS
  WRK --> DB
  WRK --> RDS
  WRK --> AUTH

  AUTH --> DB
  REST --> DB
  RT --> DB
  STOR --> DB
  STOR -->|":3000"| REST

  OPS -->|"/var/run/docker.sock"| HOST(["Docker daemon"])
```

The dotted edges are **server-side rendering only** — via `API_URL_INTERNAL=http://api:4000`. Browser
traffic from those same apps goes back out and in through Traefik instead. That distinction matters
operationally: SSR calls arrive without an `X-Forwarded-For`, so they all share one rate-limit bucket
keyed on the calling container's address (§14.3).

`ops-runner` mounts the Docker socket and deliberately carries **no Traefik router** — it is reachable
only from inside the network, which is why the socket lives there rather than in the API container
(§17.4). `check-infra-review.mjs` fails the build if a router label ever appears on it.

#### External dependencies and persistence

```mermaid
flowchart LR
  subgraph BOOT["needed at container start"]
    LE(["Let's Encrypt<br/>ACME TLS-ALPN"])
    GH(["GitHub<br/>plugin source"])
  end

  subgraph RUNTIME["needed at runtime"]
    GEO(["get.geojs.io<br/>country lookup"])
    RSD(["Resend<br/>email"])
    SEN(["Sentry"])
    PUSH(["Web Push / VAPID"])
    HEMA(["HEMA Ratings"])
    S3(["Scaleway S3<br/>off-site backups"])
  end

  TR["traefik"] --> LE
  TR --> GH
  TR --> GEO
  API["api"] --> RSD & SEN & PUSH & HEMA
  WRK["worker"] --> RSD & SEN & PUSH & HEMA
  OPS["ops-runner"] --> S3

  DB[("db")] --- V1[["myclash-postgres-data"]]
  RDS[("redis")] --- V2[["myclash-redis-data"]]
  STOR["supabase-storage"] --- V3[["myclash-storage-data"]]
  TR --- V4[["./data/traefik<br/>acme.json + plugin cache"]]
```

The split matters for deploys. A failure in the **boot** group stops a deploy: Traefik fetches both plugin
modules from GitHub at startup (cached afterwards in `./data/traefik/plugins`) and needs Let's Encrypt for
certificates. A failure in the **runtime** group degrades a feature but leaves the site serving — with one
exception worth knowing: GeoBlock calls `get.geojs.io` for every uncached client IP, which is why the
public instance is configured to fail _open_ (see INFRASTRUCTURE_REVIEW.md § "Edge plugins").

#### How local dev differs

The dev stack (`infra/docker-compose.dev.yml`) mirrors the topology above — same services, same Traefik
routing, same plugins. The deltas:

- Self-signed certificates for `*.myclash.localhost` instead of Let's Encrypt.
- web-marketing is served at `marketing.myclash.localhost`, since the apex is taken by web-public.
- `db` and `redis` publish their ports for local tooling; the dashboard is exposed on `:8080`.
- Plugin middlewares are attached literally, with no `TRAEFIK_PLUGINS` kill-switch — dev is where a
  broken plugin config should surface.

### 17.1 Service inventory

The production stack is defined in [`infra/docker-compose.prod.yml`](../infra/docker-compose.prod.yml). That file is authoritative — this table is a navigation aid. Container names follow the `myclash-<service>` convention via the `COMPOSE_PROJECT_NAME` env var. All services share a single internal `myclash` network; only Traefik publishes ports 80/443.

| Service             | Container                   | Image / Build                              | Role                                                                                                       |
| ------------------- | --------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `traefik`           | `myclash-traefik`           | `traefik:v3.7.10`                          | TLS termination (Let's Encrypt), label-based routing, dashboard at `traefik.${DOMAIN}`.                    |
| `db`                | `myclash-db`                | `supabase/postgres:17.6.1.160`             | Primary Postgres + Supabase init scripts (auth, realtime, postgrest roles). ICU `fr-FR`.                   |
| `redis`             | `myclash-redis`             | `redis:8-alpine3.23`                       | Cache + BullMQ queue + pub/sub. 512 MB max, appendonly.                                                    |
| `supabase-auth`     | `myclash-supabase-auth`     | `supabase/gotrue:v2.195.0`                 | Email magic link + Google OAuth. JWT TTL 3600 s. Served at `/auth/v1`.                                     |
| `supabase-realtime` | `myclash-supabase-realtime` | `supabase/realtime:v2.124.1`               | Phoenix Channels broadcasting Postgres row changes. Served at `/realtime/v1`.                              |
| `supabase-storage`  | `myclash-supabase-storage`  | `supabase/storage-api:v1.68.9`             | S3-compatible storage (photos, club logos). 50 MB upload cap. Served at `/storage/v1`.                     |
| `supabase-rest`     | `myclash-supabase-rest`     | `postgrest/postgrest:v14.16`               | PostgREST over the public schema. Served at `/rest/v1`.                                                    |
| `supabase-meta`     | `myclash-supabase-meta`     | `supabase/postgres-meta:v0.96.8`           | Schema/DDL API for Studio. **Unrouted** — docker-network only, reachable solely by `supabase-studio`.      |
| `supabase-studio`   | `myclash-supabase-studio`   | `supabase/studio`                          | Operator DB console at `studio.${DOMAIN}`. Bypasses RLS — see §17.5.                                       |
| `api`               | `myclash-api`               | Built from `apps/api/Dockerfile`           | NestJS REST + WebSocket gateway on internal port 4000. Depends on `db`, `redis`.                           |
| `worker`            | `myclash-worker`            | Same as `api`, started with `--worker`     | BullMQ consumer — stats aggregation, exports, Ratings sync, push notifications.                            |
| `web-admin`         | `myclash-web-admin`         | Built from `apps/web-admin/Dockerfile`     | Next.js 16 on internal port 3000. Routed at `admin.${DOMAIN}`.                                             |
| `web-public`        | `myclash-web-public`        | Built from `apps/web-public/Dockerfile`    | Next.js 16 on internal port 3000. Routed at `app.${DOMAIN}`.                                               |
| `web-staff`         | `myclash-web-staff`         | Built from `apps/web-staff/Dockerfile`     | Next.js 16 on internal port 3000. Routed at `staff.${DOMAIN}`.                                             |
| `web-marketing`     | `myclash-web-marketing`     | Built from `apps/web-marketing/Dockerfile` | Astro, prerendered, served by Caddy on port 80. Routed at `${DOMAIN}` and `www.${DOMAIN}` (apex redirect). |
| `ops-runner`        | `myclash-ops-runner`        | Built from `infra/ops-runner/Dockerfile`   | Bearer-authed sidecar with `/var/run/docker.sock`. Backups, restore, container lifecycle. See §17.4.       |

Traefik routes by Host header. Key mappings:

| Hostname            | Service                 | Path / Notes                                                                                                                                                            |
| ------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `${DOMAIN}`         | `web-marketing`         | Apex landing page. `www.${DOMAIN}` permanent-redirects to apex.                                                                                                         |
| `app.${DOMAIN}`     | `web-public` + Supabase | Root → web-public. `/auth/v1` → supabase-auth · `/realtime/v1` → supabase-realtime · `/storage/v1` → supabase-storage · `/rest/v1` → supabase-rest (all StripPrefix'd). |
| `admin.${DOMAIN}`   | `web-admin` + `api`     | `/api/v1/*` → api (priority 30), everything else → web-admin.                                                                                                           |
| `staff.${DOMAIN}`   | `web-staff`             | Scorekeeper tablet PWA.                                                                                                                                                 |
| `api.${DOMAIN}`     | `api`                   | NestJS REST endpoint (used by web-staff + dev tools).                                                                                                                   |
| `traefik.${DOMAIN}` | `traefik`               | Dashboard, basic-auth gated via `TRAEFIK_DASHBOARD_AUTH`.                                                                                                               |
| `studio.${DOMAIN}`  | `supabase-studio`       | Operator DB console. IP allowlist **and** basic auth, both mandatory. See §17.5.                                                                                        |

**Every host in that table needs a DNS A record before the first deploy of an environment, and the
easy ones to forget are `app`, `traefik` and `studio`.** Let's Encrypt cannot issue for a name that
does not resolve, and its production endpoint allows only **5 failures per hour** — a shared budget
across the whole certificate request. `studio` is the sharpest case: its router in
`infra/docker-compose.prod.yml` carries no `profiles:` guard, so its certificate is requested on
**every** deploy whether or not anyone uses Studio. `app` and `traefik` are additionally probed by
the admin TLS-status card (`apps/api/src/modules/admin/tls-status.service.ts`). Add `www` as a
CNAME to the apex, and a wildcard `*` record if per-event subdomains are ever wanted.

### 17.2 Environments

- `.env.example` committed; `.env` gitignored.
- Local dev: `docker compose --env-file .env -f infra/docker-compose.dev.yml up -d --build` (Traefik with self-signed certs at `*.myclash.localhost`; Supabase is routed through Traefik exactly as in production — the Kong gateway was removed). Or run a partial stack (data services only) and `pnpm dev` for the apps — see the project [README](../README.md#quick-start-developers).
- Production: `docker compose --env-file .env -f infra/docker-compose.prod.yml`, wrapped by `infra/scripts/deploy.sh`, `start.sh`, `stop.sh`, `rollback.sh`.

### 17.3 Backups

Backups now run as **ops-runner operations** rather than direct cron-on-host (see §17.4 for the sidecar's HTTP surface). The schedule, the dump scripts, and the off-site mirror all live behind the ops-runner.

- **Postgres:** nightly `pg_dump` of the `db` container, gzip + optional GPG encryption (`BACKUP_GPG_RECIPIENT`).
- **Storage:** nightly tarball of the `supabase-storage` data volume (`storage_data`).
- **Off-site mirror:** Scaleway Object Storage (S3-compatible). Configured via `BACKUP_SCW_ACCESS_KEY`, `BACKUP_SCW_SECRET_KEY`, `BACKUP_SCW_BUCKET`, `BACKUP_SCW_ENDPOINT`, `BACKUP_SCW_REGION`. When unset, backups stay local-only.
- **Retention:** 30 days rolling, enforced on each new backup.
- **Schedule:** configurable from `/admin/backups` (hour + minute UTC). Persisted by the ops-runner; not in Postgres.
- **Restore:** triggered from `/admin/backups` against a local file, an uploaded archive, or an S3 object. The UI requires typed confirmation matching `RESTORE MYCLASH <backupId>` before running.

### 17.4 ops-runner sidecar

The ops-runner ([`infra/ops-runner/server.mjs`](../infra/ops-runner/server.mjs)) is a small Node HTTP service that mounts `/var/run/docker.sock` and exposes a bearer-authed RPC surface to the rest of the stack. **Only this container holds the Docker socket.** A compromise of the NestJS API container therefore does not grant Docker root — that's the threat-model reason it exists as a separate service rather than as an `AdminBackupsService` shelling out from the API.

The HTTP surface is exposed on the internal `myclash` network at port `4075`, never published. Every request must carry `Authorization: Bearer ${OPS_RUNNER_SECRET}`. The API talks to it through `OPS_RUNNER_URL` + `OPS_RUNNER_SECRET` env vars (see [`apps/api/src/modules/admin/backups.service.ts`](../apps/api/src/modules/admin/backups.service.ts) and [`apps/api/src/modules/admin/system-actions.service.ts`](../apps/api/src/modules/admin/system-actions.service.ts) for the client pattern).

| Method   | Path                               | Purpose                                                                                |
| -------- | ---------------------------------- | -------------------------------------------------------------------------------------- |
| `GET`    | `/status`                          | Cloud-config flag, last backup summary, currently-running operation.                   |
| `GET`    | `/backups`                         | List all backup sets across local + S3, with per-artifact `sizeBytes`.                 |
| `DELETE` | `/backups/{backupId}?location=...` | Delete a backup's artifacts at the given location (`local` or `s3`).                   |
| `GET`    | `/schedule`                        | Read the nightly backup schedule (`enabled`, `hourUtc`, `minuteUtc`, `nextRunAt`).     |
| `PUT`    | `/schedule`                        | Update the schedule.                                                                   |
| `POST`   | `/operations/backup`               | Start an ad-hoc backup. Returns the operation id (poll via `/operations/{id}`).        |
| `POST`   | `/operations/restore`              | Start a restore from `{location, backupId, includeStorage, confirmation}`.             |
| `GET`    | `/operations/{id}`                 | Poll operation status; includes a tail of stdout/stderr.                               |
| `POST`   | `/uploads`                         | Stage a backup uploaded from the admin UI (base64 body).                               |
| `GET`    | `/download/{backupId}?...`         | Stream a backup artifact back to the admin UI.                                         |
| `POST`   | `/containers/{service}/{action}`   | Start / stop / restart an allowlisted service (`action` ∈ `start`, `stop`, `restart`). |

The lifecycle endpoint accepts only the **12-service restartable allowlist** (mirrored server-side as `RESTARTABLE_COMPONENTS` in `system-actions.service.ts` and as `RESTARTABLE_SERVICES` in `server.mjs`): `worker`, `web-admin`, `web-public`, `web-staff`, `web-marketing`, `redis`, `supabase-auth`, `supabase-realtime`, `supabase-storage`, `supabase-rest`, `supabase-meta`, `supabase-studio`. Catastrophic / self-referential services are intentionally excluded:

- `api` — would kill the calling request mid-flight.
- `postgres` (`db`) — full data outage.
- `traefik` — lose HTTPS routing for the entire stack.
- `ops-runner` — lose the channel that would restart anything else.

Both the API controller and the ops-runner re-validate the action and the service against this list, so a tampered request cannot escalate into restarting Postgres or stopping Traefik.

### 17.5 Supabase Studio — the operator DB console

`studio.${DOMAIN}` gives the operator a web console over the production database: table editor, SQL editor, schema browser. It exists because the `db` service publishes no host ports, and reading production data otherwise means `docker exec … psql` over SSH — still the fallback, documented in §17.6.

**It bypasses RLS.** Studio reaches Postgres through `supabase-meta`, which connects as `POSTGRES_USER`. Every query it runs — read or write — ignores the row-level security policies that are otherwise this system's only data boundary (§9). Hard rule #4 is unchanged everywhere else; this is the single deliberate exception, granted to one human on one hostname, and it is the reason the router is gated twice rather than once.

**It has two paths to Postgres, not one.** `STUDIO_PG_META_URL` is only the first. The Database and SQL Editor pages build their **own** connection string and hand it to `supabase-meta` as a per-request override — the sole reason the Studio container is given `POSTGRES_PASSWORD` — which means `PG_META_DB_NAME` does not govern them. Studio must therefore be told the coordinates itself (`POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER_READ_WRITE`), as upstream's compose does. Left unset, `POSTGRES_DB` defaults to upstream's invariant name `postgres` — the empty maintenance database — and every pg-meta-backed page then renders an **empty state instead of an error**: "No tables in schema public" over a 70-table schema, and an Advisor certifying a database it never read. Both paths still connect as `POSTGRES_USER`, so the RLS exception above is unchanged either way.

**Studio has no authentication of its own.** Upstream's self-host stack delegates that to Kong, which this deployment removed when Traefik took over Supabase routing. Nothing inside the container checks who you are. The edge is the entire access control:

| Gate                     | Mechanism                                | Source                                                                    |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------- |
| `myclash-studio-ipallow` | Traefik `ipAllowList`                    | `TRAEFIK_STUDIO_ALLOWLIST`, derived in `infra/scripts/lib/traefik-env.sh` |
| `myclash-studio-auth`    | Traefik `basicauth`                      | `STUDIO_BASIC_AUTH`, auto-generated by `deploy.sh`                        |
| `myclash-geoblock-admin` | GeoBlock plugin, allow-list, fail closed | Attached via `${MW_GEO_ADMIN}`                                            |
| `myclash-fail2ban-auth`  | Fail2Ban plugin                          | Attached via `${MW_F2B_AUTH}`                                             |

The first two are **built-in** Traefik middlewares, written into the router chain in full. That is load-bearing, not stylistic. `TRAEFIK_PLUGINS=off` empties the `${MW_*}` prefixes so a failed plugin download cannot take the public site down (§17.1) — and the last two gates disappear with it. If Studio's protection lived behind those prefixes, one GitHub outage at container start would publish an unauthenticated superuser SQL editor. `check-infra-review.mjs` asserts the literal middleware names for exactly this reason; do not fold them into a variable.

**The IP allowlist fails closed.** `TRAEFIK_STUDIO_ALLOWLIST` derives from `THROTTLE_IP_WHITELIST` — the same single source as the Fail2Ban allowlist, so trusted addresses are never hand-kept in two places. It is deliberately _not_ the same value as `TRAEFIK_BAN_ALLOWLIST`: that one carries `10/8`, `172.16/12` and `192.168/16` because "don't ban the local network" is correct, whereas "let the whole local network open a SQL console" is not. Studio gets loopback plus the operator's explicit addresses and nothing else, so an empty `THROTTLE_IP_WHITELIST` leaves Studio unreachable rather than open.

The cost of that choice is a dynamic operator IP locking you out. Recovery is one edit and a restart:

```bash
# .env
THROTTLE_IP_WHITELIST=<new address>
./infra/scripts/start.sh
```

**Credentials.** `STUDIO_BASIC_AUTH` (hash) and `STUDIO_PASSWORD` (plaintext) are generated together by `scripts/ensure-prod-env.mjs` from the `BASIC_AUTH_PAIRS` table it shares with the Traefik dashboard, and printed by the deploy's Deployment secrets section. The hash is `{SHA}`, not bcrypt: Compose interpolates docker labels, so a bcrypt hash would need every `$` doubled, while base64 SHA-1 reaches Traefik untouched. The plaintext is stored rather than only printed because the hash is one-way and Studio is the only DB console — losing it would otherwise mean blanking the key and redeploying.

`supabase-meta` itself is **unrouted**: no Traefik labels, no published ports. It answers unauthenticated on the compose network and speaks to Postgres as the superuser, so `supabase-studio` is the only thing that may reach it. `check-infra-review.mjs` asserts it never grows a router.

### 17.6 Reaching Postgres directly

**Use Studio first.** Its SQL Editor and Table Editor already work — they reach Postgres through `supabase-meta` (§17.5), not through a connection string you supply. Studio's **Get connected** panel (Framework / Server / Direct / ORM / MCP) is upstream's hosted-platform UI: the strings it prints resolve to `db:5432` on the compose network with platform-default credentials, so nothing there is usable from a laptop. Its **API Keys** tab _is_ real — `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected into the container.

The real coordinates live in `.env` on the VPS, never in Studio:

| Field    | Value                                           |
| -------- | ----------------------------------------------- |
| host     | `db` — resolvable on the `myclash` network only |
| port     | `5432`                                          |
| user     | `${POSTGRES_USER}` (`supabase_admin`)           |
| database | `${POSTGRES_DB}` (`myclash`)                    |
| password | `${POSTGRES_PASSWORD}`                          |

**Recipe A — psql shell on the VPS.** Same invocation `backup.sh` runs nightly, so it is exercised in production every day:

```bash
cd /srv/myclash
docker compose --env-file .env -f infra/docker-compose.prod.yml \
  exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

No `PGPASSWORD` — the in-container socket connection as `POSTGRES_USER` needs none, which is why `backup.sh` passes none either.

**Recipe B — desktop client (TablePlus, DBeaver, psql on Windows).** There is no host port to forward, so tunnel to the container's own address: the docker bridge is reachable from the host's network namespace, and `ssh -L` forwards to anything the VPS can reach.

```bash
CIP=$(ssh user@vps "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' myclash-db")
ssh -L 5433:$CIP:5432 user@vps      # then point the client at localhost:5433
```

The container IP changes on every recreate, which is why the recipe reads it each time rather than hardcoding one. `ssh -L 5433:myclash-db:5432` does **not** work: container-name resolution is Docker's embedded DNS, visible from inside the network and not to the host's SSH daemon.

**Do not publish 5432 to fix this.** Docker writes its own iptables chain and bypasses UFW, so `ports: ['5432:5432']` on `db` would be world-reachable despite `ufw default deny incoming` (`infra/scripts/vps-bootstrap.sh` allows 22/80/443 only). Dev publishes it deliberately for desktop tools; production does not, and if a publish is ever genuinely needed it must be bound: `127.0.0.1:5432:5432`.

Both recipes connect as the superuser and therefore **bypass RLS**, exactly as Studio does — the warning in §17.5 applies unchanged. For a read-only look at production data without touching the live database, restore a nightly dump instead (§17.3, [`docs/DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md)).

---

## 18. Repository Structure (Monorepo)

```
myclash/
├── apps/
│   ├── api/                    # NestJS
│   │   ├── src/
│   │   │   ├── common/               # cross-cutting: auth guards, event-authz,
│   │   │   │                         #   event-readonly, testing doubles
│   │   │   ├── modules/              # 51 feature modules — `ls apps/api/src/modules`
│   │   │   ├── workers/
│   │   │   └── main.ts
│   │   └── test/
│   ├── web-public/             # Next.js (PWA, mobile-first — spectator/competitor)
│   ├── web-staff/              # Next.js (PWA, offline-first — scorekeeper)
│   ├── web-admin/              # Next.js (SPA — organiser + super-admin)
│   └── web-marketing/          # Astro — marketing site (myclash.fr apex)
├── packages/                   # all ten, no others
│   ├── ui/                     # Shared components + Tournament Manual aesthetic.
│   │                           #   theme.css lives here — it IS the token source of truth
│   ├── db/                     # SQL migrations + the runner that applies them. No ORM
│   ├── rulesets/               # @myclash/rulesets — TF_v1 + custom-ruleset runtime
│   ├── schedule-core/          # @myclash/schedule-core — pure schedule/grid geometry
│   ├── feature-flags/          # @myclash/feature-flags — curated toggle registry
│   ├── types/                  # Shared TS types (Match, Exchange, etc.)
│   ├── api-client/             # Generated OpenAPI client
│   ├── i18n/                   # Shared translation strings (EN + FR)
│   ├── next-i18n/              # @myclash/next-i18n — the Next binding for the above
│   └── time/                   # @myclash/time — shared time/date helpers
├── infra/
│   ├── docker-compose.prod.yml     # prod compose (used by infra/scripts/*)
│   ├── docker-compose.dev.yml      # local dev stack (Traefik + Supabase + apps)
│   ├── docker-compose.staging-certs.yml
│   ├── traefik/                    # static config + dashboard auth
│   ├── db/init/                    # Postgres init scripts (Supabase roles, realtime, postgrest)
│   ├── ops-runner/                 # bearer-authed sidecar (docker.sock + backups + lifecycle); see §17.4
│   └── scripts/                    # bash scripts that run ON THE VPS
│       ├── lib/log.sh              # shared color/log helpers (sourced by all)
│       ├── deploy.sh               # full deploy: validate → backup → migrate → up
│       ├── rollback.sh             # restore previous version + previous DB backup
│       ├── start.sh                # bring stack up (no rebuild)
│       ├── stop.sh                 # halt stack
│       ├── refresh.sh              # restart specific service(s) with health-wait
│       ├── status.sh               # comprehensive health / log dump
│       ├── destroy.sh              # nuke containers + clean runtime data
│       ├── backup.sh               # nightly cron: pg_dump + storage + off-site sync
│       ├── restore.sh              # restore from a chosen backup file
│       └── vps-bootstrap.sh        # idempotent VPS provisioning
├── scripts/                        # cross-platform scripts (Node) for the dev machine
│   ├── deploy.ts                   # `pnpm deploy:prod` — SSH wrapper for infra/scripts/deploy.sh
│   ├── gen-api-client.ts           # regenerate the @myclash/api-client from OpenAPI
│   ├── gen-ffamhe-penalty-seed.ts  # generate the FFAMHE penalty seed data
│   ├── seed-min.ts                 # seed a minimal dev dataset
│   └── *.mjs                       # cross-cutting check/lint scripts
├── docs/
│   ├── ARCHITECTURE.md             # this file
│   ├── ENGINEERING_LESSONS.md      # reusable rules distilled from past mistakes
│   ├── HIERARCHY.md                # canonical domain vocabulary
│   ├── GOLDEN_PATHS.md             # end-to-end happy-path walkthroughs
│   ├── DISASTER_RECOVERY.md        # backup/restore recovery runbook
│   ├── SECURITY_POSTURE.md         # security posture notes
│   └── *_REVIEW.md                 # periodic review reports
├── .github/workflows/
├── .env.deploy.example             # template for the dev-machine deploy SSH config
├── CLAUDE.md                       # agent contract (root, intentional)
├── AGENTS.md                       # pointer at CLAUDE.md for non-Claude agents
├── DESIGN.md                       # canonical UI design language (root, intentional)
├── myclash.md                      # functional/product reference (root, intentional)
├── README.md                       # GitHub-facing docs (root, intentional)
├── LICENSE                         # AGPL-3.0
├── package.json                    # pnpm workspace root
├── pnpm-workspace.yaml
└── turbo.json
```

**Why these files at the root?** GitHub looks for `README.md` and `LICENSE` at root by convention; `CLAUDE.md` (with `AGENTS.md` pointing at it) must be at root so AI coders find it without configuration; `DESIGN.md` is the UI contract that `pnpm quality:design-drift` diffs against the tokens; `myclash.md` is a product-level companion to the README. Everything else is grouped by purpose: `docs/` for project docs, `infra/scripts/` for VPS bash, `scripts/` for cross-platform Node.

---

## 19. Development Roadmap

**The phased roadmap is complete.** P0 through P15 — bootstrap, domain core, TF_v1, pools and
brackets, online and offline scoring, the public and admin apps, workshops, referees, statistics,
HEMA Ratings, push notifications, super admin, i18n — all shipped. What remains is slice work paced
by the operator against a live test event, not a phase plan.

Work is no longer picked from a list. `CLAUDE.md` is the agent contract; the git history is the
build record.

---

## 20. Conventions & Standards

- **TypeScript strict mode** everywhere. No `any` without an `// AI:` justification comment.
- **Zod** for all runtime validation; types derived from schemas.
- **Conventional Commits**, enforced by commitlint through the `commit-msg` hook.
- **Work lands directly on `main`.** One slice, one commit, scoped to a single concern. There is
  no branch-per-task and no PR ritual; several agent sessions commit here concurrently, so check
  `git log --oneline -1` before staging and stage explicit paths.
- **Code style**: Prettier + ESLint (`@typescript-eslint`), enforced in CI.
- **API errors**: RFC 7807 Problem Details JSON format.
- **Logging**: structured JSON logs (Pino), correlation IDs end-to-end.
- **Observability**: OpenTelemetry traces, exported to Jaeger in dev (optional in prod).
- **No client-side `eval`** for ruleset formulas. Ever.
- **Time** always stored as `timestamptz` UTC; rendered in user's locale.
- **Money** (future): `numeric(10,2)` only.

### 20.1 The gate harness

CI's Lint job runs `pnpm turbo run lint` plus twenty-eight further steps, each its own verdict.
`.claude/skills/myclash-gates/SKILL.md` holds the ordered chain; `.github/workflows/ci.yml` is the
source of truth when they disagree.

Fourteen of the nineteen `scripts/check-*.mjs` gates run through **`defineGate`**
(`scripts/lib/gate.mjs`), which owns reporting, exit codes and anti-vacuity. Two invariants there
are not obvious and are easy to break:

- **A gate that examined nothing must say so.** `defineGate` refuses a bare `scanned: 0`; a run
  with nothing to look at has to declare it by name through `nothingToCount(reason)`. This exists
  because a gate that silently scans zero files reports success.
- **A gate module must be inert on import.** `scripts/build-app-bundles.mjs` imports
  `parseRequiredEnv` out of `check-client-env-contract.mjs` on the production bundle path, so a
  gate that runs at import time would fire during a build.

A `scanned` count over _files_ is still blind to a collapsed _rule_ — a gate can read a thousand
files, match nothing, and exit 0. Count comparisons, not inputs.

Adding a gate needs four registrations: the `package.json` script (the gate **alone**, never
`&&`-chained), the `ci.yml` step with `if: '!cancelled()'`, an entry in `CI_GATES`
(`apps/api/src/modules/admin/ci-health/gates.ts`) so the health card can notice it stopped running,
and `CONTRIBUTING.md`.

### 20.2 API service tests: the shared Supabase double

Every API service test drives the same double, in `apps/api/src/common/testing/`:

| Module                        | Owns                                                        |
| ----------------------------- | ----------------------------------------------------------- |
| `supabase-chain.ts`           | the entry point                                             |
| `supabase-chain-internals.ts` | the lazy chain and the write log                            |
| `supabase-chain-seeded.ts`    | row narrowing, ordering and counting over seeded tables     |
| `supabase-chain-or.ts`        | `.or()` predicate parsing                                   |
| `supabase-query-scan.ts`      | `selectsFor`, which reads the SELECT string a call issued   |
| `migration-schema.ts`         | replays `packages/db/migrations/` so tests see real columns |

Reach for these before hand-rolling a mock. Two traps they exist to close: a mock ignores the
projection, so a test over a read is only real if it asserts the SELECT string (`selectsFor` does
this, and works on seeded tables); and an ordered `mockReturnValueOnce` chain desynchronises the
moment a service adds a query, turning a passing test into one that asserts the wrong call.

## 21. AI Coder Instructions

The agent contract lives at the repo root in **`CLAUDE.md`** — hard rules, which documents are
authoritative, the workflow, and how to verify a change. It is the single copy; this section used
to duplicate it and drifted.

Two pointers worth repeating here, because this document is where an agent usually starts:

- **This document is authoritative for technical design.** If it conflicts with a user
  instruction, ask before deviating. If it is silent on a decision, ask — do not guess and write
  500 lines that need unwinding.
- **For UI, `DESIGN.md` at the repo root is canonical**, with per-surface deltas in `docs/design/`
  and token values in `packages/ui/src/theme.css` (gated by `pnpm quality:design-drift`).

---

## 22. Open Questions / Future Work

These are intentionally **not** in scope for v1.0 but are tracked here:

- **Multi-scorekeeper conflict resolution** — two scorekeepers on one match. Today the last write wins; there is no merge UI and no per-field provenance.
- **Live video integration** (stream URL per Lice; embed in public Lice view).
- **Mobile native apps** (React Native, sharing the API layer).
- **Federation with other event platforms** (e.g. import from hemaScorecard exports).
- **In-event photo gallery** (fighter portraits, podium photos uploaded by organizers).
- **Crowd judging / spectator scoring** (entertainment feature, not authoritative).
- **AI-assisted refereeing** (target detection from video). Out of scope; flagged for research.
- **HEMA Ratings push API** (when/if available).
- **Match-fixing detection / anomaly stats** (algorithmic flags for review).

---

## 23. Referee Financial Compensation (T-1209)

### 23.1 Overview

Organisations can compensate referees using a token-based system. Referees earn points per completed match based on their role and the competition phase. Tokens are converted to a monetary amount via configurable tiered brackets.

### 23.2 Database (migration `0027_referee_compensation.sql`)

| Table                                 | Purpose                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `referee_compensation_plans`          | Named plans; `built_in=true` for the FFAMHE default, `organization_id=null` for built-in |
| `referee_compensation_role_rates`     | Token rate per (`plan_id`, `referee_role`, `compensation_phase`)                         |
| `referee_compensation_tiers`          | Token → money conversion brackets per plan                                               |
| `referee_compensation_event_settings` | Which plan + optional cap is active for an event                                         |
| `referee_compensation_payments`       | Payment tracking per (`event_id`, `user_id`); partial index on `WHERE paid = false`      |

All tables have RLS enabled. FK columns have explicit indexes. Money columns use `NUMERIC(10,2)`.

**Roles:** `arbitre_declarant`, `arbitre_assesseur`, `arbitre_table`  
**Compensation phases:** `pool`, `bracket`, `finals`  
**Finals detection:** application-side via `match_number_label` regex: `/FINAL|^F$|GOLD|BRONZE|3RD/i`

### 23.3 API (`CompensationModule`)

```text
GET    /api/v1/compensation-plans                                   list (built-in + org + public)
POST   /api/v1/organizations/:orgId/compensation-plans              create org plan
PATCH  /api/v1/compensation-plans/:planId                           update name/description/visibility
DELETE /api/v1/compensation-plans/:planId                           delete own plan
PUT    /api/v1/compensation-plans/:planId/role-rates                replace all role rates
PUT    /api/v1/compensation-plans/:planId/tiers                     replace all tiers

GET    /api/v1/events/:eventId/compensation/settings                get plan + cap
PUT    /api/v1/events/:eventId/compensation/settings                set plan + cap
GET    /api/v1/events/:eventId/compensation/report                  compute live report
PATCH  /api/v1/events/:eventId/compensation/payments/:personId      toggle paid status
```

The report is always computed fresh from live `referee_assignments` data. Pool assignments expand to all completed matches in the pool; lice assignments split matches by label into `bracket` vs `finals`; match-level assignments count as 1.

### 23.4 Frontend

- **Event page** (`/org/[slug]/events/[eventId]/compensation`) — plan selector, compensation table with expandable per-referee breakdowns, grand total, paid checkboxes.
- **Org settings** (`/org/[slug]/settings/compensation`) — list built-in plans (read-only), create/edit/delete org plans, rates grid (3 roles × 3 phases), tiers table.

---

## 24. Event Schedule Planner (T-1210)

A two-layer scheduling tool for tournament organisers.

### 24.1 Overview

**Layer 1 — Programme** (`event_programme_blocks`): organisers build a high-level day plan as ordered blocks (Registration, Pool Session, Break, Workshop…). An auto-suggest algorithm builds the plan from event parameters. Blocks can be dragged to reorder.

**Layer 2 — Grid** (existing T-706): after pressing "Generate schedule", matches get `scheduledAt` + `liceId` assigned within each block's time window, and workshop sessions get `startsAt`/`endsAt`. The organiser fine-tunes on the 5-minute drag-drop grid.

The grid is the workspace, and the programme planner is a panel inside its right sidebar, under
the Unscheduled list — not a second tab. The Schedule tab used to split into a **Programme** and a
**Grid** sub-tab; `schedule/page.tsx` now renders one `ScheduleGrid` and passes the planner in as its
`configurePanel`.

### 24.2 Database

`event_programme_blocks` — stores blocks per event per day, ordered by `day_index` + `sort_order`. Columns: `block_type` (`admin|competition|workshop|break`), `label`, `competition_id`, `competition_phase`, `workshop_id`, `lice_count`, `start_time`, `end_time`, `match_gap_seconds` (default 15s), `match_duration_minutes`, `generated_at`.

`workshops.duration_minutes` — optional column added to hold workshop duration for planning purposes.

`workshop_sessions.starts_at`/`ends_at` — made nullable; filled by the programme generator.

### 24.3 API

Twelve routes, all on `programme.controller.ts`. `GET` is the only `@Public()` one, and its
visibility gate lives in the service.

```text
GET    /api/v1/events/:eventId/programme                          list saved blocks
PUT    /api/v1/events/:eventId/programme                          bulk save (replace all)
POST   /api/v1/events/:eventId/programme/suggest                  auto-suggest (no DB write)
POST   /api/v1/events/:eventId/programme/generate                 run the scheduler over saved blocks
POST   /api/v1/events/:eventId/programme/blocks                   append one admin/break block
PATCH  /api/v1/events/:eventId/programme/blocks/:blockId          rename one block
PATCH  /api/v1/events/:eventId/programme/blocks/:blockId/move     move a block; cascade the day's matches
PATCH  /api/v1/events/:eventId/programme/blocks/:blockId/resize   change a block's end time only
DELETE /api/v1/events/:eventId/programme/blocks/:blockId          delete a block; unschedule its matches
POST   /api/v1/events/:eventId/programme/delay                    push the rest of a day back by N minutes
POST   /api/v1/events/:eventId/programme/schedule-group           re-fan a pool or bracket sub-tree
DELETE /api/v1/events/:eventId/programme/full                     reset blocks and every match placement
```

**Suggest algorithm:** places admin blocks (Registration+GearCheck, Referee Meeting) at Day 1 start, then competition pool blocks (in tournament `sort_order`), breaks between each, midday break at configured window, bracket blocks, then workshops. Returns `BlockWarning[]` for blocks whose time window is shorter than needed.

**Generate:** for each competition block, fetches matches ordered `match_number_label ASC` (Berger sequence) and calls `scheduleMatches()` constrained to the block's time window. It does **not** touch `workshop_sessions` — workshops moved to their own board, and `generate` returns a hard-coded `workshopSessionsCreated: 0`. The route's own OpenAPI summary still promises workshop sessions.

### 24.4 Frontend

- **Schedule tab** — the grid, with the programme planner as a collapsible panel in its right sidebar, plus a Detailed grid.
- **Programme planner** — collapsible config bar, day tabs, drag-drop block list, overflow warnings with "Suggest fit" / "Override" actions, "Generate schedule" with a confirmation modal.
- **Workshop creation** — optional `Duration (min)` field used by the programme planner for block sizing.

**This is the largest single subsystem in the repo**: 82 files under
`apps/web-admin/app/org/[slug]/events/[eventId]/schedule/`, 29 of them colocated tests.
The shape is deliberate and worth knowing before touching it — **pure geometry is separated from
React**, so it can be tested without a DOM:

- **Pure modules** (`block-geometry`, `bar-collisions`, `block-run-plans`, `plan-match-drop`,
  `place-with-shift`, `detect-overlaps`, `lice-span`, `lice-drift`, `lice-utilization`,
  `day-delay`, `panel-width`, `compute-header-runs`, `conflict-detection`, `break-edit-steps`,
  `drag-payload`) — no imports from React, each with its own test file.
- **Hooks** (`useScheduleData`, `useScheduleWrites`, `useScheduleUndo`, `useSchedulePrefs`,
  `useProgrammeBars`, `useRefereeCrewConflicts`) — data, mutations and undo.
- **Views** (`DetailedGridView` and its `Detailed*` parts, `MatchChip`, `UnscheduledPanel`,
  `RefereeConflictBanner`, `RunningLateDialog`, `LicePlacementEditor`).
- **Shared geometry** lives one level out, in `packages/schedule-core/` — the grid and
  workshop-board maths both apps use.

Two traps: `realtime-refetch-gate.ts` exists because a naive realtime subscription refetches over
the user's in-flight drag, and `write-tracker.ts` because an optimistic move must be reconcilable
against the server's answer. Neither is optional decoration.

---

## 25. Live Schedule View (T-1211)

Real-time display of the current programme block and active fights, visible to all event participants without login.

### 25.1 Overview

Two surfaces:

- **web-admin banner** — collapsible "Now Playing" strip above the Schedule tab showing current block and per-lice match state. Refreshes every 15 seconds via polling.
- **web-public `/e/[eventSlug]/live`** — phone-friendly public page with overview (all lices) and drill-down (single lice). Updates via Supabase Realtime `postgres_changes` on the `matches` table + 30s clock timer for block transitions.

### 25.2 API

```text
GET /api/v1/events/:eventId/live-state   accepts UUID or human-readable slug; public
```

Response:

```ts
{
  currentBlock: ProgrammeBlock | null; // block whose start_time ≤ now ≤ end_time for today
  nextBlock: ProgrammeBlock | null; // next upcoming block today
  lices: Array<{
    lice: { id; name; sortOrder };
    runningMatch: LiveMatch | null; // status = 'running'
    nextMatch: LiveMatch | null; // earliest scheduled match after now
  }>;
}
```

Block detection: converts `day_index` offset from `event.start_date` + block `start_time`/`end_time` to wall-clock comparison against `now()`. No new database table.

### 25.3 Frontend

- **`schedule/live-now-banner.tsx`** — polls live-state every 15s; shows LIVE badge + block name + per-lice current/next match. Collapsible.
- **`apps/web-public/app/e/[eventSlug]/live/page.tsx`** — overview: card grid per lice; drill-down via `?lice=<id>` query param showing full match details and up-next list. Realtime via `postgres_changes` subscription per lice.
- Event home (`/e/[eventSlug]`) — "Live schedule →" link added.

---

---

## 26. AI Infrastructure (T-1212)

Shared AI layer required by all AI-powered features (NLQ, Recap Generator, etc.). Provides LLM provider abstraction, encrypted BYOK API key storage at org level, per-event spend caps, and a settings UI.

### 26.1 Database

**`organization_ai_settings`** — one row per org, stores provider name + AES-256-GCM ciphertext + IV. RLS: owner/admin read; writes via service_role only.

**`ai_usage_log`** — one row per LLM call with `event_id`, `organization_id`, `feature`, token counts, and `cost_eur`. Indexed on `event_id` and `organization_id`. RLS: owner/admin read.

**`events.ai_spend_cap_eur`** — nullable `NUMERIC(10,4)` column added via migration `0029_ai_infrastructure.sql`. NULL = no cap.

### 26.2 `ai-providers` NestJS Module

**Location:** `apps/api/src/modules/ai-providers/`

**Public API:**

```ts
saveKey(orgId, provider, rawKey): Promise<void>        // AES-256-GCM encrypt + upsert
deleteKey(orgId): Promise<void>
getProviderConfig(orgId): Promise<{ provider, hasKey: true, updatedAt } | null>
generate(orgId, request): Promise<GenerationResult>    // decrypt key → adapter → normalised result
```

**Encryption:** AES-256-GCM via Node `crypto`. Secret derived from `AI_KEY_SECRET` env var (32-byte hex, 64 chars). Module init throws `Error('AI_KEY_SECRET env var is required')` if absent. IV is 12 random bytes generated per save; auth tag appended to ciphertext; both stored as base64.

**Provider adapters** (`adapters/`): `AnthropicAdapter`, `OpenAIAdapter`, `MistralAdapter` — each implements `ProviderAdapter.generate(apiKey, request)`. Tool-call response normalisation and per-model EUR cost calculation included.

**API endpoints:**

```text
GET    /api/v1/organizations/:orgId/ai-settings   → { provider, hasKey, updatedAt } | null
PUT    /api/v1/organizations/:orgId/ai-settings   → { provider, hasKey }  (saves encrypted key)
DELETE /api/v1/organizations/:orgId/ai-settings   → 204
```

### 26.3 `ai-usage` NestJS Module

**Location:** `apps/api/src/modules/ai-usage/`

**Public API:**

```ts
generateWithCap(orgId, eventId, feature, request): Promise<GenerationResult>
getUsageSummary(eventId): Promise<{ totalSpendEur, cap, remainingEur, callCount }>
```

`generateWithCap()` checks `events.ai_spend_cap_eur`; sums `ai_usage_log.cost_eur` for the event; throws `SpendCapExceededException` (HTTP 402) when `sum >= cap`; otherwise calls `AIProvidersService.generate()` and inserts one usage log row.

**API endpoint:**

```text
GET /api/v1/events/:eventId/ai-usage   → { totalSpendEur, cap, remainingEur, callCount }
```

### 26.4 Organizer AI Tournament Setup Assistant (T-1213)

Organizer AI tools use the organization-scoped BYOK path (`organization_ai_settings`) and event spend caps (`ai_usage_log`). They must never use `platform_ai_settings`, which is reserved for super-admin tools.

**`organizer_ai_assistant_drafts`** - event-scoped review drafts with actor, optional tournament, draft type, prompt, structured proposed actions, validation state, status (`draft|ready|failed|applied|rejected`), and applied/rejected metadata.

**API endpoints:**

```text
POST  /api/v1/events/:eventId/ai-assistant/drafts
GET   /api/v1/events/:eventId/ai-assistant/drafts
GET   /api/v1/events/:eventId/ai-assistant/drafts/:draftId
PATCH /api/v1/events/:eventId/ai-assistant/drafts/:draftId
POST  /api/v1/events/:eventId/ai-assistant/drafts/:draftId/apply
```

V1 is constrained draft-and-review only. AI returns strict JSON actions for tournament config, pool planning, bracket generation, match-grid scheduling, and referee assignment. Organizers review or edit drafts before applying, and apply routes through existing deterministic tournament, phase, schedule, and referee assignment logic.

### 26.5 Super-admin AI Data Quality (T-1305)

Organizer BYOK keys are event/org scoped and must never power platform-super-admin scans. T-1305 adds a separate shared super-admin BYOK path:

**`platform_ai_settings`** - singleton row (`setting_key = 'super_admin'`) with provider, AES-256-GCM ciphertext, IV, updater, and updated timestamp. RLS: super-admin only; API writes through guarded super-admin routes.

**`platform_ai_usage_log`** - platform-level LLM usage rows with `feature = 'super_admin_data_quality'`, provider, token counts, cost, and actor. This avoids weakening `ai_usage_log.event_id` and keeps event spend caps org-scoped.

**`ai_data_quality_scans`** - manual scan history with actor, status, candidate/finding counts, errors, and timestamps.

**`ai_data_quality_findings`** - review queue rows with type, severity, confidence, status (`open|dismissed|resolved`), entity IDs, deterministic evidence JSON, AI summary, recommended action, stable fingerprint, and reviewer metadata.

**API endpoints:**

```text
GET    /api/v1/admin/ai-settings
PUT    /api/v1/admin/ai-settings
DELETE /api/v1/admin/ai-settings

POST  /api/v1/admin/data-quality/scans
GET   /api/v1/admin/data-quality/scans
GET   /api/v1/admin/data-quality/findings
PATCH /api/v1/admin/data-quality/findings/:id
```

All routes are guarded by `SuperAdminGuard`. Scan behavior is rules-first: deterministic matching creates candidate bundles for duplicate global Persons, referee identity/link gaps, and duplicate clubs/schools. Only minimized evidence is sent to the configured LLM, which must return strict JSON ranking/explanation. Invalid AI output leaves a deterministic finding with `AI summary unavailable.` V1 is review-only and never auto-merges or auto-edits records.

### 26.6 Natural-Language Tournament Query (T-1214)

Organizer tournament queries use organization BYOK (`organization_ai_settings`) and event spend caps (`ai_usage_log`). They never use `platform_ai_settings`.

**`tournament_query_settings`** - per-tournament access policy and per-user hourly rate limit. Default access is `organizers_only`, with optional broader event-day policies for head judges, coaches, or anyone with tournament access.

**`tournament_query_history`** - per-user query history for the selected tournament. Stores the question for that user's own history plus language, tool, summary, cost, and timestamp. Technical logs must not store raw question/result content.

**Read-only views** - `vw_tournament_query_fighters`, `vw_tournament_query_pools`, `vw_tournament_query_matches`, `vw_tournament_query_exchange_summary`, and `vw_tournament_query_referees` provide the deterministic query surface. Tool implementations query these views; the LLM never sees SQL.

**API endpoints:**

```text
POST  /api/v1/tournaments/:tournamentId/query/estimate
POST  /api/v1/tournaments/:tournamentId/query
GET   /api/v1/tournaments/:tournamentId/query/history
GET   /api/v1/tournaments/:tournamentId/query/settings
PATCH /api/v1/tournaments/:tournamentId/query/settings
```

The LLM call receives a narrowed tool schema for the current tournament's weapons, pools, lices, and divisions. It must return exactly one tool call, a clarification, or a refusal. French aliases such as `piste`, `poule`, `tireur`, `combattant`, and `arbitre` normalize to canonical internal terms before tool selection. Both `tireur` and `combattant` are accepted on input even though the UI says `combattant`, because users type either.

V1 tools cover fighter search/stats, match search, pool standings, lice status, fighter rankings, judge stats, club comparison, bracket status, tournament summary, pool completion estimates, schedule status, and lagging pools with referees.

### 26.7 Frontend

**Org AI settings** (`/org/[slug]/settings/ai`) — provider radio selector, password API key input, masked key-saved banner with date, Remove button, disabled-features amber banner when no key configured. Navigation tab added alongside "Compensation".

**Event hub AI budget card** (`/org/[slug]/events/[eventId]`) — collapsible, shown only when org has AI key configured. Spend cap number input saved via `PATCH /events/:eventId`. Read-only spend meter with progress bar (cap set) or plain spend total (no cap).

**Organizer AI assistant** (`/org/[slug]/events/[eventId]/ai-assistant`) - event setup assistant with persisted draft history, editable structured actions, and step-by-step apply. Existing tournament, pools, bracket, schedule, and referee pages link into it with prefilled draft type context.

**Natural-language tournament query** (`/org/[slug]/events/[eventId]`) - event hub query panel shown when org AI is configured. Organizer selects a tournament, asks English/French questions, sees rendered table/list/card/comparison/summary/empty results, can inspect tool metadata, rerun recent personal queries, and configure per-tournament access/rate settings.

**Super-admin AI settings** (`/admin/ai-settings`) - shared platform BYOK provider/key management for super-admin AI tools only.

**Super-admin data quality** (`/admin/data-quality`) - manual scan launcher, scan history, filters by type/severity/status, evidence viewer, and links to existing fighter merge / club review pages.

---

_End of MyClash Architecture v1.0 specification._
