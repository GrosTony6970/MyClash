# Consistent Backups - Design Spec

## Summary

MyClash backups should be consistent across Postgres and Supabase Storage by briefly placing the platform in a backup-quiesced state. The target operator-visible write pause is 2-5 minutes. During that window, reads can continue where safe, but all mutations, uploads, worker jobs, and scoring sync writes must be blocked or drained before `pg_dump` and the storage archive run.

## Goals

- Produce a backup where the database dump and storage archive represent one coherent application state.
- Prevent app/API/worker/storage writes while backup artifacts are being produced.
- Keep the existing ops-runner backup workflow, local/S3 artifact model, retention, and admin Backup Management UI.
- Make consistency visible in backup metadata so operators can tell whether a backup is safe to restore.

## Non-Goals

- Full point-in-time restore with WAL archiving.
- Zero-downtime writes during backup.
- Object-storage versioning or filesystem snapshots in this first pass.
- Rewriting restore behavior beyond sharing the same quiesce safety primitive.

## Recommended Approach

Use a platform-level backup quiesce lock controlled by ops-runner.

1. Ops-runner acquires the existing backup operation lock.
2. Ops-runner enables a `backup_quiesce` state with an operation id, reason, start time, and expiry.
3. The API rejects mutating requests while the lock is active.
4. Workers pause or stop processing jobs while the lock is active.
5. Storage writes are blocked while the lock is active.
6. Ops-runner waits a short drain period for in-flight writes.
7. `backup.sh` runs `pg_dump`.
8. `backup.sh` archives storage.
9. Optional encryption, S3 upload, and retention run as they do today.
10. Ops-runner clears quiesce in a `finally` path even if backup fails.

## Quiesce State

Persist the lock in app data so all components can inspect the same source of truth.

Proposed file:

```json
{
  "enabled": true,
  "reason": "backup",
  "operationId": "uuid",
  "startedAt": "2026-05-19T01:00:00.000Z",
  "expiresAt": "2026-05-19T01:10:00.000Z"
}
```

The lock should fail open only after `expiresAt`, so a crashed ops-runner cannot leave the platform permanently read-only. Expiry must be long enough for normal backups, with clear logs if it is exceeded.

## API Behavior

While quiesce is active:

- Allow `GET`, `HEAD`, health checks, status polling, and backup operation polling.
- Reject `POST`, `PUT`, `PATCH`, and `DELETE` with `503`.
- Return a structured response such as:

```json
{
  "code": "BACKUP_IN_PROGRESS",
  "message": "Backup in progress. Please retry in a few minutes.",
  "retryAfterSeconds": 300
}
```

The API middleware should run early enough to protect all controllers, including admin, organizer, public participant, scoring sync, notification preference, upload, and AI mutation routes.

## Worker Behavior

Workers must not start new write jobs while quiesce is active.

Preferred v1 behavior:

- Ops-runner stops or pauses the `worker` container before backup and starts it after backup.
- API-side queue producers are blocked by the API write lock.

This is simpler and safer than relying on every worker loop to check the quiesce file.

## Storage Write Protection

The database lock is not enough because storage is archived separately. If browsers or services can write directly to Supabase Storage, those writes must be blocked.

Preferred v1 behavior:

- During quiesce, ops-runner stops or blocks `supabase-storage` writes before the archive.
- If stopping the storage container breaks public image reads, this is acceptable during the 2-5 minute window.
- The admin UI should display backup/maintenance status if upload attempts fail with `503`.

## Backup Manifest

Each backup set should include machine-readable metadata next to the DB and storage artifacts.

Suggested file:

```json
{
  "backupId": "20260519T010000Z",
  "consistent": true,
  "quiesceStartedAt": "2026-05-19T01:00:00.000Z",
  "quiesceReleasedAt": "2026-05-19T01:02:40.000Z",
  "gitCommit": "abcdef123456",
  "db": {
    "file": "db-20260519T010000Z.sql.gz",
    "sha256": "...",
    "bytes": 123456
  },
  "storage": {
    "file": "storage-20260519T010000Z.tar.gz",
    "sha256": "...",
    "bytes": 234567
  },
  "s3Uploaded": true
}
```

The Backup Management page can later surface `consistent: true`, checksums, and sizes. A backup without this manifest should be treated as legacy or consistency-unknown.

## Restore Implications

Restore should continue to create a pre-restore backup first. Restore should also enter quiesce mode or stop app containers before replacing DB/storage, then clear the lock when complete.

The restore UI should warn when restoring a legacy backup that lacks a consistency manifest.

## Failure Handling

- If quiesce cannot be enabled, backup must fail before producing artifacts.
- If `pg_dump` fails, clear quiesce and mark operation failed.
- If storage archive fails, clear quiesce and mark the backup inconsistent/failed.
- If S3 upload fails after local artifacts are complete, local backup remains consistent but remote availability is incomplete.
- If quiesce clear fails, ops-runner should retry and log loudly; expiry remains the final safety valve.

## Tests And Verification

- Unit tests for quiesce lock read/write/expiry behavior.
- API tests proving mutating requests return `503` while quiesce is active and reads still work.
- Ops-runner tests proving backup enables quiesce, runs DB/storage artifact steps, and clears quiesce in success and failure cases.
- Backup-core tests for manifest generation, checksums, and consistency status.
- Manual VPS validation:
  - start backup from admin UI;
  - verify write requests fail with `BACKUP_IN_PROGRESS`;
  - verify DB and storage artifacts plus manifest have matching backup id;
  - verify the platform resumes writes after backup.

## Open Implementation Notes

- The first implementation can use a file under `data/backup-quiesce.json` because ops-runner and API already share mounted app data.
- If future multi-node hosting is introduced, move quiesce state to Postgres or Redis.
- The brief 2-5 minute write pause should be scheduled for low-traffic hours by default.
