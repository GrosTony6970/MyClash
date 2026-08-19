# Runtime Health Dashboard + Alerting — Design Spec

> **Status (2026-08-19):** Shipped. The Status line below still reads "pending implementation plan" — the plan was written and executed. Kept for the design reasoning.

**Date:** 2026-07-24
**Status:** Approved (design), pending implementation plan

## Context & Goal

The super-admin surface exposes deploy metadata, component versions, and a live TLS-cert
card, but nothing about **live runtime health**. The operator has no at-a-glance answer to
"is the stack healthy right now?" — Postgres connection headroom, Redis memory pressure,
BullMQ backlog, or host disk usage. During a live event these can degrade fast, and the
first symptom today is a user-facing failure.

Goal: a **Runtime Health card** on the existing `/admin/system-versions` page showing four
live metric groups (Postgres, Redis, Queues, Disk) with at-a-glance health pills, plus a
**threshold-based alerting monitor** that emails the operator when a metric goes critical.
All alert knobs (recipient, cadence, cooldown, thresholds, email level) are **UI-editable**
by the super-admin, persisted, and applied live.

## Non-goals (v1)

- Historical/time-series charts (this is instantaneous state only).
- Push-notification alerts (email is the operator channel, mirroring the TLS monitor).
- Auto-remediation (no restarting/scaling based on metrics).
- Per-tenant / organizer visibility (super-admin only).

## Existing patterns reused (do not reinvent)

- **Live status card:** `AdminTlsStatusService` + `tls-status.controller.ts` (SuperAdminGuard,
  `admin/system/*`) + `TlsCertificatesCard.tsx` rendered on `system-versions/page.tsx`.
- **Daily monitor + email alert:** `TlsCertMonitorWorker` (`@Processor` cron, `onModuleInit`
  repeatable job, `logger.warn` + `MailService.sendNotification` to `LETSENCRYPT_EMAIL`,
  silent when healthy).
- **Persisted settings:** `platform_ai_settings` table + `PlatformAISettingsService`
  (`getConfig`/`updateBudget`, `upsert(..., { onConflict: 'setting_key' })`).
- **RPC via service client:** `supabase.service.rpc(...)` (7 existing call sites).
- **Cross-module worker→admin-service:** WorkersModule already reaches admin services via the
  existing `forwardRef(() => AdminModule)` (how `TlsCertMonitorWorker` injects
  `AdminTlsStatusService`). The new worker reuses this — **no new module cycle**.
- **Privileged host ops:** `ops-runner/server.mjs` (Bearer-secured, host filesystem mounted,
  fixed allowlist) called from `AdminSystemActionsService`.

## Architecture

