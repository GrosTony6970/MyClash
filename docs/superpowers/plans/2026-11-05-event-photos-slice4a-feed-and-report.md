# Event photos — slice 4a: the public photo list and the Report call (server) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the operator asked for a native build) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The API serves an Event's approved photos to the public, newest first, with an optional Tournament or Workshop filter, and takes an anonymous Report on a public photo, once per phone and photo. A moderator's Keep clears a photo's reports. The Reported tab that lists them is slice 4c.

**Architecture:**

- Migration `0252_event_photo_reports.sql`: one row per (photo, phone). It goes with its photo (`ON DELETE CASCADE`), so every photo deletion path already covers it. RLS on, no policy, as `event_photos`.
- `photo-public.service.ts` (`PhotoPublicService`): `feed` and `report`. Both start from the Event the caller may see (`readableEvent`, `common/auth/competition-visibility.ts:171-186`), then read the Event's photo columns (`photoEvent`, `photo-organiser.ts:38-52`).
- Two routes on `PhotosController`: `GET events/:eventId/photos/public` and `POST events/:eventId/photos/:photoId/report`, both `@Public()`. The Report reads and sets the phone cookie exactly as the upload does; those lines move into one private method used by both.
- Keep: `PhotoModerationService.keep(event, photoId)` deletes the photo's report rows; routes `POST events/:eventId/photos/:photoId/keep` (organiser, open on an archived Event, 447) and `POST staff/photos/:photoId/keep` (the `photos` login, stops at archive, 438).
- The signing of a photo's two links moves from `PhotoModerationService.linksOf` (`:201-218`) to one module function both services call.

**Tech Stack:** NestJS, Supabase service client (PostgREST), vitest with the seeded double (`common/testing/supabase-chain.ts`), PG17 replay, the cascade probe.

**Spec:** `docs/superpowers/specs/2026-11-03-event-photos-design.md`: Goals 5-6, "The public", "Storage and deletion" (signed links), "Verification" (API tests).

## In plain words

A friend at home opens the Event's photo page (slice 4b builds the page). The server hands it the approved photos, newest first, 30 at a time. Waiting photos never leave the server. When photos are Off, the list is empty. After the deletion date, the list is empty too. A photo tagged with a Tournament the public may not see yet (a draft) still shows, but without its tag.

Under each photo is a Report button. Tapping it tells the organisers "look at this one". The photo stays on show (design Goal 6). Each phone counts once per photo: tapping Report ten times is one report. A phone can report at most 30 photos an hour. The server never says how many reports a photo has to the public.

Reports work after the Event is archived (ruling 447): a person who finds a photo of themselves on Wednesday can still report it. The server also gets Keep: it clears a photo's reports, and a new report later counts again (448). Nobody sees the reports or a Keep button yet: the Reported tab on both moderator screens is slice 4c.

**One part moves to 4c:** the server's "Reported" list (which photos have reports). Adding a tab to the server's list of tabs stops both moderator screens from building until they show it, so it lands with the screens.

## Operator rulings for this slice

- **445** (2026-11-05 ~17:30) Story: slice 4 is the server, the public page and the moderators' Reported tab. Ruling: **three commits: 4a server (reports, the public list, Report, Keep), 4b the public Photos page, 4c the Reported tab and Keep on the admin page and the staff screen.** (The server's Reported filter moves to 4c, see "In plain words".)
- **446** (~17:30) Story: the Event home already shows Live now, Participants, Tournaments, Workshops, Schedule, Venues. Ruling: **a Photos page at `/e/<event>/photos` and a home card linking to it, shown when photos are not Off.** (4b.)
- **447** (~17:30) Story: the Event is archived on Tuesday; on Wednesday Léa reports a photo of herself. Ruling: **the report is taken after archive; the organiser may Keep or Delete after archive; the volunteer login still stops at archive (438).** (Both routes here.)
- **448** (~17:30) Story: Tom reports, the organiser taps Keep, Tom reports again the next day. Ruling: **Keep clears the reports; a new report after Keep puts the photo back in Reported.** (Keep deletes the rows, so the key takes a new one.)

