# PROMPT_LOG.md

> Append-only log of user instructions across sessions.
>
> **Format**: `## HH:MM:SS_DD-MM-YYYY` followed by a verbatim or close-summary of the instruction.
> **Rule**: never edit or delete prior entries. New entries go at the bottom.
>
> See `AGENTS.md` for the protocol.

---

## 09:00:00_28-04-2026

**(Session 1 — initial scoping)** User requested an architecture plan for a free online HEMA tournament management software. Constraints: mobile-optimized for users, dedicated admin interface for organizers, modern web app, Docker container, frontend "multithreaded", undecided between Postgres and Firebase. Reference: hemaScorecard. Working name: MyHTM (open to alternatives). Code stored in Git.

## 10:00:00_28-04-2026

**(Session 2 — scoping answers)** User confirmed: (1) wants all forms of frontend "multithreading" — Web Workers, real-time multi-user, etc. (2) Separate docker-compose with Traefik. (3) Configurable rulesets, with TF_v1 to be implemented as the canonical one — formula provided: `Score = (#Win × 3 + TargetPoints) / (TimesHit + DoublePenalty)` with `DoublePenalty = n(n−1)/3`. Tiebreakers: Wins desc, Doubles asc, TimesHit asc. (4) Use Supabase, with email/Google auth. (5) Pull-only HEMA Ratings, separated NestJS backend, Supabase Realtime, global fighter profiles. Renamed app to **MyClash**. Provided HTML prototype.

## 11:00:00_28-04-2026

**(Session 3 — refining)** User confirmed real-time A+B+D (live broadcast + scoring entry + offline-tolerant), per-tournament theming, HEMA Ratings pull-only, per-exchange entry with timing statistics (match duration, time between exchanges, current match state), English first then French, multi-piste (called Lice), super admin menu for managing organizers, statistics page modeled on `https://lyonamhe.fr/resultat_fal2026.html`.

## 12:00:00_28-04-2026

**(Session 4 — frontends and OSS)** User confirmed: 3 separate frontends, AGPL-3.0 license, requested ordered build plan. Added requirement: workshops (instructors, descriptions, time, location, schedule conflict detection with tournament). Provided beta companion app reference: `https://myfal.lyonamhe.fr/`.

## 13:00:00_28-04-2026

**(Session 5 — workshops + push notifications + owner tasks)** User confirmed: workshop instructors can be fighters but not always (optional FK), per-tournament workshops only, push notifications included in v1, requested owner-side task list ("steps I need to do on my side").

## 14:00:00_28-04-2026

**(Session 6 — pool & referee assignment + memory protocol)** User added a v1 feature: pool population and referee assignment by tournament organizer. Requirements:

