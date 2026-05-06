# MyClash — Build Order

> **Operational task list for the AI coding agent.**
>
> Read `docs/ARCHITECTURE.md` first. That document is the source of truth for _what_ and _why_. This document is the source of truth for _order_ and _acceptance criteria_.
>
> Owner-side tasks (things only the human project owner can do — domains, hosting, legal, beta event coordination) are tracked in `docs/OWNER_TASKS.md` and cross-referenced from individual tasks below as `[needs O-NNN]`.
>
> **Rules of engagement:**
>
> 1. Tasks are picked **in order**. Don't skip ahead unless dependencies allow it.
> 2. **One task = one PR.** Atomic, reviewable, testable.
> 3. Acceptance criteria are **testable assertions**, not aspirations. If you can't verify it, the task isn't done.
> 4. If a task is blocked or ambiguous, **stop and ask** — don't improvise architecture.
> 5. If a task references an `[O-NNN]` owner task that hasn't been completed, **stop and notify** — don't try to work around it.
> 6. Always run `pnpm lint && pnpm typecheck && pnpm test` before opening a PR.

---

## Legend

- **ID** — Stable identifier. Don't renumber when inserting tasks; use letters (T-012a).
- **Dep** — Tasks that must be merged first.
- **Files** — Primary files created or significantly edited (not exhaustive).
- **AC** — Acceptance criteria. All must pass for the task to be considered complete.

---

## Phase P0 — Bootstrap

### T-001 · Initialize monorepo

- **Dep**: none
- **Goal**: Working `pnpm` + Turborepo monorepo with empty workspace targets.
- **Files**: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.gitignore`, `.editorconfig`, `.prettierrc`, `eslint.config.mjs`, `tsconfig.base.json`, `README.md`, `LICENSE` (AGPL-3.0).
- **AC**:
  - `pnpm install` succeeds at root.
  - `pnpm turbo run build --dry` lists empty workspaces without error.
  - LICENSE is AGPL-3.0 with current year and project author.
  - README has project mission, link to `docs/ARCHITECTURE.md` and `docs/BUILD_ORDER.md`.

### T-002 · Add ARCHITECTURE.md and BUILD_ORDER.md

- **Dep**: T-001
- **Goal**: Commit the architecture and build order documents as project anchors.
- **Files**: `docs/ARCHITECTURE.md`, `docs/BUILD_ORDER.md`, `AGENTS.md` (copy of §21 from ARCHITECTURE.md).
- **AC**:
  - Both docs in repo.
  - `AGENTS.md` at repo root references both.

### T-003 · Scaffold the three frontend apps

- **Dep**: T-001
- **Goal**: Three Next.js 15 apps (App Router, TS strict) at `apps/web-public`, `apps/web-scoring`, `apps/web-admin`. Each renders a placeholder home page.
- **Files**: `apps/web-public/**`, `apps/web-scoring/**`, `apps/web-admin/**`.
- **AC**:
  - `pnpm --filter web-public dev` serves `http://localhost:3001`.
  - Same for `web-scoring` (port 3002) and `web-admin` (port 3003).
  - Each app has Tailwind CSS configured.
  - Each app has TypeScript strict mode and passes `pnpm typecheck`.

### T-004 · Scaffold the NestJS API

- **Dep**: T-001
- **Goal**: NestJS 10 app at `apps/api` with health check endpoint.
- **Files**: `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/api/src/health/*`.
- **AC**:
  - `pnpm --filter api dev` starts on port 4000.
  - `GET /health` returns `{ status: "ok", uptime: <number> }`.
  - OpenAPI/Swagger UI mounted at `/api/docs` in dev.

### T-005 · Shared packages skeletons

- **Dep**: T-001
- **Goal**: Empty package skeletons for `@myclash/ui`, `@myclash/types`, `@myclash/rulesets`, `@myclash/db`, `@myclash/design-tokens`, `@myclash/i18n`.
- **Files**: `packages/*/package.json`, `packages/*/src/index.ts`, `packages/*/tsconfig.json`.
- **AC**:
  - All packages build with `pnpm turbo run build`.
  - Each app can `import` from each package without errors.

### T-006 · Docker Compose with Traefik + Postgres + Redis

- **Dep**: T-003, T-004
- **Owner**: needs O-002 (hosting decision) for prod deploy; local dev only requires O-010 (hosts file).
- **Goal**: `docker compose up` brings up Traefik, Postgres, Redis, all 3 frontends, API. HTTPS works locally with self-signed certs.
- **Files**: `infra/docker-compose.yml`, `infra/docker-compose.dev.yml`, `infra/traefik/**`, each app's `Dockerfile`.
- **AC**:
  - `docker compose up -d` succeeds.
  - `https://myclash.localhost` (web-public), `https://admin.myclash.localhost`, `https://scoring.myclash.localhost`, `https://api.myclash.localhost/health` all reachable.
  - `docker compose down` cleans up without orphaned containers.

### T-007 · Self-hosted Supabase services

- **Dep**: T-006
- **Goal**: Add `supabase-auth` (GoTrue), `supabase-storage`, `supabase-realtime`, `kong`, `postgrest` to compose.
- **Files**: `infra/docker-compose.yml`, `infra/supabase/**`, `.env.example`.
- **AC**:
  - Auth: signup with email returns user from `/auth/v1/signup`.
  - Storage bucket creation works via REST.
  - Realtime websocket connects at `wss://api.myclash.localhost/realtime/v1/websocket`.

### T-008 · CI pipeline

- **Dep**: T-005
- **Goal**: GitHub Actions workflow that runs lint, typecheck, test on every PR.
- **Files**: `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`.
- **AC**:
  - PR triggers `ci` workflow; all jobs pass on the bootstrap state.
  - CodeQL security scan enabled.
  - Required status checks documented in `CONTRIBUTING.md`.

### T-009 · Auth integration end-to-end (magic-link claim flow)

- **Dep**: T-007, T-003
- **Owner**: needs O-006 (SMTP for magic links). **Google OAuth (O-008) deferred — not in v1.**
- **Goal**: A user can request a magic link to claim a Person profile, receive the link by email, click it, and become a Claimed account. Organizers can also log in via magic link to access the admin app.
- **Files**: `apps/web-admin/app/login/**`, `apps/web-public/app/e/[eventSlug]/claim/**`, `apps/api/src/modules/auth/**`.
- **AC**:
  - Organizer login at `/login` (admin app) → magic link to email → click → JWT cookie set, lands on org dashboard.
  - Person claim at `/e/<eventSlug>/claim?personId=...` (public app) → magic link to person.email → click → `persons.claim_status` becomes `'claimed'`, `claimed_by_user_id` set.
  - Magic link emails go through Resend (or other SMTP from O-006).
  - API `/api/v1/me` returns either `{ type: 'claimed', user, person? }` or `{ type: 'guest', person }` or `{ type: 'anonymous' }`.
  - Rate limiting on magic link requests: 3 per hour per email + 10 per hour per IP.

### T-009b · Organizer signup (open self-service, named org)

- **Dep**: T-009
- **Goal**: Anyone can self-sign-up as a event organizer via the admin app. Magic link OR email + password. **Organizer must name their organization at signup** (no auto-creation).
- **Files**: `apps/web-admin/app/signup/**`, `apps/api/src/modules/auth/signup.controller.ts`, `apps/api/src/modules/organizations/onboarding.service.ts`.
- **AC**:
  - `/signup` form is a **two-step** flow (single-page with progressive disclosure):
    1. **Account**: email + display name. Two paths: "Continue with magic link" or "Continue with password" (with confirm field).
    2. **Organization**: organization name + slug (auto-suggested from name, editable). Must be unique. Tooltip explains: "This is the public name people will see when browsing your events. You can change it later in settings."
  - Submission of step 2 is what triggers account creation. Step 1 alone does nothing server-side — the user can back out without leaving an orphan account.
  - Email + password path: account created in `auth.users` with `email_confirmed_at = NULL`; verification email sent; user must verify before creating any event (org dashboard shows a banner until verified).
  - Magic link path: account is implicitly verified on first link click.
  - On successful submission, atomically:
    - Insert `auth.users` (handled by Supabase).
    - Insert `organizations` row with the user-provided `name`, `slug` (collision-checked client-side, server-validated), `status = 'active'`.
    - Insert `organization_members` with `role = 'owner'`.
  - First login lands on `/org/<slug>` org dashboard with empty state, prompting "Create your first event".
  - Slug uniqueness validation is real-time (debounced 300ms) on the form, with green checkmark / red error.
  - Reserved slugs blocked: `admin`, `api`, `app`, `www`, `myclash`, `super`, `staff`, plus a config list for future additions.
  - Rate limit: 5 signups per hour per IP.

### T-009c · Super admin organization management

- **Dep**: T-009b
- **Goal**: Super admin dashboard for managing organizer accounts.
- **Files**: `apps/web-admin/app/admin/organizations/**`, `apps/api/src/modules/admin/organizations.controller.ts`.
- **AC**:
  - List view at `/admin/organizations` with: org name, owner email, member count, event count, status, last activity, created_at. Sortable, filterable.
  - Detail view at `/admin/organizations/[id]` with: members, events, recent audit log entries.
  - Actions (each with confirmation prompt):
    - **Suspend** → `organizations.status = 'suspended'`, all events become read-only-public, members blocked from mutations. Reversible.
    - **Reactivate** → `status = 'active'`.
    - **Delete (hard)** → cascades to events; preserves global Fighter profiles and claimed Persons by reattaching to a `<deleted>` placeholder org. Logs to audit_log.
    - **Promote member to super_admin** → inserts `platform_roles.role = 'super_admin'` for the chosen user.
    - **Reassign ownership** → if `owner` is unreachable, super admin picks another member to become owner.
  - Suspended-org behavior tested end-to-end: a member of a suspended org cannot create events, edit registrations, or score matches; they can still log in and view existing data read-only.
  - All actions appear in `audit_log` with actor, action, target, and timestamp.

---

## Phase P0.5 — Deployment Automation (OVH VPS)

> **Goal**: Reproducible, scriptable deployment to an OVH VPS, modeled on the owner's MyFAL deployment patterns (https://github.com/GrosTony6970/MyFAL).
>
> **Pattern**: `git pull` on the VPS + `docker compose build` + `docker compose up -d`. Builds happen on the VPS itself — no image registry, no GHCR. This matches MyFAL's working approach and is appropriate for v1's scale.
>
> **Trigger**: Manual deploy from the owner's Windows machine via `pnpm deploy:prod`. No auto-deploy in v1.
>
> **Conventions to inherit verbatim from MyFAL** (see `infra/scripts/lib/log.sh`):
>
> - Color-coded `ok`/`err`/`warn`/`hdr`/`info` helpers, sourced by every script.
> - `set -Eeuo pipefail` at the top of every bash script.
> - `ROOT_DIR` resolution via `BASH_SOURCE`.
> - `docker compose --env-file .env -f infra/docker-compose.prod.yml ...` everywhere (explicit env file flag).
> - Idempotent file initialization: `[[ ! -f X ]] || touch X` for ACME, etc.
> - Retry loops for health checks (RETRIES × DELAY).
>
> **What MyClash adds beyond MyFAL**:
>
> - Drizzle migrations (with abort-on-failure semantics).
> - Pre-deploy `pg_dump` to `backups/pre-deploy/` (Postgres, not just JSON files).
> - `flock` lock to prevent concurrent deploys.
> - Explicit rollback script (`infra/scripts/rollback.sh`).
> - `.last-deploy.json` deploy metadata.
> - Cross-platform Windows wrapper (`scripts/deploy.ts`) so the owner can `pnpm deploy:prod` from PowerShell.
>
> **Owner actions required first**: O-002 (VPS provisioned), O-003 (host hardened), O-001 (domain DNS pointing to VPS), O-051 (MyFAL reference scripts shared with the agent — already provided in the repo as reference at `infra/scripts/reference/myfal/`).

### T-051 · `.gitattributes` and cross-platform hygiene

- **Dep**: T-001
- **Goal**: Enforce LF line endings and Windows-friendly tooling so the repo works identically on Windows / Linux / macOS.
- **Files**: `.gitattributes`, `package.json` (scripts), `.editorconfig`.
- **AC**:
  - `.gitattributes` enforces `* text=auto eol=lf`, with explicit `*.sh text eol=lf` and `*.ps1 text eol=crlf`.
  - All package.json scripts run in PowerShell on Windows (no bash-only operators).
  - Bash scripts that run on the VPS live under `infra/scripts/` and are clearly labeled "server-side only".
  - Cross-platform scripts (Node) live under `scripts/`.
  - Verified: cloning the repo on Windows produces the same file hashes as on Linux.

### T-052 · `infra/scripts/lib/log.sh` shared helpers

- **Dep**: T-001
- **Goal**: Single source for all shell-script color/output helpers. All other scripts in `infra/scripts/` source this file.
- **Files**: `infra/scripts/lib/log.sh`.
- **AC**:
  - Provides: `ok`, `err`, `warn`, `hdr`, `info`, `confirm`, `require_cmd`.
  - Color detection auto-disables on non-TTY output.
  - Zero external dependencies (callable in early stages of bootstrap before any package install).
  - Sourceable via: `source "$(dirname "${BASH_SOURCE[0]}")/lib/log.sh"`.

### T-053 · Production Dockerfiles

- **Dep**: T-006
- **Goal**: Production-grade multi-stage Dockerfiles for `apps/api`, `apps/web-public`, `apps/web-scoring`, `apps/web-admin`. Builds on the VPS, so cache layers matter.
- **Files**: `apps/*/Dockerfile`, `.dockerignore` per app.
- **AC**:
  - Multi-stage build: deps → build → runner.
  - Final image runs as non-root user.
  - Final image size: API <300MB, web apps <250MB each.
  - Image health check defined.
  - BuildKit cache mounts for `pnpm install`.
  - Builds reproducibly on a fresh VPS in <10 min cold, <2 min warm.

### T-054 · Production docker-compose

- **Dep**: T-053
- **Goal**: `infra/docker-compose.prod.yml` with resource limits, restart policies, health-checked dependencies, log rotation. **Reference implementation already drafted in repo** (modeled on MyFAL's `docker-compose.yml`).
- **Files**: `infra/docker-compose.prod.yml`, `infra/docker-compose.staging-certs.yml`, `.env.example`.
- **AC**:
  - Traefik 3.6.x, cert resolver name `letsencrypt`, ACME storage `/data/acme.json`, TLS challenge port 443.
  - Container names prefixed `myclash-` (from `COMPOSE_PROJECT_NAME=myclash`).
  - Env vars use MyFAL naming: `DOMAIN`, `LETSENCRYPT_EMAIL`, `TZ`, `COMPOSE_PROJECT_NAME`. Optional vars use `${VAR:-}` defaults.
  - Healthchecks: `node -e` HTTP probe (no curl/wget binary needed).
  - All services have `restart: unless-stopped`, `mem_limit`, `cpus`, `logging: json-file/10m/3`.
  - Postgres + Redis + Storage volumes named explicitly: `myclash-postgres-data`, `myclash-redis-data`, `myclash-storage-data`.
  - Routing:
    - `https://${DOMAIN}` → web-public (priority 1)
    - `https://${DOMAIN}/auth/v1/*` → supabase-auth (priority 20)
    - `https://${DOMAIN}/realtime/v1/*` → supabase-realtime (priority 20)
    - `https://${DOMAIN}/storage/v1/*` → supabase-storage (priority 20)
    - `https://api.${DOMAIN}` → api (NestJS)
    - `https://admin.${DOMAIN}` → web-admin
    - `https://scoring.${DOMAIN}` → web-scoring
  - Shared `myclash-compress@docker` middleware applied to all routers.
  - `staging-certs` overlay swaps in `acme-staging.json` and the LE staging endpoint, verbatim from MyFAL pattern.
  - `depends_on: { db: { condition: service_healthy }, redis: { condition: service_healthy } }` on api and worker.

