# Event photos — slice 2a: photo table, mode, QR link and the anonymous upload route — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone holding an Event's QR token can upload a camera JPEG to the API. The API strips the hidden data, makes a preview, stores both in the photo bucket and writes the row. An organiser can set the photo mode and read or rotate the QR token.

**Architecture:**

- Migration `0249` adds `events.photo_mode` and `events.photo_token_version`, the deny-all `event_photos` table, and one counting function.
- `apps/api/src/modules/photos/` gains five pure parts and one service:
  - a token signer;
  - a device-cookie signer;
  - the upload window;
  - a whitelist JPEG stripper;
  - a sharp preview maker;
  - one upload service, which runs the refusals cheapest-first before the file is read, then processes the photo, stores it and writes the row.
- One public controller route takes the upload. Two organiser routes serve the link.

**Tech Stack:** NestJS 11 + Fastify, `@aws-sdk/client-s3` (slice 1), `sharp` `^0.35.5` (0.35.5 published 2026-09-27; the workspace override already pins it), `jsonwebtoken` (already a dependency), Postgres 17 migration, vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-event-photos-design.md` ("The server", "Storage and deletion", "When the bucket is slow or down", Verification "API tests"). Image decision: principal-engineer sign-off, 2026-11-04 (summarised under Global Constraints).

## Global Constraints

- **Operator rulings (2026-11-04):**
  - Camera JPEG only. Refuse progressive JPEG, WebP and HEIC, each with its own code.
  - Colour profiles (ICC) are dropped.
  - Slice 2 lands as two commits: 2a (this plan, server only) and 2b (the phone page).
  - Upload and Report join `PUBLIC_POST_ALLOWLIST` by name.
  - Caps: 300 photos per hour and 15 GB stored per Event.
  - The photo bucket uses its own keys only.
- **Principal-engineer ruling:**
  - The original is a pure-JS whitelist rebuild. Only SOF0/SOF1, 8-bit, 1 or 3 components. Stop at the first EOI after the scan. Re-write Orientation as a 34-byte APP1.
  - The preview comes from sharp, made from the **stripped** bytes, with `sharp.concurrency(1)` and `sharp.cache(false)`.
  - `MAX_PIXELS = 64_000_000`. The parser checks it at SOF, and sharp's `limitInputPixels` is the backstop.
- Limits, from the spec: `12 * MIB` per photo; name ≤ 40 characters, caption ≤ 200; 20 photos per hour per device; at most 4 uploads processed at once; preview long side ≤ 1024 px; bucket write 30 s.
- Upload window, on the Event's clock: from 00:00 of `start_date − 1` (inclusive) to 00:00 of `end_date + 2` (exclusive).
- No bucket call waits forever. Every `send` carries an abort signal (write 30 s, delete 10 s).
- Refusals carry a `code` that the 2b page translates. API sentences stay English, as with `file_too_large`.
- No real photo and no personal data in fixtures (hard rule 7). Every fixture is made at test time from synthetic pixels.
- RLS is enabled on the new table, with no anon or authenticated policy (hard rule 4).
- One commit for the whole slice (hard rule 9). Stage explicit paths. Check `git log --oneline -1` before staging and `git fetch` before pushing.

## Review Focus

1. **A crafted JPEG.** Progressive, huge declared dimensions, a truncated segment, a length running past the end, `FFD9` inside a trailer. Each must give a coded refusal before sharp runs, or bytes with no metadata. It must never crash, hang or leak. → Task 3 (refusals, fuzz loop).
2. **Two uploads past the same cap at once.** The overshoot is bounded by the 4-slot concurrency cap and is accepted (spec: "The race"). The slot must come back on every path, success and failure. → Task 6 (slot released on throw).
3. **The bucket stores the original, then fails on the preview, or the row insert fails.** No row may exist without both objects. Objects stored for a refused row are deleted best-effort, and the failure is logged. → Task 6.
4. **A phone with no cookie, or a forged one.** It gets a fresh device id. It is never refused for the cookie itself. The device limit is a convenience, not a security boundary. → Task 4, Task 7.
5. **The token never reaches a public read.** The public Event read carries `photo_token_version` but never the token, and the token cannot be derived without the secret. → Task 2.

---

### Task 1: Migration 0249 and the registries

**Files:**

- Create: `packages/db/migrations/0249_event_photos.sql`
- Create: `packages/db/test/event-photos.test.ts`
- Modify: `apps/api/src/modules/exports/archive.tables.ts` (`ARCHIVE_EXCLUDED_TABLES`: `'event_photos'`, with a reason comment like `event_feedback`'s: "short-lived by design; the images are deleted 30 days after the Event; an archive copy would outlive that promise")

**Migration content (exact values):**

- `events`:
  - `photo_mode TEXT NOT NULL DEFAULT 'off'`, `CONSTRAINT events_photo_mode_check CHECK (photo_mode IN ('off','live','approve'))`, added `NOT VALID` then `VALIDATE`, in the 0162 style.
  - `photo_token_version INTEGER NOT NULL DEFAULT 1 CHECK (photo_token_version > 0)`.
  - `COMMENT ON COLUMN` for each.
- `CREATE TABLE IF NOT EXISTS public.event_photos (`, with the closing `);` **on its own line** (the coverage parsers need it):
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE`
  - `tournament_id UUID REFERENCES public.tournaments(id) ON DELETE SET NULL`
  - `workshop_id UUID REFERENCES public.workshops(id) ON DELETE SET NULL`
  - `CHECK (tournament_id IS NULL OR workshop_id IS NULL)`
  - `status TEXT NOT NULL CHECK (status IN ('waiting','approved'))`
  - `uploader_name TEXT CHECK (uploader_name IS NULL OR char_length(uploader_name) BETWEEN 1 AND 40)`
  - `caption TEXT CHECK (caption IS NULL OR char_length(caption) BETWEEN 1 AND 200)`
  - `device_id UUID NOT NULL`
  - `original_key TEXT NOT NULL UNIQUE`, `preview_key TEXT NOT NULL UNIQUE`
  - `byte_size BIGINT NOT NULL CHECK (byte_size > 0)`, `crc32 BIGINT NOT NULL CHECK (crc32 BETWEEN 0 AND 4294967295)`
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- Indexes (`IF NOT EXISTS`): `(event_id, created_at DESC)`, `(device_id, created_at DESC)`, `(tournament_id)`, `(workshop_id)`.
- `ALTER TABLE public.event_photos ENABLE ROW LEVEL SECURITY;`, with no policy. The comment says "deny-all; the API writes as the service role (0247)".
- The function `public.event_photo_usage(p_event_id uuid, p_device_id uuid)`:
  - `RETURNS TABLE(event_last_hour int, event_bytes bigint, device_last_hour int)`;
  - `LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_catalog`;
  - `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role`.
  - The device count is per device **in this Event**.
  - Why a function: PostgREST aggregates are disabled.

