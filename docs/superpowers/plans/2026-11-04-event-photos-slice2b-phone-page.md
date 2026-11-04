# Event photos — slice 2b: the phone upload page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A spectator scans the Event's QR code. A page on web-public opens. They pick photos, add a name, a caption and a Tournament or Workshop if they want, and send. Each photo shows its progress and its result, and a failed one can be retried. Every refusal of the API reads as a sentence in English and French.

**Architecture:**

- `packages/types` becomes the one owner of the photo contract that both sides read: the modes, the 16 refusal codes, the size limit and the two text limits. The API re-points to it (no behaviour change). The page's code→sentence map is then a `Record` over the code union, so a new code that is not translated does not compile.
- `EventInfo` (the one parser of the public Event read) gains `photoMode`. The page says "not taking photos" before anyone picks a file when the mode is Off.
- Three plain modules under `apps/web-public/src/lib/photos/`: the checks made before sending (size, first 12 bytes), the send itself (XHR, the first in the repo, because `fetch` reports no upload progress), and the refusal map plus the busy-retry loop.
- One server page `app/e/[eventSlug]/photos/send/page.tsx` loads the Event and its Tournaments and Workshops. One client form holds the queue. Photos are sent **one at a time**.

**Tech Stack:** Next 16 App Router, React 19, `useSyncExternalStore`, `XMLHttpRequest`, vitest (node + jsdom per file), Playwright (`tests/a11y/`, axe).

**Spec:** `docs/superpowers/specs/2026-11-03-event-photos-design.md` — "The uploader", "Where it shows up" item 2, Goals 7 and 7b, "When the bucket is slow or down" (Upload). The server half it calls: `apps/api/src/modules/photos/photos.controller.ts` (`POST events/:eventId/photos`).

## Assumptions (stated for the operator; each is cheap to change)

1. **The route is `/e/[eventSlug]/photos/send`**, and the printed link (slice 5 builds it) is `<public origin>/e/<slug>/photos/send#<token>`. The public Photos feed (slice 4) will be `/e/[eventSlug]/photos`. A changed Event slug breaks printed posters: named, not handled.
2. **Photos are sent one at a time**, in the order picked. That spares the 4 server slots and a weak venue uplink, and progress reads clearly.
3. **The page checks locally before sending:** more than 12 MiB, HEIC (first 12 bytes: `ftyp` + a HEIF brand), and "not a JPEG" (no `FF D8 FF`). Each gets the server's own sentence. The server stays the authority.
4. **When the mode is Off, the page says so at load** (from the public Event read). The token, the window and the caps are learned at the first Send: only the API can check them. A missing `photo_mode` in the read is "unknown": the form shows and the API decides.
5. **`photos_busy` retries 5 times on its own**, with the delay `min(16 s, 2 s × 2ⁿ) × (0.5 + random)` (1-3 s, 2-6 s, 4-12 s, 8-24 s, 8-24 s). After that the photo fails with Retry.
6. **A request still open after 120 s is cut by the page** and shown as a failure with Retry. Traefik cuts at 60 s in prod (ruling 429); the 120 s is the page's own backstop so nothing hangs where no proxy cuts (dev, another host).
7. **Three ways a refusal ends**:
   - _photo_: this photo is refused, with no Retry (it would be refused again), and the next one is sent (the five decoder codes, `file_too_large`; `photo_missing` is _stop_: nothing was wrong with the photo);
   - _stop_: this photo fails with Retry and the queue stops, the rest stay waiting for Send (`photos_unavailable`, busy after 5 tries, `photo_text_too_long`, `photo_tag_invalid`, `read_only_mode`, a plain 429, network, any 5xx);
   - _closed_: the queue stops and the form is replaced by the reason and a link to the Event's home page (`photo_link_invalid`, `photos_off`, `photos_window_closed`, `photo_device_limit`, `photo_event_limit`, `photo_event_storage_full`). Until slice 4 there is no public Photos section to offer, so the link goes to the Event's home.
