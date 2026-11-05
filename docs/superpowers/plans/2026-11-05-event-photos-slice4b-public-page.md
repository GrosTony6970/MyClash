# Event photos — slice 4b: the public Photos page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the operator asked for a native build) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A visitor opens `/e/<event>/photos` from a card on the Event home and sees the Event's public photos, newest first, filtered by Tournament or Workshop, 30 at a time, refreshed every 30 s while the tab is visible, each with a Report button.

**Architecture:**

- The API from slice 4a (`16100662`): `GET events/:eventId/photos/public?before&tournamentId|workshopId` → `PublicPhotoPage`; `POST events/:eventId/photos/:photoId/report` → `{ reported: true }`, which gains a body `{ comment?: string | null }` and migration 0253 (Task 0, rulings 452-453). Everything else is web-public.
- The page is a server component (the Event, the filter's options, the title) around one client grid. The grid's rules live in plain modules under `src/lib/photos/` with node tests; the hook is glue.
- The 30 s reads reuse `watchSchedule`, which gains an interval parameter (its 60 s stays the default for its one caller).

**Tech Stack:** Next 16 App Router, React 19, `@myclash/api-client` `apiRequest`, vitest (node + jsdom), Playwright `tests/a11y/`.

**Spec:** `docs/superpowers/specs/2026-11-03-event-photos-design.md`: Goals 1, 5, 6; "The public" (with `[rev 445-448]`); "Where it shows up" item 3; "When the bucket is slow or down" (the "image unavailable" tile). API: `docs/superpowers/plans/2026-11-05-event-photos-slice4a-feed-and-report.md`.

## In plain words

A friend at home opens the Event's page and finds a new **Photos** card near the top. It is there only while the organiser has photos switched on. Tapping it opens a page of photos, the newest first, like a wall. Under each photo: who sent it (if they gave a name), the caption, the Tournament or Workshop it is about, and the time. Tapping a photo opens it full size.

A menu at the top shows only one Tournament's or one Workshop's photos. The page shows 30 photos; "Load more" shows the next 30. While the page is on screen, it looks for new photos every 30 seconds and puts them on top, without losing what the visitor already scrolled to. When the visitor is on another tab, it stops looking.

Each photo has a **Report** button. It asks "Report this photo?" and offers a box to say why (optional, 200 characters at most, ruling 452). Sending tells the organisers "look at this one"; the button then reads "Reported". Reporting the same photo again from the same phone still counts once; a new comment replaces the old one (453). The photo stays on show (design Goal 6). If the organiser already deleted it, the button's place says the photo is no longer shown. If a phone reported many photos in the last hour, it says to try later. Everything is said in English and French.

If the photo storage is down, the list still loads and each missing picture shows "Image unavailable". There is no upload button on this page: sending stays with the QR code (design Goal 1).

## Operator rulings for this slice

- **445** (2026-11-05 ~17:30): three commits, 4a server, **4b the public page**, 4c the Reported tab and Keep.
- **446** (~17:30): **a Photos page at `/e/<event>/photos` and a home card linking to it, shown when photos are not Off.**
- **450** (2026-11-05 ~19:40) Story: Léa loads older photos, leaves for lunch, comes back after 20 minutes; the older pictures' links have expired. Ruling: **those tiles show "Image unavailable" until the page is reloaded** (assumption 6, option A).
- **451** (~19:40) Story: the photos are deleted 30 days after the Event; the organiser never switched photos Off. Ruling: **the card stays; the page says there are no photos and that photos are deleted 30 days after the Event** (assumption 12, option A).
- **452** (~19:40) Story: Tom taps Report. Ruling: **the page asks "Report this photo?" first, with an optional comment (200 characters at most, as a caption); the server takes and stores it, in the same 4b commit** (a migration, the Report's body).
- **453** (~19:45) Story: Tom reports with "this is me", then again an hour later with "please, it is urgent". Ruling: **the second comment replaces the first; it is still one report from his phone.**

## Assumptions (mine; the operator reads them before the build)

1. **The card's place:** under the header and "Taking part" card, right after "Live now" when that block is at the top, above Participants. It has no photo count (a count is another read on every home).
2. **Photos Off (or an unknown stored mode): the page is the not-found page**, as a direct link to a page that does not exist. The card is not shown.
3. **Report asks first (452)**, in a dialog with an optional comment. A second report by the same phone is still one report; a new comment replaces the old one (453), an empty one leaves the old one. "Reported" is not remembered after the page is reloaded (the button reads Report again; reporting again is harmless). The comment is kept until Keep clears the reports or the photo is deleted (30 days at most); it is only for the moderators (shown by slice 4c).
4. **A Report answered "not found"** (deleted, or photos switched Off meanwhile): the button's place says "This photo is no longer shown"; the tile stays until the next refresh drops it.
5. **The refresh reads the newest 30 only** and puts them on top; photos below them that the visitor loaded stay. A photo deleted among the newest 30 disappears at the next refresh; one deleted further down stays until the page is reloaded.
6. **RULED A (450): a link to a picture lives 10 to 15 minutes.** The newest 30 get fresh links every 30 s. A picture further down (reached by Load more) that is still unloaded after 10 minutes, or tapped to open full size, meets a dead link. **A (recommended, simpler):** it shows "Image unavailable" (the full-size tab shows the storage's error) until the page is reloaded. **B:** the page reads every loaded page again once, fresh links for all (more code, one more race).
7. **The time under a photo is the Event's clock** ("Sat 14:05"), as the rest of the Event's pages.
8. **Search engines are told to leave the page out** (`noindex`): it shows people's faces for 30 days.
9. **A read that fails** keeps the photos on screen and tries again at the next tick. A first read that fails says "Could not load the photos" with Retry.
10. **Changing the filter starts again from the newest 30**; an answer to the old filter is dropped.
11. **The filter lists the Event's public Tournaments and Workshops**, the same lists as the send page; with neither, there is no filter.
12. **RULED A (451): after the deletion date** (00:00 on the 31st day after the Event) the server shows no photos, but the organiser's switch stays On, so the card stays on the home and the page says "No photos yet". **A (recommended):** leave it (the page's empty line says the photos are deleted 30 days after the Event). **B:** hide the card and close the page from that date (the date's rule lives in the API; the page would need it too).

## As built: the plan reviews, folded

- myclash-plan-review: converged in 2 passes, 6 MINOR folded (PublicHome's baseline entry re-points; rebuild `@myclash/types`; the filter resets in its handler; a `notFound` read; the Report double-tap test moved to Playwright; the hidden tab held by the node test; FR by `mc_locale`).
- Cold plan-reviewer: 0 BLOCKER, 3 MAJOR folded: the refresh left a gap when more than 30 photos arrived since the last read (now: the page alone, with Load more); Task 2's expected count was wrong (62, not 60: the rule keeps every loaded photo older than the page); the "late answer of an old filter" test could not see the generation check (the filter's cleanup already aborts the 30 s read: the test now holds a Load more). MINOR folded: Load more's 20 s limit and failure line; no dead branch for `signedOut` or an aborted Report; the no-issue story routes real images; fixtures in the server's `+00:00` shape and `next` checked; exactly-30 Load more; absolute script paths; the page's own `<main>`. Two became questions: assumption 6 (stale links) and 12 (after the deletion date).

## As built: the build, the falsifier and the cold code review

- Beyond the plan: the send page's tag picker and the photos page's filter share `TagOptions`, `readPhotoTags` (`photos/_lib/photo-tags.ts`) and `PHOTO_FIELD_CLS`; `photosShown(mode)` in `packages/types` is the one rule of "photos are on" (the public list, the page, the card). The shared `PromptDialog`'s several-line field now shows its label and its `validate` reason, as the one-line field does (it said neither); the two web-admin rulesets reject dialogs drop their description, which repeated the label. The browser spec is split in three (`photos-public.spec.ts`, `photos-public-report.spec.ts`, `photos-public-stub.ts`): one file was over the 400-line budget.
- Falsifier: 33 seeded breaks, 32 red. The green one was a dead branch (the merge's duplicate check: every photo of the newest page is at least as new as its cursor), removed. After the review's fixes, 39 rows.
- Cold code review (code-architecture-reviewer, opus): no Critical. Important, folded test-first: a Load more that lands after a 30 s read that stood alone (more than 30 new photos) left a gap, now dropped unless the list still ends where it was asked from (`feedAfterMore(shown, page, before)`); the comment box had no visible label. Minor, folded: the comment counts characters as a caption does (an emoji is one) on both sides; a NUL is refused (it was a 500); `PhotoReportBody` is used by the call; one field class; one "photos are on" rule; this plan's `STALE_LINKS_MS` line. Named, not fixed: every tile's button is named "Report" (no photo in its name); the picture's alt repeats the caption printed under it; the original opens in a new tab without saying so; Load more's added photos are not announced. After "Reported" the button stays closed, so a phone changes its comment only after a reload (assumption 3).
- Open, for the operator: in Approve-first mode a photo is ordered by its upload time, not its approval: approved 20 minutes late on a busy Event, it lands below the newest 30 and an open page shows it only after a reload. The merge compares the server's times as text, safe while the database answers in UTC (`+00:00`).

## Global Constraints

- Every user-facing string in EN and FR, literal keys (`t('publicApp.photos.x')`), under a new `publicApp.photos` namespace and `publicApp.titles.photos` (`packages/i18n/src/messages/{en,fr}/publicApp.ts`).
- Calls through `apiRequest(getPublicApiUrl(), …)`; no raw `fetch` (`no-raw-api-fetch` ratchet). The Report always sends a JSON body (`{ comment }`, null when empty).
- The dialog is `@myclash/ui` `PromptDialog` (`multiline`, `allowEmpty`, `fieldLabel`, `validate` saying the 200-character limit), its first use in web-public: its tokens are checked in both web-public themes at build (axe in the Playwright story with the dialog open).
- Tokenized classes only; the select is web-public's tokenized raw select (known-deviations D6), the button `@myclash/ui` `Button` in its quiet outline style (DESIGN.md:452).
- Every function under 50 lines; no complexity baseline entry added. The new import in `PublicHome.tsx` shifts its baselined function (`docs/code-quality-complexity-baseline.json:690`, `PublicHome.tsx:46`): re-point that one entry, audit with `baseline-audit.mjs`.
- `@myclash/types` is read from `dist`: `pnpm --filter @myclash/types build` before web-public's tests and typecheck.
- `react-hooks/set-state-in-effect` is an error: reads start from effects through callbacks, as `use-my-schedule.ts`.
- No upload control on the page (design Goal 1).
- `PHOTO_REREAD_MS = 30_000`. (`STALE_LINKS_MS` belonged to option B of assumption 6, ruled out by 450.)

## Review Focus

1. **A refresh landing while a Load more is out** (two writers on one list): the merge must keep both answers and never show a photo twice. Task 2 tests both orders.
2. **A filter change while a read or a Load more is out**: the old filter's answer must not reach the new list. Task 4 (Playwright: a delayed answer to the old filter).
3. **The stub's `{}` answer**: `stubPublicApi` answers every unknown API path with `{}`; the reader must treat a body without `photos` as a failed read, never crash. Task 2 test.
4. **Two photos with the same `createdAt` on a page boundary**: the server's cursor is `lt created_at`, so the second is skipped by the server (4a, named). The merge dedupes by id, so it never shows a duplicate. Named, not fixed here.
5. **Report on a slow link, tapped twice**: the button is closed while its POST is out. Task 4 Playwright test (a held answer, one POST counted).

---

### Task 0: the Report takes a comment (server, rulings 452-453)

**Files:**

- Create: `packages/db/migrations/0253_event_photo_report_comment.sql`: `ALTER TABLE public.event_photo_reports ADD COLUMN comment text NULL`, `CONSTRAINT event_photo_reports_comment_length CHECK (comment IS NULL OR char_length(comment) BETWEEN 1 AND 200)` (named, so replay reads it back). Header: free text from an anonymous phone, read by the moderators only (RLS stays on, no policy), gone with the photo or at Keep.
- Modify: `packages/types/src/event-photos.ts`: `PHOTO_REPORT_COMMENT_MAX = 200`; `PhotoReportBody { comment?: string | null }`.
- Modify: `apps/api/src/modules/photos/photo-public.dto.ts`: `photoReportBodySchema = z.object({ comment: z.string().trim().max(PHOTO_REPORT_COMMENT_MAX).nullable().optional() }).strict()`; `PhotoReportBodyDto`. A body is required (the page always sends one).
- Modify: `photo-public.service.ts` `report(eventId, photoId, deviceId, comment: string | null, reader)` (`''` after trim → null, in the controller): with a comment, `upsert({ photo_id, device_id, comment }, { onConflict: 'photo_id,device_id' })` (a repeat replaces the comment; `created_at` is not in the row, so the hour's count is unchanged); with none, today's `ignoreDuplicates: true` upsert without `comment` (an empty repeat never erases a comment). `photoIsFull(photoId, deviceId)` counts the OTHER phones' reports (`.neq('device_id', deviceId)`), so a phone among the 20 may still change its comment (453).
- Modify: `photos.controller.ts` `report`: `@Body() body: PhotoReportBodyDto`.
- Modify: `packages/db/test/event-photos.test.ts` (the CHECK: 201 characters refused, `''` refused, 200 taken), `scripts/lib/photo-tombstone-probe.mjs` (the seeded report carries a comment; it goes with the photo).
- Regenerate: the OpenAPI client (`pnpm --filter @myclash/api build`, `pnpm openapi:client`).
- Docs: the design's "The public" gains `[rev 452-453]`; the 4a plan is history, unchanged.
- Test: `photo-public.service.report.test.ts`: `stores the comment with the report` (the upsert spy's row and options); `a repeat with a comment replaces the old one` (options without `ignoreDuplicates`); `a repeat with no comment leaves the old one` (`ignoreDuplicates: true`, no `comment` key); `a photo holding 20 other phones' reports takes no new phone, but one of its 20 may change its comment`; the existing cases pass a null comment. `photos.controller.test.ts`: the body's comment reaches the service, `''` and spaces as null; the DTO refuses 201 characters and an unknown key (400).

- [ ] **Step 1:** tests → red. **Step 2:** migration, types (`pnpm --filter @myclash/types build`), DTO, service, controller → green. **Step 3:** replay on PG17 (`replay.sh` copied, reading 0253 back: the column and the CHECK by name), the cascade and RLS probes, `pnpm db:review`.

### Task 1: `watchSchedule` takes an interval

**Files:**

- Modify: `apps/web-public/src/components/me/watch-schedule.ts:21-57`
- Test: `apps/web-public/src/components/me/watch-schedule.test.ts`

**Interfaces:**

- Produces: `watchSchedule<T>(readOnce, take, everyMs: number = SCHEDULE_REREAD_MS): () => void`. The docstring's "once a minute" becomes "every `everyMs` (a minute by default)".

- [ ] **Step 1:** test `reads again at the interval it is given`: `watchSchedule(readOnce, take, 30_000)`; after `29_999` ms one read; after `30_000` two; hidden (`browser('hidden')`), no second read after `30_000`.
- [ ] **Step 2:** run `pnpm --filter @myclash/web-public exec vitest run src/components/me/watch-schedule` → red.
- [ ] **Step 3:** add the parameter; `setInterval(readIfInView, everyMs)`.
- [ ] **Step 4:** green; the existing cases unchanged.

### Task 2: the feed's rules (plain module)

**Files:**

- Create: `apps/web-public/src/lib/photos/photo-feed.ts`, `photo-feed.test.ts` (node)
- Create: `apps/web-public/src/lib/photos/photo-tag.ts` (`tagOf` moved from `PhotoSendForm.tsx:29-35`, unchanged; the send form imports it)

**Interfaces:**

- Produces:
  - `PHOTO_REREAD_MS = 30_000`.
  - `interface PhotoFeed { photos: PublicPhoto[]; more: boolean }`.
  - `photoPagePath(eventId: string, filter: string, before?: string): string` — `filter` is the picker's value (`''`, `t:<id>`, `w:<id>`, through `tagOf`) → `/api/v1/events/<id>/photos/public?tournamentId=…|workshopId=…&before=<encoded>`.
  - `readPhotoPage(apiUrl: string, path: string, signal?: AbortSignal): Promise<ScheduleRead<PublicPhotoPage>>` — ok with an array `photos` and a `next` that is a string or null → `data`; a 404 → `notFound`; aborted → `aborted`; anything else, a body without them included → `failed`. (It never answers `signedOut`; the hook's `take` handles `data` and `notFound` by name and every other kind as a failed read, so no branch exists for it.)
  - `feedAfterFirstPage(shown: PhotoFeed | null, page: PublicPhotoPage): PhotoFeed` (`createdAt` compared as strings: the server's verbatim `created_at`, all `+00:00`; test fixtures use that shape, never `Z`):
    - no shown list, or `page.next` null → the page alone, `more = page.next !== null`;
    - **the page does not reach the shown list** (`page.next` newer than the newest shown photo: more than 30 arrived since) → the page alone, `more: true` (never a gap: the rest is read by Load more);
    - else the page, then the shown photos older than `page.next` and not in the page; `more = shown.more` when an older photo was kept or the page holds the shown list's oldest photo, else `true` (so an Event with exactly 30 photos does not bring Load more back on every refresh).
  - `feedAfterMore(shown: PhotoFeed, page: PublicPhotoPage): PhotoFeed` — appends the page's photos not shown yet; `more = page.next !== null`.
  - `feedCursor(feed: PhotoFeed): string | null` — the last photo's `createdAt` while `more`, else null.
  - Only with option B of assumption 6: `PhotoFeed` gains `readAt: number` (the oldest read still on screen); `readAllShown(read, shown): Promise<PhotoFeed | null>` reads page 1, then follows `next` until a page holds a photo as old as the oldest shown or `next` is null; its result REPLACES the list (a Load more out meanwhile is dropped by the generation); null when any read is not `data`.

- [ ] **Step 1: tests**, each named:
  - `the first page alone when the server has no more` (`more: false`, older shown photos dropped: they were deleted);
  - `new photos go on top and the loaded ones below stay` (shown = 60 photos old1…old60; the page = 2 new + old1…old28, `next` = old28's time; result = 2 new + old1…old60, 62 photos, `more` kept from shown);
  - `more than 30 new photos: the page alone, with Load more` (shown = 10, the page = 30 all newer, `next` set → 30 photos, `more: true`, no shown photo kept);
  - `exactly 30 photos and Load more found none: the refresh keeps Load more closed` (shown = the same 30, `more: false`; the page = those 30 with `next` set → `more: false`);
  - `a photo deleted among the newest is gone after the refresh`;
  - `never shows a photo twice, whichever answer lands first` (refresh then Load more, Load more then refresh: same ids, no duplicate, newest first);
  - `Load more appends and takes the server's next`;
  - `the cursor is the last photo's time while there are more, else none`;
  - `the path carries the filter and the cursor, encoded` (`t:` → `tournamentId`, `w:` → `workshopId`, `''` → neither; a `+00:00` cursor encoded);
  - `a body with no photos is a failed read` (`{}`), `a 404 is notFound`, `an abort is aborted` (`fetch` stubbed with `vi.stubGlobal`, under `apiRequest`);
  - (`readAllShown` and its tests only if the operator picks option B of assumption 6.)
- [ ] **Step 2:** red. **Step 3:** implement. **Step 4:** green; the send form's tests still green after the `tagOf` move.

### Task 3: the Report (plain module + button)

**Files:**

- Create: `apps/web-public/src/lib/photos/photo-report.ts`, `photo-report.test.ts` (node)

**Interfaces:**

- Produces:
  - `type ReportState = { kind: 'idle' } | { kind: 'sending' } | { kind: 'reported' } | { kind: 'gone'; message: string } | { kind: 'failed'; message: string }`.
  - `sendReport(apiUrl: string, eventId: string, photoId: string, comment: string): Promise<ApiResult<{ reported: true }>>` — `apiRequest(apiUrl, '/api/v1/events/<eventId>/photos/<photoId>/report', { method: 'POST', body: { comment: comment.trim() || null } })` (a JSON body, so the content type is right).
  - `reportAfter(result: ApiResult<unknown>, t: Translate): ReportState` (`Translate` as `photo-refusal.ts` declares it) — ok → `reported`; a 404 (any code) → `gone`, `publicApp.photos.report.gone`; code `PHOTO_REPORT_LIMIT` → `failed`, `publicApp.photos.report.limit` (read BEFORE `failureMessage`, which says every 429 with the throttler's sentence); else (no signal is passed, so no `aborted` branch of its own) `failed` with `failureMessage(result, t, t('publicApp.photos.report.failed'))`.
- [ ] **Step 1: tests:** each branch above; `sends the comment, or null for an empty one` (the body on the `fetch` stub `apiRequest` calls); a throttler 429 with no code says `common.apiFailure.tooManyRequests`; `read_only_mode` says its sentence.
- [ ] **Step 2:** red. **Step 3:** implement. **Step 4:** green.

### Task 4: the page, the grid, the home card

**Files:**

- Create: `apps/web-public/app/e/[eventSlug]/photos/page.tsx` (server): `eventOrNotFound(slug)`; `notFound()` unless `photoMode` is `'live'` or `'approve'`; reads `fetchTournaments` / `fetchWorkshops` as `photos/send/page.tsx:31-49`; `generateMetadata` = `titled('publicApp.titles.photos')` plus `robots: { index: false, follow: false }`; `BackLink` to the home; one H1 `publicApp.photos.title`; `<PhotoGrid eventId timeZone tags />`.
- Create: `app/e/[eventSlug]/photos/PhotoGrid.tsx` (client): the filter (`TagOptions` inside a labelled select, first option `publicApp.photos.filterAll`), the grid (`grid grid-cols-2 sm:grid-cols-3 gap-3`), `PhotoTile` (image linking to the original in a new tab, the "Image unavailable" tile as web-admin `PhotoQueue.tsx:162-189` `TileImage`, then name · caption · tag · Event-clock time via `formatInZone`, then the Report button driven by `ReportState`, closed while `sending`; it opens ONE `PromptDialog` for the grid, holding the photo being reported; Confirm sends, Cancel sends nothing), Load more (closed while a page is read), the empty line (`publicApp.photos.empty`, `publicApp.photos.emptyFiltered`), the failed line with Retry (`publicApp.photos.loadFailed`).
- Create: `app/e/[eventSlug]/photos/use-photo-feed.ts` (glue): `watchSchedule(readOnce, take, PHOTO_REREAD_MS)` keyed on `[eventId, filter, asked]`; the filter's change handler (not an effect: `react-hooks/set-state-in-effect`) sets the filter and empties the list; a `notFound` answer (the Event hidden or gone: Off answers an empty page, not a 404) empties the list and shows the empty line, no Retry; a generation ref bumped per filter so a Load more of an older filter is dropped (the 30 s read needs none: the filter re-keys the effect, whose cleanup aborts it); the filter change also reopens Load more (`loadingMore` false), so a dropped answer never leaves the button closed; Load more is aborted after `SCHEDULE_READ_LIMIT_MS` (20 s) as the 30 s read is, and a failed Load more says `publicApp.photos.loadMoreFailed` and reopens the button. The race, named in its docstring: the 30 s read and Load more both write the list; each answer goes through `feedAfterFirstPage` / `feedAfterMore`, which keep both. (With option B of assumption 6: `onImageError` runs `readAllShown` once when the list's `readAt` is older than `STALE_LINKS_MS`, one in flight, its result replacing the list.)
- Create: `app/e/[eventSlug]/photos/_components/TagOptions.tsx`: the two optgroups now in `PhotoSendForm.tsx:62-96`, used by the send form's picker and the grid's filter (one owner).
- Create: `app/e/[eventSlug]/home/_components/PhotosCard.tsx` (server): null unless `photoMode` is `'live'` or `'approve'`; a `<section>` with H2 `publicApp.photos.title` and a link card to `/e/<slug>/photos` in the Participants card's idiom (`PublicHome.tsx:131-160`), text `publicApp.photos.cardLine`.
- Modify: `app/e/[eventSlug]/home/PublicHome.tsx`: one line, `<PhotosCard …/>` right after `{livePlace === 'top' && liveNow}`.
- Modify: `packages/i18n/src/messages/{en,fr}/publicApp.ts`: `titles.photos` ("Photos" / "Photos"), `photos.{title, cardLine, filterLabel, filterAll, empty, emptyFiltered, loadMore, loadMoreFailed, loadFailed, retry, imageUnavailable, photoAlt, report.{button, sending, done, gone, limit, failed, dialogTitle, dialogText, commentLabel, commentTooLong, send, cancel}}`; `photos.empty` also says photos are deleted 30 days after the Event (451).
- Test: `tests/a11y/page-titles.spec.ts` gains one test of its own, `/e/photo-event/photos reads "Photos · Open de Lyon"` (the `INSIDE_AN_EVENT` loop is bound to `test-event`, which has no photo mode: there the page is not found; the stub's `test-event` gains no mode, or every home story would draw the card).
- Test: `tests/a11y/photos-public.spec.ts` (390×844, `stubPublicApi` + `page.route` on `**/api/v1/events/ev-photo/photos/public*` and `…/report`):
  - `the home of a photo Event has the Photos card, a photo-off Event has none`, the link's href;
  - `photos show newest first, with name, caption, tag and time` (Event clock);
  - `Load more adds the next 30, and the button goes when there are no more` (the second request's `before` asserted);
  - `the filter asks for the Tournament's photos`;
  - `a Load more out when the filter changes is dropped, and Load more works on the new filter` (the Load more answer HELD across the change, then released: its photos never show; the new filter's Load more button is open) — the only test that can see the generation check;
  - `a failed Load more says so and the button opens again`;
  - `a refresh after 30 s puts a new photo on top and keeps the loaded ones` (`page.clock`);
  - (the hidden tab is held by `watch-schedule.test.ts`'s visibility cases, run with the 30 s interval in Task 1, not here);
  - `Report asks first: Cancel sends nothing`; `Report with a comment sends it, then reads Reported` (the POST body asserted); `Report with no comment sends null`; `a 201st character is refused in the dialog`; `a second tap while the first is out sends nothing` (the answer held, one POST counted); `a 404 says the photo is no longer shown`; `photo_report_limit says to try later`; FR once (`photo_report_limit` in French, the `mc_locale` cookie as `event-home.spec.ts:95`);
  - `a picture that fails to load shows Image unavailable`;
  - `a photo-off Event's page is not found`;
  - `no axe violation`, `no page issue` — a story of its own with the photos' image URLs routed to a real small image and no refused Report (a failed load or a 4xx logs a console error the page-issue check counts, `tests/a11y/helpers.ts:16-38`).
- The page opens its own `<main id="main-content" tabIndex={-1}>`, as `photos/send/page.tsx:37` and `PublicHome.tsx`.
- Test: `tests/a11y/event-home.spec.ts` untouched (its Events have no mode, so no card); a home order check for `photo-event` (card under the header, above Participants) in `photos-public.spec.ts`.

- [ ] **Step 1:** i18n keys EN + FR; `pnpm --filter @myclash/i18n test` (the key sweep) green.
- [ ] **Step 2:** the Playwright spec, red (start the stub and `next dev apps/web-public --port 3001` by hand: `run-e2e.mjs` forwards no spec args).
- [ ] **Step 3:** `TagOptions`, the page, the grid, the hook, the card, the one line in the home.
- [ ] **Step 4:** green; `photo-send.spec.ts`, `event-home.spec.ts`, `page-titles.spec.ts` green.

### Task 5: falsify, review, gates, commit

- [ ] **Falsify** (copy `C:\Users\Tony\AppData\Local\Temp\claude\f--Github-Repo-MyClash\66623419-056a-4dbf-9fc3-8a507b260e65\scratchpad\falsify-approve-archived.mjs` into this session's scratchpad; `gates.sh` is beside it, `baseline-audit.mjs` in `…\498830eb-0bf6-4492-871c-7d2395010106\scratchpad\`; web-public rows run by `pnpm --filter @myclash/web-public exec vitest run <prefix>`, Playwright rows by the spec with the servers up; anchors after Prettier; each RED, counts constant): `everyMs` ignored (60 s back); the merge keeps no older photo; the merge keeps a duplicate; `more` from the page instead of `shown`; the cursor ignores `more`; `t:` maps to `workshopId`; the Report drops the comment; the dialog skipped (Report sends at once); the service's comment upsert keeps `ignoreDuplicates: true` (no replace); the empty repeat writes `comment: null`; `photoIsFull` counts this phone too; the DTO's `.max` gone; the migration's CHECK gone (db test); `PHOTO_REPORT_LIMIT` read after `failureMessage`; a 404 as `failed`; the Report button not closed while sending; the generation check gone (the held Load more's photos show); the filter change leaves `loadingMore` set; the "page does not reach the shown list" branch gone (a gap); the exactly-30 `more` rule gone; Load more's time limit gone; the visibility gate gone; the card shown when Off; the page served when Off.
- [ ] **Cold review**: `code-architecture-reviewer` (opus).
- [ ] **Gates**: `gates.sh` (33 lines, each green); `pnpm --filter @myclash/i18n test` and `pnpm --filter @myclash/api test` run directly (turbo caches them); `pnpm db:migrations:replay` + probes (Task 0); the API image booted and a Report with a comment sent to it (`boot-4a.sh` copied, now with a body).
- [ ] **Commit**: one commit, `feat(photos): the public photos page and its home card, with a report that asks first and takes a comment`, explicit paths.