- [ ] **Step 1: Write the failing test** `packages/db/test/event-photos.test.ts`, using the `migration-sql.ts` helpers:

```ts
it('adds photo_mode with exactly off/live/approve, default off', () => {
  /* allSql() contains the CHECK (photo_mode IN ('off','live','approve')) and DEFAULT 'off' */
});
it('creates event_photos with RLS on and no policy', () => {
  /* 'ALTER TABLE public.event_photos ENABLE ROW LEVEL SECURITY'; no /CREATE POLICY[^;]*event_photos/ */
});
it('detaches a photo from a deleted Tournament or Workshop instead of blocking', () => {
  /* both FKs 'ON DELETE SET NULL'; event_id 'ON DELETE CASCADE' */
});
it('keeps event_photo_usage away from web roles', () => {
  /* REVOKE … FROM PUBLIC, anon, authenticated; GRANT … TO service_role; SECURITY INVOKER */
});
```

- [ ] **Step 2: Run it.** `pnpm --filter @myclash/db test -- event-photos`. Expected: FAIL, the migration is absent.
- [ ] **Step 3: Write the migration and the archive entry.**
- [ ] **Step 4: Verify.** Each must pass:
  - `pnpm --filter @myclash/db test`
  - `pnpm db:review` (no new warning)
  - `pnpm --filter @myclash/api exec vitest run src/modules/exports src/modules/privacy` (archive and subject-export coverage)
  - **Replay.** Start a fresh `postgres:17` container and run `pnpm db:migrations:replay`, `pnpm db:rls-probe`, `pnpm db:merge-probe`, then `CASCADE_PROBE_DISPOSABLE=1 pnpm db:cascade-probe`, in that order, with `DATABASE_URL` set (CONTRIBUTING.md "Before pushing").
  - **Read the schema.** `select relrowsecurity from pg_class where relname='event_photos'` → `t`; `select count(*) from pg_policies where tablename='event_photos'` → `0`; `\d events` shows both columns and the CHECK.

