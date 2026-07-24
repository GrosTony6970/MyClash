# Runtime Health Dashboard + Alerting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a super-admin Runtime Health card (Postgres connections/size/cache/uptime, Redis memory, BullMQ queue depths, host disk) to `/admin/system-versions`, backed by one aggregated endpoint, with a threshold monitor that emails the operator on critical states and UI-editable alert settings.

**Architecture:** One aggregated `GET /admin/system/runtime-health` endpoint served by `AdminRuntimeHealthService`, which fans out to four isolated collectors via `Promise.allSettled` (DB via a `service_role`-only RPC, Redis + queues via a self-owned ioredis connection, disk via a new read-only ops-runner route). A fixed-tick `RuntimeHealthMonitorWorker` reuses the orchestrator + persisted settings (new RLS-guarded table) to email alerts with Redis-backed de-dup. A `RuntimeHealthCard.tsx` renders the metrics + an alert-settings form under the existing TLS card.

**Tech Stack:** NestJS 11, Fastify, `@supabase/supabase-js` (PostgREST + `.rpc()`), BullMQ + ioredis, `nestjs-zod`, Postgres 17 (`supabase/postgres`), Next.js 16 (web-admin), `@myclash/ui`, `@myclash/i18n`.

## Global Constraints

- **Migration numbering:** next sequential prefixes only; **0156** = RPC, **0157** = settings table. Never renumber applied files.
- **RLS mandatory on every new table:** enable RLS; deny-all (no policies) is correct here — the API uses the `service_role` key (BYPASSRLS). Never expose to anon/authenticated.
- **RPC exposure:** `REVOKE ALL ... FROM public; GRANT EXECUTE ... TO service_role;` — never anon/authenticated.
- **Every `t()` key must exist in EN + FR** (`packages/i18n`), else the `t-key-references` test fails. Use static `t('literal.key')` calls, never template-literal keys, in JSX.
- **Tokenized UI only:** `@myclash/ui` components + semantic tokens (`bg-success/10 text-success`, `border-border`, `text-muted`, …). No raw colors.
- **Super-admin only:** every new API route guarded by `SuperAdminGuard`.
- **API typecheck via `pnpm --filter @myclash/api build`** (incremental tsc stale-passes).
- **Verification per commit:** `pnpm --filter @myclash/api build` · `pnpm --filter @myclash/api test` · lint · i18n key refs · `pnpm --filter @myclash/db review` + replay (for migrations).
- **Actor ids are UUIDs or NULL** — the monitor worker is a system actor; write `updated_by = NULL` for non-user writes, never a `'system:*'` string.

---

## File Structure

**New (API)**

- `apps/api/src/modules/admin/runtime-health/status.ts` — pure threshold→status helpers (`deriveStatus`, `worstStatus`) + shared types.
- `apps/api/src/modules/admin/runtime-health/redis-connection.ts` — `createRuntimeHealthRedis()` factory (ioredis from env).
- `apps/api/src/modules/admin/runtime-health/redis-collector.ts` — `collectRedis(redis)`.
- `apps/api/src/modules/admin/runtime-health/queue-collector.ts` — `collectQueues(redis)`.
- `apps/api/src/modules/admin/runtime-health/db-collector.ts` — `collectDb(supabase)`.
- `apps/api/src/modules/admin/runtime-health/disk-collector.ts` — `collectDisk(systemActions)`.
- `apps/api/src/modules/admin/runtime-health.service.ts` — `AdminRuntimeHealthService.collect()` orchestrator.
- `apps/api/src/modules/admin/runtime-health-alert-settings.service.ts` — `getSettings()` / `updateSettings()`.
- `apps/api/src/modules/admin/runtime-health.controller.ts` — GET runtime-health, GET/PUT alert-settings.
- `apps/api/src/modules/admin/dto/runtime-health.dto.ts` — response types + Zod alert-settings DTO + defaults.
- `apps/api/src/workers/runtime-health-monitor.worker.ts` — fixed-tick monitor + email + de-dup.
- Test files alongside each.

**New (DB / infra / web)**

- `packages/db/migrations/0156_admin_runtime_db_stats.sql`
- `packages/db/migrations/0157_runtime_health_alert_settings.sql`
- `apps/web-admin/app/admin/system-versions/RuntimeHealthCard.tsx`

**Modified**

- `apps/api/src/modules/admin/admin.module.ts` — register + export new providers/controller.
- `apps/api/src/modules/admin/system-actions.service.ts` — `getDiskUsage()`.
- `apps/api/src/workers/workers.module.ts` — register `runtime-health-monitor` queue + worker.
- `apps/api/package.json` — add `ioredis` as a direct dependency.
- `infra/ops-runner/server.mjs` — read-only `GET /disk` + exported `parseDfOutput`.
- `apps/web-admin/app/admin/system-versions/page.tsx` — render `<RuntimeHealthCard />`.
- `packages/i18n/src/locales/en.ts` + `fr.ts` (or the locale files in that package) — new keys.

---

## Task 1: Migration 0156 — DB stats RPC

**Files:**

- Create: `packages/db/migrations/0156_admin_runtime_db_stats.sql`

**Interfaces:**

- Produces: SQL function `public.admin_runtime_db_stats() returns jsonb`, executable by `service_role` only. Callable as `supabase.service.rpc('admin_runtime_db_stats')`.

- [ ] **Step 1: Write the migration**

```sql
-- 0156_admin_runtime_db_stats.sql
-- Read-only runtime DB stats for the super-admin Runtime Health card.
-- SECURITY DEFINER so it can read pg_stat_activity across all backends;
-- EXECUTE granted to service_role only (the API's service key).

create or replace function public.admin_runtime_db_stats()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'maxConnections', current_setting('max_connections')::int,
    'connectionsByState', (
      select jsonb_build_object(
        'active',            count(*) filter (where state = 'active'),
        'idle',              count(*) filter (where state = 'idle'),
        'idleInTransaction', count(*) filter (where state = 'idle in transaction'),
        'total',             count(*)
      )
      from pg_stat_activity
      where datname = current_database()
    ),
    'longestQuerySeconds', coalesce((
      select ceil(extract(epoch from (now() - query_start)))::int
      from pg_stat_activity
      where datname = current_database()
        and state = 'active'
        and pid <> pg_backend_pid()
      order by query_start asc
      limit 1
    ), 0),
    'databaseSizeBytes', pg_database_size(current_database()),
    'cacheHitRatio', coalesce((
      select round((sum(blks_hit)::numeric / nullif(sum(blks_hit) + sum(blks_read), 0)), 4)
      from pg_stat_database
      where datname = current_database()
    ), 1),
    'uptimeSeconds', ceil(extract(epoch from (now() - pg_postmaster_start_time())))::int
  );
$$;

revoke all on function public.admin_runtime_db_stats() from public;
grant execute on function public.admin_runtime_db_stats() to service_role;
```

- [ ] **Step 2: Verify db review + replay**

Run: `pnpm --filter @myclash/db review && pnpm --filter @myclash/db replay`
Expected: PASS — migration applies cleanly on a fresh PG17 replay, no checksum errors.

- [ ] **Step 3: Commit**

```bash
git add packages/db/migrations/0156_admin_runtime_db_stats.sql
git commit -m "feat(db): add admin_runtime_db_stats RPC (service_role only)"
```

---

## Task 2: Migration 0157 — alert settings table

**Files:**

- Create: `packages/db/migrations/0157_runtime_health_alert_settings.sql`

**Interfaces:**

- Produces: table `public.runtime_health_alert_settings`, singleton row `setting_key = 'default'`, RLS deny-all, seeded with defaults.

- [ ] **Step 1: Write the migration**

```sql
-- 0157_runtime_health_alert_settings.sql
-- UI-editable alert thresholds/cadence for the Runtime Health monitor.
-- Singleton config row; RLS deny-all (service_role bypasses).

create table public.runtime_health_alert_settings (
  setting_key             text primary key default 'default',
  enabled                 boolean not null default true,
  recipient_emails        text[] not null default '{}',
  email_level             text not null default 'critical' check (email_level in ('warning', 'critical')),
  check_interval_minutes  int not null default 15  check (check_interval_minutes between 1 and 1440),
  cooldown_minutes        int not null default 360 check (cooldown_minutes between 0 and 10080),
  conn_warn_pct           int not null default 70  check (conn_warn_pct between 1 and 100),
  conn_crit_pct           int not null default 90  check (conn_crit_pct between 1 and 100),
  redis_warn_pct          int not null default 75  check (redis_warn_pct between 1 and 100),
  redis_crit_pct          int not null default 90  check (redis_crit_pct between 1 and 100),
  disk_warn_pct           int not null default 80  check (disk_warn_pct between 1 and 100),
  disk_crit_pct           int not null default 90  check (disk_crit_pct between 1 and 100),
  queue_backlog_warn      int not null default 500  check (queue_backlog_warn >= 0),
  queue_backlog_crit      int not null default 2000 check (queue_backlog_crit >= 0),
  updated_at              timestamptz not null default now(),
  updated_by              uuid
);

alter table public.runtime_health_alert_settings enable row level security;
-- No policies: only the service_role (BYPASSRLS) may read/write.

insert into public.runtime_health_alert_settings (setting_key) values ('default')
on conflict (setting_key) do nothing;
```

- [ ] **Step 2: Verify db review + replay**

Run: `pnpm --filter @myclash/db review && pnpm --filter @myclash/db replay`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/db/migrations/0157_runtime_health_alert_settings.sql
git commit -m "feat(db): add runtime_health_alert_settings table (RLS deny-all, seeded)"
```

---

## Task 3: DTOs, types, and defaults

**Files:**

- Create: `apps/api/src/modules/admin/dto/runtime-health.dto.ts`
- Test: `apps/api/src/modules/admin/dto/runtime-health.dto.test.ts`

**Interfaces:**

- Produces:
  - `type MetricStatus = 'healthy' | 'warning' | 'critical' | 'unavailable'`
  - `interface RuntimeHealthResponseDto { checkedAt: string; overall: MetricStatus; database: DbMetric; redis: RedisMetric; queues: QueueMetric; disk: DiskMetric }` (each metric a discriminated union with `{ status: 'unavailable'; error: string }`).
  - `interface RuntimeHealthAlertSettings { enabled; recipientEmails: string[]; emailLevel: 'warning'|'critical'; checkIntervalMinutes; cooldownMinutes; connWarnPct; connCritPct; redisWarnPct; redisCritPct; diskWarnPct; diskCritPct; queueBacklogWarn; queueBacklogCrit; updatedAt: string | null }`
  - `const DEFAULT_ALERT_SETTINGS: RuntimeHealthAlertSettings`
  - `class UpdateAlertSettingsDto extends createZodDto(updateAlertSettingsSchema)` (all fields optional for partial update; refined `*_warn <= *_crit`).

- [ ] **Step 1: Write the failing test**

```ts
// runtime-health.dto.test.ts
import { describe, it, expect } from 'vitest';
import { updateAlertSettingsSchema, DEFAULT_ALERT_SETTINGS } from './runtime-health.dto';

