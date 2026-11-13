# FightBook slice 6 (Comfort) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A FightBook fighter can set "At most N spars a day", so asks for a day already full end
"Not this time" at once; and both fighters of an agreed spar with a time get a phone reminder 10
minutes before it starts.

**Architecture:** Migration 0271 adds one deny-all table, `fightbook_daily_limits` (one row per
profile that set a limit; no row = no limit), and re-defines two functions with `CREATE OR
REPLACE`: `fightbook_ask` (0264's body plus one clause: a full day stores the ask ended, the
block's path) and `merge_fighters` (0268's body plus one statement: the survivor keeps the stricter
limit). The limit is NOT a `global_persons` column: policy 0187 lets anyone read a listed fighter's
row, and a readable limit would turn ruling 660's "an instant no may be automatic" into "an instant
no from a fighter with no limit is a block". Nothing else in SQL changes: the answer, the pick and the QR scan never read
the limit (rulings 742, 743). The settings route carries the number. The reminder is one new
scheduled notice kind, `spar_starting`, set by the API when a spar becomes agreed (a Yes, a pick)
through the existing `scheduleReminder`, and re-checked when it fires (`alert-still-wanted.ts`).

**Tech Stack:** Postgres 17 (plpgsql), NestJS + Zod DTOs, BullMQ (the notification queue), Next 16
/ React 19, `@myclash/i18n`, `@myclash/time` (`zonedToUtcIso`), Vitest, the replay probes
(`scripts/`).

**Spec:** `docs/superpowers/specs/2026-11-10-fightbook-design.md` ("Answering": Daily limit,
Reminder; "Finding a partner": a QR scan "skips the daily limit"; "Constraints": races, gates),
`docs/ARCHITECTURE.md` §11septies (.1-.9), §11ter (notices), the slice 5 plan in this folder.
Rulings (2026-11-13, `C:\Users\Tony\.claude\plans\fightbook-handoff.md`):

- **741** One number in FightBook settings that holds every day ("At most N spars a day"; blank = no
  limit), counted per day: the Event day of an Event spar, the date of a free-date spar.
- **742** The limit answers only NEW asks to her. Her own Yes on a waiting ask always goes through;
  a waiting ask stays until she answers it.
- **743** The limit stops no QR scan (spec), no pick (it follows her own "I'm in"), and none of her
  own asks.
- **744** Every live spar of hers counts: `agreed` or `done`, whoever asked. A cancelled one does
  not, and a cancel frees a place for asks that come after it.
- **745** No reminder for a spar agreed inside its last 10 minutes (a Yes or a pick).
- **747** A limit stop is a "no" like any other: the asker cannot ask the same fighter again at
  that Event (any day of it, even after a cancel frees a place); he cannot tell it from a decline
  or a block. She can still ask him.