---

### Task 2: Photo mode on the Event, and the QR token

**Files:**

- Create: `apps/api/src/modules/photos/photo-token.ts`, plus its test
- Modify: `apps/api/src/modules/events/dto/events.dto.ts:68-93` (`photoMode: z.enum(PHOTO_MODES).optional()`)
- Modify: `apps/api/src/modules/events/events.service.ts:744-756` (`if (dto.photoMode !== undefined) updates['photo_mode'] = dto.photoMode;`)
- Modify: the existing `events.service` update test file (the one that pins the `updates` payload; find it with `rg "event_kind'\]" apps/api/src/modules/events/*.test.ts`)

**Interfaces:**

- Produces:

```ts
export const PHOTO_MODES = ['off', 'live', 'approve'] as const; // photo-token.ts, re-exported for the DTO
export type PhotoMode = (typeof PHOTO_MODES)[number];
export function photoToken(secret: string, eventId: string, version: number): string; // base64url(HMAC-SHA256(secret, `${eventId}:${version}`)), 43 chars
export function photoTokenMatches(
  secret: string,
  eventId: string,
  version: number,
  candidate: unknown,
): boolean; // timingSafeEqual; false for non-string or wrong length
```

- [ ] **Step 1: Write the failing tests.**
  - `photoToken` is deterministic for the same input, differs when the version or the event id changes, and differs under another secret.
  - `photoTokenMatches` accepts the right token, and refuses a rotated one (version + 1), `undefined`, `''`, a 42-character string and a non-string.
  - DTO: `photoMode: 'live'` parses; `'public'` is refused.
  - Service: an update with `photoMode: 'approve'` sends `photo_mode: 'approve'` in the payload.
  - Public read: `JSON.stringify(await service.getEventBySlug(...))`, over a row that carries `photo_token_version: 3`, does not contain `photoToken(SECRET, id, 3)`.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.

---

### Task 3: The whitelist JPEG stripper

**Files:**

- Create: `apps/api/src/modules/photos/jpeg-strip.ts`
- Create: `apps/api/src/modules/photos/testing/synthetic-jpeg.ts`. This is a test-only fixture writer (segments, TIFF IFD0 + GPS IFD, XMP, APP13 IPTC, COM, JFIF and JFXX, ICC, MPF, trailers). Build it from a `sharp({ create })` 64×32 base with a red top-left quadrant. Never use sharp's `withExif`.
- Test: `apps/api/src/modules/photos/jpeg-strip.test.ts`

**Interfaces:**

- Produces:

```ts
export type PhotoRefusalCode = 'photo_not_jpeg' | 'photo_heic' | 'photo_unsupported_jpeg' | 'photo_too_many_pixels' | 'photo_corrupt';
export class PhotoRefusalError extends Error { constructor(readonly code: PhotoRefusalCode, message: string) }
export const MAX_PIXELS = 64_000_000;
export function sniffPhoto(bytes: Buffer): 'jpeg' | 'webp' | 'heic' | 'unknown'; // HEIC: 'ftyp' at offset 4, brand heic/heix/hevc/mif1/msf1
export function stripJpeg(bytes: Buffer): { bytes: Buffer; width: number; height: number; orientation: 1|2|3|4|5|6|7|8 }; // throws PhotoRefusalError
```

- Keep before the scan: DQT, DHT, DRI, SOF0/SOF1 (8-bit, 1 or 3 components), and APP14 "Adobe" only at length 14. Drop every other APPn and COM.
- Copy SOS and the entropy-coded data. Inside it, `FF00`, `FFD0`–`FFD7` and `FFFF` belong to the data.
- Stop at the first EOI after the scan.
- Walk forward by segment length only. Never search backwards for `FFD9`.
- Orientation comes from IFD0 tag `0x0112` of the first Exif APP1, in both byte orders, with bounds checks. Anything malformed counts as 1. Values 2–8 are written back as a 34-byte APP1 right after SOI.
- `sniffPhoto` result → refusal code: `'webp'` → `photo_not_jpeg`; `'heic'` → `photo_heic`; `'unknown'` → `photo_not_jpeg`.