One **aggregated live endpoint → one card**, with four internally-isolated collectors.
Rejected alternatives: separate endpoint/card per subsystem (four fetches, four cards on an
already-busy page); folding into `/admin/system-versions` (that endpoint is deliberately
_static_/manifest-based — live metrics don't belong there).

### Backend (admin module)

`AdminRuntimeHealthService` (orchestrator) fans out to four collectors via
`Promise.allSettled`, each with its own timeout, returning `{ status, …, error? }` so one
slow/dead source (most likely disk, which crosses the ops-runner hop) degrades to
`unavailable` in its own sub-section without sinking the others.

Collectors (each an isolated, unit-testable unit):

1. **DbHealthCollector** — one `supabase.service.rpc('admin_runtime_db_stats')` call. Returns
   `max_connections`, in-use total + by state (active / idle / idle-in-transaction), headroom,
   DB size bytes, longest active-query age (seconds), cache-hit ratio, uptime seconds.
2. **RedisHealthCollector** — `INFO memory` (`used_memory`, `maxmemory`) + `DBSIZE` +
   `connected_clients` via a self-owned ioredis connection (below).
3. **QueueHealthCollector** — `getJobCounts()` across the known queues (`hema-ratings`,
   `notification-scheduler`, `event-status-ticker`, `event-archive`,
   `data-quality-deterministic`, `tls-cert-monitor`, `runtime-health-monitor`) using
   read-only `Queue` handles on the shared ioredis connection.
4. **DiskHealthCollector** — calls `AdminSystemActionsService.getDiskUsage()`, which does an
   HTTP `GET /disk` to the ops-runner.

**Self-owned ioredis connection:** to avoid DI-coupling the admin module to WorkersModule's
registered queues, the Redis + Queue collectors share **one** ioredis connection built from
`REDIS_URL` / `REDIS_HOST`+`REDIS_PORT`+`REDIS_PASSWORD` (same factory logic as
`workers.module.ts` `BullModule.forRootAsync`). One extra lightweight connection, zero new
cross-module dependency. (ioredis is BullMQ's transitive dep; add as a direct API dependency
if not already resolvable.)

`RuntimeHealthAdminController` (`@UseGuards(SuperAdminGuard)`, `@Controller('admin/system/runtime-health')`):

- `GET /` → aggregated `RuntimeHealthResponseDto`.
- `GET /alert-settings` → current settings.
- `PUT /alert-settings` → validate + upsert, returns updated settings.

### Response DTO shape (illustrative)

```
RuntimeHealthResponseDto {
  checkedAt: string
  database: { status, connections: { inUse, max, headroom, byState: {active,idle,idleInTransaction} },
              sizeBytes, longestQuerySeconds, cacheHitRatio, uptimeSeconds } | { status:'unavailable', error }
  redis:    { status, usedMemoryBytes, maxMemoryBytes, keys, connectedClients } | { status:'unavailable', error }
  queues:   { status, queues: [{ name, active, waiting, delayed, failed, status }] } | { status:'unavailable', error }
  disk:     { status, mountpoint, sizeBytes, usedBytes, availBytes, usePercent } | { status:'unavailable', error }
}
```

`status` per metric ∈ `healthy | warning | critical | unavailable`, derived from the current
persisted thresholds.

### DB migration 1 — RPC `admin_runtime_db_stats()`

`SECURITY DEFINER` function returning `jsonb`. Reads `current_setting('max_connections')`,
`pg_stat_activity` (counts by state; longest active query age excluding itself),
`pg_database_size(current_database())`, `pg_stat_database` (blks_hit/blks_read → cache-hit
ratio), `pg_postmaster_start_time()` → uptime. `REVOKE ALL ... FROM public` then
`GRANT EXECUTE ... TO service_role` only (never anon/authenticated).

### DB migration 2 — `runtime_health_alert_settings` table

Singleton row keyed by `setting_key text primary key default 'default'` (mirrors
`platform_ai_settings`). Columns: `recipient_emails text[]`, `email_level text` check in
(`warning`,`critical`), `check_interval_minutes int`, `cooldown_minutes int`,
`conn_warn_pct/conn_crit_pct`, `redis_warn_pct/redis_crit_pct`, `disk_warn_pct/disk_crit_pct`,
`queue_backlog_warn/queue_backlog_crit`, `enabled bool`, `updated_at timestamptz`,
`updated_by uuid`. **RLS enabled, deny-all** (no policies → only service_role reaches it).
Migration seeds the default row (defaults below).

Migration numbers: the next two sequential prefixes (max+1, max+2); never renumber applied
files.

### Settings service + defaults

`RuntimeHealthAlertSettingsService` (admin module): `getSettings()` (read row, merge code
defaults defensively) / `updateSettings(dto, actorId)` (upsert). Defaults:

| Setting                   | Default                                         |
| ------------------------- | ----------------------------------------------- |
| recipient_emails          | `[LETSENCRYPT_EMAIL]` (seed)                    |
| email_level               | `critical`                                      |
| check_interval_minutes    | 15                                              |
| cooldown_minutes          | 360 (6 h)                                       |
| conn_warn / conn_crit     | 70 / 90 (% of max_connections)                  |
| redis_warn / redis_crit   | 75 / 90 (% of maxmemory)                        |
| disk_warn / disk_crit     | 80 / 90 (% used)                                |
| queue_backlog_warn / crit | 500 / 2000 (waiting jobs, summed across queues) |
| enabled                   | true                                            |

PUT DTO validated with Zod (project pattern): cron/interval bounds, email format,
threshold ranges (warn < crit, 1–100 for percentages), cooldown ≥ 0.

### Alerting monitor

`RuntimeHealthMonitorWorker` (`workers/runtime-health-monitor.worker.ts`), sibling of
`TlsCertMonitorWorker`. Injects `AdminRuntimeHealthService` + `RuntimeHealthAlertSettingsService`
via the existing `forwardRef(() => AdminModule)`. New queue `runtime-health-monitor`
registered in WorkersModule.

- **Fixed 5-min BullMQ tick** (repeatable, `onModuleInit`). Decouples scheduling from the
  user-configurable cadence — no job re-registration when settings change.
- Each tick: read settings fresh; if disabled or `now - lastCheckAt < check_interval_minutes`,
  skip. Otherwise collect metrics and derive per-metric status. The `check_interval_minutes`
  throttle applies **only while quiet** (no metric currently warning/critical/unavailable);
  while a metric is actively alerting, the monitor re-checks on every fixed 5-min tick instead,
  deliberately overriding the configured interval so recovery/re-arm is detected promptly
  (the extra collector load during an incident is an accepted cost).
- **Alert matrix:** healthy → card only; warning → `logger.warn`; critical →
  `logger.warn` + email to `recipient_emails` via `MailService.sendNotification` (subject/body
  list the critical metrics + values + link to `admin.${DOMAIN}/admin/system-versions`). If
  `email_level = warning`, warnings email too.
- **De-dup:** last-critical-set + last-emailed-at in **Redis**. Email only when a _new_ metric
  goes critical or `cooldown_minutes` has elapsed; re-arm (clear state) when all healthy — so a
  persistent condition doesn't email every interval.

### ops-runner — read-only `GET /disk`

New route in `ops-runner/server.mjs`: runs `df -P -B1 <ROOT_DIR>` (host root the volumes live
on), parses to `{ filesystem, mountpoint, sizeBytes, usedBytes, availBytes, usePercent }`.
Read-only, no lock, no state change; reuses the existing Bearer auth. `AdminSystemActionsService`
gains `getDiskUsage()` calling it (same HTTP-to-ops-runner pattern as `renewCertificates`).

### Frontend

`RuntimeHealthCard.tsx` in `apps/web-admin/app/admin/system-versions/`, rendered under
`<TlsCertificatesCard />` in `page.tsx`. Client component: fetch `runtime-health` on load +
manual **Refresh** button (no auto-poll, matching the TLS card); four metric sub-sections with
health pills using existing `success`/`warning`/`danger` tokens; `unavailable` sub-sections
render a muted "unavailable" state without breaking siblings. An **Alert settings** panel
(collapsible) fetches `alert-settings`, edits the knobs, `PUT`s on save (toast on success).
Tokenized inputs mirroring existing admin forms; i18n keys under
`admin.systemVersions.runtimeHealth.*` and `.settings.*` in **EN + FR**.

## Testing

- Each collector: mocked source (rpc rows / ioredis `info`+`dbsize` / `getJobCounts` /
  ops-runner fetch) → field mapping + threshold classification; `unavailable` path.
- Orchestrator: one collector throws → others still returned, failed one `unavailable`.
- Monitor worker (mirror `tls-cert-monitor.worker.test.ts`): critical→email, warning→no email
  (level=critical), all-healthy→silent + state cleared, de-dup within cooldown, re-arm after
  recovery, disabled→skip, interval-not-elapsed→skip.
- ops-runner `df` parsing (unit test on the parse helper).
- Settings service: defaults merge, upsert; PUT DTO validation (warn<crit, email format, bounds).
- Guard/RLS: controller behind SuperAdminGuard; `runtime_health_alert_settings` unreachable as
  anon (RLS deny-all); RPC not granted to anon.

## Verification gates (per commit)

`pnpm --filter @myclash/api build` · vitest · lint + typecheck · i18n key references (EN+FR) ·
complexity comm-diff · `db:review` + replay (both migrations, PG17) · rebuild `@myclash/ui`
before app typecheck if touched.

## File map

**New**

- `apps/api/src/modules/admin/runtime-health.service.ts` (+ collectors, likely
  `runtime-health/` subdir: `db-collector.ts`, `redis-collector.ts`, `queue-collector.ts`,
  `disk-collector.ts`)
- `apps/api/src/modules/admin/runtime-health.controller.ts`
- `apps/api/src/modules/admin/runtime-health-alert-settings.service.ts`
- `apps/api/src/modules/admin/dto/runtime-health.dto.ts` (+ alert-settings DTO/Zod)
- `apps/api/src/workers/runtime-health-monitor.worker.ts`
- `packages/db/migrations/NNNN_admin_runtime_db_stats.sql`
- `packages/db/migrations/NNNN_runtime_health_alert_settings.sql`
- `apps/web-admin/app/admin/system-versions/RuntimeHealthCard.tsx`
- Tests alongside each of the above.

**Modified**

- `apps/api/src/modules/admin/admin.module.ts` (register service/controller/collectors/settings;
  export runtime-health service for the worker)
- `apps/api/src/modules/admin/system-actions.service.ts` (`getDiskUsage()`)
- `apps/api/src/workers/workers.module.ts` (register `runtime-health-monitor` queue + worker)
- `infra/ops-runner/server.mjs` (`GET /disk`)
- `apps/web-admin/app/admin/system-versions/page.tsx` (render the card)
- `packages/i18n/src/*` (EN + FR keys)
- `.env` docs if any new env is introduced (recipient default comes from existing
  `LETSENCRYPT_EMAIL`; ops-runner URL/secret already configured)

## Open questions

None outstanding — scope, disk inclusion, alerting, and UI-editable config all decided.
