# Event photos — slice 5b: the `photos` staff job and web-staff `/photos` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the operator asked for a native build) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An organiser creates a staff login with the new **Photos** job. That volunteer signs in to the staff app, lands on `/photos` and works the same queue as the organiser (Waiting / All, Approve, Delete), on a running Event and on a completed one, until the Event is archived.

**Architecture:**

- DB: migration 0251 re-adds the CHECK `event_staff_accounts_role_allowed` with `'photos'`.
- API, staff side: one rule says when a staff login may act on an Event that is over (ruling 437). It is used by sign-in, by every staff request and by the sign-in picker.
- API, photos side: `PhotoModerationService` gets two gates. `eventForOrganiser` is 5a's gate. `eventForStaff` is the `photos` job, scoped to the login's Event. Its four calls take the gated Event, and four `staff/photos` routes reuse them.
- web-staff: `/photos`, online only. Its state lives in a plain reducer tested in node, and the hook and page are glue.

**Tech Stack:** NestJS, Postgres 17 migration, Next 16 client page (web-staff), vitest (node env in web-staff), `@myclash/api-client` `apiRequest`.

**Spec:** `docs/superpowers/specs/2026-11-03-event-photos-design.md`: "Moderation" (the staff bullet), "Anti-goals" (the offline line), "Constraints from the codebase" ("Staff jobs"), "Where it shows up" §4.

## Operator rulings for this slice

