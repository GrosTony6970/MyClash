# Event photos — ruling 441: the auto-archive waits for the photo upload window — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the operator asked for a native build) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While an Event's photos are not Off, the hourly archive job leaves the Event completed until its photo upload window has closed (00:00 on the second day after its last day, Event clock). Phones can then send photos, and the `photos` login and the organiser's Approve keep working, until the end of the day after the last day, as the design promises.

**Architecture:**

- `photo-window.ts` already owns the upload window (`photoUploadWindow`). It gains one plain function, `photoArchiveHold(event, now)`. It returns the instant the window closes while the window is still open for uploads, and null otherwise. Its rule is the upload door's rule (`photo-upload.service.ts:105-110`): mode `off` = no uploads; no readable window = no uploads.
- `event-archive.worker.ts` reads three more columns and asks `photoArchiveHold` after its existing 24 h checks. A held Event is logged and skipped. The per-Event checks move into a private method, so `runAutoArchive` drops under 50 lines and leaves the complexity baseline.

**Tech Stack:** NestJS + BullMQ worker, `@myclash/time` (`addDays`, `dayStartUtcIso`), vitest with the seeded Supabase double (`common/testing/supabase-chain.ts`).

**Spec:** `docs/superpowers/specs/2026-11-03-event-photos-design.md`: "Goals" item 7 (the upload window), "Moderation", "Storage and deletion".

## In plain words

Think of the Event as a shop. After the last day, a caretaker comes by every hour and locks the shop for good once the doors have been quiet for a day. The photo box at the door is supposed to stay open until midnight on the day after the Event. But the caretaker counts from the wrong midnight, so on Monday afternoon he locks the shop with the photo box inside. Phones are refused, the photo volunteer is turned away, and the organiser can no longer approve.

The fix: the caretaker now looks at the photo box before he locks. If photos are switched on and the box is still open, he writes "photos still open until midnight" in his log and comes back next hour. Once the box has closed, or photos are switched off, he locks as he does today. The organiser can still lock the shop by hand at any time (ruling 442). Nothing changes for an Event with photos switched off.

## Operator rulings for this slice

- **441** (2026-11-05 ~11:05) Story: the hourly auto-archive archives an Event ~24 h after its last Tournament ends, counted from 00:00 UTC of its last day. Uploads, the `photos` login and the organiser's Approve then stop on Monday afternoon instead of Monday midnight. Ruling: **while an Event's photos are not Off, the archive job waits until the upload window closes.**
- **442** (2026-11-05, this session) Story: the organiser picks "Archived" in the Edit form on Sunday evening, and Monday's uploads are refused. Ruling: **the organiser's manual archive stays allowed at any time.** The Edit form and the "request deletion" box (which archives first) are unchanged.
- **443** (2026-11-05, this session) Story: in Approve-first mode a phone sends a photo at 23:55 on Monday; the job archives at 00:30; Approve is refused on an archived Event, so the photo stays hidden until day 31. Ruling: **the organiser may approve on an archived Event, as Delete already allows. That is a separate small slice after this one** (it touches the archived-lock list). Not built here.

## Assumptions (mine; the operator reads them in the report)

1. **Both rules must agree.** The 24 h rule (end date and last Tournament) is unchanged, and the photo hold is added on top: the Event is archived at the later of the two. Usually the window is the later one. The 24 h rule decides when a Tournament changed late, for example a result corrected on Tuesday.
2. **The job reads the mode at each run.** An organiser who turns photos Off on Monday morning lets the next run archive the Event, if the 24 h rule allows it.
3. **A held Event writes one log line per run** (`Event <id>: photo uploads open until <ISO instant>; not archived`), at most ~30 lines per Event. Nothing goes to Sentry.
4. **The job archives at the first :30 run after the window closes.** For Paris that is 00:30 local on the second day after the last day.
5. **An Event with no Tournament is still never auto-archived** (`if (!tournaments?.length) continue`). Unchanged; already named in the handoff.

## Tooling (not in git)