describe('updateAlertSettingsSchema', () => {
  it('accepts a valid partial update', () => {
    const parsed = updateAlertSettingsSchema.parse({ connWarnPct: 60, connCritPct: 85 });
    expect(parsed.connWarnPct).toBe(60);
  });

  it('rejects warn >= crit for a metric', () => {
    expect(() => updateAlertSettingsSchema.parse({ connWarnPct: 95, connCritPct: 90 })).toThrow();
  });

  it('rejects a malformed recipient email', () => {
    expect(() => updateAlertSettingsSchema.parse({ recipientEmails: ['not-an-email'] })).toThrow();
  });

  it('rejects an out-of-range interval', () => {
    expect(() => updateAlertSettingsSchema.parse({ checkIntervalMinutes: 0 })).toThrow();
  });

  it('exposes sane defaults', () => {
    expect(DEFAULT_ALERT_SETTINGS.emailLevel).toBe('critical');
    expect(DEFAULT_ALERT_SETTINGS.checkIntervalMinutes).toBe(15);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @myclash/api exec vitest run src/modules/admin/dto/runtime-health.dto.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the DTO module**

```ts
// runtime-health.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export type MetricStatus = 'healthy' | 'warning' | 'critical' | 'unavailable';

interface Unavailable {
  status: 'unavailable';
  error: string;
}

export interface DbMetricOk {
  status: 'healthy' | 'warning' | 'critical';
  connections: {
    inUse: number;
    max: number;
    headroom: number;
    byState: { active: number; idle: number; idleInTransaction: number };
  };
  databaseSizeBytes: number;
  longestQuerySeconds: number;
  cacheHitRatio: number;
  uptimeSeconds: number;
}
export type DbMetric = DbMetricOk | Unavailable;

export interface RedisMetricOk {
  status: 'healthy' | 'warning' | 'critical';
  usedMemoryBytes: number;
  maxMemoryBytes: number;
  keys: number;
  connectedClients: number;
}
export type RedisMetric = RedisMetricOk | Unavailable;

export interface QueueMetricOk {
  status: 'healthy' | 'warning' | 'critical';
  totalWaiting: number;
  totalFailed: number;
  queues: Array<{
    name: string;
    active: number;
    waiting: number;
    delayed: number;
    failed: number;
  }>;
}
export type QueueMetric = QueueMetricOk | Unavailable;

export interface DiskMetricOk {
  status: 'healthy' | 'warning' | 'critical';
  mountpoint: string;
  sizeBytes: number;
  usedBytes: number;
  availBytes: number;
  usePercent: number;
}
export type DiskMetric = DiskMetricOk | Unavailable;

export interface RuntimeHealthResponseDto {
  checkedAt: string;
  overall: MetricStatus;
  database: DbMetric;
  redis: RedisMetric;
  queues: QueueMetric;
  disk: DiskMetric;
}

export interface RuntimeHealthAlertSettings {
  enabled: boolean;
  recipientEmails: string[];
  emailLevel: 'warning' | 'critical';
  checkIntervalMinutes: number;
  cooldownMinutes: number;
  connWarnPct: number;
  connCritPct: number;
  redisWarnPct: number;
  redisCritPct: number;
  diskWarnPct: number;
  diskCritPct: number;
  queueBacklogWarn: number;
  queueBacklogCrit: number;
  updatedAt: string | null;
}

export const DEFAULT_ALERT_SETTINGS: RuntimeHealthAlertSettings = {
  enabled: true,
  recipientEmails: [],
  emailLevel: 'critical',
  checkIntervalMinutes: 15,
  cooldownMinutes: 360,
  connWarnPct: 70,
  connCritPct: 90,
  redisWarnPct: 75,
  redisCritPct: 90,
  diskWarnPct: 80,
  diskCritPct: 90,
  queueBacklogWarn: 500,
  queueBacklogCrit: 2000,
  updatedAt: null,
};

const pct = z.number().int().min(1).max(100);

export const updateAlertSettingsSchema = z
  .object({
    enabled: z.boolean(),
    recipientEmails: z.array(z.string().email()).max(20),
    emailLevel: z.enum(['warning', 'critical']),
    checkIntervalMinutes: z.number().int().min(1).max(1440),
    cooldownMinutes: z.number().int().min(0).max(10080),
    connWarnPct: pct,
    connCritPct: pct,
    redisWarnPct: pct,
    redisCritPct: pct,
    diskWarnPct: pct,
    diskCritPct: pct,
    queueBacklogWarn: z.number().int().min(0),
    queueBacklogCrit: z.number().int().min(0),
  })
  .partial()
  .strict()
  .superRefine((val, ctx) => {
    const pairs: Array<[keyof typeof val, keyof typeof val]> = [
      ['connWarnPct', 'connCritPct'],
      ['redisWarnPct', 'redisCritPct'],
      ['diskWarnPct', 'diskCritPct'],
      ['queueBacklogWarn', 'queueBacklogCrit'],
    ];
    for (const [warnKey, critKey] of pairs) {
      const warn = val[warnKey];
      const crit = val[critKey];
      if (typeof warn === 'number' && typeof crit === 'number' && warn >= crit) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [critKey],
          message: `${String(critKey)} must be greater than ${String(warnKey)}`,
        });
      }
    }
  });

export class UpdateAlertSettingsDto extends createZodDto(updateAlertSettingsSchema) {}
```

> Note: the `warn < crit` refinement only fires when **both** values are present in the partial update. The service (Task 10) re-checks against the persisted row after merge so a one-sided update can't produce an inverted pair.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @myclash/api exec vitest run src/modules/admin/dto/runtime-health.dto.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin/dto/runtime-health.dto.ts apps/api/src/modules/admin/dto/runtime-health.dto.test.ts
git commit -m "feat(api): runtime-health DTOs, alert-settings Zod schema + defaults"
```

---

## Task 4: Status helpers

**Files:**

- Create: `apps/api/src/modules/admin/runtime-health/status.ts`
- Test: `apps/api/src/modules/admin/runtime-health/status.test.ts`

**Interfaces:**

- Consumes: `MetricStatus` from `../dto/runtime-health.dto`.
- Produces:
  - `deriveStatus(value: number, warn: number, crit: number): 'healthy'|'warning'|'critical'` — ascending (higher = worse).
  - `worstStatus(...statuses: MetricStatus[]): MetricStatus` — precedence `critical > warning > unavailable > healthy`.

- [ ] **Step 1: Write the failing test**

```ts
// status.test.ts
import { describe, it, expect } from 'vitest';
import { deriveStatus, worstStatus } from './status';

describe('deriveStatus', () => {
  it('healthy below warn', () => expect(deriveStatus(50, 70, 90)).toBe('healthy'));
  it('warning at/above warn, below crit', () => expect(deriveStatus(75, 70, 90)).toBe('warning'));
  it('critical at/above crit', () => expect(deriveStatus(95, 70, 90)).toBe('critical'));
  it('boundary: exactly warn is warning', () => expect(deriveStatus(70, 70, 90)).toBe('warning'));
});

describe('worstStatus', () => {
  it('critical dominates', () =>
    expect(worstStatus('healthy', 'warning', 'critical')).toBe('critical'));
  it('unavailable beats healthy but not warning', () =>
    expect(worstStatus('healthy', 'unavailable')).toBe('unavailable'));
  it('all healthy', () => expect(worstStatus('healthy', 'healthy')).toBe('healthy'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @myclash/api exec vitest run src/modules/admin/runtime-health/status.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

```ts
// status.ts
import type { MetricStatus } from '../dto/runtime-health.dto';

/** Ascending metric (higher value = worse). warn/crit are inclusive lower bounds. */
export function deriveStatus(
  value: number,
  warn: number,
  crit: number,
): 'healthy' | 'warning' | 'critical' {
  if (value >= crit) return 'critical';
  if (value >= warn) return 'warning';
  return 'healthy';
}

const RANK: Record<MetricStatus, number> = {
  healthy: 0,
  unavailable: 1,
  warning: 2,
  critical: 3,
};

export function worstStatus(...statuses: MetricStatus[]): MetricStatus {
  return statuses.reduce<MetricStatus>(
    (worst, s) => (RANK[s] > RANK[worst] ? s : worst),
    'healthy',
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @myclash/api exec vitest run src/modules/admin/runtime-health/status.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin/runtime-health/status.ts apps/api/src/modules/admin/runtime-health/status.test.ts
git commit -m "feat(api): runtime-health status derivation helpers"
```

---

## Task 5: Redis connection factory + Redis collector

**Files:**

- Modify: `apps/api/package.json` (add `ioredis` to `dependencies` — currently transitive via BullMQ; pin the same version the lockfile already resolves).
- Create: `apps/api/src/modules/admin/runtime-health/redis-connection.ts`
- Create: `apps/api/src/modules/admin/runtime-health/redis-collector.ts`
- Test: `apps/api/src/modules/admin/runtime-health/redis-collector.test.ts`

**Interfaces:**

- Produces:
  - `createRuntimeHealthRedis(config: ConfigService): Redis` — one lazy ioredis connection from `REDIS_URL` or `REDIS_HOST/PORT/PASSWORD` (mirrors `workers.module.ts` factory), `maxRetriesPerRequest: null`, `lazyConnect: true`.
  - `interface RedisClientLike { info(section: string): Promise<string>; dbsize(): Promise<number> }`
  - `collectRedis(redis: RedisClientLike): Promise<{ usedMemoryBytes; maxMemoryBytes; keys; connectedClients }>` — parses `INFO` output.

- [ ] **Step 1: Add ioredis as a direct dependency**

Run: `pnpm --filter @myclash/api add ioredis`
Expected: adds `ioredis` to `apps/api/package.json` dependencies, no lockfile churn beyond the direct entry.

- [ ] **Step 2: Write the failing test**

```ts
// redis-collector.test.ts
import { describe, it, expect } from 'vitest';
import { collectRedis } from './redis-collector';

const INFO = [
  '# Memory',
  'used_memory:125829120',
  'maxmemory:536870912',
  '# Clients',
  'connected_clients:7',
].join('\r\n');

describe('collectRedis', () => {
  it('parses used/max memory + clients + dbsize', async () => {
    const redis = {
      info: async () => INFO,
      dbsize: async () => 42,
    };
    const result = await collectRedis(redis);
    expect(result).toEqual({
      usedMemoryBytes: 125829120,
      maxMemoryBytes: 536870912,
      keys: 42,
      connectedClients: 7,
    });
  });

  it('treats maxmemory:0 (unlimited) as 0', async () => {
    const redis = {
      info: async () => 'used_memory:1000\r\nmaxmemory:0\r\nconnected_clients:1',
      dbsize: async () => 0,
    };
    const result = await collectRedis(redis);
    expect(result.maxMemoryBytes).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @myclash/api exec vitest run src/modules/admin/runtime-health/redis-collector.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the connection factory**

```ts
// redis-connection.ts
import { Redis } from 'ioredis';
import type { ConfigService } from '@nestjs/config';

/**
 * One lazy ioredis connection for the runtime-health Redis + queue collectors.
 * Mirrors the connection resolution in workers.module.ts (REDIS_URL first,
 * then host/port/password). lazyConnect so nothing dials Redis until a metric
 * read actually happens.
 */
export function createRuntimeHealthRedis(config: ConfigService): Redis {
  const url = config.get<string>('REDIS_URL');
  if (url) {
    return new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null });
  }
  return new Redis({
    host: config.get<string>('REDIS_HOST', 'localhost'),
    port: config.get<number>('REDIS_PORT', 6379),
    password: config.get<string>('REDIS_PASSWORD') ?? undefined,
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });
}
```

- [ ] **Step 5: Write the collector**

```ts
// redis-collector.ts
export interface RedisClientLike {
  info(section: string): Promise<string>;
  dbsize(): Promise<number>;
}

function parseInfoInt(info: string, key: string): number {
  const match = new RegExp(`^${key}:(\\d+)`, 'm').exec(info);
  return match ? Number(match[1]) : 0;
}

export async function collectRedis(redis: RedisClientLike): Promise<{
  usedMemoryBytes: number;
  maxMemoryBytes: number;
  keys: number;
  connectedClients: number;
}> {
  const [memory, clients, keys] = await Promise.all([
    redis.info('memory'),
    redis.info('clients'),
    redis.dbsize(),
  ]);
  return {
    usedMemoryBytes: parseInfoInt(memory, 'used_memory'),
    maxMemoryBytes: parseInfoInt(memory, 'maxmemory'),
    keys,
    connectedClients: parseInfoInt(clients, 'connected_clients'),
  };
}
```

> The test passes a single object whose `info()` ignores the section arg and returns the combined fixture — fine, because `parseInfoInt` keys off the field name regardless of section.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @myclash/api exec vitest run src/modules/admin/runtime-health/redis-collector.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json apps/api/src/modules/admin/runtime-health/redis-connection.ts apps/api/src/modules/admin/runtime-health/redis-collector.ts apps/api/src/modules/admin/runtime-health/redis-collector.test.ts
git commit -m "feat(api): runtime-health redis connection factory + collector"
```

---

## Task 6: Queue collector

**Files:**

- Create: `apps/api/src/modules/admin/runtime-health/queue-collector.ts`
- Test: `apps/api/src/modules/admin/runtime-health/queue-collector.test.ts`

**Interfaces:**

- Consumes: an ioredis connection (from Task 5).
- Produces:
  - `const RUNTIME_HEALTH_QUEUE_NAMES: readonly string[]` — the 7 known queue names.
  - `collectQueues(connection, opts?: { queueFactory?; names? }): Promise<{ totalWaiting; totalFailed; queues: Array<{ name; active; waiting; delayed; failed }> }>` — `queueFactory` is injectable for tests (defaults to constructing BullMQ `Queue`).

- [ ] **Step 1: Write the failing test**

```ts
// queue-collector.test.ts
import { describe, it, expect } from 'vitest';
import { collectQueues } from './queue-collector';

describe('collectQueues', () => {
  it('sums waiting + failed across queues and returns per-queue rows', async () => {
    const counts: Record<
      string,
      { active: number; waiting: number; delayed: number; failed: number }
    > = {
      'notification-scheduler': { active: 1, waiting: 3, delayed: 0, failed: 0 },
      'event-archive': { active: 0, waiting: 2, delayed: 1, failed: 2 },
    };
    const queueFactory = (name: string) => ({
      getJobCounts: async () => counts[name],
      close: async () => undefined,
    });
    const result = await collectQueues({} as never, {
      names: ['notification-scheduler', 'event-archive'],
      queueFactory,
    });
    expect(result.totalWaiting).toBe(5);
    expect(result.totalFailed).toBe(2);
    expect(result.queues).toHaveLength(2);
    expect(result.queues[1]).toEqual({
      name: 'event-archive',
      active: 0,
      waiting: 2,
      delayed: 1,
      failed: 2,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @myclash/api exec vitest run src/modules/admin/runtime-health/queue-collector.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the collector**

```ts
// queue-collector.ts
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export const RUNTIME_HEALTH_QUEUE_NAMES = [
  'hema-ratings',
  'notification-scheduler',
  'event-status-ticker',
  'event-archive',
  'data-quality-deterministic',
  'tls-cert-monitor',
  'runtime-health-monitor',
] as const;

interface QueueLike {
  getJobCounts(): Promise<{ active: number; waiting: number; delayed: number; failed: number }>;
  close(): Promise<void>;
}

export async function collectQueues(
  connection: Redis,
  opts: {
    names?: readonly string[];
    queueFactory?: (name: string) => QueueLike;
  } = {},
): Promise<{
  totalWaiting: number;
  totalFailed: number;
  queues: Array<{ name: string; active: number; waiting: number; delayed: number; failed: number }>;
}> {
  const names = opts.names ?? RUNTIME_HEALTH_QUEUE_NAMES;
  const factory =
    opts.queueFactory ??
    ((name: string) => new Queue(name, { connection }) as unknown as QueueLike);

  const rows = await Promise.all(
    names.map(async (name) => {
      const queue = factory(name);
      try {
        const c = await queue.getJobCounts();
        return {
          name,
          active: c.active ?? 0,
          waiting: c.waiting ?? 0,
          delayed: c.delayed ?? 0,
          failed: c.failed ?? 0,
        };
      } finally {
        // Only close queues we constructed via BullMQ (real factory returns a
        // Queue with close()); the test factory's close() is a harmless no-op.
        await queue.close().catch(() => undefined);
      }
    }),
  );

  return {
    totalWaiting: rows.reduce((sum, r) => sum + r.waiting, 0),
    totalFailed: rows.reduce((sum, r) => sum + r.failed, 0),
    queues: rows,
  };
}
```

> Real BullMQ `Queue` instances created per read share the passed ioredis `connection` but register a blocking client; `close()` after each read prevents connection leaks. This is a read-only path (`getJobCounts`), never adds jobs.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @myclash/api exec vitest run src/modules/admin/runtime-health/queue-collector.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin/runtime-health/queue-collector.ts apps/api/src/modules/admin/runtime-health/queue-collector.test.ts
git commit -m "feat(api): runtime-health queue-depth collector"
```

---

## Task 7: DB collector

**Files:**

- Create: `apps/api/src/modules/admin/runtime-health/db-collector.ts`
- Test: `apps/api/src/modules/admin/runtime-health/db-collector.test.ts`

**Interfaces:**

- Consumes: `SupabaseService` (uses `supabase.service.rpc('admin_runtime_db_stats')`).
- Produces: `collectDb(supabase): Promise<{ maxConnections; connectionsByState: { active; idle; idleInTransaction; total }; longestQuerySeconds; databaseSizeBytes; cacheHitRatio; uptimeSeconds }>` — throws if the rpc errors.

- [ ] **Step 1: Write the failing test**

```ts
// db-collector.test.ts
import { describe, it, expect } from 'vitest';
import { collectDb } from './db-collector';

function mockSupabase(rpcResult: unknown, error: unknown = null) {
  return { service: { rpc: async () => ({ data: rpcResult, error }) } } as never;
}

describe('collectDb', () => {
  it('maps the rpc jsonb payload', async () => {
    const supabase = mockSupabase({
      maxConnections: 100,
      connectionsByState: { active: 8, idle: 31, idleInTransaction: 3, total: 42 },
      longestQuerySeconds: 2,
      databaseSizeBytes: 1932735283,
      cacheHitRatio: 0.994,
      uptimeSeconds: 1048320,
    });
    const result = await collectDb(supabase);
    expect(result.maxConnections).toBe(100);
    expect(result.connectionsByState.total).toBe(42);
    expect(result.cacheHitRatio).toBe(0.994);
  });

  it('throws when the rpc returns an error', async () => {
    const supabase = mockSupabase(null, { message: 'permission denied' });
    await expect(collectDb(supabase)).rejects.toThrow('permission denied');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @myclash/api exec vitest run src/modules/admin/runtime-health/db-collector.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the collector**

```ts
// db-collector.ts
import type { SupabaseService } from '../../supabase/supabase.service';

interface DbStatsPayload {
  maxConnections: number;
  connectionsByState: { active: number; idle: number; idleInTransaction: number; total: number };
  longestQuerySeconds: number;
  databaseSizeBytes: number;
  cacheHitRatio: number;
  uptimeSeconds: number;
}

export async function collectDb(supabase: SupabaseService): Promise<DbStatsPayload> {
  const { data, error } = await supabase.service.rpc('admin_runtime_db_stats');
  if (error) throw new Error(error.message);
  if (!data) throw new Error('admin_runtime_db_stats returned no data');
  return data as DbStatsPayload;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @myclash/api exec vitest run src/modules/admin/runtime-health/db-collector.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin/runtime-health/db-collector.ts apps/api/src/modules/admin/runtime-health/db-collector.test.ts
git commit -m "feat(api): runtime-health DB stats collector"
```

---

## Task 8: ops-runner `GET /disk` + df parser

**Files:**

- Modify: `infra/ops-runner/server.mjs` (add route + `export function parseDfOutput`)
- Test: `infra/ops-runner/parse-df.test.mjs`

**Interfaces:**

- Produces:
  - `parseDfOutput(stdout: string): { filesystem; mountpoint; sizeBytes; usedBytes; availBytes; usePercent }` — parses `df -P -B1 <dir>` output (2 lines).
  - `GET /disk` route → `{ generatedAt, ...parsed }`, Bearer-guarded (existing auth check covers all routes).

- [ ] **Step 1: Write the failing test**

```js
// parse-df.test.mjs
import { describe, it, expect } from 'vitest';
import { parseDfOutput } from './server.mjs';

describe('parseDfOutput', () => {
  it('parses df -P -B1 output', () => {
    const stdout = [
      'Filesystem     1B-blocks        Used   Available Capacity Mounted on',
      '/dev/sda1    52709debug 32000000000 18000000000      65% /',
    ].join('\n');
    // Use realistic integers:
    const real = [
      'Filesystem     1B-blocks        Used   Available Capacity Mounted on',
      '/dev/sda1  50000000000 32000000000 18000000000  65% /srv/myclash',
    ].join('\n');
    const result = parseDfOutput(real);
    expect(result).toEqual({
      filesystem: '/dev/sda1',
      sizeBytes: 50000000000,
      usedBytes: 32000000000,
      availBytes: 18000000000,
      usePercent: 65,
      mountpoint: '/srv/myclash',
    });
  });
});
```

> Delete the throwaway first `stdout` const when implementing — kept here only to show the format; the assertion uses `real`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter ... exec vitest run infra/ops-runner/parse-df.test.mjs` — or from repo root: `npx vitest run infra/ops-runner/parse-df.test.mjs`
Expected: FAIL — `parseDfOutput` is not exported.

- [ ] **Step 3: Add the parser + route to `server.mjs`**

Add near the other exports/helpers:

```js
/**
 * Parse `df -P -B1 <dir>` output (POSIX format, sizes in bytes). The data row
 * may wrap if the filesystem name is long, but `-P` guarantees a single row.
 */
export function parseDfOutput(stdout) {
  const lines = String(stdout).trim().split(/\r?\n/);
  const dataLine = lines[lines.length - 1];
  const cols = dataLine.trim().split(/\s+/);
  // Filesystem 1B-blocks Used Available Capacity% Mounted-on
  const [filesystem, size, used, avail, capacity, ...mount] = cols;
  return {
    filesystem,
    sizeBytes: Number(size),
    usedBytes: Number(used),
    availBytes: Number(avail),
    usePercent: Number(String(capacity).replace('%', '')),
    mountpoint: mount.join(' '),
  };
}

async function diskResponse() {
  const result = await spawnCapture('df', ['-P', '-B1', ROOT_DIR]);
  if (result.code !== 0) {
    throw new Error(result.stderr || 'df failed');
  }
  return { generatedAt: new Date().toISOString(), ...parseDfOutput(result.stdout) };
}
```

Register the route inside the request handler, next to `GET /status`:

```js
if (req.method === 'GET' && url.pathname === '/disk') {
  sendJson(res, 200, await diskResponse());
  return;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run infra/ops-runner/parse-df.test.mjs`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add infra/ops-runner/server.mjs infra/ops-runner/parse-df.test.mjs
git commit -m "feat(ops-runner): read-only GET /disk with df parser"
```

---

## Task 9: Disk collector + `getDiskUsage()`

**Files:**

- Modify: `apps/api/src/modules/admin/system-actions.service.ts` (add `getDiskUsage()`)
- Create: `apps/api/src/modules/admin/runtime-health/disk-collector.ts`
- Test: `apps/api/src/modules/admin/system-actions.service.test.ts` (create if absent) — `getDiskUsage` happy + failure path.

**Interfaces:**

- Produces:
  - `AdminSystemActionsService.getDiskUsage(): Promise<{ mountpoint; sizeBytes; usedBytes; availBytes; usePercent }>` — GET ops-runner `/disk`; throws `ServiceUnavailableException` if the runner is unconfigured/unreachable.
  - `collectDisk(systemActions): Promise<{ mountpoint; sizeBytes; usedBytes; availBytes; usePercent }>` — thin passthrough (keeps the collector interface uniform).

- [ ] **Step 1: Write the failing test**

```ts
// system-actions.service.test.ts  (add this describe block; create the file if it does not exist)
import { describe, it, expect } from 'vitest';
import { AdminSystemActionsService } from './system-actions.service';

const supabaseStub = { service: { from: () => ({ insert: async () => ({}) }) } } as never;

describe('AdminSystemActionsService.getDiskUsage', () => {
  it('returns parsed disk usage from the ops-runner', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          generatedAt: 'now',
          filesystem: '/dev/sda1',
          mountpoint: '/srv/myclash',
          sizeBytes: 50000000000,
          usedBytes: 32000000000,
          availBytes: 18000000000,
          usePercent: 65,
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const svc = new AdminSystemActionsService(supabaseStub, {
      opsRunnerUrl: 'http://ops:4075',
      opsRunnerSecret: 'secret',
      fetchImpl,
    });
    const result = await svc.getDiskUsage();
    expect(result.usePercent).toBe(65);
    expect(result.mountpoint).toBe('/srv/myclash');
  });

  it('throws ServiceUnavailable when ops-runner is not configured', async () => {
    const svc = new AdminSystemActionsService(supabaseStub, {
      opsRunnerUrl: '',
      opsRunnerSecret: '',
    });
    await expect(svc.getDiskUsage()).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @myclash/api exec vitest run src/modules/admin/system-actions.service.test.ts`
Expected: FAIL — `getDiskUsage` is not a function.

- [ ] **Step 3: Add `getDiskUsage()` to `system-actions.service.ts`**

Add this interface near the top exports and the method inside the class (after `renewCertificates`):

```ts
export interface DiskUsageResult {
  mountpoint: string;
  sizeBytes: number;
  usedBytes: number;
  availBytes: number;
  usePercent: number;
}
```

```ts
  /** Read-only host disk usage via the ops-runner's GET /disk route. */
  async getDiskUsage(): Promise<DiskUsageResult> {
    if (!this.opsRunnerUrl || !this.opsRunnerSecret) {
      throw new ServiceUnavailableException('Disk usage requires the ops-runner sidecar.');
    }
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.opsRunnerUrl}/disk`, {
        method: 'GET',
        headers: { authorization: `Bearer ${this.opsRunnerSecret}` },
        signal: AbortSignal.timeout(DEFAULT_OPS_TIMEOUT_MS),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ops-runner request failed';
      throw new ServiceUnavailableException(message);
    }
    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new ServiceUnavailableException(
        message || `ops-runner returned ${response.status} for disk usage.`,
      );
    }
    const body = (await response.json()) as DiskUsageResult;
    return {
      mountpoint: body.mountpoint,
      sizeBytes: body.sizeBytes,
      usedBytes: body.usedBytes,
      availBytes: body.availBytes,
      usePercent: body.usePercent,
    };
  }
```

- [ ] **Step 4: Write the collector**

```ts
// disk-collector.ts
import type { AdminSystemActionsService, DiskUsageResult } from '../system-actions.service';

export function collectDisk(systemActions: AdminSystemActionsService): Promise<DiskUsageResult> {
  return systemActions.getDiskUsage();
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @myclash/api exec vitest run src/modules/admin/system-actions.service.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/admin/system-actions.service.ts apps/api/src/modules/admin/system-actions.service.test.ts apps/api/src/modules/admin/runtime-health/disk-collector.ts
git commit -m "feat(api): ops-runner disk-usage client + disk collector"
```

---

## Task 10: Alert settings service

**Files:**

- Create: `apps/api/src/modules/admin/runtime-health-alert-settings.service.ts`
- Test: `apps/api/src/modules/admin/runtime-health-alert-settings.service.test.ts`

**Interfaces:**

- Consumes: `SupabaseService`, `DEFAULT_ALERT_SETTINGS`, `RuntimeHealthAlertSettings`.
- Produces:
  - `RuntimeHealthAlertSettingsService.getSettings(): Promise<RuntimeHealthAlertSettings>` — reads the singleton row, merges defaults, maps snake_case→camelCase.
  - `updateSettings(patch: Partial<RuntimeHealthAlertSettings>, actorUserId: string | null): Promise<RuntimeHealthAlertSettings>` — merges with current, re-validates `warn < crit`, upserts, returns fresh.

- [ ] **Step 1: Write the failing test**

```ts
// runtime-health-alert-settings.service.test.ts
import { describe, it, expect, vi } from 'vitest';
import { RuntimeHealthAlertSettingsService } from './runtime-health-alert-settings.service';

function mockSupabase(row: Record<string, unknown> | null) {
  const upsert = vi.fn(async () => ({ error: null }));
  const supabase = {
    service: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
        upsert,
      }),
    },
  } as never;
  return { supabase, upsert };
}

describe('RuntimeHealthAlertSettingsService', () => {
  it('returns defaults merged with the stored row', async () => {
    const { supabase } = mockSupabase({
      enabled: true,
      recipient_emails: ['ops@myclash.fr'],
      email_level: 'critical',
      check_interval_minutes: 30,
      cooldown_minutes: 360,
      conn_warn_pct: 70,
      conn_crit_pct: 90,
      redis_warn_pct: 75,
      redis_crit_pct: 90,
      disk_warn_pct: 80,
      disk_crit_pct: 90,
      queue_backlog_warn: 500,
      queue_backlog_crit: 2000,
      updated_at: '2026-07-24T00:00:00Z',
    });
    const svc = new RuntimeHealthAlertSettingsService(supabase);
    const settings = await svc.getSettings();
    expect(settings.recipientEmails).toEqual(['ops@myclash.fr']);
    expect(settings.checkIntervalMinutes).toBe(30);
  });

  it('rejects an update that inverts a threshold pair', async () => {
    const { supabase } = mockSupabase({ conn_warn_pct: 70, conn_crit_pct: 90 });
    const svc = new RuntimeHealthAlertSettingsService(supabase);
    await expect(svc.updateSettings({ connWarnPct: 95 }, null)).rejects.toThrow();
  });

  it('upserts merged settings', async () => {
    const { supabase, upsert } = mockSupabase({ conn_warn_pct: 70, conn_crit_pct: 90 });
    const svc = new RuntimeHealthAlertSettingsService(supabase);
    await svc.updateSettings({ checkIntervalMinutes: 5 }, null);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ setting_key: 'default', check_interval_minutes: 5 }),
      { onConflict: 'setting_key' },
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @myclash/api exec vitest run src/modules/admin/runtime-health-alert-settings.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

```ts
// runtime-health-alert-settings.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { DEFAULT_ALERT_SETTINGS, type RuntimeHealthAlertSettings } from './dto/runtime-health.dto';

const SETTING_KEY = 'default';

interface SettingsRow {
  enabled: boolean | null;
  recipient_emails: string[] | null;
  email_level: 'warning' | 'critical' | null;
  check_interval_minutes: number | null;
  cooldown_minutes: number | null;
  conn_warn_pct: number | null;
  conn_crit_pct: number | null;
  redis_warn_pct: number | null;
  redis_crit_pct: number | null;
  disk_warn_pct: number | null;
  disk_crit_pct: number | null;
  queue_backlog_warn: number | null;
  queue_backlog_crit: number | null;
  updated_at: string | null;
}

@Injectable()
export class RuntimeHealthAlertSettingsService {
  constructor(private readonly supabase: SupabaseService) {}

  async getSettings(): Promise<RuntimeHealthAlertSettings> {
    const { data } = await this.supabase.service
      .from('runtime_health_alert_settings')
      .select(
        'enabled, recipient_emails, email_level, check_interval_minutes, cooldown_minutes, ' +
          'conn_warn_pct, conn_crit_pct, redis_warn_pct, redis_crit_pct, disk_warn_pct, ' +
          'disk_crit_pct, queue_backlog_warn, queue_backlog_crit, updated_at',
      )
      .eq('setting_key', SETTING_KEY)
      .maybeSingle();
    return mergeRow(data as SettingsRow | null);
  }

  async updateSettings(
    patch: Partial<RuntimeHealthAlertSettings>,
    actorUserId: string | null,
  ): Promise<RuntimeHealthAlertSettings> {
    const current = await this.getSettings();
    const merged: RuntimeHealthAlertSettings = { ...current, ...patch };
    assertThresholdOrder(merged);

    const { error } = await this.supabase.service.from('runtime_health_alert_settings').upsert(
      {
        setting_key: SETTING_KEY,
        enabled: merged.enabled,
        recipient_emails: merged.recipientEmails,
        email_level: merged.emailLevel,
        check_interval_minutes: merged.checkIntervalMinutes,
        cooldown_minutes: merged.cooldownMinutes,
        conn_warn_pct: merged.connWarnPct,
        conn_crit_pct: merged.connCritPct,
        redis_warn_pct: merged.redisWarnPct,
        redis_crit_pct: merged.redisCritPct,
        disk_warn_pct: merged.diskWarnPct,
        disk_crit_pct: merged.diskCritPct,
        queue_backlog_warn: merged.queueBacklogWarn,
        queue_backlog_crit: merged.queueBacklogCrit,
        updated_at: new Date().toISOString(),
        updated_by: actorUserId,
      },
      { onConflict: 'setting_key' },
    );
    if (error) throw new Error(error.message);
    return this.getSettings();
  }
}

function mergeRow(row: SettingsRow | null): RuntimeHealthAlertSettings {
  if (!row) return { ...DEFAULT_ALERT_SETTINGS };
  const d = DEFAULT_ALERT_SETTINGS;
  return {
    enabled: row.enabled ?? d.enabled,
    recipientEmails: row.recipient_emails ?? d.recipientEmails,
    emailLevel: row.email_level ?? d.emailLevel,
    checkIntervalMinutes: row.check_interval_minutes ?? d.checkIntervalMinutes,
    cooldownMinutes: row.cooldown_minutes ?? d.cooldownMinutes,
    connWarnPct: row.conn_warn_pct ?? d.connWarnPct,
    connCritPct: row.conn_crit_pct ?? d.connCritPct,
    redisWarnPct: row.redis_warn_pct ?? d.redisWarnPct,
    redisCritPct: row.redis_crit_pct ?? d.redisCritPct,
    diskWarnPct: row.disk_warn_pct ?? d.diskWarnPct,
    diskCritPct: row.disk_crit_pct ?? d.diskCritPct,
    queueBacklogWarn: row.queue_backlog_warn ?? d.queueBacklogWarn,
    queueBacklogCrit: row.queue_backlog_crit ?? d.queueBacklogCrit,
    updatedAt: row.updated_at ?? d.updatedAt,
  };
}

function assertThresholdOrder(s: RuntimeHealthAlertSettings): void {
  const pairs: Array<[number, number, string]> = [
    [s.connWarnPct, s.connCritPct, 'connection'],
    [s.redisWarnPct, s.redisCritPct, 'redis'],
    [s.diskWarnPct, s.diskCritPct, 'disk'],
    [s.queueBacklogWarn, s.queueBacklogCrit, 'queue backlog'],
  ];
  for (const [warn, crit, label] of pairs) {
    if (warn >= crit) {
      throw new BadRequestException(
        `${label} warning threshold must be below the critical threshold`,
      );
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @myclash/api exec vitest run src/modules/admin/runtime-health-alert-settings.service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin/runtime-health-alert-settings.service.ts apps/api/src/modules/admin/runtime-health-alert-settings.service.test.ts
git commit -m "feat(api): runtime-health alert-settings service (get/update, threshold validation)"
```

---

## Task 11: Orchestrator service

**Files:**

- Create: `apps/api/src/modules/admin/runtime-health.service.ts`
- Test: `apps/api/src/modules/admin/runtime-health.service.test.ts`

**Interfaces:**

- Consumes: `SupabaseService`, `AdminSystemActionsService`, `RuntimeHealthAlertSettingsService`, a `Redis` connection, the four collectors, `deriveStatus`/`worstStatus`.
- Produces: `AdminRuntimeHealthService.collect(): Promise<RuntimeHealthResponseDto>` — runs all four collectors via `Promise.allSettled`, applies persisted thresholds, returns the DTO with per-metric + overall status. A rejected collector becomes `{ status: 'unavailable', error }`.
- Constructor takes injectable collector fns (default to the real ones) so tests don't touch Redis/PostgREST.

- [ ] **Step 1: Write the failing test**

```ts
// runtime-health.service.test.ts
import { describe, it, expect } from 'vitest';
import { AdminRuntimeHealthService } from './runtime-health.service';
import { DEFAULT_ALERT_SETTINGS } from './dto/runtime-health.dto';

const settingsService = { getSettings: async () => ({ ...DEFAULT_ALERT_SETTINGS }) } as never;

function make(
  overrides: Partial<Parameters<typeof AdminRuntimeHealthService.prototype.constructor>[0]> = {},
) {
  return new AdminRuntimeHealthService(settingsService, {
    collectDb: async () => ({
      maxConnections: 100,
      connectionsByState: { active: 8, idle: 31, idleInTransaction: 3, total: 42 },
      longestQuerySeconds: 2,
      databaseSizeBytes: 1_000,
      cacheHitRatio: 0.99,
      uptimeSeconds: 1_000,
    }),
    collectRedis: async () => ({
      usedMemoryBytes: 120,
      maxMemoryBytes: 512,
      keys: 5,
      connectedClients: 3,
    }),
    collectQueues: async () => ({ totalWaiting: 3, totalFailed: 0, queues: [] }),
    collectDisk: async () => ({
      mountpoint: '/',
      sizeBytes: 100,
      usedBytes: 61,
      availBytes: 39,
      usePercent: 61,
    }),
    ...overrides,
  });
}

describe('AdminRuntimeHealthService.collect', () => {
  it('reports healthy when all metrics are under thresholds', async () => {
    const result = await make().collect();
    expect(result.overall).toBe('healthy');
    expect(result.database.status).toBe('healthy');
  });

  it('marks connections critical past the crit threshold', async () => {
    const result = await make({
      collectDb: async () => ({
        maxConnections: 100,
        connectionsByState: { active: 90, idle: 5, idleInTransaction: 0, total: 95 },
        longestQuerySeconds: 0,
        databaseSizeBytes: 1,
        cacheHitRatio: 1,
        uptimeSeconds: 1,
      }),
    }).collect();
    expect(result.database.status).toBe('critical');
    expect(result.overall).toBe('critical');
  });

  it('degrades a failed collector to unavailable without sinking the rest', async () => {
    const result = await make({
      collectDisk: async () => {
        throw new Error('ops-runner unreachable');
      },
    }).collect();
    expect(result.disk).toEqual({ status: 'unavailable', error: 'ops-runner unreachable' });
    expect(result.database.status).toBe('healthy');
    expect(result.overall).toBe('unavailable');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @myclash/api exec vitest run src/modules/admin/runtime-health.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the orchestrator**

```ts
// runtime-health.service.ts
import { Injectable } from '@nestjs/common';
import type { RuntimeHealthAlertSettingsService } from './runtime-health-alert-settings.service';
import type {
  DbMetric,
  DiskMetric,
  QueueMetric,
  RedisMetric,
  RuntimeHealthAlertSettings,
  RuntimeHealthResponseDto,
} from './dto/runtime-health.dto';
import { deriveStatus, worstStatus } from './runtime-health/status';

interface Collectors {
  collectDb: () => Promise<{
    maxConnections: number;
    connectionsByState: { active: number; idle: number; idleInTransaction: number; total: number };
    longestQuerySeconds: number;
    databaseSizeBytes: number;
    cacheHitRatio: number;
    uptimeSeconds: number;
  }>;
  collectRedis: () => Promise<{
    usedMemoryBytes: number;
    maxMemoryBytes: number;
    keys: number;
    connectedClients: number;
  }>;
  collectQueues: () => Promise<{ totalWaiting: number; totalFailed: number; queues: QueueRow[] }>;
  collectDisk: () => Promise<{
    mountpoint: string;
    sizeBytes: number;
    usedBytes: number;
    availBytes: number;
    usePercent: number;
  }>;
}
type QueueRow = { name: string; active: number; waiting: number; delayed: number; failed: number };

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'collector failed';
}

@Injectable()
export class AdminRuntimeHealthService {
  constructor(
    private readonly settingsService: RuntimeHealthAlertSettingsService,
    private readonly collectors: Collectors,
  ) {}

  async collect(): Promise<RuntimeHealthResponseDto> {
    const settings = await this.settingsService.getSettings();
    const [db, redis, queues, disk] = await Promise.allSettled([
      this.collectors.collectDb(),
      this.collectors.collectRedis(),
      this.collectors.collectQueues(),
      this.collectors.collectDisk(),
    ]);

    const database = this.mapDb(db, settings);
    const redisMetric = this.mapRedis(redis, settings);
    const queueMetric = this.mapQueues(queues, settings);
    const diskMetric = this.mapDisk(disk, settings);

    return {
      checkedAt: new Date().toISOString(),
      overall: worstStatus(
        database.status,
        redisMetric.status,
        queueMetric.status,
        diskMetric.status,
      ),
      database,
      redis: redisMetric,
      queues: queueMetric,
      disk: diskMetric,
    };
  }

  private mapDb(
    r: PromiseSettledResult<Awaited<ReturnType<Collectors['collectDb']>>>,
    s: RuntimeHealthAlertSettings,
  ): DbMetric {
    if (r.status === 'rejected') return { status: 'unavailable', error: errorText(r.reason) };
    const v = r.value;
    const pct = (v.connectionsByState.total / v.maxConnections) * 100;
    return {
      status: deriveStatus(pct, s.connWarnPct, s.connCritPct),
      connections: {
        inUse: v.connectionsByState.total,
        max: v.maxConnections,
        headroom: v.maxConnections - v.connectionsByState.total,
        byState: {
          active: v.connectionsByState.active,
          idle: v.connectionsByState.idle,
          idleInTransaction: v.connectionsByState.idleInTransaction,
        },
      },
      databaseSizeBytes: v.databaseSizeBytes,
      longestQuerySeconds: v.longestQuerySeconds,
      cacheHitRatio: v.cacheHitRatio,
      uptimeSeconds: v.uptimeSeconds,
    };
  }

  private mapRedis(
    r: PromiseSettledResult<Awaited<ReturnType<Collectors['collectRedis']>>>,
    s: RuntimeHealthAlertSettings,
  ): RedisMetric {
    if (r.status === 'rejected') return { status: 'unavailable', error: errorText(r.reason) };
    const v = r.value;
    // maxmemory 0 = unlimited → no memory-pressure signal.
    const pct = v.maxMemoryBytes > 0 ? (v.usedMemoryBytes / v.maxMemoryBytes) * 100 : 0;
    return {
      status: deriveStatus(pct, s.redisWarnPct, s.redisCritPct),
      usedMemoryBytes: v.usedMemoryBytes,
      maxMemoryBytes: v.maxMemoryBytes,
      keys: v.keys,
      connectedClients: v.connectedClients,
    };
  }

  private mapQueues(
    r: PromiseSettledResult<Awaited<ReturnType<Collectors['collectQueues']>>>,
    s: RuntimeHealthAlertSettings,
  ): QueueMetric {
    if (r.status === 'rejected') return { status: 'unavailable', error: errorText(r.reason) };
    const v = r.value;
    const backlogStatus = deriveStatus(v.totalWaiting, s.queueBacklogWarn, s.queueBacklogCrit);
    // Any failed job is at least a warning, independent of backlog size.
    const status = v.totalFailed > 0 ? worstStatus(backlogStatus, 'warning') : backlogStatus;
    return { status, totalWaiting: v.totalWaiting, totalFailed: v.totalFailed, queues: v.queues };
  }

  private mapDisk(
    r: PromiseSettledResult<Awaited<ReturnType<Collectors['collectDisk']>>>,
    s: RuntimeHealthAlertSettings,
  ): DiskMetric {
    if (r.status === 'rejected') return { status: 'unavailable', error: errorText(r.reason) };
    const v = r.value;
    return {
      status: deriveStatus(v.usePercent, s.diskWarnPct, s.diskCritPct),
      mountpoint: v.mountpoint,
      sizeBytes: v.sizeBytes,
      usedBytes: v.usedBytes,
      availBytes: v.availBytes,
      usePercent: v.usePercent,
    };
  }
}
```

> `worstStatus` imported from `./runtime-health/status`. The `status.ts` `worstStatus` must accept the 3-value union `'healthy'|'warning'|'critical'` too — it already does (`MetricStatus` superset).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @myclash/api exec vitest run src/modules/admin/runtime-health.service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin/runtime-health.service.ts apps/api/src/modules/admin/runtime-health.service.test.ts
git commit -m "feat(api): runtime-health orchestrator (allSettled + threshold mapping)"
```

---

## Task 12: Controller + module wiring

**Files:**

- Create: `apps/api/src/modules/admin/runtime-health.controller.ts`
- Test: `apps/api/src/modules/admin/runtime-health.controller.test.ts`
- Modify: `apps/api/src/modules/admin/admin.module.ts`

**Interfaces:**

- Consumes: `AdminRuntimeHealthService`, `RuntimeHealthAlertSettingsService`, `UpdateAlertSettingsDto`, `SuperAdminGuard`.
- Produces routes under `admin/system/runtime-health`: `GET /`, `GET /alert-settings`, `PUT /alert-settings`.

- [ ] **Step 1: Write the failing test**

```ts
// runtime-health.controller.test.ts
import { describe, it, expect, vi } from 'vitest';
import { RuntimeHealthAdminController } from './runtime-health.controller';

describe('RuntimeHealthAdminController', () => {
  it('GET / returns the collected snapshot', async () => {
    const health = { collect: vi.fn(async () => ({ overall: 'healthy' })) } as never;
    const settings = {} as never;
    const controller = new RuntimeHealthAdminController(health, settings);
    expect(await controller.getRuntimeHealth()).toEqual({ overall: 'healthy' });
  });

  it('PUT /alert-settings forwards the actor id from the request', async () => {
    const updateSettings = vi.fn(async () => ({ enabled: true }));
    const controller = new RuntimeHealthAdminController({} as never, { updateSettings } as never);
    const req = { actorUserId: 'user-1' } as never;
    await controller.updateAlertSettings({ enabled: true } as never, req);
    expect(updateSettings).toHaveBeenCalledWith({ enabled: true }, 'user-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @myclash/api exec vitest run src/modules/admin/runtime-health.controller.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the controller**

```ts
// runtime-health.controller.ts
import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type {
  RuntimeHealthResponseDto,
  RuntimeHealthAlertSettings,
} from './dto/runtime-health.dto';
import { UpdateAlertSettingsDto } from './dto/runtime-health.dto';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { AdminRuntimeHealthService } from './runtime-health.service';
import { RuntimeHealthAlertSettingsService } from './runtime-health-alert-settings.service';

function getActorId(req: FastifyRequest): string | null {
  return (req as FastifyRequest & { actorUserId?: string }).actorUserId ?? null;
}

@ApiTags('admin')
@ApiCookieAuth('sb-access-token')
@UseGuards(SuperAdminGuard)
@Controller('admin/system/runtime-health')
export class RuntimeHealthAdminController {
  constructor(
    private readonly runtimeHealth: AdminRuntimeHealthService,
    private readonly settings: RuntimeHealthAlertSettingsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Aggregated runtime health (DB, Redis, queues, disk)' })
  getRuntimeHealth(): Promise<RuntimeHealthResponseDto> {
    return this.runtimeHealth.collect();
  }

  @Get('alert-settings')
  @ApiOperation({ summary: 'Get runtime-health alert settings' })
  getAlertSettings(): Promise<RuntimeHealthAlertSettings> {
    return this.settings.getSettings();
  }

  @Put('alert-settings')
  @ApiOperation({ summary: 'Update runtime-health alert settings' })
  updateAlertSettings(
    @Body() dto: UpdateAlertSettingsDto,
    @Req() req: FastifyRequest,
  ): Promise<RuntimeHealthAlertSettings> {
    return this.settings.updateSettings(dto, getActorId(req));
  }
}
```

- [ ] **Step 4: Wire into `admin.module.ts`**

Add imports and register. In the `providers` array, add the settings + orchestrator; the orchestrator needs its collectors + a shared Redis connection built via `useFactory`:

```ts
// imports at top:
import { ConfigService } from '@nestjs/config';
import { RuntimeHealthAdminController } from './runtime-health.controller';
import { AdminRuntimeHealthService } from './runtime-health.service';
import { RuntimeHealthAlertSettingsService } from './runtime-health-alert-settings.service';
import { createRuntimeHealthRedis } from './runtime-health/redis-connection';
import { collectDb } from './runtime-health/db-collector';
import { collectRedis } from './runtime-health/redis-collector';
import { collectQueues } from './runtime-health/queue-collector';
import { collectDisk } from './runtime-health/disk-collector';
```

Add `RuntimeHealthAdminController` to `controllers`. Add to `providers`:

```ts
    RuntimeHealthAlertSettingsService,
    {
      provide: AdminRuntimeHealthService,
      useFactory: (
        settings: RuntimeHealthAlertSettingsService,
        supabase: SupabaseService,
        systemActions: AdminSystemActionsService,
        config: ConfigService,
      ) => {
        const redis = createRuntimeHealthRedis(config);
        return new AdminRuntimeHealthService(settings, {
          collectDb: () => collectDb(supabase),
          collectRedis: () => collectRedis(redis),
          collectQueues: () => collectQueues(redis),
          collectDisk: () => collectDisk(systemActions),
        });
      },
      inject: [
        RuntimeHealthAlertSettingsService,
        SupabaseService,
        AdminSystemActionsService,
        ConfigService,
      ],
    },
```

Add both services to the module `exports` (the monitor worker in WorkersModule injects them via the existing `forwardRef(() => AdminModule)`):

```ts
  exports: [
    SuperAdminGuard,
    AdminFeatureFlagsService,
    AIDataQualityService,
    LeagueScoringSystemsService,
    AdminTlsStatusService,
    AdminRuntimeHealthService,
    RuntimeHealthAlertSettingsService,
  ],
```

- [ ] **Step 5: Run controller test + build**

Run: `pnpm --filter @myclash/api exec vitest run src/modules/admin/runtime-health.controller.test.ts && pnpm --filter @myclash/api build`
Expected: PASS (2 tests) + build succeeds (DI wiring compiles).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/admin/runtime-health.controller.ts apps/api/src/modules/admin/runtime-health.controller.test.ts apps/api/src/modules/admin/admin.module.ts
git commit -m "feat(api): runtime-health controller + admin module wiring"
```

---

## Task 13: Monitor worker + queue registration

**Files:**

- Create: `apps/api/src/workers/runtime-health-monitor.worker.ts`
- Test: `apps/api/src/workers/runtime-health-monitor.worker.test.ts`
- Modify: `apps/api/src/workers/workers.module.ts`

**Interfaces:**

- Consumes: `AdminRuntimeHealthService`, `RuntimeHealthAlertSettingsService`, `MailService`, an ioredis connection (for de-dup state), `ConfigService`.
- Produces: `RuntimeHealthMonitorWorker` — `@Processor('runtime-health-monitor')`, fixed 5-min repeatable tick; public `tick()` returning `{ ran, emailed, criticalKeys }` for tests.

De-dup state in Redis under key `runtime-health:alert-state` as JSON `{ lastCriticalKeys: string[]; lastEmailedAt: number; lastCheckedAt: number }`.

- [ ] **Step 1: Write the failing test**

```ts
// runtime-health-monitor.worker.test.ts
import { describe, it, expect, vi } from 'vitest';
import { RuntimeHealthMonitorWorker } from './runtime-health-monitor.worker';
import { DEFAULT_ALERT_SETTINGS } from '../modules/admin/dto/runtime-health.dto';

function makeDeps(opts: {
  settings?: Partial<typeof DEFAULT_ALERT_SETTINGS>;
  snapshot: Record<string, { status: string }>;
  state?: Record<string, unknown> | null;
}) {
  const store = new Map<string, string>();
  if (opts.state) store.set('runtime-health:alert-state', JSON.stringify(opts.state));
  const redis = {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => void store.set(k, v),
    del: async (k: string) => void store.delete(k),
  };
  const mail = { sendNotification: vi.fn(async () => undefined) };
  const worker = new RuntimeHealthMonitorWorker(
    { add: async () => undefined } as never, // queue (onModuleInit not exercised here)
    { collect: async () => ({ checkedAt: 'now', overall: 'healthy', ...opts.snapshot }) } as never,
    {
      getSettings: async () => ({
        ...DEFAULT_ALERT_SETTINGS,
        recipientEmails: ['ops@x.io'],
        ...opts.settings,
      }),
    } as never,
    mail as never,
    redis as never,
  );
  return { worker, mail, store };
}

const healthy = {
  database: { status: 'healthy' },
  redis: { status: 'healthy' },
  queues: { status: 'healthy' },
  disk: { status: 'healthy' },
};
const dbCritical = { ...healthy, database: { status: 'critical' } };

describe('RuntimeHealthMonitorWorker.tick', () => {
  it('emails on a new critical metric', async () => {
    const { worker, mail } = makeDeps({ snapshot: dbCritical });
    const result = await worker.tick(Date.now());
    expect(result.emailed).toBe(true);
    expect(mail.sendNotification).toHaveBeenCalledOnce();
  });

  it('does not email a warning when level=critical', async () => {
    const warn = { ...healthy, disk: { status: 'warning' } };
    const { worker, mail } = makeDeps({ snapshot: warn });
    const result = await worker.tick(Date.now());
    expect(result.emailed).toBe(false);
    expect(mail.sendNotification).not.toHaveBeenCalled();
  });

  it('suppresses a repeat email within cooldown for the same critical set', async () => {
    const now = Date.now();
    const { worker, mail } = makeDeps({
      snapshot: dbCritical,
      state: {
        lastCriticalKeys: ['database'],
        lastEmailedAt: now - 60_000,
        lastCheckedAt: now - 60_000,
      },
    });
    const result = await worker.tick(now);
    expect(result.emailed).toBe(false);
    expect(mail.sendNotification).not.toHaveBeenCalled();
  });

  it('skips the check when interval has not elapsed', async () => {
    const now = Date.now();
    const { worker } = makeDeps({
      snapshot: dbCritical,
      settings: { checkIntervalMinutes: 15 },
      state: { lastCriticalKeys: [], lastEmailedAt: 0, lastCheckedAt: now - 60_000 },
    });
    const result = await worker.tick(now);
    expect(result.ran).toBe(false);
  });

  it('re-arms (clears state) when everything returns healthy', async () => {
    const now = Date.now();
    const { worker, store } = makeDeps({
      snapshot: healthy,
      state: {
        lastCriticalKeys: ['database'],
        lastEmailedAt: now - 10_000,
        lastCheckedAt: now - 10_000,
      },
    });
    await worker.tick(now);
    const state = JSON.parse(store.get('runtime-health:alert-state') as string);
    expect(state.lastCriticalKeys).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @myclash/api exec vitest run src/workers/runtime-health-monitor.worker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the worker**

```ts
// runtime-health-monitor.worker.ts
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { AdminRuntimeHealthService } from '../modules/admin/runtime-health.service';
import { RuntimeHealthAlertSettingsService } from '../modules/admin/runtime-health-alert-settings.service';
import { MailService } from '../modules/mail/mail.service';
import type {
  MetricStatus,
  RuntimeHealthResponseDto,
} from '../modules/admin/dto/runtime-health.dto';

export const RUNTIME_HEALTH_MONITOR_QUEUE = 'runtime-health-monitor';
export const RUNTIME_HEALTH_MONITOR_JOB = 'tick';
const STATE_KEY = 'runtime-health:alert-state';

interface AlertState {
  lastCriticalKeys: string[];
  lastEmailedAt: number;
  lastCheckedAt: number;
}

const METRIC_KEYS = ['database', 'redis', 'queues', 'disk'] as const;

@Processor(RUNTIME_HEALTH_MONITOR_QUEUE)
@Injectable()
export class RuntimeHealthMonitorWorker extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(RuntimeHealthMonitorWorker.name);

  constructor(
    @InjectQueue(RUNTIME_HEALTH_MONITOR_QUEUE) private readonly queue: Queue,
    private readonly runtimeHealth: AdminRuntimeHealthService,
    private readonly settingsService: RuntimeHealthAlertSettingsService,
    private readonly mail: MailService,
    @Optional() private readonly redis?: Redis,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      RUNTIME_HEALTH_MONITOR_JOB,
      {},
      { repeat: { pattern: '*/5 * * * *' }, jobId: 'runtime-health-monitor-tick' },
    );
    this.logger.log('Runtime health monitor scheduled (every 5 min)');
  }

  async process(_job: Job): Promise<void> {
    await this.tick(Date.now());
  }

  /** Public for tests. Returns whether a full check ran + whether an email was sent. */
  async tick(now: number): Promise<{ ran: boolean; emailed: boolean; criticalKeys: string[] }> {
    const settings = await this.settingsService.getSettings();
    if (!settings.enabled) return { ran: false, emailed: false, criticalKeys: [] };

    const state = await this.readState();
    if (now - state.lastCheckedAt < settings.checkIntervalMinutes * 60_000) {
      return { ran: false, emailed: false, criticalKeys: state.lastCriticalKeys };
    }

    const snapshot = await this.runtimeHealth.collect();
    const criticalKeys = this.keysAtLeast(snapshot, 'critical');
    const warningKeys = this.keysAtLeast(snapshot, 'warning');

    for (const key of warningKeys) {
      this.logger.warn(`Runtime health ${key} = ${statusOf(snapshot, key)}`);
    }

    const alertKeys = settings.emailLevel === 'warning' ? warningKeys : criticalKeys;
    let emailed = false;
    if (alertKeys.length > 0) {
      const isNewSet = !sameSet(alertKeys, state.lastCriticalKeys);
      const cooldownElapsed = now - state.lastEmailedAt >= settings.cooldownMinutes * 60_000;
      if (isNewSet || cooldownElapsed) {
        emailed = await this.sendEmail(alertKeys, snapshot, settings.recipientEmails);
      }
    }

    await this.writeState({
      lastCriticalKeys: alertKeys,
      lastEmailedAt: emailed ? now : alertKeys.length === 0 ? 0 : state.lastEmailedAt,
      lastCheckedAt: now,
    });

    return { ran: true, emailed, criticalKeys };
  }

  private keysAtLeast(snapshot: RuntimeHealthResponseDto, level: 'warning' | 'critical'): string[] {
    const bad: MetricStatus[] = level === 'critical' ? ['critical'] : ['warning', 'critical'];
    return METRIC_KEYS.filter((k) => bad.includes(statusOf(snapshot, k)));
  }

  private async sendEmail(
    keys: string[],
    snapshot: RuntimeHealthResponseDto,
    recipients: string[],
  ): Promise<boolean> {
    if (recipients.length === 0) return false;
    const domain = process.env['DOMAIN'] ?? 'myclash.fr';
    const details = keys.map((k) => `${k}: ${statusOf(snapshot, k)}`).join(' | ');
    try {
      for (const to of recipients) {
        await this.mail.sendNotification({
          to,
          subject: `[MyClash] Runtime health alert (${keys.length})`,
          title: `Runtime health degraded on ${domain}`,
          body: `${keys.length} metric(s) need attention: ${details}. Review https://admin.${domain}/admin/system-versions.`,
          actionUrl: `https://admin.${domain}/admin/system-versions`,
        });
      }
      return true;
    } catch (err) {
      this.logger.warn(
        `Could not send runtime-health alert email: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  private async readState(): Promise<AlertState> {
    const empty: AlertState = { lastCriticalKeys: [], lastEmailedAt: 0, lastCheckedAt: 0 };
    if (!this.redis) return empty;
    const raw = await this.redis.get(STATE_KEY).catch(() => null);
    if (!raw) return empty;
    try {
      return { ...empty, ...(JSON.parse(raw) as AlertState) };
    } catch {
      return empty;
    }
  }

  private async writeState(state: AlertState): Promise<void> {
    if (!this.redis) return;
    await this.redis.set(STATE_KEY, JSON.stringify(state)).catch(() => undefined);
  }
}

function statusOf(snapshot: RuntimeHealthResponseDto, key: string): MetricStatus {
  return (snapshot as unknown as Record<string, { status: MetricStatus }>)[key].status;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
}
```

- [ ] **Step 4: Register the queue + worker in `workers.module.ts`**

Add the queue registration (next to the other `registerQueue` calls) and the worker provider. Import the worker + queue name:

```ts
import {
  RUNTIME_HEALTH_MONITOR_QUEUE,
  RuntimeHealthMonitorWorker,
} from './runtime-health-monitor.worker';
```

In `imports`, add:

```ts
    BullModule.registerQueue({ name: RUNTIME_HEALTH_MONITOR_QUEUE }),
```

The worker needs a self-owned ioredis connection for de-dup state. Register it via `useFactory` (ConfigModule is global) and add both to `providers`:

```ts
// near other imports
import { ConfigService } from '@nestjs/config';
import { createRuntimeHealthRedis } from '../modules/admin/runtime-health/redis-connection';
import { InjectQueue } from '@nestjs/bullmq';
```

```ts
  providers: [
    HemaRatingsSyncWorker,
    EventStatusTickerWorker,
    EventArchiveWorker,
    DataQualityDeterministicWorker,
    TlsCertMonitorWorker,
    {
      provide: RuntimeHealthMonitorWorker,
      useFactory: (
        queue: Queue,
        runtimeHealth: AdminRuntimeHealthService,
        settings: RuntimeHealthAlertSettingsService,
        mail: MailService,
        config: ConfigService,
      ) =>
        new RuntimeHealthMonitorWorker(
          queue, runtimeHealth, settings, mail, createRuntimeHealthRedis(config),
        ),
      inject: [
        getQueueToken(RUNTIME_HEALTH_MONITOR_QUEUE),
        AdminRuntimeHealthService,
        RuntimeHealthAlertSettingsService,
        MailService,
        ConfigService,
      ],
    },
  ],
```

Add the needed imports: `getQueueToken` from `@nestjs/bullmq`, `Queue` from `bullmq`, `AdminRuntimeHealthService` + `RuntimeHealthAlertSettingsService` from `../modules/admin/...`, `MailService` from `../modules/notifications`/mail. AdminModule is already imported via `forwardRef(() => AdminModule)`, and it now exports both services (Task 12).

> Rationale for `useFactory`: the worker's 5th constructor param is the raw ioredis connection (not a Nest-tokened provider), so a plain provider would fail DI on that param — mirrors why `AdminSystemActionsService` uses a factory.

- [ ] **Step 5: Run worker test + build**

Run: `pnpm --filter @myclash/api exec vitest run src/workers/runtime-health-monitor.worker.test.ts && pnpm --filter @myclash/api build`
Expected: PASS (5 tests) + build succeeds (verifies no module cycle regressed and DI compiles).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workers/runtime-health-monitor.worker.ts apps/api/src/workers/runtime-health-monitor.worker.test.ts apps/api/src/workers/workers.module.ts
git commit -m "feat(api): runtime-health monitor worker (fixed tick, email alerts, redis de-dup)"
```

---

## Task 14: i18n keys (EN + FR)

**Files:**

- Modify: the EN + FR locale sources in `packages/i18n/src` (follow the existing `admin.systemVersions.*` structure).

**Interfaces:**

- Produces: keys under `admin.systemVersions.runtimeHealth.*` used by Task 15. Every key must exist in **both** locales.

- [ ] **Step 1: Add the keys**

Add under `admin.systemVersions` (mirror the nesting the file already uses for `tls`). English values:

```
runtimeHealth.title            = "Runtime health"
runtimeHealth.description       = "Live database, Redis, queue and disk status."
runtimeHealth.recheck           = "Refresh"
runtimeHealth.rechecking        = "Refreshing…"
runtimeHealth.checkedAt         = "Checked at"
runtimeHealth.loadError         = "Could not load runtime health."
runtimeHealth.unavailable       = "Unavailable"
runtimeHealth.statuses.healthy  = "Healthy"
runtimeHealth.statuses.warning  = "Warning"
runtimeHealth.statuses.critical = "Critical"
runtimeHealth.statuses.unavailable = "Unavailable"
runtimeHealth.db.title          = "Postgres"
runtimeHealth.db.connections    = "Connections"
runtimeHealth.db.size           = "Database size"
runtimeHealth.db.longestQuery   = "Longest query"
runtimeHealth.db.cacheHit       = "Cache hit"
runtimeHealth.db.uptime         = "Uptime"
runtimeHealth.redis.title       = "Redis"
runtimeHealth.redis.memory      = "Memory"
runtimeHealth.redis.keys        = "Keys"
runtimeHealth.redis.clients     = "Clients"
runtimeHealth.queues.title      = "Queues"
runtimeHealth.queues.waiting    = "Waiting"
runtimeHealth.queues.failed     = "Failed"
runtimeHealth.disk.title        = "Disk"
runtimeHealth.disk.used         = "Used"
runtimeHealth.disk.free         = "Free"
runtimeHealth.settings.title    = "Alert settings"
runtimeHealth.settings.enabled  = "Alerts enabled"
runtimeHealth.settings.recipients = "Recipient emails (comma-separated)"
runtimeHealth.settings.emailLevel = "Email on"
runtimeHealth.settings.levelWarning = "Warning and above"
runtimeHealth.settings.levelCritical = "Critical only"
runtimeHealth.settings.checkInterval = "Check every (minutes)"
runtimeHealth.settings.cooldown = "Email cooldown (minutes)"
runtimeHealth.settings.connThresholds = "Connection warn / crit (%)"
runtimeHealth.settings.redisThresholds = "Redis warn / crit (%)"
runtimeHealth.settings.diskThresholds = "Disk warn / crit (%)"
runtimeHealth.settings.queueThresholds = "Queue backlog warn / crit"
runtimeHealth.settings.save     = "Save settings"
runtimeHealth.settings.saved    = "Alert settings saved."
runtimeHealth.settings.saveError = "Could not save alert settings."
```

French values (unaccented ASCII where the file's convention requires; match the surrounding entries):

```
runtimeHealth.title            = "État du système"
runtimeHealth.description       = "État en direct de la base, Redis, files et disque."
runtimeHealth.recheck           = "Actualiser"
runtimeHealth.rechecking        = "Actualisation…"
runtimeHealth.checkedAt         = "Vérifié à"
runtimeHealth.loadError         = "Impossible de charger l'état du système."
runtimeHealth.unavailable       = "Indisponible"
runtimeHealth.statuses.healthy  = "Sain"
runtimeHealth.statuses.warning  = "Avertissement"
runtimeHealth.statuses.critical = "Critique"
runtimeHealth.statuses.unavailable = "Indisponible"
runtimeHealth.db.title          = "Postgres"
runtimeHealth.db.connections    = "Connexions"
runtimeHealth.db.size           = "Taille de la base"
runtimeHealth.db.longestQuery   = "Requête la plus longue"
runtimeHealth.db.cacheHit       = "Cache"
runtimeHealth.db.uptime         = "Disponibilité"
runtimeHealth.redis.title       = "Redis"
runtimeHealth.redis.memory      = "Mémoire"
runtimeHealth.redis.keys        = "Clés"
runtimeHealth.redis.clients     = "Clients"
runtimeHealth.queues.title      = "Files"
runtimeHealth.queues.waiting    = "En attente"
runtimeHealth.queues.failed     = "Échouées"
runtimeHealth.disk.title        = "Disque"
runtimeHealth.disk.used         = "Utilisé"
runtimeHealth.disk.free         = "Libre"
runtimeHealth.settings.title    = "Paramètres d'alerte"
runtimeHealth.settings.enabled  = "Alertes activées"
runtimeHealth.settings.recipients = "E-mails destinataires (séparés par des virgules)"
runtimeHealth.settings.emailLevel = "E-mail sur"
runtimeHealth.settings.levelWarning = "Avertissement et plus"
runtimeHealth.settings.levelCritical = "Critique uniquement"
runtimeHealth.settings.checkInterval = "Vérifier toutes les (minutes)"
runtimeHealth.settings.cooldown = "Délai entre e-mails (minutes)"
runtimeHealth.settings.connThresholds = "Connexions alerte / critique (%)"
runtimeHealth.settings.redisThresholds = "Redis alerte / critique (%)"
runtimeHealth.settings.diskThresholds = "Disque alerte / critique (%)"
runtimeHealth.settings.queueThresholds = "File d'attente alerte / critique"
runtimeHealth.settings.save     = "Enregistrer"
runtimeHealth.settings.saved    = "Paramètres d'alerte enregistrés."
runtimeHealth.settings.saveError = "Impossible d'enregistrer les paramètres."
```

- [ ] **Step 2: Verify i18n key references + EN/FR parity**

Run: `pnpm --filter @myclash/i18n test`
Expected: PASS — no missing/extra keys across EN and FR.

- [ ] **Step 3: Commit**

```bash
git add packages/i18n
git commit -m "feat(i18n): runtime-health dashboard + alert-settings keys (EN + FR)"
```

---

## Task 15: RuntimeHealthCard + render on page

**Files:**

- Create: `apps/web-admin/app/admin/system-versions/RuntimeHealthCard.tsx`
- Modify: `apps/web-admin/app/admin/system-versions/page.tsx` (render `<RuntimeHealthCard />` under `<TlsCertificatesCard />`)

**Interfaces:**

- Consumes: `useI18n`, `useToast` from `@myclash/ui`, the endpoints `admin/system/runtime-health`, `admin/system/runtime-health/alert-settings`.

- [ ] **Step 1: Write the card component**

```tsx
// RuntimeHealthCard.tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@myclash/ui';
import { useI18n } from '../../../src/i18n/I18nProvider';

type MetricStatus = 'healthy' | 'warning' | 'critical' | 'unavailable';
type Translate = (key: string, params?: Record<string, string | number>) => string;

interface RuntimeHealth {
  checkedAt: string;
  overall: MetricStatus;
  database: {
    status: MetricStatus;
    connections?: { inUse: number; max: number; headroom: number };
    databaseSizeBytes?: number;
    longestQuerySeconds?: number;
    cacheHitRatio?: number;
    uptimeSeconds?: number;
    error?: string;
  };
  redis: {
    status: MetricStatus;
    usedMemoryBytes?: number;
    maxMemoryBytes?: number;
    keys?: number;
    connectedClients?: number;
    error?: string;
  };
  queues: { status: MetricStatus; totalWaiting?: number; totalFailed?: number; error?: string };
  disk: {
    status: MetricStatus;
    usePercent?: number;
    usedBytes?: number;
    availBytes?: number;
    error?: string;
  };
}

interface AlertSettings {
  enabled: boolean;
  recipientEmails: string[];
  emailLevel: 'warning' | 'critical';
  checkIntervalMinutes: number;
  cooldownMinutes: number;
  connWarnPct: number;
  connCritPct: number;
  redisWarnPct: number;
  redisCritPct: number;
  diskWarnPct: number;
  diskCritPct: number;
  queueBacklogWarn: number;
  queueBacklogCrit: number;
  updatedAt: string | null;
}

function statusLabel(t: Translate, s: MetricStatus): string {
  switch (s) {
    case 'healthy':
      return t('admin.systemVersions.runtimeHealth.statuses.healthy');
    case 'warning':
      return t('admin.systemVersions.runtimeHealth.statuses.warning');
    case 'critical':
      return t('admin.systemVersions.runtimeHealth.statuses.critical');
    default:
      return t('admin.systemVersions.runtimeHealth.statuses.unavailable');
  }
}

function statusClasses(s: MetricStatus): string {
  switch (s) {
    case 'healthy':
      return 'bg-success/10 text-success';
    case 'critical':
      return 'bg-danger/10 text-danger';
    case 'unavailable':
      return 'bg-background text-muted';
    default:
      return 'bg-warning/10 text-warning';
  }
}

function StatusPill({ t, status }: { t: Translate; status: MetricStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses(status)}`}
    >
      {statusLabel(t, status)}
    </span>
  );
}

function formatBytes(bytes: number | undefined): string {
  if (bytes == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export function RuntimeHealthCard() {
  const { t } = useI18n();
  const toast = useToast();
  const [health, setHealth] = useState<RuntimeHealth | null>(null);
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(
    ({ signal, refresh = false }: { signal?: AbortSignal; refresh?: boolean } = {}) => {
      if (refresh) setRefreshing(true);
      fetch(`${API}/api/v1/admin/system/runtime-health`, { credentials: 'include', signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(t('admin.systemVersions.runtimeHealth.loadError'));
          setHealth((await res.json()) as RuntimeHealth);
          setError(null);
        })
        .catch((err: unknown) => {
          if (!(err instanceof DOMException && err.name === 'AbortError')) {
            setError(
              err instanceof Error
                ? err.message
                : t('admin.systemVersions.runtimeHealth.loadError'),
            );
          }
        })
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
    },
    [t],
  );

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load({ signal: controller.signal }));
    fetch(`${API}/api/v1/admin/system/runtime-health/alert-settings`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok) setSettings((await res.json()) as AlertSettings);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [load]);

  async function saveSettings() {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/v1/admin/system/runtime-health/alert-settings`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      setSettings((await res.json()) as AlertSettings);
      toast.success(t('admin.systemVersions.runtimeHealth.settings.saved'));
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t('admin.systemVersions.runtimeHealth.settings.saveError'),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-background flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
            {t('admin.systemVersions.runtimeHealth.title')}
          </h2>
          {health && <StatusPill t={t} status={health.overall} />}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background"
          >
            {t('admin.systemVersions.runtimeHealth.settings.title')}
          </button>
          <button
            type="button"
            onClick={() => load({ refresh: true })}
            disabled={loading || refreshing}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground-secondary hover:bg-background disabled:opacity-50"
          >
            {refreshing
              ? t('admin.systemVersions.runtimeHealth.rechecking')
              : t('admin.systemVersions.runtimeHealth.recheck')}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-danger/10 border-b border-danger/30 text-danger px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="px-4 py-4 text-sm text-muted">{t('admin.systemVersions.loading')}</p>
      ) : health ? (
        <div className="grid gap-px bg-border sm:grid-cols-2">
          <MetricTile
            t={t}
            status={health.database.status}
            title={t('admin.systemVersions.runtimeHealth.db.title')}
            rows={
              health.database.status === 'unavailable'
                ? [
                    [
                      t('admin.systemVersions.runtimeHealth.unavailable'),
                      health.database.error ?? '—',
                    ],
                  ]
                : [
                    [
                      t('admin.systemVersions.runtimeHealth.db.connections'),
                      `${health.database.connections?.inUse} / ${health.database.connections?.max}`,
                    ],
                    [
                      t('admin.systemVersions.runtimeHealth.db.size'),
                      formatBytes(health.database.databaseSizeBytes),
                    ],
                    [
                      t('admin.systemVersions.runtimeHealth.db.longestQuery'),
                      `${health.database.longestQuerySeconds ?? 0} s`,
                    ],
                    [
                      t('admin.systemVersions.runtimeHealth.db.cacheHit'),
                      `${((health.database.cacheHitRatio ?? 0) * 100).toFixed(1)} %`,
                    ],
                  ]
            }
          />
          <MetricTile
            t={t}
            status={health.redis.status}
            title={t('admin.systemVersions.runtimeHealth.redis.title')}
            rows={
              health.redis.status === 'unavailable'
                ? [[t('admin.systemVersions.runtimeHealth.unavailable'), health.redis.error ?? '—']]
                : [
                    [
                      t('admin.systemVersions.runtimeHealth.redis.memory'),
                      `${formatBytes(health.redis.usedMemoryBytes)} / ${formatBytes(health.redis.maxMemoryBytes)}`,
                    ],
                    [
                      t('admin.systemVersions.runtimeHealth.redis.keys'),
                      String(health.redis.keys ?? 0),
                    ],
                    [
                      t('admin.systemVersions.runtimeHealth.redis.clients'),
                      String(health.redis.connectedClients ?? 0),
                    ],
                  ]
            }
          />
          <MetricTile
            t={t}
            status={health.queues.status}
            title={t('admin.systemVersions.runtimeHealth.queues.title')}
            rows={
              health.queues.status === 'unavailable'
                ? [
                    [
                      t('admin.systemVersions.runtimeHealth.unavailable'),
                      health.queues.error ?? '—',
                    ],
                  ]
                : [
                    [
                      t('admin.systemVersions.runtimeHealth.queues.waiting'),
                      String(health.queues.totalWaiting ?? 0),
                    ],
                    [
                      t('admin.systemVersions.runtimeHealth.queues.failed'),
                      String(health.queues.totalFailed ?? 0),
                    ],
                  ]
            }
          />
          <MetricTile
            t={t}
            status={health.disk.status}
            title={t('admin.systemVersions.runtimeHealth.disk.title')}
            rows={
              health.disk.status === 'unavailable'
                ? [[t('admin.systemVersions.runtimeHealth.unavailable'), health.disk.error ?? '—']]
                : [
                    [
                      t('admin.systemVersions.runtimeHealth.disk.used'),
                      `${health.disk.usePercent ?? 0} %`,
                    ],
                    [
                      t('admin.systemVersions.runtimeHealth.disk.free'),
                      formatBytes(health.disk.availBytes),
                    ],
                  ]
            }
          />
        </div>
      ) : null}

      {showSettings && settings && (
        <SettingsForm
          t={t}
          settings={settings}
          setSettings={setSettings}
          saving={saving}
          onSave={() => void saveSettings()}
        />
      )}
    </section>
  );
}

function MetricTile({
  t,
  title,
  status,
  rows,
}: {
  t: Translate;
  title: string;
  status: MetricStatus;
  rows: Array<[string, string]>;
}) {
  return (
    <div className="bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold text-sm text-foreground">{title}</h3>
        <StatusPill t={t} status={status} />
      </div>
      <dl className="space-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between text-xs">
            <dt className="text-muted">{label}</dt>
            <dd className="font-mono text-foreground-secondary">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SettingsForm({
  t,
  settings,
  setSettings,
  saving,
  onSave,
}: {
  t: Translate;
  settings: AlertSettings;
  setSettings: (s: AlertSettings) => void;
  saving: boolean;
  onSave: () => void;
}) {
  const inputClass =
    'rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground w-full';
  const num = (key: keyof AlertSettings) => (
    <input
      type="number"
      className={inputClass}
      value={settings[key] as number}
      onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })}
    />
  );
  return (
    <div className="border-t border-border p-4 space-y-3 bg-background">
      <label className="flex items-center gap-2 text-sm text-foreground-secondary">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
        />
        {t('admin.systemVersions.runtimeHealth.settings.enabled')}
      </label>

      <div>
        <span className="block text-xs text-muted mb-1">
          {t('admin.systemVersions.runtimeHealth.settings.recipients')}
        </span>
        <input
          type="text"
          className={inputClass}
          value={settings.recipientEmails.join(', ')}
          onChange={(e) =>
            setSettings({
              ...settings,
              recipientEmails: e.target.value
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean),
            })
          }
        />
      </div>

      <div>
        <span className="block text-xs text-muted mb-1">
          {t('admin.systemVersions.runtimeHealth.settings.emailLevel')}
        </span>
        <select
          className={inputClass}
          value={settings.emailLevel}
          onChange={(e) =>
            setSettings({ ...settings, emailLevel: e.target.value as 'warning' | 'critical' })
          }
        >
          <option value="warning">
            {t('admin.systemVersions.runtimeHealth.settings.levelWarning')}
          </option>
          <option value="critical">
            {t('admin.systemVersions.runtimeHealth.settings.levelCritical')}
          </option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-muted">
          {t('admin.systemVersions.runtimeHealth.settings.checkInterval')}
          {num('checkIntervalMinutes')}
        </label>
        <label className="text-xs text-muted">
          {t('admin.systemVersions.runtimeHealth.settings.cooldown')}
          {num('cooldownMinutes')}
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className="block text-xs text-muted mb-1">
            {t('admin.systemVersions.runtimeHealth.settings.connThresholds')}
          </span>
          <div className="flex gap-2">
            {num('connWarnPct')}
            {num('connCritPct')}
          </div>
        </div>
        <div>
          <span className="block text-xs text-muted mb-1">
            {t('admin.systemVersions.runtimeHealth.settings.redisThresholds')}
          </span>
          <div className="flex gap-2">
            {num('redisWarnPct')}
            {num('redisCritPct')}
          </div>
        </div>
        <div>
          <span className="block text-xs text-muted mb-1">
            {t('admin.systemVersions.runtimeHealth.settings.diskThresholds')}
          </span>
          <div className="flex gap-2">
            {num('diskWarnPct')}
            {num('diskCritPct')}
          </div>
        </div>
        <div>
          <span className="block text-xs text-muted mb-1">
            {t('admin.systemVersions.runtimeHealth.settings.queueThresholds')}
          </span>
          <div className="flex gap-2">
            {num('queueBacklogWarn')}
            {num('queueBacklogCrit')}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {t('admin.systemVersions.runtimeHealth.settings.save')}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Render it on the page**

In `apps/web-admin/app/admin/system-versions/page.tsx`, import and render below the TLS card:

```tsx
import { RuntimeHealthCard } from './RuntimeHealthCard';
```

Change the existing TLS block:

```tsx
          <div className="mt-5">
            <TlsCertificatesCard />
          </div>
          <div className="mt-5">
            <RuntimeHealthCard />
          </div>
```

- [ ] **Step 3: Typecheck + lint the admin app**

Run: `pnpm --filter @myclash/web-admin exec tsc --noEmit && pnpm --filter @myclash/web-admin lint`
Expected: PASS — no type errors, no `no-literal-string` / set-state-in-effect violations (all display text goes through `t()`; fetches are in effects/handlers, not render).

- [ ] **Step 4: Commit**

```bash
git add apps/web-admin/app/admin/system-versions/RuntimeHealthCard.tsx apps/web-admin/app/admin/system-versions/page.tsx
git commit -m "feat(web-admin): runtime health card + alert-settings form on system page"
```

---

## Task 16: Full-suite verification + module-graph guard

**Files:** none (verification only).

- [ ] **Step 1: API build + full test suite**

Run: `pnpm --filter @myclash/api build && pnpm --filter @myclash/api test`
Expected: build clean; all tests green (incl. `module-graph.test.ts` — the new worker→AdminModule edge uses the existing `forwardRef`, so no cycle).

- [ ] **Step 2: Lint + i18n + db replay**

Run: `pnpm --filter @myclash/api lint && pnpm --filter @myclash/i18n test && pnpm --filter @myclash/db review && pnpm --filter @myclash/db replay`
Expected: all PASS.

- [ ] **Step 3: Preview-boot the module graph (optional, high-value)**

Boot the compiled AppModule in preview to confirm no `UndefinedModuleException` from the new WorkersModule↔AdminModule wiring (uses `NestFactory.createApplicationContext(AppModule, { preview: true })` against `apps/api/dist`). Expected: resolves cleanly.

- [ ] **Step 4: Commit any fixups, then done**

```bash
git add -A
git commit -m "chore: runtime-health dashboard verification fixups" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:** Aggregated endpoint + 4 collectors (Tasks 5–7, 9, 11) ✓ · DB RPC service_role-only (Task 1) ✓ · settings table RLS deny-all + seed (Task 2) ✓ · UI-editable settings service + endpoints + form (Tasks 10, 12, 15) ✓ · monitor worker with email + Redis de-dup + cooldown + re-arm + interval-skip (Task 13) ✓ · ops-runner read-only `GET /disk` (Task 8) ✓ · card under TLS card (Task 15) ✓ · thresholds display + drive alerts (Tasks 4, 11, 13) ✓ · i18n EN+FR (Task 14) ✓ · tests per unit + degradation + guard/RLS via migration (all tasks) ✓ · verification gates (Task 16) ✓.

**Type consistency:** `MetricStatus` defined in Task 3, consumed in 4/11/13/15. Collector return shapes in Tasks 5–9 match the `Collectors` interface consumed in Task 11. `RuntimeHealthAlertSettings` (camelCase) is the single settings shape across Tasks 3/10/12/13/15; snake_case only crosses the DB boundary inside Task 10's `mergeRow`/upsert. `getDiskUsage`/`DiskUsageResult` defined in Task 9, consumed in Task 9's collector + Task 11. Queue names list defined in Task 6, reused by the worker's queue (Task 13).

**Placeholder scan:** No TBD/TODO; every code step has full code; the one throwaway fixture line in Task 8 Step 1 is explicitly flagged for deletion.

**Known follow-ups (out of scope):** per-queue drill-down UI; feeding alerts into the platform-log audit store; historical charts.
