# Database Review

Phase 4 production-readiness review, last updated 2026-05-12.

## Status

**Pass with known issues.** Repo-local database gates and fixtures are in place. Live PITR/provider evidence and a timed restore drill still require the production or staging VPS and are tracked as owner-side production-review evidence.

## Automated Evidence

- `pnpm db:review` checks migration ordering, required Phase 4 artifacts, RLS coverage for table declarations, critical extensions, and idempotence/index-review warnings.
- `pnpm db:perf:fixture` verifies the committed synthetic event fixture and EXPLAIN workload are in sync with the generator.
- `pnpm db:migrations:replay` replays every migration into a disposable database when `DATABASE_URL` is explicitly provided. See [Migration replay on a vanilla Postgres](#migration-replay-on-a-vanilla-postgres) for the Supabase-compatibility baseline it applies first.
- `pnpm db:perf:explain` runs the committed EXPLAIN workload against a disposable database after applying `packages/db/fixtures/phase4_synthetic.sql`.
- `pnpm --filter @myclash/db test` covers RLS logic, including recent service-role-only tables.

## Migration replay on a vanilla Postgres

`pnpm db:migrations:replay` is meant to run against a **disposable** database, and
in production that database is the Supabase Postgres image — which ships roles
(`anon`, `authenticated`, `service_role`), an `auth` schema with `auth.users` and
the `auth.uid()` / `auth.jwt()` / `auth.role()` helpers, and the extensions the
migrations rely on. A plain `postgres:17` container (production runs Postgres 17)
has none of the roles or `auth.users`, so the replay would die at migration
`0011` (the first
`CREATE POLICY ... TO service_role`) and later at the first
`REFERENCES auth.users(id)`.

`packages/db/fixtures/supabase-baseline.sql` supplies that missing baseline —
the three roles, a minimal `auth.users`, and an `auth.role()` shim (migration
`0002` self-creates the `auth` schema + `auth.uid()`/`auth.jwt()`). The replay
script applies it automatically before the first migration. Every statement is
idempotent and non-destructive (roles created only when absent, `auth.role()`
created only when the real Supabase function is missing), so pointing the replay
at a real Supabase database is a harmless no-op.

Full run against a throwaway container:

```bash
docker run -d --name myclash-replay-pg17 \
  -e POSTGRES_PASSWORD=dev-password -e POSTGRES_DB=myclash_replay \
  -p 55432:5432 postgres:17

DATABASE_URL="postgres://postgres:dev-password@localhost:55432/myclash_replay" \
  pnpm db:migrations:replay

docker rm -f myclash-replay-pg17
```

Each run needs a **fresh** database — the migrations are not re-runnable in place
(older ones are not fully idempotent), so recreate the container (or drop/create
the database) between attempts rather than replaying twice into the same one.

## Rollback And Backup

Current rollback contract: **PITR/restore, not down migrations**.

- Production deploys take a pre-deploy `pg_dump`.
- `infra/scripts/backup.sh` creates nightly DB dumps (integrity-checked) and archives the Supabase storage volume, and uploads to Scaleway S3 when `BACKUP_SCW_*` variables are configured. Retention is count-based, enforced by the ops-runner after each run and configurable from `/admin/backups` (`BACKUP_RETENTION_DAYS` is deprecated/unused).
- `infra/scripts/restore.sh` restores DB and optionally the storage volume from local or S3 backups. It stops every DB-connected service, force-drops and recreates the database, replays the dump in a single transaction with `ON_ERROR_STOP` (so a corrupt/partial dump rolls back instead of half-restoring), then validates schema coherence (`auth`/`storage`/`public` schemas + `auth.users`) before declaring success. See `docs/DISASTER_RECOVERY.md`.
- PITR must be enabled or otherwise documented before final production sign-off. If the self-hosted VPS stack does not provide PITR, the accepted v1 fallback is frequent dumps plus off-site copy, documented as a residual risk.

Restore drill evidence to collect on staging/VPS:

1. Run `infra/scripts/backup.sh` and record the generated timestamp.
2. Run `MYCLASH_RESTORE_CONFIRM=1 infra/scripts/restore.sh backups/nightly/db-<timestamp>.sql.gz --db-only`.
3. Record start/end time, DB size, storage inclusion, and whether service health checks recovered.
4. Compare observed restore time to the v1 RTO target of 30 minutes.

## Performance And Index Review

Synthetic fixture: `packages/db/fixtures/phase4_synthetic.sql`

EXPLAIN workload: `packages/db/fixtures/phase4_explain.sql`

Covered read paths:

- Public event lookup.
- Event roster/person listing.
- My Schedule style match lookup.
- Live lice queue.
- Pool members and bracket state.
- Audit log lookup.
- Tournament query match view.

`0034_pg_stat_statements.sql` enables `pg_stat_statements` where the Supabase Postgres image/runtime supports it. If the extension requires `shared_preload_libraries` on the target VPS, enable it in infrastructure configuration before relying on top-N query evidence.

Known idempotence warnings remain for older migrations that created some tables or indexes without `IF NOT EXISTS`; these are not deployment blockers for fresh migration replay but should be normalized if those migrations are ever made re-runnable.

## Connection Pooling

Chosen v1 default: no PgBouncer yet.

- The API holds **no** direct Postgres pool: it reaches the database over HTTP through
  PostgREST (`SupabaseService`). This line used to describe a `postgres.js` pool with `max: 10`
  in `packages/db/src/client.ts` — that factory had zero callers and was deleted in 2026-08.
- The one direct `postgres.js` connection is `packages/db/scripts/migrate.mjs`, which runs as a
  one-off container during deploy and exits.
- Supabase Auth/Realtime/Storage/PostgREST connect directly to the internal Postgres service.
- API and worker containers should stay within safe connection counts on the single-VPS v1 deployment.

Trigger to add PgBouncer: sustained `pg_stat_activity` usage above 60% of Postgres `max_connections`, connection exhaustion errors, or adding more horizontally scaled API/worker replicas.

## Known Issues

- Live migration replay, EXPLAIN timings, and restore-drill measurements require a disposable local/staging database or VPS access; the repo provides commands and fixtures but cannot collect production evidence by itself.
- PITR is not proven in repo-local automation. Owner must verify provider/VPS strategy before production sign-off.
- Some older indexes are not idempotent by declaration. Fresh replay is the source of truth; re-running individual old migrations remains unsupported.
