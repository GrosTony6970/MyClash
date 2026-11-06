# Event photos — slice 6b: the Photos tab in the personal space — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the operator builds native) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in person sends photos to one of her Events from that Event's hub in her personal space, under her name, sees the photos she sent that way with their status, and deletes them; the personal space says "could not load, retry" when "my events" fails to load.

**Architecture:**

- The server (6a) already takes the upload, lists her photos and deletes them. 6b adds one field to her photo list: `sendOpen`, whether a photo can be sent now (ruling 463). It is computed by ONE new rule in `photo-window.ts` that the upload door uses too.
- web-public: a fourth hub tab, Photos (`/me/events/[eventSlug]/photos`). The tab list is computed once (`hub-tabs.ts`) for the hub's tab strip and the sidebar. The page reuses the QR page's send loop (`send-queue`, `use-photo-queue`, `PhotoQueue`, `refusalView`), whose `sendPhoto` now takes a target (QR or account). The form's fields move out of `PhotoSendForm.tsx` into one shared `PhotoForm`. The list of her photos reuses the public feed's merge rules (`photo-feed.ts`, made generic).
- `useMyEvents` gains `retry`; every page that shows "my events" as its main content says a failed read (ruling 461).

**Tech Stack:** Next 16 App Router (client hub pages, one server page for the tags), React 19, `@myclash/api-client` `apiRequest`, NestJS 11, vitest (node), Playwright (`tests/a11y`).

**Spec:** `docs/superpowers/specs/2026-11-03-event-photos-design.md`: Goal 11 (with its `[rev 458-462, slice 6a]` bullet); "Where it shows up" item 5. Shape: `2026-11-06-event-photos-slice6a-account-upload.md` (its "Slice 6b, in outline"), `2026-11-04-event-photos-slice2b-phone-page.md`, `2026-11-05-event-photos-slice4b-public-page.md`.

