# FightBook slice 3 (After the spar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** After an agreed spar, either fighter marks "We sparred" (and either may undo it for a
while); then each may send the partner one thank-you (stars, signed or anonymous) and keep a
private note; a fighter's public page says "Sparred N times" and, if they allow it, their star
average; any FightBook user can be given a private heart and listed under Favourites.

**Architecture:** Migration 0267 adds the `done` status, the star switch, three deny-all tables
(signed thank-yous, anonymous reviews, favourites) and two SQL calls: `fightbook_review` stores a
review, `fightbook_star_line` reads a fighter's live average. Migration 0268 makes a fighter merge
carry the new rows. The API gains `me/fightbook` routes for mark, undo, review, note, thank-yous
and favourites; the public fighter read gains one line. The web adds the after-the-spar actions to
My spars, a Thank-yous list, a Favourites tab, a heart, the public line and the star switch.

**Tech Stack:** Postgres 17 (plpgsql), NestJS + Zod DTOs, Next 16 / React 19, `@myclash/ui`,
`@myclash/i18n`, Vitest, the replay probes (`scripts/`).

**Spec:** `docs/superpowers/specs/2026-11-10-fightbook-design.md` ("After the spar", rulings
642-661), `docs/ARCHITECTURE.md` §11septies, the slice 1 and 2 plans in this folder. Rulings taken
for this plan (2026-11-12, recorded in `C:\Users\Tony\.claude\plans\fightbook-handoff.md`):

- **677** (slice 1 review Minor 12) an agreed spar may be cancelled only until its day ends
  (`expires_at`).
- **678** undo closes on time, THEN reviews open: a refused undo only ever means "too late".
- **679** a heart can go on anyone on FightBook (Find cards, profiles, spar cards).
- **680** only "partner marked We sparred" buzzes; a thank-you never does.
- **681** "We sparred" and undo both work from the spar day's start until **48 h after the day
  ends** (`expires_at` + 48 h). Reviews open when that closes.