8. **The page is `noindex`.** Without its token it can do nothing.
9. **Each photo goes with the fields of the latest Send or Retry tap**, read when that photo leaves. Photos picked or retried during a run join that run. Once the form is closed, no Retry is offered.
10. **A 404 (the Event is gone) and the archived-Event 403 end as _closed_**: no Retry can land.
11. **A fragment that is not base64url is no token** (the API issues an HMAC digest in base64url, `photo-token.ts:12`): the page says `linkIncomplete`. A non-Latin-1 character would otherwise make `setRequestHeader` throw.
12. **The HEIF brand list has one owner**, `PHOTO_HEIF_BRANDS` in `packages/types` (8 brands), read by the page and by the API's `sniffPhoto` (which had 6: `heim` and `heis` now say "HEIC" there too, not "not a JPEG").
13. **No `<form>` on the page**: nothing can be submitted by the browser itself, before React or by Enter in a field.
14. **The notice line (Goal 7b), builder's draft for the operator to read:**

- EN: "Share only photos you took, of people who are fine with being shown publicly. Every photo is deleted 30 days after the Event."
- FR: « Ne partagez que des photos que vous avez prises, de personnes d'accord pour être montrées publiquement. Toutes les photos sont supprimées 30 jours après l'événement. »

## As built (after the cold code review, 2026-11-04)

The tasks below are the plan as reviewed. The build changed four things in them; the code is the reference:

- The send loop and the pick are in `src/lib/photos/send-queue.ts` (`sendQueued`, `pickedItems`, `photoSender`, `pause`), tested in node (`send-queue.test.ts`): the order, each end, Retry during a run with the fields of that tap, an abort, a file the phone cannot read (`photoSend.unreadable`, its own row, the others kept). `use-photo-queue.ts` is glue split in three small hooks.
- The queue state `local-refused` is `refused`, and covers the API's refusals of a photo's own bytes too: neither offers Retry.
- `PhotoSendForm.tsx` is split (`OpenForm`, `PickButton`, `TextField`, `TagPicker`, `ClosedPanel`) under the 50-line cap; a closed form shows the list without Retry.
- The progress line is shown, not announced (`aria-hidden`); each settled state is announced once (`role="status"` / `role="alert"`). `sendPhoto` catches a throw while opening the request.

## Global Constraints

