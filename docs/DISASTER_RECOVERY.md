# Disaster Recovery — Backup & Restore Runbook

How to restore MyClash from a backup, and how to prove the restore works
before you ever need it. Scope: the **system backup** (whole-database +
storage-volume snapshots), not the per-event organizer archive.

## What a backup contains

Each nightly run produces a timestamped **set** of two artifacts (optionally
`.gpg`-encrypted), stored under `backups/nightly/` and mirrored to Scaleway S3:

| Artifact              | Contents                                                                                                                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db-<TS>.sql.gz`      | `pg_dump` of the **entire** `myclash` database. Because the Supabase `auth`, `storage`, and `_realtime` schemas live inside that database, **users (`auth.users`), storage object rows, RLS policies, functions, sequences and every `public` table are all captured** in one consistent MVCC snapshot. |
| `storage-<TS>.tar.gz` | The contents of the named Docker volume `myclash-storage-data` (uploaded files: org logos, event assets), archived via a helper container.                                                                                                                                                              |

Cluster-level **roles** (`anon`, `authenticated`, `supabase_auth_admin`, …) are
not in a per-database dump, but the `db` container recreates them at init via
`infra/db/init/01-supabase-roles.sh`, so both same-cluster and fresh-cluster
restores have the roles they need.

## What restore does (`infra/scripts/restore.sh`)

1. Decrypts (if `.gpg`) and **integrity-checks** both archives (`gunzip -t`) — aborts here, before any disruption, if an archive is corrupt.
2. Stops **every service that holds a DB connection** — `api web-* worker` **and** the Supabase sidecars `supabase-auth`, `supabase-rest`, `supabase-realtime`, `supabase-storage`. (Skipping the sidecars is why an unpatched restore fails: `DROP DATABASE` is refused while any session is connected.)
3. `DROP DATABASE … WITH (FORCE)` + `CREATE DATABASE`.
4. Replays the dump with `psql -v ON_ERROR_STOP=1 --single-transaction`. **Atomic:** a truncated or corrupt dump rolls the fresh database back to empty rather than leaving a half-restored, incoherent database reported as "success".
5. **Validates** the result: the `public`/`auth`/`storage` schemas exist, `auth.users` is present, and there are a sane number of `public` tables. Fails the operation otherwise.
6. Clears and re-extracts the storage archive into the `myclash-storage-data` volume.
7. `docker compose up -d` restarts the whole stack.

A restore is triggered from **`/admin/backups`** (super-admin), which requires
typing `RESTORE MYCLASH <backupId>` to confirm and shows the destructive scope
before it runs. The ops-runner also takes a **safety backup of current state
first**.

## Restore procedure (operator)

**Preferred — from the admin UI:** `/admin/backups` → pick a set → **Restore
from local/S3/upload** → read the destructive-scope panel → type the
confirmation phrase. Watch the operation log; on completion the page shows the
validation counts. Then run `infra/scripts/status.sh` and confirm all services
are healthy.

**From the CLI on the VPS:**

```bash
cd /srv/myclash
infra/scripts/restore.sh                       # list local + S3 backups
infra/scripts/restore.sh backups/nightly/db-<TS>.sql.gz   # local, DB + matching storage
infra/scripts/restore.sh --from-s3 <TS>        # pull from Scaleway S3 then restore
# add --db-only to skip storage, --yes for non-interactive
```

## If a restore fails

- **Archive corrupt / DROP blocked:** the script aborts _before_ touching the database (integrity check) or fails loudly with the real `psql`/`docker` error in the log — nothing is silently swallowed anymore.
- **Replay fails mid-way:** the single transaction rolls back to an empty database; services stay stopped. Investigate the logged error, then re-run with a good archive. The ops-runner's pre-restore **safety backup** captures the state you started from.
- **Storage fails but DB restored:** the stack is restarted so the site recovers with the restored database; storage is stale — re-run the restore to retry storage.

## Prove it works

- **Fast, non-destructive, any docker host:** `bash infra/scripts/test-restore-roundtrip.sh` — dumps a disposable postgres, restores it with the hardened flags, asserts `auth.users` + rows round-trip, and asserts a truncated dump **fails and rolls back** (proving atomicity).
- **Regression guard (CI):** `node --test infra/ops-runner/restore-script-guard.test.mjs` pins the critical flags/stop-list so a future edit can't silently drop them.
- **Full drill (do once before launch, then periodically):** spin up a throwaway VM, deploy the stack, copy a real backup set over, run `infra/scripts/restore.sh`, and confirm a known event/fighter and a known uploaded image appear. Record it in `docs/OWNER_TASKS.md` as a verified restore.

## Post-restore checklist

- `infra/scripts/status.sh` → all services healthy.
- Log in (proves `auth.users` restored).
- Open an event page and a page with an uploaded logo/asset (proves storage restored + coherent with DB rows).
- Spot-check `/admin/backups` shows the last backup status.

## Known limitations / follow-ups

- **DB↔storage skew:** the DB dump and storage archive are taken sequentially with no write-quiesce, so a file written _between_ the two can produce an orphan storage row or file. Low probability at the nightly 03:00 UTC window; the `docs/superpowers/specs/2026-05-19-consistent-backups-design.md` quiesce lock is the planned mitigation.
- **Integrity is truncation/corruption-level (`gunzip -t` / `gzip -t`), not a SHA-256 manifest.** A per-set checksum manifest is a deferred enhancement; it was intentionally left out of the current pass to avoid destabilizing the tested retention/listing logic.
- **GPG key escrow:** if `BACKUP_GPG_RECIPIENT` is set, store the matching private key off-box. Without it, encrypted backups cannot be restored.