### T-055 · VPS bootstrap script

- **Dep**: O-002, O-003
- **Owner**: needs O-051 (MyFAL reference) and SSH access to the VPS.
- **Goal**: Idempotent bash script that sets up a fresh OVH VPS to host MyClash.
- **Files**: `infra/scripts/vps-bootstrap.sh`.
- **AC**:
  - Sources `lib/log.sh`.
  - Installs: Docker Engine, Docker Compose v2, git, ufw, fail2ban, unattended-upgrades, jq.
  - Configures: ufw (allow 22, 80, 443; deny rest), automatic security updates, swap file (2GB if RAM <8GB).
  - Creates: deploy user (non-root, sudoer for docker), `/srv/myclash` with correct ownership.
  - Clones the MyClash repo into `/srv/myclash` using a deploy key.
  - Installs a cron entry for nightly `infra/scripts/backup.sh`.
  - Idempotent: re-running on an already-provisioned host is a no-op.
  - Tested on a fresh OVH VPS Ubuntu 24.04 image.

### T-056 · `infra/scripts/deploy.sh` (the primary deploy mechanism)

- **Dep**: T-052, T-054, T-055
- **Goal**: The canonical deploy script. Runs on the VPS. **This is how MyClash is deployed in v1 — directly from the VPS, manually, by the owner.** The cross-platform Windows wrapper (T-060) is optional convenience only.
- **Files**: `infra/scripts/deploy.sh` (reference implementation already drafted in repo).
- **AC**:
  - Sources `lib/log.sh`.
  - Acquires `flock` on `.deploy.lock` — concurrent deploys impossible.
  - Validates `.env` (must define `DOMAIN`, `LETSENCRYPT_EMAIL`, `POSTGRES_PASSWORD`).
  - Auto-generates VAPID keys if missing.
  - Stamps `VERSION` into service-worker cache names.
  - Pre-deploy: `pg_dump` to `backups/pre-deploy/<timestamp>.sql.gz`.
  - `git fetch && git reset --hard origin/main`.
  - `docker compose build` then runs migrations (`docker compose run --rm api pnpm --filter @myclash/db migrate`).
  - **Migration failure → script exits non-zero, `up` is not called, old containers continue running.**
  - On success: `docker compose up -d`, wait for healthchecks (20×3s per service).
  - Smoke test via `curl https://api.${DOMAIN}/health`.
  - Records `.last-deploy.json` with `previousCommit`, `deployedCommit`, `deployedAt`, `deployedBy`, `backupFile`.
  - `--dev-certs`, `--skip-backup`, `--skip-migrations` flags supported (last two are dev-only, never used in prod).
  - **Standard owner invocation**: `ssh deploy@myclash.fr`, then `cd /srv/myclash && bash infra/scripts/deploy.sh`.

### T-057 · `infra/scripts/rollback.sh`

- **Dep**: T-056
- **Goal**: Revert the last deploy: restore DB from pre-deploy backup, reset git, rebuild, restart.
- **Files**: `infra/scripts/rollback.sh` (reference implementation already drafted).
- **AC**:
  - Reads `.last-deploy.json` for the previous commit and backup file.
  - Confirms with user before destructive action.
  - Stops app services (keeps `db` running for restore).
  - Restores Postgres: `DROP DATABASE`, `CREATE DATABASE`, pipe `gunzip` into `psql`.
  - `git reset --hard <previous-commit>`.
  - Rebuilds and restarts.
  - Renames old `.last-deploy.json` to `.last-deploy.json.rolled-back-<timestamp>` and writes a new metadata file with `isRollback: true`.

