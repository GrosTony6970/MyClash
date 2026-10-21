# Database Review

Phase 4 production-readiness review. Scope fixed 2026-05-12; **content maintained since — see
`git log` for the true last edit rather than trusting a date in prose.**

## Status

**Pass with known issues.** Repo-local database gates and fixtures are in place. Live PITR/provider evidence and a timed restore drill still require the production or staging VPS and are tracked as owner-side production-review evidence.

## Automated Evidence

- `pnpm db:review` checks migration ordering, required Phase 4 artifacts, RLS coverage for table declarations, critical extensions, and idempotence/index-review warnings.
- `pnpm db:perf:fixture` verifies the committed synthetic event fixture and EXPLAIN workload are in sync with the generator.
- `pnpm db:migrations:replay` replays every migration into a disposable database when `DATABASE_URL` is explicitly provided. See [Migration replay on a vanilla Postgres](#migration-replay-on-a-vanilla-postgres) for the Supabase-compatibility baseline it applies first.
- `pnpm db:rls-probe` reads that replay as the anonymous visitor, after seeding `packages/db/fixtures/rls-probe-seed.sql` (a platform role, a draft Event, a draft Tournament under a published Event, referee assignments in a draft Tournament, a private League, a club's own penalty and scoring rulesets, an Exchange, a Match event, a card and a voided forfeit on a public bout). It fails on any read error ("stack depth limit exceeded" was every anonymous read before 0201), on a private seeded row anon can see or a public one it cannot, and on a `public` view without `security_invoker`. It also calls `account_emails` (0217) as anon and as a signed-in user, who must both be refused on privilege, and as the service role, which must get the address of each account it asks for that has one, and of no other account (the seed holds a bystander). It writes a second roster row for one account at one Event, by an insert and by a claim, and both must be refused (0220), while an unheld row, another account's row and the same account's row at another Event must pass (`scripts/lib/roster-holder-probe.mjs`). It moves Events as the seeded organisation admin, signed in, with the RLS helpers made SECURITY DEFINER inside the rolled-back savepoint (their signed-in loop would stop the write before the trigger): an Event whose Tournament names the club's own private ruleset is refused the move to another club by the 0224 trigger with its own message, and so is one naming a ruleset of the new club that is archived, a draft, the platform's draft, or a row of the new club marked `is_system`; an Event whose Tournaments name a built-in, a ruleset the club shares and the new club's own live one moves; the service role is exempt and a role made for the probe is not; a ruleset row of the club's own taking another owner's code (a decoy, or a built-in's) is refused by 0224's unique code; and it reads the functions' SECURITY DEFINER and EXECUTE grants and the Event trigger's state off the catalogue, and that 0224's two Tournament triggers and their function stay dropped (0233: only the API writes a Tournament, which the API-only writes check holds) (`scripts/lib/ruleset-pair-probe.mjs`). Check 16 (0240, 0241, 0242, `scripts/lib/fighter-status-probe.mjs`) settles a seeded Fighter through `settle_fighter_status` with each cause alone and in pairs (forfeits that withdrew or disqualified, "disqualify after N" with and without a record under a withdrawal or under the out status (the hand, a card, a review), black cards under each card rule, a confirmed review standing on its answered cards), the hand doors' row writes, the refusal of a changed entry, and each status CHECK by name; it reads the function's EXECUTE grants, its volatility and its row lock off the catalogue, since one rolled-back transaction cannot show a second settle waiting. Signed-in reads are not probed: their helper loop is latent (ruling 111a).
- `pnpm db:merge-probe` runs the fighter merge and its revert (`merge_fighters`, `revert_fighter_merge`, migration 0212, ruling 133) as the service role on that replay, over seeded profiles, in one transaction it always rolls back: what moves, what stays, the stricter privacy answers, the account link, every refusal, and a failing last step that leaves nothing moved.
- `pnpm db:cascade-probe` (0237, rulings 91-92) COMMITS `packages/db/fixtures/cascade-probe-seed.sql` (a club with a played bout, a forfeit, a referee, a skill two slots list and a compensation plan), so it runs only with `CASCADE_PROBE_DISPOSABLE=1`. It fails on any key a cascade can trip by trigger order (any RESTRICT key, and any immediate NO ACTION key whose child and parent die by cascade from one ancestor), checks that an Event, a Tournament, a phase and a club delete, that deleting a registration a bout names, a person with a registration, a copy a bout holds, a skill slots list or a plan an Event uses is still refused (23503), and deletes its seed by the club delete it tests. Committed rows, because Postgres re-checks every key of a row written by the same transaction. The RLS probe's API-only writes include an Event's DELETE (ruling 93) and a club's DELETE (ruling 95), each alone, and since 0238 the five Match tables (`matches`, `exchanges`, `match_events`, `match_penalties`, `match_forfeits`, ruling 96) and the DELETE alone of a phase and of a Registration (rulings 99, 100), which take Match rows by cascade; for every entry it also reads that anon holds none of the refused grants. CI runs the replay and the three probes in the `Database replay` job on Postgres 17, the cascade probe last.
- `pnpm db:perf:explain` runs the committed EXPLAIN workload against a disposable database after applying `packages/db/fixtures/phase4_synthetic.sql`. Build that database with `pnpm db:migrations:replay` first.
- `pnpm --filter @myclash/db test` covers RLS logic, including recent service-role-only tables.
- `pnpm db:realtime-bindings` fails when a table named in any realtime binding is not in the publication — one unpublished table permanently CHANNEL_ERRORs the whole channel. It runs in CI between `db:review` and `db:perf:fixture`.

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
the three roles, a minimal `auth.users`, an `auth.role()` shim (migration
`0002` self-creates the `auth` schema + `auth.uid()`/`auth.jwt()`), and the
default privileges the Supabase image gives anon/authenticated/service_role. The
replay script applies it automatically before the first migration. Every statement
is idempotent (roles created only when absent, `auth.role()` created only when the
real Supabase function is missing, the grants are the image's own), so pointing the
replay at a stock Supabase database is a no-op; on one whose default privileges
were tightened, the grants would widen them again.

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

- CI replays every migration on a fresh Postgres 17 (`Database replay` job). EXPLAIN timings and restore-drill measurements still require a disposable local/staging database or VPS access; the repo provides commands and fixtures but cannot collect production evidence by itself.
- PITR is not proven in repo-local automation. Owner must verify provider/VPS strategy before production sign-off.
- Some older indexes are not idempotent by declaration. Fresh replay is the source of truth; re-running individual old migrations remains unsupported.