- Fighters can be referees; some referees aren't fighters.
- Configurable school separation: avoid same-club fighters in same pool.
- Configurable skill balancing using HEMA Ratings.
- Detect and report when there aren't enough referees for the number of pools, and which role is missing.
- Avoid fighter/referee time conflicts (a fighter can't referee while fighting).
- Three referee roles: Arbitre déclarant, Arbitre Assesseur, Arbitre de table. Each pool needs one of each. Some people qualify for all roles, some for one. Per-role rating out of 5.
- Configurable constraints: rest periods between referee duties (no back-to-back unless allowed), dedicated referees should also get rest if numbers allow, fighter-referees can never referee while fighting (hard constraint).

User also defined a **persistent-memory protocol** for the AI agent (in French and English):

- Maintain `MEMORY.md` as thematic persistent memory index.
- Append every user instruction to `PROMPT_LOG.md` with timestamp `HH:MM:SS_DD-MM-YYYY`.
- Maintain `LESSONS_LEARNED.md` for permanent reusable rules.
- Maintain `myclash.md` for functional/design understanding.
- Distinguish: `README` (repo doc), `myclash.md` (functional), `ARCHITECTURE.md` (technical), `MEMORY.md` (persistent inter-session), `PROMPT_LOG.md` (raw history), `LESSONS_LEARNED.md` (rules).
- Mandatory execution sequence: read instructions → log → update MEMORY → update thematic files.
- Never duplicate, never invent, merge similar info, remove obsolete info.

## 15:00:00_28-04-2026

**(Session 7 — local repo path & deployment automation)** User added:

- Local repo path on owner's Windows machine: `F:\Github Repo\MyClash` — must be recorded in MEMORY.
- New requirement: include deployment-automation tasks in the dev plan, modeled on the owner's MyFAL repo (`https://github.com/GrosTony6970/MyFAL`).
- Production hosting: OVH VPS (same as MyFAL) — open to alternatives but defaulting to OVH.
- The agent could not access the MyFAL repo directly (no GitHub MCP available; rate-limited on direct fetch); deployment phase was specced from sensible defaults with O-051 owner-task to share MyFAL patterns when the agent reaches T-055.

## 16:00:00_28-04-2026

**(Session 8 — deploy mechanism clarified)** User answered the open questions:

- MyFAL deploy pattern: **git pull on VPS + docker compose restart** (not GHCR/registry-based).
- Hosting: **OVH VPS** confirmed.
- Deploy trigger: no preference — defaulted to **manual-only for v1** (no auto-deploy, intentional friction on prod).

P0.5 was rewritten accordingly:

- T-054 (GHCR images CI) **removed** — no registry needed.
- New T-054: VPS bootstrap script.
- New T-055: server-side deploy script (`git fetch && reset --hard && build && up`).
- New T-056: local Windows-side `pnpm deploy:prod` that SSHes and invokes T-055.
- New T-056b: rollback command.
- T-057: migration runs after build, before `up` (failed migration aborts deploy with previous version still running).
- T-058 (auto-deploy to staging) **removed** for v1.
- T-058 is now backups + off-site replication.
- T-059 is health/version endpoints.

The trade-off: ~5 min build time on each deploy (acceptable for v1 scale; matches MyFAL's working approach).

## 17:00:00_28-04-2026

**(Session 9 — MyFAL scripts shared + repo restructure)** User shared the actual MyFAL scripts (`deploy.sh`, `start.sh`, `stop.sh`, `refresh.sh`, `status.sh`, `destroy.sh`, `load-test.sh`). User also requested all md files moved to a `memory/` folder.

Actions taken:

- Reorganized repo: `memory/` for agent files (MEMORY, PROMPT_LOG, LESSONS_LEARNED), `docs/` for project docs (ARCHITECTURE, BUILD_ORDER, OWNER_TASKS), root for AGENTS.md / README.md / myclash.md / LICENSE.
- Created reference scripts in `infra/scripts/`: `lib/log.sh` (shared helpers), `deploy.sh`, `rollback.sh`, `start.sh`, `stop.sh`, `refresh.sh`, `status.sh`, `destroy.sh`, `backup.sh`, `restore.sh`. All inherit MyFAL conventions verbatim (color helpers, `set -Eeuo pipefail`, `--env-file .env`, idempotent init).
- Created `scripts/deploy.ts` as cross-platform Windows wrapper.
- Created `.env.deploy.example` for local SSH config.
- Rewrote BUILD_ORDER P0.5: T-051 through T-061, with explicit references to inherited MyFAL conventions and what MyClash adds (Postgres migrations, pre-deploy backup, flock, rollback metadata).
- Updated AGENTS.md, ARCHITECTURE.md, MEMORY.md to reflect new paths and the deployment pattern decisions.
- Added "Deployment patterns" section to MEMORY.md and "Cross-platform & deployment" lessons to LESSONS_LEARNED.md.

O-051 marked partially complete. Still needed: MyFAL's docker-compose, Traefik config, and any VPS bootstrap notes when T-055 starts.

## 18:00:00_28-04-2026

**(Session 10 — MyFAL compose + env + gitignore shared)** User shared:

- `docker-compose.yml` (production)
- `docker-compose.staging-certs.yml` (cert overlay)
- `.env.example`
- `.gitignore`

Actions taken:

- Created `infra/docker-compose.prod.yml` modeled on MyFAL — same Traefik 3.6.6, same cert resolver name (`letsencrypt`), same env var naming (`DOMAIN`, `LETSENCRYPT_EMAIL`, `TZ`, `COMPOSE_PROJECT_NAME`), same `node -e` healthcheck pattern, same `${VAR:-}` defaults pattern. Adapted the service inventory: traefik + db (Supabase Postgres) + redis + supabase-auth + supabase-realtime + supabase-storage + api (NestJS) + worker + 3 web apps. Auth/Realtime/Storage routed via `${DOMAIN}/auth/v1/*` `/realtime/v1/*` `/storage/v1/*` to match Supabase client expectations.
- Created `infra/docker-compose.staging-certs.yml` as a verbatim adaptation of MyFAL's overlay.
- Created `.env.example` with MyFAL naming + MyClash additions (Postgres, Supabase keys, SMTP, Google OAuth, VAPID, HEMA Ratings, backup off-site).
- Created `.gitignore` with MyFAL exclusions + MyClash extensions (data/, logs/, backups/, .last-deploy.json\*, .deploy.lock, infra/scripts/reference/myfal/).
- Created `.gitattributes` enforcing LF for shell scripts and config files (Windows safety).
- Renamed `ROOT_DOMAIN`→`DOMAIN`, `ACME_EMAIL`→`LETSENCRYPT_EMAIL` in deploy.sh and rollback.sh.
- Marked O-051 fully complete in OWNER_TASKS.

## 19:00:00_28-04-2026

**(Session 11 — domain confirmed + pre-deploy checklist)** User confirmed production domain: **`myclash.fr`**.

Actions taken:

- Replaced all `myclash.app` placeholders with `myclash.fr` across `.env.example`, `.env.deploy.example`, `infra/scripts/deploy.sh`, `scripts/deploy.ts`, `docs/OWNER_TASKS.md`, `myclash.md`.
- Created `docs/PRE_DEPLOY_CHECKLIST.md` — a flat, ordered, ~30-item checklist covering everything from domain registration through first deploy and pre-launch validation. Organized in 7 phases: identity & accounts, VPS provisioning, DNS, third-party accounts, secrets generation, first deploy, pre-launch validation. Includes specific PowerShell commands, verification steps, and budget estimate (~€20/month, ~€248/year v1 ops).
- Added domain field to MEMORY.md project identity.
- Updated ARCHITECTURE.md to reference the new checklist doc.

---

_(Future entries go below. Append at session start, after reading `AGENTS.md` and before doing the work.)_

## 20:00:00_28-04-2026

**(Session 12 — identity model + Google OAuth deferred)** User decided:

- Defer Google OAuth (no v1 implementation).
- Want the app to retain a typed name when users select fighter/referee/workshop profile.
- Organizer pre-creates participants with Name, Surname, Email — manual entry + CSV import.

Designed and locked in a **two-tier identity model**:

- **Person**: organizer-authoritative roster row, scoped per tournament, with name + email + club + optional HEMA Ratings.
- **Guest session**: lightweight signed cookie + DB row; user types name → server fuzzy-matches → user picks themselves → bound to that Person for the device. Limited capabilities (no cross-device, no editing).
- **Claimed account**: magic-link upgrade path; binds Person to a Supabase auth user. Required for editing, cross-device, push notification sync.

Architecture changes:

- `persons` table replaces direct fighter→registration link. Registrations now reference `person_id` + nullable `fighter_id` (set when promoted to global Fighter).
- `guest_sessions` table.
- New §12 in ARCHITECTURE: full identity & auth model with capability matrix.
- New API endpoints: persons CRUD, persons CSV import, persons lookup (public, fuzzy, masked email), guest-sessions create/revoke, request-claim.

Build order changes:

- T-009 redefined as magic-link auth only (no Google OAuth path).
- New T-104 (persons CRUD + CSV import), T-104b (lookup endpoint with pg_trgm), T-104c (guest sessions), T-104d (unified /me).
- Renumbered Fighters & Clubs to T-104e to avoid collision.
- T-603 (onboarding) updated to integrate name lookup + guest session creation.
- T-703 (registration management) updated to operate on Persons roster.

Other:

- O-008 (Google OAuth) marked deferred to v1.1 in OWNER_TASKS and PRE_DEPLOY_CHECKLIST.
- Added `MYCLASH_GUEST_JWT_SECRET` to .env.example and docker-compose (separate from Supabase JWT secret — guest sessions can never escalate to Supabase tokens).

## 21:00:00_28-04-2026

**(Session 13 — follow other participants)** User requested: regardless of identity tier (anonymous, guest, claimed), allow viewing other fighters/referees/workshop people's schedule, matches, and results.

Three privacy questions answered with sensible defaults:

- Workshop schedule: private by default, opt-in to share. (Match + referee schedules always public.)
- Following the followed person: not notified. Follow is private and one-directional.
- Anonymous follow: localStorage-only; server-stored requires guest tier.

Architecture changes (ARCHITECTURE.md §11quinquies):

- New `follows` table: tournament-scoped, follower can be either `user_id` (claimed) or `guest_session_id` (guest), CHECK constraint enforces exactly one. Per-follow notification toggles (match/workshop/referee start).
- New `person_privacy` table: per-person prefs for `show_workshops_publicly`, `allow_being_followed`, `show_real_email_to_followers`.
- New API endpoints: `/people` search, `/people/:personId` profile, `/people/:personId/schedule`, `/people/:personId/results`, follows CRUD, privacy GET/PATCH.
- Public-app routes: `/t/<slug>/people`, `/t/<slug>/people/<personId>`, `/t/<slug>/following`, `/t/<slug>/profile/privacy`.
- **Guest→claimed migration must transfer follow rows atomically** (added to claim handler in T-009 spec and to LESSONS_LEARNED).

Build order:

- New tasks T-608 (schedule-for-any-person endpoint with privacy filters), T-609 (privacy prefs), T-610 (follows module + atomic migration test), T-611 (people search + public profile UI), T-612 (watchlist view), T-613 (follow notifications scheduler — depends on T-1201 web push).

Notification policy: claimed users only get push for followed people's matches. Guests get the watchlist UX but no push (they don't have cross-device push anyway). Anonymous get neither — they have to upgrade to guest to even sync the watchlist.

## 22:00:00_28-04-2026

**(Session 14 — privacy answers)** User confirmed:

- Q1 (workshops visible to others): **YES** — flipped from private-by-default to public-by-default. Renamed schema column `show_workshops_publicly` → `hide_workshops_publicly` (default false). User who wants privacy opts out.
- Q2 (notify followed person): no — already correct.
- Q3 (guests can follow): yes — already correct.

Updated: ARCHITECTURE privacy table + capability matrix + schema + API endpoint comment, BUILD_ORDER T-608 + T-609, MEMORY.md, LESSONS_LEARNED.md (rewrote the lesson to reflect "physical-reality follows default visibility").

## 23:00:00_28-04-2026

**(Session 15 — routing flip + open organizer signup + hierarchy swap)** User requested four major changes:

1. App moves to `app.myclash.fr`; apex `myclash.fr` becomes the marketing/landing site.
2. Deploy directly from VPS via `deploy.sh`; the Windows wrapper (T-060) becomes optional.
3. Open organizer onboarding (magic link or email+password, no Google OAuth in v1). Organizer becomes admin of their own event with full event/tournament/workshop/venue/roster control.
4. Super-admin page to manage organizer accounts (suspend / delete / promote / reassign).

User answered three follow-up questions:

- **Hierarchy**: Event = the gathering (FAL 2026), Tournament = a competition within (Longsword Open). This **inverts** the original spec's terminology and requires rippling through ~250 references.
- **Marketing site**: Static HTML/CSS only, served by Caddy. No build tooling.
- **Org signup**: Force the organizer to name their organization at signup (cleaner data, slight friction).

Major actions taken in this session:

**Routing flip**:

- `infra/docker-compose.prod.yml`: web-public → `app.${DOMAIN}`; new web-marketing service routes apex `${DOMAIN}` and `www.${DOMAIN}` (with www → apex redirect via Traefik regex middleware) to a Caddy container; Supabase paths moved from apex to `app.${DOMAIN}`; GoTrue site URL and redirect URIs updated.
- New `apps/web-marketing/` workspace placeholder with stub package.json + README locking in static HTML/CSS only.

**Deploy direction**:

- BUILD_ORDER T-056 reframed as the canonical deploy mechanism with explicit "ssh deploy@myclash.fr; cd /srv/myclash; bash infra/scripts/deploy.sh" workflow.
- BUILD_ORDER T-060 demoted to "skip for v1, optional"; file stays in repo as reference. `scripts/deploy.ts` still exists but isn't wired into pnpm scripts.
- PRE_DEPLOY_CHECKLIST Phase 6 + 7 rewritten — removed `.env.deploy` step, removed all `pnpm deploy:prod` commands, replaced with direct SSH workflow. Renumbered steps (no longer 28; now 27).

**Organizer onboarding**:

- New ARCHITECTURE §12.7bis (signup flow, two-step form, auto-create with named org), §12.7ter (super admin org management with suspend/delete/promote/reassign actions), §12.7quater (account types summary table).
- BUILD_ORDER T-009b: open organizer signup with FORCED organization naming at signup (collision-checked slug, reserved-name list, real-time validation).
- BUILD_ORDER T-009c: super admin organization management dashboard at `/admin/organizations` with all CRUD-with-confirmation actions, audit_log on every action.

**Hierarchy swap (the big one — ~250 references)**:

- New `docs/HIERARCHY.md` as the **authoritative vocabulary doc**. Event = the gathering. Tournament = competition inside. Workshop = teaching session inside event. Persons + Workshops scoped to event_id; Phases + Matches scoped to tournament_id; Registrations are person within event registered to tournament.
- ARCHITECTURE schema swapped: `events` table replaces what was `tournaments` (gathering); `tournaments` table replaces what was `events` (competition); referee_qualifications, referee_assignments, pool_assignment_settings re-scoped to event_id; persons.unique key is `(event_id, lower(email))`.
- ARCHITECTURE API surface swapped: `/api/v1/events/:id/...` for the gathering, `/api/v1/events/:id/tournaments` to list competitions, `/api/v1/tournaments/:id/...` for a specific competition.
- Public app routes: `/e/[eventSlug]/t/[tournamentSlug]` instead of `/t/[slug]/events/[eventSlug]`. Workshops at `/e/[eventSlug]/w/[workshopSlug]`.
- Web-admin routes: `/org/[orgSlug]/events/[eventId]/tournaments/[tournamentId]/...` instead of `/org/[orgSlug]/tournaments/[id]/events/[eventId]/...`.
- Narrative pass over all docs (ARCHITECTURE, BUILD_ORDER, myclash.md, README, OWNER_TASKS, PRE_DEPLOY_CHECKLIST, MEMORY, LESSONS_LEARNED) — replaced "tournament organizer" → "event organizer", "per-tournament" → "per-event", "this tournament" → "this event" where context implies the gathering.
- AGENTS.md doc map updated to list HIERARCHY.md as **authoritative for vocabulary** alongside ARCHITECTURE.md being authoritative for technical design.
- MEMORY.md got a new top-level Hierarchy section.

Pending for next session: final audit pass for stragglers, re-zip the bootstrap.

## 00:00:00_29-04-2026

Starting work on MyClash (F:\Github Repo\MyClash). Read AGENTS.md, memory/MEMORY.md, memory/LESSONS_LEARNED.md, docs/HIERARCHY.md, then start at T-001 in docs/BUILD_ORDER.md. Execute task T-001 · Initialize monorepo. After T-001 ships and reviewed, next tasks follow BUILD_ORDER.md order. Do not bundle multiple tasks. If anything is ambiguous, ask before guessing.

## 01:00:00_29-04-2026

User accepted eslint.config.mjs modification. Continued T-001 execution.

## 02:00:00_29-04-2026

User accepted all edits in F:\Github Repo\MyClash. Continued T-003 scaffolding (Next.js apps).

## 03:00:00_29-04-2026

T-001 shipped and pushed to main (commit e559a40). T-002 already satisfied by initial repo. T-003 shipped (commit bd00faa): three Next.js 15 apps with Tailwind v4, TypeScript strict, ports 3001/3002/3003. T-004 shipped (commit 5620cbe): NestJS API on Fastify, port 4000, GET /health, Swagger at /api/docs. T-005 shipped (commit 3e9c12d): 7 shared package skeletons with tsc build pipeline, workspace deps wired into all apps. T-006 shipped (commit 014a199): Docker Compose dev stack with Traefik self-signed TLS, Postgres, Redis, all apps containerised, Dockerfiles multi-stage. T-007 shipped (commit 03da7cf): Supabase services added to dev compose (Kong, GoTrue, PostgREST, Realtime, Storage). T-008 shipped (commit 69e0429): GitHub Actions CI (install→build-packages→typecheck/lint/test parallel) + CodeQL + CONTRIBUTING.md.

## 04:00:00_29-04-2026

User asked for SMTP provider recommendation. Advised Resend (3000/mo free, native SDK, best deliverability). User set up Resend account and verified myclash.fr domain. User chose Option B (Resend SDK in NestJS, not SMTP bridge). Sender: noreply@myclash.fr. API key to be added to .env later.

## 05:00:00_29-04-2026

T-009 shipped (commit 43be026): auth integration — magic-link claim flow + /api/v1/me. SupabaseModule (global, anon+service clients), MailModule (Resend SDK, bilingual FR/EN emails), AuthModule (POST /api/v1/auth/magic-link, GET /api/v1/auth/callback, GET /api/v1/me). Rate limiting via @nestjs/throttler. Login page (admin app), claim page (public app). 8/8 tests pass. .env.example updated with RESEND_API_KEY, MAIL_FROM, COOKIE_SECRET, SUPABASE_URL.

## 06:00:00_29-04-2026

User asked to verify .env.example is complete and update all memory files. Confirmed .env.example already has all required keys. Updated MEMORY.md (build progress, tech decisions, key env vars), LESSONS_LEARNED.md (NestJS+Vitest testing, email, auth/cookies), PROMPT_LOG.md (this entry).

## 07:00:00_29-04-2026

Continued T-009b (organizer signup), T-009c (super admin org management), T-051..T-059 (deployment automation), T-055 (interactive VPS bootstrap), T-101 (DB schema Drizzle), T-102 (RLS policies), T-103 (seed script), T-104..T-104e (persons CRUD, lookup, guest sessions, /me, fighters/clubs), T-105 (orgs + events/tournaments), T-106 (lices + registrations), T-107 (API client scaffold), T-201+T-202 (ruleset plugin contract + TF_v1), T-203+T-204 (FAL 2026 fixture + golden test), T-205 (TF_v1_no_afterblow + Generic_PointsCap), T-206 (server-side scoring service). All Phase P0, P0.5, P1, P2 complete. Current HEAD: 814013f. Next: Phase P3 T-301 pool generation.

## 08:00:00_29-04-2026

User said "go" — proceeding to Phase P3 T-301 pool generation algorithm. Updating memory files first.

## 09:00:00_30-04-2026

User said "go" — proceeded to Phase P3. Completed T-301 (pool generation: snake seeding + local search, configurable poolCount/targetSize), T-302 (Berger table round-robin), T-303 (single-elimination bracket with configurable bracketSize). User requested pool size configuration → added targetSize mode. User requested bracket size configuration → added options.bracketSize. Current HEAD: 17f9ae7. Next: T-304 Match-to-Lice scheduler.

## 10:00:00_30-04-2026

User requested memory file update before next session. Updated MEMORY.md (P3 build progress, scheduling algorithms section, ruleset engine section), LESSONS_LEARNED.md (scheduling lessons), PROMPT_LOG.md (this entry).

## 00:00:00_30-04-2026

Context transfer session. Continuing lint fix work: fix `no-misused-promises` (remove `then` from makeChain helpers in test files) and `no-unused-vars` (remove unused imports from source files). Then continue with T-304 and remaining tasks. Also fix new web-admin lint errors: `@next/next/no-html-link-for-pages` and `react-hooks/set-state-in-effect`.

## 11:00:00_30-04-2026

User asked why `git push` showed an error message. Explained: not an error — PowerShell writes git's informational stderr output as red `NativeCommandError` text, but the push succeeded (exit code 0, confirmed by `87506b5..709b429 main -> main` in the output).

## 12:00:00_30-04-2026

User requested memory file update before stopping work. Session paused at T-404 (Realtime broadcast). Updated MEMORY.md (P3 completed, P4 in-progress table, Phase P4 implementation notes, scheduling algorithms section expanded with T-304/T-305/T-403 details, removed duplicate Ruleset engine section), LESSONS_LEARNED.md (Vitest mock chain ESLint-safe patterns, React hooks v5 rules), PROMPT_LOG.md (this entry). Current HEAD: 709b429. Next task when resuming: T-404 · Realtime broadcast (server).

## 13:00:00_30-04-2026

User ran `pnpm turbo run typecheck` — 3 errors in `@myclash/api` test files. All same root cause: `(chain as Record<string, unknown>)` fails when `chain` is a `Promise & {...}` intersection type (TS2352 — types don't overlap enough for direct cast). Fixed by casting through `unknown` first: `(chain as unknown as Record<string, unknown>)`. Affected: admin-organizations.service.test.ts, phases.service.test.ts, registrations.service.test.ts. Committed `8ed78ed`, pushed to main. Typecheck now passes across all 12 packages.

## 14:00:00_30-04-2026

User requested memory file update before stopping. Session paused. Next task when resuming: T-404 · Realtime broadcast (server).

## 15:00:00_30-04-2026

`pnpm turbo run typecheck` — 3 errors (TS2352) in makeAwaitableChain: `(chain as Record<string, unknown>)` fails on `Promise & {...}` intersection. Fixed with double cast: `(chain as unknown as Record<string, unknown>)`. Committed `8ed78ed`.

## 16:00:00_30-04-2026

`pnpm format:check` — 142 files with Prettier formatting issues (repo had never had a bulk format pass). Fixed with `pnpm exec prettier --write "**/*.{ts,tsx,js,jsx,json,md,yml,yaml}"`. Committed `5ad7900`. format:check was already in CI (inside the lint job) from a previous session.

## 17:00:00_30-04-2026

User asked to add prettier --write to CI so it never fails again. Added lint-staged + simple-git-hooks: prettier --write runs automatically on staged files before every commit. `prepare` script re-registers the hook after `pnpm install`. Committed `aa4fbe5`. Current HEAD: `aa4fbe5`. Next task: T-404 · Realtime broadcast (server).

## 12:40:00_01-05-2026

New session. User: "lest go for task T-405". Implemented T-405 · Public live match view:

- Added `@supabase/supabase-js` to `apps/web-public`
- `apps/web-public/src/lib/supabase.ts` — browser Supabase client singleton
- `apps/web-public/app/e/[eventSlug]/match/[matchId]/page.tsx` — server component SSR
- `apps/web-public/app/e/[eventSlug]/match/[matchId]/match-live-view.tsx` — 'use client' Realtime subscriptions
- `.env.example` updated with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_API_URL
  Committed `520b903`. Phase P4 complete. Next: P5 T-501 IndexedDB outbox.

## 15:05:00_30-04-2026

New session. User: "we are going to work on MyClash, read all memory files so you get the context." Read all memory files (AGENTS.md, MEMORY.md, LESSONS_LEARNED.md, PROMPT_LOG.md, BUILD_ORDER.md). Confirmed next task: T-404 · Realtime broadcast (server). User selected T-404 from the options presented.

T-404 implemented and committed as `fe15da0`:

- `packages/db/migrations/0004_realtime.sql` — REPLICA IDENTITY FULL on exchanges/matches/match_events; idempotent addition to supabase_realtime publication.
- `apps/api/src/modules/realtime/channels.ts` — typed Channels.\* factory functions for all 5 channel names.
- `apps/api/src/modules/realtime/realtime.service.ts` — thin broadcast wrapper using SupabaseService.service client.
- `apps/api/src/modules/realtime/realtime.module.ts` — exports RealtimeService.
- `apps/api/src/modules/realtime/realtime.module.test.ts` — 5 tests for channel name factories.
- `apps/api/src/app.module.ts` — RealtimeModule imported.

All AC met. lint + typecheck + test green (15 test files, 115 tests). Note: migration file is 0004 (not 0003 as BUILD_ORDER says) because 0003_lookup_functions.sql already existed. Current HEAD: fe15da0. Next task: T-405 · Public live match view.

## 18:00:00_01-05-2026

User asked to run pnpm turbo run lint + typecheck locally before every push, and add to LESSONS_LEARNED. Added mandatory pre-push verification rule. Updated MEMORY.md HEAD to af6ec3c. Next task: T-703.

## Session resumed — 02-05-2026

Context transfer from previous long session. Continuing BUILD_ORDER execution.
T-1101 implemented: HEMA Ratings daily sync job (BullMQ cron + hema_ratings_snapshots table).
hemaratings.com has no public API — HTML scraping used. Fighter list page contains name + club + numeric ID in href.

## 10:00:00_02-05-2026

New session (context transfer). User: "resume next task according to plan". Resumed at T-1101 (HEMA Ratings sync). Confirmed hemaratings.com has no public API — HTML scraping required. Implemented T-1101: BullMQ daily cron (03:30 UTC), `hema_ratings_snapshots` table (migration 0011), `WorkersModule`, Redis env vars added to `.env.example`. Committed `0fd14a3`. Typecheck + lint green before push.

## 11:00:00_02-05-2026

User: "now update all memory file with the work done". Updated MEMORY.md: fixed remote repo URL, added complete build progress tables for P4–P11 (previously missing P5–P9), rewrote implementation notes section to cover all phases, added Redis env vars to key env vars section, added CI Node.js 24 note. Updated PROMPT_LOG.md (this entry). LESSONS_LEARNED.md already up to date — no changes needed.

## 13:31:56_02-05-2026

/plugin install superpowers@superpowers-marketplace

## 13:44:51_02-05-2026

User: "we are going to work on this project : F:\Github Repo\MyClash
read all memory file to get the context (memory and docs folder)"

## 14:05:42_02-05-2026

User requested implementation of T-1102 · HEMA Ratings Search & Link UI in registration from the approved plan. Locked behavior: HEMA link stored on global fighters; every registration gets a Fighter; create Fighter without hema_ratings_id when no HEMA profile is selected; show HEMA suggestions in admin registration flow; defer weighted ratings to later enrichment.

## 16:10:05_02-05-2026

User requested implementation of T-1103 plan: enrich linked HEMA Ratings profiles, display Weighted Rating rows on fighter profiles, and use same-weapon non-stale Weighted Rating for pool seeding. Locked: hema_ratings_id is identity only; category displayed but ignored for seeding; ratings stale after 2 years for seeding but still displayed.

## 18:36:33_02-05-2026

User asked: "next task"

## 18:40:01_02-05-2026

User wants `deploy.sh` to check whether `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` exist in `.env`; if missing, generate them and store them in `.env`; then proceed to T-1201.

## 18:42:25_02-05-2026

User approved the T-1201/deploy VAPID design with: "go".

## 19:11:31_02-05-2026

User asked: next task

## 19:12:18_02-05-2026

User approved proceeding with next task T-1202.

## 00:05:38_03-05-2026

User asked: next task

## 00:06:50_03-05-2026

User approved proceeding with next task T-1203.

## 00:24:25_03-05-2026

User asked: next task

## 00:25:09_03-05-2026

User approved proceeding with T-613.

## 00:27:29_03-05-2026

User approved the T-613 follow notification scheduler design.

## 00:38:12_03-05-2026

User asked to update all necessary memory files so work can be picked up later.

## 14:58:33_03-05-2026

User said plan mode is deactivated and changes can now be made.

## 14:59:13_03-05-2026

User asked to find the next BUILD_ORDER task and plan for it.

## 15:18:56_03-05-2026

User instructed: for main development until the last planned feature is done, Codex may push directly to the main branch.

## 15:23:03_03-05-2026

User requested implementation of T-1302 Fighter Merge Tool plan.

## 20:14:00_03-05-2026

User requested implementation of T-1303 Audit Log UI plan: super-admin audit log API, CSV export, DB indexes, `/admin/audit-log` UI, tests, verification.

## 20:15:18_03-05-2026

User clarified that appending to `docs/notes/glossary.md` is allowed too.

## 20:33:46_03-05-2026

User asked to implement T-1304 Frozen Results State: event-completed results freeze, pending organizer exchange correction requests, super-admin approve/reject API + UI, audit logs, rejection notification, tests, and allow existing dirty glossary.md to be included later.

## 20:57:18_03-05-2026

User asked to implement T-1401 Extract All Strings: shared i18n runtime for web-public/web-admin/web-scoring, English dictionaries plus matching French placeholders, app integration, JSX/metadata string extraction, and CI lint enforcement against hardcoded user-facing strings.

## 10:57:00_04-05-2026

PLEASE IMPLEMENT THIS PLAN: T-1403 Accessibility Pass (WCAG AA)

## 11:11:33_04-05-2026

next task

## 15:56:30_04-05-2026

you can implement the plan

## 16:28:30_04-05-2026

User requested implementation of Google OAuth v1.1 expanded plan: self-hosted GoTrue Google OAuth for organizer login/signup, participant profile claim, workshop attendees, and instructors; preserve magic link/password; update UI, i18n, env/docs, and tests.

## 11:43:27_05-05-2026

User asked to implement the planned Super Admin System Versions page: guarded `/api/v1/admin/system-versions`, deploy-generated `data/system-versions.json`, local manifest fallback, `/admin/system-versions` UI, i18n strings, tests, and verification.

## 12:53:26_05-05-2026

User approved committing and pushing the Super Admin System Versions feature.

## 13:19:26_05-05-2026

User asked to implement the Superadmin Backup Management plan: guarded backup status/list/run/download/upload/restore endpoints, internal ops runner, structured backup metadata, safety locks/confirmation/pre-restore backup, `/admin/backups` UI, i18n strings, and tests.

## 13:54:22_05-05-2026

PLEASE IMPLEMENT THIS PLAN: Organizer Event/Tournament Archives - add organizer-facing event/tournament archive export, CSV reports, and safe copy-based restore from versioned JSON/ZIP archives.

## 17:24:10_05-05-2026

Implement the League System / Tournois Federal plan: cross-event, cross-organizer leagues with league tables, FFAMHE/custom points, event-closure calculation, admin/public APIs, UI, i18n, tests, and verification.

## 18:20:49_05-05-2026

User requested implementation of the Penalty Management / Cartons plan: configurable event/tournament penalty rulesets, built-in FFAMHE CSV ruleset, match penalties, red/black card scoring effects, organizer review for second black card, API/UI integration, i18n, and tests.

## 19:02:46_05-05-2026

PLEASE IMPLEMENT THIS PLAN: MyClash Logo Assets for App Shells. Use Logo_nobackground.png and Logomini_nobackground.png from apps/pictures in web-admin, web-public, and web-scoring app shells; update icons/metadata/PWA icons and visible app shell branding; keep apps/web-marketing/index.html unchanged and do not use Banner.png; run app typechecks and pnpm lint.

## 19:10:33_05-05-2026

User requested a new fighter profile feature: let fighters edit date of birth, nationality, main/secondary/previous clubs, and weapons; let fighters view history across years/events/fights/rankings, upcoming events, and personal statistics including double-hit percentage, win/loss ratio, total wins/losses, and per-weapon/tournament-type stats.

## 19:22:38_05-05-2026

PLEASE IMPLEMENT THIS PLAN: Fighter Profile Editing, Career History, and Statistics. Add claimed-fighter global profile editing, public/private career views, structured club history, controlled weapon catalog, MyClash-derived history/statistics, owner/public APIs, public profile updates, private dashboard UI, i18n, tests, and verification.

## 20:41:48_05-05-2026

PLEASE IMPLEMENT THIS PLAN: Marketing SEO + Wiring Fix. Serve the rich web-marketing landing page from public/, add /en/, copy required picture assets into the served static tree, rewrite image paths, add canonical/hreflang/OG/Twitter/JSON-LD/robots/sitemap, keep Docker/Caddy/Traefik wiring, and verify static SEO/wiring plus marketing typecheck and lint.

## 20:59:29_05-05-2026

User reports the marketing hero and logo are gone and asks to check that the HTML asset paths were changed correctly.

## 21:24:28_05-05-2026

PLEASE IMPLEMENT THIS PLAN: Event Staff Local Accounts + Shareable External Display. Add event-scoped local named PIN staff accounts, Lice-scoped scoring authorization, staff auth cookie, scoring/admin/public UI, public read-only per-match and per-Lice display URLs, tests, and verification.

## 22:54:24_05-05-2026

Implement the Tournament Match Configuration plan: organizer-configurable point cap, side colors, timer mode, scoring direction, phase-specific time limits, soft clock lockout, max double-hit stop, shared ruleset match-format config, UI/API/scoring/display integration, and verification.

## 23:35:08_05-05-2026

PLEASE IMPLEMENT THIS PLAN: Match Correction, Timer Display, and Match Locking

## 00:05:08_06-05-2026

Replace commercial webpage hero copy with updated HEMA/platform/statistics wording.

## 00:07:59_06-05-2026

Add French marketing hero description for the updated all-in-one platform copy.

## 00:11:55_06-05-2026

For referee statistics, use option 1: credit cards distributed to the assigned arbitre declarant.

## 00:13:30_06-05-2026

Referee stats visibility: public summary and private detail. Referee-only people must be supported, not only fighters.

## 00:15:34_06-05-2026

Approved referee statistics design; proceed with planning and implementation.

## 15:47:40_06-05-2026

PLEASE IMPLEMENT THIS PLAN: Claimed Fighter Email Change Workflow. Build a claimed-user-only email change flow for registered fighters/Persons with new-email confirmation, Supabase Auth login email update, all claimed Person emails update, API/UI/mail/tests/docs/memory updates.

## 16:14:24_06-05-2026

PLEASE IMPLEMENT THIS PLAN: Organizer Event Broadcast Notifications. Add organizer event broadcast notifications to all event persons, fighters, referees, or selected Persons with info/warning/alert severity, push plus email fallback, API/UI/tests/docs/memory, commit and push main.

## 16:44:36_06-05-2026

Implement pool/bracket phase visibility publishing: phases hidden by default, organizer publish/unpublish with confirmation after started/completed matches, hide unpublished pool/bracket from participant/public surfaces, add prefilled notification composer, register docs/memory, commit and push main.

## 11:26:01_11-05-2026

Implement AI Data Quality Assistant for Super Admin: separate shared super-admin BYOK key, super-admin scan/review queue for duplicate global persons/referees/clubs and data issues, rules-first plus AI ranking, docs/memory updates, and verification.

## 11:49:30_11-05-2026

Check the remaining pnpm lint/package lint blockers and pnpm test blockers that were reported as pre-existing/unrelated.

## 14:07:38_11-05-2026

New feature: implement AI to assist tournament organisers in creating tournaments, pools, brackets, schedules, and assigning fighters/referees. Register the feature in the correct markdown files and use the brainstorming plugin.

## 16:02:55_11-05-2026

Implement the Organizer AI Tournament Setup Assistant plan: organizer-only draft-and-review AI assistant using organization BYOK/event spend cap, persisted drafts, admin UI, docs registration, and tests.

## 16:42:58_11-05-2026

Implement arbitrary-size single-elimination brackets with default play-in rounds for non-power-of-two qualified counts, keeping explicit bracketSize legacy behavior; register in docs and memory.

## 17:09:14_11-05-2026

Implement scoped web-admin lint debt cleanup for admin clubs, organization compensation settings, and event compensation pages; move literals to i18n, fix accessibility labels, fix clubs useEffect set-state lint, and verify targeted lint/typecheck.

## 17:27:56_11-05-2026

Implement the web-admin blocking lint error cleanup plan: fix all remaining ESLint errors in the eight listed web-admin files, move blocking literal strings to i18n, fix hook errors, keep warning-only debt out of scope, and verify package lint/typecheck.

## 17:38:39_11-05-2026

Make the bracket UI reflect the recent play-in change and block the maximum bracket size at 128.

## 18:21:28_11-05-2026

Implement the configurable fighter forfeit workflow plan: ruleset-configurable injury/voluntary/black-card/conduct forfait behavior, durable reversible forfeit records, match API, pool auto-forfeits, bracket walkovers/replacement behavior, scoring/admin UI, docs, and memory.

## 18:39:09_11-05-2026

Commit and push the current implementation work.

## 18:44:39_11-05-2026

Check how HEMA Ratings "weighted ratings" are retrieved in MyClash.

## 18:47:09_11-05-2026

Quick-test HEMA Ratings fighter id 6282 to see what the current parser/retrieval returns.

## 18:51:32_11-05-2026

Approved updating the HEMA Ratings parser so it retrieves all current table-format ratings, club, and nationality.

## 18:58:41_11-05-2026

Commit and push the HEMA Ratings parser update.

## 22:06:46_11-05-2026

Implement the AI Infrastructure Plan Execution Reconciliation: harden organizer AI settings and event AI usage authorization, clean focused web-admin accessibility warnings, leave the stale untracked AI infrastructure plan file untouched, and verify focused tests/typechecks/lint.

## 22:41:33_11-05-2026

PLEASE IMPLEMENT THIS PLAN: Natural-Language Tournament Query with bilingual French/English input and answers; add tournament query API, persistence, 13 deterministic tools, LLM orchestration, web-admin UI, docs/memory updates, and verification.

## 16:17:55_12-05-2026

User asked to implement the Phase 1 CI Gates Review + Remediation Plan: fix dependency audit blockers, make lint warning-clean, add coverage gates, wire Playwright/Axe into e2e/CI, add audit/secret/Trivy security CI gates, and verify Phase 1 checks.

## 22:01:31_12-05-2026

PLEASE IMPLEMENT THIS PLAN: Phase 2 Security Audit Plan. Run a security review plus targeted remediation pass covering NestJS route auth posture, validation/CORS/throttling, cookies/sessions/CSRF, Supabase auth/service-role boundaries, secrets/env rotation, RLS policy inventory/tests, Dependabot and container supply-chain posture, update docs/pre-production-review-plan.md with Phase 2 status, add focused security docs/tests/scripts, and run security/full gates where practical.

## 23:19:16_12-05-2026

PLEASE IMPLEMENT THIS PLAN: Phase 3 Code Quality Review + Remediation. Add measurable quality gates for TODO/FIXME, API docs, complexity, and shared type leaks; standardize API error responses with a global NestJS exception filter; add process-level unhandled rejection/uncaught exception logging; document code-quality review findings; update pre-production Phase 3 status; run focused and full verification.

## 23:43:26_12-05-2026

PLEASE IMPLEMENT THIS PLAN: Phase 4 Database Review + Remediation. Add database review docs, fresh migration replay/check scripts, synthetic performance fixture and EXPLAIN report tooling, extend RLS tests, document PITR/restore rollback, current direct connection pooling, pg_stat_statements review, and run focused/full verification.

## 09:14:41_13-05-2026

User requested implementation of Phase 5 Containers + Edge/TLS Review: add infrastructure review docs, static and live infra checks, harden production compose containers and Traefik headers, exclude VPS hardening, and verify gates.

## 10:30:33_13-05-2026

PLEASE IMPLEMENT THIS PLAN: Phase 6 Observability & Operations. Add Sentry Cloud wiring, external uptime monitoring documentation, API-first structured/redacted logging, observability review docs and repo checks, env/deploy validation keys, CI observability gate, and update pre-production Phase 6 status with known owner-side evidence gaps.

## 15:34:01_13-05-2026

User reported GitHub CI errors: Trivy production image scan cannot resolve `aquasecurity/trivy-action@0.28.0`, and TypeScript reports deprecated `moduleResolution=node10`; fix the CI/build configuration.

## 15:47:58_13-05-2026

PLEASE IMPLEMENT THIS PLAN: Phase 7 Performance + SQL Query Review - production performance readiness pass covering backend latency, SQL correctness/optimization, frontend budgets, Web Vitals, caching, lightweight load testing, repo checks, docs, CI, and Supabase Postgres best-practice SQL review.

## 16:12:35_13-05-2026

PLEASE IMPLEMENT THIS PLAN: Remediate GitHub CI #239 for commit e4ce0ba. Fix API Docker build workspace package copying/building, defensively type referee auto-assignment result, update complexity baseline drift, verify picomatch 4.0.4/high audit, and run focused plus broader gates.

## 16:30:45_13-05-2026

PLEASE IMPLEMENT THIS PLAN: Trivy CVE Remediation For Latest GitHub Build - update pnpm pins to 10.27.0, refresh lockfile, harden API Docker runtime image to avoid build/dev deps, verify audit/build/lint/typecheck/test/format and Docker/Trivy where available.

## 17:14:57_15-05-2026

PLEASE IMPLEMENT THIS PLAN: Fix API Image Migration Dependencies. Package @myclash/db into the API runtime image so deploy migrations can resolve drizzle-orm/postgres, run the migration script from packages/db/scripts/migrate.mjs, and add infra regression checks.

## 17:34:06_15-05-2026

PLEASE IMPLEMENT THIS PLAN: Fix Raw SQL Production Migrations. Replace Drizzle metadata migrator usage with a raw SQL runner for hand-maintained migration files, add production migration bookkeeping with checksums, keep API Docker/deploy shape, and add DB review regression checks.

## 17:43:15_15-05-2026

PLEASE IMPLEMENT THIS PLAN: Fix 0001 Raw SQL Syntax And Migration Runner Transaction Scope. Replace invalid inline UNIQUE(event_id, lower(email)) with a unique expression index, change the raw migration runner to session-level advisory locking with per-file transactions, and add a DB review guard against inline expression unique constraints.

## 17:56:25_15-05-2026

PLEASE IMPLEMENT THIS PLAN: Fix Unaccent Index Volatility In Migrations. Add an immutable_unaccent SQL wrapper, use it for accent-insensitive indexed lookup expressions, update lookup functions to match, and add DB review guards against raw unaccent() in index definitions.

## 18:11:27_15-05-2026

User reported deploy now applies 0001 but fails on 0002_rls.sql because `auth.jwt()` does not exist in the self-hosted database; investigate and fix the migration path.

## 18:17:38_15-05-2026

PLEASE IMPLEMENT THIS PLAN: Fix `0026` Function Return-Type Migration Failure by dropping `find_club_by_name(TEXT, FLOAT)` before recreating it with the expanded return shape, and add a DB review guard.

## 18:24:20_15-05-2026

PLEASE IMPLEMENT THIS PLAN: Fix `0033` Tournament Query View After `fighters` Rename by joining `global_persons` instead of `fighters` and adding a DB review guard for post-0023 table references.

## 18:34:38_15-05-2026

PLEASE IMPLEMENT THIS PLAN: Fix stale DB performance fixture after `global_persons` rename by updating the Phase 4 fixture generator, regenerating the SQL fixture, and extending DB review stale-reference coverage.

## 19:02:14_15-05-2026

PLEASE IMPLEMENT THIS PLAN: Fix Supabase Realtime schema collision by provisioning `_realtime`, forcing Realtime DB connections to use that search path, adding a Realtime DB encryption key env var, and extending infra/env regression checks.

## 19:08:37_15-05-2026

Modify `infra/scripts/status.sh` so the API health and API version checks work instead of warning that `/health` and `/version` are unreachable.

## 19:16:25_15-05-2026

PLEASE IMPLEMENT THIS PLAN: Auto-generate missing deploy secrets. Ensure `SUPABASE_REALTIME_DB_ENC_KEY` is appended/generated when missing, generate `TRAEFIK_DASHBOARD_AUTH` automatically when missing/sample, and display the one-time Traefik dashboard password for the user to save.

## 19:25:48_15-05-2026

PLEASE IMPLEMENT THIS PLAN: Fix Realtime `DB_ENC_KEY` bad key size by generating exactly 16-character `SUPABASE_REALTIME_DB_ENC_KEY` values, regenerating invalid existing keys, updating examples/dev defaults, and adding regression checks.

## 19:43:30_15-05-2026

PLEASE IMPLEMENT THIS PLAN: Fix `status.sh` Postgres hang by making the connection-count `psql` query non-interactive, TCP-based, timeout-bounded, and guarded by `infra:review`.

## 19:46:18_15-05-2026

PLEASE IMPLEMENT THIS PLAN: Fix false unhealthy Supabase healthchecks by replacing Realtime, Storage, and PostgREST production healthchecks with image-compatible probes and guarding them in `infra:review`.
