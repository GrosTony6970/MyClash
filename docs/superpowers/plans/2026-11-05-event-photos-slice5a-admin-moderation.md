# Event photos — slice 5a: the organiser's Photos page (mode, QR poster, cap, queue) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An organiser opens Event → Photos in the admin site. There they switch photos Off / Live / Approve first, print the QR poster or retire its link, see how much of the hourly and storage caps is used and when every photo will be deleted, and work the queue: Waiting and All, with Approve and Delete on each photo and its preview shown through a signed link. A deleted photo's images leave the bucket at once.

**Architecture:**

- API: a `PhotoModerationService` (organiser gate = `PhotoLinkService`'s, moved to one helper) with four calls: `summary`, `list`, `approve`, `remove`. `remove` deletes the row (the 0250 trigger tombstones both keys) and queues a `drain` job on the `photo-cleanup` queue, so the images go now, not at the next 5-minute tick.
- The store gains `link(key, now)`: a presigned GET, 15 minutes, its signing time rounded down to 5 minutes so the URL is stable for 5 minutes and browsers cache it. Signing is local: no bucket call, no wait.
- web-admin: `events/[eventId]/photos/` page, glue hooks over `apiRequest`, plain modules for the poster HTML and the upload URL. The mode is written through the existing `PATCH events/:id { photoMode }`.
- No migration (slice 5b adds the `photos` staff job and its migration).

**Tech Stack:** NestJS + `@nestjs/bullmq`, `@aws-sdk/client-s3` 3.1154.0 + **new** `@aws-sdk/s3-request-presigner` 3.1154.0 (same version), Next 16 client page, `qrcode.react` (already in web-admin), vitest + testing-library.

**Spec:** `docs/superpowers/specs/2026-11-03-event-photos-design.md`: "Moderation", "Storage and deletion" (signed links), "When the bucket is slow or down" (moderation queue), "Where it shows up" §1.

## Operator rulings for this slice (2026-11-05, this session)

- **434** Slice 5 (moderation) before slice 4 (public feed): the mode switch and QR poster are what make the feature usable, and Delete exists before anything is public.
- **435** Slice 5 is two commits: **5a** admin page + moderation API (this plan), **5b** the `photos` staff job + web-staff `/photos`.
- **436** The Reported tab and Keep move to **slice 4**, with the reports table and the Report button. 5a's queue is Waiting / All, actions Approve / Delete.
- **437** (5b) A `photos` staff login keeps working on a completed Event, until archive. Other jobs keep today's rule.

## Assumptions (mine; the operator reads them in the report)

1. **The queue pages by 60, newest first, keyset on `created_at`** (`lt` the last row's). The cursor is the row's `created_at` exactly as PostgREST returns it (microseconds, `+00:00`), never re-formatted through `Date` (that drops the microseconds and could skip a row). The query schema accepts it with `z.iso.datetime({ offset: true })`. Two photos of one Event written in the same microsecond could straddle a page; accepted.
2. **The cap status reads `event_photo_usage(event, nil-uuid)`** and ignores its device column: no migration for a second counting function. The caps (300/h, 15 GB) are the already-exported `EVENT_PHOTOS_PER_HOUR` / `EVENT_PHOTO_BYTES` (`photo-upload.service.ts:41-42`), returned by `summary`, so the page never copies a number.
3. **Approve works in any mode, Off included.** "Approved" is stored, not derived (design, "Mode changes"). Approving an approved photo is a no-op 200.
4. **Delete is final and asks first** (`useConfirm`). The drain is queued **without awaiting it** (`void queue.add(…).catch(log)`): the BullMQ connection keeps ioredis's offline queue (`workers.module.ts:42-56`, no `enableOfflineQueue: false`), so with Redis down an awaited `add` would hold the DELETE for minutes ("nothing hangs"). The row is gone and the tombstone exists, so the 5-minute tick removes the images anyway. One drain per delete, no deduplication: a drain that finds nothing is one query.
5. **With no bucket configured** the queue still loads; `previewUrl` is null and the tile says "image unavailable". The summary says `storage: 'off'` and the page shows one line, "Photo storage is not set up".
6. **From the deletion instant on, `list` returns no photos and `summary.deletesAt` is in the past** (one owner, `photoDeletionInstant`). The expiry job removes them within minutes; the page must not show tiles whose images are going.
7. **The poster** is one A4 page: the Event name, the QR code (the on-screen `QRCodeSVG`'s markup, scaled), one line "Scan to send your photos", and the Event's public address as text. Printed through `openPrintWindow` + the print shell's `printDocument`.
8. **`NEXT_PUBLIC_PUBLIC_APP_URL` gets one reader in web-admin** (`src/lib/public-app-url.ts`). Four places read it today with the same fallback (`staff/page.tsx:28`, `login/AuthPage.tsx:70`, `live/BoardRowActions.tsx:8`, `org/[slug]/leagues/page.tsx:14`); all four are re-pointed, a fifth copy is not added. **As built:** the reader takes `staff-url.ts`'s shape. The key is in `REQUIRED_PROD_ENV` (`next.config.ts:24`), so the old `https://app.myclash.fr` fallback only fired in local dev, and sent dev links to production. The fallback is now `http://localhost:3001` (`.env.example`), trimmed, no trailing slash. Production is unchanged.
9. **No realtime, no polling** on the admin page: a Refresh button and a reload after each action. The design asks the 30 s refresh only of the public feed. **Signed links age** (10-15 minutes left at load): a tile whose image fails to load when the list is more than 10 minutes old reloads the list. Otherwise it shows "image unavailable". **As built:** no "once per load" flag (the falsifier showed nothing could see it): failures at once batch into one reload, and the fresh read cannot loop, because a broken image on a fresh read reloads nothing. A tile's broken state is keyed by its link, so the fresh link is tried.
10. **The mode is a radio group** (native `<input type="radio">` in a `<fieldset>`, tokens only), not `SegmentedTabs`: that is a `tablist` (`SegmentedTabs.tsx:33,43`), the wrong meaning for a setting, and it has no `disabled` (`:10-17`). A disabled `<fieldset>` locks it on an archived Event. The queue's Waiting / All stay `SegmentedTabs` (they are tabs).

## As built: the cold plan review (plan-reviewer, opus), folded

- M1 archived-lock pins → Task 2 Files. M2 complexity → `photo-bucket.link.test.ts`, the signer in its own function, the moderation tests split in two. M3 → assumption 10. M4 → assumption 4, a never-settling `add` cell.
- MINOR: the hook checks `code === 'photo_not_found'` before `failureMessage` (which returns a 4xx's English `detail`, `failure-message.ts:253`); `<img>` carries the repo's `@next/next/no-img-element` disable line (as `app/admin/clubs/page.tsx:1084`); stale links → assumption 9; four URL readers → assumption 8; the web-public end is `src/lib/photos/photo-link-token.ts`; scratchpad scripts named by absolute path.
- NIT: no export step (already exported); the worker header lists `drain`; Approve is a quiet button (one accent per page, `docs/design/web-admin.md:59`); drain dedup declined (assumption 4).
- Open, for the operator: the bucket name must have no dot (the client addresses the bucket by virtual host, `photo-bucket.ts:174-188`; a dotted name breaks the browser's certificate check on every signed link).

## As built: the cold code review (code-architecture-reviewer, opus), folded

- I1 Load more raced the tab change and a write's reload: each read of page 1 starts a generation; a Load more answering in an older one is dropped; the button is closed while it loads.
- I2 an arrow key from Off saved Live on its way to Approve first: the modes read Off / Approve first / Live (strictest first); the fieldset closes only on an archived Event, and a change while saving is ignored (closing it threw the keyboard focus to the page).
- I3 no test saw the queue's sort: the rows are seeded oldest first.
- Minor folded: a read error is cleared by the next good read, while a write's refusal outlives its reload (two messages, one shown); `waiting` is 0 from the deletion instant on; the tile links to the original only when both links exist; Print poster is quiet (one accent); `PhotoLink` moved to `packages/types` (one owner).
- Declined: a deduplicated drain job (BullMQ keeps a failed job's id, which would block every immediate drain for a day; the 5-minute tick retries anyway, at the cost of one failed job per delete during a bucket outage); a constructor-injected clock.
- Named, not changed: a 4xx from `PATCH events/:id` shows the server's English `detail` (pre-existing, every page that uses `failureMessage`).
- Falsifier: 33 seeded breaks, all red (`falsify-moderation.mjs` in the session scratchpad). The 26th of the first run went green ("reload once per read"): that flag could not be seen, so it was removed (assumption 9).
- Complexity: every function of this slice is under 50 lines; the baseline only re-points `AuthPage` and `OrgLeaguesPage` (moved by an import line), per-file counts unchanged.

## Global Constraints

- Authz: every new route is org `admin` of the Event's club (`assertOrgRole(…, 'admin')`, as `PATCH events/:id`). Reads and writes alike: the queue shows unapproved photos.
- Archived Event: approve, mode and New link refused by `EventReadOnlyGuard` (`events/:eventId/…` resolves by path); reads allowed. **Delete is allowed, `@AllowOnArchivedEvent()`, for privacy** (design, "Constraints", archived-lock ledger line). Completed Event: everything allowed.
- Signed links: approved **and** waiting photos for the organiser. The design's "approved only" and "a waiting photo is unreachable" are the public's rule; its preview line says previews feed "the public list and the moderation queue. The original opens on tap". So each queue photo carries a preview link and an original link. 15 minutes, expiry rounded down to 5 minutes.
- `event_photos` stays deny-all; the API reads it as the service role.
- `route-authz.test.ts`: each new handler reaches `assertOrgRole` within 4 hops. Pins stay UNDECIDED 0, DECIDED_ELSEWHERE 19, FALSE_PASSES 0.
- Every user-facing string in EN and FR (`organizer.photos.*`). Tokenized UI only; read `docs/design/known-deviations.md` before copying a pattern (no raw `Button` status variants, no hand-rolled `EmptyState`, named z-index tokens).
- No real photo or personal data in fixtures (`testing/synthetic-jpeg.ts` style; names like "Léa" as in existing tests are fine). One commit. Stage explicit paths.
- OpenAPI: regenerate `packages/api-client/src/generated/schema.ts` (`emit-openapi`), and every `/api/v1/…` literal the page calls must exist (`frontend-route-contract.test.ts`).
- The API image: the new presigner package must be in the image and the image must BOOT (`boot-image.sh`), not only build.

## Review Focus

1. **A photo id from another Event.** `POST events/A/photos/<photo of B>/approve` and the delete must answer 404 and change nothing: every write filters on `id` AND `event_id`. → Task 2 cells.
2. **An organiser of another club.** Every one of the four routes refuses before reading a photo. → Task 2, one cell per call with `assertOrgRole` rejecting.
3. **The bucket down while moderating.** The list loads (signing is local); delete answers 200 and the tombstone waits. A presign that throws (bad config) must not fail the whole list: that photo's `previewUrl` is null. → Task 1, Task 2.
4. **Two organisers delete the same photo.** The second gets 404, not 500; two drains at once are safe (slice 3). → Task 2.
5. **The signed URL's stability.** Two calls in the same 5-minute window give the same URL; the next window a different one; it never expires sooner than 10 minutes after it is handed out. → Task 1.

---

### Task 1: The store signs a preview link

**Files:**

- Modify: `apps/api/package.json` (`"@aws-sdk/s3-request-presigner": "3.1154.0"`), `pnpm-lock.yaml` (via `pnpm --filter @myclash/api add @aws-sdk/s3-request-presigner@3.1154.0`; then diff `pnpm-workspace.yaml`: an install may append to `minimumReleaseAgeExclude`, revert that)
- Modify: `apps/api/src/modules/photos/photo-bucket.ts`
- Create: `apps/api/src/modules/photos/photo-bucket.link.test.ts` (`photo-bucket.test.ts` is at 394 of 400 lines; `photoStoreOf` at 42 of 50, so the default signer is its own function `photoLinkSigner(config: PhotoBucketConfig)`)
- Check: `apps/api/Dockerfile` copies `apps/api/node_modules` whole (no edit expected; prove it in Task 5's boot)

**Interfaces:**

- Produces: `PhotoStore.link(key: string, now: Date): Promise<string>`; `export const PHOTO_LINK_TTL_S = 900`; `export function photoLinkSigningDate(now: Date): Date` (floor to 5 minutes, UTC).
- `photoStoreOf(setting, client?, timeouts?, presign?)`: the optional 4th argument is `(key: string, signingDate: Date, expiresIn: number) => Promise<string>`, default built from a real `S3Client` with `getSignedUrl(client, new GetObjectCommand({ Bucket, Key }), { expiresIn, signingDate })`.

- [ ] **Step 1: Failing tests** in `photo-bucket.link.test.ts`:
  - `photoLinkSigningDate floors to the 5-minute mark`: `12:04:59.999Z → 12:00:00.000Z`, `12:05:00.000Z → 12:05:00.000Z`.
  - `link signs the preview key with 900 s from the floored time`: with a recording `presign` double, `link('events/e/p/preview.jpg', 12:03Z)` calls it with `(key, 12:00Z, 900)`.
  - `the real signer: same URL inside one window, another in the next, never expiring sooner than 10 minutes`: `photoStoreOf(on-setting)` with fixed fake credentials (no network: presigning is local); `link(k, 12:01Z) === link(k, 12:04Z)`, `!== link(k, 12:06Z)`; the URL has `X-Amz-Expires=900`, `X-Amz-Date=20261105T120000Z`, the key path, and no `x-id=PutObject`.
- [ ] **Step 2:** `pnpm --filter @myclash/api exec vitest run src/modules/photos/photo-bucket` → FAIL.
- [ ] **Step 3:** add the dependency, implement. `GetObjectCommand` joins the imports. `link` does not go through `boundedCall` (no I/O); say so in its doc line.
- [ ] **Step 4:** the same run → PASS; `pnpm --filter @myclash/api typecheck`.

---

### Task 2: The moderation service and its four routes

**Files:**

- Create: `apps/api/src/modules/photos/photo-organiser.ts` — `organisersEvent(supabase, orgs, eventId, userId): Promise<PhotoEventRow>`, one literal select `'id, organization_id, slug, name, start_date, end_date, timezone, photo_mode, photo_token_version'` (a variable select hides from the schema-conformance sweep); `PhotoLinkService` re-pointed to it (its private copy deleted).
- Create: `apps/api/src/modules/photos/photo-moderation.service.ts`, and its tests in two files from the start: `photo-moderation.reads.test.ts` (summary, list, signing, instant) and `photo-moderation.writes.test.ts` (approve, remove, the drain job). Run them by the prefix `photo-moderation`.
- Modify: `photos.controller.ts`, `photos.controller.test.ts`, `photos.module.ts` (`BullModule.registerQueue({ name: PHOTO_CLEANUP_QUEUE })`, as `hema-ratings.module.ts:8-14`)
- Modify: `apps/api/src/workers/photo-cleanup.worker.ts` + its test: job `PHOTO_DRAIN = 'drain'` runs `cleanup.drain()` only; the header's job list gains it.
- Modify: `apps/api/src/common/event-readonly/archived-lock.routes.test.ts`: `DELETE events/:eventId/photos/:photoId` joins the exact allowed list (`:80-108`); the `placed` pin goes 186 → 188 (approve + delete, both placed by their Event), with its comment line (`:137-139`). Count it after the build; if it is not 188, find out why before changing the number.
- Modify: `packages/types/src/event-photos.ts`: the response types below (one owner, read by the API and web-admin).

**Interfaces (in `packages/types/src/event-photos.ts`):**

```ts
export type PhotoQueueFilter = 'waiting' | 'all';
export interface ModerationPhoto {
  id: string;
  status: 'waiting' | 'approved';
  uploaderName: string | null;
  caption: string | null;
  tag: { kind: 'tournament' | 'workshop'; name: string } | null;
  createdAt: string; // ISO
  previewUrl: string | null;
  originalUrl: string | null; // opens on tap
}
export interface PhotoQueuePage {
  photos: ModerationPhoto[];
  next: string | null;
} // next = createdAt cursor
export interface PhotoSummary {
  mode: PhotoMode;
  eventSlug: string;
  eventName: string;
  storage: 'on' | 'off';
  lastHour: number;
  perHourCap: number;
  bytes: number;
  bytesCap: number;
  waiting: number;
  deletesAt: string | null; // photoDeletionInstant, ISO
  timezone: string; // eventZone(event.timezone).zone, to show deletesAt on the Event's clock
}
```

Routes (all `@ApiCookieAuth('sb-access-token')`, `ParseUUIDPipe` on ids, `requireRequestUserId`):

- `GET events/:eventId/photos/summary` → `PhotoSummary`
- `GET events/:eventId/photos?filter=waiting|all&before=<created_at>` → `PhotoQueuePage` (query validated by a Zod schema, `before: z.iso.datetime({ offset: true }).optional()`; a bad `filter` or `before` is 400)
- `POST events/:eventId/photos/:photoId/approve` (200) → `{ id, status: 'approved' }`
- `DELETE events/:eventId/photos/:photoId` (204)

Service: `summary(eventId, userId)`, `list(eventId, userId, filter, before?)`, `approve(eventId, photoId, userId)`, `remove(eventId, photoId, userId)`. `remove`'s handler carries `@AllowOnArchivedEvent()`, and the archived-lock routes test must stay green. The list select is a literal, `id, status, uploader_name, caption, created_at, preview_key, original_key, tournament:tournaments(name), workshop:workshops(name)`, `.eq('event_id')`, `.order('created_at', { ascending: false }).limit(60)`, `.eq('status','waiting')` for the waiting filter. `waiting` in the summary is `select('id', { count: 'exact', head: true })`.

- [ ] **Step 1: Failing tests** (the two `photo-moderation.*.test.ts` files, the `common/testing/supabase-chain.ts` double; assert every SELECT string, per memory "the mock ignores the projection"):
  - `refuses a non-admin before reading any photo` × 4 calls (`assertOrgRole` rejects; no `event_photos` read recorded).
  - `404 for an unknown Event`.
  - `lists waiting newest first, 60 at a time, and gives the cursor of the 60th`; `all` drops the status filter; `before` adds `.lt('created_at', before)`; fewer than 60 → `next: null`.
  - `maps the tag from the embedded tournament or workshop, null when neither`.
  - `signs each preview and original; a signer that throws leaves that photo's URLs null and the rest signed`; `no store → every URL null, summary.storage 'off'`.
  - Archived: the delete route carries the allow marker, approve does not (read the metadata with `Reflector`, as the archived-lock tests do).
  - `returns no photos and next null from the deletion instant on` (fixed clock 1 ms before → listed; at the instant → empty).
  - `approve updates status on id AND event_id; no row → 404 { code: 'photo_not_found' }` (assert both `.eq` filters).
  - `remove deletes on id AND event_id, then queues one 'drain' job` (the delete ends in `.select('id')`, to see a row went); `no row → 404 { code: 'photo_not_found' }, no job`; `a queue add that rejects → resolves, logs, row still deleted`; `a queue add that never settles → remove still resolves` (the add returns `new Promise(() => {})`).
  - `summary reads usage with the nil device and returns the caps 300 and 15e9, the waiting count, deletesAt from photoDeletionInstant`.
  - Worker: `'drain' drains and does not expire`.
  - Controller: the four routes call the service with the user id; `filter=bad` → 400; `before=2026-11-05T12:00:00.123456+00:00` (the PostgREST shape) is accepted and passed through unchanged; `before=yesterday` → 400.
  - Reads: the cursor `next` is the 60th row's `created_at` string as the double returned it, byte for byte.
- [ ] **Step 2:** run them → FAIL.
- [ ] **Step 3:** implement. The service takes `now: () => Date` (default `() => new Date()`) for the instant cells. `remove`'s queue add: `{ removeOnComplete: true, removeOnFail: { age: 86_400, count: 100 } }`, not awaited (`void this.queue.add(…).catch((err) => this.logger.warn(…))`).
- [ ] **Step 4:** PASS; then `pnpm --filter @myclash/api exec vitest run src/common/auth/route-authz.test.ts src/common/routes` and the whole photos folder + workers.
- [ ] **Step 5:** rebuild `packages/types` dist, then `pnpm openapi:emit`, `pnpm openapi:client`, and `pnpm quality:openapi-drift` green (`package.json:37-39`).

---

### Task 3: The upload URL, the poster, one reader of the public address

**Files:**

- Modify: `packages/types/src/event-photos.ts`: `photoSendPath(eventSlug: string, token: string): string` → `/e/${encodeURIComponent(slug)}/photos/send#${token}`. The other end is web-public's `apps/web-public/src/lib/photos/photo-link-token.ts` (it reads the token from the hash): a cell in its test feeds it the hash of `photoSendPath('open-2025', 'tok')` and gets `tok` back, and asserts the path part equals `/e/open-2025/photos/send`, the folder `app/e/[eventSlug]/photos/send/` with the slug filled in.
- Create: `apps/web-admin/src/lib/public-app-url.ts` (`publicAppUrl(): string`, the existing expression moved), re-point all four readers (assumption 8).
- Create: `apps/web-admin/app/org/[slug]/events/[eventId]/photos/photo-poster.ts` + test: `photoPosterHtml({ eventName, qrSvg, address, labels }): string` → `printDocument(title, [sheet])`.

- [ ] **Step 1: Failing tests:**
  - `photoSendPath` keeps the token after `#` (never in the path or query) and encodes the slug.
  - poster: the Event name is escaped (`<b>` → `&lt;b&gt;`, through `escapeHtml` of `@myclash/types`); the QR SVG appears once, unescaped; the address is escaped; the result is one A4 sheet.
- [ ] **Step 2:** FAIL → implement → PASS (`pnpm --filter @myclash/types test`, `pnpm --filter @myclash/web-admin exec vitest run …photos …staff`).

---

### Task 4: The Photos page

**Files** (all under `apps/web-admin/app/org/[slug]/events/[eventId]/photos/`):

- `page.tsx` (thin client page: `BackLink`, h1, description, the four parts below), `usePhotoModeration.ts` (glue: summary + page reads with a cancel flag, `approve`, `remove`, `setMode`, `rotateLink`, `loadMore`, each write reloads; a refusal with `code === 'photo_not_found'` is checked FIRST and shows `organizer.photos.alreadyDeleted`, every other one goes through `failureMessage(res, t, t('common.error'))`; `isReadOnly` from `useEventStatus`), `PhotoModePanel.tsx` (a radio group Off / Live / Approve first in a `<fieldset disabled={isReadOnly}>` → `PATCH /api/v1/events/:id { photoMode }`, assumption 10), `PhotoLinkPanel.tsx` (QR from `GET …/photos/link`, the address, Copy, Print poster, New link behind `useConfirm`), `PhotoUsage.tsx` (n / 300 this hour, GB / 15 GB, "Deleted on" + the date in the Event's zone, or "Photo storage is not set up"), `PhotoQueue.tsx` (`SegmentedTabs` Waiting (count) / All, a grid of tiles: preview `<img loading="lazy">` (with the repo's `@next/next/no-img-element` disable line, as `app/admin/clubs/page.tsx:1084`; a signed URL is not for `next/image`) with an "image unavailable" fallback on `onError` or null URL, and the stale-link reload of assumption 9; name · caption · tag · time; Approve (waiting only, a quiet button: one accent per page, `docs/design/web-admin.md:59`) and Delete behind `useConfirm`; Load more; `EmptyState` from `@myclash/ui`).
- Tests: `page.test.tsx`, `page.archived.test.tsx` (reuse `../archived-page.fixtures`).
- Modify: `apps/web-admin/src/components/event-nav-groups.ts` (+ test: 26 hrefs), item `{ href: 'photos', labelKey: 'organizer.eventHub.sections.photos', icon: 'photos' }` in the `admin` group after `notifications`.
- Modify: `packages/ui/src/components/NavIcon.tsx` (`'photos'` → lucide `camera`), regenerate `nav-icon-glyphs.ts` with `node packages/ui/scripts/generate-nav-icons.mjs`.
- Modify: `packages/i18n/src/messages/{en,fr}/organizer.ts` (`organizer.photos.*`, `organizer.eventHub.sections.photos`).

- [ ] **Step 1: Failing tests** (`apiRequest` mocked by path, as `staff/page.archived.test.tsx`):
  - shows the mode, the usage line `12 / 300` and the deletion date; the waiting tab count.
  - Approve on a tile POSTs `/api/v1/events/ev1/photos/p1/approve` and reloads; Delete confirms, DELETEs, reloads; cancel sends nothing.
  - choosing Live PATCHes `/api/v1/events/ev1` with `{ photoMode: 'live' }`; a refusal shows its message and the switch shows the stored mode.
  - a 404 `photo_not_found` on Approve or Delete shows the translated "This photo was already deleted" (not the server's English) and reloads.
  - New link confirms then POSTs `…/photos/link/rotate`, and the QR value changes.
  - a null `previewUrl` renders the "image unavailable" tile; `storage: 'off'` renders the not-set-up line.
  - Load more appends the next page with `before=<cursor>`.
  - an image error with the list loaded 11 minutes ago reloads the list once; a second error in that load does not reload again; an error 2 minutes after load shows "image unavailable" and reloads nothing.
  - tapping a tile's image opens `originalUrl` in a new tab (`target="_blank" rel="noopener noreferrer"`).
  - archived: Approve, New link and the mode switch are disabled; **Delete stays enabled**.
- [ ] **Step 2:** FAIL → build → PASS. Read `DESIGN.md`, `docs/design/` (admin delta) and `known-deviations.md` before the markup.
- [ ] **Step 3:** `pnpm --filter @myclash/i18n test`, the nav tests, `pnpm --filter @myclash/ui test`, web-admin typecheck + lint.

---

### Task 5: Falsify, image boot, gates, review, commit

Scripts live in the session scratchpad, not the repo: `C:\Users\Tony\AppData\Local\Temp\claude\f--Github-Repo-MyClash\8c6d1d65-0f24-40ba-ace9-b3f15ff3e2e9\scratchpad\` holds `gates.sh`, `boot-image.sh` and `falsify-deletion.mjs` (copied from slice 3's).

- [ ] **Seeded breaks** (copy `falsify-deletion.mjs`'s row shape into a new `falsify-moderation.mjs` there), each must go RED:
  - the drain `add` awaited (the never-settling cell);
  - the `photo_not_found` check moved after `failureMessage`;
  - the stale-link reload firing twice in one load;
  - approve without `.eq('event_id', …)`; remove without it;
  - `assertOrgRole` call removed from `organisersEvent`;
  - the drain job not queued;
  - the signing date not floored; TTL 600;
  - a throwing signer failing the whole list;
  - the deletion-instant check removed from `list`;
  - the page's Delete without the confirm;
  - the archived page enabling Approve; the archived page disabling Delete;
  - `@AllowOnArchivedEvent()` removed from the delete route.
- [ ] **Image:** build the API image, boot it next to a throwaway Redis (`boot-image.sh`), and in it `node -e "require('@aws-sdk/s3-request-presigner')"` from `/app/apps/api`.
- [ ] **Gates:** `gates.sh` (full `myclash-gates` chain), each green alone; `i18n#test` and `api#test` run directly (turbo caches them).
- [ ] **Cold review:** `code-architecture-reviewer` (opus) on the diff; fold or name each finding.
- [ ] **Commit** (one, explicit paths, `git commit -F`): `feat(photos): an organiser switches photos on, prints the QR poster and approves or deletes each photo`.