### T-058 · `infra/scripts/{start,stop,refresh,status,destroy}.sh`

- **Dep**: T-052, T-054
- **Goal**: Day-2 operational scripts modeled on MyFAL's set.
- **Files**:
  - `infra/scripts/start.sh` — bring stack up without rebuilding.
  - `infra/scripts/stop.sh` — halt stack.
  - `infra/scripts/refresh.sh` — restart one or more services with health-wait. Defaults to all app services.
  - `infra/scripts/status.sh` — comprehensive health dump: container statuses, healthchecks, last-deploy metadata, API `/health` and `/version`, Postgres `pg_isready`, Redis `PING`, BullMQ queue snapshot, VAPID status, disk usage, recent logs.
  - `infra/scripts/destroy.sh` — remove containers/images, optionally `--wipe-db` to nuke volumes, with `--force` to skip confirmation.
- **AC**:
  - All source `lib/log.sh`.
  - All use `docker compose --env-file .env -f infra/docker-compose.prod.yml`.
  - `status.sh` matches the structure of MyFAL's status.sh and adds Postgres/Redis/BullMQ checks.
  - `destroy.sh` confirms before destruction; `--force` skips the prompt; `--wipe-db` is required to remove volumes.

### T-059 · `infra/scripts/{backup,restore}.sh` and cron

- **Dep**: T-054, T-055
- **Goal**: Nightly backups, off-site replication, restore procedure.
- **Files**:
  - `infra/scripts/backup.sh` — pg_dump + storage tar + optional GPG encryption + S3/B2 upload via rclone or aws-cli.
  - `infra/scripts/restore.sh` — restore from a chosen backup file.
  - Cron entry installed by T-055.
  - `docs/RUNBOOK.md` — procedure documentation.
- **AC**:
  - `backup.sh` runs nightly at 03:00 UTC via cron.
  - Optional encryption: when `BACKUP_GPG_RECIPIENT` set, encrypts the dump.
  - Off-site: when `BACKUP_S3_BUCKET` set, replicates via rclone (preferred) or aws-cli.
  - Retention: 30 daily kept locally; off-site retention via bucket lifecycle policy.
  - `restore.sh <file>` confirms, decrypts if needed, drops & recreates DB, restores.
  - **Restore drill performed at least once before P15** (the beta event). Documented in RUNBOOK.

### T-060 · `scripts/deploy.ts` cross-platform wrapper — OPTIONAL / deferred

- **Dep**: T-056
- **Status**: **Skip for v1.** The owner deploys directly from the VPS via SSH (T-056). The Windows wrapper is convenience for occasional one-off pushes from the owner's laptop and can be implemented later if needed.
- **Goal** (when implemented): One-command deploy from the owner's Windows machine: `pnpm deploy:prod`.
- **Files**: `scripts/deploy.ts` (reference implementation already drafted in repo as a starting point), `.env.deploy.example`, `package.json` script.
- **AC** (when implemented):
  - Reads `.env.deploy` (gitignored) for `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY_PATH`, `DEPLOY_REPO_PATH`, `DEPLOY_SMOKE_URL`.
  - SSHes to the VPS and invokes `cd <repo> && bash infra/scripts/deploy.sh <args>`.
  - Streams output back live.
  - On exit: smoke-tests the public endpoint from the local machine.
  - `--dry-run` prints the command without executing.
  - Works in Windows PowerShell, macOS Terminal, and Linux shells without modification.
  - `pnpm rollback:prod` is the analogous wrapper for `infra/scripts/rollback.sh`.
- **Why deferred**: Adds Node SSH dependency (`ssh2` or shell-out), needs `.env.deploy` setup on the dev machine, and fails opaquely when SSH config is wrong. Direct VPS deploy via `ssh + bash deploy.sh` is one extra command and far simpler to debug. The Node wrapper file stays in the repo as a reference, but is not wired up.

### T-061 · Health & version endpoints

- **Dep**: T-054
- **Goal**: Lightweight ops endpoints so owner and `status.sh` can verify a deploy at a glance.
- **Files**: `apps/api/src/modules/health/version.controller.ts`.
- **AC**:
  - `GET /health` returns `{ status, uptime, db: ok|error, redis: ok|error }`.
  - `GET /version` returns `{ commit, branch, builtAt, deployedAt }` (commit injected at build via `--build-arg GIT_COMMIT`).
  - `infra/scripts/status.sh` displays both.

---

## Phase P1 — Domain Core

### T-101 · DB schema (Drizzle)

- **Dep**: T-007
- **Goal**: Complete schema from ARCHITECTURE.md §5 in Drizzle format. Migration applied.
- **Files**: `packages/db/src/schema/*.ts`, `packages/db/migrations/0001_init.sql`, `packages/db/drizzle.config.ts`.
- **AC**:
  - `pnpm --filter db migrate` applies cleanly to a fresh DB.
  - Every table from §5 exists, including `workshops`, `workshop_sessions`, `workshop_enrollments`, `referee_assignments`, `push_subscriptions`, `notification_preferences`.
  - Foreign keys, unique constraints, and indexes match the spec.

### T-102 · RLS policies for all tables

- **Dep**: T-101
- **Goal**: Postgres RLS enabled on every user-data table with policies for read/write per role.
- **Files**: `packages/db/migrations/0002_rls.sql`.
- **AC**:
  - Anonymous role can SELECT only published events and their public children.
  - `organization_member` with `role='admin'` can SELECT/UPDATE only their org's events.
  - `super_admin` bypasses (via `auth.jwt() ->> 'role' = 'super_admin'`).
  - Test suite `packages/db/test/rls.test.ts` proves at least 10 cross-tenant leak attempts fail.

### T-103 · Seed script — minimal

- **Dep**: T-101
- **Goal**: `scripts/seed-min.ts` creates a super admin, one organization, one organizer user.
- **Files**: `scripts/seed-min.ts`.
- **AC**:
  - `pnpm seed:min` creates expected rows.
  - Idempotent (running twice produces no duplicates / no errors).

### T-104 · Persons CRUD + CSV import (the organizer roster)

- **Dep**: T-101
- **Goal**: NestJS `persons` module — manual create, edit, delete, list per event; CSV import with structured report.
- **Files**: `apps/api/src/modules/persons/**`, `packages/types/persons.ts`.
- **AC**:
  - All endpoints from §14 work.
  - CSV import validates: required columns (`given_name`, `family_name`, `email`), email format, unique within event.
  - Fuzzy club matching on `clubs.name` using `pg_trgm`; new clubs created with `unverified=true`.
  - Returns the structured report shape from §12.8 (created / updated / duplicates / invalid / new_clubs_for_review).
  - Email match on `(event_id, lower(email))` for the unique constraint.
  - CSV parsing handles BOM, quoted commas, accented characters.
  - Test: import a 100-row CSV with 3 invalid rows, 5 duplicates, 2 new clubs → exactly that report.

### T-104b · Person lookup endpoint (fuzzy name search)

- **Dep**: T-104
- **Goal**: Public endpoint that participants hit when typing their name on the onboarding screen.
- **Files**: `apps/api/src/modules/persons/lookup.controller.ts`, migration adding `pg_trgm` indexes.
- **AC**:
  - `GET /events/:id/persons/lookup?q=...` returns `[{ id, given_name, family_name, club_label, masked_email }]`.
  - Search uses `pg_trgm` similarity on `unaccent(given_name)` and `unaccent(family_name)`, threshold 0.3.
  - Returns max 10 matches, sorted by similarity desc.
  - Email is masked: `j***@g***.com`.
  - Rate limited: 30 req/min per IP, 200 req/min per event.
  - Test: query "jean" returns "Jean Dupont", "Jéan Martin", "Jean-Pierre Lambert" but not "Marie Dupont".

### T-104c · Guest session module

- **Dep**: T-104b
- **Goal**: Create / resolve / revoke guest sessions; signed cookie + DB row.
- **Files**: `apps/api/src/modules/auth/guest-sessions.controller.ts`, `apps/api/src/modules/auth/guest-jwt.guard.ts`.
- **AC**:
  - `POST /events/:id/guest-sessions` with `{ person_id }` → creates row, sets `mc_guest` httpOnly cookie, returns `{ person, session }`.
  - JWT signed with `MYCLASH_GUEST_JWT_SECRET` (separate from Supabase secret).
  - `DELETE /guest-sessions/me` revokes (sets `revoked_at`) and clears cookie.
  - Guest sessions expire at `event.end_date + 7 days`.
  - Cookie attributes: `Secure`, `HttpOnly`, `SameSite=Lax`, scoped to the event's host.
  - `@GuestSession()` decorator extracts the bound `person_id` for downstream guards.
  - Test: a guest session for Person A cannot perform any action where the request body or path implies Person B.

### T-104d · `/api/v1/me` unified identity endpoint

- **Dep**: T-104c, T-009
- **Goal**: Single endpoint that returns whichever identity is active.
- **Files**: `apps/api/src/modules/auth/me.controller.ts`.
- **AC**:
  - Claimed cookie present → `{ type: 'claimed', user: {...supabase user}, person?: {...} }` (person attached if `persons.claimed_by_user_id` matches).
  - Guest cookie present → `{ type: 'guest', person: {...}, session: { device_label, expires_at } }`.
  - Neither → `{ type: 'anonymous' }`.
  - Both present → claimed wins; the guest cookie is cleared (consolidation).

### T-104e · Fighters & Clubs API (cross-event identity)