- **746** Phone only, like the fight reminder: no email fallback. No names ("Your spar starts in 10
  minutes"); it opens My spars.

## In plain words

**Daily limit.** Julie opens FightBook settings and picks "At most 3 spars a day". On Saturday she
has said Yes to Léa, and Paul and Hugo said Yes to her asks: 3 spars. At 14:00 Marc asks her for
Saturday. His ask is saved as "Not this time" at once, exactly like an ask she declined or one a
block stopped; Julie never sees it and her phone stays silent. Sophie, who had not asked her yet,
asks for Sunday: that goes through. Paul's ask from 9:00 was already waiting: it stays in her Inbox, and if she taps Yes she has 4
spars, her choice. If Marc scans her QR at the ring, or Hugo picks her from his open call after her
"I'm in", or she asks Léa herself, the limit does nothing. If Hugo cancels at 15:00, she has 2, and
the next NEW asker's ask for Saturday waits in her Inbox as usual. But Marc, refused by the limit
at 14:00, cannot ask her again at that Event, for Saturday or Sunday, even after that cancel
(ruling 747): every "Not this time"
follows one rule (spec, "One rule for every 'Not this time'"), so he cannot tell the limit from a
decline. Julie can still ask him.

**Reminder.** Paul asks Julie for Saturday 15:00; she says Yes. At 14:50 both phones show "Your
spar starts in 10 minutes"; a tap opens My spars. No names: the phone may be locked. A spar with
no time (most QR spars) gets no reminder. One agreed at 14:56 gets none (the "agreed" or "picked"
notice just buzzed). A spar cancelled, or marked "We sparred" before 14:50, rings nobody. A fighter
with FightBook notices off, or with every notice off, gets nothing. A fighter with no phone alerts
set up gets nothing: no email.

## Global Constraints

- One migration: **0271** (max + 1 at commit time; renumber if another session lands one first).
  Pushed migrations are never edited. `fightbook_ask` and `merge_fighters` are re-defined in 0271
  with `CREATE OR REPLACE`: 0264's and 0268's bodies **word for word** plus the one clause each
  (the header comment says so, as 0268's does). `revert_fighter_merge` is not touched (0268 left the
  star switch to the survivor on a revert; the limit follows it).
- The new table: RLS on, no policy (deny-all, 0247), **`id uuid` PK** (erasure reads deletes back
  with `.select('id')`, `erasure-fightbook.ts`), and in every registry a slice-5 table is in: the
  RLS probe (`scripts/lib/rls-probe-tables.mjs` + `packages/db/fixtures/rls-probe-seed.sql`, as
  `fightbook_free_now` at :166 / :210), erasure (`erasure-fightbook.ts:63-78`), the data download
  (`subject-export.fightbook.ts`, her own row), and the archive's EXCLUDED list
  (`archive.tables.ts:659-666`) only if the archive coverage test names it (`fightbook_qr_codes`,
  keyed on the profile alone, is not listed there).
- Every CHECK a `CASE … ELSE false END`, with a name. SQL functions keep 0264's shape: SECURITY
  INVOKER, `search_path` pinned, the same revokes and grant re-stated after the replace.
- Every user-facing string in `en` and `fr`; the notice in `notices` read by `bilingual()` in
  `apps/api/src/modules/notifications/notice-texts/notice-texts.ts`, **no names** (locked phone).
- **Ruling 672 holds:** an ask stopped by the limit answers the asker the same bytes, status and
  speed as any ask (`{ id }`, the notice is never started for a stored "no").
- Every new DB read asserts its select string AND its owner filter with a fixture row the filter
  must exclude. No new route, so `route-authz.test.ts` and the archived-lock ledger are unchanged;
  the OpenAPI client is regenerated in the commit that widens the settings schema.
- Files ≤ 400 lines, functions ≤ 50, test files included (`pnpm quality:complexity` after
  prettier). `notification-scheduler.worker.ts` (955 lines) is baselined: change only `toJobData`
  and the kind union there; the reminder's scheduling lives in a new FightBook file.
- Tokenized UI only; no raw ids in UI; no real names in fixtures; **no fixture constant named
  _API_/_KEY_/_TOKEN_/_SECRET_ over a uuid or hash** (gitleaks `generic-api-key`).
- Commit subjects start lower-case. Messages via a file and `git commit -F`; `git fetch` +
  `git log --oneline -1` + `git status --short` before staging; explicit paths.
- This slice does not touch web-staff or the scoring app (hard rule 3 owes nothing new; slice 5's
  prod offline run is still owed after the next redeploy).

## Decisions taken in this plan (the builder's calls the rulings left open)

1. **The table.** `fightbook_daily_limits`: `id uuid PK default gen_random_uuid()`,
   `global_person_id uuid NOT NULL UNIQUE REFERENCES global_persons ON DELETE CASCADE`,
   `daily_limit smallint NOT NULL`, `updated_at timestamptz NOT NULL default now()` (set to
   `now()` by every write: the settings upsert and the merge's `DO UPDATE`). CHECK
   `fightbook_daily_limits_range`: `CASE WHEN daily_limit BETWEEN 1 AND 20 THEN true ELSE false
END`. No row = no limit. 20 matches the ask throttle (20 asks an hour); a limit of 0 is FightBook
   off, which already exists. A table of its own for the reason in the Architecture line (as slice
   5's `fightbook_free_now`, §11septies.9).
2. **The count** (rulings 741, 744): the receiver's rows in `spar_requests`, as asker OR receiver,
   with `spar_day = p_spar_day` and `status IN ('agreed', 'done')`. One `spar_day` for both kinds: an
   Event spar and a free-date spar on the same date both count. The two existing indexes on
   `(asker|receiver, status, spar_day)` serve it.
3. **Where it bites.** Only in `fightbook_ask`, at the line that already picks the stored status:
   `not_this_time` when the receiver blocked the asker **or** she has a `fightbook_daily_limits` row
   and her count for that day is at least its `daily_limit`; else `pending`. It runs after `not_again` and `already_asked`, as the block does, so a
   limit-stopped ask is the same row as a declined one and the no-asking-twice rule follows it.
4. **The race it leaves, accepted.** An ask that counts while one of her Yes taps commits can land
   pending past the limit. She answers it herself (ruling 742 lets every Yes through), so no lock is
   taken. The spec's "the daily limit counts under a lock on the answerer's day" is moot: no Yes is
   capped. The docs say so.
5. **Merge.** The survivor keeps the stricter limit, as the two switches keep the stricter value
   (0265, 0268): one statement in `merge_fighters` after the profile update, an insert of the
   merged profile's limit onto the survivor `ON CONFLICT (global_person_id) DO UPDATE SET
daily_limit = least(existing, excluded)`. The merged profile's own row stays where nothing reads
   it (0268's doubled favourites rule); the revert touches nothing (0268's star switch rule), so a
   reverted survivor keeps the stricter limit. No record key: nothing moved.
6. **Erasure** deletes the row (`erasure-fightbook.ts`, the list `eraseFightBookRows` walks, so
   anonymisation keeps it, as it keeps the switch). The data download carries her own row; no other
   fighter's row ever names her.
7. **Settings API.** `GET`/`PATCH me/fightbook/settings` gain `dailyLimit: number | null`. The
   patch takes `dailyLimit: z.number().int().min(1).max(20).nullable().optional()`: a number
   upserts her row on `global_person_id`, null deletes it, a missing key leaves it. The schema's
   `.refine` (`fightbook.controller.ts:61`, today "enabled or showStars") gains `dailyLimit !==
undefined`, else `{ dailyLimit: 3 }` alone is refused "Say what to change". Setting it needs only
   a profile (`requireProfile`, as `showStars`).
8. **The reminder's start.** `zonedToUtcIso(spar_day, spar_time.slice(0, 5), zone)` on the row's
   own zone: the day's own date, as an open call reads its time (slice 5 Ruling F). The slice is
   load-bearing: PostgREST returns a `TIME` as `'15:00:00'` (`open-calls.fixtures.ts:75`,
   `spar-views.ts:76`) and `zonedToUtcIso` accepts only `H:MM`/`HH:MM` (`packages/time/src/index.ts:18`,
   returns null), so without it no reminder is ever set. Lead fixed at **10 minutes**
   (`SPAR_REMINDER_LEAD_MINUTES`); the fight reminder's per-account lead setting is not reused.
9. **When it is set.** Once, when the spar becomes agreed: after `fightbook_answer` answers
   `agreed` (an ask's Yes, a QR request's Yes) and after `fightbook_call_pick`. Started, not awaited,
   after the write, like the notices. Nothing removes it on cancel, done or merge: it is re-checked
   when it fires (Decision 10). An undo of "We sparred" before the minute needs nothing: the job is
   still queued and the spar is agreed again.
10. **The re-check when it fires** (`WANTED.spar_starting`): the spar is still `agreed` AND the
    job's account still holds the asker's or the receiver's profile (`claimed_by_user_id`). A
    cancelled or done spar, a merge that moved the profile to another account, or an unclaim drops
    it, logged as "no longer wanted". `CHECKS.spar_starting` is null (a spar is never public).
11. **Switches.** The job carries `preference: 'fightbook'`; today `toJobData`
    (`notification-scheduler.worker.ts:783-793`) drops it, so it is widened to carry it as a
    conditional spread (`...(input.preference ? { preference: input.preference } : {})`): the other
    scheduled kinds set none, and their queued data stays byte-identical. The
    main switch is read at delivery as for every notice. The job carries no `email` (ruling 746):
    `sendEmailFallback` returns without one.

12. **Accepted, written in the docs.** (a) A merge that moves a spar to a profile held by ANOTHER
    account: the old account's reminder drops when it fires (Decision 10), and nothing sets one for
    the new account; the same gap as the referee alert (`alert-still-wanted.ts:241-242`). (b) A
    fighter who switched FightBook off keeps her agreed spars (ruling 666) and still gets their
    reminder; the FightBook notices switch is what stops it. (c) A time on an Event day reads on the
    day's own date (Decision 8), so "Saturday 01:00" rings Saturday 01:00, as open calls already
    read it (slice 5 Ruling F).

## Review Focus

1. **A limit-stopped ask must be the declined row**: same columns, no reason, no notice, same
   `{ id }` and same speed (ruling 672, §11septies.2) — Task 1 probe L2, Task 2 is untouched.
2. **A Yes, a pick, a QR scan or the fighter's own ask past the limit must still work** (742, 743):
   a stray `limit` check copied into `fightbook_answer` or the pick is the likeliest regression —
   Task 1 probes L8-L11.
3. **A fighter switching notices off must not be buzzed**: the preference must survive
   `toJobData` — Task 3 test "the queued job carries preference fightbook and no email".
4. **The reminder of a spar on a day in another zone**, and one in the 10 minutes: Event in
   Europe/Paris, 15:00 local starts at 13:00Z in summer and 14:00Z in winter, and rings 10 minutes
   earlier; one agreed at 14:56 local → no job —
   Task 3 tests, run under `TZ=UTC` too.
5. **A reminder after a merge or unclaim must not reach an account that no longer holds the
   fighter** — Task 3 WANTED test.

## File map

- Create `packages/db/migrations/0271_fightbook_comfort.sql`.
- Modify `scripts/db-fightbook-probe.mjs` (header) + create `scripts/lib/fightbook-probe-limit.mjs`;
  create `scripts/lib/merge-probe-fightbook-limit.mjs` (wired into `scripts/db-merge-probe.mjs`,
  its declared count raised if it declares one); modify `scripts/lib/rls-probe-tables.mjs`,
  `packages/db/fixtures/rls-probe-seed.sql`.
- Modify `packages/types/src/fightbook.ts` (`FightBookSettings.dailyLimit`).
- Modify `apps/api/src/modules/fightbook/fightbook.controller.ts` (`settingsSchema`),
  `fightbook-settings.service.ts` (+ test), `modules/privacy/erasure-fightbook.ts`,
  `subject-export.fightbook.ts` (+ their tests), `modules/exports/archive.tables.ts` if its
  coverage test asks.
- Create `apps/api/src/modules/fightbook/spar-reminder.ts` (+ `spar-reminder.test.ts`); modify
  `spar-requests.service.ts`, `open-calls.service.ts`, `fightbook.module.ts` if a provider is
  needed; `workers/notification-scheduler.worker.ts` (kind, `toJobData`),
  `workers/alert-still-wanted.ts`, `workers/alert-visibility.ts`, the kind lists in
  `workers/notification-job-id.test.ts:59` and `workers/notification-switched-off.test.ts:116`,
  `notifications/notice-texts/notice-texts.ts`, `packages/i18n/src/messages/{en,fr}/notices.ts`.
- Modify `apps/web-public/app/me/fightbook/FightBookSettingsPanel.tsx`, `FightBookClient.tsx`,
  `fightbook-patches.ts` (+ tests), `packages/i18n/src/messages/{en,fr}/` public-app FightBook keys.
- Modify `docs/ARCHITECTURE.md` (§11septies header, .1, .2, .3, .5, new .10; §11ter.2 table).

### Task 1: Migration 0271 and its probes

**Files:** create `0271_fightbook_comfort.sql`, `scripts/lib/fightbook-probe-limit.mjs`; modify
`scripts/db-fightbook-probe.mjs` (wire the scenarios, header paragraph "Slice 6"),
`scripts/db-merge-probe.mjs` (wire the new `scripts/lib/merge-probe-fightbook-limit.mjs`, raise its
declared count if it has one), `scripts/lib/rls-probe-tables.mjs`,
`packages/db/fixtures/rls-probe-seed.sql`.

**Interfaces:** Produces the table `fightbook_daily_limits (id, global_person_id UNIQUE,
daily_limit, updated_at)` and the CHECK name `fightbook_daily_limits_range` (Task 2 reads and
writes the table).

- [ ] **Step 1: Write the probe checks** in `fightbook-probe-limit.mjs`, the existing scenario
      shape (seeded profiles, one savepoint each). Each asserts the stored `status` of a new ask from
      `fightbook_ask` (receiver Julie, day D unless named):
  - L1 no limit, 5 agreed on D → `pending`.
  - L2 limit 2; one agreed spar Julie asked + one she received, both on D → `not_this_time`; the row
    equals a declined row column for column except ids and times (the existing "same row" helper);
    `agreed_at` and `shared_comment` null.
  - L3 same state, ask for D+1 → `pending`.
  - L4 one `done` + one `agreed` on D, limit 2 → `not_this_time`.
  - L5 one `agreed` + one `cancelled` on D, limit 2 → `pending`; likewise `pending`, `withdrawn` and
    `not_this_time` rows do not count.
  - L6 one Event spar and one free-date spar on D, limit 2 → `not_this_time`.
  - L7 (ruling 747) after L2's stop, one of the two counted spars is cancelled; the same asker then
    asks for D and for D+1 of the same Event → each raises `not_again`. A free-date variant: a
    free-date ask stopped by the limit, the same asker asks for another free date inside 7 days →
    `not_again`.
  - L8 limit 2, two agreed on D, a third ask that was already `pending` → `fightbook_answer(…, 'yes')`
    answers `agreed` (ruling 742).
  - L9 Julie at her limit shows her QR; `fightbook_qr_log` by Marc → the stored row is `pending`.
  - L10 Julie at her limit answered Hugo's open call; `fightbook_call_pick` → a spar `agreed`.
  - L11 Julie at her limit asks Léa for D → `pending` (Léa has no limit).
  - L12 the CHECK: inserting `daily_limit` 0 and 21 raises 23514 with constraint name
    `fightbook_daily_limits_range` (compare the NAME, never just the code); 1 and 20 save; a second
    row for the same profile raises 23505.
  - L13 a profile hard-deleted takes its row with it (ON DELETE CASCADE).
  - Merge (a new `scripts/lib/merge-probe-fightbook-limit.mjs`: `merge-probe-fightbook.mjs` is 346
    lines and the complexity gate scans `.mjs`): survivor no row + merged 3 → survivor 3; survivor 5 +
    merged 3 → 3; survivor 3 + merged 5 → 3; neither → no row; the merged profile's row is left; a
    revert leaves the survivor's row as it is.
  - RLS probe: the table in `rls-probe-tables.mjs` with a seeded row: `anon` and `authenticated`
    read nothing and write nothing.
- [ ] **Step 2: Run them red** on a fresh replay (`replay.sh` with `KEEP=1`, then `pnpm
db:fightbook-probe`, `pnpm db:merge-probe`, `pnpm db:rls-probe`). Expected: every check that
      seeds or reads the table FAILS (it does not exist), L3 and L8-L11 included; only L1 passes. L8-L11
      guard the clause landing in the wrong place: Task 6 proves them by bending it there.
- [ ] **Step 3: Write 0271**: the table, RLS on, no policy, the CHECK (Decision 1); `fightbook_ask`
      = 0264's body with the status line widened (Decisions 2, 3; the block and the limit are each
      computed into a variable first, then the status decided, so a blocked ask does the same work as
      any other); `merge_fighters` = 0268's body with the one insert after the profile update
      (Decision 5); revokes and grants re-stated; it ends with `notify pgrst, 'reload schema'` as
      0264:247 and 0270:497 do. Raise the FightBook probe's declared check count
      (`db-fightbook-probe.mjs:45`). Header comment: what
      changes, "everything else word for word", rulings 741-744 and 747, Decision 4's accepted race.
- [ ] **Step 4: Run green**: fresh replay, then the FightBook, merge, race, rls and cascade probes;
      `pnpm db:review`. Diff 0271's two bodies against 0264/0268 (`diff` of the extracted function
      text) and show only the intended lines differ.
- [ ] **Step 5: Commit** `feat(fightbook): a daily limit stops new asks for a full day (0271)`.

### Task 2: The daily limit in settings (API, types, erasure)

**Interfaces:** Consumes the table (Task 1). Produces `FightBookSettings.dailyLimit: number |
null` (`@myclash/types`) and `PATCH me/fightbook/settings` body key `dailyLimit` (Task 4).

- [ ] **Step 1: Failing tests** in `fightbook-settings.service.test.ts` and the controller test:
  - `get` reads `fightbook_daily_limits` with select exactly `'daily_limit'` and
    `.eq('global_person_id', me)` (a seeded row of another profile with limit 7 must not be
    returned) and answers `dailyLimit: 3`; no row → `null`; no profile → `null` with no read; a read
    error throws (as the stars read does).
  - `set({ dailyLimit: 4 })` upserts `{ global_person_id: <caller>, daily_limit: 4 }` with
    `onConflict: 'global_person_id'` and writes nothing to `global_persons`; `{ dailyLimit: null }`
    deletes `.eq('global_person_id', <caller>)`; `{ enabled: true }` touches neither; the answer
    carries the saved limit; a failed limit write throws.
  - The schema (`settingsSchema`) refuses `0`, `21`, `2.5`, `"3"` (400, nothing written) and
    accepts `null`, `1`, `20`; `{ dailyLimit: 3 }` alone passes the refine; `{}` is still refused.
  - Erasure test: `eraseFightBookRows` deletes `fightbook_daily_limits` by `global_person_id`
    (`.select('id')` counted); the table joins the erased list (`erasure.service.test.ts:176-189`),
    the anonymisation-keeps list (`:300-313`) and `EMPTY_FIGHTBOOK_TABLES`
    (`erasure.aimed-rows.test.ts:35-47`). Export test: her own row is in the FightBook download, keyed on her
    profile.
- [ ] **Step 2: Run red** (`pnpm --filter api test -- fightbook-settings erasure fightbook.controller`).
- [ ] **Step 3: Implement** Decision 7 (`FightBookSettingsPatch.dailyLimit?: number | null`,
      `emptySettings` with `dailyLimit: null`; the `global_persons` update runs only when a switch key
      is set, and a limit-only save READS `fightbook_enabled, fightbook_show_stars` instead, because
      `set()` builds its answer from that row (`fightbook-settings.service.ts:48-73`) and a skipped
      update would answer `enabled: false`, which the panel takes as the truth
      (`FightBookSettingsPanel.tsx:32-34`); the limit is read back on every save) and Decision 6.
      Tests: a limit-only save answers `enabled: true` and the stored `showStars`; a switch-only save
      answers the stored limit. Regenerate the OpenAPI client (`quality:openapi-drift` green).
- [ ] **Step 4: Run green**, then typecheck the web apps (the type widens).
- [ ] **Step 5: Commit** `feat(fightbook): the settings route reads and saves the daily limit`.

### Task 3: The 10-minute reminder (API + worker)

**Interfaces:** Produces `scheduleSparReminders(d: SparReminderDeps, requestId: string, now?:
Date): Promise<void>` and `SPAR_REMINDER_LEAD_MINUTES = 10` in `spar-reminder.ts`, where
`SparReminderDeps = { db: Pick<SupabaseClient, 'from'>; notifications:
Pick<NotificationSchedulerService, 'scheduleReminder'>; logger: Pick<Logger, 'warn' | 'error'> }`;
the kind `'spar_starting'` in `ScheduledNotificationKind`; `sparStarting(): NoticeEmailText`.

- [ ] **Step 1: Failing tests** (`spar-reminder.test.ts`, the worker and alert tests):
  - Reads `spar_requests` with select exactly `'status, spar_day, spar_time, zone,
asker_global_person_id, receiver_global_person_id'` and `.eq('id', requestId)`; then
    `global_persons` `'id, claimed_by_user_id'` `.in('id', [asker, receiver])`.
  - Agreed, Event zone `Europe/Paris`, day 2026-11-14, `spar_time: '15:00:00'` (the shape PostgREST
    returns; a fixture written `'15:00'` would hide Decision 8's slice), now 2026-11-14T10:00Z → two
    `scheduleReminder` calls, one per account, each `{ kind: 'spar_starting', entityId: requestId,
startsAt: '2026-11-14T14:00:00.000Z', leadMinutes: 10, url: '/me/fightbook?tab=spars',
preference: 'fightbook' }`, title/body from `sparStarting()`, and **no `email` key**. Same in
    summer (2026-07-04 → `13:00:00.000Z`). Pass under `TZ=UTC` (pin luxon `Settings.defaultZone`
    in the test, prove it red with the pin removed).
  - Now = start − 10 min exactly, and now = start − 4 min → no call (ruling 745). Now = start − 11
    min → calls.
  - `spar_time` null → no call; status not `agreed` → no call; a profile no account holds → one
    call (the other fighter); a read error → no call, `logger.error` with the request id, and the
    promise resolves (never throws).
  - `SparRequestsService.answer` with `agreed` starts it (not awaited: a never-settling
    `scheduleReminder` does not delay the answer); with `not_this_time` it is never called.
    `OpenCallsService.pick` starts it with the new spar's id.
  - Worker: `scheduleReminder` puts `preference: 'fightbook'` into the queued job data
    (`toJobData`), and a `match_starting` job's data has no `preference` key at all; a delivery
    whose `fightbook` switch is false is skipped (`spar_starting` added to the table at
    `notification-switched-off.test.ts:116`); `spar_starting` added to the job-id list at
    `notification-job-id.test.ts:59`.
  - `WANTED.spar_starting`: true for an agreed spar whose asker or receiver profile the job's
    account holds; false when `cancelled`, `done`, or when neither profile is held by that account
    (select strings asserted, the owner filter on `claimed_by_user_id`). `CHECKS.spar_starting` is
    null.
  - i18n: `notices.sparStarting.title` / `.body` resolve in EN and FR.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement** Decisions 8-11. Copy: EN title `Spar soon`, body `Your spar starts in
10 minutes.`; FR title `Spar bientôt`, body `Votre spar commence dans 10 minutes.` (the number is
      fixed, so the copy holds it).
- [ ] **Step 4: Run green**; `pnpm quality:complexity` (the worker file stays at its baseline).
- [ ] **Step 5: Commit** `feat(fightbook): both fighters get a reminder 10 minutes before a spar`.

### Task 4: The daily limit in the settings panel (web-public)

**Interfaces:** Consumes `FightBookSettings.dailyLimit` and the `dailyLimit` patch key (Task 2).

- [ ] **Step 1: Failing tests** (`FightBookSettingsPanel` / `FightBookClient` tests): the panel
      shows a native `<select>` labelled `publicApp.fightBook.settings.dailyLimit` with "No limit" and
      1-20, the saved value selected; choosing 3 sends `PATCH /api/v1/me/fightbook/settings` with
      `{ dailyLimit: 3 }` (path written whole), "No limit" sends `{ dailyLimit: null }`; a failed save
      shows the panel's existing error and puts the old value back; the select is disabled while the
      save is in flight. The description text is shown.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement**: a `DailyLimitSetting` in the panel (the panel's `save` shape, styled as
      the select in `e/[eventSlug]/workshops/WorkshopsBrowser.tsx`, tokens only), shown only when
      FightBook is on, under the stars switch. Keys (EN / FR):
      `dailyLimit` "At most … spars a day" / "Au plus … spars par jour"; `dailyLimitNone` "No limit" /
      "Pas de limite"; `dailyLimitDescription` "When a day already has this many spars, new asks for it
      get 'Not this time'. Your own asks, QR scans and open calls are never stopped." / "Quand un jour
      compte déjà ce nombre de spars, les nouvelles demandes pour ce jour reçoivent « Pas cette fois ».
      Vos propres demandes, les scans QR et les appels ouverts ne sont jamais bloqués." (match the
      existing FR "Not this time" wording in the FightBook keys if it differs).
- [ ] **Step 4: Run green**; i18n sweep and lint.
- [ ] **Step 5: Commit** `feat(fightbook): the settings panel sets the daily limit`.

### Task 5: The docs

- [ ] §11septies header: rulings 741-747 and this plan. §11septies.2: "Four ways" becomes five (the
      daily limit, spec line 111), and "a blocked asker never meets already asked" holds for a
      limit-stopped ask too. §11septies.1: "Twelve tables" becomes thirteen
      with `fightbook_daily_limits`, and why it is not a profile column (policy 0187); §11septies.5:
      the download carries her own limit, erasure deletes it, a merge keeps the stricter. §11septies.3: the limit takes no lock (Decision 4).
      New **§11septies.10 Comfort**: Decisions 1-12 in plain words, ruling 747, the accepted race, what the limit
      never stops (742, 743), the reminder's re-check, phone only (746), the spec line made moot.
      §11ter.2: the `spar_starting` row (preference `fightbook`, push only, re-checked when it fires).
- [ ] Commit `docs(fightbook): the daily limit and the spar reminder`.

### Task 6: Falsify, gates, review, push

- [ ] SQL falsifier on a `KEEP=1` replay (copy `falsify-fb5-sql.mjs`'s shape): bend each clause of
      the new status line (drop `done`, drop the asker side, `>` for `>=`, drop the `spar_day` filter,
      count `cancelled`, count the ASKER's limit instead of the receiver's), the CHECK bounds, and the
      merge `least` (→ the survivor's value); and copy the clause into `fightbook_answer`,
      `fightbook_call_pick` and `fightbook_qr_log` one at a time (L8, L10, L9 must go red); each probe
      red. The falsifiers and `gates.sh` are untracked scratchpad scripts (session 975bf8e5's
      scratchpad, `fightbook-prompt.md` §3): copy them, never commit them.
- [ ] Code falsifier (`falsify-fb5.mjs`'s shape): the select strings, the owner filters, the lead
      minutes, the late-skip comparison, the `preference` in `toJobData`, the missing `email`, the
      WANTED account check, the schema bounds, the web patch body; each test red.
- [ ] 32 gates (`gates.sh`), fresh replay with every probe, cold whole-slice review
      (`code-architecture-reviewer`, Opus), one fold wave + scoped re-review, gates again, local
      gitleaks, push, CI, memory note + handoff.