**Scripts** (copy into this session's scratchpad, read first): `…\8d545bef-dcbb-4949-b2ae-b341c601eb20\scratchpad\` — `gates.sh <ABSOLUTE outdir>`, `baseline-audit.mjs`, `watch-ci.sh`, `boot-6a.sh` + `boot-6a-calls.cjs`; `…\c8d2350a-c69a-4d59-b7bc-dfac07038e8a\scratchpad\falsify-4b.mjs` (the model for web-public node and Playwright rows), `split-spec.mjs`.

## In plain words

Today Léa can send photos only by scanning the Event's QR code. The server half of "send from my personal space" shipped in 6a; nothing on screen uses it yet.

After 6b: in her personal space, each of her Events has a **Photos** tab next to Overview, Schedule and Workshops, and the sidebar lists it under the Event too. The tab is there when the Event shows photos (Live or Approve first), or when she has already sent photos there. With photos Off and none of hers, there is no tab.

On the tab, while the upload days are open (the day before the Event to the day after it), she picks photos, adds an optional caption and Tournament or Workshop, and taps Send. There is no name box: the form says "Posted as Léa Martin". Each photo shows its progress, as on the QR page. If she has no name yet, the form gives way to "Your photos carry your name: add one to your profile first." and a link to her profile. Outside the upload days the form gives way to one line ("Photos are not open for this Event right now.", or "This Event does not take photos." when photos are Off); her photos stay listed.

Below, **My photos** lists the photos she sent from her personal space, newest first, 30 at a time with Load more. Each shows its picture, caption, Tournament or Workshop, time, and its status: "Waiting for approval" or "Shown". A photo she has just sent appears there. Delete asks first ("Delete this photo? It is removed from the Event's photos.") and the photo goes. Photos she sent with the QR code are not in this list: they stay anonymous.

If the database hiccups when her personal space opens, the page now says "Your events could not be loaded." with a Try again button, instead of saying the Event does not exist or that she has no Events (ruling 461). A send refused because the Event is not hers or she has no name says why; it never sends her to the sign-in page.

## Operator rulings for this slice

- **463** (2026-11-06 ~06:45, session fc383466) Story: the Open de Lyon ends Sunday; on Wednesday Léa opens her Photos tab to delete a photo; the server stopped taking photos Monday at midnight, but the tab would still show the send form for a month. Ruling: **the server says in her photo list whether sending is open now, by the upload door's own rule; the form hides and one line says why; My photos and Delete stay.**
- **464** (~06:45) Story: a person who is no longer on an Event's lists (dropped from its roster, out of its Workshop) loses that Event's hub, so no screen leads to the photos she sent there, though the server would still delete them. (A withdrawn fighter stays listed: 6a assumption 4.) Ruling: **accept it and name it; no cross-Event list.** The photos still go on day 31, and an organiser can delete them.
- **465** (~06:45) Story: Tom is on an Event's referee roster with no duty yet, so the Event is not in his "my events" and he has no hub to send from. Ruling: **leave it as is**: the Event joins his list with his first duty; until then he uses the QR code.

## Assumptions (mine; the operator reads them before the build)

1. **Tab order:** Overview, Schedule, Workshops, Photos. The sidebar lists the same tabs in the same order, from the same list.
2. **The tab shows when `photosShown(event.photoMode) || hasMyPhotos`** (design item 5). An Event whose mode is unknown to this build (`photoMode` null) shows no tab unless she has photos there.
3. **The page answers at its address even when the tab is hidden** (photos Off, none of hers, or a deletion just emptied the list): it shows the closed line and an empty My photos. No "not found": the hub knows the Event.
4. **The form shows only when `sendOpen` and she has a name.** `sendOpen` = mode not Off and the upload days open now, the exact rule the upload door applies before its own refusals (`photo-window.ts`). The closed line reuses the QR page's sentences (`refusal.off` when the hub says Off, else `refusal.windowClosed`). A send refused later (the window closing while the page is open, a limit) gives way the QR page's way (`refusalView`).
5. **The tags are the Event's Tournaments and Workshops as the public sees them**, read on the server with her login (`readPhotoTags`), as on the QR page: a photo can be about a Tournament she does not fight in.
6. **The form's notice line is the QR page's** ("Share only photos you took, …"), word for word.
7. **After each photo sent, My photos reads its first page again**, so the new photo appears with its status. No timer: a waiting photo turns "Shown" at the next read (a send, a reload, Retry).
8. **Delete asks first** (danger confirm, `useConfirm`). A 404 (`photo_not_found`: already deleted, from another tab) removes it from the list without a message. Any other failure says "The photo was not deleted. Try again." under it, and Delete stays.
9. **Ruling 461 on screen covers every page whose main content is "my events"**: the My events list and the hub's four tabs (Overview, Schedule, Workshops, Photos). The Tournament view (`t/[tournamentSlug]`) is left alone: its content is the public standings, and "my events" only adds her highlight there, so a failure costs the highlight, not the page. The sidebar and the dashboard's "Today" card stay silent on a failure too (named, not fixed). A body that is not a list counts as a failed read.
10. **A deleted photo stays deleted on screen** even when a read that started before the delete answers after it (a set of deleted ids filters every answer). The `hasMyPhotos` that shows the tab is read with "my events": a tab emptied by a delete stays until the next load.
11. **Two reads of the first page never land out of order**: a new one aborts the one before.
12. **No new API route, no migration.** `MyPhotos` gains `sendOpen: boolean`; the list reads the Event once more for it (an unknown Event: `false`; a read error: the list fails, 461). An archived Event is not open either: the Event lock refuses its uploads before the door (`my-photos.controller.ts:47`), so `sendOpen` also reads `status`.
13. **A login over an hour old is renewed, as every other screen does** (`packages/api-client/src/renew-login.ts:1-13`): an account send refused with a 401 asks `/me` once (the shared `renewLogin`, now exported) and sends once more; "my events" moves to `apiRequest`, which already renews. The QR send never needed a login and is unchanged.
14. **A form that gives way keeps its photo rows**, as the QR page does (`PhotoSendForm.tsx` `PhotoSendForm`): the closed line, the no-name panel and a refusal all sit above `PhotoQueue`. In the hub the closed panel has no link (she is already in the Event's hub); the no-name panel links to `/me/profile` (its Fighter tab edits the name and offers to create or claim a profile, `app/profile/fighter/FighterProfileClient.tsx:410-473`, `:709`).
15. **The Event read for the tags fails loudly**: the server page uses `readEventOnce`; not found → empty tags (the hub decides what to show), a failed read → thrown, so the segment's error page offers Try again (as `eventOrNotFound`, `app/e/[eventSlug]/_lib/event-or-not-found.ts`).

## Global Constraints

- Every new string EN + FR (`packages/i18n`), rebuilt into `dist` (`pnpm --filter @myclash/i18n build`) before an app test reads it. No `t('k') || 'fallback'`.
- `@myclash/types` is read from `dist`: `pnpm --filter @myclash/types build` after editing it.
- Tokenized UI only; no raw colours; the hub's own classes (`EventHubChrome`, `ReadFailed`).
- No real photos or personal data in fixtures (the synthetic JPEG of `photo-send.spec.ts`).
- Functions < 50 lines, files < 400 lines (specs and tests too); only entries shifted by an edit are re-pointed in `docs/code-quality-complexity-baseline.json`, audited with `baseline-audit.mjs`; a function shrunk under 50 loses its entry by hand. This slice touches six baselined functions: `EventHubChrome.tsx:20` and `MyEventsNav.tsx:53` (both shrink: the tab literal and the three links go; re-measure, drop the entry if under 50), and, shifted by the error branch above them, `me/events/[eventSlug]/page.tsx:108`, `…/workshops/page.tsx:49` and `:248`, `me/events/page.tsx:45`.
- Selects are whole literals (the schema-conformance sweep skips a built one).
- No `<form>` around the photo fields (the QR page's rule: nothing submits before React or on Enter).
- One commit, Conventional Commits header ≤ 100 characters, lower-case subject.

## Review Focus

1. A 403 `photo_not_your_event` or `photo_no_name` on Send: `apiRequest`/`responseFailure` file a 403 as `unauthenticated`. The page must show the refusal and stay (no navigation to `/login`). Task 5 story "a refusal from the server closes the form, never signs her out".
2. A signed-in send must carry no `x-photo-token` header and go to `me/events/:id/photos`; the QR send must keep its header and path. Task 2 tests, both targets.
3. A read of the first page that started before a Delete and answers after it must not bring the photo back. Task 3 test (the rule) and Task 5 `use-my-photos.test.tsx` (the hook applies it).
4. A login over an hour old: the account Send renews it and sends once more; "my events" renews it too. Task 2 test and Task 4 hook test, plus Task 5 stories (k)-(l).
5. `GET me/events` answering 500, or `{}`: every hub page shows "could not load" with Try again, never "not found" or "no events". Task 4 tests (hook) + Task 5 story.
6. `sendOpen` false while `photosShown`: no Pick button, no Send button, the closed line, the list and Delete still there. Task 5 story.

---

### Task 1: The server says whether sending is open (ruling 463)

**Files:**

- Modify: `apps/api/src/modules/photos/photo-window.ts` (add `photoSendOpen`)
- Modify: `apps/api/src/modules/photos/photo-upload.service.ts:138-157` (`admit` uses it for the window check)
- Modify: `apps/api/src/modules/photos/my-photos.service.ts:44-66` (`list` reads the Event, returns `sendOpen`)
- Modify: `packages/types/src/event-photos.ts:169-177` (`MyPhotos.sendOpen`)
- Test: `apps/api/src/modules/photos/photo-window.test.ts`, `apps/api/src/modules/photos/my-photos.test.ts`

**Interfaces:**

- Produces: `photoSendOpen(event: { start_date: string | null; end_date: string | null; timezone: unknown; photo_mode: unknown }, now: Date): boolean`; `MyPhotos { posterName: string | null; sendOpen: boolean; photos: MyPhoto[]; next: string | null }`.

- [ ] **Step 1: Failing tests.** `photo-window.test.ts`: `photoSendOpen` is false for `photo_mode: 'off'` inside the window; true for `'live'` and `'approve'` at the window's open instant; false at its close instant (half-open, the door's `>=`); false before the open; false with no `end_date` (no window); true for an unknown mode string inside the window (the door only refuses `'off'`). Use the Paris dates of the existing `photoUploadWindow` tests. `my-photos.test.ts`: `list` answers `sendOpen: true` for a Live Event inside its window and `false` for an Off one (seed the `events` row); asserts the select string `'start_date, end_date, timezone, photo_mode'` and the `id` filter; an unknown Event gives `sendOpen: false` and still lists; an archived Event inside its window gives `false`; an `events` read error rejects.
- [ ] **Step 2:** `pnpm --filter @myclash/api exec vitest run src/modules/photos/photo-window.test.ts src/modules/photos/my-photos.test.ts` → the new tests fail.
- [ ] **Step 3: Implement.** `photoSendOpen` = `photo_mode !== 'off'` and `photoUploadWindow(event)` exists and `opensAt <= now < closesAt`. In `admit`, keep the `photos_off` refusal first, then refuse `photos_window_closed` when `!photoSendOpen(event, new Date(now))` (one owner of the window test). `MyPhotos.sendOpen` in types (doc: "whether a photo can be sent now, by the upload door's rule, ruling 463"); rebuild types. `list` reads `events` (`.select('status, start_date, end_date, timezone, photo_mode').eq('id', eventId).maybeSingle()`) in parallel with the photos; error → throw; none → `false`; `sendOpen = status !== 'archived' && photoSendOpen(event, now)`. (The select string in Step 1's assertion includes `status`.)
- [ ] **Step 4:** the same command → green; then the whole photos folder (`… vitest run src/modules/photos`) green; the upload door's window tests unchanged and green.

### Task 2: One send loop, two targets

**Files:**

- Modify: `apps/web-public/src/lib/photos/send-photo.ts:62-100`, `apps/web-public/src/lib/photos/send-queue.ts:15-86` (`SendQueueDeps`, `sendOne`, `photoSender`)
- Modify: `apps/web-public/app/e/[eventSlug]/photos/send/use-photo-queue.ts:53-114`, `…/send/PhotoSendForm.tsx:173-200`
- Modify: `packages/api-client/src/renew-login.ts` (export `renewLogin`), `packages/api-client/src/index.ts:31` (re-export); rebuild `@myclash/api-client` (apps read its `dist`, `package.json` `main`)
- Test: `apps/web-public/src/lib/photos/send-photo.test.ts`, `…/send-queue.test.ts`

**Interfaces:**

- Produces: `type PhotoTarget = { kind: 'qr'; eventId: string; token: string } | { kind: 'account'; eventId: string }`; `sendPhoto(input: { apiUrl; target: PhotoTarget; file; fields; onProgress; signal })`; `photoSender(to: { apiUrl: string; target: PhotoTarget; signal: AbortSignal }, renew?: (apiUrl: string) => Promise<boolean>)` (default `renewLogin`; a parameter so the test drives it); `renewLogin(baseUrl: string): Promise<boolean>` exported from `@myclash/api-client`; `SendQueueDeps.onSent?: () => void` (called once per photo that ends `sent`); `usePhotoQueue({ apiUrl, target, t, onSent? })`.

- [ ] **Step 1: Failing tests.** `send-photo.test.ts` (its fake XHR): the QR target opens `POST <api>/api/v1/events/<id>/photos` and sets `x-photo-token`; the account target opens `POST <api>/api/v1/me/events/<id>/photos` and sets NO header (assert the recorded header list is empty); both send `withCredentials`. `send-queue.test.ts`: `onSent` is called once per sent photo and not for a refused or failed one; an account send answered 401, then `renew` true, then 201 → `sent`, with exactly two sends and one renew; `renew` false → the 401's failure, one send; a 403 `photo_no_name` → no renew; a QR send answered 401 → no renew (one send).
- [ ] **Step 2:** `pnpm --filter @myclash/web-public exec vitest run src/lib/photos/send-photo.test.ts src/lib/photos/send-queue.test.ts` → fail.
- [ ] **Step 3: Implement.** The path and the header come from the target (one `switch` on `kind`, no `default`). `sendOne` calls `deps.onSent?.()` after `at({ state: 'sent' … })`. In `photoSender`, the account arm wraps the busy-retrying send: a failure of kind `unauthenticated` with status 401 → `await renew(apiUrl)` → when true, the same send once more (the renewal sits outside the busy retries, so a renewed send still retries busy). `usePhotoQueue` passes `target` and `onSent` through (keep `onSent` in a ref; list `target.kind`, `target.eventId` and the token as `run`'s dependencies, not the object). `PhotoSendForm` passes `{ kind: 'qr', eventId, token: token ?? '' }`. Update the module docs of `send-photo.ts` ("from the Event's QR link, or from her personal space") and the race note of `usePhotoQueue`.
- [ ] **Step 4:** same command green; `tests/a11y/photo-send.spec.ts` stays green in Task 6.

### Task 3: Her photo list's rules

**Files:**

- Modify: `apps/web-public/src/lib/photos/photo-feed.ts` (generic over the photo type)
- Create: `apps/web-public/src/lib/photos/my-photos.ts`, `…/my-photos.test.ts`

**Interfaces:**

- Consumes: `MyPhotos` (Task 1).
- Produces: `PhotoFeed<P extends { id: string; createdAt: string } = PublicPhoto>` with `feedAfterFirstPage<P>`, `feedAfterMore<P>`, `feedCursor<P>` (bodies unchanged); in `my-photos.ts`: `myPhotosPath(eventId: string, before?: string): string`; `readMyPhotos(apiUrl, path, signal?): Promise<ScheduleRead<MyPhotos>>` (`notFound` never: a 404 is `failed`); `withoutDeleted(page: MyPhotos, deleted: ReadonlySet<string>): MyPhotos`; `deleteMyPhoto(apiUrl: string, eventId: string, photoId: string, t: Translate): Promise<{ kind: 'deleted' } | { kind: 'failed'; message: string }>`.

- [ ] **Step 1: Failing tests** (`my-photos.test.ts`, `apiRequest` stubbed through `fetch` as `photo-report.test.ts` does): the path is `/api/v1/me/events/<id>/photos`, `?before=<encoded>` when given; a body without `photos` array, or with a non-boolean `sendOpen`, or the catch-all `{}`, is `failed`; a 401 and a 500 are `failed`; an abort is `aborted`; `withoutDeleted` drops the deleted ids and keeps `next`; a page read before a delete does not bring the photo back (`feedAfterFirstPage(shown, withoutDeleted(page, deleted))` with the photo in the page); delete sends `DELETE …/photos/<photoId>` and a 204 is `deleted`; a 404 `photo_not_found` is `deleted`; a 503 is `failed` with `publicApp.myPhotos.deleteFailed`'s words.
- [ ] **Step 2:** `pnpm --filter @myclash/web-public exec vitest run src/lib/photos/my-photos.test.ts src/lib/photos/photo-feed.test.ts` → the new file fails, `photo-feed.test.ts` green.
- [ ] **Step 3: Implement.** Make `photo-feed.ts`'s three functions and `PhotoFeed` generic (default `PublicPhoto`, so its callers do not change). `my-photos.ts` as the interfaces say, with a module doc naming the races of assumptions 10-11.
- [ ] **Step 4:** same command green.

### Task 4: "My events" fails loudly on screen (ruling 461), and the tab list

**Files:**

- Modify: `apps/web-public/src/components/me/hooks.ts:9-35` (`useMyEvents` → `{ events, loading, error, retry }`, read through `apiRequest` so a lapsed login is renewed; a non-list body is an error), `eslint-rules/no-raw-api-fetch-baseline.json:78` (`hooks.ts` 4 → 3)
- Test: `apps/web-public/src/components/me/use-my-events.test.tsx` (jsdom, as `src/components/ShareButton.test.tsx`)
- Modify: `apps/web-public/src/components/me/EventHubChrome.tsx` (`HubTab` += `'photos'`; takes `myEvent: MyEvent`; the strip from `hubTabs`; new `HubReadFailed({ onRetry })`)
- Create: `apps/web-public/src/components/me/hub-tabs.ts`, `…/hub-tabs.test.ts`
- Modify: `apps/web-public/src/components/me/MyEventsNav.tsx:87-105` (sub-links from `hubTabs`)
- Modify: `apps/web-public/src/components/me/types.ts` (`MyEventInfo` at `:134`: `photoMode: PhotoMode | null`; `MyEvent` at `:201`: `hasMyPhotos: boolean`)
- Modify: the four callers: `app/me/events/page.tsx`, `app/me/events/[eventSlug]/page.tsx`, `…/schedule/page.tsx`, `…/workshops/page.tsx` (and the Photos page of Task 5): `if (error) return <HubReadFailed onRetry={retry} />` before the not-found branch; the three hub tabs pass `EventHubChrome myEvent={myEvent}`. `t/[tournamentSlug]/page.tsx` is not touched (assumption 9).
- Modify: `packages/i18n/src/messages/{en,fr}/publicApp.ts` (`me.hub.tabPhotos`, `me.events.loadFailed`)

**Interfaces:**

- Produces: `hubTabs(myEvent: MyEvent): HubTab[]`; `hubTabPath(slug: string, tab: HubTab): string` (overview = the index route); `photosTabShown(myEvent: MyEvent): boolean`; `HUB_TAB_LABEL: Record<HubTab, string>` (i18n keys, so a new tab without a label does not compile).

- [ ] **Step 1: Failing tests** (`hub-tabs.test.ts`): Live → four tabs ending `photos`; Approve first → four; Off and `hasMyPhotos` false → three; Off and `hasMyPhotos` true → four; `photoMode` null and no photos → three; `hubTabPath('lyon', 'overview')` is `/me/events/lyon`, `'photos'` is `/me/events/lyon/photos`; every `HUB_TAB_LABEL` value resolves in EN and FR (`getMessages` from `@myclash/i18n`, as `app/page-titles.test.ts` does: a key held in a map is no `t('…')` call, so `t-key-references` checks only that it is referenced, never that it exists). `use-my-events.test.tsx` (`// @vitest-environment jsdom`, `fetch` stubbed): a 500 → `error` true, `events` `[]`, then `retry()` with a list answer → `error` false and the list; a `{}` body → `error`; a 401, then `/api/v1/me` `claimed`, then the list → the list, no error (the renewal of `apiRequest`); an unmount aborts and sets nothing.
- [ ] **Step 2:** `pnpm --filter @myclash/web-public exec vitest run src/components/me/hub-tabs.test.ts src/components/me/use-my-events.test.tsx` → fail.
- [ ] **Step 3: Implement.** `hub-tabs.ts` is the ONE tab list (the chrome's literal and the sidebar's three links both go). `useMyEvents.retry` resets `error`, sets `events` to `null` and bumps a request key the effect reads (state set in the callback, not the effect). EN `tabPhotos: 'Photos'`, `loadFailed: 'Your events could not be loaded.'`; FR `'Photos'`, `'Vos événements n’ont pas pu être chargés.'` (the FR file's ’, in every FR string below too). Rebuild i18n.
- [ ] **Step 4:** both tests green; `pnpm --filter @myclash/web-public lint` green (the raw-fetch baseline); `pnpm --filter @myclash/web-public typecheck` green (the type widening's breaks are the checklist; no `default:`).

### Task 5: The Photos tab

**Files:**

- Create: `apps/web-public/app/e/[eventSlug]/photos/_components/PhotoForm.tsx` (moved out of `PhotoSendForm.tsx`: `PickButton`, `TextField`, `TagPicker`, `OptionalLabel`, the open form as `PhotoForm({ queue, ready, tags, poster })`; `poster` given → the "Posted as" line and no name box, name sent as `''`)
- Modify: `…/send/PhotoSendForm.tsx` (uses `PhotoForm` with no `poster`)
- Modify: `…/photos/PhotoGrid.tsx` (export `TileImage`, its prop narrowed to `Pick<PublicPhoto, 'previewUrl' | 'originalUrl' | 'caption'>`)
- Create: `apps/web-public/app/me/events/[eventSlug]/photos/layout.ts` (`titled('publicApp.titles.myPhotos')`, as `schedule/layout.ts`), `page.tsx` (server: `readEventOnce(slug)`; found → `readPhotoTags(event.id, slug, getServerApiUrl())`, not found → empty tags, failed → thrown (assumption 15); renders `HubPhotosPage`), `HubPhotosPage.tsx` (client: `useMyEvents`, loading / failed / not found, `EventHubChrome active="photos"`), `MyPhotosPanel.tsx` (the form or the closed line, then My photos), `use-my-photos.ts` (glue over Task 3), `use-my-photos.test.tsx` (jsdom)
- Modify: `packages/i18n/src/messages/{en,fr}/publicApp.ts` (`titles.myPhotos`; `myPhotos.{ postedAs, toProfile, title, empty, statusWaiting, statusShown, delete, deleteTitle, deleteText, deleteConfirm, deleteCancel, deleteFailed, loadFailed }`)
- Modify: `tests/a11y/page-titles.spec.ts` (the new title row), `apps/web-public/app/page-titles.test.ts` if it lists layouts
- Create: `tests/a11y/me-photos.spec.ts` + `tests/a11y/me-photos-stub.ts` (each < 400 lines)

**Interfaces:**

- Consumes: Tasks 1-4.
- Produces: `useMyPhotos(eventId: string): { status: 'loading' | 'shown' | 'failed'; photos: MyPhoto[]; posterName: string | null; sendOpen: boolean; hasMore; loadMore; loadingMore; moreFailed; retry; refresh; remove(photoId: string): Promise<void>; removing: ReadonlySet<string>; failedDelete: Record<string, string> }`.

- [ ] **Step 1a: Failing hook tests** (`use-my-photos.test.tsx`, `// @vitest-environment jsdom`, a `fetch` whose answers the test releases by hand): a first-page read held open, a Delete answered 204, then the read released with the photo in it → the photo stays gone; two refreshes answered newest first → the older answer changes nothing (it was aborted); a Load more answered after a refresh that stood alone → dropped (`feedAfterMore`'s guard).
- [ ] **Step 1b: Failing browser stories** (`me-photos.spec.ts`, `signInAsLea` then `page.route` for `me/events` and `**/api/v1/me/events/ev-photo/photos*` (the star: a pattern ending `/photos` misses `?before=`; one handler branching on the method: GET list, POST send) and `**/api/v1/me/events/ev-photo/photos/*` (DELETE), plus `https://bucket.test/**` for the images (`tests/a11y/photos-public-stub.ts:12`, `:52`), a list of every POST/DELETE recorded. The sidebar checks of (a) use a desktop viewport (the sidebar is `hidden … lg:flex`, `src/components/PublicPersonalShell.tsx:151`). The Event is the stub's `photo-event` (id `ev-photo`, `scripts/e2e-server-api-stub.mjs:34`): the page's Event and tag reads run ON THE SERVER, against the stub on 4010, where `page.route` sees nothing, so the `me/events` answer uses that slug and id): (a) Live Event: the hub strip and the sidebar show Photos; Off with no photos: neither does; Off with `hasMyPhotos`: both do. (b) The form says "Posted as Léa Martin" and has no "Your name" field; picking the synthetic JPEG and Send posts once to `me/events/<id>/photos` with no `x-photo-token` (asserted on the request) and the list then shows it "Waiting for approval". (c) `posterName` null: the no-name sentence and a link to `/me/profile`, no Pick button. (d) `sendOpen` false with mode Live: `refusal.windowClosed`'s line, no Pick and no Send, the list and Delete still there; with mode Off: `refusal.off`'s line. (e) Delete asks first; Cancel sends nothing; confirm sends exactly one `DELETE …/photos/<id>` and the tile goes. (f) 31 photos: Load more reads `?before=<the 30th's createdAt>` and shows the 31st. (g) A send answered 403 `photo_not_your_event`: the closed panel says `notYourEvent`'s words, the URL is still the tab's (no `/login`). (h) `me/events` answers 500: on each of `/me/events`, `/me/events/photo-event`, `…/schedule`, `…/workshops` and `…/photos` (one test per address, a loop over the list), "Your events could not be loaded." and Try again, never the not-found line or the zero state; on the Photos tab, `me/events` keeps answering 500 (the sidebar reads it too) until Try again is clicked, then lists the Event, and the tab opens. (i) `me/events` answers `{}`: the same line. (j) The first photo read fails: `myPhotos.loadFailed` with Try again and no form (the form needs `sendOpen` and the name, which come with the list); Try again's answer shows both. (k) The send answered 401, `/api/v1/me` then `claimed`, the second send 201: the photo is "Sent" and the POST list holds two sends. (l) `me/events` answered 401, `/api/v1/me` `claimed`, then the list: the tab opens with no "could not load". (m) A send refused `photos_window_closed`: the line shows and the photo's row stays under it.
- [ ] **Step 2:** start the stub (`node scripts/e2e-server-api-stub.mjs`, port 4010) and `next dev apps/web-public --port 3001`; `pnpm exec playwright test tests/a11y/me-photos.spec.ts` → fails (no route).
- [ ] **Step 3: Implement** the files above. `MyPhotosPanel`: `usePhotoQueue({ target: { kind: 'account', eventId }, onSent: refresh })`; closed line when `!sendOpen` (`refusal.off` when `myEvent.event.photoMode === 'off'`, else `refusal.windowClosed`); no-name panel when `sendOpen && posterName === null`; else `PhotoForm` with `poster`; a `queue.closedBy` gives way as on the QR page; every closed state keeps `PhotoQueue` under it (assumption 14). `ClosedPanel` moves into `PhotoForm.tsx` and takes `link: { href: string; label: string } | null` (the QR page: the Event's public home; the hub: none). The list: `TileImage`, caption, tag, time in the Event's zone (`formatInZone`, as `PhotoTile`), the status line, Delete (closed while `removing` has it). `use-my-photos.ts` holds the deleted-id set and the abort of the previous first-page read (assumptions 10-11; name both races in its doc). EN/FR copy: `postedAs: 'Posted as {name}'` / `'Publié sous le nom {name}'`; `toProfile: 'Go to my profile'` / `'Aller à mon profil'`; `title: 'My photos'` / `'Mes photos'`; `empty: 'You have not sent photos to this Event from here.'` / `'Vous n’avez pas envoyé de photos à cet événement depuis cet espace.'`; `statusWaiting: 'Waiting for approval'` / `'En attente de validation'`; `statusShown: 'Shown'` / `'Affichée'`; `delete: 'Delete'` / `'Supprimer'`; `deleteTitle: 'Delete this photo?'` / `'Supprimer cette photo ?'`; `deleteText: 'It is removed from the Event’s photos.'` / `'Elle est retirée des photos de l’événement.'`; `deleteConfirm: 'Delete'` / `'Supprimer'`; `deleteCancel: 'Cancel'` / `'Annuler'`; `deleteFailed: 'The photo was not deleted. Try again.'` / `'La photo n’a pas été supprimée. Réessayez.'`; `loadFailed: 'Your photos could not be loaded.'` / `'Vos photos n’ont pas pu être chargées.'`; `titles.myPhotos: 'My photos'` / `'Mes photos'`. Rebuild i18n.
- [ ] **Step 4:** the hook test and the spec green; `tests/a11y/photo-send.spec.ts`, `photos-public*.spec.ts`, `me-schedule.spec.ts`, `page-titles.spec.ts` green.

### Task 6: Prove, review, gates, commit

- [ ] **Falsify** (copy `falsify-4b.mjs` → `falsify-6b.mjs`, anchors after Prettier, Playwright rows with the stub and `next dev` up, nothing else running): at least one seeded break per behaviour above — `photoSendOpen`'s `>=` and its Off arm; the door using it; `list` dropping `sendOpen` or its select; the account target sending the header or the QR path; `onSent` not called; the account arm's renewal removed, and added to the QR arm; `useMyEvents` back on raw `fetch`; `sendOpen` ignoring `archived`; the closed states dropping `PhotoQueue`; the server page swallowing a failed Event read; `withoutDeleted` not applied in the hook; the abort of the previous read; `hubTabs` ignoring `hasMyPhotos`; the sidebar's own list back; `useMyEvents` non-list guard; each caller's `HubReadFailed` branch; the "Posted as" line; the no-name panel; the closed line's two sentences; Delete without the confirm; a 404 delete kept on screen; Load more's cursor; an EN key renamed (run the i18n package's own check). Every row RED, counts stable.
- [ ] **Cold code review** (`code-architecture-reviewer`, opus) over the diff; fix Important ones test-first.
- [ ] **Gates:** stop `next dev` (and the `start-server.js` left on the port); `git fetch`, `git log --oneline -1`; `gates.sh <ABSOLUTE outdir>` with `run_in_background`, `grep -v '^0 '` the summary; `pnpm --filter @myclash/api build` then `pnpm openapi:client` (commit any diff); boot the image (`boot-6a.sh`) and call `GET me/events/<id>/photos` signed out → 401.
- [ ] **Commit:** stage the explicit list (`git add --pathspec-from-file`), `git diff --cached --stat`; message via the Write tool: `feat(photos): the photos tab in the personal space, with sending, my photos and delete`. Push; `watch-ci.sh <full sha>`.

## Named, not fixed

- A person no longer on an Event's lists cannot reach her photos there on screen (464).
- A rostered referee with no duty has no hub to send from (465).
- The sidebar and the dashboard's "Today" card say nothing when "my events" fails (assumption 9).
- Every hub page reads `GET me/events` again on its own (the sidebar and the page: two reads per page), as today.
- Each photo sent reads her first page again: one login check, maybe one sign-up-name read from the auth server, 30 signed links. At 20 photos an hour per person this is small; named for a busy Event.
- `GET me/events/:id/photos` has no membership check (6a assumption 8), so `sendOpen` tells any signed-in caller whether an Event id exists and takes photos now. Event ids are UUIDs and the mode is public: accepted.

## As built: the build

- Done as planned, native on `main`, one commit, with these rulings:
  - `photoSender`'s renewal tests sit in `send-photo.test.ts` (its fake XHR) rather than `send-queue.test.ts` (node).
  - `usePhotoQueue` memoises its target (`useStableTarget`, a switch on its kind) to stay under 50 lines.
  - `readMyPhotos` answers its own `MyPhotosRead` (data / failed / aborted); `useMyPhotos(eventId, t)` takes `t` so its jsdom test needs no provider; its first page is read by an effect keyed on an ask counter (`refresh` bumps it), whose cleanup aborts the older read (`react-hooks/set-state-in-effect` refused calling a reader from the effect).
  - The browser stories are two specs and a stub (`me-photos.spec.ts`, `me-photos-failures.spec.ts`, `me-photos-stub.ts`). Their answers follow what happened (a photo sent, a login renewed after a 401, a `before`), never the order of the reads: `next dev` runs every effect twice. A Photos tab on an Event whose server read fails shows the segment's error page (story on the stub's `broken-event`).
  - `eslint-rules/no-raw-api-fetch.test.mjs` pins the baseline's total: 156 → 155 with `hooks.ts` 4 → 3.
- Proof: 45 seeded breaks, all red (`falsify-6b.mjs`; the first run found one hole, "the form shows before her list is read", whose story now also asserts no closed line while the list is unread). 88 browser stories green across the two new specs and the five neighbours (`photo-send`, `photos-public`, `photos-public-report`, `me-schedule`, `page-titles`). Hand-started `next dev` needs `run-e2e.mjs`'s placeholder `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY`, or the Event home throws.
- Cold code review (opus): 0 Critical, 2 Important, both fixed: five baseline entries re-pointed (`MyEventsNav.tsx:54`, `[eventSlug]/page.tsx:114`, `workshops/page.tsx:55` and `:254`, `me/events/page.tsx:46`; `EventHubChrome` and `MyEventsNav` stay over 50); the two planned hook tests added (a Load more after a refresh that stood alone is dropped; a page that leaves aborts the "my events" read), each falsified. Minor, fixed: a 404 counts as deleted only with `photo_not_found`; `useStableTarget` switches on the kind; a send refused `photo_no_name` gets the profile link; the panel is keyed by its Event; a failed refresh after a send is named in the hook. Minor, deferred: the hub shows a 24 px larger gap above a closed panel (`mt-6` inside `gap-6`); the tab imports the QR page's pieces across route trees (plan-approved); an approved photo reads "Shown" when the Event's mode is Off.

## As built: the plan reviews, folded

- `myclash-plan-review` converged in 2 passes (pass 1: 2 MAJOR, a "could not load" story for one page only, a form story that could not pass; 3 MINOR: server-side reads go to the stub, the Tournament view left alone, the six baseline entries named; pass 2: 1 MINOR, tab-label keys checked to exist).
- Cold `plan-reviewer` (opus): 0 BLOCKER, 3 MAJOR, 4 MINOR, 4 NIT, all folded. MAJOR: an account send after the one-hour login failed for good (now renewed once, assumption 13); the hook races were held by no test that runs the hook (now jsdom tests, web-public has them); "my events" Try again could not recover a lapsed login (now `apiRequest`). MINOR: the story's double read and the sidebar's desktop width; route patterns and the bucket route; an archived Event's `sendOpen`; closed states dropping the photo rows and the panel's link. NIT: line references, ’ in FR, `run`'s dependencies, a silent failed Event read on the server page (now thrown).