- **435** Slice 5 is two commits; this plan is **5b**.
- **437** A `photos` staff login keeps working on a completed Event, until archive. Scoring, check-in and gear keep today's rule.
- **438** (2026-11-05 ~10:40) Story: the Event is archived and a volunteer still has the screen open. Ruling: **the `photos` login stops at archive, Delete included**. The organiser still deletes from the admin page. (The session prompt's "the staff delete open on an archived Event" is overruled.)
- **439** (~10:40) Story: the queue lives in the admin app; the staff app is separate and tests only plain modules in node. Ruling: **web-staff gets a screen of its own**, built like `/gear`, its logic in a node-tested module. The admin page is unchanged. Two screens show one queue: a later queue change is made twice.
- **440** (~10:40) Story: on Monday a `photos` volunteer cannot find the completed Event in the sign-in picker. Ruling: **the picker lists a completed Event when it has an active `photos` login**, after the open ones. A scoring volunteer who picks it gets today's "closed for staff sign-in".

## Assumptions (mine; the operator reads them in the report)

1. **The login door keeps its order for the other jobs.** `login` reads the account before the over-Event check, but the check still runs before "unknown user", "disabled" and the PIN. A check-in volunteer on a completed Event still gets the 403 `event_results_frozen` first, as today. Only a `photos` account goes on to the PIN. Side effect: on a completed Event, a 401 instead of a 403 tells that a username is a `photos` login. "Disabled" already tells as much today.
2. **The session length does not change.** A sign-in lasts until 06:00 after the Event's last day, or 12 hours when that time has passed (`getStaffSessionExpiry`). A `photos` volunteer signed in on Sunday signs in again on Monday morning, and that session lasts 12 hours. **The real end is the auto-archive, not midnight** (see "For the operator" below).
3. **A completed Event goes in a third picker tab, "Ended"**, shown only when it has rows. Today a non-running Event lands under "Upcoming", which is wrong for it. The tab defaults are Live, then Upcoming, then Ended, whichever has rows first.
4. **The staff screen shows only the queue**: Waiting (count) / All, the tiles, Approve, Delete (asks first), Load more, Refresh. It has no mode switch, no QR code and no caps. The staff `summary` route returns the same `PhotoSummary`; the screen reads `waiting` and `timezone`.
5. **A single column of tiles, phone first**, in the chrome look of `/gear` (`chromeScope`, `EventBanner`, local empty state). The image opens the original in a new tab, as on the admin page.
6. **The staff hook calls `apiRequest`, not `api.*`.** `api.*` throws, so the code `photo_not_found` would need unpacking. Also, `api.delete` sends `Content-Type: application/json` with no body, and no caller has ever sent it to this API. `apiRequest` is what the admin page uses, and what `StaffScreen` uses.
7. **The stale-link rule is the admin page's**: a broken image on a read older than 10 minutes reloads once. In the staff reducer, a read's generation drops a Load more that answers late.
8. **The app's start page lands a PIN session by its job** (`app/page.tsx`). Today it sends every signed-in session to the piste list (`router.replace(decision.kind === 'allow' ? PISTES_ON_ARRIVAL : '/login')`). The piste list's `assigned-lices` read then answers 403 `staff_role_not_allowed`, and `app/lices/page.tsx:106-113` sends that 403 to `/login`. So a `photos` volunteer who reopens the app from the home screen would sign in again. Check-in and gear volunteers have the same problem today. The fix uses `arrivalPathForRole(<role from the staff-auth/me answer>)`. A signed-in organiser (no PIN session, no role) still lands on the pistes, as today. This changes the check-in and gear landing too, for the better: one line, and the same rule.

9. **An archived Event says so on the staff screen.** A read or write that answers 403 `event_results_frozen` shows `scoring.photos.eventClosed`, not the server's English "Event is not open for staff scoring". `failureMessage` knows only `event_archived` (`failure-message.ts:146-147`).

## For the operator (found by the cold plan review, verified; not changed by this slice)

The hourly auto-archive (`apps/api/src/workers/event-archive.worker.ts:61-100`) archives a completed Event once all its Tournaments have been completed for 24 h **and** 24 h have passed since **00:00 UTC on its last day** (`new Date(end_date)`). Story: the Tournaments of an Event ending on Sunday finish at 18:00. The Event is archived on Monday at about 18:30 UTC. From then on, the phones' upload is refused (the archived lock places `POST events/:eventId/photos`), and so are the `photos` staff login and the organiser's Approve. The design promises uploads until midnight on Monday, Event clock. An Event with no Tournaments is never auto-archived. This predates 5b (slice 2a's window against the archive job). **Ruling 441** (2026-11-05 ~11:05): **a separate slice right after 5b**. While an Event's photos are not Off, the archive job waits until the upload window closes (`photoUploadWindow`).

## As built: the plan reviews, folded

- myclash-plan-review, 3 passes:
  - pass 1, 2 MAJOR: the app's first page sent a PIN session of any job to the pistes, which then sent it to sign-in (assumption 8); the page had no automated test (the a11y spec of Task 4);
  - pass 2, 2 MINOR: a falsifier row for the first page; the picker read under 50 lines;
  - pass 3 clean.
- Cold plan-reviewer (opus), 1 MAJOR, 4 MINOR:
  - M1 is the auto-archive against the upload window (verified at `event-archive.worker.ts:97-100`); it is ruling 441, the next slice;
  - folded: m1 an archived Event's refusal said in the screen's words (assumption 9); m2 the first page (already pass 1); m3 the exhaustive switch needs no `never` line (a switch with no `default` fails to compile when a job is missing: "lacks ending return statement"); m4 `@ApiOperation` per handler;
  - NITs folded: the completed read is newest first; the stale comments (`dto.ts`, the `requireStaffWithRole` docstring, the picker test); the double's one-account-per-row note.

## As built: the cold code review (code-architecture-reviewer, opus), folded

- I1 a write's refusal stayed on screen through every Refresh until the next write: Refresh and a tab change clear it, the write's own reload does not (browser cell, falsifier row).
- M1 a tile's time had no day, the day after the Event: a short date and time, in the app's language, on the Event's clock.
- M2 for a moment after a tab change, Load more offered the old tab's cursor: each read of page 1 is announced when it is asked for (`reading`), which closes Load more and drops a page asked before (reducer cell, falsifier row).
- M3 comments made untrue ("all three roles", `assertEventScorable` in two tests, "ruling 435" as the job's source): reworded.
- M4 the picker's two reads run together (`Promise.all`).
- M5, for the operator: a `photos` phone's heartbeat (app-wide, every 20 s) is now accepted on a completed Event and writes `last_seen_at`; the ledger's reason covers it.
- Found while building: `apiRequest` reports a 403 as `kind: 'unauthenticated'`, not `'http'`, so a code check on `kind === 'http'` alone never sees `event_results_frozen`.
- Falsifier: 23 seeded breaks, all red (`falsify-staff-photos.mjs` in the session scratchpad): 12 API, 8 web-staff, 2 browser, 1 on a replayed PG17.
- Complexity: every function under 50 lines; the baseline only re-points `staff.service.ts:1423` and `:1789` (shifted), per-file counts unchanged.
- Image: the API image boots, maps the four `staff/photos` routes, and loads StaffModule into PhotosModule with no injection error.

## Global Constraints

- Hard rule 3: the scoring app's offline behaviour must not change. `/photos` is **not** in `SHELL_URLS` (`apps/web-staff/public/sw.js:59-71`). `sw.test.ts`, `sw.mount.test.ts` and the offline E2E suite stay green, unedited.
- Hard rule 8 is not touched. A `photos` account has no Lice assignment (`staffRoleUsesLices` stays `role === 'scoring'`).
- Never add a `default:` to a switch over `StaffRole`. The compile breaks are the checklist (`reference_shared_union_widening`). Rebuild `packages/types` dist before an app typecheck.
- Drop the CHECK **by its name** `event_staff_accounts_role_allowed`, then read it after replay. A wrong name fails silently.
- Every user-facing string is in EN and FR, with literal keys (`t-key-references.test.ts`). The staff app reads only the `scoring`, `common`, `app`, `navigation`, `metadata`, `offline`, `test` and `statusHelp` trees (`packages/i18n/src/surfaces/staff.ts`), so it uses `scoring.photos.*`, not `actions.*` or `organizer.*`.
- Authz: every staff photo route reaches `requireStaffWithRole(req, ['photos'])` (a REFUSER, `route-authz-scan.ts:69`). Every query is scoped to the login's `event_id`. Pins stay UNDECIDED 0, DECIDED_ELSEWHERE 19, FALSE_PASSES 0. The archived-lock `placed` pin stays 188: `staff/photos/*` names no Event, so it is filed in the ledger.
- `event_photos` stays deny-all, read as the service role. No real photo or personal data in fixtures.
- Every function stays under 50 lines. Only the entries an edit shifted are re-pointed in the complexity baseline, audited with `baseline-audit.mjs`.
- OpenAPI regenerated (`pnpm openapi:emit`, `pnpm openapi:client`). The role enum widens in `generated/schema.ts`. Every `/api/v1/…` literal the page calls must exist (`frontend-route-contract.test.ts`).
- One commit, explicit paths, `git commit -F`, header ≤ 100 characters.

## Review Focus

1. **A `photos` login acting on another Event's photo.** Every write filters on `id` AND the login's `event_id`, and a photo id from Event B answers 404 and changes nothing. → Task 3 cells.
2. **A scoring, check-in or gear login on a completed Event.** It is still refused everywhere: sign-in, `/me`, its own routes. A `photos` login on a completed Event passes; on an archived one it is refused. Each job is tested on both. → Task 2 table.
3. **A `photos` login calling a scoring, desk or gear route, or a scoring login calling a staff photo route.** Both answer 403 `staff_role_not_allowed`. → Task 2 and Task 3 cells.
4. **The landing of a new job.** `photos` lands on `/photos`, never on `/lices`. A fifth job fails to compile. → Task 1.
5. **The picker on a completed Event with only a disabled `photos` login, or with only a scoring login.** It is not listed. → Task 2 cells.

---

### Task 1: The job exists (migration, union, labels, landing)

**Files:**

- Create: `packages/db/migrations/0251_event_staff_photos_role.sql`: `ALTER TABLE event_staff_accounts DROP CONSTRAINT IF EXISTS event_staff_accounts_role_allowed;`, then `ADD CONSTRAINT event_staff_accounts_role_allowed CHECK (role IN ('scoring', 'checkin', 'gear', 'photos'));`, then the COMMENT from 0173:71-72 with `| photos (moderates the Event's photos; also on a completed Event, ruling 437)`, then `NOTIFY pgrst, 'reload schema';`. The header says why the CHECK is dropped by name.
- Modify: `packages/types/src/staff-role.ts`: `STAFF_ROLES = ['scoring', 'checkin', 'gear', 'photos']`, and a `photos` line in the header list.
- Modify: `packages/ui/src/utils/status-label.ts:90-94` + `status-label.test.ts:50`.
- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/staff/types.ts:49-65` (the three Records, plus the comment at :24-33, "three counts" → four).
- Modify: `packages/i18n/src/messages/{en,fr}/common.ts` (`status.staffRole.photos`: "Photos" / "Photos"), `{en,fr}/organizer.ts` (`staff.tabHint.photos`, `staff.emptyPhotos`, `staff.createPhotos`).
- Modify: `apps/web-staff/src/lib/landing.ts`: `landingPathForRole` becomes a `switch` over `parseStaffRole(role)` with no `default` and a `const unreachable: never = parsed` after it. `photos` → `'/photos'`. + `landing.test.ts`, `screen-access.test.ts`.
- Modify: `apps/web-staff/app/page.tsx` (assumption 8): `router.replace(decision.kind === 'allow' ? arrivalPathForRole(pinRole) : '/login')`, where `pinRole` is `staff.ok ? staff.data.account?.role : undefined` (the `/me` body shape that `useStaffPinLogin.ts:61` reads). Re-point the pinned line in `src/lib/last-piste.test.ts:265-267`. Check `staff-session-decision.test.ts:125-150`, which also reads this file.

- [ ] **Step 1: Failing tests**
  - `landing.test.ts`: `landingPathForRole('photos') === '/photos'`; `arrivalPathForRole('photos') === '/photos'`.
  - `screen-access.test.ts`: `resolveScreenAccess('gear', 'photos')` → `{ kind: 'wrong_role', landingPath: '/photos' }`; `resolveScreenAccess('photos', 'scoring')` → wrong_role `/lices`.
  - `status-label.test.ts`: the list gains `'photos'`.
- [ ] **Step 2:** `pnpm --filter @myclash/web-staff test`, `pnpm --filter @myclash/ui test` → FAIL.
- [ ] **Step 3:** Implement. Rebuild `packages/types` (then `packages/ui`) dist, run `pnpm typecheck`, and work every compile break; none may get a `default:`.
- [ ] **Step 4:** Replay (`replay.sh` from slice 3's scratchpad, copied, port 55462, with the schema read edited). Then read `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'event_staff_accounts'::regclass AND contype = 'c'`. Expected: exactly one role CHECK, and it lists the four values. Also insert a `photos` row in the replayed db: accepted. Insert `'bogus'`: refused.
- [ ] **Step 5:** The tests above → PASS; `pnpm --filter @myclash/i18n test`.

---

### Task 2: A `photos` login outlives the Event's completion (ruling 437, 440)

**Files:**

- Modify: `apps/api/src/modules/staff/staff.service.ts`:
  - Replace `assertEventScorable(event)` with `assertEventOpenFor(event: EventRow, role: StaffRole | null)`. Archived: refuse. Completed: refuse unless `role === 'photos'`. A null role (no account) is refused like a non-`photos` one. Same `eventNotOpenForStaff()` refusal.
  - `login`: read the account, then `this.assertEventOpenFor(event, account ? parseStaffRole(account.role) : null)`, then the existing "unknown → 401 / disabled / PIN" checks (assumption 1).
  - `requireStaffFromRequest`: `this.assertEventOpenFor(event, parseStaffRole(account.role))` after the role check (the `whenOver` branch is unchanged).
  - `getMatchContext`'s own inline check (:1522-1523) is a bout's, scoring only: unchanged.
- Modify: `listPickerEvents`. A second read, same select and projection: `.eq('status', 'completed').eq('event_staff_accounts.status', 'active').eq('event_staff_accounts.role', 'photos')`, ordered by `start_date` **descending** (the newest ended Event first; an Event with no Tournament is never archived). Its rows are appended after the open ones, and the result is cut at `STAFF_PICKER_LIMIT`. The docstring's filter 2 is reworded. The query and the six-field mapping move into one private helper, which both reads call, so `listPickerEvents` stays under 50 lines. The baseline entries `staff.service.ts:1398` and `:1757` shift and are re-pointed. The file is already in the baseline's `files` list.
- Modify: `apps/web-staff/src/components/picker-events.ts` (`PickerTab` gains `'ended'`, `partitionPickerEvents` gives `ended: status === 'completed'`, `upcoming` excludes it, `defaultPickerTab` = live → upcoming → ended) + test; `EventPicker.tsx` shows the Ended tab only when it has rows; i18n `scoring.login.picker.ended` ("Ended" / "Terminés").
- Modify: `apps/api/src/common/testing/archived-lock-ledger.ts`: the staff reason reads "A staff session is refused once its Event is archived, and once it is completed except for the `photos` job (ruling 437) (StaffService.requireStaffFromRequest and login): staff.service.event-over.test.ts."
- Test: `staff.service.event-over.test.ts`, `staff.service.picker.test.ts`.

- [ ] **Step 1: Failing tests**
  - event-over: `it.each` over `STAFF_ROLES × ['running','completed','archived']`, for both `requireStaffWithRole(req, [role])` and `login`. Expected: running accepts every job; completed accepts `photos` only; archived refuses all (403 `event_results_frozen`). The `photos` login on a completed Event resolves to `{ token, … }` with a valid PIN (reuse `staff.service.login.fixtures.ts`).
  - event-over: on a completed Event, a check-in login with a **wrong PIN** still gets the 403, not a 401 (assumption 1). An unknown username gets the 403.
  - event-over: `getMe` for a `photos` login on a completed Event resolves.
  - picker: a completed Event with an active `photos` account is listed, after the running ones. With only a disabled `photos` account it is not listed; with only an active scoring account it is not; an archived one never is. Assert both select strings (`selectsFor`) and the `.eq('event_staff_accounts.role', 'photos')` filter.
  - web-staff `picker-events.test.ts`: `partitionPickerEvents` puts a `completed` Event in `ended`, and `defaultPickerTab({ live: [], upcoming: [], ended: [e] }) === 'ended'`.
- [ ] **Step 2:** `pnpm --filter @myclash/api exec vitest run src/modules/staff` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; then `src/common/event-readonly`, `src/common/auth/route-authz.test.ts`, the whole staff folder, `pnpm --filter @myclash/web-staff test`.

---

### Task 3: The staff photo routes

**Files:**

- Modify: `apps/api/src/modules/photos/photo-organiser.ts`. Extract `photoEvent(supabase, eventId): Promise<PhotoEventRow>`, which holds the one select literal and the 404. `organisersEvent` = `photoEvent` + `assertOrgRole(…, 'admin')`.
- Modify: `apps/api/src/modules/photos/photo-moderation.service.ts`:
  - gates: `eventForOrganiser(eventId: string, userId: string): Promise<PhotoEventRow>` (calls `organisersEvent`) and `eventForStaff(req: FastifyRequest): Promise<PhotoEventRow>` (`this.staff.requireStaffWithRole(req, PHOTO_STAFF_ROLES)`, then `photoEvent(this.supabase, staff.event_id)`); `const PHOTO_STAFF_ROLES = ['photos'] as const`;
  - the calls take the gated Event: `summary(event)`, `list(event, filter, before?)`, `approve(event, photoId)`, `remove(event, photoId)`;
  - the class doc names both gates;
  - `StaffService` is injected.
- Modify: `photos.module.ts` (imports `StaffModule`); `photos.controller.ts` (the four organiser handlers call `eventForOrganiser` then the call).
- Create: `apps/api/src/modules/photos/photos-staff.controller.ts`. `@ApiTags('photos') @Controller('staff/photos')`, with an `@ApiOperation` on each handler (`quality:api-docs`), shaped like `checkin/gear.controller.ts`:
  - `GET summary` → `PhotoSummary`
  - `GET ''` with `PhotoQueueQueryDto` → `PhotoQueuePage`
  - `POST ':photoId/approve'` (200)
  - `DELETE ':photoId'` (204)

  Each handler is `this.moderation.<call>(await this.moderation.eventForStaff(req), …)`. `ParseUUIDPipe` on `photoId`.

- Modify: `archived-lock-ledger.ts`. `POST staff/photos/:photoId/approve` and `DELETE staff/photos/:photoId` join the staff line of `LOCKED_ELSEWHERE` (ruling 438: no `@AllowOnArchivedEvent`).
- Modify: the 5a tests (`photo-moderation.reads.test.ts`, `photo-moderation.writes.test.ts`, `photos.controller.test.ts`, `testing/moderation-doubles.ts`) to the new signatures. The "refuses a non-admin" cells become `eventForOrganiser` cells, and they still assert no `event_photos` read or write.
- Create: `photos-staff.controller.test.ts`.

- [ ] **Step 1: Failing tests**
  - `eventForStaff` asks `requireStaffWithRole` for exactly `['photos']`, and reads the Event of `staff.event_id`. A rejecting staff double (403 `staff_role_not_allowed`) → no `events` or `event_photos` read.
  - Staff approve and remove of a photo of `OTHER_EVENT` → 404 `photo_not_found`, nothing written, no drain queued (assert both `.eq` filters with the login's Event).
  - Staff remove of a photo of this Event → the row is deleted and one `drain` is queued.
  - Controller: the four staff routes call the gate with `req`, then the call; `filter=bad` → 400.
  - Metadata: neither staff write route carries the archived allow marker (ruling 438), read with `Reflector`.
  - The 5a cells, re-pointed, all still pass.
- [ ] **Step 2:** `pnpm --filter @myclash/api exec vitest run src/modules/photos` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; then `src/common/auth/route-authz.test.ts` (each new handler decides; pins unchanged), `src/common/event-readonly` (placed 188), `src/common/routes`; rebuild types, `pnpm openapi:emit`, `pnpm openapi:client`, `pnpm quality:openapi-drift`.

---

### Task 4: web-staff `/photos`

**Files:**

- Create: `apps/web-staff/src/lib/photo-queue.ts` (pure) + `photo-queue.test.ts`:
  - `photoPagePath(filter: PhotoQueueFilter, before?: string): string` → `/api/v1/staff/photos?filter=…[&before=<encoded>]`
  - `interface PhotoQueueState { photos: ModerationPhoto[]; next: string | null; generation: number; loadedAt: number }`
  - `photoQueueReducer(state, action)`. The actions:
    - `{ type: 'read'; page; at }`: replace, generation + 1, `loadedAt = at`;
    - `{ type: 'more'; page; generation }`: append only when `generation === state.generation`.
  - `shouldReloadOnImageError(loadedAt: number, now: number): boolean`: `now - loadedAt > STALE_LINKS_MS` (10 min).
  - `photoFailureKey(res: ApiResult<unknown>): 'scoring.photos.alreadyDeleted' | 'scoring.photos.eventClosed' | null`: the `photo_not_found` and `event_results_frozen` codes, checked before `failureMessage`, on reads and on writes (assumption 9).
- Create: `apps/web-staff/src/lib/usePhotoQueue.ts`. Glue over `apiRequest(getApiUrl(), …)` and `useReducer(photoQueueReducer)`:
  - the summary and page 1 fetched at module scope (`react-hooks/set-state-in-effect`), re-read on a tab change and after each write;
  - `approve`, `remove`, `loadMore`, `reload`, `onImageError`, `busy`, `error`.
- Create: `apps/web-staff/app/photos/layout.tsx` (`<StaffScreen requires="photos">`), `app/photos/page.tsx`, `app/photos/PhotoTile.tsx`. Layout as `gear/page.tsx:52-98`: `<main data-theme={chromeScope}>`, `EventBanner`, h1, Refresh, `SegmentedTabs` Waiting (n) / All, a one-column list, `useConfirm` before Delete, Load more, a local empty state, the error line `<p className="mt-3 text-sm text-danger">`. The `<img>` carries the repo's `@next/next/no-img-element` disable line. Tokens only; read `docs/design/web-staff.md` and `docs/design/known-deviations.md` first.
- Modify: `packages/i18n/src/messages/{en,fr}/scoring.ts`, `photos: { title, refresh, waiting ({count}), all, tabsLabel, empty, emptyWaiting, approve, approved, delete, cancel, deleteTitle, deleteDescription, noName, imageUnavailable, photoAlt, loadMore, alreadyDeleted, eventClosed, loadError, actionError }` (EN + FR; the copy follows `organizer.photos.queue.*`). The reverse sweep refuses an unused key: each one appears as a literal in the staff app.
- Modify: `apps/web-staff/src/offline/drill-census.test.ts`. A row `'src/lib/usePhotoQueue.ts': 'apiRequest N'` (N counted after the build), under the `// open:` comment, with "photos are online only, no part of a bout".
- Modify: `docs/design/web-staff.md:58` (the route list gains `/photos`, online only).

- [ ] **Step 1: Failing tests** (`photo-queue.test.ts`, node):
  - `read` replaces the photos and bumps the generation; `more` with the current generation appends; `more` with an older generation changes nothing (the Load-more race of the 5a review, I1).
  - `photoPagePath('waiting')`, and `photoPagePath('all', '2026-11-05T12:00:00.123456+00:00')` with `+` encoded as `%2B`.
  - `shouldReloadOnImageError`: 11 minutes → true; 2 minutes → false.
  - `photoFailureKey`: a 404 with `code: 'photo_not_found'` → `alreadyDeleted`; a 403 `event_results_frozen` → `eventClosed`; a 403 `staff_role_not_allowed` → null.
- [ ] **Step 2:** `pnpm --filter @myclash/web-staff test` → FAIL.
- [ ] **Step 3:** Implement. Then `pnpm --filter @myclash/web-staff typecheck`, lint, and `pnpm --filter @myclash/i18n test`.
- [ ] **Step 4:** `sw.test.ts`, `sw.mount.test.ts`, `drill-census.test.ts` and `stays-awake.screens.test.ts` all PASS. The sw tests are unedited, which proves `/photos` is not a shell.
- [ ] **Step 5: The page in a browser, as a test.** Create `tests/a11y/staff-photos.spec.ts`, with a `page.route` stub shaped like `tests/a11y/pad-pistes-stub.ts`. Its `role` union (`:29`) gains `'photos'`, or the spec owns a small stub. It answers `staff-auth/me` with role `photos`, plus `staff/photos/summary`, `staff/photos?filter=…`, approve and delete. Cells:
  - opening the app root with a `photos` session lands on `/photos` (assumption 8);
  - a PIN sign-in with role `photos` lands on `/photos`;
  - two tiles show; Approve sends `POST /api/v1/staff/photos/p1/approve`, and the list is read again;
  - Delete asks first; Cancel sends nothing; Confirm sends `DELETE /api/v1/staff/photos/p1`;
  - a 404 `photo_not_found` shows the French text under `fr` (not the server's English);
  - a check-in session opening the root lands on `/desk`.

  Run it the way `run-e2e.mjs` cannot (it forwards no spec args): start the stub and `next dev apps/web-staff --port 3002` yourself, as the 2b falsifier does. A screenshot of `/photos` for the report.

---

### Task 5: Falsify, gates, replay, image, review, commit

- [ ] **Seeded breaks** (copy `falsify-moderation.mjs` into this session's scratchpad as `falsify-staff-photos.mjs`). Each must go RED:
  - `assertEventOpenFor` letting every job through on a completed Event; letting `photos` through on an archived one;
  - `login` checking the Event after the PIN;
  - the picker's `role = photos` filter removed;
  - `eventForStaff` asking for `['photos', 'scoring']`;
  - `eventForStaff` reading `params` instead of `staff.event_id`;
  - the staff approve or remove without `.eq('event_id', …)`;
  - `landingPathForRole`'s `photos` arm returning `/lices`;
  - the app root landing every PIN session on `PISTES_ON_ARRIVAL` again (the a11y spec's root cell);
  - the reducer appending a stale generation;
  - `photoFailureKey` ignoring either code;
  - the stale-link threshold at 0;
  - the ledger line removed (archived-lock test red);
  - `'photos'` missing from the 0251 CHECK (a db row on a fresh pg17 replay).
- [ ] **Image:** build the API image and boot it (`boot-image.sh`). The log maps the four `staff/photos` routes, and Nest boots with StaffModule imported into PhotosModule (no module cycle at real boot).
- [ ] **Gates:** `gates.sh` (the full `myclash-gates` chain), each gate green alone; `i18n#test` and `api#test` run directly; `pnpm db:migrations:replay` + the schema read of Task 1.
- [ ] **Cold review:** `code-architecture-reviewer` (opus) on the diff. Fold each finding, or name it in an "As built" section here.
- [ ] **Commit** (one, explicit paths, `git commit -F`): `feat(photos): a photos staff login approves and deletes the Event's photos, until it is archived` (96 characters).