- **Dep**: T-104
- **Goal**: NestJS modules `fighters` and `clubs` with full CRUD per ARCHITECTURE.md §14. Fighters are the cross-event aggregate; created lazily via `POST /fighters/:id/promote` from a claimed Person.
- **Files**: `apps/api/src/modules/fighters/**`, `apps/api/src/modules/clubs/**`.
- **AC**:
  - All endpoints listed in §14 work.
  - Zod validation on every input.
  - Slugs are auto-generated and unique.
  - `POST /fighters/:id/promote` requires a claimed account whose `persons.id` matches the Person being promoted.
  - OpenAPI spec in `/api/docs` matches.

### T-104f · Claimed Person email change workflow

- **Dep**: T-104d, T-009
- **Goal**: Claimed fighters can change their login/contact email after confirming a link sent to the new address.
- **Files**: `apps/api/src/modules/persons/**`, `apps/api/src/modules/mail/mail.service.ts`, `apps/web-public/app/e/[eventSlug]/profile/email/**`, `packages/db/migrations/0020_person_email_change_requests.sql`.
- **AC**:
  - Only claimed Supabase users with at least one claimed Person row can request a change.
  - New email is normalized, validated, and rejected if it matches the current login email.
  - Before creating a request, every claimed Person event is checked for `(event_id, lower(email))` conflicts against other Persons.
  - Confirmation tokens are stored only as SHA-256 hashes, expire after 1 hour, and are single-use/cancellable.
  - Confirming updates Supabase Auth email and all `persons.email` rows where `claimed_by_user_id` matches.
  - Confirmation writes `audit_log.action = 'person.email_change_confirmed'`.
  - Public app page `/e/[eventSlug]/profile/email` shows current email, pending state, request form, and cancel action.
  - Tests cover anonymous/guest rejection, duplicate email rejection, hash-only token storage, request replacement, expired/reused token rejection, successful confirmation, and Auth failure.

### T-105 · Organizations & Tournaments API

- **Dep**: T-104, T-104f
- **Goal**: Modules `organizations` and `events` with CRUD.
- **Files**: `apps/api/src/modules/organizations/**`, `apps/api/src/modules/tournaments/**`.
- **AC**:
  - `POST /organizations` creates with `status='pending_approval'`.
  - `POST /organizations/:id/approve` requires super_admin.
  - Event create requires the user to be a member of the organization.

### T-106 · Lices, Events, Registrations API

- **Dep**: T-105
- **Goal**: Modules for `lices`, `events`, `registrations` with CRUD + bulk import.
- **Files**: `apps/api/src/modules/lices/**`, `apps/api/src/modules/events/**`, `apps/api/src/modules/registrations/**`.
- **AC**:
  - `POST /events/:id/registrations` supports CSV upload.
  - Bib numbers auto-assign on registration if not provided.
  - Registration status transitions enforced (registered → checked_in → done; cannot skip).

### T-107 · Generated API client

- **Dep**: T-104, T-105, T-106
- **Goal**: TypeScript API client generated from OpenAPI, published as `@myclash/api-client`.
- **Files**: `packages/api-client/**`, `scripts/gen-api-client.ts`.
- **AC**:
  - `pnpm gen:api-client` regenerates from running API.
  - All apps consume the client; no hand-written `fetch` calls remain.

---

## Phase P2 — TF_v1 Ruleset (the hot core)

### T-201 · Ruleset plugin contract

- **Dep**: T-005
- **Goal**: Define the `Ruleset` interface and registry in `@myclash/rulesets`.
- **Files**: `packages/rulesets/src/types.ts`, `packages/rulesets/src/registry.ts`.
- **AC**:
  - Interface matches ARCHITECTURE.md §7.1.
  - Registry exposes `register(ruleset)`, `get(code, version)`, `list()`.

### T-202 · TF_v1 — pure functions

- **Dep**: T-201
- **Goal**: Implement `computeMatchScore`, `isMatchOver`, `computePoolStandings` for TF_v1 as pure functions (no DB, no I/O).
- **Files**: `packages/rulesets/src/tf_v1/index.ts`, `packages/rulesets/src/tf_v1/score.ts`, `packages/rulesets/src/tf_v1/standings.ts`.
- **AC**:
  - Score formula matches ARCHITECTURE.md §6.2 exactly.
  - Tiebreaker order matches §6.3 exactly.
  - 100% unit test coverage of `score.ts` and `standings.ts`.

### T-203 · FAL 2026 fixture import

- **Dep**: T-202
- **Owner**: **needs O-102** — the per-exchange data must be sourced by the project owner. Without raw data, fall back to aggregate-level test (document this in the fixture).
- **Goal**: Convert `https://lyonamhe.fr/resultat_fal2026.html` data into a JSON fixture used as the golden test.
- **Files**: `scripts/import-fal2026.ts`, `packages/rulesets/test/fixtures/fal2026.json`.
- **AC**:
  - Fixture contains all longsword + sidesword pool matches with per-exchange data.
  - If exchange-level data is unavailable, document the synthesis approach (and mark which fields are reconstructed).

### T-204 · TF_v1 golden test

- **Dep**: T-202, T-203
- **Goal**: Test that running TF_v1 on the FAL 2026 fixture reproduces the published pool standings to one decimal.
- **Files**: `packages/rulesets/test/tf_v1.fal2026.test.ts`.
- **AC**:
  - All 54 longsword pool standings match the published Score, Wins, Pts+, Pts−, Dbl values.
  - All 18 sidesword pool standings match.
  - Test fails loudly with diff if ruleset changes break it.

### T-205 · TF_v1_no_afterblow + Generic_PointsCap

- **Dep**: T-202
- **Goal**: Two additional shipped rulesets per ARCHITECTURE.md §7.2.
- **Files**: `packages/rulesets/src/tf_v1_no_afterblow/**`, `packages/rulesets/src/generic_points_cap/**`.
- **AC**:
  - Each registered in the registry.
  - Each has unit tests covering scoring + standings.

### T-206 · Server-side scoring service

- **Dep**: T-202, T-106
- **Goal**: NestJS `matches` and `exchanges` modules using `@myclash/rulesets` for authoritative scoring.
- **Files**: `apps/api/src/modules/matches/**`, `apps/api/src/modules/exchanges/**`.
- **AC**:
  - `POST /matches/:id/exchanges` is idempotent on `client_uuid`.
  - Score on `matches` row is recomputed on every exchange insert/void within the same transaction.
  - Voiding an exchange recomputes score correctly and never deletes the row.
  - 50+ exchanges/sec throughput on a single match.

---

## Phase P3 — Pools & Brackets

### T-301 · Pool generation algorithm

- **Dep**: T-106
- **Goal**: Configurable pool generation per ARCHITECTURE.md §11quater.1. Snake-seeding with school separation + skill balancing soft constraints.
- **Files**: `apps/api/src/modules/phases/pool-generator.ts`, `packages/rulesets/src/scheduling/snake-seeding.ts`, `packages/rulesets/src/scheduling/local-search.ts`.
- **AC**:
  - 32 fighters into 4 pools → balanced (8/8/8/8) with snake seeding by skill.
  - Skill source: HEMA Ratings weapon-specific → overall → seed → registration order (in that fallback order).
  - Same-club avoidance: greedy + local search (50+ swap iterations).
  - Configurable strictness (`enforce_school_separation`, `enforce_skill_balance`).
  - Returns assignments + cost report (same-club pairs per pool, skill variance).
  - Idempotent re-run with same seed produces identical output (deterministic).
  - Test: 24 fighters from 6 clubs into 3 pools achieves 0 same-club pairs.

### T-302 · Round-robin match list per pool

- **Dep**: T-301
- **Goal**: Generate every match in a pool with a deterministic order (Berger tables).
- **Files**: `packages/rulesets/src/scheduling/berger.ts`.
- **AC**:
  - 8-fighter pool → 28 matches in 7 rounds.
  - Match labels follow `L{lice}-P{pool}-M{seq}` format.
  - Test against known Berger schedules.

### T-303 · Single-elimination bracket

- **Dep**: T-301
- **Goal**: Generate a single-elimination bracket from N qualified fighters with bye handling.
- **Files**: `packages/rulesets/src/scheduling/single-elim.ts`.
- **AC**:
  - 16 → 4 rounds, 15 matches.
  - 13 → 3 byes in round 1, brackets balanced.
  - Bracket positions seed correctly (1 vs 16, 8 vs 9, etc.).

### T-304 · Match-to-Lice scheduler

- **Dep**: T-302
- **Goal**: Assign generated matches to Lices respecting per-fighter rest minimums.
- **Files**: `apps/api/src/modules/schedule/match-scheduler.ts`.
- **AC**:
  - No fighter has back-to-back matches without N minutes rest (configurable, default 10).
  - Lices balanced within 5%.
  - Returns match order with `scheduled_at` timestamps.

### T-305 · Phases API

- **Dep**: T-301, T-303
- **Goal**: NestJS `phases` module with endpoints to generate pools and brackets.
- **Files**: `apps/api/src/modules/phases/**`.
- **AC**:
  - `POST /events/:id/generate-pools` creates phase, pools, pool_members, matches.
  - `POST /events/:id/generate-bracket` creates elim phase using top-N from pool standings.
  - Generation is idempotent: second call returns 409 unless `?force=true`.

---

## Phase P4 — Online Scoring

### T-401 · Scoring app shell

- **Dep**: T-003
- **Goal**: Scoring PWA basic shell with login, Lice picker, current match view (no scoring yet).
- **Files**: `apps/web-scoring/app/**`, `apps/web-scoring/public/manifest.json`.
- **AC**:
  - Installable PWA.
  - Login redirects to assigned Lice.
  - Current match info (red/blue, weapon, ruleset) displayed.

