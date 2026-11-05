# Event photos — slice 4c: the Reported tab and Keep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the operator asked for a native build) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Both moderator screens (the organiser's Photos page in the admin site and the `photos` staff login's `/photos`) gain a third tab, **Reported**, show each photo's report count and the reporters' comments, and offer **Keep**, which clears the reports the screen showed.

**Architecture:**

- Server: `'reported'` joins `PHOTO_QUEUE_FILTERS`. The queue read embeds `event_photo_reports(comment, created_at)` on every tab, and `!inner` on Reported, so PostgREST lists only photos with a report. `ModerationPhoto` gains `reportCount`, `reportComments` and `lastReportAt`; `PublicPhoto` omits all three. `PhotoSummary` gains `reported`, counted with `count: 'exact', head: true` over the same inner embed (aggregates are off). Keep (4a) gains a body: it clears only the reports up to the newest one the screen showed (457).
- Clients: the widened union breaks both screens' `satisfies Record<PhotoQueueFilter, string>`: those breaks are the checklist (no `default:`). Each screen adds the tab, a report block on the tile, and a Keep write that reloads, as Approve does.

**Tech Stack:** NestJS + PostgREST v14.16 (supabase-js), Next 16 / React 19 (web-admin, web-staff), vitest, Playwright `tests/a11y/`.

**Spec:** `docs/superpowers/specs/2026-11-03-event-photos-design.md`: Goals 4 and 6; "Moderation"; "The public" (`[rev 445-448]`, `[rev 450-453]`); "Where it shows up" items 1 and 4. Server shape: `docs/superpowers/plans/2026-11-05-event-photos-slice4a-feed-and-report.md`. Screens: `2026-11-05-event-photos-slice5a-admin-moderation.md`, `2026-11-05-event-photos-slice5b-staff-job.md`.