## Assumptions (mine; the operator reads them in the report)

1. **30 photos per page**, as a phone screen shows ~6; the queue's 60 is for moderators.
2. **A phone may report 30 photos an hour** (`PHOTO_REPORTS_PER_HOUR`), counted from the table. Over it: 429 `photo_report_limit`. A second report of the same photo by the same phone answers 200 and adds nothing. The phone is the `mc_photo_device` cookie: a phone that clears it is a new phone. That is the design's "convenience limit, not a security boundary" (`photo-device.ts:11-13`); a report hides nothing, so the worst case is a noisy Reported tab.
3. **A report on a photo the public cannot see answers 404 `photo_not_found`**: a waiting photo, another Event's photo, photos Off, past the deletion instant. A waiting photo is never confirmed to exist.
4. **The list takes the Event by id** (`:eventId`, as every photo route). web-public's Event read carries the id.
5. **Who sees the list:** whoever may see the Event (`readableEvent`): the public for a public Event (archived included, `event-read-gate.ts:11-22`), insiders also on a draft or test Event. A hidden Event answers 404, an unknown one 404.
6. **Tags:** a Tournament tag is dropped when that Tournament is hidden from the caller (`hiddenTournamentIds`, `competition-visibility.ts:317-330`). A Workshop tag is dropped when the Workshop's status is not public (`PUBLIC_WORKSHOP_STATUSES`, `workshop-visibility.ts:6`), for everyone, as the public Workshop list does (`workshops.service.ts:286-306`). Filtering by a hidden Tournament or a non-public Workshop answers an empty page.
7. **The list's throttle** is `PUBLIC_LIVE_READ_THROTTLE` (600/min/IP: a hall shares one IP). The Report stays on the global 120/min/IP (a write, `throttle-profiles.ts` comment).
8. **The hourly count comes before the dedup**: a phone at 30 reports that reports a photo again gets 429, where it would have added nothing. Tested.
9. **An unknown stored photo mode closes the door**: an empty list, a Report 404. (The organiser's summary throws on it, `photo-moderation.service.ts:92-93`.)
10. **A plain `TRUNCATE event_photos` is refused from now on** (Postgres refuses to truncate a table another table's foreign key points at, even an empty one). Nothing in the app truncates it; the probe's case becomes `TRUNCATE … CASCADE`.
11. **Keep on a photo with no reports** answers 200 and changes nothing; on a photo not in the Event, 404 `photo_not_found`, as Approve.

- **449** (2026-11-05 ~18:15, from the cold code review) Story: a script that refuses cookies is a new phone on every tap, so only the per-address limit (120/min) brakes it: ~7,000 reports an hour on one photo, kept until the photo goes. Ruling: **a cap per photo: once a photo holds 20 reports, a Report is answered "reported" and not stored.** (`PHOTO_REPORTS_PER_PHOTO`.)

## As built: the cold code review (code-architecture-reviewer, opus), folded

- No Critical. Important, folded: no test pinned the hourly limit to the phone (a second phone's 30 reports now seeded in the passing case); the Report had no brake a cookie-less script could not dodge (ruling 449, the per-photo cap, test-first). Minor, folded: a feed case's name (an unknown Workshop, not another Event's); the `PHOTO_REPORTS_PER_HOUR` comment; the staff controller's docstring; the race of the hour's count and the write named in the Report's docstring. The failing-write double now fails the write only (no spy on a private method, which broke typecheck).
- Named, not fixed: `openEvent` reads `events` twice (`readableEvent`, then `photoEvent`); an Event deleted between the two reads answers `photoEvent`'s own 404 wording (a narrow race). No test shows an insider listing or reporting on a draft Event (the shared helper is tested elsewhere). `photo-links.ts` has no test of its own: the feed's and the queue's no-bucket and failing-signer tests hold it. `photoNotFound` lives in the moderation service, imported by the public one.
- As built: 26 seeded breaks red (the phone scope and the per-photo cap among them), counts constant.

## As built: the plan reviews, folded

- Cold plan-reviewer: no BLOCKER; 4 MAJOR folded: the probe's plain TRUNCATE is refused once a key points at the table (now `CASCADE`, and the report row is a seeded row); an unknown and a hidden Event must answer the same 404 body (`eventNotFound`); "a second report adds nothing" was unprovable with the double (now a spy on the upsert's options, a falsifier `upsert` → `insert`, the key pinned in the db test, a probe case); Keep's server half breaks no screen, so it stays in 4a as ruled (445). 11 MINOR folded (the controller's positional builders, `before` as a datetime, the Workshop filter read first, an unknown mode, the delete/report race, check order, the db:review warning, the allowlist docstring, the `photoEvent` docstring, no ARCHITECTURE photos section, a local 429 helper and `…Z` seeds).
- myclash-plan-review: converged in 1 pass on the amended plan, 1 MINOR: the report and keep take no body; 4b's client sends none (Fastify refuses a JSON content type with an empty body), and the boot check sends none.

## Global Constraints

- Hard rule 4: RLS on `event_photo_reports`, no anon or authenticated policy; the db test asserts it.
- Hard rule 9: one commit (`feat(photos): …`, header ≤ 100 characters, lower-case subject).
- Migration number **0252** (max+1; `git fetch` and re-check before commit). `CREATE TABLE IF NOT EXISTS`; `NOTIFY pgrst, 'reload schema'` at the end, as 0250.
- No user-facing string in 4a (the API's English messages are fallbacks; codes are translated in 4b).
- `pnpm openapi:client` after the routes (after `pnpm --filter @myclash/api build`): `quality:openapi-drift` compares `packages/api-client/src/generated/schema.ts`.
- Every function under 50 lines; complexity baseline untouched or re-pointed only where an edit shifts an entry (`baseline-audit.mjs`).
- `quality:shared-types` flags the English word for "every one" (a-n-y) in a comment.
- Each `.select()` stays one literal (schema-conformance reads it) and each test asserts its SELECT string (the double ignores the projection).

## Review Focus

1. **A waiting photo reaches the public**: by the list, by a filter, by paging, or by a Report's answer. → Task 2 test seeds a waiting photo between approved ones; Task 3 test reports a waiting photo and gets 404.
2. **Photos Off, or past the deletion instant**: the list is empty and a Report is refused. → Task 2 and Task 3 tests, at the instant and 1 ms before.
3. **A hidden Tournament's name leaks** through a tag, or a filter on it shows its photos. → Task 2 tests (tag dropped; filter empty).
4. **The cursor skips or repeats a photo** when two photos share a second. → the cursor is the database's `created_at` string verbatim, as the queue's (`photo-moderation.service.ts:114-139`); Task 2 seeds rows out of order and pages twice.
5. **A report outlives its photo** (FK cascade) or blocks a Tournament delete. → Task 1 cascade probe: the photo's every deletion path takes its report rows.

---

### Task 1: the reports table (migration 0252)

**Files:**

- Create: `packages/db/migrations/0252_event_photo_reports.sql`
- Test: `packages/db/test/event-photos.test.ts` (RLS on, no policy, and the text `primary key (photo_id, device_id)`, for the new table)
- Modify: `packages/db/fixtures/cascade-probe-seed.sql` (one report on the seeded photo), `scripts/lib/photo-tombstone-probe.mjs`:
  - the report row joins the seeded rows (beside `PHOTO_SEEDED`, `:20`), so each deletion path checks no report row is left;
  - the TRUNCATE case (`:45`) becomes `TRUNCATE event_photos CASCADE`: a plain one is refused once a foreign key points at the table (it would fail its `error === null` check, `:69`);
  - a new case: the same report inserted twice with `ON CONFLICT (photo_id, device_id) DO NOTHING` leaves one row.

**Interfaces:**

- Produces: table `event_photo_reports (photo_id uuid NOT NULL REFERENCES event_photos(id) ON DELETE CASCADE, device_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (photo_id, device_id))`, index `event_photo_reports_device_idx ON event_photo_reports (device_id, created_at DESC)`.

- [ ] **Step 1:** add the db test case and the probe rows; run `pnpm --filter @myclash/db test` → red (no table).
- [ ] **Step 2:** write 0252: the table, the index, `ENABLE ROW LEVEL SECURITY`, a header comment (why deny-all; why no `event_id`: a report is the photo's and goes with it; a plain `TRUNCATE event_photos` is now refused, use `CASCADE`).
- [ ] **Step 3:** `pnpm db:migrations:replay` on a free port (not 55432-55434), then the db test, `node scripts/db-cascade-probe.mjs` and the RLS probe green; read back `\d event_photo_reports` and `pg_policies` (empty for it). `pnpm db:review` passes; it WARNS that `photo_id` has no index of its own (`check-db-review.mjs:328-339` matches names; a primary key does not count). The key's leading `photo_id` serves the cascade: no redundant index; note it in the migration.

### Task 2: the public list

**Files:**

- Create: `apps/api/src/modules/photos/photo-public.service.ts`, `photo-public.service.feed.test.ts`
- Create: `apps/api/src/modules/photos/photo-links.ts` (+ test): `photoLinks(store: PhotoStore | null, row: { id: string; preview_key: string; original_key: string }, now: Date, logger: Logger): Promise<{ previewUrl: string | null; originalUrl: string | null }>`, moved from `PhotoModerationService.linksOf` unchanged in behaviour; the moderation service calls it.
- Create: `apps/api/src/modules/photos/photo-public.dto.ts`: `publicPhotoQuerySchema` = `{ before?: z.iso.datetime({ offset: true }) (as photo-queue.dto.ts:12); tournamentId?: uuid; workshopId?: uuid }`, refusing both ids at once (400); `PublicPhotoQueryDto`.
- Modify: `packages/types/src/event-photos.ts`: `PublicPhoto` = `Omit<ModerationPhoto, 'status'>`; `PublicPhotoPage { photos: PublicPhoto[]; next: string | null }`.
- Modify: `photos.module.ts` (provider).

**Interfaces:**

- Produces: `PhotoPublicService.feed(eventId: string, reader: PublicReader, query: PublicPhotoQuery): Promise<PublicPhotoPage>`; `PUBLIC_PHOTO_PAGE = 30`; `now: () => Date` settable, as the moderation service's.
- Consumes: `readableEvent`, `hiddenTournamentIds`, `photoEvent`, `photoDeletionInstant`, `asPhotoMode`, `PUBLIC_WORKSHOP_STATUSES`.

- [ ] **Step 1: tests** (seeded double, rows seeded out of order), each named:
  - `serves approved photos only, newest first, 30 a page, with the next cursor` (a waiting photo seeded between; `next` = the 30th row's `created_at` verbatim; page 2 with `before` holds the rest);
  - `asks the database for approved rows of this Event` (assert the SELECT string, `scopedTo(... 'event_id')`, and the `status` filter);
  - `is empty when photos are Off, or the stored mode is unknown`, `is empty from the deletion instant on` (at the instant and 1 ms before: served);
  - `drops the tag of a Tournament hidden from the caller`, `drops the tag of a Workshop that is not public`;
  - `answers an empty page, next null, for a filter on a hidden Tournament or a non-public Workshop, without reading photos` (the Workshop's status is read first, scoped by `event_id`, so no full page of dropped rows ever pages on);
  - `filters by Tournament, or by Workshop`;
  - `answers an unknown Event and a hidden one with the same 404 body` (null from `readableEvent` → `eventNotFound(eventId)`, `event-read-gate.ts:61-62`, never `photoEvent`'s own "Event not found": a different wording tells a stranger a draft exists, rulings 81-83);
  - `gives a photo with no signed links (no bucket, a signer that fails) null links, never a refusal`.
- [ ] **Step 2:** run → red. **Step 3:** implement. The select: `'id, uploader_name, caption, created_at, preview_key, original_key, tournament_id, tournament:tournaments(name), workshop:workshops(title, status)'`, `.eq('event_id').eq('status','approved')`, optional `.eq('tournament_id')` / `.eq('workshop_id')`, `.lt('created_at', before)`, `.order('created_at', desc).limit(30)`. **Step 4:** green, and the moderation tests still green after the `photoLinks` move.

### Task 3: the Report

**Files:**

- Modify: `photo-public.service.ts` (`report`), test `photo-public.service.report.test.ts`
- Modify: `packages/types/src/event-photos.ts`: `PHOTO_REPORT_LIMIT = 'photo_report_limit'`, `PHOTO_REPORTS_PER_HOUR = 30`.

**Interfaces:**

- Produces: `PhotoPublicService.report(eventId: string, photoId: string, deviceId: string, reader: PublicReader): Promise<{ reported: true }>`.

- [ ] **Step 1: tests:**
  - `records one report per phone and photo, ignoring a repeat`: a spy on the chain's `.upsert` asserts its arguments `({ photo_id, device_id }, { onConflict: 'photo_id,device_id', ignoreDuplicates: true })` (the double records the row only, not the options, `supabase-chain-internals.ts:177-180`), and `writesTo(...)[0].op` is the upsert (an `insert` would make the second tap a duplicate-key 500);
  - `refuses a phone at 30 reports in the last hour with 429 photo_report_limit, before writing` (29 passes; seed `created_at` as `…Z` strings, as the bound: the double compares range bounds as text, `supabase-chain-seeded.ts:99-104`);
  - `refuses a phone at the limit even for a photo it already reported` (assumption 8);
  - `answers 404 photo_not_found for a waiting photo, another Event's photo, photos Off, an unknown mode, past the deletion instant` (nothing written);
  - `answers 404 photo_not_found when the photo is deleted between the check and the write` (the upsert's error code `23503`);
  - `answers an unknown Event and a hidden one with the same 404 body`.
- [ ] **Step 2:** red. **Step 3:** implement: Event gate → photo row `.select('id').eq('id').eq('event_id').eq('status','approved')` → the phone's count in the last hour (`.select('photo_id', { count: 'exact', head: true }).eq('device_id').gte('created_at', hourAgo)`) → upsert. A local 429 helper (`photo-upload.service.ts:64` `tooMany` takes upload codes only). **Step 4:** green.

### Task 3b: Keep

**Files:** `photo-moderation.service.ts` (`keep`), `photo-moderation.writes.test.ts`.

**Interfaces:** `PhotoModerationService.keep(event: PhotoEventRow, photoId: string): Promise<{ id: string; kept: true }>`.

- [ ] **Tests:** `clears the photo's reports, and only its own` (the delete scoped by `photo_id`, asserted); `answers 404 photo_not_found for a photo not in the Event` (the photo read scoped by `event_id`; nothing deleted); `answers 200 for a photo with no reports`. Red → implement (photo row in the Event, then `.delete().eq('photo_id', photoId)`) → green.

### Task 4: the routes and the registries

**Files:**

- Modify: `apps/api/src/modules/photos/photos.controller.ts`: `GET events/:eventId/photos/public` (`@Public()`, `@Throttle(PUBLIC_LIVE_READ_THROTTLE)`, `publicReader(req)`); `POST events/:eventId/photos/:photoId/report` (`@Public()`, `@AllowOnArchivedEvent()` with ruling 447 in its docstring, `@HttpCode(200)`); a private `deviceFor(req, reply): string` holding the upload's cookie lines (`:88-99`), used by both.
- Modify: the same controller: `POST events/:eventId/photos/:photoId/keep` (`organisersEvent`, `@AllowOnArchivedEvent()`, 447); `photos-staff.controller.ts`: `POST staff/photos/:photoId/keep` (`eventForStaff`).
- Modify: `apps/api/src/modules/photos/testing/photo-door.ts:46` and `photos.controller.test.ts:31` (they build the controller with positional arguments: the new service is a seventh); `photo-organiser.ts:33-37` docstring (the public service is a third caller of `photoEvent`, behind `readableEvent`).
- Test: `photos.controller.test.ts` (the routes call the service with the gate's reader and the cookie's device; a fresh phone gets the cookie set; the decorators: Public on both public routes, Throttle on the list, AllowOnArchivedEvent on the report and the organiser's keep); `photos-staff.controller.test.ts` (keep through the staff gate; its "opens no staff route on an archived Event" loop gains `keep`).
- Modify: `apps/api/src/common/auth/public-routes.test.ts`: `EXPECTED_PUBLIC` gains both, `PUBLIC_POST_ALLOWLIST` the report, each with its reason (ruling 428); the allowlist docstring (`:216-222`, "locked by an Event secret and rate limits") is reworded: the Report has no secret, it is locked by the photo being public and a per-phone limit.
- Modify: `apps/api/src/common/event-readonly/archived-lock.routes.test.ts`: the opt-out list gains the report and the organiser's keep (447), in sorted order; `placed` 188 → 190 (both are placed by their `eventId`; the GET is not a write), the comment says why. `common/testing/archived-lock-ledger.ts`: the staff keep under `LOCKED_ELSEWHERE` beside the staff approve and delete (`:218-232`).
- Regenerate: `packages/api-client/src/generated/schema.ts` (`pnpm --filter @myclash/api build`, `pnpm openapi:client`).
- Docs: `docs/ARCHITECTURE.md` (the `@AllowOnArchivedEvent()` list, `:2636-2640`: "a Report of a public photo and the organiser's Keep (447)"; there is no photos section to extend); the design's "The public" and "Moderation" with `[rev 445-448]` lines.

- [ ] Steps: tests red → routes → green → registries → `route-authz.test.ts` pins unchanged (UNDECIDED 0, DECIDED_ELSEWHERE 19, FALSE_PASSES 0).

### Task 5: falsify, review, gates, image, commit

- [ ] **Falsify** (copy `falsify-approve-archived.mjs`; anchors after Prettier; each RED, counts constant): the list drops `.eq('status', 'approved')`; the Off check gone; the expiry check gone; the hidden-Tournament tag kept; the Workshop status check gone; the filter on a hidden Tournament served; the report's `upsert` → `insert`; its `ignoreDuplicates: true` → `false` (the spy); the per-hour check gone; the report's `status` check gone; the unknown-Event 404 through `photoEvent`'s wording; Keep's delete unscoped by `photo_id`; `@AllowOnArchivedEvent()` off the report and off the keep; `@Throttle` off the list; the migration's `ON DELETE CASCADE` gone (replay + probe row).
- [ ] **Cold review**: `code-architecture-reviewer` (opus).
- [ ] **Gates**: `gates.sh` (33 lines, all `0`); `pnpm db:migrations:replay`; the probes.
- [ ] **Image**: build and boot (no database behind it); no wiring error; `GET …/photos/public` and the report answer the scrubbed 5xx of a failed Event read, not a 404 route-not-found and not a 401 (they are public).
- [ ] **Commit**: `git fetch`, `git log --oneline -1`, `git status --short`; explicit staging list; `git diff --cached --stat`; `git commit -F`.
