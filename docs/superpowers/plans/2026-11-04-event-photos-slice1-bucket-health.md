# Event photos — slice 1: bucket client and photo-storage health check — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The API can reach the new photo bucket, and the super-admin runtime-health card says whether it answers.

**Architecture:** One API module (`apps/api/src/modules/photos/photo-bucket.ts`) owns the bucket settings and the S3 client. A fifth runtime-health collector probes the bucket with `HeadBucket` under a hard 10 s cap. The card gets a fifth tile. Until the operator creates the bucket, the keys stay optional and the tile reads "Not configured" without changing the overall status.

**Tech Stack:** NestJS 11 + Fastify, `@aws-sdk/client-s3` `3.1154.0` (published 2026-10-20, older than two weeks), vitest, Next.js (web-admin), `@myclash/i18n`.

**Spec:** `docs/superpowers/specs/2026-11-03-event-photos-design.md` (slice 1 of 8: "bucket client + health check"; sections "When the bucket is slow or down", "Left to the builder").

## Global Constraints

- Bucket timeouts (spec): connect 5 s; one object written 30 s; list/delete 10 s. "No call to the bucket may wait forever."
- AWS SDK v3 against an S3-compatible store: `requestChecksumCalculation` and `responseChecksumValidation` = `'WHEN_REQUIRED'` (spec, "Left to the builder").
- **The photo bucket is its own bucket with its own key pair (operator, 2026-11-04).** It is never the
  backup bucket, and the code never reads a `BACKUP_SCW_*` key, not even as a fallback. A leaked
  photo key must not reach the backups, and the reverse. A test pins this (Task 1).
- Scaleway defaults, written as constants in `photo-bucket.ts` (the same values as the backup block,
  `.env.example:191-192`, but not read from it): region `fr-par`, endpoint `https://s3.fr-par.scw.cloud`.
- Env key names: `PHOTO_BUCKET_ACCESS_KEY`, `PHOTO_BUCKET_SECRET_KEY`, `PHOTO_BUCKET_NAME`, `PHOTO_BUCKET_REGION`, `PHOTO_BUCKET_ENDPOINT`.
- **Assumed, not ruled by the operator:** the keys are optional in this slice. The bucket does not exist yet (an operator step). The upload slice adds them to `HUMAN_REQUIRED` in `scripts/ensure-prod-env.mjs:137`.
- Every new string is in EN and FR (hard rule 6). Tokenized classes only; no raw colours.
- One slice = one commit (hard rule 9). Tasks do not commit; Task 5 does.
- Never `git add -A`. Check `git log --oneline -1` before staging and `git fetch` before pushing.

## Review Focus

1. **Partly set keys** (e.g. the secret is missing). The tile must say which key is missing. It must not read "healthy", and the API must not crash at boot. → Task 1 (`partial`), Task 2 (`unavailable` with the key name).
2. **A bucket that never answers, and an SDK that ignores the abort.** The health endpoint must still answer within about 10 s. → Task 2 (never-settling probe).
3. **The keys are unset in prod today.** The API boots, the tile says "Not configured", and the overall status is unchanged. → Task 2.
4. **Compose passes `${X:-}` as an empty string.** An empty value means unset, never a bucket called `""`. → Task 1.
5. **The secret never reaches a browser bundle or the health response.** → Task 2 (response holds no key), Task 4 (client-secret gate).

---

### Task 1: Photo bucket settings and client

**Files:**

- Create: `apps/api/src/modules/photos/photo-bucket.ts`
- Test: `apps/api/src/modules/photos/photo-bucket.test.ts`
- Modify: `apps/api/package.json` (dependency `"@aws-sdk/client-s3": "3.1154.0"`), `pnpm-lock.yaml`

**Interfaces:**

