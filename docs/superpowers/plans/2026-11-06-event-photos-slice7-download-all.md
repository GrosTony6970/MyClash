# Event photos — slice 7: download all — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the operator builds native) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An organiser downloads every stored original of an Event's photos (or one Tournament's or Workshop's) as one zip, with a `photos.csv`, streamed from the bucket and never built in memory or on disk, valid past 4 GiB (design Goal 10, "Download all — specifics").

**Architecture:**

- A streaming STORED zip writer in `apps/api/src/common/stored-zip.ts`, beside the buffer writer it shares its record builders with: one owner of the zip format. It writes Zip64 records only when an offset or the entry count passes the 32-/16-bit limits. No new dependency (open question Q1).
- The photo store gains `get(key)`: one original read whole into a Buffer (≤ 12 MiB, the upload cap) within 30 s, or `null` when the key is gone.
- `PhotoDownloadService` reads every row first (paged, 1,000 at a time), then hands Fastify a `Readable` that pulls one photo at a time from the bucket, one photo ahead at most. Each photo is checked against its stored size and CRC32 BEFORE its zip header is written, so a missing or damaged one is left out cleanly (Q2). `photos.csv` comes last and lists exactly the photos in the zip.
- `GET events/:eventId/photos/download?tournamentId=|workshopId=` on `PhotosController`, behind the existing organiser gate.
- web-admin: a "Download all" panel on the Photos page with the Tournament / Workshop filter, the deletion date and the "your copies" line. The click re-reads the summary through `apiRequest` (which renews a lapsed login) and only then follows a plain link.
- Traefik's `compress` middleware stops compressing `application/zip` and `image/jpeg`.

**Tech Stack:** NestJS 11 on Fastify, `@aws-sdk/client-s3` (already a dependency), `node:zlib` `crc32` (Node 26), `node:stream` `Readable.from`, vitest (node; jsdom for the web-admin page), Traefik v3.7.10.

**Spec:** `docs/superpowers/specs/2026-11-03-event-photos-design.md`: Goal 10 (`:58-65`), `[rev] Traefik compress` and `[rev] Zip writer` (`:181-185`), "Download all" under failures (`:384-385`), "Download all — specifics" (`:391-398`), admin page item (`:407`), "Download test" (`:506-513`). Shape: `2026-11-05-event-photos-slice5a-admin-moderation.md`, `2026-11-06-event-photos-4c-comment-gap.md`.

**Scripts** (copy into this session's scratchpad, read first): `…\19dbabfe-ec4a-4591-8dcb-933b5faac235\scratchpad\` — `gates.sh <ABSOLUTE outdir>`, `watch-ci.sh`, `baseline-audit.mjs`, `boot-4c.sh` (+ a954b49a's `boot-4c-calls.cjs`), `live-gap.cjs` + `seed-gap.sql` (the live PostgREST model), `falsify-gap.mjs` (the API row model); `…\fc383466-7375-4762-b52f-d9fbcb891db6\scratchpad\falsify-6b.mjs` (the web row model).

## In plain words

On Tuesday after the Event, the organiser opens the admin Photos page. Under the caps there is a new box, "Download all". It says: "Photos are deleted on 8 December 2026 at 00:00. Copies you download are yours to keep safe and delete." A list lets her pick "All photos", one Tournament or one Workshop, and a second list the spreadsheet she uses ("Excel (French)" or "Standard"), as the other CSV downloads do. She taps "Download all". Her browser starts saving `fal-2026-photos.zip` at once, the way it saves any big file, and she can keep using the page.

The zip holds every photo still stored: approved ones and the ones still waiting. Deleted ones are not in it. Each file is named by when it was sent, on the Event's clock, so they sort in order: `2026-11-01_14-03_3f2a9c1e.jpg`. The last file, `photos.csv`, opens in a spreadsheet with one row per photo: file name, sender's name, caption, Tournament or Workshop, time and status. A caption typed as a formula shows as text and never runs.

If her login lapsed while the page sat open, the tap renews it first, as every other button does. If photos are not set up (no bucket), or the deletion date has passed, the box says so and has no button. A `photos` volunteer and anyone who is not an admin of the club get no zip.

If the bucket fails in the middle, the download stops and the browser shows it as failed; she taps again. If a photo is deleted while the zip is being sent, it is simply not in the zip (Q2).

## Rulings for this slice (2026-11-06 ~11:40, session f81e81f1; each the recommended answer)