**Scripts** (copy into this session's scratchpad, read first): `C:\Users\Tony\AppData\Local\Temp\claude\f--Github-Repo-MyClash\c8d2350a-c69a-4d59-b7bc-dfac07038e8a\scratchpad\` — `gates.sh <ABSOLUTE outdir>`, `replay.sh` (`KEEP=1`), `falsify-4b.mjs`, `baseline-audit.mjs`, `watch-ci.sh`, `boot-4b.sh`; web-staff falsifier rows: `…\3869a9a0-8b69-42d4-ab24-45dfa466a3bc\scratchpad\falsify-staff-photos.mjs`; web-admin rows: `…\8c6d1d65-0f24-40ba-ace9-b3f15ff3e2e9\scratchpad\falsify-moderation.mjs`.

## In plain words

Today a spectator can tap Report under a public photo and say why, but nobody sees it: the organisers' screens only know "Waiting" and "All". After this slice, the organiser's Photos page and the volunteer's photo screen both get a third tab, **Reported (3)**, listing every photo someone reported, newest photo first.

Each reported photo shows how many phones reported it ("Reports: 3") and what they wrote, newest first ("this is me, please remove"). Next to Delete there is a new button, **Keep**. Keep means "I looked, this photo is fine": the photo stays public, and the reports the moderator saw are cleared at once (no "are you sure?"). If a new report arrived after the screen was read, Keep leaves it: the photo stays in Reported with the new comment, so nobody's report is thrown away unread. If someone reports the photo again later, it comes back.

A reported photo looks the same in the All tab: its count, its comments and Keep are there too. The organiser can still Keep or Delete after the Event is archived; the volunteer's screen stops at archive, as today. Everything is in English and French.

## Operator rulings for this slice

- **445** (2026-11-05 ~17:30): three commits; **4c = the Reported tab and Keep on the admin page and the staff screen**.
- **447** (~17:30): Keep and Delete stay open to the organiser after archive; the volunteer login stops at archive (438).
- **448** (~17:30): Keep clears the reports; a later report puts the photo back in Reported.
- **452** (~19:40): the comment is stored for the moderators; **4c shows it**.
- **454** (2026-11-05 ~22:40) Story: the organiser reads Tom's "this is me", decides the photo is fine, taps Keep, which removes the report and its comment for good. Ruling: **Keep acts at once, without asking first.**
- **455** (~22:40) Story: Léa's Saturday photo is reported on Sunday while 40 other photos are reported too. Ruling: **the Reported tab lists by when the photo was sent, newest first, as Waiting and All** (same paging).
- **456** (~22:40) Story: a reported photo is also in All. Ruling: **the count, the comments and Keep show on every tab, whenever the photo has reports.**
- **457** (~22:50, from the cold plan review) Story: a volunteer reads Reported at 14:00 (one report); Tom reports at 14:40; the volunteer, whose screen never refreshed, taps Keep at 15:30. Ruling: **Keep clears only the reports the screen showed**; Tom's stays and the photo stays in Reported.

## Assumptions (mine; the operator reads them before the build)

1. **The count is the reports stored.** Past 20 a report is answered and not stored (449), so a much-reported photo reads "Reports: 20".
2. **A report with no comment counts but shows no line.** A photo reported three times with one comment reads "Reports: 3" and one comment.
3. **Comments are ordered by when each phone first reported**, newest first. A phone that changes its comment (453) keeps its place: the report's time does not change (`photo-public.service.ts:134-144` sends no `created_at`).
4. **All comments are shown in full** on the tile (20 × 200 characters at most), wrapped even with no space; no "show more".
5. **Keep shows on a reported photo only.** A photo with no report has no Keep button.
6. **Keep's refusals use the existing words**: a photo already deleted reads "This photo was already deleted."; on the staff screen an archived Event reads the existing "This event is archived…" line.
7. **The Reported count on the tab is read with the page** (the same summary read as "Waiting (n)"), and refreshed after each write and on Refresh. No polling, as today.
8. **Reported has no status filter.** A report is only taken on an approved photo (`photo-public.service.ts:126`), and a photo never goes back to waiting.
9. **"Shown" is measured by the report's time (457).** A phone that already reported and only changes its comment after the screen was read keeps its old time, so Keep clears the changed comment unseen. Closing that needs a "changed at" column (a migration); I leave it, the window is narrow.
10. **A second moderator's Keep is not refused.** Two moderators read the same reports; the first Keep clears them; the second clears nothing and answers "kept"; the reload shows the photo gone from Reported.

## As built: the plan reviews, folded

- `myclash-plan-review` converged in 1 pass (0 BLOCKER, 0 MAJOR; 3 MINOR and 1 NIT folded: the 50-line extractions, the `?? []` branch that cannot fire, the double's count, a shorter French label).
- Cold `plan-reviewer` (opus): 0 BLOCKER, 6 MAJOR, 9 MINOR, all folded. The live check named PostgREST v12.2.3, but production runs **v14.16** (`infra/docker-compose.*.yml`). An unread report could be cleared by a stale Keep, which became **ruling 457**. Two more functions would pass 50 lines. A `+`-built select drops out of the schema sweep. An existing test refused `filter: 'reported'`. The summary's `toEqual` and select list would go red.

## As built: the build

- Done as planned, with these rulings:
  - **Native, on `main`, one commit**, as CLAUDE.md asks; the executing-plans skill's worktree and per-task commits do not apply here.
  - **No axe scan in the staff spec**: no spec in `tests/a11y/` runs one; the spec asserts roles and names.
  - **No `photoPagePath('reported')` row**: it would pass with no code change, so it would hold nothing.
  - **Report times sort by code unit**, not `localeCompare`, which may weigh a time's `+` and `.` by locale.
  - **The organiser Keep's OpenAPI summary** now says "up to the newest shown", as the staff one does.
- **Live check (Task 4)**: PG17 replay + PostgREST v14.16, the service's exact reads. Reported = [B, A], each with every report; All = [B, A, C], C with `reports: []`; the count = 2; times in `+00:00` with trailing zeros dropped (`13:30:00+00:00`), which the code-unit sort orders correctly; Keep up to A's older report leaves the later one. 7/7 PASS. This is a one-off: nothing re-runs it after a PostgREST upgrade.
- **The long comment**: a 200-character comment with no space wraps inside the staff tile at 390 px, with no sideways scroll (one screenshot, checked by eye). No test holds `break-words`.
- **Falsifier** (`falsify-4c.mjs`, 35 rows: 17 API, 9 web-admin, 1 i18n, 8 web-staff Playwright): every row RED, collected counts unchanged.
- **Gates** 33/33 green.
- **Cold code review** (`code-architecture-reviewer`, opus): 0 Critical, 1 Important, 4 Minor.
  - Important: an edited comment is still cleared unseen. This is assumption 9, accepted with the plan. It is now written into the design's "Moderation" as a known gap, and raised again for the operator: a "comment changed at" column would close it.
  - Minor, fixed: a `PhotoKeepBody` type that nothing used was removed (the DTO owns the body).
  - Minor, deferred:
    - The report sort compares times as text; it is correct while PostgREST answers in UTC, which the live check confirmed.
    - No test pins the long-comment wrap.
    - `ReportLines` exists twice, once per screen (the two tiles were split by ruling 439).

## Global Constraints

- Every user-facing string in `en` and `fr` (CLAUDE.md rule 6); literal `t()` keys, never computed (`t-key-references.test.ts`). `t()` has no plurals: write "Reports: {count}".
- `PublicPhoto` must never carry a report field: comments are moderators only (0253's column comment).
- No `default:` on a `PhotoQueueFilter` switch or record.
- Every `.select(...)` is one string literal per chain (`supabase-query-scan.ts:175-188`; `photo-organiser.ts:37-38`): a constant, a `+` of a constant or a ternary inside `.select()` drops out of the schema-conformance sweep with no error.
- Tokenized UI classes only (`feedback_tokenized_ui.md`).
- Every function under 50 lines (`check-complexity.mjs:36`, start to end line inclusive), every file under 400 (specs included). No photos file is in the baseline: an overrun is red.
- Rebuild `@myclash/types` AND `@myclash/i18n` (`pnpm --filter @myclash/types build && pnpm --filter @myclash/i18n build`) before the API's tests and the apps' tests and typecheck: they read `dist`.
- One commit for the slice.

## Review Focus

1. **A photo with no report in the Reported tab.** The seeded double ignores `!inner`; only the select string and a live PostgREST read can prove the tab lists reported photos only. Task 1 asserts the string; Task 4 reads it live on v14.16.
2. **The count counts photos, not reports.** Task 4 seeds A (2 reports), B (1), C (0) and expects 2: counting reports, or dropping `!inner`, both give 3.
3. **Keep clears a report that came after the read (457).** Task 1 asserts the `lte` filter; Task 4 proves a newer report survives.
4. **Keep on an archived Event, admin page.** Approve and Delete stay live there; Keep must too (447). Task 2 adds it to `page.archived.test.tsx`.
5. **A long comment with no space breaks the tile.** Task 2 and 3 give the comment line `break-words`. No test here can see an overflow (jsdom has no layout): "As built" names it as unproved, and the build checks it once by eye on a phone-width screenshot.

---

### Task 1: the server (types, queue read, summary count, Keep's body)

**Files:**

- Modify: `packages/types/src/event-photos.ts` (`PHOTO_QUEUE_FILTERS`, `ModerationPhoto`, `PublicPhoto`, `PhotoSummary`)
- Modify: `apps/api/src/modules/photos/photo-moderation.service.ts` (`QueueRow`, `list`, a private `queueRead(eventId, filter)`, `summary`, `photoOf`, private `reported(eventId)`, `keep(event, photoId, reportsUpTo)`)
- Modify: `apps/api/src/modules/photos/photo-queue.dto.ts` (`photoKeepBodySchema`, `PhotoKeepBodyDto`)
- Modify: `apps/api/src/modules/photos/photos.controller.ts` and `photos-staff.controller.ts` (`keep` takes `@Body() body: PhotoKeepBodyDto`)
- Modify: `apps/api/src/modules/photos/testing/moderation-doubles.ts` (`photoRow` default `reports: []`; `asOrganiser.keep` takes `reportsUpTo`)
- Create: `apps/api/src/modules/photos/photo-moderation.reported.test.ts`
- Modify: `apps/api/src/modules/photos/photo-moderation.reads.test.ts` (`QUEUE_SELECT` gains the embed; the summary `toEqual` gains `reported`; `:203`'s `selectsFor(…, 'event_photos')` gains the count select)
- Modify: `apps/api/src/modules/photos/photo-moderation.writes.test.ts` (`describe('keep')`, `:113-150`)
- Modify: `apps/api/src/modules/photos/photos.controller.test.ts` (`:318`: `{ filter: 'reported' }` moves from "refuses" to accepted; Keep's body rows) and `photos-staff.controller.test.ts` (`:53` keep row passes a body)
- Regenerate: the OpenAPI client (`pnpm --filter @myclash/api build` then `pnpm openapi:client`)

**Interfaces:**

- Produces:
  - `PHOTO_QUEUE_FILTERS = ['waiting', 'reported', 'all'] as const` (tab order).
  - `ModerationPhoto` gains `reportCount: number`, `reportComments: string[]` (newest report first, null comments dropped) and `lastReportAt: string | null` (the newest report's `created_at` exactly as PostgREST wrote it; null with no report).
  - `PublicPhoto = Omit<ModerationPhoto, 'status' | 'reportCount' | 'reportComments' | 'lastReportAt'>`.
  - `PhotoSummary` gains `reported: number` (photos with at least one report; 0 from the deletion instant on).
  - `photoKeepBodySchema = z.object({ reportsUpTo: z.iso.datetime({ offset: true }) }).strict()`.
  - `keep(event, photoId, reportsUpTo): Promise<{ id: string; kept: true }>` deletes `event_photo_reports` with `.eq('photo_id', photoId).lte('created_at', reportsUpTo)`.
  - Queue reads, two literal chains: `…select('id, status, uploader_name, caption, created_at, preview_key, original_key, tournament:tournaments(name), workshop:workshops(title), reports:event_photo_reports!inner(comment, created_at)')` for Reported, the same with `reports:event_photo_reports(comment, created_at)` otherwise.
  - Count: `.from('event_photos').select('id, event_photo_reports!inner(photo_id)', { count: 'exact', head: true }).eq('event_id', eventId)`.

- [ ] **Step 1: Write the failing tests.** In `photo-moderation.reported.test.ts` (seed `photoRow(n, { status: 'approved', reports: [...] })`):
  - `it('reads the reported tab through an inner embed of the reports')`: `selectsFor(supabase.from, 'event_photos')[0]` ends with `reports:event_photo_reports!inner(comment, created_at)`; no `status` filter in `filtersFor`.
  - `it.each(['waiting', 'all'])('%s embeds the reports without narrowing the list')`: the select ends with `reports:event_photo_reports(comment, created_at)`.
  - `it('gives the count, the comments newest first without empty ones, and the newest report time')`: reports `[{comment:'old', created_at:T1}, {comment:null, created_at:T3}, {comment:'new', created_at:T2}]`, T1<T2<T3 → `reportCount: 3`, `reportComments: ['new', 'old']`, `lastReportAt: T3` (the string verbatim).
  - `it('gives 0, no comment and no time for a photo with no report')`: `reports: []` → `0`, `[]`, `null`. (No `null` embed case: a to-many embed is always an array, 0252's key is composite; Task 4 proves `[]` live.)
  - `it('counts the reported photos in the summary through the same inner embed')`: `selectsFor(…, 'event_photos')` contains `'id, event_photo_reports!inner(photo_id)'`. The double counts every photo of the Event (`supabase-chain-seeded.ts:386`): the string is the guard, Task 4 the proof.
  - `it('says 0 reported from the deletion instant on, and reads nothing for it')`.
  - In `photo-moderation.writes.test.ts` `describe('keep')`: `it('clears the reports up to the newest one shown, and no later one')`: `filtersFor(supabase.from, 'event_photo_reports')` holds `eq photo_id` and `lte created_at <T>`; the existing rows pass a `reportsUpTo`.
  - In `photos.controller.test.ts`: `filter: 'reported'` parses; `photoKeepBodySchema` refuses `{}`, `{ reportsUpTo: 'yesterday' }`, a time with no offset and an unknown key, and takes `'2026-11-08T14:05:00.123456+00:00'`; the organiser `keep` handler passes `body.reportsUpTo` to the service. In `photos-staff.controller.test.ts`: the same pass-through.
  - The public list's existing `toEqual` (`photo-public.service.feed.test.ts:81-89`) already holds "no report field": no new row there.

- [ ] **Step 2: Rebuild, run, see them fail**

Run: `pnpm --filter @myclash/types build && pnpm --filter @myclash/api exec vitest run src/modules/photos`
Expected: the new rows and the rows Step 1 changed FAIL; the rest pass.

- [ ] **Step 3: Implement.** `queueRead` holds the two literal chains; `list` adds the filters and paging after it. `photoOf` sorts `row.reports` (typed as an array, no `?? []`) by `created_at` descending, reads `lastReportAt` from the first, drops null comments. `summary` adds `expired ? 0 : this.reported(event.id)` to its `Promise.all`. Update the service's and `keep`'s docstrings (457) and the types' queue comment (436 is done).

- [ ] **Step 4: Run** the same command → PASS; `pnpm --filter @myclash/api typecheck`. Then regenerate the OpenAPI client and read its diff (the `filter` enum gains `reported`, both keeps gain a body).

### Task 2: web-admin — the tab, the report block, Keep

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/photos/PhotoQueue.tsx` (`QueueProps` gains `reported: number`, `onKeep`; `EMPTY_KEYS.reported`; the third tab; `ReportLines` and `TileActions` components: `PhotoTile` spans 48 lines, `:109-156`, and Keep would tip it over)
- Modify: `.../photos/usePhotoModeration.ts` (`keep: (photo) => send(\`${base}/photos/${photo.id}/keep\`, { method: 'POST', body: { reportsUpTo: photo.lastReportAt } })`)
- Modify: `.../photos/page.tsx` (passes `reported={summary.reported}`, `onKeep={photos.keep}`)
- Modify: `.../photos/photos-page.fixtures.ts` (`SUMMARY.reported: 1`; `photo()` defaults `reportCount: 0, reportComments: [], lastReportAt: null`; `reportedRead`; `photoReads()` answers `reportedRead` BY DEFAULT with one reported photo, because `pressEverything` presses every tab and an unknown GET throws, `archived-page.fixtures.tsx:185-228`)
- Create: `.../photos/page.reported.test.tsx`
- Modify: `.../photos/page.archived.test.tsx` (Keep is pressed and its POST is in `taken`)
- Modify: `packages/i18n/src/messages/{en,fr}/organizer.ts` (`organizer.photos.queue.*`)

**Interfaces:**

- Consumes: Task 1's types.
- Produces: i18n keys `organizer.photos.queue.reported` ("Reported ({count})" / "Signalées ({count})"), `emptyReported` ("No photo is reported." / "Aucune photo n'est signalée."), `reportCount` ("Reports: {count}" / "Signalements : {count}"), `reportComments` (list label: "Comments from the reports" / "Commentaires des signalements"), `keep` ("Keep" / "Conserver").

- [ ] **Step 1: Write the failing tests** in `page.reported.test.tsx` (same harness as `page.test.tsx`):
  - `it('shows the Reported tab with its count, and reads the reported page')`: tab "Reported (1)"; clicking it reads `/api/v1/events/ev1/photos?filter=reported`.
  - `it('shows the report count and every comment of a reported photo')`: `photo('p9', { status: 'approved', reportCount: 3, reportComments: ['this is me', 'blurry'], lastReportAt: T })` → "Reports: 3", both comments in order.
  - `it('keeps a photo at once with the newest report shown, then reloads')`: click Keep → one `POST /api/v1/events/ev1/photos/p9/keep` with body `{ reportsUpTo: T }`, no dialog, then the summary is read again.
  - `it('shows no Keep and no report line on a photo with no report')`.
  - `it('says a kept photo another organiser deleted is gone, in the reader’s words')`: 404 `photo_not_found` → "This photo was already deleted."
- [ ] **Step 2: Rebuild i18n, run** `pnpm --filter @myclash/web-admin test photos/page` → FAIL (and `typecheck` names `EMPTY_KEYS`).
- [ ] **Step 3: Implement.** Keep is `variant="secondary"` like Approve; the report block (count line, then `<ul aria-label={t(reportComments)}>`, each `<li>` with `break-words`) sits under the meta line, shown when `reportCount > 0`.
- [ ] **Step 4: Run** the same tests, then `pnpm --filter @myclash/web-admin typecheck && pnpm --filter @myclash/web-admin lint` → PASS.

### Task 3: web-staff — the tab, the report block, Keep

**Files:**

- Modify: `apps/web-staff/app/photos/page.tsx` (`EMPTY_KEYS.reported`; the tabs move to a `QueueTabs` component with the third tab and `summary.reported`: `PhotosPage` spans exactly 50 lines, `:22-71`; `onKeep`)
- Modify: `apps/web-staff/app/photos/PhotoTile.tsx` (`onKeep` prop; `ReportLines` and `TileActions` components: the signature line is 100 characters, so one more prop makes Prettier break it, ~+8 lines)
- Modify: `apps/web-staff/src/lib/usePhotoQueue.ts` (`request` and `send` take an optional body; `keep: (photo) => send(\`/api/v1/staff/photos/${photo.id}/keep\`, 'POST', { reportsUpTo: photo.lastReportAt })`)
- Modify: `apps/web-staff/src/lib/photo-queue.test.ts` (`:13-22` `photo()` gains the three fields; a `photoPagePath('reported', cursor)` row)
- Create: `tests/a11y/staff-photos-reported.spec.ts` (its own stub, as `staff-photos.spec.ts`; tiles counted with a selector scoped to the outer list, as comment `<li>`s are list items too, `staff-photos.spec.ts:75`)
- Modify: `tests/a11y/staff-photos.spec.ts` stub (`SUMMARY.reported`, photo report fields)
- Modify: `packages/i18n/src/messages/{en,fr}/scoring.ts` (`scoring.photos.*`: the same five keys as Task 2)

**Interfaces:**

- Consumes: Task 1's types; Task 2's wording (same texts, staff namespace).

- [ ] **Step 1: Write the failing tests:** in `photo-queue.test.ts`, `photoPagePath('reported', '2026-11-08T14:05:00.123456+00:00')` = `/api/v1/staff/photos?filter=reported&before=2026-11-08T14%3A05%3A00.123456%2B00%3A00`. In the spec (axe clean on each state):
  - `test('lists the reported photos with their count and comments')`.
  - `test('keeps a photo at once with the newest report shown, and reads the queue again')`: one `POST /api/v1/staff/photos/p9/keep` with body `{ reportsUpTo: T }`, no dialog, a second GET follows.
  - `test('says the event is archived when Keep is refused')`: 403 `event_results_frozen` → the `eventClosed` line.
- [ ] **Step 2: Run** `pnpm --filter @myclash/web-staff test` and the spec (start `next dev apps/web-staff --port 3002` yourself) → FAIL.
- [ ] **Step 3: Implement**, the Keep button styled as Approve (44 px, border); comment lines `break-words`.
- [ ] **Step 4: Run** both again, then `typecheck` and `lint` for web-staff → PASS. Stop `next dev`.

### Task 4: a live PostgREST v14.16 read of the inner embeds and Keep's bound

The double cannot honour `!inner` (`supabase-chain-seeded.ts:345-358`). The repo's other `!inner` counts (`stats.service.ts:299`, `venues.service.ts:489`) are to-one with a filter on the embed; this one is to-many with none. This is a one-off check: nothing re-runs it after a PostgREST upgrade (say so in "As built").

- [ ] **Step 1:** `KEEP=1 replay.sh` (PG17 on 55471), then `docker run postgrest/postgrest:v14.16` against it (the env of `infra/docker-compose.dev.yml:199`), with a service-role JWT.
- [ ] **Step 2:** Seed one Event and three photos, sent C, then A, then B: A with two reports (T1 < T2), B with one report with a comment, C with none. Run through supabase-js with the service key the exact reads Task 1 builds, then Keep's delete on A with `reportsUpTo = T1`.
- [ ] **Step 3:** Expected: Reported = [B, A], each with its reports; the count = 2; All = [B, A, C], C with `reports: []` (an array); after Keep, A holds only its T2 report. Save the script and its output in the scratchpad. Stop both containers.

### Task 5: docs, falsify, review, gates, commit

- [ ] **Step 1: Docs.** The design: "Moderation" — "Reports reach moderators as a count and their comments in the Reported tab (452)"; Keep clears the reports the screen showed (457); a `[rev 454-457, slice 4c]` line. `docs/ARCHITECTURE.md` only if it lists the queue's tabs or Keep (grep). This plan's "As built". Prettier on the plan.
- [ ] **Step 2: Falsify** (copy `falsify-4b.mjs`; rows: drop `!inner`; inner on every tab; drop the embed; drop the count read; count without `!inner`; expired still counts; sort ascending; keep null comments; `lastReportAt` from the oldest; Keep without `lte`; Keep's DTO without offset; `PublicPhoto` mapped with the fields; `'reported'` removed from the enum; admin: no Reported tab, Keep opens a confirm, Keep sends no body, no reload after Keep, comments dropped; staff: wrong keep path, no body, no reload, report block hidden; an FR key missing). Every row RED, collected counts unchanged.
- [ ] **Step 3: Cold review** (`code-architecture-reviewer`, opus); fold Critical and Important.
- [ ] **Step 4: Gates** (`gates.sh <ABSOLUTE outdir>`, every line `0`); the image boots (`GET staff/photos?filter=reported` reaches the staff gate: 401; an organiser Keep with no body: 400).
- [ ] **Step 5: Commit** `feat(photos): the reported tab, its comments and keep, on the organiser's page and the staff screen` (git fetch, `git log --oneline -1`, explicit paths, `git diff --cached --stat`), push, watch CI.