`C:\Users\Tony\AppData\Local\Temp\claude\f--Github-Repo-MyClash\498830eb-0bf6-4492-871c-7d2395010106\scratchpad\`: `gates.sh`, `boot-image.sh`, `baseline-audit.mjs`, `falsify-staff-photos.mjs` (the template for `falsify-archive-hold.mjs`), copied from session 3869a9a0's scratchpad.

## As built: the plan reviews, folded

- myclash-plan-review: converged in 1 pass, 2 MINOR folded (the gate never names a stale baseline entry; the close written as the door writes it).
- Cold plan-reviewer: no BLOCKER, no MAJOR; 8 MINOR folded (fixtures name `start_date`; the Task 2 seed and logger spy; a module-level row type for the line budget; Assumption 1's far-east example was wrong, the hold DOES fire there; tooling paths; the two header comments). Not taken: re-seeding the older `seeded()` rows with `photo_mode: 'off'` (surgical).

## As built: the cold code review (code-architecture-reviewer, opus), folded

- No Critical, no Important. Folded: the hold's docstring claimed the door's opening rule too (it holds until the close; the worker never asks before the opening, as `end_date >= start_date`); a comment still pointed at the moved 24 h check.
- For the operator: a photo Event now stays `completed` up to about a day longer, so it stays on the public default Event list (which hides archived ones) and open to a cross-import for that day.
- Deferred: no test pins that an Event skipped by an earlier rule logs nothing about photos.
- Noted for ruling 443's slice: a `photos` staff session still ends at 06:00 after the last day (then 12 h sessions), before the window closes.
- As built: 9 seeded breaks, all red; gates 33/33; the image boots, schedules the job and runs one `archive` job to its end.

## Global Constraints

- Hard rule 9: one commit, one concern (`feat(photos): …`, header ≤ 100 characters, lower-case subject).
- Hard rule 8 and the rest are untouched: no DB change, no route change, no user-facing string (no i18n).
- Day boundaries go through `eventZone` + `@myclash/time`, never `new Date(end_date)` (prompt §7).
- Every function the slice writes or edits stays under 50 lines. Re-point only the baseline entries this edit shifts, audited with `baseline-audit.mjs`.
- `quality:shared-types` flags the English word for "every one" (a-n-y) in a comment: avoid it.

## Review Focus

1. **The window's last minute** (half-open): at `closesAt - 1 ms` the Event is held; at `closesAt` it is not. → Task 1 test.
2. **A clock change between the last day and the close** (Paris, last day 24 Oct 2026, the clocks go back on the 25th): the hold ends at 00:00 CET on the 26th = `2026-10-25T23:00Z`. → Task 1 test.
3. **An unknown stored zone** reads on the default Event clock, as the upload door does. → Task 1 test.
4. **The read must carry the columns**: the seeded double returns every column whatever the projection, so only an assert on the SELECT string sees a dropped `photo_mode` (memory `reference_select_string_must_be_asserted`). → Task 2 test.
5. **Photos Off at the same instant archives**: the hold must not fire for `off`. → Task 1 and Task 2 tests.

---

### Task 1: `photoArchiveHold`, the window's rule for the archive job

**Files:**

- Modify: `apps/api/src/modules/photos/photo-window.ts` (append)
- Test: `apps/api/src/modules/photos/photo-window.test.ts` (append a `describe`; reuse its `midnight(day, zone)` helper)

**Interfaces:**

- Consumes: `photoUploadWindow` (same file).
- Produces: `export function photoArchiveHold(event: { start_date: string | null; end_date: string | null; timezone: unknown; photo_mode: unknown }, now: Date): Date | null`. Null when `photo_mode === 'off'`, when `photoUploadWindow(event)` is null, or when `now >= closesAt`. Otherwise `closesAt`. The docstring says it is the upload door's rule, and cites ruling 441.

- [ ] **Step 1: Write the failing tests** — `describe('photoArchiveHold — an Event ending 17 May 2026')`. Every fixture names `start_date` (= its `end_date` unless stated); without it the window is null and a case passes or fails for the wrong reason:
  - `it.each(['UTC','Europe/Paris','America/New_York','Pacific/Kiritimati'])` with `photo_mode: 'approve'`: at `midnight('2026-05-19', zone) - 1` → `getTime()` equals `midnight('2026-05-19', zone)`; at `midnight('2026-05-19', zone)` → `null`.
  - `photo_mode: 'live'` at `midnight('2026-05-19','Europe/Paris') - 1` → the same instant (Live holds too).
  - `photo_mode: 'off'` at `midnight('2026-05-18','Europe/Paris')` → `null`.
  - The clock change: `end_date: '2026-10-24'`, Europe/Paris, `approve`, at `2026-10-25T22:59:59.999Z` → `new Date('2026-10-25T23:00:00.000Z')`.
  - An unknown zone `'Mars/Base'` equals the result for the default Event clock zone (`DEFAULT_EVENT_TIMEZONE` from `@myclash/time`).
  - `start_date: null` → `null` (the door refuses every upload then).
- [ ] **Step 2: Run** `pnpm --filter @myclash/api exec vitest run src/modules/photos/photo-window.test.ts` → FAIL (`photoArchiveHold` is not exported).
- [ ] **Step 3: Implement** `photoArchiveHold` as above (about 6 lines). Write the close as the door writes it, `now.getTime() >= window.closesAt.getTime()` → null, so the falsifier's anchor is that text. The older canned worker tests seed no `start_date` and a timestamp `end_date`; `addDays` reads both as null (`packages/time/src/index.ts:116-117`), so those Events get no hold and still pass.
- [ ] **Step 4: Run the same command** → PASS.

### Task 2: The job holds an Event while its photos can still arrive

**Files:**

- Modify: `apps/api/src/workers/event-archive.worker.ts` (header comment, the candidates SELECT, the per-Event checks)
- Modify: `docs/code-quality-complexity-baseline.json` (drop `apps/api/src/workers/event-archive.worker.ts:61` once the function is under 50 lines; audit)
- Test: `apps/api/src/workers/event-archive.worker.test.ts` (a new `describe`, on the seeded double)

**Interfaces:**

- Consumes: `photoArchiveHold` (Task 1), `selectsFor`, `writesTo`, `scopedTo`, `mockSupabase` (`common/testing/supabase-chain.ts`).
- Produces: `runAutoArchive(): Promise<{ archived: string[] }>` keeps its signature. A new `private async dueForArchive(event, now): Promise<boolean>` holds the Tournament read, the all-completed check, the 24 h check and the photo hold, in that order. Only the hold logs.

- [ ] **Step 1: Write the failing tests** — `describe('EventArchiveWorker: the photo upload window (ruling 441)')`. Seed one Event `{ id: 'cup', status: 'completed', start_date: '2026-10-16', end_date: '2026-10-17', timezone: 'Europe/Paris', photo_mode }` and one completed Tournament with `updated_at: '2026-10-17T18:00:00.000Z'`. The window closes at `2026-10-18T22:00:00.000Z` (00:00 on the 19th, CEST).
  - At `2026-10-18T21:30Z` with `approve`: `archived` is `[]`, no write to `events` or `audit_log`, and the logger's `log` got `'Event cup: photo uploads open until 2026-10-18T22:00:00.000Z; not archived'`.
  - At `2026-10-18T21:30Z` with `off`: `archived` is `['cup']` (the 24 h rule alone; today's behaviour).
  - At `2026-10-18T22:30Z` with `live`: `archived` is `['cup']`.
  - The read: `selectsFor(supabase.from, 'events')[0]` contains `photo_mode`, `start_date` and `timezone` (split on `,`, trimmed, `toEqual(expect.arrayContaining([...]))`).
    Use `vi.useFakeTimers({ toFake: ['Date'], now })`, as the existing `describe` does. Seed in the shape of `seeded()` (`event-archive.worker.test.ts:216-229`): the Tournament carries `event_id: 'cup'`, and `audit_log: { rows: [] }` is seeded (without it the audit insert throws and `worker.ts:139` swallows it). Spy on the logger as `test.ts:258` does. Update the test file's header list (`test.ts:4-10`).
- [ ] **Step 2: Run** `pnpm --filter @myclash/api exec vitest run src/workers/event-archive.worker.test.ts` → the `approve` and SELECT cases FAIL; the others pass.
- [ ] **Step 3: Implement.** The SELECT becomes `'id, status, start_date, end_date, timezone, photo_mode'`. Move lines 81-100 into `dueForArchive`. After the 24 h check: `const hold = photoArchiveHold(event, now); if (hold) { this.logger.log(\`Event ${event.id}: photo uploads open until ${hold.toISOString()}; not archived\`); return false; }`. The header comment's criteria (`worker.ts:7-11`) gain "while photos are not Off, the upload window has closed (ruling 441)". The row type is a module-level `type ArchiveCandidate = Parameters<typeof photoArchiveHold>[0] & { id: string }`: an inline five-field cast passes 100 characters, Prettier splits it over ~7 lines and pushes `runAutoArchive` past 50.
- [ ] **Step 4: Run** the worker test file and `photo-window.test.ts` → all PASS, the six older worker tests included.
- [ ] **Step 5: Baseline.** Expected sizes: `runAutoArchive` 65 → about 46 lines, `dueForArchive` about 30. The gate reports only long functions missing from the baseline, never a stale entry (`scripts/check-complexity.mjs:208-216`), so remove `"apps/api/src/workers/event-archive.worker.ts:61"` by hand. Run `node scripts/check-complexity.mjs` → green. Audit with `baseline-audit.mjs`: this file 1 → 0, every other file unchanged.

### Task 3: Docs, falsify, gates, image, review, commit

**Files:**

- Modify: `docs/ARCHITECTURE.md:2623-2624` — "An Event archives itself a day after both its end date and its last Tournament's completion, and, while its photos are not Off, once its photo upload window has closed (ruling 441)".
- Modify: `docs/superpowers/specs/2026-11-03-event-photos-design.md`, Goal 7 — one `**[rev 441]**` line: the archive job waits for the window while photos are not Off; the organiser's manual archive stays allowed (442); Approve after archive is the next slice (443).

- [ ] **Step 1: Falsify.** Copy `falsify-staff-photos.mjs` to this session's scratchpad as `falsify-archive-hold.mjs`, with these rows (each must go RED):
  1. the worker never calls the hold (`if (hold)` → `if (false)`);
  2. `photo_mode` dropped from the SELECT;
  3. the half-open close: `now >= closesAt` → `now > closesAt` (or the equivalent anchor as written);
  4. the mode check removed (`=== 'off'` → `=== 'never'`);
  5. `closesAt` → `opensAt` in the hold;
  6. the log line removed;
  7. the hold moved before the Tournament read is NOT a break (skip); instead: the 24 h check removed (an existing test must go red).
- [ ] **Step 2: Gates.** `gates.sh <outdir>` in the background (no `next dev` running); `grep -v '^0 '` the summary → empty. Run `pnpm --filter @myclash/api test` directly too (turbo caches it).
- [ ] **Step 3: Image.** `boot-image.sh` (renamed tag): the worker boots, the `event-archive` scheduler is upserted, and a queued `archive` job runs to `Auto-archived 0 events`.
- [ ] **Step 4: Cold review** (`code-architecture-reviewer`, opus) on the diff; fold findings.
- [ ] **Step 5: Commit.** `git fetch`, `git log --oneline -1`, `git status --short`; stage the explicit paths; read `git diff --cached --stat`; `git commit -F <file>` with `feat(photos): the auto-archive waits until the Event's photo upload window has closed`; push; watch CI (full sha).
- [ ] **Step 6: Handoff.** Rulings 442 and 443 in the handoff's rulings list; next free 444; the next item is ruling 443's slice, then slice 4.