- **467** (Q1). **Our own streaming zip writer**, beside the existing one, sharing its record builders; no new dependency.
- **468** (Q2). **A photo deleted or damaged during the download is left out**, and `photos.csv` lists only the photos in the zip; the browser shows no total size.
- **469** (Q3). **One zip, as the design says**; Zip64 only past 4 GiB (a Mac user past 4 GiB may need The Unarchiver or Keka).
- **470** (Q4). **`photos.csv` in the format the organiser picks**, the same two choices as the other CSV downloads, written by `csvFile`.
- **471** (~11:45). **Two commits: 7a the server (Tasks 1-4 and Task 6's Traefik and infra rule), then 7b the page (Task 5)**, each falsified, gated and reviewed on its own.

## Open questions (as asked; the answers are the rulings above)

- **Q1 — the zip writer.** (a) **Recommended: our own streaming writer**, in the file that already holds the repo's zip writer, sharing its record builders: no new dependency, uses the CRC32 and size already stored per photo, no data descriptors (the widest reader support), about 120 lines plus tests read back by an independent test reader and, once, by Python's `zipfile` and Windows' `tar` on a real 4.2 GiB file. (b) `yazl` 3.3.1 (MIT, CommonJS, one dependency, last published 2024-11): mature Zip64, but it recomputes every CRC in JavaScript and always writes data descriptors (7-Zip 9.20 rejects them), and it is a new package in the api image's hand-copied `node_modules`. (c) `archiver` 8: ESM-only, nine dependencies; not recommended.
- **Q2 — a photo deleted (or damaged) while the zip is being sent.** (a) **Recommended: leave it out**, log it, and list in `photos.csv` only the photos in the zip. Cost: the zip's total size is not known in advance, so the browser shows "1.2 GB downloaded" with no total and no time left (the page shows the Event's total GB already). (b) Announce the exact size (the browser shows the time left), and a photo that vanishes mid-way fails the whole download.
- **Q4 — which spreadsheet `photos.csv` is written for.** French Excel splits a comma file into one column (the 2026-10-15 ruling: every human CSV download lets the organiser pick). (a) **Recommended: the panel offers the same two choices as the other CSV downloads** (`CsvExportMenu`'s "Excel (French)" / "Standard"), sent as `?csv=` and read with `CSV_FORMAT_PARAMS`; the file is written by `csvFile` (byte-order mark, CRLF). (b) Always the standard format.
- **Q3 — Mac.** yazl's README says the Mac Archive Utility does not read Zip64; I could not check a Mac. Any zip past 4 GiB needs Zip64 (the cap is 15 GB). (a) **Recommended: one zip as the design says**, Zip64 only past 4 GiB; a zip under 4 GiB has no Zip64 record at all. (b) Several zips of at most 4 GiB each ("part 1 of 3"), no Zip64 anywhere. Changes the design and the button.

## Assumptions (mine; the operator reads them before the build)

1. **Organisers only**, through the existing gate `PhotosController.organisersEvent` (design Goal 10). A `photos` volunteer gets 403, a signed-out caller 401.
2. **The download works on an archived Event**, until the deletion instant (it is a GET; the archived lock guards writes only).
3. **From the deletion instant on, the download answers 410 Gone** ("The photos of this Event are deleted"), with the queue's own rule, moved out of `PhotoModerationService.expired` (private, `photo-moderation.service.ts:224`) into `photo-window.ts` as `photosExpired(event, now): boolean` and used by both. An unreadable end date (`photoDeletionInstant` → null) is NOT expired on either side: the server allows the download, and the page shows the button with the undated note (`.copiesNoteUndated`). The page hides the button when `deletesAt` is set and past.
4. **No bucket → 503 `photos_unavailable`** (`photosUnavailable()`), before any row is read.
5. **Every row is read before the first byte is sent**, 1,000 a page (PostgREST's cap, `PGRST_DB_MAX_ROWS`), **paged by `id`** (`order('id').gt('id', last)`: unique, so no row is skipped; `created_at` is not unique, and the queue's `.lt('created_at')` cursor, `photo-moderation.service.ts:136`, can skip a tie — named, not fixed here), then sorted by `created_at, id` in memory. A database fault is then a normal error answer, never a cut zip. At the caps (300/h over ~4 days) that is at most ~29,000 rows, ~4 MB of central directory in memory.
   5b. **The first photo is fetched before the answer starts**: `zip()` pulls the first zip chunk itself (which reads and checks the first stored photo) before it builds the `Readable`. A bucket fault there throws inside the handler, so it goes through `ApiExceptionFilter` (scrubbed, `photos_unavailable` 503). Without it, a fault before the first byte reaches Fastify's default handler (no `setErrorHandler` in `apps/api/src`), which sends an unscrubbed JSON 500 naming the bucket (`photo-bucket.ts:321`). A fault after the first byte destroys the connection (`fastify/lib/reply.js` `onErrorHook`, headers sent).
6. **The filter** is `tournamentId` OR `workshopId` (UUIDs, never both: 400). An id that is not this Event's gives a zip with only `photos.csv`; no lookup (the rows are read by `event_id` too, so nothing leaks). "Untagged only" is not offered.
7. **File names**: `YYYY-MM-DD_HH-mm_<first 8 hex of the photo id>.jpg`, at the root of the zip, on the Event's clock (`utcToZonedParts`). No sender's name in a file name (anonymous text). Each entry's zip date is the same wall time.
8. **`photos.csv`**: columns `file,name,caption,tag,time,status`, written by `csvFile(rows, format)` (`packages/types/src/csv.ts:120`, the one owner of a CSV a person downloads: byte-order mark, CRLF, formula-safe cells) in the format of Q4; English column names, as the archive's are. `tag` is the Tournament's name or the Workshop's title, empty when none; `time` is `YYYY-MM-DD HH:mm` on the Event's clock; `status` is `waiting` or `approved`. The column names are a data file's, not translated, as the archive's are.
9. **The zip's name** is `<event slug>-photos.zip`, filtered or not.
10. **Each original is read whole** (≤ 12 MiB) and checked (`length === byte_size`, `crc32 === row.crc32`) before its header is written; one photo is fetched ahead. At most three originals are in memory per download (the socket's write buffer, the chunk `Readable.from` holds, the fetch ahead): ~36 MiB. The fetch ahead is held as a promise with a `.catch(() => {})` attached at once (and kept to await later), so a bucket fault while the generator waits at a `yield` is not an `unhandledRejection` (`process-failure-handlers.ts:54` reports those to Sentry), and a dropped one after `return()` is silent.
11. **The bucket read**: one `GetObject` AND its body read inside one `boundedCall` of 30 s (design: "abort a download stream that stalls for 30 s"), not through `sender` (which bounds only `send`, `photo-bucket.ts:286-301`); on a timeout the `Body` is destroyed; `NoSuchKey` → `null`; any other failure throws, which ends the zip (the browser reports a failed download, design `:384`).
12. **The browser closing the download stops the reads**: the stream's destroy calls the generator's `return()` (`fastify/lib/reply.js` on `res` close). A `return()` queued behind a running `get` may let that one finish; no `get` starts after it (the generator checks a `stopped` flag set in its `finally`, before starting the next fetch).
13. **No cap on downloads at once** (named, not built): each holds at most ~24 MiB and one bucket connection; only club admins reach it. A refusal sent to a link click would land as a broken file, which is why none is added.
14. **The login**: the click re-reads `GET …/photos/summary` through `apiRequest` (renews a 401 once, `renew-login.ts`); only an OK answer that still has storage on and no past deletion date follows the link. The re-read's answer replaces the page's summary, so a storage-off or expired answer shows its reason (the usage line, `.deleted`) instead of doing nothing. The link carries `download` (empty), so an error answer to it lands as a failed download, not as raw problem+json replacing the admin page (`downloadServerCsv` sets none, `CsvExportMenu.tsx:19-23`). The download itself is checked at its start only, so a 40-minute download outlives the one-hour login.
15. **Traefik**: `myclash-compress` gets `excludedContentTypes: [application/zip, image/jpeg]` in `infra/config/traefik/middlewares.yml`; the dev compose's label-defined `myclash-compress` gets the same. Side effect: the archive's and HEMA Ratings' small zips are no longer gzipped (they are stored zips of CSV, so they grow on the wire; named).
16. **The filter's lists** are read by the panel from the existing `GET /api/v1/events/:id/tournaments` (as `archive/page.tsx:71-72` does) and `GET /api/v1/events/:id/workshops` (`workshops.controller.ts:193`); if either fails, the list holds "All photos" only and a line says the list could not load. `PhotoSummary` does not change (the staff screen reads it too).

## Global Constraints

- No new runtime dependency (Q1 a). `node:zlib` `crc32(data)` is native on Node 26 (`package.json` engines `>=26.0.0`).
- Every function < 50 lines, every file < 400 (tests included). `stored-zip.ts` is 116 lines, `photos.controller.ts` 269, `photo-bucket.ts` 325, `page.tsx` 87, `PhotoUsage.tsx` 47; **`photo-bucket.test.ts` is 394 and `photos.controller.test.ts` 364, so the new tests go in new files** (`photo-bucket.get.test.ts`, `photos.controller.download.test.ts`). Re-check the complexity baseline with `baseline-audit.mjs`.
- Selects are whole literals (the schema sweep reads them); assert each select string in a test.
- `PhotoStore` gains `get`: every object typed `PhotoStore` must add it (`photo-upload.service.test.ts:81`, `photo-upload.account.test.ts:86`, `testing/cleanup-doubles.ts` `memoryStore`, any other `: PhotoStore` double `tsc` names).
- New route: OpenAPI regenerated (`pnpm --filter @myclash/api build` then `pnpm openapi:client`); the route-authz scan must find its refuser (`organisersEvent`); `public-routes.test.ts` unchanged (not `@Public()`).
- i18n EN + FR for every new string, literal keys, under `organizer.photos.download.*`.
- `@myclash/types` and `@myclash/i18n` are read from `dist`: rebuild after editing.
- One commit (or the split the operator rules), Conventional Commits, header ≤ 100 characters, lower-case subject, e.g. `feat(photos): download all of an event's photos as one streamed zip, past 4 gib`.

## Review Focus

1. **A zip past 4 GiB, and one with more than 65,534 entries**: Zip64 records present and right; a zip under both limits has none. Task 1 tests "zip64 past 4 GiB" and "no zip64 under the limits" (count limit tested on the record builder with a forced count).
2. **The client is slow** (backpressure): the bucket is not read ahead of what the sink took, beyond one photo. Task 3 test "fetches at most one photo ahead of the sink".
3. **A photo whose object is gone, or whose bytes differ from the stored size or CRC**: left out, logged, absent from the CSV, the rest of the zip valid. Task 3 tests.
4. **The organiser leaves mid-download**: no more bucket reads after the destroy. Task 3 test.
5. **A caption or name typed as a formula, with a comma, quote or newline, or with an accent**: neutralised and quoted in `photos.csv`, and "Géraldine" survives Excel (byte-order mark). Task 3 test with `=HYPERLINK("x")`, `a,"b"\nc` and `Géraldine`.
6. **Two photos sent in the same microsecond across a page boundary**: both in the zip. Task 3 paging test + Task 6 live check with tied `created_at` seeds.

---

### Task 1: The streaming zip writer, Zip64 past the limits

**Files:**

- Modify: `apps/api/src/common/stored-zip.ts`
- Test: `apps/api/src/common/stored-zip.stream.test.ts` (new), with a test-side reader `apps/api/src/common/testing/zip-reader.ts` (new; walks the end record → Zip64 locator → central directory → local headers and checks each CRC with `zlib.crc32`, written independently of the writer).

**Interfaces:**

- Produces: `export interface ZipStreamEntry { name: string; bytes: Buffer; crc32?: number; modifiedAt: { day: string; hhmm: string } | null }` (`crc32` given when the caller already checked it, so it is not computed twice; computed with `zlib.crc32` otherwise) and `export async function* zipStream(entries: AsyncIterable<ZipStreamEntry>): AsyncGenerator<Buffer>`.
- Keeps: `createStoredZip`, `storedZipBytes`, `readStoredZip` byte-for-byte (their existing tests must stay green unchanged).

- [ ] **Step 1: Write the failing tests** — `zipStream`:
  - "writes entries a reader reads back": three entries (one empty) → the test reader returns the names, bytes and CRCs; the local header's CRC/sizes equal the central record's.
  - "matches createStoredZip byte for byte when no entry has a time" for the same entries collected.
  - "no zip64 under the limits": no `0x06064b50` / `0x07064b50` signature in the output, every central record has no extra field.
  - "zip64 past 4 GiB": 350 entries sharing one 12 MiB zero Buffer (4.2 GiB yielded, never copied; the sink keeps only the last 4 MiB and the byte count) → the end record's offset field is `0xFFFFFFFF`, the Zip64 end record holds the true central-directory offset (= total − central size − 98), the locator points at the Zip64 end record, every entry whose offset ≥ 2³²−1 has a Zip64 extra (id 1, 8 bytes) with its true offset, and the reader's walk of the kept tail agrees.
  - "writes the DOS date and time": `{ day: '2026-11-01', hhmm: '14:03' }` → date `((2026−1980)<<9)|(11<<5)|1`, time `(14<<11)|(3<<5)`.
  - "pulls the next entry only when the consumer asks": an entries iterator counting `next()` calls; after reading the first chunk, at most one entry has been pulled.
  - "zip64 past 65,534 entries": 70,000 empty entries through `zipStream` (~5 MB) → the end record's counts are `0xFFFF`, the Zip64 end record holds 70,000, the offsets stay 32-bit. Through the public function, so no builder is exported for a test.
- [ ] **Step 2: Run** `pnpm --filter @myclash/api exec vitest run stored-zip` → the new tests FAIL (`zipStream` not exported).
- [ ] **Step 3: Implement.** Extract the local header, central record and end records into private builders that `createStoredZip` and `zipStream` both use (version 20 and flags 0 as today; version 45 only on a record that carries Zip64). Zip64 when a value reaches `0xFFFFFFFF` (offsets, central size) or `0xFFFF` (count): the 32-/16-bit field holds the all-ones value, the true value goes in the Zip64 extra (central record) or the Zip64 end record (56 bytes, signature `0x06064b50`, record size 44) + locator (20 bytes, `0x07064b50`, total disks 1) written before the classic end record. Local headers never need Zip64 (an entry is ≤ 12 MiB). CRC with `zlib.crc32`. Each entry yields its header + name, then its bytes as given (no copy).
- [ ] **Step 4: Run** the same command → all PASS, and `pnpm --filter @myclash/api exec vitest run archive exports subject-export` stays green (the buffer writer's byte tests).

### Task 2: The store reads one original

**Files:**

- Modify: `apps/api/src/modules/photos/photo-bucket.ts` (interface `PhotoStore`, `photoStoreOf`, `sender`'s command union, a new `PHOTO_BUCKET_READ_TIMEOUT_MS = 30_000` and `readMs` in `PhotoStoreTimeouts`)
- Modify: every `PhotoStore` double (Global Constraints)
- Test: `apps/api/src/modules/photos/photo-bucket.get.test.ts` (new)

**Interfaces:**

- Produces: `PhotoStore.get(key: string): Promise<Buffer | null>`.

- [ ] **Step 1: Write the failing tests**: "get reads an original's bytes" (fake client answers `{ Body: { transformToByteArray: async () => Uint8Array } }` → the same bytes, the command is a `GetObjectCommand` with `Bucket` and `Key`); "get answers null for a key that is gone" (`NoSuchKey` 404); "get throws on a missing bucket" (404 `NoSuchBucket`) and "on a 403" with `refusalOf`'s sentences; "get gives up at readMs" (a body that never resolves, `readMs: 20` → rejects "did not answer within 20 ms (read)", and the body's `destroy` was called, so its socket does not stay open). The body read is inside the bound.
- [ ] **Step 2: Run** `pnpm --filter @myclash/api exec vitest run photo-bucket.get` → FAIL.
- [ ] **Step 3: Implement** `get` in `photoStoreOf`: one `boundedCall` around `send` + `Body.transformToByteArray()` (not `sender`), `Buffer.from` the result, `Body.destroy?.()` when the bound gives up; refusals re-told by `refusalOf`, `MissingKey` → `null`. Add `get` to the doubles (`memoryStore`'s `get` returns `null` unless given bytes; the upload tests' doubles throw "the upload never reads").
- [ ] **Step 4: Run** the photos tests and `pnpm --filter @myclash/api typecheck` → green.

### Task 3: The download service

**Files:**

- Create: `apps/api/src/modules/photos/photo-download.ts` (pure: names, CSV, the entry generator), `apps/api/src/modules/photos/photo-download.service.ts` (gates, rows, the `Readable`)
- Modify: `apps/api/src/modules/photos/photos.module.ts` (provider), `photo-window.ts` (`photosExpired`), `photo-moderation.service.ts` (`expired` calls it)
- Test: `photo-download.test.ts`, `photo-download.service.test.ts`, `photo-window.test.ts` (new; doubles in `testing/download-doubles.ts`, listed in `apps/api/tsconfig.build.json`'s excludes if `quality:test-code-leak` asks)

**Interfaces:**

- Consumes: `zipStream`, `ZipStreamEntry` (Task 1); `PhotoStore.get` (Task 2); `photoDeletionInstant`, `eventZone`, `utcToZonedParts`, `csvFile`, `CsvFormat`, `photoTag`, `photosUnavailable`.
- Produces: `photosExpired(event, now): boolean` in `photo-window.ts` (moved from `PhotoModerationService.expired`, which then calls it); `export interface PhotoDownloadFilter { tournamentId?: string; workshopId?: string }`; `export interface DownloadRow { id; status; uploader_name; caption; created_at; original_key; byte_size; crc32; tournament: { name } | null; workshop: { title } | null }`; `photoFileName(row, zone): string`; `photosCsv(rows, zone, format: CsvFormat): Buffer`; `photoEntries(rows, store, zone, format, warn: (msg: string) => void): AsyncGenerator<ZipStreamEntry>`; `PhotoDownloadService.zip(event: PhotoEventRow, filter: PhotoDownloadFilter, format: CsvFormat): Promise<{ filename: string; body: Readable }>`.

- [ ] **Step 1: Write the failing tests.**
  - Pure: `photoFileName` → `2026-11-01_14-03_aaaaaaaa.jpg` for a Paris-clock row at `2026-11-01T13:03:00Z`, and on New York's clock for the same row; `photosCsv` starts with the byte-order mark and the header `file,name,caption,tag,time,status`, rows end in CRLF, a row with `=HYPERLINK("x")` caption → `"'=HYPERLINK(""x"")"`, a name `a,"b"\nc` quoted, `Géraldine` kept, an empty tag and caption as empty cells, a Workshop's title as tag; with `CSV_EXCEL_FR` the separator is `;`.
  - `photoEntries`: yields each photo then `photos.csv` last; a `get` → `null` photo is skipped, warned with its id, and absent from the CSV; a photo whose bytes' length or CRC differ from the row is skipped the same way; a `get` that throws ends the generator with that error; "fetches at most one photo ahead of the sink" (a store double counting started `get`s against consumed entries: never more than consumed + 2); "no more reads after return()": calling `return()` while the generator waits at a `yield` → no further `get`; "no read starts after a return() queued behind a running get": `return()` called while `get` #2 is pending, then #2 resolves → `get` #3 never starts; "a fetch ahead that fails while the generator waits is not unhandled": `get` #2 rejects while the consumer holds entry 1 for two macrotasks → no `unhandledRejection` (listener on `process`), and the next `next()` rejects with that error.
  - Service: no store → `photosUnavailable` (503 code `photos_unavailable`) with no row read; at the deletion instant → `GoneException`, at the instant minus 1 ms → a zip, and with an unreadable end date → a zip (`photosExpired` tests in `photo-window.test.ts`: the instant, minus 1 ms, null); rows read with the exact select `'id, status, uploader_name, caption, created_at, original_key, byte_size, crc32, tournament:tournaments(name), workshop:workshops(title)'`, `eq('event_id')`, `order('id', asc)`, `limit(1000)`, a second page `.gt('id', <last row's id>)` when the first holds 1,000, none when it holds 999 (`selectsFor` / `filtersFor`); two rows with the same `created_at` on both sides of the page boundary are both in the zip, in `created_at, id` order; "a bucket fault on the first photo rejects `zip()`" (`get` #1 throws → `zip()` rejects with `photos_unavailable`, no `Readable` built); "a missing first photo is skipped before the answer starts" (`get` #1 → null, #2 → bytes: `zip()` resolves, the zip holds photo 2 and the CSV); `tournamentId` adds `eq('tournament_id')`, `workshopId` `eq('workshop_id')`; a row read error rejects before a `Readable` exists; `filename` is `<slug>-photos.zip`; the body read to the end through the test reader gives the stored originals and the CSV rows (design: "entries match the stored originals and the CSV rows").
  - Memory (design `:511-512`): 86 photos of 12 MiB (1 GiB), **a fresh `Buffer.alloc` per `get`** (a shared Buffer never grows), through `body` into a sink that reads slowly (one chunk per macrotask): the first chunk arrives after at most 2 `get`s ("the stream starts before all objects are read"), and the sampled growth of `heapUsed + arrayBuffers` stays under 64 MB (a Buffer counts in `arrayBuffers`, not in `heapUsed`). Run with `--expose-gc` only if a sample needs it; falsified by fetching every photo ahead.
  - "a paused reader stops the bucket reads": through `body` (the real `Readable`, not the generator), read one chunk, pause, wait two macrotasks → `get` started at most 3 times (assumption 10: the held chunk, the next one, the fetch ahead). This fails if `Readable.from` is given a larger `highWaterMark` or the generator fetches further ahead.
- [ ] **Step 2: Run** `pnpm --filter @myclash/api exec vitest run photo-download` → FAIL.
- [ ] **Step 3: Implement.** `photoEntries` starts the next `get` before yielding the current entry (one ahead; the promise gets `.catch(() => {})` at once and is kept to await), checks size then CRC, and yields `{ name, bytes, crc32: row.crc32, modifiedAt: utcToZonedParts(created_at, zone) }`; a `stopped` flag set in its `finally` stops any fetch from starting after `return()`; it keeps the included rows for the CSV. The service: store check, `photosExpired(event, now)` (the same injected `now` as `PhotoModerationService`), read every page by id, sort, then build the chunk iterator `zipStream(photoEntries(...))`, pull its first chunk inside `zip()` (wrapping a bucket fault as `photosUnavailable()`, logged with its cause), and return `Readable.from` of a generator that yields that first chunk and then the rest, with `Readable.from`'s defaults (object mode, `highWaterMark` 1; checked on Node 26). Logger warnings name the photo id and the reason, never the caption or name.
- [ ] **Step 4: Run** the same command → PASS; the photos folder's tests green.

### Task 4: The route

**Files:**

- Modify: `apps/api/src/modules/photos/photos.controller.ts` (one handler), `apps/api/src/modules/photos/photo-queue.dto.ts` (`PhotoDownloadQueryDto`: `tournamentId?`, `workshopId?`, both `@IsUUID()`, refused together; `csv?` one of `CSV_FORMAT_PARAMS`, default `standard`, read as the other CSV routes read `?csv=`)
- Test: `photos.controller.download.test.ts` (new: `photos.controller.test.ts` is 364 lines); an edge test through `configureHttpApp` + `inject` if the existing edge tests offer the harness (`common/http-bootstrap.ts` users)

**Interfaces:**

- Consumes: `PhotoDownloadService.zip` (Task 3).
- Produces: `GET /api/v1/events/:eventId/photos/download` → `200 application/zip`, `Content-Disposition: attachment; filename="<slug>-photos.zip"`, `Cache-Control: no-store`, the body streamed.

- [ ] **Step 1: Write the failing tests** (in the shape of the existing organiser tests, `photos.controller.test.ts:190-200`): signed-out → "Authentication required", `zip` never called; the handler calls `moderation.eventForOrganiser(EVENT, userId)` first and passes its Event to `zip` (the club-admin 403 is that method's own, already tested); a gate that throws → `zip` never called; an organiser → the three headers and `reply.send` given the `Readable`; `tournamentId` and `workshopId` together → 400; a non-UUID → 400. Through Fastify `inject`, the body is the zip the test reader reads.
- [ ] **Step 2: Run** `pnpm --filter @myclash/api exec vitest run photos.controller` → FAIL.
- [ ] **Step 3: Implement** the handler (`@Res()`, `this.organisersEvent(eventId, req)` first), its Swagger decorators (`@ApiProduces('application/zip')`), then `pnpm --filter @myclash/api build && pnpm openapi:client`.
- [ ] **Step 4: Run** the photos tests, `route-authz` and `public-routes` tests → green, pins unchanged (UNDECIDED 0, FALSE_PASSES 0).

### Task 5: The admin page's "Download all"

**Files:**

- Create: `apps/web-admin/app/org/[slug]/events/[eventId]/photos/PhotoDownload.tsx`, `usePhotoDownload.ts` (the tag lists and the click)
- Modify: `page.tsx` (place the panel after `PhotoUsage`), `PhotoUsage.tsx` (its deletion-date formatter moves to an exported `deletesOnLabel(summary, locale)` that both use)
- Modify: `packages/i18n/src/messages/{en,fr}/organizer.ts` (`organizer.photos.download.title`, `.filterLabel`, `.allPhotos`, `.tournaments`, `.workshops`, `.listFailed`, `.button`, `.copiesNote` with `{date}`, `.copiesNoteUndated`, `.deleted`; the CSV choice reuses `CsvExportMenu`'s `common.csvExport.*` keys (Q4); storage off reuses `organizer.photos.usage.storageOff`, which `PhotoUsage` already shows)
- Test: `page.download.test.tsx` (new, jsdom, the page fixtures)

**Interfaces:**

- Consumes: the route of Task 4; `apiRequest`, `failureMessage`; `PhotoSummary.storage`, `.deletesAt`, `.timezone`.

- [ ] **Step 1: Write the failing tests**: the panel shows the date line with the Event-clock date and the button; `deletesAt` null → `.copiesNoteUndated` and the button; storage off → no button (the usage box's line says why); `deletesAt` past → `.deleted`, no button; the select lists "All photos", then the Tournaments and Workshops under their group labels; a failed Tournament or Workshop read → only "All photos" and `.listFailed`; clicking re-reads `…/photos/summary`, then clicks a link with `download` set to `${apiUrl}/api/v1/events/<id>/photos/download?csv=<format>` (plus `&tournamentId=<id>` or `&workshopId=<id>` when one is picked); a re-read that fails shows its translated message and clicks nothing; a re-read that answers storage off or a past `deletesAt` clicks nothing and the page now shows that state (the usage line, `.deleted`).
- [ ] **Step 2: Run** `pnpm --filter @myclash/web-admin test photos` → FAIL.
- [ ] **Step 3: Implement**; the link is a created `<a>` with `href`, `download = ''` and `.click()`; the re-read's summary goes back to `usePhotoModeration` (a `setSummary`-style update it exposes) so the whole page shows it; tokenized classes only, as `PhotoUsage`'s section.
- [ ] **Step 4: Run** the same → PASS; rebuild `@myclash/i18n`; `pnpm --filter @myclash/i18n test` green.

### Task 6: Traefik, proof, review, commit

**Files:**

- Modify: `infra/config/traefik/middlewares.yml` (`myclash-compress.compress.excludedContentTypes`), `infra/docker-compose.dev.yml:56` (the same as a label)
- Modify: `scripts/check-infra-review.mjs` + its test: a rule that `myclash-compress` in `middlewares.yml` excludes `application/zip` (the design's specific `:398`; today nothing holds it), beside the existing middleware checks (`:2903`)
- Modify: the design (`[rev slice 7]` notes where the build differs: the stored CRC is the integrity check, Q answers), this plan's "As built"

- [ ] **Step 1:** Write the infra-review test first (a `middlewares.yml` without the exclusion → the rule's error text), see it RED, add the rule, then edit Traefik. **UNVERIFIED: the option name and the label form in v3.7.10** — settle it by starting `traefik:v3.7.10` with the edited file provider and the dev label (`docker run`, `--log.level=DEBUG`) and reading that it loads the middleware without a config error (the cold review confirmed the option and the label form from the docs; the run proves it on the pinned version). Run `pnpm infra:review` and `node scripts/check-edge-plugins.mjs` → green.
- [ ] **Step 2: Independent readers on a real file** (scratchpad script, not CI): write a 4.2 GiB zip of 360 random 12 MiB entries through `zipStream` to disk; `uv run python -c` with `zipfile.ZipFile(...).testzip()` → `None`; Windows `tar -tf` lists 360 entries; a 50 MiB zip likewise; then the operator's own readers, the ones an organiser double-clicks: Windows Explorer "Extract all" and 7-Zip (if installed) on both files; record the results in "As built".
- [ ] **Step 3: Live PostgREST v14.16** (copy `live-gap.cjs`): the download's exact select with the two embeds, `order('id').gt('id', …)` paging over 1,001 seeded rows (seeds dated in the past, 3 of them sharing one `created_at` across the page boundary) → 1,001 rows, none twice.
- [ ] **Step 4: Falsify** (copy `falsify-gap.mjs`): one seeded break per behaviour — Zip64 threshold, extra field, locator offset, DOS time, one-ahead fetch, the `.catch` on the fetch ahead, the `stopped` flag, the first chunk pulled inside `zip()`, skip on null, skip on CRC, CSV last, CSV byte-order mark, CSV escaping, expiry, no store, select string, paging cursor, the sort, filter, organiser gate, headers, the page's re-read before the link, the link's `download`, storage-off hide, the infra-review rule — each RED with counts constant.
- [ ] **Step 5:** Gates (`gates.sh`, 33/33), boot the api image (`boot-4c.sh` model: the new route answers 401 signed out), cold review (`code-architecture-reviewer`, opus), fix, Prettier on the plan. Before staging: `git fetch`, `git log --oneline -1`, `git status --short`; build the stage list from `git status --short` (the generated OpenAPI client included), `git add --pathspec-from-file=<list>`, compare `git diff --cached --stat`; never `git add -A`, `-N` or `git stash`. Commit with `git commit -F`, push, watch CI with the full sha.

## Reviews (2026-11-06, session f81e81f1)

- myclash-plan-review: 2 passes. Pass 1: 1 MAJOR (nothing held the Traefik exclusion: an infra-review rule added), 6 MINOR, 1 NIT, folded. Pass 2 clean. CONVERGED.
- Cold plan-reviewer (opus): 0 BLOCKER, 5 MAJOR (a bucket fault before the first byte reached Fastify's unscrubbed 500; the fetch ahead could reject unhandled; the memory test could not fail; the `created_at` cursor could skip a tie; the CSV skipped `csvFile`), 6 MINOR, 2 NIT, all folded. It confirmed the Zip64 arithmetic, the abort and disconnect paths in `fastify/lib/reply.js`, the archived lock on a GET and the Traefik option.

## As built — 7a, the server (2026-11-06, session f81e81f1)

Tasks 1-4 and Task 6's Traefik part, as planned, with these changes:

- **The stream is hand-built** (`streamOf` in `photo-download.service.ts`), not `Readable.from`. The falsifier found that `Readable.from` emits `close` only after its source's `return()`, and that waits behind a bucket read under way, so one more photo was read after the organiser left. `streamOf`'s `destroy` stops the reads at once. Assumption 12's `stopped` flag became an `AbortSignal` for the same reason.
- **HEAD answers the headers only** (cold code review): Fastify answers HEAD through the GET handler and throws a streamed body away by reading it to the end, so a HEAD would have read every photo from the bucket.
- **A fault after the first byte is logged with the Event id** (its only trace: the browser sees a failed download).
- **The memory test counts the originals held** (at most 3) instead of a `heapUsed` bound: the originals live outside the JS heap, so that bound could not fail.
- The empty-entry `if` in `zipStream` and the DTO's own `.strict()` were removed (nothing could see them); a test now isolates the size check from the CRC check.

Proof: 60 seeded breaks, all red (`falsify-7a.mjs`); real files through `zipStream` (4,529,897,010 bytes, 361 entries, and 50 MB) read by Python `zipfile.testzip`, 7-Zip, Windows `tar` and Windows Explorer (every extracted CRC equal); live PostgREST v14.16 over the replayed PG17: the built `rows()` read 1,001 photos over two pages, none twice, a tie across the boundary kept; Traefik v3.7.10 loads both forms of the compress middleware, enabled, with no error; gates 33/33; the api image boots and the route answers 401 signed out and 400 to a bad query.

Deferred minors (cold code review): a throw inside `push` would be unhandled (cannot happen: every chunk is a Buffer); the read under way when the organiser leaves runs to its end (up to 30 s, 12 MiB); an emptied bucket with rows left makes the first byte wait for every missing photo's read; Zip64 by entry count is proven by the test reader only (~29,000 photos is the cap's maximum).

## As built — 7b, the page (2026-11-06, session f81e81f1)

Task 5 as planned, with these changes:

- **The button is `CsvExportMenu`**: its two choices are the spreadsheet `photos.csv` is written for (470), so there is no second choice on the box. Its label is "Download zip" and the box's heading "Download the photos" (the button no longer says "all" when one Tournament is picked).
- **A stale check reloads the page** (the existing reload) rather than writing a new summary into the hook, and moves the box's own clock to the check's time: a deletion instant that passed with the page open now hides the button and says the photos are deleted (cold code review).
- **The button is busy during the check** (a second pick started a second zip), and no link is followed after the page is left (cold code review).
- The tests pin the date (the fixture's deletion date would have turned them red on 8 December 2026).

Proof: 14 page tests; the Photos page suite 39/39; 22 seeded breaks, all red (`falsify-7b.mjs`); gates 33/33.

Deferred minors (cold code review): `failureMessage(...) ?? failed` cannot fire (null only on abort; the type asks for it); a browser clock behind the server's can follow the link just after the 410 begins (named in the hook); the two lists' shape is local to the page.