- [ ] **Step 1: Write the failing tests.** The groups, from the sign-off:
  1. **Canaries.** Plant one in each of: EXIF Make/Model/Artist, the GPS IFD, XMP and extended XMP, APP13 IPTC 2:120, COM, the JFXX thumbnail, ICC, MPF, APP11/APP15, a trailing SOI…EOI, an `ftypmp42` box, `SEFH…SEFT`. `output.indexOf(canary) === -1` for every one.
  2. **Exact segment list.** `SOI, [APP1 34 B when orientation ≠ 1], DQT…, SOF0, DHT…, SOS, EOI`, and nothing after `FFD9`.
  3. **Lossless.**
     - The entropy-coded bytes are identical to the input's.
     - The sharp raw decode of the output equals the base's.
     - `stripJpeg(stripJpeg(x).bytes)` equals `stripJpeg(x)`.
  4. **Orientation.** 1–8 in II and MM order. `sharp(out).metadata().orientation` reads the same value. Value 1 writes no APP1.
  5. **Refusals, each with its code:**
     - PNG magic, HEIC `ftyp heic` (12 bytes), WebP, empty input;
     - progressive (`sharp().jpeg({ progressive: true })`);
     - SOF3, SOF9, 12-bit, and 4 components (patch the SOF bytes);
     - a SOF declaring 10000×10000 → `photo_too_many_pixels`;
     - no EOI, a length running past the end, no SOS → `photo_corrupt`;
     - malformed TIFF offsets → orientation 1, no throw.
  6. **Fuzz.** A seeded LCG makes 2,000 byte flips or truncations of the full fixture. Each must either return bytes containing no canary, or throw a `PhotoRefusalError`. Nothing else, and no hang (`--testTimeout` 20 s for this case).
- [ ] **Step 2: Run the tests.** `pnpm --filter @myclash/api exec vitest run src/modules/photos/jpeg-strip.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement `jpeg-strip.ts`.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Falsify.** Seed each break, check the text changed, see red, then restore:
  - keep APP1 → the canary group goes red;
  - stop at the last `FFD9` instead of the first → the trailer canaries go red;
  - accept SOF2 → the progressive refusal goes red.

---

### Task 4: Preview, device cookie, upload window

**Files:**

- Create: `apps/api/src/modules/photos/photo-preview.ts`, `photo-device.ts`, `photo-window.ts`, each with a test.
- Modify: `apps/api/package.json`, adding `"sharp": "^0.35.5"`. After the install, run `git diff pnpm-workspace.yaml`. Expected: no change. If an exclude was appended, revert it.

**Interfaces:**

- Produces:

```ts
// photo-preview.ts — module load: sharp.concurrency(1); sharp.cache(false);
export const PREVIEW_LONG_SIDE = 1024;
export async function makePreview(stripped: Buffer): Promise<Buffer>;
// sharp(stripped, { failOn: 'error', limitInputPixels: MAX_PIXELS }).autoOrient().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 })

// photo-device.ts
export const PHOTO_DEVICE_COOKIE = 'mc_photo_device';
export const PHOTO_DEVICE_TTL_DAYS = 30;
export class PhotoDeviceService {
  // reads PHOTO_DEVICE_JWT_SECRET with getOrThrow
  deviceOf(cookie: unknown): { deviceId: string; fresh: boolean }; // a valid JWT {sub, type:'photo_device'} → its sub; anything else → a new randomUUID, fresh: true
  sign(deviceId: string): { token: string; expires: Date };
}