- Produces:

  ```ts
  export const PHOTO_BUCKET_KEYS = [
    'PHOTO_BUCKET_ACCESS_KEY',
    'PHOTO_BUCKET_SECRET_KEY',
    'PHOTO_BUCKET_NAME',
  ] as const;
  export type PhotoBucketKey = (typeof PHOTO_BUCKET_KEYS)[number];
  export interface PhotoBucketConfig {
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    region: string;
    endpoint: string;
  }
  export type PhotoBucketSetting =
    | { kind: 'off' }
    | { kind: 'partial'; missing: PhotoBucketKey[] }
    | { kind: 'on'; config: PhotoBucketConfig };
  export const PHOTO_BUCKET_CONNECT_TIMEOUT_MS = 5_000;
  export const PHOTO_BUCKET_REQUEST_TIMEOUT_MS = 30_000; // socket budget; shorter calls pass their own signal
  export const PHOTO_BUCKET_PROBE_TIMEOUT_MS = 10_000;
  export type PhotoBucketProbe = (config: PhotoBucketConfig, signal: AbortSignal) => Promise<void>;
  export function readPhotoBucketSetting(
    get: (key: string) => string | undefined,
  ): PhotoBucketSetting;
  export function photoBucketClientConfig(config: PhotoBucketConfig): S3ClientConfig;
  export function createPhotoBucketClient(config: PhotoBucketConfig): S3Client;
  export function headPhotoBucket(client: Pick<S3Client, 'send'>): PhotoBucketProbe;
  ```

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @myclash/api add @aws-sdk/client-s3@3.1154.0 --save-exact`
Then: `git diff pnpm-workspace.yaml`. Expected: no change. If the install appended a `minimumReleaseAgeExclude` entry, revert that hunk; it bypasses the release-age rule.

- [ ] **Step 2: Write the failing tests** in `photo-bucket.test.ts`

```ts
const env = (v: Record<string, string>) => (k: string) => v[k];
const FULL = { PHOTO_BUCKET_ACCESS_KEY: 'AK', PHOTO_BUCKET_SECRET_KEY: 'SK', PHOTO_BUCKET_NAME: 'myclash-photos' };

