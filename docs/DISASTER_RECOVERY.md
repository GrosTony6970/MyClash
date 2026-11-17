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

**Event photos are in neither artifact.** Their images live in a separate Scaleway bucket
(`PHOTO_BUCKET_*`) that the API reaches directly, and `backup.sh` and `restore.sh` never read or
write it. The database dump holds only their rows (`event_photos`). See "Known limitations" below.

`deploy.sh` also takes a database-only copy before each update, in `backups/pre-deploy/`; it is
what `rollback.sh` restores. The nightly backup deletes the copies older than 30 days.

Cluster-level **roles** (`anon`, `authenticated`, `supabase_auth_admin`, …) and their
settings are not in a per-database dump. On a fresh cluster the `db` container creates them at
init: the image's own `migrate.sh` creates the Supabase roles, `infra/db/init/01-supabase-roles.sh`
only `supabase_admin`, and `infra/db/init/supabase-service-roles.sh` gives the three service
users their passwords (from `.env`) and `service_role` its 60 s statement limit. So both
same-cluster and fresh-cluster restores have the roles they need, as long as `.env` holds
`AUTHENTICATOR_PASSWORD`, `SUPABASE_AUTH_ADMIN_PASSWORD` and `SUPABASE_STORAGE_ADMIN_PASSWORD`.

## What restore does (`infra/scripts/restore.sh`)

1. Decrypts (if `.gpg`) and **integrity-checks** both archives (`gunzip -t`) — aborts here, before any disruption, if an archive is corrupt.
2. Stops **every service that holds a DB connection** — `api web-* worker` **and** the Supabase sidecars `supabase-auth`, `supabase-rest`, `supabase-realtime`, `supabase-storage`, `supabase-meta`, with `supabase-studio` beside it. (Skipping the sidecars is why an unpatched restore fails: `DROP DATABASE` is refused while any session is connected.) The stop waits 10 s, not the worker's 5 minutes of grace: the database is dropped next, so a job in flight could not finish anyway.
3. `DROP DATABASE … WITH (FORCE)` + `CREATE DATABASE`.
4. Replays the dump with `psql -v ON_ERROR_STOP=1 --single-transaction`. **Atomic:** a truncated or corrupt dump rolls the fresh database back to empty rather than leaving a half-restored, incoherent database reported as "success".
5. **Validates** the result: the `public`/`auth`/`storage` schemas exist, `auth.users` is present, and there are a sane number of `public` tables. Fails the operation otherwise.
6. Clears and re-extracts the storage archive into the `myclash-storage-data` volume.
7. `docker compose up -d` restarts the whole stack.
8. Warns that **data deleted after the backup was made is back**: accounts, anonymised names and
   photos deleted since then. Nothing in the restored database remembers those deletions, so the
   operator deletes them again. `rollback.sh` prints the same warning.

`--storage-only <file>` does steps 1, 6 and 7 for the images alone: it stops and restarts
`supabase-storage` only (the one service that mounts the volume) and never touches the
database. **The images must come from the same night as the database in use:** the database
holds a row per stored file (`storage` schema), so images of another night leave broken logos
and photos, and files no row points to.

## Uploaded backups

