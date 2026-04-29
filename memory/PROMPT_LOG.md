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
- Created `.gitignore` with MyFAL exclusions + MyClash extensions (data/, logs/, backups/, .last-deploy.json*, .deploy.lock, infra/scripts/reference/myfal/).
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

*(Future entries go below. Append at session start, after reading `AGENTS.md` and before doing the work.)*

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