it('is off when none of the three keys is set', () => {
  expect(readPhotoBucketSetting(env({}))).toEqual({ kind: 'off' });
});
it('never borrows the backup bucket or its keys', () => {
  const backupOnly = env({
    BACKUP_SCW_ACCESS_KEY: 'BAK', BACKUP_SCW_SECRET_KEY: 'BSK', BACKUP_SCW_BUCKET: 'myclash-backups',
    BACKUP_SCW_REGION: 'nl-ams', BACKUP_SCW_ENDPOINT: 'https://s3.nl-ams.scw.cloud',
  });
  expect(readPhotoBucketSetting(backupOnly)).toEqual({ kind: 'off' });
  const both = env({ ...FULL, BACKUP_SCW_REGION: 'nl-ams', BACKUP_SCW_ENDPOINT: 'https://s3.nl-ams.scw.cloud' });
  expect(readPhotoBucketSetting(both)).toMatchObject({ kind: 'on', config: { region: 'fr-par', endpoint: 'https://s3.fr-par.scw.cloud' } });
});
it('reads an empty value as unset (compose passes ${X:-})', () => {
  expect(readPhotoBucketSetting(env({ PHOTO_BUCKET_ACCESS_KEY: '', PHOTO_BUCKET_SECRET_KEY: '', PHOTO_BUCKET_NAME: '' })))
    .toEqual({ kind: 'off' });
});
it('names every missing key when only some are set', () => {
  expect(readPhotoBucketSetting(env({ PHOTO_BUCKET_NAME: 'myclash-photos' })))
    .toEqual({ kind: 'partial', missing: ['PHOTO_BUCKET_ACCESS_KEY', 'PHOTO_BUCKET_SECRET_KEY'] });
});
it('defaults region and endpoint to Scaleway fr-par', () => {
  expect(readPhotoBucketSetting(env(FULL))).toEqual({ kind: 'on', config: {
    accessKeyId: 'AK', secretAccessKey: 'SK', bucket: 'myclash-photos',
    region: 'fr-par', endpoint: 'https://s3.fr-par.scw.cloud' } });
});
it('keeps an explicit region and endpoint', () => { /* PHOTO_BUCKET_REGION 'nl-ams', PHOTO_BUCKET_ENDPOINT 'https://s3.nl-ams.scw.cloud' → both in config */ });
it('builds a client config with timeouts and WHEN_REQUIRED checksums', () => {
  const c = photoBucketClientConfig(/* the fr-par config above */);
  expect(c).toMatchObject({
    region: 'fr-par', endpoint: 'https://s3.fr-par.scw.cloud',
    credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
  });
});
it('probes the configured bucket with HeadBucket and passes the signal', async () => {
  const send = vi.fn().mockResolvedValue({});
  const signal = new AbortController().signal;
  await headPhotoBucket({ send } as never)(/* config */, signal);
  const [command, options] = send.mock.calls[0];
  expect(command).toBeInstanceOf(HeadBucketCommand);
  expect(command.input).toEqual({ Bucket: 'myclash-photos' });
  expect(options).toEqual({ abortSignal: signal });
});
```

- [ ] **Step 3: Run them and check they fail**

Run: `pnpm --filter @myclash/api exec vitest run src/modules/photos/photo-bucket.test.ts`
Expected: FAIL, because `./photo-bucket` cannot be resolved.

- [ ] **Step 4: Implement `photo-bucket.ts`**
  - `readPhotoBucketSetting` trims values. `''` counts as unset. `missing` keeps the `PHOTO_BUCKET_KEYS` order.
  - `requestHandler` is the plain-object form (`{ connectionTimeout, requestTimeout }`), so there is no direct `@smithy/*` dependency.
  - `createPhotoBucketClient` is `new S3Client(photoBucketClientConfig(config))`.
  - The header comment says the module is the one owner of the bucket settings, and why the keys are optional for now.

- [ ] **Step 5: Run the tests and check they pass**

Same command. Expected: 8 passed.

---

### Task 2: Photo-storage collector in runtime health

**Files:**

- Create: `apps/api/src/modules/admin/runtime-health/photo-storage-collector.ts`
- Test: `apps/api/src/modules/admin/runtime-health/photo-storage-collector.test.ts`
- Modify: `apps/api/src/modules/admin/dto/runtime-health.dto.ts` (metric types, response field)
- Modify: `apps/api/src/modules/admin/runtime-health.service.ts` (fifth collector, `mapPhotoStorage`, overall)
- Modify: `apps/api/src/modules/admin/runtime-health.service.test.ts` (`make()` default, new cases)
- Modify: `apps/api/src/modules/admin/admin.module.ts:153-175` (factory wiring)
- Modify: `apps/api/src/modules/admin/runtime-health.controller.ts:31` (summary: "…queues, disk, photo storage")

**Interfaces:**

- Consumes: `PhotoBucketSetting`, `PhotoBucketProbe`, `PHOTO_BUCKET_PROBE_TIMEOUT_MS`, `readPhotoBucketSetting`, `createPhotoBucketClient`, `headPhotoBucket` (Task 1).
- Produces (DTO):
  ```ts
  export interface PhotoStorageMetricOk {
    status: 'healthy';
    bucket: string;
    latencyMs: number;
  }
  export interface PhotoStorageNotConfigured {
    status: 'not_configured';
  }
  export type PhotoStorageMetric = PhotoStorageMetricOk | PhotoStorageNotConfigured | Unavailable;
  // RuntimeHealthResponseDto gains: photoStorage: PhotoStorageMetric;
  ```
- Produces (collector):
  ```ts
  export type PhotoStorageReading =
    { configured: false } | { configured: true; bucket: string; latencyMs: number };
  export function collectPhotoStorage(
    setting: PhotoBucketSetting,
    probe: PhotoBucketProbe,
    opts?: { timeoutMs?: number; now?: () => number },
  ): Promise<PhotoStorageReading>;
  ```
- `MetricStatus` does **not** widen. `not_configured` lives only on the photo metric.

- [ ] **Step 1: Write the failing collector tests**

```ts
const ON = {
  kind: 'on',
  config: {
    accessKeyId: 'AK',
    secretAccessKey: 'SK',
    bucket: 'myclash-photos',
    region: 'fr-par',
    endpoint: 'https://s3.fr-par.scw.cloud',
  },
} as const;

it('reports not configured when the keys are off, and never probes', async () => {
  const probe = vi.fn();
  await expect(collectPhotoStorage({ kind: 'off' }, probe)).resolves.toEqual({ configured: false });
  expect(probe).not.toHaveBeenCalled();
});
it('names the missing keys when the keys are partly set', async () => {
  await expect(
    collectPhotoStorage({ kind: 'partial', missing: ['PHOTO_BUCKET_SECRET_KEY'] }, vi.fn()),
  ).rejects.toThrow('Photo bucket is partly configured: missing PHOTO_BUCKET_SECRET_KEY');
});
it('times the probe', async () => {
  const ticks = [1_000, 1_042];
  await expect(
    collectPhotoStorage(ON, async () => {}, { now: () => ticks.shift()! }),
  ).resolves.toEqual({ configured: true, bucket: 'myclash-photos', latencyMs: 42 });
});
it('aborts the probe and gives up at the timeout, even if the probe ignores the signal', async () => {
  let aborted = false;
  const probe: PhotoBucketProbe = (_c, signal) => {
    signal.addEventListener('abort', () => {
      aborted = true;
    });
    return new Promise(() => {});
  };
  await expect(collectPhotoStorage(ON, probe, { timeoutMs: 20 })).rejects.toThrow(
    'Photo bucket did not answer within 20 ms',
  );
  expect(aborted).toBe(true);
});
it('passes the bucket error through', async () => {
  await expect(
    collectPhotoStorage(ON, async () => {
      throw new Error('NoSuchBucket');
    }),
  ).rejects.toThrow('NoSuchBucket');
});
```

- [ ] **Step 2: Run them and check they fail**

Run: `pnpm --filter @myclash/api exec vitest run src/modules/admin/runtime-health/photo-storage-collector.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `collectPhotoStorage`**

The algorithm the tests leave open: race the probe against a timer. When the timer fires, it aborts the controller and then rejects. Clear the timer in `finally`. `timeoutMs` defaults to `PHOTO_BUCKET_PROBE_TIMEOUT_MS` and `now` to `Date.now`.

- [ ] **Step 4: Run the collector tests and check they pass.** Expected: 5 passed.

- [ ] **Step 5: Add the failing service tests** to `runtime-health.service.test.ts`
  - `make()` gains `collectPhotoStorage: async () => ({ configured: true, bucket: 'myclash-photos', latencyMs: 40 })`.
  - The new cases:

```ts
it('reports a healthy bucket with its name and response time', async () => {
  const r = await make().collect();
  expect(r.photoStorage).toEqual({ status: 'healthy', bucket: 'myclash-photos', latencyMs: 40 });
});
it('shows an unset bucket as not configured and leaves the overall status alone', async () => {
  const r = await make({ collectPhotoStorage: async () => ({ configured: false }) }).collect();
  expect(r.photoStorage).toEqual({ status: 'not_configured' });
  expect(r.overall).toBe('healthy');
});
it('degrades a failing bucket to unavailable, which counts in the overall status', async () => {
  const r = await make({
    collectPhotoStorage: async () => {
      throw new Error('NoSuchBucket');
    },
  }).collect();
  expect(r.photoStorage).toEqual({ status: 'unavailable', error: 'NoSuchBucket' });
  expect(r.overall).toBe('unavailable');
});
it('carries no bucket credentials in the response', async () => {
  const body = JSON.stringify(await make().collect());
  expect(body).not.toMatch(/secretAccessKey|accessKeyId|PHOTO_BUCKET_SECRET_KEY/);
});
```

- [ ] **Step 6: Run them and check they fail**

Run: `pnpm --filter @myclash/api exec vitest run src/modules/admin/runtime-health.service.test.ts`
Expected: the 4 new cases FAIL (no `photoStorage` on the response). The 3 existing ones still pass.

- [ ] **Step 7: Implement the service, DTO and wiring**
  - `Collectors` gains `collectPhotoStorage: () => Promise<PhotoStorageReading>`.
  - `collect()` runs it inside the same `Promise.allSettled`.
  - `mapPhotoStorage` gives `rejected` → `unavailable` (via `errorText`), `configured: false` → `not_configured`, otherwise `healthy`.
  - `overall` leaves the photo status out when it is `not_configured`.
  - `admin.module.ts` factory: read `readPhotoBucketSetting((k) => config.get<string>(k))` once. Build the client once, only when the setting is `on`. Pass `collectPhotoStorage: () => collectPhotoStorage(setting, probe)`. When the setting is not `on`, `probe` is a function that throws; the collector never calls it.

- [ ] **Step 8: Run the runtime-health tests**

Run: `pnpm --filter @myclash/api exec vitest run src/modules/admin`
Expected: all pass. That includes `runtime-health.controller.test.ts` and `runtime-health-samples.service.test.ts`, which must not need a change (the samples writer ignores the new field).

- [ ] **Step 9: Falsify.** Seed each break, confirm the text really changed (`git diff --stat` shows the file), run the test, see red, then revert:
  - drop the `not_configured` exclusion from `overall` → "leaves the overall status alone" goes red;
  - remove `controller.abort()` from the timer → "aborts the probe…" goes red;
  - replace the `race` with a bare `await probe(...)` → the timeout test hangs to vitest's timeout (red).

  Compare the collected count with the baseline. A drop means the break stopped the file loading, which proves nothing.

---

### Task 3: Photo-storage tile on the runtime-health card

**Files:**

- Create: `apps/web-admin/app/admin/system-versions/photo-storage-rows.ts`
- Test: `apps/web-admin/app/admin/system-versions/photo-storage-rows.test.ts`
- Modify: `apps/web-admin/app/admin/system-versions/RuntimeHealthCard.tsx`:
  - the `RuntimeHealth` type gains `photoStorage`;
  - the pill takes `TileStatus = MetricStatus | 'not_configured'`;
  - `statusLabel` and `statusClasses` become exhaustive `switch`es with **no `default:`** and a `never` check, so a missing case fails the typecheck instead of reading "Unavailable" silently;
  - a fifth `MetricTile`, wrapped in `<div className="sm:col-span-2">` so the 2-column grid has no empty cell.
- Modify: `packages/i18n/src/messages/en/admin.ts:2834-2871` and `packages/i18n/src/messages/fr/admin.ts` (same block)

**Interfaces:**

- Consumes: the `PhotoStorageMetric` shape (Task 2), copied into the card's local types the same way the other four are.
- Produces: `export function photoStorageRows(t: Translate, m: PhotoStorageTile): Array<[string, string]>`, with the `PhotoStorageTile` type exported from the same file.

i18n keys under `admin.systemVersions.runtimeHealth` (EN / FR):

- `description` → "Live database, Redis, queue, disk and photo storage status." / "État en direct de la base de données, de Redis, des files, du disque et du stockage des photos." (match the existing FR sentence's style when editing)
- `statuses.notConfigured` → "Not configured" / "Non configuré"
- `photoStorage.title` → "Photo storage" / "Stockage des photos"
- `photoStorage.bucket` → "Bucket" / "Bucket"
- `photoStorage.latency` → "Response time" / "Temps de réponse"
- `photoStorage.notConfigured` → "No bucket set in the environment" / "Aucun bucket défini dans l'environnement"

- [ ] **Step 1: Write the failing test** (`t` is an echo stub: `(k) => k`)

```ts
it('shows the bucket and its response time when healthy', () => {
  expect(
    photoStorageRows(t, { status: 'healthy', bucket: 'myclash-photos', latencyMs: 42 }),
  ).toEqual([
    ['admin.systemVersions.runtimeHealth.photoStorage.bucket', 'myclash-photos'],
    ['admin.systemVersions.runtimeHealth.photoStorage.latency', '42 ms'],
  ]);
});
it('says no bucket is set when not configured', () => {
  expect(photoStorageRows(t, { status: 'not_configured' })).toEqual([
    [
      'admin.systemVersions.runtimeHealth.photoStorage.bucket',
      'admin.systemVersions.runtimeHealth.photoStorage.notConfigured',
    ],
  ]);
});
it('shows the error when unavailable', () => {
  expect(photoStorageRows(t, { status: 'unavailable', error: 'NoSuchBucket' })).toEqual([
    ['admin.systemVersions.runtimeHealth.unavailable', 'NoSuchBucket'],
  ]);
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm --filter @myclash/web-admin exec vitest run app/admin/system-versions/photo-storage-rows.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `photoStorageRows`, the i18n keys and the card edits** listed under Files. Write keys as literals so `t-key-references.test` sees them.

- [ ] **Step 4: Verify**
  - `pnpm --filter @myclash/web-admin exec vitest run app/admin/system-versions` → PASS.
  - `pnpm --filter @myclash/i18n test` → PASS (EN/FR parity, key references). Run it directly, not through turbo, which caches it.
  - `pnpm --filter @myclash/web-admin typecheck` → PASS after `pnpm turbo run build --filter="./packages/*"`.

---

### Task 4: Env wiring and the secret boundary

**Files:**

- Modify: `.env.example`: a new block after the backup block (`:188-195`), with the five keys. Region and endpoint carry the fr-par defaults; access, secret and name are empty. The comment says this is its own bucket with its own key pair, never the backup bucket or the backup keys. It also says the bucket is private and versioning is off, and that the keys are optional until photo uploads ship.
- Modify: `infra/docker-compose.prod.yml`: the `api` env block (`:633-682`) **and** the `worker` env block (`:934-966`), each with `PHOTO_BUCKET_*: ${PHOTO_BUCKET_*:-}`. The code owns the defaults, so no default goes in compose.
- Modify: `infra/docker-compose.dev.yml`: the `api` (`:393`) and `worker` (`:617`) env blocks, the same way.
- Modify: `scripts/check-client-secret-boundaries.mjs:23-32`: add `'PHOTO_BUCKET_SECRET_KEY'` to the server-secret list.
- Test: `scripts/check-client-secret-boundaries.test.mjs`: one cell where a `apps/web-public/...tsx` file naming `PHOTO_BUCKET_SECRET_KEY` is a finding.

- [ ] **Step 1: Write the failing cell** in the client-secret test, in the style of its existing cells. It expects one finding that names `PHOTO_BUCKET_SECRET_KEY`.
- [ ] **Step 2: Run it** with `node --test scripts/check-client-secret-boundaries.test.mjs`. Expected: the new cell FAILS.
- [ ] **Step 3: Add the key to the list, then edit `.env.example` and both compose files** as listed.
- [ ] **Step 4: Verify.** Each of these is green on its own:
  - `node --test scripts/check-client-secret-boundaries.test.mjs`
  - `pnpm security:client-secrets`
  - `pnpm infra:review`
  - `pnpm observability:review`
  - `docker compose -f infra/docker-compose.prod.yml config --quiet` with a dummy `.env`; expected exit 0

---

### Task 5: Gates, image boot, commit

- [ ] **Step 1: Regenerate the OpenAPI client** (the controller summary changed):
      `pnpm openapi:emit && pnpm openapi:client`. Then `git diff packages/api-client`; expected: only the summary line changes.
- [ ] **Step 2: Build and boot the API image.** A new npm dependency is not gated by `infra:review`.
  - `docker build -f apps/api/Dockerfile -t myclash-api:slice1 .`
  - Run it with the dev env.
  - `GET /api/v1/admin/system/runtime-health` as a super admin answers 200 with `photoStorage.status: "not_configured"`.
- [ ] **Step 3: Run the full `myclash-gates` chain**, each gate on its own, never `&&`-chained. Fix anything this slice turned red. Check a red gate on a clean HEAD before you own it.
- [ ] **Step 4: Run a cold review** with the `code-architecture-reviewer` agent over the diff. Fold in every BLOCKER/MAJOR.
- [ ] **Step 5: Commit once**:
  - `git log --oneline -1`, then stage the explicit paths from Tasks 1-5 (including `pnpm-lock.yaml`, `packages/api-client/src/generated/schema.ts` and this plan file).
  - `git commit` with a message file: `feat(photos): the API reaches the photo bucket, and runtime health says whether it answers`.
  - `git fetch` and re-run any gate whose inputs moved, then push.
- [ ] **Step 6: Tell the operator** what only they can do, and what is still unproven:
  - create the bucket (private, versioning off, 120-day expiry rule) and a key scoped to it;
  - add the three keys to the prod `.env`;
  - after redeploy, the tile should read "Healthy" with a response time;
  - the checksum setting against Scaleway is proven only by that live reading.
