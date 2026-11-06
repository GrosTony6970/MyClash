# Event photos — the 4c comment gap: Keep never clears a comment the screen did not show — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the operator builds native) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A report whose comment changes after a moderator's screen was read survives that screen's Keep, and the photo stays in Reported with the new comment (rulings 457, 460, 466).

**Architecture:**

- Migration 0255 gives `event_photo_reports` a second time, `updated_at`: the report's time at insert, moved to `now()` by the database whenever the comment changes. The existing generic trigger function `touch_updated_at()` (0181) stamps it, under a `WHEN (NEW.comment IS DISTINCT FROM OLD.comment)` clause, so a repeat with the same words or with none changes nothing.
- The API's moderation queue reads `updated_at` instead of `created_at` for the reports: the comments' order, `lastReportAt` and Keep's bound (`.lte('updated_at', reportsUpTo)`) all use it. `created_at` keeps its meaning (first report) and its one reader, the phone's hourly limit.
- No screen changes: both moderator screens already send `lastReportAt` back as `reportsUpTo` unchanged (`apps/web-admin/app/org/[slug]/events/[eventId]/photos/usePhotoModeration.ts:209`, `apps/web-staff/src/lib/usePhotoQueue.ts:176`). The API's response shape does not change; no OpenAPI change.

**Tech Stack:** Postgres 17 migration, NestJS 11 + supabase-js / PostgREST v14.16, vitest (node), the cascade probe (`scripts/db-cascade-probe.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-03-event-photos-design.md`, "Moderation", the `[rev 452, 454-457, slice 4c]` bullet and its "Known gap". Shape: `2026-11-05-event-photos-slice4c-reported-and-keep.md` (Keep's bound, assumption 9), `2026-11-05-event-photos-slice4b-public-page.md` (migration 0253, ruling 453).

**Scripts** (copy into this session's scratchpad, read first): `…\fc383466-7375-4762-b52f-d9fbcb891db6\scratchpad\` — `gates.sh <ABSOLUTE outdir>`, `watch-ci.sh`, `baseline-audit.mjs`; `…\8d545bef-dcbb-4949-b2ae-b341c601eb20\scratchpad\` — `replay.sh` (change its port and container name: `myclash-replay-photos6a` holds 55472), `falsify-6a.mjs` (the model for API + db rows); `…\a954b49a-a843-4d0f-92d5-8e55c6ec4e72\scratchpad\` — `live-4c.cjs` + `seed-4c.sql` (the live PostgREST read of Reported and Keep: the model for this slice's live check), `boot-4c.sh` + `boot-4c-calls.cjs`.

## In plain words

Today: Tom reports a photo at 13:00 with no comment. At 14:00 the volunteer opens Reported and sees one report. At 14:40 Tom reports again and writes "this is my child, please remove". His phone already reported this photo, so the report stays one report and its comment changes, but the report still says 13:00. At 15:30 the volunteer, whose screen still shows 14:00's list, taps Keep. Keep clears every report up to the newest time the screen showed (13:00), so Tom's report goes, with a comment nobody ever read. The photo leaves Reported.

After this slice: the report keeps two times, when it was first made (13:00) and when it last changed (14:40). Keep clears only reports that have not changed since the screen showed them. At 15:30 Tom's report stays, the photo stays in Reported, and the next time the list loads the volunteer sees "this is my child, please remove" at the top of its comments. If Tom sends the same words again, or reports again with no comment, nothing changes and Keep clears it as today.

Nothing changes on screen and nothing changes for spectators. A phone's limit of 30 reports an hour still counts first reports, as today.

## Operator rulings for this slice

- **466** (2026-11-06 ~09:45, this session) Story: Tom reports at 13:00 with no comment; the volunteer opens Reported at 14:00; at 14:40 Tom reports again with "this is my child, please remove"; at 15:30 the volunteer taps Keep on the old screen. Ruling: **a second clock: the report keeps its first time and gains "changed at"; Keep and the comments' order use the second; the phone's 30-an-hour limit still counts first times only.** (Offered and not chosen: moving the one time, which renames nothing but makes `created_at` lie and counts an edit against the hourly limit.)

## Assumptions (mine; the operator reads them before the build)

1. **"Changed" means the comment's words changed**, compared exactly (`IS DISTINCT FROM`). Same words → no change. A Report with no comment never reaches an UPDATE (the API sends `ignoreDuplicates`, 453), so it changes nothing.
2. **The database stamps the time**, never the API: one clock for both times and for Keep's bound, which comes back from the database verbatim. `now()` is the edit's transaction start. The Report's upsert payloads are pinned exactly (`photo-public.service.report.test.ts:75-95`), so a time sent by the API reds them.
3. **No backfill.** `ADD COLUMN … NOT NULL DEFAULT now()` gives a report that exists at migration time the migration's time, later than its first time. Its effects: a screen loaded before the migration keeps that report on Keep (the safe side), and those reports' comments tie in the sort (Postgres stores one `now()` for every existing row). Photos are Off on every Event today, so there should be none.
4. **The column is named `updated_at`**, so the existing `touch_updated_at()` (0181) is reused rather than a second copy written. Only one column of a report can change (the comment), so "updated" and "comment changed" are the same moment.
5. **An edited comment moves to the top** of the photo's comments (newest first by `updated_at`), as a new report would.
6. **The queue's report embed drops `created_at`**: nothing reads it there once the sort and `lastReportAt` move to `updated_at`.
7. **Named, not fixed (same as 457's own window):** an edit stamped at its transaction's start but committed just after a queue read, while a newer-stamped report was already visible, can be cleared by that screen's Keep. The window is the length of one write (milliseconds).

## Global Constraints

- Migration file `packages/db/migrations/0255_event_photo_report_changed_at.sql` (re-check `ls packages/db/migrations | tail -1` right before creating it: the last is `0254_event_photo_account.sql`). Idempotent (`ADD COLUMN IF NOT EXISTS`, `DROP TRIGGER IF EXISTS` then `CREATE TRIGGER`), ends with `NOTIFY pgrst, 'reload schema';`.
- Selects are whole literals, one per branch (the schema-conformance sweep skips a built one).
- `@myclash/types` is read from `dist`: `pnpm --filter @myclash/types build` after editing its docstring (no shape change, but the build must stay green).
- Functions < 50 lines, files < 400 lines; nothing touched is in `docs/code-quality-complexity-baseline.json` today (`keep` 21 lines, `photoOf` 19, `queueRead` 12; `photo-moderation.service.ts` 277 lines) — confirm with `baseline-audit.mjs` after the edit.
- One commit, Conventional Commits, header ≤ 100 characters, lower-case subject, e.g. `fix(photos): keep never clears a report comment changed after the screen was read`.

## Review Focus

1. **A repeat with the same words** after the screen was read: Keep clears it (nothing new to see). Task 1 probe "the same comment again leaves the time".
2. **A repeat with no comment**: the time stays, the old comment stays (453). It never reaches an UPDATE: the API's `ignoreDuplicates` upsert is pinned (`photo-public.service.report.test.ts:68-80`), and Task 3's live check 3 proves PostgREST answers it with no change.
3. **The phone's hourly limit must not move to the new time** (466): already pinned by "lets a phone report 30 photos … refuses the 31st" (`photo-public.service.report.test.ts:~105`): its rows carry only `created_at`, and the seeded double drops a row whose filtered column is missing, so a count on `updated_at` lets the 31st through and reds it. Task 3's falsifier proves it.
4. **A new report from another phone after the screen was read** still stays (457): its `updated_at` equals its `created_at`. Task 1 probe "a new report's two times are equal" + Task 2's rewritten 457 test.
5. **PostgREST's upsert must fire the trigger** (the seeded double ignores upsert options and runs no trigger). Task 3's live read through `@supabase/postgrest-js` with the API's exact upsert calls.

---

### Task 1: Migration 0255 — the report's second time

**Files:**

- Create: `packages/db/migrations/0255_event_photo_report_changed_at.sql`
- Modify: `packages/db/test/event-photos.test.ts` (the `Event photo tombstones` describe, after the 0253 comment test at `:119-123`)
- Modify: `scripts/lib/photo-tombstone-probe.mjs` (new `reportChangedAt` called after `reportComments` at `:88`; the file is 192 lines)
- Modify: `scripts/db-cascade-probe.mjs:75` (`EXPECTED_CHECKS = 74` → `77`)

**Interfaces:**

- Produces: column `public.event_photo_reports.updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`; trigger `event_photo_reports_touch_updated_at` `BEFORE UPDATE … FOR EACH ROW WHEN (NEW.comment IS DISTINCT FROM OLD.comment) EXECUTE FUNCTION public.touch_updated_at()`.

- [ ] **Step 1: Write the failing SQL-text test** in `packages/db/test/event-photos.test.ts`, with the file's own helpers (`sql = flat(allSql())`, comments stripped; `triggerStatement` from `./migration-sql`):

```ts
it('gives a report the time its comment last changed, stamped by the database (ruling 466)', () => {
  expect(sql).toContain(
    'alter table public.event_photo_reports add column if not exists updated_at timestamptz not null default now()',
  );
  expect(triggerStatement(allSql(), 'event_photo_reports_touch_updated_at')).toBe(
    'create trigger event_photo_reports_touch_updated_at before update on public.event_photo_reports for each row when (new.comment is distinct from old.comment) execute function public.touch_updated_at();',
  );
});
```

- [ ] **Step 2: Run it, expect FAIL** (file missing): `pnpm --filter @myclash/db test -- event-photos`.

- [ ] **Step 3: Write `0255_event_photo_report_changed_at.sql`.** Header in the 0252/0253 style: the gap story (457, 460), ruling 466, why the database stamps it (assumption 2), why no backfill (assumption 3), why `touch_updated_at()` is reused (assumption 4), that `created_at` stays the first time and the hourly limit's column. Body: `ALTER TABLE … ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();`, a `COMMENT ON COLUMN`, the drop-then-create trigger above, `NOTIFY pgrst, 'reload schema';`. No new index: Keep filters on `photo_id` first, which leads the primary key.

- [ ] **Step 4: Run the test, expect PASS.** Then `pnpm db:review` green.

- [ ] **Step 5: Write the probe checks** in `photo-tombstone-probe.mjs`, `reportChangedAt({ tryAndRollBack, check })`, each in its own rolled-back transaction. **Compare the times in SQL, never in JS**: postgres.js parses `timestamptz` into a millisecond `Date`, which hides a microsecond difference. The `after(tx)` read is `SELECT updated_at > created_at AS moved, updated_at = created_at AS same, created_at::text AS first FROM event_photo_reports WHERE device_id = …`; "`created_at` unchanged" compares `first` with `created_at::text` read inside the same `statement(tx)` before the write (text keeps the microseconds) (the seed's row, committed by an earlier transaction, so its times are older than the probe's `now()`):
  - "a changed comment moves the report's time past its first time": the 0253 upsert (`ON CONFLICT … DO UPDATE SET comment = EXCLUDED.comment`) with `'this is my child'` → `updated_at > created_at`, `created_at` unchanged.
  - "the same comment again leaves the time": in one transaction, i.e. one async `statement(tx)` callback of `tryAndRollBack` (`scripts/db-cascade-probe.mjs:188-201`), whose statements all share one `now()`, so the time is first set back by hand: `UPDATE … SET comment = 'a'` (fires), `UPDATE … SET updated_at = created_at` (the comment is unchanged, so it does not fire and the value sticks), then the 0253 upsert with `'a'` again → `updated_at = created_at`.
  - "a new report's two times are equal": `INSERT` a second device (`ca5c0000-0000-4000-8000-000000000b04`) → its `updated_at = created_at` (reds on a default from another clock, e.g. `clock_timestamp()`).

  No check for a repeat with no comment: `ON CONFLICT DO NOTHING` runs no UPDATE, so no trigger can fire and no break of this slice could red it (Review Focus 2 says where it is held). The probe holds **77** checks after this (74 + 3).

- [ ] **Step 6: Replay and probe.** `KEEP=1` `replay.sh` copied with its port and container renamed (e.g. 55473, `myclash-replay-gap`): all migrations on PG17, `pnpm db:migrations:replay`, the cascade probe (77/77), the RLS probe, and a schema read: `\d event_photo_reports` shows `updated_at … not null default now()` and the trigger with its `WHEN`. Leave the container up for Task 3.

### Task 2: The queue reads the second time; Keep bounds on it

**Files:**

- Modify: `apps/api/src/modules/photos/photo-moderation.service.ts` (`QueueRow.reports` `:43`, `keep` `:161-187`, `queueRead` `:207-218`, `photoOf` `:225-243`)
- Modify: `apps/api/src/modules/photos/photo-public.service.ts:134-135` (the comment only: "neither time is sent: the database stamps `updated_at` when the comment changes, 0255")
- Modify: `apps/api/src/modules/photos/photo-queue.dto.ts:17-19` (the Keep body's docstring: "the newest report change the screen showed … Keep clears the reports not changed since (rulings 457, 466)"; `:5-8` stays: the page cursor is the photo's `created_at`)
- Modify: `packages/types/src/event-photos.ts:131` (`lastReportAt` docstring: "the newest report's last change — its time, or when its comment changed — as the database wrote it, or null with none: Keep's bound (457, 466)")
- Test: `photo-moderation.reported.test.ts`, `photo-moderation.reads.test.ts:21`, `photo-moderation.writes.test.ts:136-144`, `photos-staff.controller.test.ts:126` (the staff route's Keep bound). `testing/moderation-doubles.ts` needs nothing (`photoRow` defaults `reports: []`; the timed report rows are inline in `reported.test.ts`), nor do `reported.test.ts:74,88` (read by the summary count only).

**Interfaces:**

- Consumes: Task 1's `updated_at`.
- Produces: the embed `reports:event_photo_reports!inner(comment, updated_at)` (Reported) and `reports:event_photo_reports(comment, updated_at)` (the others); `QueueRow.reports: { comment: string | null; updated_at: string }[]`; `ModerationPhoto` unchanged in shape.

- [ ] **Step 1: Rewrite the failing tests.**
  - `reported.test.ts:27` and `:41`, `reads.test.ts:21`: the expected selects end `(comment, updated_at)`.
  - `reported.test.ts:46` renamed "gives the count, the comments by their last change newest first without empty ones, and the newest change": rows `{ comment: 'old', created_at: T3, updated_at: T1 }`, `{ comment: null, created_at: T1, updated_at: T3 }`, `{ comment: 'edited', created_at: T2, updated_at: T2 }` → `reportComments: ['edited', 'old']`, `lastReportAt: T3`. Every row carries both times in a different order (a test-only shape: a real `updated_at` is never before its `created_at`), so a sort on `created_at` gives `['old', 'edited']` and a `lastReportAt` read from the first row's `created_at` gives `T1`: both red.
  - `writes.test.ts:136` "clears the reports up to the newest change shown, and no later one (rulings 457, 466)" and `photos-staff.controller.test.ts:126`: the `lte` filter's args are `['updated_at', SHOWN]`.

- [ ] **Step 2: Run, expect the selects, sort and both `lte` tests FAIL: `pnpm --filter @myclash/api exec vitest run photo-moderation photo-public`.

- [ ] **Step 3: Implement.** In `photo-moderation.service.ts`: both literal selects end `(comment, updated_at)`; `QueueRow.reports` as above; `photoOf` sorts and takes `lastReportAt` from `updated_at` (same code-unit compare); `keep` filters `.lte('updated_at', reportsUpTo)`; `keep`'s docstring: "a report made or changed after it stays (457, 466)". The three comment-only edits above. `pnpm --filter @myclash/types build`.

- [ ] **Step 4: Run, expect PASS**, then the whole API photos folder and `typecheck`: `pnpm --filter @myclash/api exec vitest run photos` and `pnpm --filter @myclash/api typecheck`.

### Task 3: Proof, design text, review, commit

**Files:**

- Modify: `docs/superpowers/specs/2026-11-03-event-photos-design.md:292-299` (the "Known gap" sentences become: "`[rev 466]` A report keeps its first time and the time it last changed; Keep clears only the reports not changed since the screen showed them, so a comment changed after the screen was read stays, and so does the photo in Reported. The phone's hourly limit counts first times.")
- Scratchpad only: `live-gap.cjs` + `seed-gap.sql` (copied from `live-4c.cjs` / `seed-4c.sql`), `falsify-gap.mjs` (copied from `falsify-6a.mjs`)

- [ ] **Step 1: Live PostgREST v14.16 over Task 1's replay** (port 3473), through `@supabase/postgrest-js` with the API's exact calls, ≥ 6 checks:
  1. the comment upsert (`onConflict: 'photo_id,device_id'`) on an existing report moves `updated_at` past `created_at`;
  2. the same upsert with the same words leaves `updated_at`;
  3. the no-comment upsert (`ignoreDuplicates: true`) leaves `updated_at` and the comment;
  4. the Reported select (Task 2's literal) answers each report with `comment` and `updated_at`, in the `+00:00` microsecond form `PhotoKeepBodyDto` takes;
  5. Keep's delete `.eq('photo_id').lte('updated_at', <the time read before the edit>)` leaves the edited report and clears an unchanged one;
  6. the phone's hourly head count `gte('created_at', …)` is unchanged by an edit.
- [ ] **Step 2: Falsify** (`falsify-gap.mjs`, ≥ 10 rows, each RED): drop the trigger's `WHEN` (probe "same comment"), drop the trigger (probe "changed comment" + db text test), `DEFAULT now()` removed (replay/probe), the Reported select back to `created_at`, the other select back, the sort on `created_at`, `lastReportAt` from `created_at`, Keep's `lte` on `created_at` (reds the service and the staff-route test), the hourly count on `updated_at` (reds "refuses the 31st"), `EXPECTED_CHECKS` left at 74. A GREEN is a hole: add the test or remove the code.
- [ ] **Step 3: Gates.** Stop every container this session started except the replay, then `gates.sh <ABSOLUTE outdir>` with `run_in_background`; `grep -v '^0 '` the summary is empty (33/33). Boot the API image (`boot-4c.sh`): both Keep routes with a good body → 401 signed out, a bad body → 400.
- [ ] **Step 4: Cold review** (`code-architecture-reviewer`, opus) of the staged diff; fold or name each finding.
- [ ] **Step 5: Commit and push.** `git fetch`, `git log --oneline -1`, `git status --short`; stage the explicit list (migration, db test, `scripts/lib/photo-tombstone-probe.mjs`, `scripts/db-cascade-probe.mjs`, the moderation service, the public service comment, the DTO comment, types, `photo-moderation.reported.test.ts`, `photo-moderation.reads.test.ts`, `photo-moderation.writes.test.ts`, `photos-staff.controller.test.ts`, the design, this plan); `git diff --cached --stat`; `git commit -F <file>`; push; `watch-ci.sh <full sha>` to 17/17. Remove the replay and PostgREST containers this session started.

## As built (2026-11-06, session 19dbabfe)

- Built as planned; no step deviated. Reviews: myclash-plan-review converged in 3 passes (4 MINOR, 1 NIT folded); cold plan-reviewer (opus) 1 MAJOR (the staff route's Keep test missing from the file and staging lists), 4 MINOR, 4 NIT, all folded (probe times compared in SQL; the "no comment" probe check dropped as one that could never go red; the hourly-limit test already existed).
- Proof: db text test RED → GREEN; API 7 tests RED → GREEN, photos 358/358; replay of 244 migrations, RLS, merge and cascade probes (77/77) green; schema read shows the column and the trigger with its `WHEN`; **live PostgREST v14.16, 7/7** (Tom's story end to end); **14 seeded breaks, all RED**, each replay row failing at the probe check it targets; gates 33/33.
- Cold code review (opus): 0 Critical, 0 Important. Minor 1 fixed (`ModerationPhoto.reportComments`'s docstring said "newest report first"). Named, not fixed:
  - test titles still say "the newest report shown" (`photo-moderation.writes.test.ts:115`, `photos-staff.controller.test.ts:18`, `photos.controller.test.ts:20`, `:350`); the value is now the newest change;
  - `photo-moderation.reported.test.ts:76,90` seed report rows with `created_at` only: read by the summary count, which reads no time;
  - **a phone can keep a photo in Reported by changing its comment between each read and Keep**, at no cost to its hourly limit (466 keeps edits out of it). The same loop already existed through a new report after Keep (448), at one of its 30 an hour; a new device cookie is a new phone anyway.