### T-402 · Match clock component

- **Dep**: T-401
- **Goal**: Start/halt/resume/end clock with server sync.
- **Files**: `apps/web-scoring/src/components/MatchClock.tsx`, `apps/api/src/modules/matches/clock.service.ts`.
- **AC**:
  - Clock state persisted as `match_events` rows.
  - Reload preserves clock state from server.
  - Drift correction: clock recomputes from `match_events` timeline on every render.

### T-403 · Exchange entry UI (online only)

- **Dep**: T-402, T-206
- **Goal**: Tap-driven UI for entering clean / afterblow / double / no-exchange.
- **Files**: `apps/web-scoring/src/components/ExchangePad.tsx`.
- **AC**:
  - Big buttons; usable with gloves.
  - Clean hit: choose striker (red/blue), value (1pt/2pt) → POST.
  - Afterblow: choose first striker, first value, then afterblow value → POST.
  - Double: single tap → POST.
  - Undo last exchange (within 30s window) by voiding.
  - No-exchange with reason picker.

### T-404 · Realtime broadcast (server)

- **Dep**: T-206
- **Goal**: Postgres triggers + Supabase Realtime channels per ARCHITECTURE.md §9.
- **Files**: `packages/db/migrations/0003_realtime.sql`, `apps/api/src/modules/realtime/**`.
- **AC**:
  - Subscribing to `match:{id}:exchanges` receives row changes within 1s.
  - RLS prevents subscribers from seeing draft events.

### T-405 · Public live match view

- **Dep**: T-404, T-003
- **Goal**: `/e/[eventSlug]/match/[matchId]` shows live exchange feed + score.
- **Files**: `apps/web-public/app/e/[eventSlug]/match/[matchId]/**`.
- **AC**:
  - New exchange appears within 1s of entry.
  - Disconnect/reconnect resumes from current state.

---

## Phase P5 — Offline Scoring

### T-501 · IndexedDB outbox

- **Dep**: T-403
- **Goal**: Dexie-backed local store of pending exchanges with monotonic sequence per match.
- **Files**: `apps/web-scoring/src/offline/db.ts`, `apps/web-scoring/src/offline/outbox.ts`.
- **AC**:
  - Exchange creation writes to IndexedDB before any network call.
  - Outbox survives page reload.
  - 1000 exchanges insert in <500ms locally.

### T-502 · Service worker + offline shell cache

- **Dep**: T-401
- **Goal**: PWA service worker that pre-caches the scoring app shell + ruleset bundle.
- **Files**: `apps/web-scoring/src/sw.ts`, `apps/web-scoring/next.config.ts` (workbox).
- **AC**:
  - Cold start works fully offline after one online session.
  - Lighthouse PWA score ≥ 90.

### T-503 · Sync engine

- **Dep**: T-501, T-206
- **Goal**: Background sync that drains the outbox to the server.
- **Files**: `apps/web-scoring/src/offline/sync.ts`.
- **AC**:
  - Reconnect → pending exchanges drain in order.
  - Server idempotency on `client_uuid` confirmed.
  - UI shows pending count, syncing indicator, error state.

### T-504 · Reconciliation on reconnect

- **Dep**: T-503
- **Goal**: When server has exchanges the client doesn't (admin edit, other device), client merges.
- **Files**: `apps/web-scoring/src/offline/reconcile.ts`.
- **AC**:
  - Local pending preserved; server state replayed; final state = union.
  - E2E test: enter 20 offline, admin voids one online, reconnect → both states reconciled.

### T-505 · Online/offline UI states

- **Dep**: T-503
- **Goal**: Prominent network/sync indicator visible on every scoring screen.
- **Files**: `apps/web-scoring/src/components/SyncStatus.tsx`.
- **AC**:
  - Four explicit states: online · syncing · offline · sync_error.
  - Sync error shows actionable message (retry, contact admin).

---

## Phase P6 — Public PWA & Theming

### T-601 · Design tokens package

- **Dep**: T-005
- **Goal**: Cinzel + Inter typography, color palette, spacing tokens, shield SVG components — extracted from the prototype HTML.
- **Files**: `packages/design-tokens/**`, `packages/ui/**`.
- **AC**:
  - Tokens exposed as CSS variables and Tailwind theme.
  - 10+ shared components (Button, Card, Pill, ShieldBg, etc.) match the prototype's look.
  - Storybook (or similar) demos all components.

### T-602 · Per-event theming engine

- **Dep**: T-601, T-105
- **Goal**: Themes table read at SSR for every `/e/[eventSlug]/...` request; CSS variables injected.
- **Files**: `apps/web-public/app/e/[eventSlug]/layout.tsx`, `apps/web-public/src/theme/**`.
- **AC**:
  - Custom primary/secondary/accent colors render.
  - Custom logo + hero image render.
  - Tournaments without theme fall back to defaults.

### T-603 · Participant onboarding (name lookup → guest session)

- **Dep**: T-602, T-104b, T-104c
- **Goal**: Onboarding flow at `/e/[eventSlug]/onboarding` — type your name, pick yourself from the list, optional persona selection, optionally request a magic link to claim.
- **Files**: `apps/web-public/app/e/[eventSlug]/onboarding/**`, `apps/web-public/src/components/PersonLookup.tsx`.
- **AC**:
  - Single text input with debounced (250ms) calls to `/persons/lookup`.
  - Match list shows: name, club name (visible), masked email.
  - Selecting a match POSTs to `/guest-sessions`, sets cookie, redirects to persona selection.
  - "I'm not in the list" CTA shows the exact copy from §12.4.
  - Persona selection (multi-select) stored on the guest session: Competitor, Referee, Workshop Attendee, Accompanist, Public.
  - Personas are derived hints, not roles — actual capabilities still come from registrations / qualifications / enrollments.
  - "Send me a login link" button on the success screen calls `/persons/:id/request-claim`.
  - Re-running onboarding (already-known guest) skips name entry and goes straight to persona selection.
  - Mobile-first; works one-handed on a phone with poor wifi (request retries 3× with backoff).

### T-604 · Persona-aware home

- **Dep**: T-603
- **Goal**: `/e/[eventSlug]/home` renders the appropriate home content per persona, matching the prototype's three home variants.
- **Files**: `apps/web-public/app/e/[eventSlug]/home/**`.
- **AC**:
  - Competitor home: my next match, today's parcours, my last results.
  - Accompanist home: favorites live, big matches.
  - Public home: editorial, event intro, schedule highlights.

### T-605 · Event detail + brackets + standings

- **Dep**: T-604, T-305
- **Goal**: Event page with pool tabs, bracket view, standings table.
- **Files**: `apps/web-public/app/e/[eventSlug]/t/[tournamentSlug]/**`.
- **AC**:
  - Pool standings update live.
  - Bracket renders correctly for 8/16/32 fighter brackets.
  - Standings table matches the lyonamhe.fr layout (V/Pts+/Pts−/Dbl/Score).

### T-606 · Lice live view

- **Dep**: T-405, T-602
- **Goal**: `/e/[eventSlug]/lice/[liceName]` shows currently playing match + queue.
- **Files**: `apps/web-public/app/e/[eventSlug]/lice/[liceName]/**`.
- **AC**:
  - Auto-updates when current match changes.
  - Mobile-optimized vertical layout.

### T-607 · Fighter & club pages

- **Dep**: T-104, T-602
- **Goal**: Profile pages for fighters and clubs (global and per-event context).
- **Files**: `apps/web-public/app/fighters/[slug]/**`, `apps/web-public/app/e/[eventSlug]/fighters/[fighterSlug]/**`, `apps/web-public/app/clubs/[slug]/**`.
- **AC**:
  - Fighter page: bio, club, photo, current matches, history, HEMA Ratings (when synced).
  - Club page: members, recent results.

### T-608 · Schedule-for-any-person endpoint

- **Dep**: T-104, T-104c
- **Goal**: Backend endpoint that returns any Person's schedule, applying privacy filters per ARCHITECTURE.md §11quinquies.
- **Files**: `apps/api/src/modules/persons/public-schedule.controller.ts`, `apps/api/src/modules/persons/privacy.service.ts`.
- **AC**:
  - `GET /events/:id/people/:personId/schedule` returns `{ matches, referee_slots, workshops? }`.
  - `matches` and `referee_slots` are always included.
  - `workshops` are included by default; excluded only if `person_privacy.hide_workshops_publicly = true` AND the requester is not that same person (claimed user matching `personId`, or guest session bound to `personId`).
  - Email is never returned in this endpoint (use the masked field on `/people` endpoints if needed for display).
  - Same query is reused under the hood for `/my-schedule` (T-805) — both call into a shared `personScheduleService`.
  - 100ms p95 with materialized indexes.

### T-609 · Person privacy preferences

- **Dep**: T-104, T-009
- **Goal**: Endpoints + UI for a claimed user to manage their own privacy preferences.
- **Files**: `apps/api/src/modules/persons/privacy.controller.ts`, `apps/web-public/app/e/[eventSlug]/profile/privacy/**`.
- **AC**:
  - `GET /persons/me/privacy` returns the row (auto-creates with defaults if missing).
  - `PATCH /persons/me/privacy` accepts `{ hide_workshops_publicly, allow_being_followed, show_real_email_to_followers }`.
  - UI explains what each toggle does in plain language; states clearly that match schedule and referee assignments are always public.
  - Only the Person themselves (claimed account where `claimed_by_user_id = auth.uid()`) can edit; super_admin can read but not write through this endpoint.

### T-610 · Follows module (server)