- Limits, from the spec and the server: `12 * MIB` per photo; name ≤ 40 characters, caption ≤ 200 (counted as code points by the server; the inputs' `maxLength` counts UTF-16 units, so it is stricter, never looser).
- The token is read from `location.hash`, sent only as the `x-photo-token` header, and never put in a URL the page requests or links to. Sentry already drops every fragment (`packages/types/src/sentry-data-collection.ts`, `url.fragment` in `ALWAYS_DROPPED`).
- The device cookie `mc_photo_device` must reach the API: the XHR sets `withCredentials = true` (dev is cross-origin; `@fastify/cors` reflects `x-photo-token` in the preflight).
- `<input type="file" accept="image/jpeg" multiple>`: iOS converts HEIC to JPEG on pick.
- Every user-facing string in `en` and `fr` (hard rule 6), literal keys only, in `packages/i18n/src/messages/{en,fr}/publicApp.ts` under a new `photoSend` block, plus `titles.photoSend`. No `t('k') || 'fallback'`. Counted text through `Intl`, never `(s)`.
- Tokenized UI only (`feedback_tokenized_ui`): raw tokenized inputs as `known-deviations.md` D6 (`border border-border bg-background … focus:ring-accent`), `SELECT_CLS` shape from `WorkshopsBrowser.tsx:26-27`, the dashed notice of `[s]/pass/page.tsx:235-241`, `max-w-2xl`, one `font-display` H1, `BackLink`.
- No `setState` synchronously in an effect (lint error). The token is read with `useSyncExternalStore` (server snapshot `null`), so Send is disabled in the server HTML and nothing can submit natively before React (`reference_ssr_enabled_button_native_submit`). Inputs carry no `name`.
- A new file may not use raw `fetch` against the API (`no-raw-api-fetch`); the XHR result is turned into an `ApiFailure` by `responseFailure` and spoken by `failureMessage` (`packages/api-client`).
- No real photo, name or person in fixtures (hard rule 7).
- Complexity caps 400 lines per file, 50 per function. One commit for the slice (hard rule 9 / ruling 433). Stage explicit paths.

## Review Focus

1. **The token reaches a URL.** A link, a `router` call, a request path or a query could carry it. → Task 4 asserts the XHR URL has no token; Task 6 asserts the POST URL and every request the page makes carry no token.
2. **A Send before React runs.** The server HTML must have Send disabled and no file can be sent natively. → Task 6 reads the button's `disabled` in the server HTML (`page.request.get`).
3. **Retry or Remove while the queue runs.** Two send loops at once, or the sending photo removed. → Task 5: one loop at a time (a ref), Remove hidden on the photo being sent, Retry while the loop runs only marks the photo waiting; the loop picks it up. Unmount aborts the open XHR. Task 6 pins Retry after a failure.
4. **A 429 that is ours vs the throttler's.** `failureMessage` turns every 429 into the generic sentence; the photo codes must win. → Task 3 tests `photo_device_limit` (429 + code) and a bare 429 apart.
5. **A body that is not JSON** (Traefik's 502/504 page, an empty 201). → Task 4: a non-JSON refusal is `http` with `code: null`; a 2xx without a readable body is `network` (as `apiRequest`).

---

### Task 1: The photo contract in `packages/types`, and the API re-pointed

**Files:**

- Create: `packages/types/src/event-photos.ts`, `packages/types/src/event-photos.test.ts`
- Modify: `packages/types/src/index.ts` (`export * from './event-photos';`)
- Modify: `apps/api/src/modules/photos/photo-token.ts` (drop its own `PHOTO_MODES` / `PhotoMode`, re-export from `@myclash/types` so `events.dto.ts` and the service keep their import)
- Modify: `apps/api/src/modules/photos/jpeg-strip.ts` (`PhotoRefusalCode` = `PhotoFileRefusal` from `@myclash/types`)
- Modify: `apps/api/src/modules/photos/photo-upload.service.ts` (`PHOTO_UPLOAD.maxBytes = PHOTO_MAX_BYTES`; `PHOTO_NAME_MAX` / `PHOTO_CAPTION_MAX` imported, still re-exported for its tests; `refuse` and `tooMany` take `code: PhotoUploadRefusal`)

**Interfaces — Produces:**

```ts
export const PHOTO_MODES = ['off', 'live', 'approve'] as const;
export type PhotoMode = (typeof PHOTO_MODES)[number];
export const PHOTO_MAX_BYTES = 12 * 1024 * 1024;
export const PHOTO_NAME_MAX = 40;
export const PHOTO_CAPTION_MAX = 200;
export const PHOTO_FILE_REFUSALS = [
  'photo_not_jpeg',
  'photo_heic',
  'photo_unsupported_jpeg',
  'photo_too_many_pixels',
  'photo_corrupt',
] as const;
export type PhotoFileRefusal = (typeof PHOTO_FILE_REFUSALS)[number];
export const PHOTO_UPLOAD_REFUSALS = [
  ...PHOTO_FILE_REFUSALS,
  'photo_link_invalid',
  'photos_off',
  'photos_window_closed',
  'photos_unavailable',
  'photos_busy',
  'photo_device_limit',
  'photo_event_limit',
  'photo_event_storage_full',
  'photo_text_too_long',
  'photo_tag_invalid',
  'photo_missing',
] as const;
export type PhotoUploadRefusal = (typeof PHOTO_UPLOAD_REFUSALS)[number];
export function isPhotoUploadRefusal(code: string | null): code is PhotoUploadRefusal;
```

The file's docstring says why it lives here (the pin-strength reason: the page and the API check the same numbers and codes; two copies drift).

- [ ] **Step 1: Write `event-photos.test.ts`**: the values (`12 * 1024 * 1024`, 40, 200, the 3 modes); `PHOTO_UPLOAD_REFUSALS` has 16 distinct entries and contains every file refusal; `isPhotoUploadRefusal('photos_busy')` true, `('file_too_large')` false, `(null)` false.
- [ ] **Step 2: Run** `pnpm --filter @myclash/types test` → FAIL (module missing).
- [ ] **Step 3: Write `event-photos.ts`**, export it from the index, rebuild `@myclash/types` (`pnpm --filter @myclash/types build`: the API and web read `dist`).
- [ ] **Step 4: Re-point the API** as listed under Files. `grep -rn "'photo_\|'photos_" apps/api/src/modules/photos --include=*.ts | grep -v test` must show every thrown code typed through `PhotoUploadRefusal` (a typo then fails `tsc`): `refuse` and `tooMany` by their parameter, and the two `OperationalUnavailableException` bodies (`photos_unavailable`, `photos_busy`) by a `satisfies { code: PhotoUploadRefusal; message: string }`.
- [ ] **Step 5: Run** `pnpm --filter @myclash/types test`, `pnpm --filter @myclash/api typecheck`, `pnpm --filter @myclash/api exec vitest run src/modules/photos src/modules/events` → PASS, same counts as before (photos suite 174).

### Task 2: `EventInfo.photoMode`

**Files:**

- Modify: `apps/web-public/app/e/[eventSlug]/_components/EventHeader.tsx` (`EventInfo.photoMode: PhotoMode | null`; `eventInfoOf` reads `raw['photo_mode']`, `null` unless it is one of `PHOTO_MODES`)
- Test: `apps/web-public/app/e/[eventSlug]/_lib/event-read.test.ts` (or the file that already tests `fetchEventInfo`; add there)

The API sends the whole row (`events.service.ts:658-671`, `select('*')`), so `photo_mode` is already there.

- [ ] **Step 1: Tests**, through `fetchEventInfo` with `globalThis.fetch` stubbed (no test reads `eventInfoOf`'s fields today): a read with `photo_mode: 'approve'` gives `photoMode: 'approve'`; with `'off'` gives `'off'`; with no `photo_mode` gives `null`; with `'banana'` gives `null`.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement. **Step 4: Run** `pnpm --filter @myclash/web-public exec vitest run app/e` and `typecheck` → PASS (other builders of `EventInfo` literals in tests may need `photoMode: null`).

### Task 3: The checks before sending, and the refusal map

**Files:**

- Create: `apps/web-public/src/lib/photos/photo-checks.ts`, `photo-checks.test.ts`
- Create: `apps/web-public/src/lib/photos/photo-refusal.ts`, `photo-refusal.test.ts`

**Interfaces — Produces:**

```ts
// photo-checks.ts
export type PhotoKind = 'jpeg' | 'heic' | 'other';
export function photoKindOf(head: Uint8Array): PhotoKind; // first 12 bytes
export function localRefusal(
  size: number,
  head: Uint8Array,
): 'file_too_large' | 'photo_heic' | 'photo_not_jpeg' | null;

// photo-refusal.ts
export type RefusalEnd = 'photo' | 'stop' | 'closed';
export interface RefusalView {
  end: RefusalEnd;
  message: string;
}
export function refusalView(failure: ApiFailure, t: Translate): RefusalView;
export function localRefusalView(
  code: 'file_too_large' | 'photo_heic' | 'photo_not_jpeg',
  t: Translate,
): RefusalView;
```

- `photoKindOf`: JPEG = `FF D8 FF`. HEIC = bytes 4-7 `ftyp` and bytes 8-11 one of `heic heix hevc hevx heim heis mif1 msf1`. Fewer than 12 bytes: decide on what is there (3 bytes `FF D8 FF` is still JPEG).
- `localRefusal`: `size > PHOTO_MAX_BYTES` first, then the kind.
- `refusalView`: a `Record<PhotoUploadRefusal, { key: string; end: RefusalEnd }>` with literal keys `publicApp.photoSend.refusal.<camelCase>` (precedent `src/lib/claim-refusal.ts`), the ends as Assumption 7. A photo code is read with `failureCode` **before** `failureMessage` is asked. Anything else: `failureMessage(failure, t, t('publicApp.photoSend.notSent'))`, end `photo` for `file_too_large`, `stop` otherwise. `aborted` never reaches it (the caller drops it); if it does, `{ end: 'stop', message: t('publicApp.photoSend.notSent') }`.
- `localRefusalView('file_too_large')` says `common.apiFailure.fileTooLarge` with `mb: '12'` (from `PHOTO_MAX_BYTES`), the same sentence as the server's 413.

- [ ] **Step 1: `photo-checks.test.ts`**: JPEG head → `jpeg`; `00 00 00 18 'ftypheic'` → `heic`, same for `mif1` and `heix`; `ftypisom` (an MP4) → `other`; a PNG head → `other`; 2 bytes → `other`; `localRefusal(PHOTO_MAX_BYTES, jpeg)` → null, `(PHOTO_MAX_BYTES + 1, jpeg)` → `file_too_large`, `(1000, heic)` → `photo_heic`, `(1000, png)` → `photo_not_jpeg`.
- [ ] **Step 2: `photo-refusal.test.ts`**, with the real `en` and `fr` catalogues through `createTranslator` (as `failure-message.test.ts` does):
  - every member of `PHOTO_UPLOAD_REFUSALS` gives a message that is not its key and not the API's English, in both locales, with the end of Assumption 7 (a table test);
  - `{ kind: 'http', status: 429, code: 'photo_device_limit' }` → the device-limit sentence, end `closed`; a bare 429 (`code: null`) → `common.apiFailure.tooManyRequests`, end `stop`;
  - a 503 `photos_unavailable` → its own sentence, end `stop`; a 503 `read_only_mode` → `common.apiFailure.readOnlyMode`, end `stop`;
  - a 413 `file_too_large` with `details.maxBytes = PHOTO_MAX_BYTES` → "12 MB" sentence, end `photo`;
  - `{ kind: 'network' }` → `common.apiFailure.network`, end `stop`; a 502 with no code → `publicApp.photoSend.notSent`, end `stop`;
  - a 403 `photo_link_invalid` (an `unauthenticated` member, since `responseFailure` files every 403 there) → the link sentence, end `closed`.
- [ ] **Step 3: Run** → FAIL. **Step 4:** implement both files and add the `photoSend.refusal.*` keys and `photoSend.notSent` in EN + FR (Task 5 adds the rest). **Step 5: Run** `pnpm --filter @myclash/web-public exec vitest run src/lib/photos` → PASS.

### Task 4: The send (XHR) and the busy-retry loop

**Files:**

- Create: `apps/web-public/src/lib/photos/send-photo.ts`, `send-photo.test.ts` (`// @vitest-environment jsdom`, a fake `XMLHttpRequest` class installed on `globalThis`)
- Create: `apps/web-public/src/lib/photos/busy-retry.ts`, `busy-retry.test.ts` (node)

**Interfaces — Produces:**

```ts
// send-photo.ts
export interface PhotoFields {
  name: string;
  caption: string;
  tag: PhotoTag | null;
}
export type PhotoTag = { kind: 'tournament' | 'workshop'; id: string };
export interface PhotoSent {
  id: string;
  status: 'waiting' | 'approved';
}
export const SEND_TIMEOUT_MS = 120_000;
export function sendPhoto(input: {
  apiUrl: string;
  eventId: string;
  token: string;
  file: File;
  fields: PhotoFields;
  onProgress: (fraction: number) => void;
  signal: AbortSignal;
}): Promise<ApiResult<PhotoSent>>;

// busy-retry.ts
export const BUSY_RETRIES = 5;
export function busyDelayMs(attempt: number, random: () => number): number;
export function sendRetryingBusy<T>(
  send: () => Promise<ApiResult<T>>,
  opts: {
    wait: (ms: number) => Promise<void>;
    random: () => number;
    onBusy: (attempt: number) => void;
  },
): Promise<ApiResult<T>>;
```

- `sendPhoto`: `POST ${apiUrl}/api/v1/events/${encodeURIComponent(eventId)}/photos`, header `x-photo-token`, `withCredentials = true`, `timeout = SEND_TIMEOUT_MS`. A `FormData` with `name` and `caption` only when not blank, `tournamentId` or `workshopId` from the tag, then `file` last. `upload.onprogress` → `loaded / total` when `lengthComputable`. Never rejects:
  - `load`: parse `responseText` as JSON (failure → `undefined`). 2xx with a parsed body → `{ ok: true, data }`; 2xx unparsed → `{ ok: false, kind: 'network' }`; otherwise `{ ok: false, ...responseFailure(status, parsed) }`.
  - `error`, `timeout` → `network`. `abort` (and an already-aborted `signal`) → `aborted`.
  - The file's docstring says why XHR (progress) and that the no-raw-fetch rule does not see it.
- `busyDelayMs(n, random)` = `Math.min(16_000, 2_000 * 2 ** n) * (0.5 + random())`.
- `sendRetryingBusy`: on a failure whose `failureCode` is `photos_busy` and `attempt < BUSY_RETRIES`, call `onBusy(attempt)`, `await wait(busyDelayMs(attempt, random))`, send again. Any other result returns at once. After the last busy, return that busy failure.

- [ ] **Step 1: `send-photo.test.ts`** (fake XHR records `open`, headers, `withCredentials`, `timeout`, the `FormData`, and fires events):
  - URL is `http://api/api/v1/events/ev-1/photos`, method POST, and contains no token; header `x-photo-token: tok-123`; `withCredentials` true; `timeout` 120000;
  - fields: blank name/caption absent; a workshop tag sends `workshopId` and no `tournamentId`; `file` is the last entry;
  - progress 50/100 → `onProgress(0.5)`; `lengthComputable: false` → not called;
  - 201 `{ id, status: 'waiting' }` → ok data; 403 `{ code: 'photo_link_invalid', detail }` → `kind: 'unauthenticated'`, code read; 413 with `maxBytes` → `kind: 'http'`, `details.maxBytes`; 502 HTML → `kind: 'http'`, `code: null`; 201 empty → `network`; `error` → `network`; `timeout` → `network`; `signal.abort()` mid-send → `aborted` and the fake's `abort()` was called.
- [ ] **Step 2: `busy-retry.test.ts`**: `busyDelayMs(0, () => 0)` = 1000, `(0, () => 1)` = 3000 (bound, not reached), `(3, () => 0.5)` = 16000, `(4, () => 0.5)` = 16000 (cap); busy, busy, ok → ok, `wait` called with `[busyDelayMs(0), busyDelayMs(1)]`, `onBusy` with `[0, 1]`; 6 busy → 6 sends, the busy failure returned; a 403 → one send, no wait.
- [ ] **Step 3: Run** → FAIL. **Step 4:** implement. **Step 5: Run** both → PASS.

### Task 5: The page, the form and the queue

**Files:**

- Create: `apps/web-public/app/e/[eventSlug]/photos/send/page.tsx` (server)
- Create: `apps/web-public/app/e/[eventSlug]/photos/send/PhotoSendForm.tsx` (client: fields, notice, Send, the closed panel)
- Create: `apps/web-public/app/e/[eventSlug]/photos/send/PhotoQueue.tsx` (client: one row per photo)
- Create: `apps/web-public/src/lib/photos/photo-queue.ts`, `photo-queue.test.ts` (node: the queue's state as pure transitions)
- Create: `apps/web-public/app/e/[eventSlug]/photos/send/use-photo-queue.ts` (thin glue: React state over `photo-queue.ts`, and the one send loop; `reference_hook_vs_pure_module_ledger`: the logic in a pure module keeps the hook small and testable)
- Create: `apps/web-public/app/e/[eventSlug]/photos/send/photo-token.ts` (`subscribeHash`, `readPhotoToken(): string`, server snapshot `null`; precedent `StandingsView.tsx:101-127`) with `photo-token.test.ts` (jsdom: `#abc` → `abc`, `#` → `''`, `#%20abc%20` → `abc`)
- Modify: `packages/i18n/src/messages/en/publicApp.ts`, `…/fr/publicApp.ts` (`titles.photoSend`, the `photoSend` block)

**Interfaces — Consumes:** Tasks 1-4. `eventOrNotFound`, `fetchTournaments(event.id, apiUrl)`, `fetchWorkshops(eventSlug, apiUrl)` from `home/_lib/public-event-data.ts`; `getPublicApiUrl()` from `@/lib/api-url`; `BackLink`; `titled`.

**Behaviour:**

- `page.tsx`: `generateMetadata` = the title `publicApp.titles.photoSend` and `robots: { index: false }`. Renders `<main className="mx-auto w-full max-w-2xl px-4 py-6">`, `BackLink` to `/e/${eventSlug}/home`, H1 `publicApp.photoSend.title` with the Event name under it, then `<PhotoSendForm eventId eventSlug photoMode tags>`; `tags` = `{ tournaments: {id,name}[], workshops: {id,title}[] }`.
- `PhotoSendForm`:
  - `photoMode === 'off'` → the closed panel with `refusal.off`. Token `null` (server, before hydration) → the form with Send disabled. Token `''` → the closed panel with `linkIncomplete` ("This link is not complete. Scan the QR code again.").
  - The closed panel: the sentence in a `role="status"` block, and a link "See the Event" to `/e/${eventSlug}/home`.
  - Fields: "Take or choose photos" (a button opening the hidden file input, `accept="image/jpeg"`, `multiple`, `value` reset after a pick); name (`maxLength={PHOTO_NAME_MAX}`, "optional"); caption (`maxLength={PHOTO_CAPTION_MAX}`); the Tournament / Workshop `<select>` (shown only if a list is not empty; `optgroup`s; value `''` | `t:<id>` | `w:<id>`). Each with a `<label htmlFor>`. The notice line above Send. Send disabled while nothing waits or the loop runs.
  - The fields in force at Send go with every photo of that run.
- `photo-queue.ts` (pure, no React, `File` held as an opaque value):
  - `export interface QueueItem { key: number; file: File; state: 'local-refused' | 'waiting' | 'sending' | 'busy' | 'sent' | 'failed'; progress: number; message: string | null; sent: PhotoSent['status'] | null }`;
  - `nextWaiting(items): QueueItem | null` (the first `waiting`, in pick order);
  - `keepsSending(end: RefusalEnd | 'sent'): boolean` (true for `sent` and `photo`, false for `stop` and `closed`): the loop's one rule, tested here;
  - `withState(items, key, patch): QueueItem[]`; `retried(items, key)` (`failed` → `waiting`, else unchanged); `removed(items, key)` (drops it unless `sending` / `busy`);
  - tests: `removed` on a `sending` item returns the list unchanged; `retried` on `sent` / `local-refused` is unchanged; `nextWaiting` after `retried` during a run returns that item once the earlier waiting ones are done; keys keep pick order.
- `use-photo-queue`:
  - items are `QueueItem[]`, changed only through `photo-queue.ts`;
  - `add(files)`: reads each file's first 12 bytes (`file.slice(0, 12).arrayBuffer()`), `localRefusal` → `local-refused` with its message (no Retry), else `waiting`. setState only after the `await`;
  - `send(fields)`: one loop (a `running` ref; a second call while it runs is a no-op). It takes the first `waiting` item each turn from a ref of the latest items, sends it through `sendRetryingBusy(() => sendPhoto(...))` with `wait` = a `setTimeout` promise that the unmount signal also ends, `random = Math.random`, `onBusy` → state `busy`. Then `refusalView`: `photo` → `failed`, continue; `stop` → `failed`, stop; `closed` → `failed`, stop, and the form's `closedBy` is set to the message;
  - `retry(key)`: `failed` → `waiting`, and starts the loop if it is not running; `remove(key)`: any item not `sending` / `busy`;
  - the race, named in the hook's docstring: the loop and a tap on Retry or Remove both change the items; the loop reads the ref each turn, so a photo marked waiting during a run is sent in that run, and the photo being sent cannot be removed. Unmount aborts the open XHR (an `AbortController` per hook).
- `PhotoQueue`: a list (`<ul aria-live="polite">`), each row the file name, then: a `<progress>` with "Sending… {percent}" (`Intl.NumberFormat(locale, { style: 'percent' })`); "Many photos are arriving at once. Trying again…"; "Sent." (approved) or "Sent. It will show once an organiser approves it." (waiting); the failure sentence in `role="alert"` with Retry (not for `local-refused`); Remove on `waiting` / `failed` / `local-refused`.
- i18n `photoSend`: `title`, `pick`, `nameLabel`, `captionLabel`, `optional`, `tagLabel`, `tagNone`, `tournaments`, `workshops`, `notice` (Assumption 9), `send`, `sending` (`{percent}`), `busy`, `sent`, `sentWaiting`, `retry`, `remove`, `notSent` ("The photo was not sent. Try again."), `linkIncomplete`, `seeEvent`, and `refusal.<16 codes>`. Draft sentences: the API's English made plain (e.g. `heic`: "This photo is in HEIC format. On an iPhone, open Settings › Camera › Formats and choose Most Compatible, then take it again."; `windowClosed`: "Photos are not open for this Event right now."; `deviceLimit`: "This phone has sent its photos for this hour. Try again later."; `unavailable`: "Photos are unavailable right now. Try again in a moment."; `busy`: "Many photos are arriving at once. Try again in a moment."). FR mirrors each.

- [ ] **Step 1: `photo-token.test.ts` and `photo-queue.test.ts`** → FAIL; implement; PASS.
- [ ] **Step 2: Write the page, form, queue and hook**, and the remaining i18n keys in both locales.
- [ ] **Step 3: Run** `pnpm --filter @myclash/web-public lint`, `typecheck`, `test`, and the i18n sweeps directly (`pnpm --filter @myclash/i18n test`, not through turbo: `reference_turbo_caches_i18n_sweep`) → green. Complexity: every new file under 400 lines, every function under 50.

### Task 6: The browser spec

**Files:**

- Modify: `scripts/e2e-server-api-stub.mjs` (`EVENTS['photo-event'] = { id: 'ev-photo', name: 'Open de Lyon', status: 'running', photoMode: 'approve' }` and `'photo-off-event'` (`ev-photo-off`, `photoMode: 'off'`); `eventRow` adds `photo_mode: event.photoMode` only when the fixture sets one, so every older fixture reads as before)
- Create: `tests/a11y/photo-send.spec.ts`
- Modify: `tests/a11y/page-titles.spec.ts` (a row for `/e/photo-event/photos/send` → "Send photos · Open de Lyon")

Phone viewport (`test.use({ viewport: { width: 390, height: 844 } })`). `stubPublicApi(page)` first, then `page.route('**/api/v1/events/ev-photo/photos', …)` (the later route wins). Bytes: a JPEG head `FF D8 FF E0` + zeros; a HEIC head `00 00 00 18 66 74 79 70 68 65 69 63` + zeros. Every test records every request URL and asserts none contains the token.

- [ ] **Step 1: Write the spec**:
  1. _the server HTML can send nothing_: `page.request.get(`${PUBLIC}/e/photo-event/photos/send`)` (`PUBLIC` from `tests/a11y/public-pages-stub.ts:9`) → inside `<main>`: no `<form>`, and both buttons (the picker, gated on the token alone, and Send) carry `disabled`;
  2. _Off says so and offers the Event_: `/e/photo-off-event/photos/send#tok` → the Off sentence, a link to `/e/photo-off-event/home`, no file input; axe clean;
  3. _no fragment_: `/e/photo-event/photos/send` → `linkIncomplete`;
  4. _a photo is sent and waits for approval_: `#tok-123`, pick `a.jpg`, type a name, pick the Tournament, Send → one POST, header `x-photo-token: tok-123`, its body holds `name="name"` + the name and `name="tournamentId"`; the stub answers 201 `{ id: 'p1', status: 'waiting' }` → the row reads `sentWaiting`; `expectNoCriticalAxeViolations` and `expectNoPageIssues`;
  5. _busy is retried on its own_: the stub answers 503 `{ code: 'photos_busy', detail: '…' }` once, then 201 `approved` → the row shows `busy`, then `sent` (`{ timeout: 10_000 }`: the first delay is 1-3 s); exactly 2 POSTs;
  6. _a HEIC is refused before sending_: pick `b.jpg` holding HEIC bytes (the bytes decide, not the name) → the HEIC sentence, no Retry. Then pick `a.jpg` and Send: the POSTs are exactly ONE, and its body names `a.jpg` (an empty list asserted right after a pick proves nothing: a stray POST may land later, `reference_pad_screen_tests_stubbed_browser`);
  7. _a closed window closes the form_: pick two photos, 403 `{ code: 'photos_window_closed' }` → the closed panel and its link, the second row still reads waiting; the POSTs are exactly one. (The stop itself is held by the node tests of the ends and the loop rule, which do not race.)
  8. _a failure keeps the photo and Retry sends it_: first answer `route.abort('connectionreset')`, then 201 → `common.apiFailure.network` in `role="alert"`, Retry → `sent`; 2 POSTs.
- [ ] **Step 2: Run** `pnpm test:e2e -- tests/a11y/photo-send.spec.ts tests/a11y/page-titles.spec.ts` → PASS.

### Task 7: Seeded breaks, gates, cold review, commit

- [ ] **Step 1: Falsifier** `falsify-photo-page.mjs` (copy `falsify-upload.mjs` from the 0445e882 scratchpad: rows `{ name, from, to }`, anchor-checked, restored, RED/GREEN with collected counts). At least: `photos_busy` end `stop` → `closed`; `photo_device_limit` read after `failureMessage`; `busyDelayMs` without jitter; `sendRetryingBusy` retries a 403; the token appended to the URL as `?t=`; `mif1` dropped from the HEIC brands; `withCredentials` false; `eventInfoOf` defaults `photoMode` to `'off'`; `removed` drops a `sending` item; `keepsSending('stop')` true. Each must go RED; restore; GREEN with the same counts.
- [ ] **Step 2: Gates**: `gates.sh` (copy from the 0445e882 scratchpad; `run_in_background`; `grep -v '^0 '` the summary), then the whole browser suite `pnpm test:e2e` (a new public page lands). No new dependency, so no image rebuild.
- [ ] **Step 3: Cold review**: `code-architecture-reviewer` (opus) over the diff, with this plan and the design. Measure each finding in code before folding it (`feedback_verify_hypotheses_in_code`); fix test-first; re-run the touched gates.
- [ ] **Step 4: Commit**: `git fetch`, `git log --oneline -1`, `git status --short`; stage explicit paths (`git add --pathspec-from-file=<list>`), this plan file included; `git diff --cached --stat`. Message by the Write tool, `git commit -F`, header ≤ 100 characters, e.g. `feat(photos): a phone opens the QR link and sends its photos, with progress and retry`. Push after the gates; watch CI (17 jobs).