- **682** stars on the public page are hidden until the fighter switches them on.
- **683** a thank-you is final once sent; only the private note can be edited later.
- **684** signed thank-yous show on the spar card AND in a "Thank-yous" list of all ever received.
- **688** the average moves after **each** review (overturns the design's "refresh after 3 new").
  Accepted: the subject can work out an anonymous review's stars from the change, and often its
  writer; "anonymous" hides the text and the name on the card, nothing more.
- **689** stars show from the **first** review (overturns ruling 647's "from 5"), still only when
  the fighter switched them on (682).
- **690** a signed thank-you shows the partner its stars (overturns 685; 686 and 687 are moot).

## In plain words

**"We sparred".** Marc and Julie agreed a spar for Saturday at an Event. From Saturday morning,
either can tap "We sparred". Julie's phone buzzes once: "A spar was marked as done". Either of
them can undo it until Tuesday 06:00 (48 hours after Saturday's day ends at Sunday 06:00). After
that it is fixed. A spar nobody marks counts nowhere.

**Cancel ends with the day.** Cancel works until Saturday's day ends (Sunday 06:00). Nobody gets a
"Spar cancelled" buzz about a spar from three weeks ago.

**Thank-yous open when undo closes.** From Tuesday 06:00, each of them may send the other one
thank-you: 1 to 5 stars and an optional text, signed or anonymous. It is final. A signed one Julie
sees on the spar card and in her "Thank-yous" list: who, which spar, the stars, the text. An
anonymous one has no text and never shows on a card or in a list; its stars go into her average.
Each may also keep a private note on the spar that only they read, and change it any time.

**The public line.** Julie's public page says "Sparred 12 times" while FightBook is on. A spar
counts once its undo has closed. If Julie switches her stars on, the page also shows her average
("★ 4.3 (7)") from the first review, and it changes after each review. Julie sees her own average
in her settings, switch or not.

**What "anonymous" still hides, and what it does not.** Because the average moves after each
review, Julie can work out the stars of an anonymous review, and when she sparred only one person
that week, who sent it. You accepted this (ruling 688). The writer's name never appears anywhere
she can read, including her data download.

**Favourites.** A heart on any FightBook user's card, profile or spar card. Nobody is told. The
Favourites tab lists them, with "Ask to spar".

## Global Constraints

- One migration per concern: 0267 tables, 0268 merge (max + 1 at commit time; renumber if another
  session lands one first). Pushed migrations are never edited: 0263-0266 stay as they are.
- New tables: RLS on, no policy (deny-all, 0247 pattern); `id uuid` PK; every person column
  `REFERENCES global_persons(id) ON DELETE CASCADE`; every CHECK a `CASE … ELSE false END`. Each
  joins `SUBJECT_EXPORT_TABLES`, `ARCHIVE_EXCLUDED_TABLES`, `eraseFightBookRows`,
  `scripts/lib/rls-probe-tables.mjs` + `packages/db/fixtures/rls-probe-seed.sql`, and
  `merge_fighters` + revert.
- Every user-facing string in `en` and `fr` (`packages/i18n/src/messages/{en,fr}/publicApp.ts`;
  notice wording in the `notices` i18n keys read by `bilingual()` in `notice-texts.ts`, no names).
- Every route acts on the caller's own profile (`fightBookCaller`): mark, undo, review, note,
  thank-yous and cancel use `requireProfile` (ruling 666: an off fighter still finishes their
  spars); favourites use `requireFightBookOn`. A stranger's spar id answers 404, never 403.
- Every new write route is filed in `apps/api/src/common/testing/archived-lock-ledger.ts` and
  classified in the route-authz ledger; OpenAPI client regenerated in each API commit that adds or
  reshapes a route (`quality:openapi-drift`).
- Every new DB read asserts its select string AND its owner filter, with a fixture row the filter
  must exclude. Every paged or capped read says what bounds the write side.
- **An anonymous review never names its writer to its subject**: not in a payload, not on a card
  or list, not in the subject's data download.
- Files ≤ 400 lines, functions ≤ 50, test files included (`quality:complexity` after prettier).
  `fighters.service.ts` and `app/fighters/[slug]/page.tsx` are baselined: touch them by one call
  each, re-point the baseline, audit with `baseline-audit.mjs`.
- Tokenized UI only; no raw ids in UI; no real names in fixtures.
- Commit subjects start lower-case ("the FightBook …"). Messages via a file and `git commit -F`;
  `git fetch` + `git log --oneline -1` + `git status --short` before staging; explicit paths.

## Decisions taken in this plan (the builder's calls the design and rulings left open)

1. **`done` is a status** of `spar_requests` (no new column): `agreed` → `done` → (undo) `agreed`.
   No "marked by", no "marked at": the window is fixed from `expires_at`, and the data download
   carries whole rows. CHECK: `done` has `agreed_at` set and no cancel or comment fields.
2. **The windows**, all from the row: `markFrom` = 00:00 of `spar_day` in the row's `zone`
   (`dayStartUtcIso(spar_day, zone, 0)`); `cancelUntil` = `expires_at`; `markUntil` = 48 h after
   `expires_at`. Mark: status `agreed`, `markFrom` ≤ now < `markUntil`. Undo: status `done`, now
   before `markUntil`. Cancel: status `agreed`, now before `cancelUntil`. Review: status `done`,
   now at or after `markUntil`, no end. Either fighter may mark and undo (the marker may fix a
   mis-tap). Each is one conditional update (`eq status`, `gt/lte expires_at`); mark's `markFrom`
   is checked in the API on the row's immutable `spar_day`/`zone` before the update. Any lost
   race or closed window: 409 `not_open` (one wording). **One clock:** every window is judged on
   the API's `now` (the slice 1 pattern, `spar-requests.service.ts:152`); `fightbook_review` takes
   it as `p_now`. Routes sit beside slice 1's cancel: `requests/:id/done | undo | review | note`.
3. **Tables** (0267):
   - `spar_thanks` — a signed thank-you: `id`, `spar_request_id` FK cascade,
     `author_global_person_id`, `subject_global_person_id`, `stars smallint` 1-5, `body text`
     null or 1-500, `created_at`; unique (request, author); index (subject, `created_at`); CHECK
     author ≠ subject.
   - `spar_anonymous_reviews` — an anonymous review: the same columns without `body`. Its own
     table so the subject's data download can leave it out whole (the export reaches tables by
     column, `subject-export.reach.ts`, and a row about the subject names its writer).
   - `fightbook_favourites` — `id`, `owner_global_person_id`, `favourite_global_person_id`,
     `created_at`; unique pair; CHECK owner ≠ favourite; index on favourite.
   - `global_persons.fightbook_show_stars boolean not null default false` (682). Readable like
     `fightbook_enabled` (0187): only the switch, never the number.
4. **`fightbook_review(p_request, p_author, p_stars, p_body, p_anonymous, p_now) returns void`**,
   one transaction, in this order: read the request plainly to learn its two profiles (none →
   `not_open`); KEY SHARE on both profiles in id order (the 0264 order; a merge takes `FOR UPDATE`
   on the profiles first, `0265:61-63`, so the two never deadlock); the request row `FOR UPDATE`
   (an undo then waits), re-checking both profile columns; the author is its asker or receiver,
   status `done`, `expires_at + 48h <= p_now`, the author live (the `applyReachable` shape), and no
   row of the author on this request in EITHER review table, else `not_open`; insert into
   `spar_anonymous_reviews` (`p_body` ignored) or `spar_thanks` (`nullif(btrim(p_body), '')`), with
   `created_at = p_now`. A unique violation also answers `not_open`. Service role only. **Accepted
   residual:** an undo sent a few milliseconds before `markUntil` that reaches the row after a
   review locked it re-checks its own `now` and lands: the spar returns to `agreed` with a review
   on it (its stars count, the spar does not).
5. **`fightbook_star_line(p_subject) returns jsonb`** `{ average, count }`: `round(avg(stars), 1)`
   and `count(*)` over both review tables where `subject = p_subject`; `average` null when the count
   is 0. STABLE, `search_path` pinned, service role only. PostgREST aggregates are off in this repo
   and a row read would stop at the 1000-row page, so the average is one SQL call.
6. **The public line** (`PublicSparLine = { sparred: number; stars: { average: number; count:
number } | null }`) is the only FightBook data in the public projection: `null` unless the
   fighter has FightBook on. `sparred` = spars with status `done` and `expires_at <= now − 48h`,
   either side (a count read, `head: true`). `stars` only when `fightbook_show_stars` and count ≥ 1
   (689). A line with `sparred = 0` and no stars renders nothing.
7. **Own view** in `GET me/fightbook/settings`: `showStars`, `sparred` (same count) and `stars`
   (the star line when count ≥ 1, whatever the switch). `PATCH` accepts `showStars`.
8. **A spar card** (`AgreedSpar`) gains `status: 'done'`, `markFrom`, `markUntil`, `cancelUntil`
   (ISO; the web compares with its clock, the API enforces), `myReview: { stars; text; anonymous }
| null`, `theirThanks: { stars: number; text: string | null } | null` (the partner's SIGNED
   thank-you only), `note: string | null`, `partnerFavourite: boolean | null` (null = no heart:
   the caller has FightBook off, or the partner is not in `askableFighters`). Four batch reads by
   request ids (`inListChunks`), each filtered on the caller: `spar_thanks` author = me,
   `spar_anonymous_reviews` author = me, `spar_thanks` subject = me, `spar_private_notes` author =
   me. The spar reads' shared select (`SparRow`, `SPAR_SELECT` in `spar-reads.service.test.ts:11`)
   gains `zone`. A Yes builds its card locally (`agreedFrom`, `fightbook-patches.ts:14-39`):
   `IncomingSparRequest` gains the same three windows, the extras start empty (`null`), and the
   Inbox calls `refresh()` after a Yes so the heart arrives. `mySpars` takes `caller.enabled` from
   the route (`fightbook.controller.ts:204-207`).
9. **Thank-yous list** (684): `GET me/fightbook/thanks?page=` → `{ items: ThankYou[]; more }`, 20
   per page, newest first (`created_at` desc, then `id`), `spar_thanks` where subject = me, with
   the author's `SparFighter` and the spar's when/where. Bounded by one thank-you per author per
   spar. Block hides nothing here: a thank-you is about a spar both agreed.
10. **Favourites** (679): `PUT` / `DELETE me/fightbook/favourites/:globalPersonId` (204,
    idempotent). PUT refuses 404 unless the fighter is in `fightBookOnFighters([id])` and is not
    the caller; refuses 409 `favourites_full` at 200 (count read, then insert; a race may land
    201, accepted). `GET me/fightbook/favourites` → `FindCard[]`: the caller's favourites through
    `askableFighters` (FightBook on, live, not me, not blocked by me; a favourite who blocked me
    stays, ruling 672), by name; the favourites service injects `SparFindService` and calls
    `withWeapons` (`spar-find.service.ts:228`, made public) as the one card builder. `FindCard` and
    the `askable` answer gain `favourite: boolean`. The after-the-spar and favourites routes live in
    a second controller (`fightbook-after.controller.ts`): `fightbook.controller.ts` is at 289
    lines.
11. **Notice** `spar_marked_done` (680) to the other fighter, `preference: 'fightbook'`, URL
    `/me/fightbook?tab=spars`, started not awaited; `CHECKS` and `WANTED` entries `null` like the
    other three. Undo sends nothing. `sendImmediate` dedupes per (kind, spar, account) for 24 h
    (`notification-scheduler.worker.ts:273-284`), so a mark/undo ping-pong buzzes once a day. The
    FightBook notice switch's description (`publicApp.ts` ~l.892, en + fr) names the new buzz.
12. **Export:** `spar_thanks` reaches author AND subject (the subject sees the same stars and text
    in the app); `spar_anonymous_reviews` reaches its **author only** (the design's rule: a row
    about the subject names its writer, Art. 15(4)); `fightbook_favourites` the owner only (as
    blocks). Each with a written `note`.
13. **Web placement:** the after-the-spar block goes under each spar card in My spars; the
    Thank-yous list at the foot of My spars (read when the tab opens); Favourites is the fourth tab
    (`?tab=favourites`, design order: Inbox, My spars, Favourites, Find); the heart
    (`FavouriteHeart`) sits on Find cards, spar cards, Favourites cards and the profile beside
    "Ask to spar"; the public line under the profile name; the star switch and own line in the
    settings panel.

## Review Focus

1. **A spar in another time zone** — a free-date spar in `America/Montreal` asked from Paris:
   "We sparred" opens at Montreal's midnight, not Paris's. Test in Task 4.
2. **Marc taps "We sparred" while Julie taps Cancel** on the spar day — one wins, the other gets
   `not_open`; never a cancelled spar that is also done. Test in Task 4 (conditional updates) and
   the probe (Task 2: the CHECK refuses `done` with a cancel field).
3. **Marc switches his stars on with no review yet** — the public page shows "Sparred N times"
   only, never "★ 0.0 (0)"; with FightBook off, nothing at all. Test in Task 7.
4. **Julie reads her spar card and her data download after Léa's anonymous review** — no card, list
   or download row names Léa or carries her review. Tests in Tasks 1 and 5.
5. **A thank-you form left open across Tuesday 06:00 on a slow phone** — the API refuses or
   accepts on its own clock; the page shows the refusal sentence, never a crash. Test in Task 8.

---

## File map

**DB** — `packages/db/migrations/0267_fightbook_after_the_spar.sql`,
`0268_fighter_merge_moves_fightbook_reviews.sql`; `scripts/lib/fightbook-probe-scenarios.mjs` (+ a
new `fightbook-probe-reviews.mjs` if it passes 400 lines), `scripts/db-fightbook-probe.mjs`,
`scripts/lib/merge-probe-fightbook.mjs`, `scripts/lib/merge-probe-scenarios.mjs` (its whole
`moved` record, ~l.56-73), `scripts/lib/rls-probe-tables.mjs`,
`packages/db/fixtures/rls-probe-seed.sql` (~l.174-189).

**Types** — `packages/types/src/fightbook.ts`.

**API** (`apps/api/src/modules/fightbook/`) — `spar-after.service.ts` (new: mark, undo, review,
note), `spar-thanks.service.ts` (new: card extras + thank-yous list),
`fightbook-favourites.service.ts` (new), `spar-public-line.ts` (new: `readPublicSparLine`,
`readOwnSparLine`), `fightbook-after.controller.ts` (new), `spar-views.ts`,
`spar-reads.service.ts`, `spar-requests.service.ts` (cancel window), `spar-find.service.ts`
(`favourite`, public `withWeapons`), `fightbook-settings.service.ts`, `fightbook.controller.ts`
(settings, askable), `spar-notices.ts`; `modules/fighters/fighters.service.ts` (one call in
`getBySlug`); `modules/privacy/` export tables + `erasure-fightbook.ts`;
`modules/exports/archive.tables.ts`; `modules/entity-label/` record labels; `workers/` notice kind,
`alert-visibility.ts`, `alert-still-wanted.ts`; `notice-texts.ts`.

**Web** (`apps/web-public/`) — `app/me/fightbook/SparAfter.tsx` (new), `ThanksList.tsx` (new),
`FavouritesTab.tsx` (new), `MySparsTab.tsx`, `InboxTab.tsx`, `FightBookTabs.tsx`, `FindCards.tsx`,
`fightbook-patches.ts`, `FightBookSettingsPanel.tsx`; `src/components/fightbook/FavouriteHeart.tsx`
(new), `SparredLine.tsx` (new), `ProfileAskToSpar.tsx`; `src/lib/fightbook/read-fightbook.ts`,
`refusal.ts`; `app/fighters/[slug]/page.tsx` (one element).

**Docs** — ARCHITECTURE §11septies.7 "After the spar" + §11ter.2 row + §11septies.5 registries;
spec "After the spar" lines (rulings 677-690).

---

### Task 1: Migration 0267 and its registries

**Files:**

- Create: `packages/db/migrations/0267_fightbook_after_the_spar.sql`
- Modify: `apps/api/src/modules/privacy/subject-export.tables.ts` (FightBook block),
  `apps/api/src/modules/privacy/erasure-fightbook.ts` (`FIGHTBOOK_ROWS`),
  `apps/api/src/modules/exports/archive.tables.ts` (excluded list),
  `scripts/lib/rls-probe-tables.mjs`, `packages/db/fixtures/rls-probe-seed.sql`
- Test: the file that tests `eraseFightBookRows` today, `subject-export.service.test.ts`

**Interfaces:** Produces the schema of Decisions 1 and 3, `fightbook_review(uuid, uuid, smallint,
text, boolean, timestamptz)` and `fightbook_star_line(uuid) returns jsonb`.

- [ ] **Step 1:** Write the migration: replace `spar_requests_status_shape` (DROP CONSTRAINT +
      ADD; `done` → `agreed_at IS NOT NULL AND cancelled_by IS NULL AND cancel_message IS NULL AND
shared_comment IS NULL`), add `fightbook_show_stars`, the three tables (Decision 3) and the two
      functions (Decisions 4, 5; P0001 `not_open`; SECURITY INVOKER, `search_path` pinned, revoked
      from `public`/`anon`/`authenticated`, granted to `service_role`, the 0264 shape). The header
      comment says what and why, including rulings 688-690.
- [ ] **Step 2:** Failing tests: `eraseFightBookRows` deletes from `spar_thanks` (author,
      subject), `spar_anonymous_reviews` (author, subject), `fightbook_favourites` (owner,
      favourite), all BEFORE `spar_requests`, counts added per table; the export map gives
      `spar_thanks` both columns, `spar_anonymous_reviews` exactly `['author_global_person_id']`,
      `fightbook_favourites` exactly `['owner_global_person_id']`. A schema test
      (`buildMigrationSchema`, `common/testing/migration-schema.ts`): every `FIGHTBOOK_ROWS` table
      has an `id` column and the named column (mocks ignore the projection; an erasure delete on a
      missing column would 400 for every account).
- [ ] **Step 3:** Add the registry entries (Decision 12 notes; split the file if it passes 400
      lines). `pnpm --filter @myclash/api exec vitest run src/modules/privacy src/modules/exports` →
      PASS, including `subject-export.coverage.test.ts`, `subject-export.reach-fk.test.ts` and
      `archive.migration-coverage.test.ts`.
- [ ] **Step 4:** Fresh `replay.sh`: replay, rls (the three tables deny-all), merge, cascade,
      fightbook probes all 0. Verify the post-migration CHECK by inserting a `done` row with
      `cancelled_by` set → refused (a dropped CHECK can fail silently on PG17).
- [ ] **Step 5:** Commit `feat(fightbook): the tables for after the spar (0267)`.

### Task 2: The probe learns reviews and the star line

**Files:** Modify `scripts/db-fightbook-probe.mjs` (declared count, header list);
`scripts/lib/fightbook-probe-scenarios.mjs` or create `scripts/lib/fightbook-probe-reviews.mjs`.

**Interfaces:** Consumes Task 1's two functions.

- [ ] **Step 1:** Add scenarios, each a named `check` in its savepoint: a review with `p_now`
      before `expires_at + 48h` → `not_open` even when the database clock is past it (one clock); on
      `agreed` (not done) → `not_open`; by a stranger → `not_open`; a second review by one author on
      one spar → `not_open` whichever table the first went to (signed then anonymous, and the
      reverse); anonymous with a body → a `spar_anonymous_reviews` row and no `spar_thanks` row;
      signed with a blank body → body null; `fightbook_star_line` with no review → `{ average: null,
count: 0 }`, after 2 → `{ count: 2, average: round(avg, 1) }` over both tables, after a third
      it moves at once (688); the CHECKs (`done` with a cancel field, stars 0 and 6, self-review,
      self-favourite); only `service_role` may call either function.
- [ ] **Step 2:** Run on a fresh replay → all green; drop one table from the star line's union by
      hand → its check goes red; restore.
- [ ] **Step 3:** Commit `test(fightbook): the probe checks reviews and the star line`.

### Task 3: A merge carries thank-yous, anonymous reviews and favourites (0268)

**Files:** Create `packages/db/migrations/0268_fighter_merge_moves_fightbook_reviews.sql`
(redefines `merge_fighters` and its revert: 0265's bodies unchanged plus the additions, built at
fixed anchors by a scratch script like slice 1's `make-0265.mjs`, which lives in session
`89702ff9`'s scratchpad, not the repo); modify `scripts/lib/merge-probe-fightbook.mjs`,
`scripts/lib/merge-probe-scenarios.mjs` (the whole `moved` record), and the record labels in
`apps/api/src/modules/entity-label/audit-payload-refs.ts` (~l.93-97) + `entity-label-specs.ts`
(three new `EntityKind`s — signed thank-you, anonymous review, favourite — each with a
`LABEL_SPECS` entry labelled by `created_at`, ~l.36-37, 194-210), with their tests.

- [ ] **Step 1:** Additions: `spar_thanks` and `spar_anonymous_reviews` move author and subject to
      the survivor, except rows on a request that stays (a request between the two profiles);
      favourites move both columns except a self pair or a duplicate (stays, as 0265 keeps a doubled
      block); `fightbook_show_stars`: off wins. The record lists the moved ids (`sparThanksIds`,
      `sparAnonymousReviewIds`, `favouriteOwnerIds`, `favouriteTargetIds`); the revert moves exactly
      those back while they still sit on the survivor. Labels select `created_at` only (never stars,
      a body or a name).
- [ ] **Step 2:** Merge probe: seed one of each on the source; merge → each on the survivor and the
      survivor's star line counts them, switch off wins; revert → each back. A favourite of the
      source by the target stays and is not doubled.
- [ ] **Step 3:** Fresh replay: merge probe green with its new count; commit
      `feat(fightbook): a fighter merge carries reviews and favourites (0268)`.

### Task 4: We sparred, undo, and cancel ends with the day (677, 680, 681)

**Files:** Create `spar-after.service.ts` + test, `fightbook-after.controller.ts` + test; modify
`spar-requests.service.ts` (`cancel`), `spar-notices.ts`, `fightbook.module.ts`,
`packages/types/src/fightbook.ts` (`SparStatus` + `'done'`),
`workers/notification-scheduler.worker.ts`, `alert-visibility.ts`, `alert-still-wanted.ts` and the
hand-written kind lists in `notification-job-id.test.ts` (~l.40-56),
`notification-switched-off.test.ts` (~l.105-115), `alert-still-wanted.test.ts` (~l.320-333),
`notice-texts.ts` + the `notices` i18n keys, the switch description (`publicApp.ts` ~l.892, en +
fr), `archived-lock-ledger.ts`, the route-authz ledger.

**Interfaces:** Produces `SparAfterService.markDone(me, id, now?)`, `undo(me, id, now?)` (both
`Promise<void>`), `sparWindows(row: { spar_day; zone; expires_at }): { markFrom: Date; markUntil:
Date; cancelUntil: Date }` (exported from `spar-after.service.ts`), `notifySparMarkedDone(d, id,
other)`. Routes `POST me/fightbook/requests/:id/done`, `POST me/fightbook/requests/:id/undo`
(204, `ParseUUIDPipe`, `requireProfile`), in `FightBookAfterController` (its own one-line
`caller()` calling `fightBookCaller`).

- [ ] **Step 1:** Failing tests: `sparWindows` for an Event row (`zone` Europe/Paris, day
      Saturday, `expires_at` Sunday 06:00 Paris) → `markFrom` Saturday 00:00 Paris, `markUntil`
      Tuesday 06:00 Paris, `cancelUntil` Sunday 06:00; a free-date row in `America/Montreal` →
      `markFrom` Montreal midnight. `markDone` before `markFrom` → `not_open`, no write; at
      `markFrom` → update with `eq('status','agreed')`, the caller's side, `gt('expires_at', now −
48h)`; a stranger → 404; the update answering no row → 409 `not_open`; on success the other
      fighter's notice is started not awaited (a never-settling send still lets `markDone` resolve).
      `undo`: `eq('status','done')`, `gt('expires_at', now − 48h)`, either side; no notice.
      `cancel`: now also `.gt('expires_at', now)` — a cancel after the day → 409 `not_open`. Assert
      every select string and every `eq` filter (`filtersFor`).
- [ ] **Step 2:** Implement. The row read selects `id, asker_global_person_id,
receiver_global_person_id, status, spar_day, zone, expires_at`; the side logic is `cancel`'s
      (extract one helper both use rather than copying it).
- [ ] **Step 3:** Notice: kind `spar_marked_done` widens `ImmediateNotificationKind`; `CHECKS` /
      `WANTED` `null`; text `sparMarkedDone()` — FR "Un spar a été marqué comme fait" / "Vous pouvez
      l'annuler jusqu'à deux jours après le jour du spar." (the "vous" of the other notices,
      `notice-texts.test.ts:95-100`), EN "A spar was marked as done" / "You can undo it until two
      days after the spar day." (no names: it shows on a locked phone). The compile errors are part
      of the checklist; the three hand-written kind lists are the rest (they stay green without it).
- [ ] **Step 4:** Routes; ledger entries; OpenAPI regenerated. API tests for `fightbook`,
      `workers`, `notifications`, `route-authz`, `archived-lock` → PASS.
- [ ] **Step 5:** Two commits: `fix(fightbook): an agreed spar may be cancelled only until its day
ends (ruling 677)` (the cancel line + its test), then `feat(fightbook): we sparred and its
undo, until two days after the spar day (rulings 680, 681)`.

### Task 5: Reviews, the private note, and what a spar card shows (683, 684, 688-690)

**Files:** Modify `spar-after.service.ts` (`review`, `setNote`); create `spar-thanks.service.ts` +
test; modify `spar-views.ts` (`toAgreed`, `toIncoming`, `SparRow.zone`) + `spar-views.test.ts`
(~l.93 pins `toIncoming`), `spar-reads.service.ts` (status list, extras, `zone` in the shared
select; `spar-reads.service.test.ts` pins it as `SPAR_SELECT`, ~l.11),
`fightbook-after.controller.ts`, types, ledgers.

**Interfaces:** Produces `SparAfterService.review(me, id, input: { stars: 1|2|3|4|5; text?:
string; anonymous: boolean }, now?)`, `setNote(me, id, body: string | null)`;
`SparThanksService.cardExtras(me, requestIds): Promise<Map<id, { myReview; theirThanks; note }>>`,
`SparThanksService.received(me, page): Promise<ThanksPage>`; types `SparReview = { stars:
number; text: string | null; anonymous: boolean }`, `ThankYou = SparWhen & { id; from:
SparFighter; stars: number; text: string | null }`, `ThanksPage = { items: ThankYou[]; more:
boolean }`, `AgreedSpar`'s new fields and `IncomingSparRequest`'s three windows (Decision 8).
Routes `POST me/fightbook/requests/:id/review` (204, zod `{ stars: int 1-5, text?: 1-500 trimmed,
anonymous: boolean }` strict, exported schema), `PUT me/fightbook/requests/:id/note` (`{ body:
string 1-500 | null }`; null deletes), `GET me/fightbook/thanks?page=` (0-based, ≤ 500).

- [ ] **Step 1:** Failing tests: `review` calls `fightbook_review` with the caller as author and
      `p_now` = the service's `now` (ISO), its payload's keys equal
      `lastFunctionParams('fightbook_review')` (`common/testing/migration-function.ts`: a double
      ignores the payload, so a renamed key would stay green), and maps P0001 `not_open` to 409;
      `anonymous: true` with
      a text sends `p_body` null. `setNote` upserts on (`spar_request_id`,
      `author_global_person_id`) only for a `done` spar of the caller (else 404 / 409 `not_open`);
      null deletes the caller's note only. `cardExtras` makes the four reads of Decision 8, each with
      its select string and owner filter asserted and a fixture row of ANOTHER author or subject that
      must not appear; `theirThanks` comes from `spar_thanks` only (a `spar_anonymous_reviews` row by
      the partner about me changes nothing in the card: deep-equal to the card without it). The inbox
      card carries the three windows. `received`: `eq('subject_global_person_id', me)`,
      `created_at` desc then `id`, 20 + 1 rows, `more`, the author through `readSparFighters`.
      `mySpars` lists `done` beside `agreed` and `cancelled`.
- [ ] **Step 2:** Implement; `toAgreed` takes the extras and `sparWindows` (Task 4) to fill
      `markFrom`/`markUntil`/`cancelUntil` as ISO strings.
- [ ] **Step 3:** Routes, ledgers, OpenAPI; tests PASS; commit `feat(fightbook): thank-yous and a
private note after the spar (rulings 683, 684, 690)`.

### Task 6: Favourites (679)

**Files:** Create `fightbook-favourites.service.ts` + test; modify `spar-find.service.ts`
(`favourite` on every `FindCard`, one read of my favourites per Find answer; `withWeapons` made
public), `fightbook.controller.ts` (askable answer `{ askable, favourite }`),
`fightbook-after.controller.ts` (the three routes), `spar-reads.service.ts` (`partnerFavourite`,
Decision 8), types (`FindCard.favourite`, `FightBookAskable = { askable: boolean; favourite:
boolean }`, refusal `'favourites_full'`), ledgers.

**Interfaces:** Produces `FightBookFavouritesService.add(me, id)`, `remove(me, id)`, `list(me):
Promise<FindCard[]>`, `favouritesOf(db, me): Promise<Set<string>>` (a free function: one read,
`eq owner me`, `limit 200`). Routes `PUT|DELETE me/fightbook/favourites/:globalPersonId`, `GET
me/fightbook/favourites` (all `requireFightBookOn`).

- [ ] **Step 1:** Failing tests: add → 404 for a fighter off, unclaimed, merged, myself; 409
      `favourites_full` when the count read answers 200; a duplicate add is 204 (upsert ignore);
      remove deletes only `eq owner me`. `list` goes through `askableFighters` (a favourite I blocked
      is absent, a favourite who blocked me is present), by name, at most 200, select strings and
      owner filters asserted. Find, askable and My spars set `favourite` from `favouritesOf`; My
      spars gives `partnerFavourite: null` when the caller is off.
- [ ] **Step 2:** Implement; routes; tests PASS; commit `feat(fightbook): favourites, a private
heart on any FightBook user (ruling 679)`.

### Task 7: The public line and the star switch (682, 688, 689)

**Files:** Create `spar-public-line.ts` + test; modify `fighters.service.ts` (`getBySlug`: one
call after `withPublicProfileRelations`), `fighters.service.test.ts` (a new `getBySlug` key test),
`fightbook-settings.service.ts` (+ test: its "with no read" test, ~l.19, changes: `get` now reads
the own line), `fightbook.controller.ts` (settings DTO), types (`PublicSparLine`,
`FightBookSettings.showStars | sparred | stars`), the complexity baseline.

**Interfaces:** Produces `readPublicSparLine(db, globalPersonId: string, now?: Date):
Promise<PublicSparLine | null>` (reads the two switches itself: `PUBLIC_FIGHTER_COLUMNS` is shared
with the directory and fuzzy reads and is NOT widened) and `readOwnSparLine(db, me, now?):
Promise<{ sparred: number; stars: { average: number; count: number } | null }>`. `getBySlug`'s
answer gains `fightbook: PublicSparLine | null`; no other public read gains anything.

- [ ] **Step 1:** Failing tests: off → `null`, no count read and no star call; on → `sparred` from
      a count read with `eq status done`, `lte('expires_at', now − 48h)` and the `or` of both sides
      (assert the filter strings); stars via `rpc('fightbook_star_line', { p_subject })`, its
      payload's keys equal `lastFunctionParams('fightbook_star_line')` — `null`
      when the switch is off or the count is 0, present from a count of 1 (689) with the switch on
      (Review Focus 3). Own line: stars whenever the count ≥ 1, whatever the switch. Settings
      `PATCH { showStars }` writes `fightbook_show_stars` on the caller's row only. In
      `fighters.service.test.ts`: a `getBySlug` test that the answer carries `fightbook` and no key
      named `fightbook_enabled` / `fightbook_show_stars`; the directory key-set pin (`'builds each
row field by field…'`, ~l.1220) stays unchanged.
- [ ] **Step 2:** Implement; re-point the baseline for `fighters.service.ts`; audit (`per-file
changes: 0` besides it); tests PASS; commit `feat(fightbook): sparred N times and the stars on
the public page (rulings 682, 689)`.

### Task 8: My spars after the spar (web)

**Files:** Create `app/me/fightbook/SparAfter.tsx` + `SparAfter.test.tsx`; modify `MySparsTab.tsx`
(render `SparAfter` under each agreed/done card; hide Cancel at `cancelUntil`; `AgreedNote`
(~l.22-40) and the Cancel button (~l.170) treat every non-`agreed` status as cancelled today: switch
exhaustively on `status` with a `never` check, no `default`), `fightbook-patches.ts`
(`markedDone`, `undone`, `reviewed`, `noted`, idempotent; `agreedFrom` copies the incoming
windows, extras empty), `InboxTab.tsx` (`refresh()` after a Yes), `FightBookTabs.tsx`,
`read-fightbook.ts` (`writeFightBook` paths written whole), `refusal.ts`, i18n en/fr.

**Interfaces:** Consumes Tasks 4-5 routes and `AgreedSpar` fields.

- [ ] **Step 1:** Failing tests (fake clock): before `markFrom` no "We sparred"; between `markFrom`
      and `markUntil` an agreed spar shows "We sparred", a done one shows "Undo" and "Marked as
      sparred — you can undo until {day time}"; from `markUntil` a done spar without `myReview`
      shows the thank-you form (stars 1-5 as a radio group, text ≤ 500 hidden when "anonymous" is
      ticked, "Send"); with `myReview` it shows "Your thank-you: ★ n" (+ "anonymous");
      `theirThanks` shows "{name} thanked you ★ n" and the text; the private note box saves on
      "Save" and clears on empty. A `not_open` answer shows its sentence and calls `refresh()`
      (Review Focus 5). Buttons disabled while in flight (`useInFlight`). A `done` card never shows
      the "cancelled" text or the Cancel button. A Yes in the Inbox lands a card in My spars with
      its windows, then reads the page again.
- [ ] **Step 2:** Implement; tests PASS; commit `feat(fightbook): we sparred, undo and thank-yous
in My spars`.

### Task 9: The Thank-yous list (684, web)

**Files:** Create `app/me/fightbook/ThanksList.tsx` + test; modify `MySparsTab.tsx` (renders it at
the foot), `read-fightbook.ts` (`readThanks(apiUrl, page)`), i18n.

- [ ] **Step 1:** Failing tests: first page read when the tab opens; "Show more" appends while
      `more`, an answer for an older page dropped, a card already shown not repeated (the Find
      pattern); empty → "No thank-yous yet"; each card: photo, name, stars, which spar (day, Event or
      place, weapons), text.
- [ ] **Step 2:** Implement; PASS; commit `feat(fightbook): the thank-yous you received`.

### Task 10: Favourites tab and the heart (679, web)

**Files:** Create `src/components/fightbook/FavouriteHeart.tsx` + test,
`app/me/fightbook/FavouritesTab.tsx` + test; modify `FightBookTabs.tsx` (fourth tab `favourites`,
between My spars and Find), `FindCards.tsx`, `MySparsTab.tsx` (heart on the partner),
`ProfileAskToSpar.tsx` (reads `{ askable, favourite }`; heart beside the button),
`read-fightbook.ts`, i18n.

- [ ] **Step 1:** Failing tests: the heart is a toggle button with `aria-pressed` and a
      name-bearing label ("Add {name} to favourites" / "Remove …"); it flips at once and back on a
      failed write with a sentence; `favourites_full` gets its sentence. The tab lists favourites
      with heart and "Ask to spar"; removing one drops its card. The profile shows the heart only
      where it shows "Ask to spar" (same read, same `claimed` gate: no extra request for a
      signed-out visitor). A spar card whose `partnerFavourite` is `null` shows no heart.
- [ ] **Step 2:** Implement; PASS; commit `feat(fightbook): the Favourites tab and the heart`.

### Task 11: The public line and the star switch (web)

**Files:** Create `src/components/fightbook/SparredLine.tsx` + test; modify
`app/fighters/[slug]/page.tsx` (one element under the name, from the public data),
`FightBookSettingsPanel.tsx` (switch "Show my stars on my public page" + own line), i18n, the
complexity baseline for the page.

- [ ] **Step 1:** Failing tests: `null` line → nothing; `sparred 0` and no stars → nothing;
      `sparred 1` and `sparred 12` use two keys (`t()` has no plurals); stars → "★ 4.3 (7)" with the
      locale's decimal separator. Settings: the switch saves `showStars`; the own line shows the
      average when there is one, with "shown on your public page only when switched on".
- [ ] **Step 2:** Implement; PASS; commit `feat(fightbook): sparred N times on the fighter page and
the star switch`.

### Task 12: The docs

**Files:** `docs/ARCHITECTURE.md` (§11septies.7 "After the spar": windows, `done`, the two review
tables and why, the live star line, the public line; §11septies.5 the three tables; §11ter.2 the
new notice row; §11septies.1 the status list), the spec's "After the spar" lines and Build order 3
(rulings 677-690: the batch rule and "from 5 reviews" are overturned), the 0266 comment is not
edited (pushed).

- [ ] **Step 1:** Write; `pnpm format:check` green; commit `docs(fightbook): after the spar
(rulings 677-690)`.

### Task 13: Falsify, gates, review, push

- [ ] **Step 1:** `falsify-fb3.mjs` (new; slice 2's shape) — one case per guarantee: undo after
      `markUntil` refused; mark before `markFrom` refused; cancel after the day refused; review
      before `markUntil` refused (probe); a second review on one spar refused across the two tables
      (probe); an anonymous review leaves the partner's card deep-equal; the subject's export never
      reaches `spar_anonymous_reviews`; stars hidden with the switch off and at count 0; the public
      line `null` when off; `cardExtras` owner filters; favourites `list` hides fighters I blocked;
      erasure deletes each new table. Each: break, prove the break landed, red, restore, green.
- [ ] **Step 2:** `gates.sh` (32 gates) green; fresh `replay.sh` green (fightbook probe count up).
- [ ] **Step 3:** Cold whole-slice review (`code-architecture-reviewer`, Opus); one fold wave +
      scoped re-review; `git fetch`, push, watch CI; memory note + handoff.