- **Dep**: T-104c, T-009
- **Goal**: NestJS `follows` module — list, create, delete, patch follow rows for the requesting session (guest or claimed).
- **Files**: `apps/api/src/modules/follows/**`.
- **AC**:
  - All endpoints from §14 work.
  - `POST` is idempotent: re-following an already-followed Person returns the existing row, no duplicate.
  - Respects `person_privacy.allow_being_followed` — POST returns 403 if the target opted out.
  - On guest-to-claimed migration (T-009 claim handler hook), all of the guest's follow rows transfer atomically to the new `user_id`. **Test this explicitly with a fixture.**
  - Returns the followed Person's current "next event" inline so the UI doesn't need a second roundtrip per row.

### T-611 · People search + public profile UI

- **Dep**: T-602, T-608, T-610
- **Goal**: `/e/[eventSlug]/people` search list and `/e/[eventSlug]/people/[personId]` profile page.
- **Files**: `apps/web-public/app/e/[eventSlug]/people/**`.
- **AC**:
  - Search: fuzzy name lookup with role/club filters, debounced 250ms.
  - Result rows show name, club, role badges (Competitor / Referee / Workshop lead), next event time.
  - Profile page sections: header (name, club, photo, role badges), today's items (next match, current match if live), full schedule, results.
  - Follow button: prominent, with state from `follow_state` field.
    - Anonymous: writes to localStorage, shows toast about upgrading to guest for sync.
    - Guest/claimed: server call, optimistic UI.
  - "..." menu on Follow button (claimed only): per-follow notification toggles.
  - Hidden Follow button when `allow_being_followed = false`; shows a small "This person prefers not to be followed" notice instead.

### T-612 · Watchlist view

- **Dep**: T-610, T-611
- **Goal**: `/e/[eventSlug]/following` — list of followed Persons with live state, sorted by upcoming time.
- **Files**: `apps/web-public/app/e/[eventSlug]/following/**`.
- **AC**:
  - Subscribed to `event:{id}` realtime channel — live state updates push without refresh.
  - Each row shows: avatar, name, club, current state badge (`Live now (Lice 2)` / `Next: Pool A · 11:15` / `Done`).
  - "Just won 7-3" sticky for 5 minutes after match end.
  - Empty state: "Find people to follow on the People page."
  - Migration cue (guest only): banner suggesting login link for push notifications.

### T-613 · Follow notifications scheduler