A super admin can upload a set from `/admin/backups` (a new server with no `backups/nightly/`,
for example), one file at a time, each up to 2 GiB. A file goes in chunks with a progress bar:
a dropped connection resumes, and after a page reload picking the same file again continues
where it stopped. The server refuses a file its disk cannot hold, and checks a plain file
(`gzip -t`) before it keeps it. Each night is one folder, `backups/uploads/<TS>/`, holding at most the database
and the images file of that night; a second upload of the same file replaces the first. The
set is listed with the others as `upload-<TS>`. Its restore pairs the files: database + images
(`restore.sh <db> --storage-file <storage>`), database only (`--db-only`), or images only
(`--storage-only`, same-night rule above). After a restore that worked, the files it used are
deleted; a failed restore keeps them for another try. An upload row also has its own Delete,
and "Delete all backups" clears the uploads too.

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
infra/scripts/restore.sh <db-file> --storage-file <storage-file>   # images from another path
infra/scripts/restore.sh --storage-only <storage-file>   # images only, same night as the DB
# add --db-only to skip storage, --yes for non-interactive
```

## If a restore fails

- **Archive corrupt / DROP blocked:** the script aborts _before_ touching the database (integrity check) or fails loudly with the real `psql`/`docker` error in the log — nothing is silently swallowed anymore.
- **Replay fails mid-way:** the single transaction rolls back to an empty database; services stay stopped. Investigate the logged error, then re-run with a good archive. The ops-runner's pre-restore **safety backup** captures the state you started from.
- **Storage fails but DB restored:** the stack is restarted so the site recovers with the restored database; storage is stale — re-run the restore to retry storage.

## Prove it works

- **Fast, non-destructive, any docker host:** `bash infra/scripts/test-restore-roundtrip.sh` — dumps a disposable postgres, restores it with the hardened flags, asserts `auth.users` + rows round-trip, and asserts a truncated dump **fails and rolls back** (proving atomicity).
- **Regression guard (CI):** `node --test infra/ops-runner/restore-script-guard.test.mjs` pins the critical flags/stop-list so a future edit can't silently drop them; `restore-script-run.test.mjs` runs the script against stubbed `docker`/`gunzip`/`gpg`/`aws` for each mode (what it stops, what it restores, its exit status).
- **Full drill (do once before launch, then periodically):** spin up a throwaway VM, deploy the stack, copy a real backup set over, run `infra/scripts/restore.sh`, and confirm a known event/fighter and a known uploaded image appear.

## Post-restore checklist

- `infra/scripts/status.sh` → all services healthy.
- Log in (proves `auth.users` restored).
- Open an event page and a page with an uploaded logo/asset (proves storage restored + coherent with DB rows).
- Spot-check `/admin/backups` shows the last backup status.

## Known limitations / follow-ups

- **A dump taken before 2026-11 (each service on its own database user, ruling 390) does not
  restore into a working stack.** In such a dump the `auth` and `storage` tables belong to the
  superuser, so GoTrue and Storage, which now log in as `supabase_auth_admin` and
  `supabase_storage_admin`, cannot run their own migrations on them. Only fresh databases are
  supported (ruling 391); there is no ownership hand-over.
- **Changing a service user's password** (`AUTHENTICATOR_PASSWORD`,
  `SUPABASE_AUTH_ADMIN_PASSWORD`, `SUPABASE_STORAGE_ADMIN_PASSWORD`): the init script sets them
  once, on a fresh volume. To change one on a running database, set the new value in `.env`, run
  `\password <user>` in the psql shell (infra/scripts/README.md) and type the new value at its
  prompt, then recreate that service. Not `ALTER ROLE <user> PASSWORD '…'`: psql's `\password`
  hashes the value before sending it, so it reaches neither the db log (a mistyped role name logs
  the failed statement in full) nor `pg_stat_statements` (ruling 427).

- **Event photos have no backup and no recovery path.** The photo bucket is outside the system
  backup, has versioning off (a delete must really delete), and expires every object after 120
  days. If the bucket is lost, the photos are lost. A database restore also leaves the two out of
  step: a photo deleted after the backup has its row back and no image, and a photo sent after the
  backup has an image and no row, which the hourly-grace orphan sweep
  (`apps/api/src/modules/photos/photo-cleanup.ts`) then deletes from the bucket.
- **DB↔storage skew:** the DB dump and storage archive are taken sequentially with no write-quiesce, so a file written _between_ the two can produce an orphan storage row or file. Low probability at the nightly 03:00 UTC window. Nothing mitigates it: the quiesce lock designed in `docs/superpowers/archive/specs/2026-05-19-consistent-backups-design.md` was never built, and that spec is marked superseded.
- **Integrity is truncation/corruption-level (`gunzip -t` / `gzip -t`), not a SHA-256 manifest.** A per-set checksum manifest is a deferred enhancement; it was intentionally left out of the current pass to avoid destabilizing the tested retention/listing logic.
- **GPG key escrow:** if `BACKUP_GPG_RECIPIENT` is set, store the matching private key off-box. Without it, encrypted backups cannot be restored.
