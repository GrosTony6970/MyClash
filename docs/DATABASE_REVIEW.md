# Database Review

Phase 4 production-readiness review. Scope fixed 2026-05-12; **content maintained since — see
`git log` for the true last edit rather than trusting a date in prose.**

## Status

**Pass with known issues.** Repo-local database gates and fixtures are in place. Live PITR/provider evidence and a timed restore drill still require the production or staging VPS and are tracked as owner-side production-review evidence.

## Automated Evidence

- `pnpm db:review` checks migration ordering, required Phase 4 artifacts, RLS coverage for table declarations, critical extensions, and idempotence/index-review warnings.
- `pnpm db:perf:fixture` verifies the committed synthetic event fixture and EXPLAIN workload are in sync with the generator.
- `pnpm db:migrations:replay` replays every migration into a disposable database when `DATABASE_URL` is explicitly provided. See [Migration replay on a vanilla Postgres](#migration-replay-on-a-vanilla-postgres) for the Supabase-compatibility baseline it applies first.
- `pnpm db:rls-probe` reads that replay as the anonymous visitor, after seeding `packages/db/fixtures/rls-probe-seed.sql` (a platform role, a draft Event, a draft Tournament under a published Event, referee assignments in a draft Tournament, a private League, a club's own penalty and scoring rulesets, an Exchange, a Match event, a card, a protest and a voided forfeit on a public bout). It fails on any read error ("stack depth limit exceeded" was every anonymous read before 0201), on a private seeded row anon can see or a public one it cannot, and on a `public` view without `security_invoker`. It also calls `account_emails` (0217) as anon and as a signed-in user, who must both be refused on privilege, and as the service role, which must get the address of each account it asks for that has one, and of no other account (the seed holds a bystander). It writes a second roster row for one account at one Event, by an insert and by a claim, and both must be refused (0220), while an unheld row, another account's row and the same account's row at another Event must pass; a row saved as claimed with no holder, and a held row saved as unclaimed, must be refused too (0262) (`scripts/lib/roster-holder-probe.mjs`). Check 10 (`scripts/lib/ruleset-pair-probe.mjs`) refuses, by 0224's unique code, a ruleset row of the club's own taking another owner's code (a decoy, or a built-in's), and reads off the catalogue that every 0224 trigger and function stays dropped: the two Tournament triggers and their function (0233), the Event-move trigger, its function and `ruleset_code_offered_to` (0247, ruling 229). Check 20 (0247, `scripts/lib/web-write-doors-probe.mjs`) reads the whole catalogue: no relation of `public` gives `anon` or `authenticated` INSERT or UPDATE on any column, or DELETE; no policy of `public` lets either write; and a table made inside the probe's savepoint by the owner of `public.events` (the role the migrations ran as) gives them neither. Check 16 (0240, 0241, 0242, `scripts/lib/fighter-status-probe.mjs`) settles a seeded Fighter through `settle_fighter_status` with each cause alone and in pairs (forfeits that withdrew or disqualified, "disqualify after N" with and without a record under a withdrawal or under the out status (the hand, a card, a review), black cards under each card rule, a confirmed review standing on its answered cards), the hand doors' row writes, the refusal of a changed entry, and each status CHECK by name; it reads the function's EXECUTE grants, its volatility and its row lock off the catalogue, since one rolled-back transaction cannot show a second settle waiting. Check 17 (0243, 0244, `scripts/lib/swiss-probe.mjs`, `scripts/lib/swiss-status-probe.mjs`) seeds a Swiss phase and its entrants inside its savepoint and calls the Swiss functions: `swiss_commit_round` writes a round and its bouts in one step (a bout that fails leaves no round), answers "exists" and "stale" (a round added, a Fighter withdrawn or put back since the plan); `swiss_withdraw` counts the rounds written before it and keeps its kind; `swiss_phase_over` (a resumed phase, a last round fought, one holding only a bye); `swiss_put_back` by the status (kept by a later round, a hand withdrawal, a phase over, a Fighter out) and by hand (the rounds missed, `fighter_out`); `swiss_delete_last_round` (its refusals, a voided round, the missed round forgotten); each CHECK by name; the grants, the volatility, each writer's phase lock as its first statement and `swiss_phase_over`'s lack of one. Check 21 (0272, rulings 820 and 823, `scripts/lib/global-persons-door-probe.mjs`) seeds a claimed fighter listed in the directory, with an address and a date of birth, and reads them as anon and as a signed-in user: both must be refused on privilege (before 0272, anon got both columns). It reads that neither web role holds SELECT on any column of `global_persons`, that no policy is left on it, and that `lookup_global_persons` is closed to both and to PUBLIC while the service role (the API's fuzzy directory search) still calls it and gets an answer. Check 1 then guards the three referee tables whose policies named `global_persons`: a policy subquery needs SELECT on what it names, so a branch left behind would fail every anonymous read of its table. Check 22 (0273, rulings 821 and 822, `scripts/lib/signed-in-reads-probe.mjs`) reads the whole catalogue with no table list: `authenticated` holds SELECT on no relation of `public`, no default privilege gives it one on a new table (a table made inside the probe's savepoint proves it), and no policy serves it alone; then it reads every relation as three signed-in accounts (a stranger, the club's admin, the super admin), and each read must be refused on privilege (42501), never answered and never "stack depth limit exceeded". No read as `authenticated` reaches an RLS helper any more (ruling 111a left their loop): one signed-in socket on the live channel used to stop every viewer's updates, because the channel checks every subscriber in one shared poll. Since 0274 four of the five helper loops have no way back; the last (`can_manage_penalty_ruleset` over `penalty_rulesets`) needs a token with the anon role and an account id, which needs the JWT secret. Check 23 (0274, rulings 825 and 835, `scripts/lib/dead-policy-probe.mjs`) reads the whole catalogue: every rule in `public` is a read rule, and every role it names (PUBLIC is reached as anon) holds SELECT on a column of its table and does not bypass RLS, so no rule names a role that can never run it; `is_platform_staff`, whose only caller went, stays gone. A rule `TO public` whose every branch needs an account is not caught there: 0274's 38 are pinned by name in `packages/db/test/dead-read-rules-dropped.test.ts`. Check 24 (0275, ruling 826, `scripts/lib/function-door-probe.mjs`) reads the function list as checks 20 and 22 read the tables, with no list of its own: anon runs exactly the helpers its read rules need (the functions a rule depends on, closed over what they call), `authenticated` and PUBLIC run no function of `public`, no SECURITY DEFINER function is open to any of them, a function or sequence made now starts closed to all three, the service role runs every function, and no sequence is open to a web role. Then, without that derivation, it takes each of anon's functions away in turn and reads every relation as anon on the seed: some read must fail on it, so a grant no read needs (a function named in a helper's comment, say) is caught. Check 21 reads every overload of `lookup_global_persons`. A new read rule that calls a NEW helper must `grant execute on function … to anon`; a view anon reads may not call a `public` function without a ruling (none of ours does). A function or extension made by `postgres` or `supabase_admin` outside `public` and `realtime` no longer gets PUBLIC's EXECUTE (0275's global default): it gets only what its schema's own default privileges name, which is its owner alone in a new schema, so grant the service role by name; ruling 838 keeps PUBLIC's default in `realtime` for Realtime's own functions, and CI's socket check reads them after Realtime boots.
- `pnpm db:merge-probe` runs the fighter merge and its revert (`merge_fighters`, `revert_fighter_merge`, migration 0212, ruling 133) as the service role on that replay, over seeded profiles, in one transaction it always rolls back: what moves, what stays, the stricter privacy answers, the account link, every refusal, and a failing last step that leaves nothing moved.
- `pnpm db:cascade-probe` (0237, rulings 91-92) COMMITS `packages/db/fixtures/cascade-probe-seed.sql` (a club with a played bout, a forfeit, a referee, a skill two slots list and a compensation plan), so it runs only with `CASCADE_PROBE_DISPOSABLE=1`. It fails on any key a cascade can trip by trigger order (any RESTRICT key, and any immediate NO ACTION key whose child and parent die by cascade from one ancestor), checks that an Event, a Tournament, a phase and a club delete, that deleting a registration a bout names, a person with a registration, a copy a bout holds, a skill slots list or a plan an Event uses is still refused (23503), and deletes its seed by the club delete it tests. Committed rows, because Postgres re-checks every key of a row written by the same transaction. The RLS probe's API-only writes include Events and clubs (rulings 93, 95; 0237, then 0247 for their inserts and updates), the six Match tables (`matches`, `exchanges`, `match_events`, `match_penalties`, `match_forfeits`, ruling 96, 0238; `match_protests`, 0276), and phases and Registrations (rulings 99, 100, 0238, then 0247), whose deletes take Match rows by cascade; for every entry it also reads that anon holds none of the refused grants. CI runs the replay and the five probes in the `Database replay` job on Postgres 17 (`db:rls-probe`, `db:merge-probe`, `db:fightbook-probe`, `db:fightbook-race-probe`, then the cascade probe last). The FightBook probe runs every FightBook function on seeded profiles; the race probe (`RACE_PROBE_DISPOSABLE=1`, it commits rows, 0270) runs two picks or two scans AT ONCE on two connections with the overlap forced (`docs/ARCHITECTURE.md` §11septies.3).
- `pnpm db:perf:explain` runs the committed EXPLAIN workload against a disposable database after applying `packages/db/fixtures/phase4_synthetic.sql`. Build that database with `pnpm db:migrations:replay` first.
- `pnpm --filter @myclash/db test` reads the migrations as text and pins what each leaves behind (a dropped policy never created again, a grant never given back, the last word on a CHECK). What a role can actually read is the RLS probe's job, on a replay.
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
- The direct `postgres.js` connections are deploy's one-off containers, which exit:
  `packages/db/scripts/migrate.mjs`, and `scripts/bootstrap-super-admin.mjs` and
  `scripts/create-demo-org.mjs` (through `createRunSql`). They get `DATABASE_URL` for their own run.
- Supabase Auth/Realtime/Storage/PostgREST connect directly to the internal Postgres service, each
  as its own database user except Realtime (ARCHITECTURE §17.7).
- API and worker containers should stay within safe connection counts on the single-VPS v1 deployment.

Trigger to add PgBouncer: sustained `pg_stat_activity` usage above 60% of Postgres `max_connections`, connection exhaustion errors, or adding more horizontally scaled API/worker replicas.

## Known Issues

- CI replays every migration on a fresh Postgres 17 (`Database replay` job). EXPLAIN timings and restore-drill measurements still require a disposable local/staging database or VPS access; the repo provides commands and fixtures but cannot collect production evidence by itself.
- PITR is not proven in repo-local automation. Owner must verify provider/VPS strategy before production sign-off.
- Some older indexes are not idempotent by declaration. Fresh replay is the source of truth; re-running individual old migrations remains unsupported.