// photo-window.ts
export function photoUploadWindow(event: {
  start_date: string;
  end_date: string;
  timezone: unknown;
}): { opensAt: Date; closesAt: Date } | null;
// opensAt = dayStartUtcIso(addDays(start_date, -1), zone); closesAt = dayStartUtcIso(addDays(end_date, 2), zone); zone via eventZone()
```

- [ ] **Step 1: Write the failing tests.**
  - **Preview:**
    - a 4032×3024 synthetic blurred-noise JPEG → long side 1024, under 400 KB, with no exif, xmp, iptc or icc in `metadata()`;
    - an orientation-6 fixture → 32×64 with a red top-right pixel;
    - a tiny 64×32 input → not enlarged.
  - **Device:**
    - a signed token returns its own id with `fresh: false`;
    - a tampered token, one signed with another secret, one with `type: 'guest'`, `undefined` and `''` each give a new UUID with `fresh: true`;
    - `sign().expires` is 30 days out.
  - **Window**, with the Event on 2026-05-16..17, cells for UTC, Europe/Paris, America/New_York and Pacific/Kiritimati:
    - refused at 1 ms before 00:00 of 05-15, Event clock;
    - accepted at 00:00 of 05-15 (set-up day);
    - accepted 1 ms before 00:00 of 05-19;
    - refused at 00:00 of 05-19.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement the three files.**
- [ ] **Step 4: Run the tests.** Expected: PASS.

---

### Task 5: Secrets and env wiring

`PHOTO_TOKEN_SECRET` and `PHOTO_DEVICE_JWT_SECRET` are required at boot. They are generated on deploy, like `MYCLASH_GUEST_JWT_SECRET`, so the operator does nothing. Copy each guest-secret line:

**Files:**

- `.env.example:108`
- `scripts/ensure-prod-env.mjs:52` (placeholder set) and `:97` (generator, `randomBytes(48).toString('base64url')`)
- `scripts/check-client-secret-boundaries.mjs` (`forbiddenEnvKeys`)
- `infra/docker-compose.prod.yml` (api and worker blocks; the worker boots the whole app)
- `infra/docker-compose.dev.yml` (api and worker, dev defaults)
- `infra/scripts/deploy.sh:305` and `:430`
- `apps/api/src/app.module.boot.test.ts:45` (`vi.stubEnv`)
- `docs/SECURITY_POSTURE.md:90` (owner, and what rotation does: rotating the token secret kills every printed QR code; rotating the device secret resets device limits)

The bucket keys stay **optional**. When the bucket is not configured, uploads answer 503 `photos_unavailable`. (Ruling: requiring them now would block deploys until the bucket exists.)

- [ ] **Step 1:** Add a test cell to `scripts/ensure-prod-env.test.mjs` asserting both keys are generated when absent, in the file's style. Add one to `check-client-secret-boundaries.test.mjs` asserting both are forbidden. Run both; expected: FAIL.
- [ ] **Step 2:** Make the wiring edits listed under Files.
- [ ] **Step 3: Verify.** Each must pass:
  - `node --test scripts/ensure-prod-env.test.mjs scripts/check-client-secret-boundaries.test.mjs`
  - `pnpm security:client-secrets`
  - `pnpm infra:review`
  - `docker compose --env-file .env.example -f infra/docker-compose.prod.yml config --quiet`

---

### Task 6: The upload service

**Files:**

- Create: `apps/api/src/modules/photos/photo-upload.service.ts`
- Test: `apps/api/src/modules/photos/photo-upload.service.test.ts`
- Modify: `apps/api/src/modules/photos/photo-bucket.ts`. Add `putPhotoObject(client, config, key, bytes, signal)` and `deletePhotoObject(...)`. Both go through `refusalOf`, and each gets one unit test asserting the command input (`Bucket`, `Key`, `ContentType: 'image/jpeg'`).

**Interfaces:**

- Consumes: Tasks 2–4. `readUploadParts` (`common/read-upload.ts:104`). `OperationalUnavailableException` (`common/operational-exception.ts:20`). The slice-1 `readPhotoBucketSetting` and `createPhotoBucketClient`.
- Produces:

```ts
export const PHOTO_UPLOAD: UploadLimit = {
  maxBytes: 12 * MIB,
  tooLarge: 'Photo exceeds the 12 MB size limit.',
};
export const PHOTO_UPLOAD_SLOTS = 4;
export const DEVICE_PHOTOS_PER_HOUR = 20;
export const EVENT_PHOTOS_PER_HOUR = 300;
export const EVENT_PHOTO_BYTES = 15 * 1000 ** 3;
export class PhotoUploadService {
  upload(
    eventId: string,
    token: unknown,
    deviceId: string,
    req: FastifyRequest,
  ): Promise<{ id: string; status: 'waiting' | 'approved' }>;
}
```

**Order (cheapest first). The file is read only after step 7:**

| #   | Check                                                                             | Refusal                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Event row (`id, start_date, end_date, timezone, photo_mode, photo_token_version`) | 404                                                                                                                                                           |
| 2   | token                                                                             | 403 `photo_link_invalid`                                                                                                                                      |
| 3   | `photo_mode === 'off'`                                                            | 403 `photos_off`                                                                                                                                              |
| 4   | window                                                                            | 403 `photos_window_closed`                                                                                                                                    |
| 5   | bucket setting not `on`                                                           | 503 operational `photos_unavailable`                                                                                                                          |
| 6   | slot taken (**released in `finally`**)                                            | 503 operational `photos_busy`                                                                                                                                 |
| 7   | `event_photo_usage` RPC                                                           | 429 `photo_device_limit`, `photo_event_limit` or `photo_event_storage_full` (the bytes check uses `event_bytes + 12 MiB > cap`, so the read cannot overshoot) |

**Then:**

1. `readUploadParts(req, PHOTO_UPLOAD)` reads the fields `name`, `caption`, `tournamentId` and `workshopId`.
2. Trim the name and caption; empty means `null`. Too long → 400 `photo_text_too_long`.
3. A tag that is not a Tournament or Workshop of this Event, or both tags at once → 400 `photo_tag_invalid`.
4. `sniffPhoto`, then `stripJpeg`, then `makePreview`, then `crc32` (`node:zlib`). A `PhotoRefusalError` → 422 with its code.
5. Put the original, then the preview, under the keys `events/{eventId}/{photoId}/original.jpg` and `…/preview.jpg`. A failure → 503 `photos_unavailable`; delete whatever was stored, best-effort, and log it.
6. Insert the row. `status = photo_mode === 'live' ? 'approved' : 'waiting'`. If the insert fails, delete both objects best-effort, log it, and rethrow.

**The races:**

- Concurrent uploads past a cap overshoot by at most `PHOTO_UPLOAD_SLOTS`. This is accepted (spec).
- The slot counter is per process. The `worker` container serves no HTTP. Comment at the counter.

- [ ] **Step 1: Write the failing tests.** Supabase is a `mockSupabase` chain; the bucket and sharp are real or stubbed as noted.
  - **Refused before the read.** One cell per row of the table above. Each asserts the status, the code, and that `req.parts` was **never called**.
  - **The slot comes back.**
    - A 4th concurrent upload is accepted, a 5th gets `photos_busy`, and a 6th after one finishes is accepted.
    - After a refusal thrown at step 7 and after a strip refusal, the slot count is back to 0.
  - **Live and approve.** Live → a row with `status: 'approved'`; approve → `'waiting'`.
  - **The insert payload, asserted exactly:**
    - `event_id`, `device_id`, the trimmed name and caption, the tags, `byte_size` = stripped length, `crc32` = `zlib.crc32(stripped)`, and the key strings.
    - `.rpc('event_photo_usage', { p_event_id, p_device_id })` is asserted by name and arguments.
    - The Event `.select(...)` string is asserted exactly.
  - **No row without both objects.**
    - A preview put that fails → 503 `photos_unavailable`, no insert, and a delete of the original.
    - An insert error → deletes of both keys, then a rethrow.
  - **Bytes.** The stored original equals `stripJpeg(input).bytes`, so it carries no canary.
  - **Tags and text.** A tag from another Event → 400 `photo_tag_invalid`. A 41-character name → 400.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Falsify.**
  - Move the slot release out of `finally` → the slot-return cell goes red.
  - Insert the row before the two puts → "no row without both objects" goes red.

---

### Task 7: Controller, module and the guard suites

**Files:**

- Create: `apps/api/src/modules/photos/photos.controller.ts`, `photos.module.ts`, `photos.controller.test.ts`
- Modify: `apps/api/src/app.module.ts` (import and register `PhotosModule`)
- Modify: `apps/api/src/common/auth/public-routes.test.ts`
  - `EXPECTED_PUBLIC` gains `'POST /events/:eventId/photos'`.
  - `PUBLIC_POST_ALLOWLIST` gains the same route.
  - The docstring gains the new class, operator ruling Q1 2026-11-04: "or an anonymous contribution locked by an Event secret and rate limits".
- Modify: `apps/api/src/common/upload-limits.routes.test.ts` (one row, `12 * MIB`, and the pinned count 14 → 15)
- Modify: `apps/api/src/common/upload-limits.refuse-first.test.ts` (a new `describe`: the photo route refuses a bad token with 403 `photo_link_invalid` and never asks for the file)

**Routes:**

| Route                                     | Access                                          | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST events/:eventId/photos`             | `@Public()`                                     | `@ApiConsumes('multipart/form-data')`. Token from the `x-photo-token` header (never the URL). Device from the `mc_photo_device` cookie via `deviceOf()`. On `fresh`, `reply.setCookie(PHOTO_DEVICE_COOKIE, …, buildSessionCookieOptions({ env, expires }))` with `@Res({ passthrough: true })`. Returns 201 `{ id, status }`. Placed by `:eventId`, so it is refused on an archived Event without a ledger line. |
| `GET events/:eventId/photos/link`         | org `admin` (`assertOrgRole`, as `updateEvent`) | `{ token, version }`                                                                                                                                                                                                                                                                                                                                                                                             |
| `POST events/:eventId/photos/link/rotate` | org `admin`                                     | Bumps `photo_token_version` by 1. Returns the new `{ token, version }`.                                                                                                                                                                                                                                                                                                                                          |