- **Dep**: T-610, T-1201
- **Goal**: When a followed Person's match is scheduled to start within their `notify_match_start` lead time, push a notification to the follower.
- **Files**: `apps/api/src/workers/follow-notification-scheduler.worker.ts`.
- **AC**:
  - On match `scheduled_at` set/changed: enqueue a delayed BullMQ job for each follower with `notify_match_start = true` (claimed users only — guests don't have cross-device push).
  - Job key idempotent on `(follower_user_id, match_id, kind)` — rescheduling doesn't duplicate.
  - Notification copy: "🔔 {name} fights in {N} min — {pool/round} vs {opponent} on {lice}".
  - Cancelling a follow cancels the pending job.
  - Same shape applied to referee_start and workshop_start when those toggles are on.

---

## Phase P7 — Admin App

### T-701 · Org dashboard + event wizard

- **Dep**: T-105
- **Goal**: `/org/[orgSlug]` dashboard, "New Event" 4-step wizard.
- **Files**: `apps/web-admin/app/org/[orgSlug]/**`, `apps/web-admin/app/org/[orgSlug]/events/new/**`.
- **AC**:
  - Wizard creates event, default lices, draft theme.
  - Validation on each step.
  - Cancel returns to dashboard with no orphans.

### T-702 · Theme editor

- **Dep**: T-602
- **Goal**: Live preview theme editor (colors, logo upload, fonts).
- **Files**: `apps/web-admin/app/.../theme/**`.
- **AC**:
  - Color pickers; live preview shows theme applied.
  - Logo upload to Supabase Storage.
  - Save persists theme; preview matches public site exactly.

### T-703 · Persons + registration management

- **Dep**: T-104, T-104e
- **Goal**: Admin pages for managing the event Persons roster and per-event registrations.
- **Files**: `apps/web-admin/app/.../persons/**`, `apps/web-admin/app/.../events/[eventId]/registrations/**`.
- **AC**:
  - Persons list with search, filter (role, club, claim_status), bulk actions.
  - Manual person creation form (given_name, family_name, email, club, hema_ratings_id, event_codes, roles).
  - CSV import wizard with column mapping, validation report (created/updated/duplicates/invalid), commit step.
  - Edit person modal: change name, email (warns of impact on claim status), club, ratings link.
  - "Suggest existing fighter" matches against the global Fighter index by name + club similarity.
  - Per-event registrations: add (pick from roster), remove, set seed, set bib number.
  - Bulk check-in workflow.

### T-704 · Pool & bracket management

- **Dep**: T-305, T-701
- **Goal**: Generate pools and bracket from UI; preview before commit.
- **Files**: `apps/web-admin/app/.../events/[eventId]/pools/**`, `apps/web-admin/app/.../events/[eventId]/bracket/**`.
- **AC**:
  - Pool count + size configurable.
  - Manual override of pool assignments (drag-drop).
  - "Force regenerate" with confirmation modal.

### T-705 · Manual exchange edit (audit-logged)

- **Dep**: T-206
- **Goal**: Admin can void/edit exchanges from a match detail page; every action audit-logged.
- **Files**: `apps/web-admin/app/.../matches/[matchId]/**`.
- **AC**:
  - Void requires reason.
  - Audit log shows who, when, what, why.
  - Reverting a void restores the exchange.

### T-706 · Schedule day-grid (matches only first)

- **Dep**: T-304
- **Goal**: Drag-drop day grid with rows = Lices, cells = matches.
- **Files**: `apps/web-admin/app/.../schedule/**`.
- **AC**:
  - Drag a match to a different Lice or time.
  - Conflict warnings (same fighter in two simultaneous matches) shown immediately.
  - Save persists.

---

## Phase P8 — Workshops Module

### T-801 · Workshops API

- **Dep**: T-101
- **Goal**: NestJS `workshops` module with CRUD for workshops, instructors, sessions.
- **Files**: `apps/api/src/modules/workshops/**`.
- **AC**:
  - All endpoints from ARCHITECTURE.md §14 work.
  - Capacity validated (cannot exceed `workshops.capacity`).

### T-802 · Workshop enrollment + waitlist

- **Dep**: T-801
- **Goal**: Enroll/cancel endpoints; waitlist auto-promotion.
- **Files**: `apps/api/src/modules/workshops/enrollment.service.ts`, `apps/api/src/workers/waitlist-promote.worker.ts`.
- **AC**:
  - Enrolling at capacity → status `waitlisted` with `position`.
  - Confirmed cancellation triggers promotion job; waitlist top moves to confirmed.
  - Race-condition test: 100 concurrent enrolls into capacity=10 leaves exactly 10 confirmed.

### T-803 · Workshop public catalog

- **Dep**: T-602, T-801
- **Goal**: `/e/[eventSlug]/workshops` list + `/e/[eventSlug]/w/[workshopSlug]` detail.
- **Files**: `apps/web-public/app/e/[eventSlug]/workshops/**`.
- **AC**:
  - Filters: day, category, level, language, instructor.
  - Detail page shows sessions, capacity status, "Add to my schedule" button.
  - Anonymous can browse; enroll requires login.

### T-804 · Workshop admin

- **Dep**: T-801, T-701
- **Goal**: Admin UI to create/edit workshops, instructors, sessions; roster view; CSV roster export.
- **Files**: `apps/web-admin/app/.../workshops/**`.
- **AC**:
  - Drag-drop session scheduler integrated with the existing match schedule grid.
  - Roster shows confirmed and waitlisted, with promote/demote/remove actions.
  - Cancel session triggers notification to all enrollees (via T-1201 once available; stub until then).

### T-805 · "My Schedule" — unified view

- **Dep**: T-802, T-403, T-901 _(referee qualifications and assignments)_
- **Goal**: `/e/[eventSlug]/my-schedule` — combined matches + refereeing + workshops with conflict markers.
- **Files**: `apps/api/src/modules/schedule/my-schedule.controller.ts`, `apps/web-public/app/e/[eventSlug]/my-schedule/**`.
- **AC**:
  - Day filter (Sat/Sun).
  - Conflicts visually flagged (red border, "Conflicts with L1-P3-M5").
  - Referee role (Arbitre déclarant / Assesseur / Table) shown on referee items.
  - "Focus on me" vs "Show all" toggle (matches beta companion app behavior).
  - Conflict detection uses ±15min buffer on match times.

---

## Phase P9 — Referees & Assignment Engines

### T-901 · Referee qualifications API

- **Dep**: T-101, T-105
- **Goal**: NestJS module `referees` with CRUD on `referee_qualifications` (per-event role + rating).
- **Files**: `apps/api/src/modules/referees/qualifications.controller.ts`, `apps/api/src/modules/referees/qualifications.service.ts`.
- **AC**:
  - Create/update/delete qualifications.
  - A user can have 0..3 active qualifications per event (one per role: `arbitre_declarant`, `arbitre_assesseur`, `arbitre_table`).
  - Rating is 1..5 or null.
  - Soft delete via `active=false` preserves history.

### T-902 · Pool assignment settings API

- **Dep**: T-101, T-105
- **Goal**: CRUD for `pool_assignment_settings` (per-event with optional per-event overrides).
- **Files**: `apps/api/src/modules/referees/settings.controller.ts`.
- **AC**:
  - Default settings created on event creation.
  - Per-tournament override resolves correctly (tournament setting wins, else event default).
  - Validation: `enforce_fighter_referee_no_overlap` cannot be set to false.

### T-903 · Referee auto-assignment engine

- **Dep**: T-901, T-902, T-304
- **Goal**: Pure-function constraint engine implementing the algorithm in ARCHITECTURE.md §11quater.2.
- **Files**: `packages/rulesets/src/scheduling/referee-assigner.ts`, `packages/rulesets/src/scheduling/referee-assigner.test.ts`.
- **AC**:
  - Hard constraint: fighter never assigned to referee a pool whose time overlaps their match.
  - Hard constraint: only candidates with active qualification for the role considered.
  - Soft constraints: back-to-back avoidance, dedicated-referee rest, workshop-conflict warning, workload balance, rating-based ordering — all configurable.
  - Returns `{ assignments, missing, warnings }` matching the schema in §11quater.2.
  - Test scenarios:
    - 4 pools, 12 qualified referees (4 of each role), no overlaps → all assigned, no warnings.
    - 4 pools, 6 referees (2 per role) → all assigned, but back-to-back warnings present.
    - 4 pools, only 1 qualified `arbitre_assesseur` → 3 missing cells reported with `rejection_reasons.no_qualified_users`.
    - Fighter Alice qualified as `arbitre_table`, also fighting Pool A → never assigned to Pool A's table role.

### T-904 · Pool populator API

- **Dep**: T-301, T-902
- **Goal**: Endpoint that runs the enhanced pool generator with current settings, returns proposed assignment + cost report (dry-run mode supported).
- **Files**: `apps/api/src/modules/phases/pool-populator.controller.ts`.
- **AC**:
  - `POST /events/:id/populate-pools` with `dryRun=true` returns proposed assignment without persisting.
  - With `dryRun=false`, persists and returns the same shape.
  - Cost report includes per-pool same-club count, skill variance, and which constraints were violated.

### T-905 · Auto-assign referees endpoint

- **Dep**: T-903
- **Goal**: NestJS endpoint wiring the engine to live data + persistence.
- **Files**: `apps/api/src/modules/referees/auto-assign.controller.ts`.
- **AC**:
  - `POST /events/:id/auto-assign-referees?dryRun=true` returns proposal.
  - `POST /events/:id/auto-assign-referees?dryRun=false` persists `referee_assignments` rows with `auto_assigned=true`, `status='assigned'` (but unconfirmed), `conflicts_jsonb` populated.
  - `POST /events/:id/lock-referee-assignments` transitions to confirmed state and triggers notifications (when P12 lands; stub until then).

### T-906 · Referee admin UI — qualifications & ratings

- **Dep**: T-901
- **Goal**: Admin page `/org/[orgSlug]/tournaments/[id]/referees` to manage referee pool.
- **Files**: `apps/web-admin/app/.../referees/**`.
- **AC**:
  - Add/remove referees (search users by email/name).
  - Per user: toggle qualification per role, set rating per role (1–5 stars), notes.
  - CSV import (user email + role + rating).
  - Bulk operations.

### T-907 · Pool populator UI

- **Dep**: T-904
- **Goal**: Admin page `/events/[eventId]/pool-populator` — constraint toggles + auto-populate + drag-drop manual override.
- **Files**: `apps/web-admin/app/.../events/[eventId]/pool-populator/**`.
- **AC**:
  - Sliders/toggles for: pool count, school separation strictness, skill balance on/off, skill source.
  - "Generate" button → proposal shown with per-pool fighter list and cost markers.
  - Drag a fighter between pools → cost recomputes live (Web Worker for instant feedback).
  - "Accept & Save" persists; "Regenerate with new settings" reruns.
  - Visual conflict markers (same-club pairs highlighted in same pool).

### T-908 · Referee assignment UI

- **Dep**: T-905, T-907
- **Goal**: Admin page `/referees/assignments` — visual schedule grid with auto-assign + manual override + missing-role report.
- **Files**: `apps/web-admin/app/.../referees/assignments/**`.
- **AC**:
  - Grid: rows = pools, columns = the three roles. Cell shows assigned referee.
  - "Auto-assign" button runs T-905 dry-run, shows preview.
  - Cells colored: green (assigned, no warnings), amber (assigned with warnings, hover for reason), red (unassigned, hover for rejection reasons).
  - Drag-drop assignment from a sidebar of qualified candidates; system warns immediately if dropping creates conflict.
  - "Lock" button calls `POST /lock-referee-assignments`.
  - Filter sidebar candidates by role + rating + availability.

### T-909 · Referee dashboard (public app)

- **Dep**: T-901, T-805
- **Goal**: `/e/[eventSlug]/referee` — when user has referee role, show their assigned pools/matches/roles.
- **Files**: `apps/web-public/app/e/[eventSlug]/referee/**`.
- **AC**:
  - Shows assigned pools (with role) and matches.
  - Confirm/decline buttons per assignment.
  - Visible on "My Schedule" with role label.

### T-910 · On-piste referee tools (lite v1)

- **Dep**: T-402
- **Goal**: `/e/[eventSlug]/referee/match/[matchId]` — referee can call halt/resume, issue warnings, request scorekeeper attention.
- **Files**: `apps/web-public/app/e/[eventSlug]/referee/match/[matchId]/**`.
- **AC**:
  - Halt/resume creates `match_events` rows.
  - Warning recorded with target fighter and reason.
  - "Attention" creates a notification visible on the scoring tablet.
  - Different role contexts surface different actions (e.g. only `arbitre_declarant` can issue official warnings; `arbitre_table` sees scoring oversight tools).

---

## Phase P10 — Statistics

### T-1001 · Materialized views for fighter exchange stats

- **Dep**: T-206
- **Goal**: Postgres materialized views per ARCHITECTURE.md §5.3.
- **Files**: `packages/db/migrations/0010_stats_views.sql`, `apps/api/src/modules/stats/**`.
- **AC**:
  - `mv_fighter_exchange_stats` produces all columns from the lyonamhe.fr stats table (Dbl, ✓1, ✓1-1, ✓2, ✓2-1, ✗1, ✗1-1, ✗2, ✗2-1, Total, Ratio).
  - Refreshed by trigger after exchange insert/update/void; debounced via Redis lock (1s).

### T-1002 · Tournament stats overview API

- **Dep**: T-1001
- **Goal**: Endpoints for the hero numbers + per-event aggregates.
- **Files**: `apps/api/src/modules/stats/**`.
- **AC**:
  - `/api/v1/tournaments/:id/stats/overview` returns participants, matches, doubles%, events, clubs.
  - All endpoints from §14 stats section work.

### T-1003 · Stats page UI (public)

- **Dep**: T-1002, T-602
- **Goal**: Reproduce `https://lyonamhe.fr/resultat_fal2026.html` layout.
- **Files**: `apps/web-public/app/e/[eventSlug]/t/[tournamentSlug]/stats/**`.
- **AC**:
  - All charts present: distribution of exchanges, target zones, double-rate evolution, top 5 deep target hunters.
  - Per-fighter detailed table renders correctly.
  - Visual diff against the reference page within reasonable margins.

### T-1004 · Exports — CSV / JSON / HEMA Ratings format

- **Dep**: T-1001
- **Goal**: Export endpoints and Worker job to generate large exports.
- **Files**: `apps/api/src/modules/exports/**`.
- **AC**:
  - CSV of all matches + exchanges per event downloadable.
  - JSON export complete (round-trippable).
  - HEMA Ratings format documented in `docs/HEMA_RATINGS_EXPORT.md`.

### T-1005 · PDF export

- **Dep**: T-1003
- **Goal**: Puppeteer-based PDF of the public stats page.
- **Files**: `apps/api/src/modules/exports/pdf.worker.ts`.
- **AC**:
  - PDF reproduces the stats page faithfully.
  - Generated in <30s for a 100-fighter event.

---

## Phase P11 — HEMA Ratings Sync

### T-1101 · Daily sync job

- **Dep**: T-104
- **Goal**: BullMQ daily cron pulls HEMA Ratings dataset into `hema_ratings_snapshots`.
- **Files**: `apps/api/src/workers/hema-ratings-sync.worker.ts`.
- **AC**:
  - Stores latest snapshot with timestamp.
  - Search index rebuilt after each sync.

### T-1102 · Search & link UI in registration

- **Dep**: T-1101, T-703
- **Goal**: When adding a registration, organizer sees suggested matches from HEMA Ratings.
- **Files**: `apps/web-admin/src/components/HemaRatingsSuggest.tsx`.
- **AC**:
  - Typing a name shows top 5 matches with rating, club, country.
  - Selecting a match populates the registration with `hema_ratings_id`.

### T-1103 · HEMA Ratings on fighter profile

- **Dep**: T-1101, T-607
- **Goal**: Fighter profile shows current rating(s) when linked.
- **Files**: `apps/web-public/app/fighters/[slug]/**`.
- **AC**:
  - Rating(s) shown with weapon and value.
  - "Last synced" timestamp visible.

---

## Phase P12 — Push Notifications

### T-1201 · VAPID + subscription endpoints

- **Dep**: T-009
- **Owner**: **needs O-007** (VAPID keys generated and stored).
- **Goal**: Setup VAPID keys, subscribe/unsubscribe endpoints, opt-in flow.
- **Files**: `apps/api/src/modules/notifications/**`.
- **AC**:
  - VAPID keys in env.
  - `POST /notifications/subscribe` stores subscription.
  - User can disable from `/notifications` page.

### T-1202 · Scheduled notification triggers

- **Dep**: T-1201, T-805
- **Goal**: BullMQ delayed jobs for "match starting soon", "workshop starting soon", "referee slot soon".
- **Files**: `apps/api/src/workers/notification-scheduler.worker.ts`.
- **AC**:
  - When a match's `scheduled_at` changes, the scheduled push job is rescheduled.
  - Lead times configurable per user.
  - Duplicate notification suppression (idempotency by job key).

### T-1203 · Event-driven notifications

- **Dep**: T-1201
- **Goal**: Immediate notifications for: assignment changes, workshop cancellation, waitlist promotion, results published.
- **Files**: `apps/api/src/modules/notifications/event-handlers/**`.
- **AC**:
  - Each event type tested: receives push within 5s of trigger.
  - Email fallback when push disabled.

### T-1204 · Organizer event broadcast notifications

- **Dep**: T-1201, T-703, T-901
- **Goal**: Event organizers can send immediate Info/Warning/Alert messages to everyone at an event, fighters only, referees only, or selected Persons.
- **Files**: `apps/api/src/modules/notifications/**`, `apps/web-admin/app/.../events/[eventId]/notifications/**`, `apps/web-public/app/notifications/**`.
- **AC**:
  - Admin+ organizer can send a broadcast scoped to one event; non-organizers cannot.
  - Recipient resolution works for all, fighters, referees, and specific Persons; duplicate claimed users are sent once.
  - Broadcast history and per-recipient delivery state are persisted.
  - Claimed users receive Web Push first; push-disabled/no-subscription users and unclaimed roster rows receive email fallback.
  - Public notifications page shows received event broadcasts with severity color.

### T-1205 - Pool and bracket visibility publishing

- **Dep**: T-1204, T-704, T-605
- **Goal**: Generated pool and bracket phases are hidden from public/participant views until an organizer publishes them; organizers can unpublish with confirmation once matches have started.
- **Files**: `apps/api/src/modules/phases/**`, `apps/api/src/modules/notifications/**`, `apps/web-admin/app/.../events/[eventId]/{pools,bracket,notifications}/**`, `packages/db/migrations/**`.
- **AC**:
  - New generated pool/bracket phases default to `hidden`; existing phases are backfilled as `published`.
  - Public tournament, schedule, competitor, and referee views only expose published pool/bracket phases; organizer/admin views can still manage hidden phases.
  - Admin+ organizer can publish/unpublish a phase; unpublishing with running/paused/completed matches returns confirmation counts unless explicitly confirmed.
  - Publishing exposes a prefilled event broadcast draft for fighters and referees, scoped to the tournament, editable before send.
  - Visibility changes are audited.

---

## Phase P13 — Super Admin

### T-1301 · Super admin dashboard

- **Dep**: T-009
- **Goal**: `/admin` with org approvals, user management, ruleset moderation, feature flags.
- **Files**: `apps/web-admin/app/admin/**`.
- **AC**:
  - Org approve/suspend.
  - Disable a user.
  - Approve a community-submitted ruleset.

### T-1302 · Fighter merge tool

- **Dep**: T-104
- **Goal**: Merge two fighter profiles (handles duplicates from registration).
- **Files**: `apps/web-admin/app/admin/fighters/**`, `apps/api/src/modules/fighters/merge.service.ts`.
- **AC**:
  - All registrations, photos, ratings link to the kept profile.
  - Old profile rows soft-deleted with redirect.
  - Merge is reversible within 30 days (via audit log).

### T-1303 · Audit log UI

- **Dep**: T-101
- **Goal**: Filterable audit log viewer.
- **Files**: `apps/web-admin/app/admin/audit-log/**`.
- **AC**:
  - Filters: actor, action, entity type, date range.
  - Pagination.
  - Export to CSV.

### T-1304 · Frozen results state

- **Dep**: T-705
- **Goal**: Once results published, post-publish edits to exchanges require super_admin approval.
- **Files**: `apps/api/src/modules/matches/frozen-results.guard.ts`.
- **AC**:
  - Published event: organizer edit requests go to a "pending review" queue.
  - Super admin approves/rejects.
  - Rejection notifies the requester with reason.

---

## Phase P14 — i18n & Polish

### T-1401 · Extract all strings

- **Dep**: all UI tasks
- **Goal**: Every user-facing string goes through i18n. CI fails on hardcoded English in JSX.
- **Files**: `apps/*/messages/en.json`, `eslint` rule `no-literal-string`.
- **AC**:
  - ESLint rule passing across all apps.
  - 100% of strings extracted.

### T-1402 · French translation

- **Dep**: T-1401
- **Owner**: **needs O-106 + O-107** (French native speaker review and HEMA glossary).
- **Goal**: `messages/fr.json` complete and reviewed.
- **Files**: `apps/*/messages/fr.json`.
- **AC**:
  - No missing keys.
  - Reviewed by a native French speaker (project author).

### T-1403 · Accessibility pass (WCAG AA)

- **Dep**: all UI tasks
- **Goal**: Axe checks clean on critical user flows.
- **Files**: `tests/a11y/**`.
- **AC**:
  - 0 critical Axe violations on: onboarding, my-schedule, scoring screen, event page, admin event wizard.
  - Keyboard navigation works on all interactive components.

### T-1404 · Performance pass

- **Dep**: all
- **Goal**: Lighthouse scores ≥ 90 on web-public landing and event pages.
- **Files**: various.
- **AC**:
  - Public landing LCP < 2.5s on 4G.
  - Stats page renders 100-fighter table in < 1s.
  - Bundle size budget: web-public < 200KB JS gzipped on landing.

---

## Phase P15 — Beta Event

### T-1501 · Pre-event dry-run

- **Dep**: all
- **Owner**: **needs O-201–O-206** (privacy policy, monitoring, backups, real-device tests, tablet provisioning, communications).
- **Goal**: Run a fake event end-to-end on staging.
- **AC**:
  - Create org → event → tournaments → registrations → pools → bracket → score 50 matches → publish.
  - All exports generated.
  - No critical bugs.

### T-1502 · Run a real event

- **Dep**: T-1501
- **Owner**: **needs O-104** (beta partner confirmed) and **O-301–O-303** (on-site presence on the day).
- **Goal**: Use MyClash for a real HEMA event (target: a Lyon AMHE event or partner club).
- **AC**:
  - Event completed without falling back to spreadsheets.
  - Post-event retro documented.
  - All bugs found triaged.

### T-1503 · v1.0 release

- **Dep**: T-1502
- **Goal**: Tag v1.0, publish release notes, announce.
- **AC**:
  - Git tag `v1.0.0`.
  - GitHub release with changelog.
  - Documentation site live.

---

## Appendix A — Task Dependency Graph (compact)

```
P0:  T-001 → T-002, T-003, T-004, T-005
     T-003,T-004 → T-006 → T-007 → T-009
     T-005 → T-008

P0.5: T-001 → T-051, T-052
      T-006 → T-053 → T-054
      O-002,O-003 → T-055
      T-052,T-054,T-055 → T-056 → T-057
      T-052,T-054 → T-058
      T-054,T-055 → T-059
      T-056 → T-060
      T-054 → T-061

P1:  T-007 → T-101 → T-102, T-103
     T-101 → T-104 → T-104b → T-104c → T-104d
     T-104 → T-104e
     T-104d,T-009 → T-104f
     T-104e,T-104f → T-105 → T-106 → T-107

P2:  T-005 → T-201 → T-202 → T-203 → T-204
     T-202 → T-205, T-206
     T-106 → T-206

P3:  T-106 → T-301 → T-302
     T-301 → T-303
     T-302 → T-304
     T-301,T-303 → T-305

P4:  T-003 → T-401 → T-402 → T-403
     T-206 → T-403, T-404
     T-404,T-003 → T-405

P5:  T-403 → T-501
     T-401 → T-502
     T-501,T-206 → T-503 → T-504 → T-505

P6:  T-005 → T-601
     T-601,T-105 → T-602 → T-603 → T-604 → T-605
     T-405,T-602 → T-606
     T-104,T-602 → T-607
     T-104,T-104c → T-608
     T-104,T-009 → T-609
     T-104c,T-009 → T-610
     T-602,T-608,T-610 → T-611
     T-610,T-611 → T-612

P7:  T-105 → T-701 → T-702
     T-106 → T-703
     T-305,T-701 → T-704
     T-206 → T-705
     T-304 → T-706

P8:  T-101 → T-801 → T-802
     T-602,T-801 → T-803
     T-801,T-701 → T-804
     T-802,T-403,T-901 → T-805

P9:  T-101,T-105 → T-901, T-902
     T-901,T-902,T-304 → T-903 → T-905
     T-301,T-902 → T-904 → T-907
     T-901 → T-906
     T-905,T-907 → T-908
     T-901,T-805 → T-909
     T-402 → T-910

P10: T-206 → T-1001 → T-1002 → T-1003 → T-1004 → T-1005

P11: T-104 → T-1101 → T-1102, T-1103

P12: T-009 → T-1201 → T-1202, T-1203
     T-610,T-1201 → T-613
     T-1201,T-703,T-901 → T-1204

P13: T-009 → T-1301
     T-104 → T-1302
     T-101 → T-1303
     T-705 → T-1304

P14: (depends on all UI) → T-1401 → T-1402, T-1403, T-1404

P15: (depends on all) → T-1501 → T-1502 → T-1503
```

## Appendix B — Parallelization

The following can be worked on **in parallel** by independent agents/devs once their deps land:

- After P1 lands: P2 (rulesets) and P6.T-601 (design tokens) are independent.
- After P2 lands: P3 (brackets) and P4 (online scoring) are independent.
- After P4 lands: P5 (offline) and P6 (public app event/match views) are independent.
- After P7 lands: P8 (workshops), P9 (referees), and P11 (HEMA Ratings) are largely independent.
- P12 (notifications) only depends on auth (T-009); can be started early but most triggers come from P8/P9.
- P14 i18n extraction can run as an ongoing PR alongside any UI work.

---

_End of MyClash Build Order._
