# Event photos — slice 3: deletion (tombstones, expiry, orphan sweep) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every photo image leaves the bucket on every deletion path: a photo deleted, its Event deleted, its club deleted, or its Event past the deletion instant (00:00 on `end_date + 31`, Event clock). An image that has no photo row is removed too.

**Architecture:**

- Migration `0250` adds a deny-all tombstone table. A row trigger on `event_photos` writes both object keys there in the deleting transaction, and a TRUNCATE trigger does the same for every row. It also adds one listing function for the expiry.
- `apps/api/src/modules/photos/photo-cleanup.ts` is a plain class with three steps: **expire** (delete the rows of expired Events), **drain** (delete tombstoned objects, then their tombstones) and **sweep** (delete bucket objects that no row names).
- A BullMQ worker is the glue. Expire and drain run every 5 minutes; the sweep runs hourly.
- Every bucket call is raced against its own timer and aborted, and a run stops at its own deadline.

**Tech Stack:** Postgres 17 migration (plpgsql triggers), `@aws-sdk/client-s3` (`ListObjectsV2Command` is new; `DeleteObjectCommand` already in use), NestJS + `@nestjs/bullmq`, vitest, the committed cascade probe (`scripts/db-cascade-probe.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-03-event-photos-design.md`: "Storage and deletion", "When the bucket is slow or down" (Tombstone drain), the anti-goals, and Verification "Deletion tests".

## Assumptions (mine; the operator reads them in the report)

1. **Expiry runs every 5 minutes, not nightly.** The design says both "nightly" and "at 00:00 on the Event's clock". A nightly run at one UTC hour reaches a Paris Event up to a day late, and a Kiritimati Event (UTC+14) up to 14 hours later again. That breaks the anti-goal "no image survives past the deletion instant". The check is one database call over the Events that still hold photos, so running it every 5 minutes is cheap. The image is then gone within about 10 minutes of the instant (one expire run, then the drain in the same run). Slice 4's public feed hides a photo from the instant itself.
2. **The orphan sweep removes any object that no photo row names, once it is an hour old.** The design names only "a prefix whose Event row no longer exists". That reading misses an upload whose row insert failed, or whose clean-up delete also failed, in an Event that still exists: its image would outlive the deletion instant, which breaks the same anti-goal. The hour of grace covers an upload in flight. The objects are written first and the row last, and one upload takes at most about 2 minutes (60 s Traefik cut + 2 × 30 s writes). **Narrowed after the cold plan review:** the sweep judges only keys of an Event this database holds, in the shape the upload writes. A dev or test stack given the prod bucket keys would otherwise see every prod image as an orphan (its own database names none of them) and delete them for good: the bucket has no backup. A key of an Event that is not here, or in another shape, is left alone and counted in the log. The 120-day lifecycle rule takes it. That leaves one double fault for the lifecycle rule: an upload's row insert fails, its clean-up delete fails too, and its Event is deleted within the hour. And the sweep first calls `event_photo_events()`, which only the service role may run. A wrong service key reads the deny-all photo table as empty with no error, so without that check every image would look orphaned.
3. **One `DeleteObject` per key, never `DeleteObjects`.** The batch call needs a request checksum. The SDK now sends CRC32, and S3-compatible stores are known to refuse it. The design marked this UNVERIFIED for Scaleway. The single delete is already proven by the upload path. A 1,000-photo Event is 2,000 calls, a few minutes of worker time.
4. **TRUNCATE also writes tombstones** (statement trigger, `BEFORE TRUNCATE`). No code truncates the table, but a hand `TRUNCATE … CASCADE` from the operator's psql would otherwise skip the row trigger. A key UPDATE is NOT covered: no code changes a key, and keys carry a random photo id, so a key is never reused. Named, not built.
5. **The tombstone table has no `event_id`.** It must outlive its Event, so it has no foreign key at all. That also keeps it out of the archive and subject-export scans.
6. **A failed drain is traced three ways.** The job fails, so Sentry hears of it through `SentryReportingWorkerHost`. The error is logged with the key. The queue joins `RUNTIME_HEALTH_QUEUE_NAMES`, so the health card counts failed jobs. No attempts column: the key that stopped the run is in the log.
7. **With no bucket configured**, expire still deletes rows, which queues their tombstones. Drain and sweep log one warning and do nothing. The tombstones wait for the bucket.
8. **A 404 `NoSuchKey` on a delete counts as done** (cold plan review). AWS answers 204 for a missing key, and Scaleway is UNVERIFIED. Several paths delete a key twice: the sweep then the drain, two runs at once, a retry after the tombstone delete failed. A 404 there would stop the drain at that key on every tick. A 404 `NoSuchBucket` is still a failure.
9. **Named, not built (cold plan review):** a key the bucket always refuses stops the drain at it, and so blocks every later tombstone (the log names it). An `end_date` typo in the past expires an Event's photos within 5 minutes; the design says the instant follows the current `end_date`. The bucket key needs list and delete rights, and the health probe (HeadBucket) cannot tell.

## As built: the cold plan review (plan-reviewer, opus), folded

- M1 shared bucket → assumption 2, narrowed. M2 empty read as the wrong role → the sweep's service-role check. M3 → assumption 8. M4 complexity: `photoStoreOf` split (`sender`, `objectsOf`), probe cases split.
- MINOR: a leftover-tombstone check right after the seed; `TRUNCATE organizations CASCADE` and an Event delete by `service_role` probed; every path also asserts the photo row is gone (60 checks); `removeOnFail: { age: 86_400, count: 100 }`, so one blip does not hold the health card on warning; the drain stops on a short batch and fails loudly if a tombstone it cleared is read again.
- NIT: the tick drains even when the expiry fails, then fails the job; `PHOTO_STORE` moved to `photo-bucket.ts`; 0250 ends with `NOTIFY pgrst, 'reload schema'`.
- Settled: both containers run the jobs (`WorkersModule` is in AppModule; the worker boots `dist/main.js`).

## As built: the cold code review (code-architecture-reviewer, opus), folded

- I1: a tick whose expiry and drain both fail now logs the expiry error before draining (worker cell).
- I2: the design's "Storage and deletion" and its Verification line now say every 5 minutes and the narrowed sweep.
- Minor: `PHOTO_DRAIN_BATCH` is 75 (a key is about 100 characters encoded; 75 stay near `IN_LIST_MAX`'s 8 KB). The key shape has one owner (`photoObjectKeys` / `photoKeyParts` in `photo-bucket.ts`, strict UUIDs). The id lookups use `inListChunks`. A failing Event no longer stops the expiry of the others. A page's undated entries are counted and logged. A stack with no bucket logs a plain line, not a warning, each hour. New cells: a NoSuchKey through the real store, several drain batches, a failed tombstone delete, `authenticated` reads no tombstone (61 probe checks).
- Open for the operator: a prod wipe drops the database and keeps the bucket, so its old images then wait for the 120-day rule; versioning must stay off (a delete would only add a marker); a dev stack restored from a prod dump AND given the prod keys "knows" the prod Events.

## Global Constraints

- Deletion instant: 00:00 on `end_date + 31` days on the Event's clock (`eventZone`), one helper (`photoDeletionInstant`) next to `photoUploadWindow`. It follows the current `end_date`. Slice 5's admin label and slice 7's download button will read it.
- Bucket timeouts, from the spec: list or delete 10 s (`PHOTO_BUCKET_DELETE_TIMEOUT_MS`, `PHOTO_BUCKET_PROBE_TIMEOUT_MS`), write 30 s. Each call is raced and aborted; a run stops at `PHOTO_CLEANUP_RUN_MS = 4 * 60_000`, inside the 5-minute tick.
- Drain order: object first, tombstone second. A tombstone is never dropped while its object may exist. A bucket failure stops the run, logs the key, and fails the job.
- The tombstone table: RLS enabled, no policy (hard rule 4). The trigger functions are `SECURITY INVOKER` with `SET search_path = public, pg_catalog`. EXECUTE is revoked from `PUBLIC, anon, authenticated` by name.
- Migration `0250` (re-check `ls packages/db/migrations | tail -1` before creating it). `CREATE TABLE IF NOT EXISTS … (` with `);` on its own line.
- Free cron slots: `*/5 * * * *` collides with the health monitor, which is harmless because the queues are different. The sweep runs at minute 50. No `tz` is passed, so the container's `TZ` applies. Neither pattern depends on it.
- No real photo and no personal data in fixtures (hard rule 7). One commit (hard rule 9). Stage explicit paths.

## Review Focus

1. **A cascade that skips the trigger.** A club delete reaches `event_photos` through `organizations → events → event_photos`. It must queue both keys on committed rows, not only inside a rolled-back seed. → Task 1, the committed club delete in the cascade probe.
2. **The bucket that never answers.** The SDK retries past `connectionTimeout`, and `requestTimeout` alone only warns. A drain against a host that accepts and never replies must give up within the call's bound, keep every tombstone, and fail the job. → Task 2 (store, real client against a silent socket), Task 4 (drain).
3. **The instant on far clocks.** Kiritimati (UTC+14) and New York cross the UTC date. One millisecond before the instant keeps the photos; the instant deletes them. → Task 3.
4. **An upload in flight during the sweep.** Its objects exist and its row does not yet. It must be kept for the hour of grace. → Task 4.
5. **Two runs at once.** The api and worker containers both boot the full app (`docker-compose.prod.yml:933`), so both may run the processors (UNVERIFIED whether BullMQ starts them in both; the design is safe either way), and a slow run can meet the next tick. Two drains over the same keys must both succeed: a missing key deletes as a no-op, and deleting a missing tombstone is a no-op. → Task 4, the "run twice" cell.

---

### Task 1: Migration 0250 — tombstones, triggers, the expiry listing

**Files:**

- Create: `packages/db/migrations/0250_event_photo_tombstones.sql`
- Modify: `packages/db/test/event-photos.test.ts`
- Modify: `packages/db/fixtures/cascade-probe-seed.sql` (one `event_photos` row on the seed's Event, with `ca5c…` keys)
- Modify: `scripts/db-cascade-probe.mjs` (`SEEDED` + new checks, `EXPECTED_CHECKS` bumped). If it would pass 400 lines, put the photo cases in `scripts/lib/photo-tombstone-probe.mjs`, which receives `tryAndRollBack`, `check` and `sql`.

**Migration content:**

- `public.event_photo_tombstones (object_key TEXT PRIMARY KEY, queued_at TIMESTAMPTZ NOT NULL DEFAULT now())`, an index on `(queued_at)`, `ENABLE ROW LEVEL SECURITY`, no policy, and a table comment ("deny-all; API only; no FK on purpose: it outlives its Event").
- `public.event_photo_tombstone_row()`: plpgsql trigger, `SECURITY INVOKER SET search_path = public, pg_catalog`. It runs `INSERT … VALUES (OLD.original_key), (OLD.preview_key) ON CONFLICT DO NOTHING`, then `RETURN OLD`. It is attached as `AFTER DELETE ON public.event_photos FOR EACH ROW`.
- `public.event_photo_tombstone_all()`: same rights. It runs `INSERT … SELECT original_key FROM event_photos UNION ALL SELECT preview_key … ON CONFLICT DO NOTHING`, then `RETURN NULL`. It is attached as `BEFORE TRUNCATE ON public.event_photos FOR EACH STATEMENT`.
- `public.event_photo_events() RETURNS TABLE (event_id uuid, end_date date, timezone text)`: `LANGUAGE sql STABLE SECURITY INVOKER`, pinned path. It returns the Events that hold at least one photo (`EXISTS`). It is a function because PostgREST aggregates and `distinct` are off. EXECUTE goes to `service_role` only.
- `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` on all three functions.

- [ ] **Step 1: Write the failing text tests** in `packages/db/test/event-photos.test.ts`:
  - `creates event_photo_tombstones with RLS on and no policy, and no foreign key`: the table statement has no `references`.
  - `queues both keys on every row delete and on truncate`: `after delete on public.event_photos for each row`, `before truncate on public.event_photos for each statement`, and both `old.original_key` and `old.preview_key` in the row function.
  - `keeps the trigger and listing functions invoker, path-pinned, out of reach of web roles`: one `functionStatement` per function.
- [ ] **Step 2: Run** `pnpm --filter @myclash/db test -- event-photos`. Expected: FAIL.
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Probe cases** in the cascade probe, on the committed seed, each through `tryAndRollBack`, reading `event_photo_tombstones` in `after`:
  - a photo row delete → both seed keys queued;
  - the Event delete → both keys, and the photo row gone;
  - the club delete → both keys;
  - the Tournament delete → no tombstone, and the photo kept with `tournament_id` NULL (seed the photo tagged with the seed's Tournament);
  - `TRUNCATE event_photos` → both keys;
  - a photo delete under `SET LOCAL ROLE service_role` → both keys (the API's role may write through the invoker trigger);
  - `SET LOCAL ROLE anon`, then `SELECT count(*) FROM event_photo_tombstones` after a superuser insert in the same transaction → 0.

  After the committed `seedDeleted()`, assert both keys are queued, then delete those two tombstones so `nothingLeft()` holds (add them to its list). The by-hand fallback in `seedDeleted()`'s `catch` also cascades to the photo, so it deletes the two tombstones too; otherwise the next run on the same database finds them.

- [ ] **Step 5: Verify**, each green:
  - `pnpm --filter @myclash/db test`
  - `pnpm db:review` (no new warning)
  - the replay kit (`replay.sh`, port changed if taken): replay, rls-probe, merge-probe, cascade-probe with the new count, plus a schema read (`relrowsecurity` t, 0 policies, `has_function_privilege('anon', …)` false for the three functions, `has_table_privilege('anon','public.event_photo_tombstones','insert')` false)
  - `pnpm --filter @myclash/api exec vitest run src/common/db-schema-conformance.test.ts src/modules/exports src/modules/privacy`

---

### Task 2: The store lists, and every call is bounded

**Files:**

- Modify: `apps/api/src/modules/photos/photo-bucket.ts`, `photo-bucket.test.ts`
- Modify: `apps/api/src/modules/admin/runtime-health/photo-storage-collector.ts` (re-point to the helper; its tests unchanged)
- Create: `apps/api/src/modules/photos/photo-store.provider.ts` (the `PHOTO_STORE` provider, moved from `photos.module.ts` so the worker module uses the same one)
- Modify: `apps/api/src/modules/photos/photos.module.ts`

**Interfaces:**

- Produces:

```ts
export interface PhotoObject {
  key: string;
  lastModified: Date;
}
export interface PhotoStore {
  put(key: string, bytes: Buffer): Promise<void>;
  remove(key: string): Promise<void>;
  /** One page of keys under `prefix`, at most 1,000. `next` is set while more remain. */
  list(prefix: string, next?: string): Promise<{ objects: PhotoObject[]; next?: string }>;
}
/** Runs `call` with an abort signal; rejects at `ms` whether or not `call` honours the signal. */
export function boundedCall<T>(
  call: (signal: AbortSignal) => Promise<T>,
  ms: number,
  what: string,
): Promise<T>;
export function photoStoreOf(
  setting: PhotoBucketSetting,
  client?: Pick<S3Client, 'send'>,
  timeouts?: { writeMs: number; deleteMs: number; listMs: number },
): PhotoStore | null;
// photo-store.provider.ts
export const photoStoreProvider: FactoryProvider<PhotoStore | null>; // provide: PHOTO_STORE, inject: [ConfigService]
```

- `list` sends `ListObjectsV2Command({ Bucket, Prefix, ContinuationToken: next, MaxKeys: 1000 })`, bounded at the 10 s list budget. An object with no `Key` or no `LastModified` is skipped.
- `boundedCall`'s error says `Photo bucket did not answer within ${ms} ms (${what})`.

- [ ] **Step 1: Write the failing tests** in `photo-bucket.test.ts`:
  - `list` sends the command input exactly, and maps `Contents` and `NextContinuationToken`.
  - `boundedCall` rejects at `ms` and aborts the signal when the call ignores it.
  - **A silent bucket:** a `net` server that accepts and never writes, a real `S3Client` from `photoBucketClientConfig` pointed at it, and timeouts of 300 ms. Each of `remove`, `put` and `list` rejects in under 2 s. Close the server's sockets in `afterEach`.
- [ ] **Step 2: Run** `pnpm --filter @myclash/api exec vitest run src/modules/photos/photo-bucket.test.ts src/modules/admin/runtime-health`. Expected: FAIL.
- [ ] **Step 3: Implement.** `send` and the collector both go through `boundedCall`.
- [ ] **Step 4: Run.** Expected: PASS, including the existing upload tests (`src/modules/photos`).

---

### Task 3: The deletion instant, one owner

**Files:**

- Modify: `apps/api/src/modules/photos/photo-window.ts`, `photo-window.test.ts`

**Interfaces:**

```ts
/** Days after the last day that the photos are kept: deleted at 00:00 of end_date + 31, Event clock. */
export const PHOTO_KEEP_DAYS = 30;
export function photoDeletionInstant(event: {
  end_date: string | null;
  timezone: unknown;
}): Date | null;
// dayStartUtcIso(addDays(end_date, PHOTO_KEEP_DAYS + 1), eventZone(timezone).zone)
```

- [ ] **Step 1: Write the failing test.** An Event ending 2026-05-17, cells for UTC, Europe/Paris, America/New_York and Pacific/Kiritimati, using the file's `midnight()` helper: the instant equals `midnight('2026-06-17', zone)`. An unreadable `end_date` gives `null`. An unknown zone reads on the default clock.
- [ ] **Step 2: Run** `… vitest run src/modules/photos/photo-window.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.

---

### Task 4: Expire, drain, sweep

**Files:**

- Create: `apps/api/src/modules/photos/photo-cleanup.ts`, `photo-cleanup.test.ts`

**Interfaces:**

- Consumes: `PhotoStore` (Task 2), `photoDeletionInstant` (Task 3), the RPC `event_photo_events` (Task 1).
- Produces:

```ts
export const PHOTO_ORPHAN_GRACE_MS = 60 * 60_000;
/** 100 keys of about 70 characters keep the `.in()` URL near the repo's 200-UUID chunks (admin-users.service.ts:187). */
export const PHOTO_DRAIN_BATCH = 100;
export const PHOTO_CLEANUP_RUN_MS = 4 * 60_000;
export class PhotoCleanup {
  constructor(
    db: SupabaseClient,
    store: PhotoStore | null,
    logger: Pick<Logger, 'log' | 'warn' | 'error'>,
    now?: () => number, // default Date.now
  );
  /** Deletes the photo rows of every Event at or past its deletion instant; the trigger queues the images. */
  expire(): Promise<{ events: string[]; photos: number }>;
  /** Deletes each tombstoned object, then its tombstone. Throws when the bucket fails, after keeping the tombstones. */
  drain(): Promise<{ deleted: number }>;
  /** Deletes every object at least PHOTO_ORPHAN_GRACE_MS old that no photo row names. */
  sweep(): Promise<{ deleted: number }>;
}
```

**Behaviour:**

- **expire:**
  - Call `rpc('event_photo_events')`. For each row with `instant !== null && instant <= now`, run `from('event_photos').delete().eq('event_id', id).select('id')`, as `erasure.service.ts:319-327` counts, and log `Expired N photos of Event X`.
  - A `null` instant is logged with `warn` and skipped.
  - A db error throws.
- **The run deadline** (`PHOTO_CLEANUP_RUN_MS` from the run's start, read through `now`) is checked **before every bucket call**, not once per batch. A run that reaches it logs `Photo <step> stopped at its deadline; the next run goes on` and returns what it did. That is not a failure: the next tick continues.
- **drain:**
  - Loop until there are no tombstones or the run deadline passes. Each pass selects `object_key` ordered by `queued_at`, limit `PHOTO_DRAIN_BATCH`.
  - For each key, `store.remove(key)`. After the batch, or at the first failure, delete the tombstones of the keys already removed (`.in('object_key', removed)`).
  - On a failure, log `error` with the key, then throw `Photo drain stopped at <key>: <reason>`.
  - With `store === null` and tombstones present: one `warn`, `{ deleted: 0 }`.
- **sweep:**
  - Page through `store.list('events/')` until the deadline.
  - Keep each object at least `PHOTO_ORPHAN_GRACE_MS` old (from `lastModified`).
  - Parse its photo id from `events/{uuid}/{uuid}/(original|preview).jpg`. A key in any other shape is an orphan.
  - Look the ids up in chunks of 100: `from('event_photos').select('id').in('id', chunk)`.
  - Remove every object whose id has no row, logging each key.
  - A remove failure throws, like the drain.
  - Named, not built: each hourly run lists from the first key, so a bucket too big to list inside the deadline would never reach its last prefixes. At about 1,000 keys a page that is over 100,000 objects; the 15 GB per-Event cap keeps a busy Event near 5,000. The deadline line in the log is the trace.
- **The races, named in the class doc:**
  - Two runs at once: both removes succeed, and both tombstone deletes succeed.
  - An upload in flight: it is kept by the grace.
  - An upload that inserts after expire read its rows: the next tick deletes it, because its Event is still expired.

- [ ] **Step 1: Write the failing tests.** The db is `common/testing/supabase-chain.ts` and the store is an in-memory double; every `.select`, `.rpc` and `.delete` call is asserted by its exact arguments.
  - **expire:**
    - with `now` = instant − 1 ms: no delete;
    - with `now` = the instant: a delete on `event_photos` filtered `eq('event_id', id)` is written (the chain's `writes`), and the result lists the Event;
    - a Kiritimati and a New York Event in one run: only the one whose instant has passed is deleted;
    - a `null` instant warns.
  - **drain:**
    - two tombstones → two removes in `queued_at` order, then one tombstone delete with both keys;
    - **the bucket fails on the second key** → the first tombstone is deleted, the second is kept (never in a delete call), and `drain()` rejects with the key in the message;
    - a remove that rejects with `boundedCall`'s timeout error → `drain()` rejects and keeps that tombstone. The bound itself is Task 2's silent-bucket cell; this cell proves the drain treats a timeout like any bucket failure;
    - **the deadline:** the `now` double jumps past `PHOTO_CLEANUP_RUN_MS` after the first remove → exactly one remove, one tombstone deleted, the rest kept, `drain()` resolves, and the deadline line is logged. The same cell for the sweep: one page read, then it stops;
    - **run twice** over the same tombstones → both runs resolve;
    - store null → warn, no remove.
  - **sweep:**
    - an object 2 h old with no row → removed;
    - one 2 h old with a row → kept;
    - one 10 min old with no row → kept;
    - a key `events/x/stray.txt` 2 h old → removed;
    - two list pages → both read (`next` passed back).
- [ ] **Step 2: Run** `… vitest run src/modules/photos/photo-cleanup.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.

---

### Task 5: The worker, the queue, the health card

**Files:**

- Create: `apps/api/src/workers/photo-cleanup.worker.ts`, `photo-cleanup.worker.test.ts`
- Modify: `apps/api/src/workers/workers.module.ts` (`registerQueue({ name: PHOTO_CLEANUP_QUEUE, defaultJobOptions: { removeOnComplete: true, removeOnFail: 100 } })`, so a bucket outage failing every tick keeps 100 failed jobs, not 288 a day, as `follow-notification-scheduler.worker.ts:439` caps them; the worker; `photoStoreProvider`)
- Modify: `apps/api/src/modules/admin/runtime-health/queue-collector.ts` and its test (`'photo-cleanup'` appended)

**Interfaces:**

```ts
export const PHOTO_CLEANUP_QUEUE = 'photo-cleanup';
export const PHOTO_CLEANUP_TICK = 'tick'; // expire, then drain
export const PHOTO_ORPHAN_SWEEP = 'orphans'; // sweep
// onModuleInit:
//   upsertJobScheduler('photo-cleanup-tick',   { pattern: '*/5 * * * *' }, { name: 'tick',    data: {} })
//   upsertJobScheduler('photo-orphan-sweep',   { pattern: '50 * * * *' },  { name: 'orphans', data: {} })
// process(job): 'tick' → expire() then drain(); 'orphans' → sweep(); any other name throws.
```

The worker extends `SentryReportingWorkerHost`. It builds one `PhotoCleanup` from `SupabaseService.service`, `@Inject(PHOTO_STORE)` and its own `Logger`.

- [ ] **Step 1: Write the failing tests**, in the style of `data-retention.worker.test.ts`:
  - both schedulers are upserted with their exact ids, patterns and names;
  - `tick` calls expire, then drain, in that order;
  - a drain that throws makes `process` reject;
  - an unknown job name rejects;
  - the queue-collector list equals the old list plus `'photo-cleanup'`.
- [ ] **Step 2: Run** `… vitest run src/workers/photo-cleanup.worker.test.ts src/modules/admin/runtime-health`. Expected: FAIL.
- [ ] **Step 3: Implement and wire.**
- [ ] **Step 4: Run** `… vitest run src/workers src/modules/photos src/modules/admin src/common`. Expected: PASS, including `module-graph.test.ts`, `app.module.boot.test.ts`, `db-schema-conformance.test.ts` and the worker-host wiring test.

---

### Task 6: Falsify, image boot, gates, review, commit

- [ ] **Step 1: Seeded breaks** (a new `falsify-deletion.mjs`, copied from the 2b falsifier; each row is RED with constant counts; rows 1-2 change a migration, so each runs on a freshly replayed database):
  1. the row trigger inserts `original_key` only → the cascade probe goes red (replay run);
  2. drop the TRUNCATE trigger → red;
  3. the drain deletes the tombstone before `remove` → "bucket fails on the second key" goes red;
  4. `PHOTO_KEEP_DAYS + 1` → `PHOTO_KEEP_DAYS` → the instant cells go red;
  5. `<=` → `<` in expire → "at the instant" goes red;
  6. the sweep ignores the grace → "10 min old kept" goes red;
  7. `boundedCall` without the timer (signal only) → the "ignores the signal" cell goes red;
  8. `process('tick')` without the drain → the order cell goes red.
- [ ] **Step 2: Image.** Build `myclash-api:photos3` and boot it with the dev compose env. The worker logs both schedules. With no bucket keys, the first tick logs nothing beyond them and does not fail. Run a `ListObjectsV2` + `DeleteObject` against a local never-answering port from inside the image (`image-photo-check.cjs` pattern), and see the bounded failure.
- [ ] **Step 3: Gates.** Run the full `myclash-gates` chain (`gates.sh`), each gate alone, plus the replay kit from Task 1.
- [ ] **Step 4: Cold review.** Run `code-architecture-reviewer` (opus) over the diff, with this plan's Review Focus. Fix every Critical and Important finding test-first; each fix gets a seeded break.
- [ ] **Step 5: Commit once:** `feat(photos): every photo image leaves the bucket when its row, Event or club goes, or 30 days on` (header ≤ 100 characters). Stage explicit paths, this plan included; `git fetch`, then push; watch CI.
- [ ] **Step 6: Report.** Photos may go On once the bucket exists. Say what each deletion path does now. List assumptions 1–7.