- [ ] **Step 1: Write the failing tests.**
  - **Controller:**
    - no cookie → `setCookie` called once with `mc_photo_device`, `httpOnly: true` and `sameSite: 'lax'`;
    - a valid cookie → `setCookie` not called;
    - the header token is passed through.
  - **Link:**
    - a non-admin → `assertOrgRole` refusal;
    - an admin → the token equals `photoToken(secret, id, version)`;
    - rotate → the update payload is `{ photo_token_version: version + 1 }`, and the old token no longer matches.
  - **Guard suites:** run the route tables listed under Files; their new entries are red until the route exists.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the suites.** `pnpm --filter @myclash/api exec vitest run src/modules/photos src/common src/modules/events src/modules/exports src/modules/privacy` → PASS. That includes `route-authz.test.ts`, `archived-lock.routes.test.ts`, `module-graph.test.ts`, `app.module.boot.test.ts` and `db-schema-conformance.test.ts`.

---

### Task 8: OpenAPI, image boot, gates, review, commit

- [ ] **Step 1: OpenAPI.** `pnpm openapi:emit && pnpm openapi:client`, then read `git diff packages/api-client`. Expected: three new routes, and `photoMode` on the Event update body.
- [ ] **Step 2: Image** (sign-off "Docker verification" steps 1–4 and 7):
  - Build `myclash-api:photos`.
  - In `/app/node_modules/.pnpm`, only the musl sharp packages are present.
  - In the image, `require('sharp')` prints vips `8.18.7` and `ok`.
  - The image grows by about 19 MB.
  - Trivy runs with `--severity HIGH,CRITICAL --ignore-unfixed --exit-code 1`, if Trivy is installed; otherwise CI's scan is the check, and the report says so.
  - In the image, run `stripJpeg` and `makePreview` over a synthetic canary JPEG. No canary in either output.
- [ ] **Step 3: Gates.** Run the full `myclash-gates` chain, each gate on its own, including the `Database replay` steps from Task 1.
- [ ] **Step 4: Cold review.** Run `code-architecture-reviewer` (opus) over the whole diff, with this plan's Review Focus. Fix every Critical/Important finding test-first.
- [ ] **Step 5: Commit once.**
  - `feat(photos): a phone with the QR link can upload a photo, stripped of hidden data, to the photo bucket`
  - Stage the explicit paths (including the lockfile, `schema.ts`, the complexity baseline if re-pointed, and this plan).
  - `git fetch`, then push.
- [ ] **Step 6: Report.** Tell the operator:
  - what is now possible through the API alone;
  - that the 2b page comes next;
  - that the HEIC behaviour of `accept="image/jpeg"` must be checked on real phones at the test event.
