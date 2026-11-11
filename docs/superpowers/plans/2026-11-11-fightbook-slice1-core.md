# FightBook slice 1 (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in fighter can switch FightBook on, receive spar requests in an Inbox, answer
"Yes" or "Not this time", withdraw, cancel, block, and see every agreed spar in "My spars".

**Architecture:** Three new tables keyed on Global Persons, closed to the web (RLS on, no policy,
API writes as the service role). The state changes that must win a race (ask, answer, block, and
the merge) are SQL functions; the rest are single conditional updates. A committed SQL probe proves
the functions on Postgres in CI. A new API module `fightbook` serves `me/fightbook/*` routes. A new
web-public page `/me/fightbook` shows two tabs.

**Tech Stack:** Postgres 17 migrations, NestJS + Zod DTOs, BullMQ worker, Next 16 / React 19,
`@myclash/i18n`, `@myclash/ui`, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-10-fightbook-design.md` (rulings 642-661). Rulings taken
for this plan: **662** keep the design's slice order (no asking button in slice 1; the operator does
not redeploy until FightBook is done); **663** a "Not this time" never buzzes the asker's phone;
**664** each tab arrives with its own slice (slice 1 shows Inbox and My spars only); **665** a
request may name only a public Event (a draft or test Event uses a free date and place).

## In plain words

**What a fighter gets after slice 1.** A new "FightBook" entry in the personal-space menu. The page
first asks them to switch FightBook on (it starts off). Once on, the page has two tabs. **Inbox**
lists requests waiting for an answer: who asks, which weapons, which day, where, an optional time
and message, and three buttons: Yes, Not this time, Block. **My spars** lists every spar they agreed
to, grouped by day, and the requests they sent with their answer so far. A settings panel holds the
switch and the list of people they blocked.

**Nobody can send a request from the web yet.** The asking buttons come in slice 2 (ruling 662).
Slice 1 builds the "ask" door in the API and tests it, so slice 2 only adds buttons.

**Every "no" looks the same.** Julie can say "Not this time", ignore the request until it runs out,
or have blocked Marc. Marc sees the same words in all three cases, his phone never buzzes for a "no"
(ruling 663), and the answer to his ask comes back just as fast. Julie may add a comment; it stays
private unless she ticks "let them see it". A private comment is kept in its own drawer, so it never
reaches Marc, not even in his "download my data".

**A request runs out at the end of its day.** For an Event day that is 06:00 the next morning, on
the Event's clock (the rule the rest of MyClash uses). For a free date it is midnight, on the clock
of the person who asked. Every hour, a small job marks the old ones "Not this time", so the stored
record matches what everyone sees.

**Which Event.** A request can name only a published Event the asker is on (ruling 665). For a
draft or test Event, fighters pick "free date and place". Otherwise a request could reveal who is on
a roster nobody may see yet.

**No asking twice.** After a "Not this time", Marc cannot ask Julie again for the same Event, nor for
a free date until 7 days after he asked (ruling 667). Julie can still ask Marc. Marc also cannot pile up
requests: one waiting request per person, and a cap on asks per hour.

**Block.** Julie blocks Marc from a request card. Marc is not told and nothing changes on his side:
his next request "sends" as usual and comes back "Not this time". His requests waiting in her Inbox
end the same way. Her own request waiting in his Inbox is taken back, as if she withdrew it, because
a "Not this time" there would tell him something happened. A spar they already agreed stays; Julie
can cancel it the ordinary way. Julie unblocks Marc from her settings panel.

**Cancel and withdraw.** Marc can take back a request Julie has not answered; it simply disappears
from her Inbox. Either of them can cancel an agreed spar, with an optional message; the other gets a
"Spar cancelled" notice. Switching FightBook off takes back one's own waiting requests.

**Notices.** Julie's phone buzzes for a new request; Marc's for a "Yes"; either for a "Spar
cancelled". The texts carry no names, because they show on a locked phone. A new "FightBook" switch
in notification settings turns all three off.

**Two fighter profiles merged into one.** An admin merging a duplicate profile moves its spars and
blocks to the surviving profile, so a block never vanishes in a merge. A request between the two
merged profiles themselves stays on the merged-away one, so nobody ends up asking themselves.

**Deleting an account** deletes its FightBook rows. **Anonymising** a profile keeps them: the
account stays signed in, and its blocks must keep protecting it. **The Event archive** never
contains spars. **The data download** gives each fighter the requests they sent or received and the
blocks they made, never a block aimed at them.

## Global Constraints

- RLS on every new table, no policy; the API writes as the service role (0247; "a new table starts
  closed to web writes"). `pnpm db:review` green.
- Every user-facing string in `en` and `fr`; notice texts only in
  `apps/api/src/modules/notifications/notice-texts/notice-texts.ts` (FR then EN via `bilingual`).
- Notices: "off means off" (ARCHITECTURE §11ter, ruling 200). Texts carry no names.
- A new migration takes max+1 **at commit time** (0262 is the last today; the Workshops track also
  adds migrations).
- A CHECK is a `CASE … ELSE false END`, never an OR of comparisons (an OR passes on NULL).
- No raw ids in UI; no real names in fixtures.
- Time on the Event clock: `eventZone` (`apps/api/src/common/event-clock.ts`), `dayStartUtcIso` /
  `addDays` / `isIanaZone` (`@myclash/time`), `EVENT_CLOSING_HOUR` = 6
  (`apps/api/src/common/event-open-window.ts`).
- Every new DB read in a test asserts its select string (mocks ignore projections); write select
  strings inline (`db-schema-conformance` reads only inline strings).
- Files ≤ 400 lines, functions ≤ 50 lines (`quality:complexity`); a new over-cap function is split,
  never baselined. Re-point the baseline (line-keyed) after edits that move lines.
- The OpenAPI client is regenerated in each API commit that adds a route
  (`pnpm --filter @myclash/api build && pnpm openapi:client`), so `quality:openapi-drift` is green
  at every commit.
- One concern per commit, Conventional Commits, explicit paths, `git fetch` + `git log --oneline -1`
  before staging. Commit messages via a file and `git commit -F`.

## Decisions taken in this plan (the builder's calls the design left open)

1. **Tables.** `spar_requests` (one row = one request; agreed means the spar), `spar_private_notes`
   (a writer's private note on a request; slice 3's private review note reuses it), `fightbook_blocks`.
   The switch is `global_persons.fightbook_enabled` (default false). Like `allow_being_followed`
   (0211, ruling 155), it is readable on a listed fighter's row through the 0187 policy. That is
   accepted: anyone can see who is on FightBook by switching it on (Find, slice 2), and slice 3
   shows "Sparred N times" for everyone with FightBook on.
2. **`kind` column** (`event` | `free`). An Event spar keeps `kind = 'event'` when its Event is
   deleted (`event_id` set null, the design's default), so the shape CHECK does not break on delete.
   The zone is copied into the row at ask time for both kinds, so times still read after a delete.
3. **Which Event a request may name (ruling 665).** `isPublicEvent` (`common/auth/event-read-gate.ts:31`),
   the asker has a `persons` row there (`global_person_id` = their profile), the day is between
   `start_date` and `end_date`, and the day has not ended. Nothing about the receiver's roster is
   checked. A free-date request needs a place (1-200 characters) and an IANA zone.
4. **Status words stored:** `pending`, `agreed`, `not_this_time`, `withdrawn`, `cancelled`. No
   reason and no decline time is stored, so the row cannot tell a decline, a block and an expiry
   apart. Slice 3 adds `done`.
5. **The ask answers `201 { id }` and nothing else**, for a pending and a blocked request alike, and
   the "new request" notice is started without being awaited, so both answers take the same time.
   The asker's My spars shows "Not this time" at once (ruling 660).
6. **Refusals carry a `code`** (`{ code, message }` in the exception body, the `already_pending`
   shape in `auth.service.ts:2010-2013`; the filter keeps `code` at the top level,
   `api-exception.filter.ts:186-189`): `no_profile`, `fightbook_off`, `not_on_fightbook`,
   `already_asked`, `not_again`, `you_blocked`, `not_open`, `bad_day`, `bad_event`, `bad_answer`,
   `self`. The web maps each to an i18n string via `failureCode`.
7. **Ask throttle:** 20 asks per hour per account, its own bucket (copy of the `auth-account`
   throttler, keyed on the login's account).
8. **Limits:** 1-5 distinct catalog weapons; message, comment and cancel message ≤ 500 characters;
   a day at most 365 days ahead.
9. **Card data:** the other fighter's name (`given_name family_name`) and photo (`photo_url`; a photo
   has no visibility switch, `fighters/public-visibility.ts:8-16`). No profile link: an unlisted
   fighter's public page may not exist, and slice 2 adds what links. Club comes with slice 2's cards.
10. **Switching FightBook off.** One's pending outbound requests become `withdrawn` (on every save
    that says off, so a failed second write is repaired by the next save, the
    `removeFollowersOf` shape). A fighter who is off cannot answer (`fightbook_off`), their pending
    inbound requests run out as "Not this time", and `fightbook_answer` refuses `not_open` when the
    asker is off or no longer live. Asks to them are refused `not_on_fightbook`.
11. **A live profile** is one that `applyReachable` keeps (`fighters/directory-predicate.ts:87-89`:
    not merged, not deleted, account not erased) and that an account claims.
12. **My spars window:** agreed and cancelled spars whose day is at most 30 days ago, and requests
    sent in the last 30 days; at most 200 of each, oldest day first.
13. **Erasure and anonymisation.** Account erasure (`redactSubject`) deletes every FightBook row of
    the profile through its own helper and sets `fightbook_enabled` false. Anonymisation
    (`anonymiseGlobalPerson`) touches no FightBook row: the account stays linked
    (`erasure.service.ts:217-220`), so its blocks must keep working. The FightBook deletes are not
    added to `AIMED`, whose rows are "other people's" and which anonymisation also runs.

## Review Focus

1. **A request for an Event day asked at 23:30 that day** — still open until 06:00 next morning
   (Event clock); a free-date request at 23:30 local is open until midnight. Test in Task 5.
2. **Two taps race** — Yes against Withdraw, Yes against expiry, two Yes taps, withdraw against
   expiry: exactly one wins, the loser answers `409 not_open`. Probe in Task 3, tests in Task 9.
3. **The Event is deleted after the request** — the request survives with `event_id` null and the
   card shows the day without an Event name. Probe in Task 3, test in Task 8.
4. **A merge of two profiles with a pending request between them** — the request stays on the
   merged-away profile and the survivor's Inbox and My spars still load. Merge probe in Task 4.
5. **A request still pending in the database after its end, before the hourly job** — every read
   shows "Not this time"; answering and withdrawing refuse `not_open`; a new ask for **another
   Event** (or a free date after the 7 days) passes, because the ask ends the stale row first; a new
   ask for the **same Event** answers `not_again`. Probe in Task 3, tests in Tasks 8 and 9.

---

## File map

**Database** (`packages/db/migrations/`, numbers at commit time)

- `NNNN_fightbook_tables.sql` — switch column, three tables, indexes, RLS.
- `NNNN_fightbook_functions.sql` — `fightbook_ask`, `fightbook_answer`, `fightbook_block`.
- `NNNN_fighter_merge_moves_fightbook.sql` — `merge_fighters` + `revert_fighter_merge` redefined.
- `NNNN_fightbook_notice_switch.sql` — `notification_preferences.fightbook`.
- Tests and probes: `packages/db/test/fightbook-tables.test.ts`,
  `packages/db/test/fightbook-functions.test.ts`, `packages/db/test/fighter-merge-functions.test.ts`;
  new `scripts/db-fightbook-probe.mjs` + `scripts/lib/fightbook-probe-scenarios.mjs`;
  `scripts/lib/merge-probe-{fixture,scenarios}.mjs`, `scripts/db-merge-probe.mjs`;
  `scripts/lib/rls-probe-tables.mjs`, `packages/db/fixtures/rls-probe-seed.sql`.

**Types** — `packages/types/src/fightbook.ts` (wire shapes), exported from the package index.

**API** (`apps/api/src/modules/fightbook/`)

- `fightbook.module.ts`, `fightbook.controller.ts` (thin; one same-class `caller()` helper).
- `fightbook-caller.ts` — who calls: account + live profile + switch.
- `spar-ask-rules.ts` — pure: day/zone/expiry.
- `spar-requests.service.ts` — ask, answer, withdraw, cancel.
- `spar-reads.service.ts` + `spar-views.ts` (pure mapping to the three payloads).
- `fightbook-blocks.service.ts`, `fightbook-settings.service.ts`.
- `spar-notices.ts` — the three notices.
- `apps/api/src/workers/spar-request-expiry.worker.ts` — the hourly end of unanswered requests.
- `apps/api/src/common/throttling/throttle-fightbook-ask.ts` + `throttler-options.ts` entry.
- Privacy: `subject-export.tables.ts` (split first, Task 0), `subject-export.excluded.ts` (new),
  `archive.tables.ts`, `erasure.service.ts`, `erasure-fightbook.ts` (new).
- Registries: `notification-scheduler.worker.ts`, `alert-visibility.ts`, `alert-still-wanted.ts`,
  `notifications.service.ts`, `notifications/dto/notifications.dto.ts`,
  `entity-label/audit-payload-refs.ts`, `app.module.ts`, `workers.module.ts`.

**CI registration of the new probe** — `package.json` script, `.github/workflows/ci.yml` step,
`apps/api/src/modules/admin/ci-health/gates.ts` (`CI_GATES`), `CONTRIBUTING.md`, the
`myclash-gates` skill chain, and any doc that states the gate count (`pnpm quality:docs-drift`
names them).

**Web** (`apps/web-public/`)

- `app/me/fightbook/page.tsx`, `FightBookClient.tsx`, `InboxTab.tsx`, `MySparsTab.tsx`,
  `FightBookSettingsPanel.tsx`, `SparCard.tsx`, `use-fightbook.ts`.
- `src/lib/fightbook/read-fightbook.ts` (reads with shape checks), `src/lib/fightbook/refusal.ts`.
- `src/components/PublicPersonalShell.tsx` (menu entry), `app/me/settings/NotificationPreferences.tsx`.
- `packages/ui/src/components/NavIcon.tsx` + generated `nav-icon-glyphs.ts`.
- i18n: `packages/i18n/src/messages/{en,fr}/publicApp.ts`, `{en,fr}/notices.ts`.

**Docs** — `docs/ARCHITECTURE.md` (a FightBook section; three rows in §11ter.2).

---

### Task 0: Make room in the subject-export registry

`subject-export.tables.ts` is 399 lines with no baseline entry; the cap is 400
(`scripts/check-complexity.mjs:35`). FightBook's three entries would turn `quality:complexity` red.

**Files:** Create `apps/api/src/modules/privacy/subject-export.excluded.ts`; modify
`subject-export.tables.ts` (move `SUBJECT_EXPORT_EXCLUDED_TABLES` and its docblock there, re-export
it from `subject-export.tables.ts` so no importer changes).

- [ ] **Step 1:** Move; `pnpm --filter @myclash/api typecheck` and the `subject-export.*` tests green;
      `pnpm quality:complexity` green.
- [ ] **Step 2: Commit** `refactor(api): the subject export's excluded tables get their own file`.

### Task 1: The tables and the switch, in every privacy list

**Files:**

- Create: `packages/db/migrations/NNNN_fightbook_tables.sql`, `packages/db/test/fightbook-tables.test.ts`,
  `apps/api/src/modules/privacy/erasure-fightbook.ts` (+ `.test.ts`)
- Modify: `subject-export.tables.ts`, `subject-export.service.test.ts`, `archive.tables.ts`
  (`ARCHIVE_EXCLUDED_TABLES`), `erasure.service.ts` (`redactSubject`), `erasure.service.test.ts`,
  `erasure.aimed-rows.test.ts` (seed the three tables in `tables()`), `scripts/lib/rls-probe-tables.mjs`,
  `packages/db/fixtures/rls-probe-seed.sql`

**Interfaces — Produces:** tables and columns used by every later task:

- `global_persons.fightbook_enabled BOOLEAN NOT NULL DEFAULT FALSE`
- `spar_requests (id uuid pk default gen_random_uuid(), asker_global_person_id uuid not null → global_persons on delete cascade, receiver_global_person_id uuid not null → global_persons on delete cascade, kind text not null, event_id uuid → events on delete set null, spar_day date not null, zone text not null, spar_time time, place text, weapons text[] not null, message text, status text not null default 'pending', expires_at timestamptz not null, shared_comment text, agreed_at timestamptz, cancelled_by text, cancel_message text, created_at timestamptz not null default now())`
- `spar_private_notes (id uuid pk, spar_request_id uuid not null → spar_requests on delete cascade, author_global_person_id uuid not null → global_persons on delete cascade, body text not null, created_at timestamptz not null default now())`
- `fightbook_blocks (id uuid pk, blocker_global_person_id uuid not null → global_persons on delete cascade, blocked_global_person_id uuid not null → global_persons on delete cascade, created_at timestamptz not null default now())`
- `eraseFightBookRows(db: SupabaseClient, globalPersonIds: string[]): Promise<RedactionCounts>` in
  `erasure-fightbook.ts` — deletes `spar_private_notes` by author, `spar_requests` by asker and by
  receiver, `fightbook_blocks` by blocker and by blocked, **summing** the counts per table; a failed
  delete throws.

CHECKs (each a CASE with `ELSE false`):

- `spar_requests_two_fighters`: asker ≠ receiver. `fightbook_blocks_two_fighters`: blocker ≠ blocked.
- `spar_requests_kind_shape`: `event` → `place IS NULL`; `free` → `event_id IS NULL AND place IS NOT NULL`.
- `spar_requests_status_shape`: `pending` and `withdrawn` → agreed_at, cancelled_by, cancel_message,
  shared_comment all null; `agreed` → agreed_at set, the other three null; `not_this_time` →
  agreed_at, cancelled_by, cancel_message null; `cancelled` → agreed_at set, cancelled_by set,
  shared_comment null.
- `cancelled_by` in (`asker`, `receiver`); `weapons` cardinality 1-5; `message`, `shared_comment`,
  `cancel_message`, `body` length 1-500; `place` length 1-200.

Indexes (all `CREATE [UNIQUE] INDEX IF NOT EXISTS … ON …`, because `db:review`'s foreign-key check
reads only `ON tbl (…)` lists, `scripts/lib/db-rules.mjs:328-340`):
`spar_requests (receiver_global_person_id, status, spar_day)`, `(asker_global_person_id, created_at desc)`,
`(event_id)`, unique `(asker_global_person_id, receiver_global_person_id) WHERE status = 'pending'`,
`(expires_at) WHERE status = 'pending'` (the hourly job); unique
`spar_private_notes (spar_request_id, author_global_person_id)`, `spar_private_notes (author_global_person_id)`;
unique `fightbook_blocks (blocker_global_person_id, blocked_global_person_id)`,
`fightbook_blocks (blocked_global_person_id)`. All three tables `ENABLE ROW LEVEL SECURITY`, no
policy. `NOTIFY pgrst, 'reload schema'`.

- [ ] **Step 1: Write the failing DB test** `fightbook-tables.test.ts` (the `event-photos.test.ts`
      shape, `allSql()` + `flat`): for each table `create table if not exists public.<t> (`, `alter table
public.<t> enable row level security`, no `create policy … on <t>`; the switch reads
      `fightbook_enabled boolean not null default false`; each named CHECK contains `case` and
      `else false`; the pending-pair unique index carries `where status = 'pending'`;
      `event_id … on delete set null`.
- [ ] **Step 2: Run** `pnpm --filter @myclash/db test -- fightbook-tables` → FAIL.
- [ ] **Step 3: Write the migration.** Header: what each table is for, why RLS has no policy, why
      `kind` exists (Event delete), why no reason or decline time is stored.
- [ ] **Step 4: Register the tables.**
  - Subject export: `spar_requests` reaches `asker_global_person_id` and `receiver_global_person_id`
    (`global_person`), file `fightbook.csv`, note "requests the subject sent or received; a private
    comment lives in spar_private_notes; within the hour before the expiry job a row past its end
    still reads pending"; `spar_private_notes` reaches `author_global_person_id` only;
    `fightbook_blocks` reaches `blocker_global_person_id` only, with the Art. 15(4) note copied from
    the follows comment (a block aimed at the subject names someone else and reveals the block).
  - Archive: all three tables in `ARCHIVE_EXCLUDED_TABLES` with `// FightBook: private, not the
Event record` (the spec excludes every FightBook table; the coverage test forces only the one
    with `event_id`).
  - Erasure: `redactSubject` calls `eraseFightBookRows(globalPersonIds)` before its profile update
    (the `AIMED` ordering rule: a retry must still find the rows) and adds `fightbook_enabled: false`
    to that update.
  - RLS probe: one seeded row per table in `rls-probe-seed.sql` and a "hidden from anon" verdict
    for each in `VERDICTS`.
- [ ] **Step 5: Tests for the registrations.**
  - `erasure-fightbook.test.ts`: each of the five deletes runs with its column; a row matching both
    asker and receiver lists cannot exist, and two `spar_requests` deletes add their counts.
  - `erasure.service.test.ts`: `redactSubject` calls it with the claimed profile ids and writes
    `fightbook_enabled: false`; `anonymiseGlobalPerson` deletes no FightBook table.
  - `subject-export.service.test.ts`: `fightbook_blocks` reaches do not contain
    `blocked_global_person_id` (the `followed_person_id` pin at l.236-241).
- [ ] **Step 6: Replay and run.** Copy `replay.sh` to this session's scratchpad with its own
      container name and port; `pnpm db:migrations:replay`; `pnpm --filter @myclash/db test`; the API
      privacy tests (`subject-export.*`, `archive.migration-coverage`, `erasure.*`); `pnpm db:review`;
      `pnpm db:rls-probe` → green.
- [ ] **Step 7: Commit** `feat(db): FightBook tables and switch, in every privacy list`.

### Task 2: Wire shapes and the pure ask rules

**Files:** Create `packages/types/src/fightbook.ts`; `apps/api/src/modules/fightbook/spar-ask-rules.ts`
(+ `.test.ts`). Modify `packages/types/src/index.ts`.

**Interfaces — Produces:**

```ts
// packages/types/src/fightbook.ts
export type SparKind = 'event' | 'free';
export type SparStatus = 'pending' | 'agreed' | 'not_this_time' | 'withdrawn' | 'cancelled';
export interface SparFighter {
  globalPersonId: string;
  name: string;
  photoUrl: string | null;
}
interface SparWhen {
  kind: SparKind;
  eventName: string | null;
  day: string;
  time: string | null;
  place: string | null;
  weapons: string[];
}
export interface IncomingSparRequest extends SparWhen {
  id: string;
  asker: SparFighter;
  message: string | null;
}
export interface SentSparRequest extends SparWhen {
  id: string;
  receiver: SparFighter;
  message: string | null;
  status: 'pending' | 'not_this_time';
  comment: string | null;
}
export interface AgreedSpar extends SparWhen {
  id: string;
  partner: SparFighter;
  iAsked: boolean;
  message: string | null;
  status: 'agreed' | 'cancelled';
  cancelledByMe: boolean | null;
  cancelMessage: string | null;
}
export interface MySpars {
  spars: AgreedSpar[];
  sent: SentSparRequest[];
}
export interface FightBookSettings {
  hasProfile: boolean;
  enabled: boolean;
}
export interface FightBookBlock {
  fighter: SparFighter;
}
export const SPAR_REFUSAL_CODES = [
  'no_profile',
  'fightbook_off',
  'not_on_fightbook',
  'already_asked',
  'not_again',
  'you_blocked',
  'not_open',
  'bad_day',
  'bad_event',
  'bad_answer',
  'self',
] as const;
export type SparRefusalCode = (typeof SPAR_REFUSAL_CODES)[number];
```

(`withdrawn` requests are not listed to anyone, so `SentSparRequest.status` has two words.)

```ts
// spar-ask-rules.ts
export const SPAR_MAX_DAYS_AHEAD = 365;
/** End of a requested day: 06:00 next morning on an Event's clock, midnight on a free date's. */
export function sparExpiresAt(kind: SparKind, day: string, zone: string): Date | null;
/** 'bad_day' unless `day` is a YYYY-MM-DD between the Event's start and end dates. */
export function eventDayRefusal(
  day: string,
  event: { start_date: string; end_date: string },
): 'bad_day' | null;
```

- [ ] **Step 1: Failing tests** in `spar-ask-rules.test.ts`:
  - `sparExpiresAt('event','2026-05-22','Europe/Paris')` → `2026-05-23T04:00:00.000Z`.
  - `sparExpiresAt('free','2026-05-22','Europe/Paris')` → `2026-05-22T22:00:00.000Z`.
  - DST: `sparExpiresAt('event','2026-03-29','Europe/Paris')` → `2026-03-30T04:00:00.000Z`.
  - Review Focus 1: at `2026-05-22T21:30:00Z` (23:30 Paris) both ends are still in the future.
  - `eventDayRefusal` refuses the day before `start_date`, the day after `end_date` and
    `'22/05/2026'`; accepts both edge days.
- [ ] **Step 2: Run** `pnpm --filter @myclash/api test -- spar-ask-rules` → FAIL.
- [ ] **Step 3: Implement** with `addDays` and `dayStartUtcIso` (`EVENT_CLOSING_HOUR` for `event`).
- [ ] **Step 4: Run** → PASS; build `@myclash/types`.
- [ ] **Step 5: Commit** `feat(api): the day a spar request ends, on the right clock`.

### Task 3: The three functions that must win races, and their probe in CI

**Files:**

- Create: `packages/db/migrations/NNNN_fightbook_functions.sql`, `packages/db/test/fightbook-functions.test.ts`,
  `scripts/db-fightbook-probe.mjs`, `scripts/lib/fightbook-probe-scenarios.mjs`
- Modify: `package.json` (`"db:fightbook-probe": "node scripts/db-fightbook-probe.mjs"`),
  `.github/workflows/ci.yml` (a step after the merge probe, `if: ${{ !cancelled() && steps.replay.outcome == 'success' }}`
  — copy the merge probe step's exact condition), `apps/api/src/modules/admin/ci-health/gates.ts`
  (`CI_GATES` keyed by the step's display name), `CONTRIBUTING.md`, `.claude/skills/myclash-gates/SKILL.md`,
  and every doc `pnpm quality:docs-drift` reports with a gate count.

**Interfaces — Produces** (all `language plpgsql`, `SECURITY INVOKER`,
`set search_path = public, pg_catalog`, revoked from `public`, `anon`, `authenticated` by name,
granted to `service_role`; a refusal is `RAISE … USING errcode = 'P0001'` with the code word as
message):

- `fightbook_ask(p_asker uuid, p_receiver uuid, p_kind text, p_event_id uuid, p_spar_day date, p_zone text, p_spar_time time, p_place text, p_weapons text[], p_message text, p_expires_at timestamptz) returns jsonb` → `{"id": uuid, "status": "pending" | "not_this_time"}`. In order:
  1. `p_asker = p_receiver` → `self`.
  2. `pg_advisory_xact_lock` on the unordered pair
     (`hashtextextended(least(a,b)::text || greatest(a,b)::text, 0)`), then
     `select 1 from global_persons where id in (a, b) order by id for key share` (a merge's
     `FOR UPDATE` then waits for the ask, or the ask for the merge, never both: no deadlock).
  3. Asker not live (merged, deleted, `account_deleted_at` set, unclaimed) or switch off →
     `fightbook_off`; receiver not live or switch off → `not_on_fightbook`.
  4. The asker blocked the receiver → `you_blocked`.
  5. End the pair's stale requests: `status = 'not_this_time'` where asker→receiver, `pending`,
     `expires_at <= now()`.
  6. A `pending` asker→receiver row → `already_asked`.
  7. No re-asking: `event` kind and a `not_this_time` asker→receiver row with the same `event_id` →
     `not_again`; `free` kind and a `not_this_time` asker→receiver `free` row whose
     `created_at > now() - interval '7 days'` → `not_again` (7 days after the refused request was
     asked, ruling 667; no decline time is needed).
  8. Insert with status `not_this_time` when the receiver blocked the asker, else `pending`.
- `fightbook_answer(p_request uuid, p_receiver uuid, p_answer text, p_comment text, p_comment_shared boolean) returns jsonb` → `{"asker": uuid, "status": "agreed" | "not_this_time"}`. `p_answer` not in (`yes`,`no`) → `bad_answer`. One conditional update `WHERE id = p_request AND receiver_global_person_id = p_receiver AND status = 'pending' AND expires_at > now()` and the asker is live with the switch on (a sub-select in the same WHERE); no row → `not_open`. `yes` sets `agreed_at = now()` and ignores any comment; `no` sets `shared_comment` only when shared; an unshared comment inserts the receiver's note into `spar_private_notes`.
- `fightbook_block(p_blocker uuid, p_blocked uuid) returns void`: `self` when equal; the same pair
  lock and key-share read; the blocked profile missing → `P0002`; insert `on conflict do nothing`;
  the blocked fighter's `pending` requests to the blocker → `not_this_time`; the blocker's own
  `pending` requests to the blocked → `withdrawn` (a "Not this time" there would show the blocked
  fighter, in their own data download, a refusal nobody gave). Agreed rows are untouched.

The probe (`db-fightbook-probe.mjs`, shaped on `db-merge-probe.mjs`: service role, one rolled-back
transaction, one savepoint per scenario, counted checks with `EXPECTED_CHECKS`, `nothingToCount`
refused) proves, each a named check:
ask → `pending`; ask again → `already_asked`; self → `self`; receiver off → `not_on_fightbook`;
receiver erased (`account_deleted_at`) → `not_on_fightbook`; blocked ask → `not_this_time`, no
error; blocked asker's second ask for another Event → `not_this_time`, no error; decline then ask
for the same Event → `not_again`; for another Event → `pending` (Review Focus 5); free decline with
the refused day ended 6 days ago → `not_again`, 8 days → `pending`; a stale pending is ended by a
new ask; answer after `expires_at` → `not_open`; answer after withdraw → `not_open`; two answers →
one `agreed`, one `not_open`; answer when the asker switched off → `not_open`; `no` with an unshared
comment → `shared_comment` null and one note; `yes` with a comment → no note, no shared comment;
block ends the blocked fighter's pending as `not_this_time` and the blocker's own as `withdrawn`,
and leaves an agreed spar agreed; the shape CHECKs refuse a `free` row without a place and a
`cancelled` row without `cancelled_by`; deleting the Event keeps the row with `event_id` null;
`has_function_privilege` false for anon and authenticated on all three.

- [ ] **Step 1: Write the failing static test** `fightbook-functions.test.ts` (the
      `fighter-merge-functions.test.ts` shape: last definition, invoker rights, pinned search path,
      the revokes and the grant; the ask takes the pair lock before its first read; the answer's update
      names `status = 'pending'` and `expires_at > now()`).
- [ ] **Step 2: Write the probe and its registrations**; run `pnpm db:migrations:replay && pnpm
db:fightbook-probe` → FAIL (no functions).
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run** the probe (prints `EXPECTED_CHECKS` passed), the DB tests,
      `rpc-function-conformance.test.ts`, `gates.drift.test.ts`, `pnpm quality:docs-drift` → green.
- [ ] **Step 5: Commit** `feat(db): FightBook ask, answer and block are one call each, proved in CI`.

### Task 4: A merge moves FightBook rows

**Files:**

- Create: `packages/db/migrations/NNNN_fighter_merge_moves_fightbook.sql`
- Modify: `scripts/lib/merge-probe-fixture.mjs`, `scripts/lib/merge-probe-scenarios.mjs`,
  `scripts/db-merge-probe.mjs` (`EXPECTED_CHECKS`), `packages/db/test/fighter-merge-functions.test.ts`,
  `apps/api/src/modules/entity-label/audit-payload-refs.ts` (+ its test)

**Interfaces — Produces:** both functions redefined in this one file, 0212's body unchanged plus:

- The survivor keeps the stricter switch: `fightbook_enabled = v_target.fightbook_enabled and v_source.fightbook_enabled`.
- `spar_requests.asker_global_person_id` and `.receiver_global_person_id` source → target, except a
  row whose other side is the target (it stays: no self-spar) and except a `pending` row that would
  collide on the pending-pair index, **either way** (S→X onto an existing T→X, or X→S onto an existing
  X→T: it stays). Recorded as `moved.sparRequestAskerIds` / `moved.sparRequestReceiverIds`.
- `fightbook_blocks`, both columns: same rules (skip the other side = target, skip an existing pair).
  Recorded as `moved.blockBlockerIds` / `moved.blockBlockedIds`. After the moves, every pair the
  survivor now blocks or is blocked by ends its `pending` requests exactly as `fightbook_block` does
  (blocked side → `not_this_time`, blocker side → `withdrawn`), so no Inbox holds a request from
  someone its owner blocked.
- `spar_private_notes.author_global_person_id`: moved unless the survivor has a note on that request.
  Recorded as `moved.sparNoteIds`.
- The revert moves back exactly the recorded ids still on the survivor, never onto a duplicate, and
  leaves the survivor's switch as it is (0212's rule for privacy choices). Requests the merge ended
  stay ended (an ended request is not an id the record moved back).
- `fighter-merge-functions.test.ts`'s audit-writer test (`writers` toEqual the one file of the last
  `merge_fighters`, l.96-103) becomes: every audit writer defines `merge_fighters` or
  `revert_fighter_merge`, and the newest writer defines both.
- `audit-payload-refs.ts`: the five new `moved.*` keys get rules so the admin audit view never
  shows them as bare ids. Each labels as a fixed private word with no name ("a spar request", "a
  FightBook block", "a private note"); if `EntityKind` has no such kind, add `fightbook_row` with
  that one label.

- [ ] **Step 1: Probe scenarios first** (fixture: a pending request between the two profiles; a
      pending S→X with an existing T→X; a block of S by a third fighter Y with Y→T pending; a block by S
      of a third fighter; an agreed spar of S with a third fighter; a private note): after the merge the
      blocks, the spar and the note sit on the survivor; the two colliding requests and the request
      between S and T stay on S; Y→T is now `not_this_time`; the switch is the stricter; the record lists
      the moved ids; after the revert each moved id is back; a pre-FightBook record (no new keys) moves
      nothing back. Bump `EXPECTED_CHECKS`.
- [ ] **Step 2: Run** `pnpm db:migrations:replay && pnpm db:merge-probe` → FAIL.
- [ ] **Step 3: Write the migration** and the test and label changes.
- [ ] **Step 4: Run** the merge probe, the FightBook probe, `packages/db` tests, the entity-label
      tests, `pnpm db:review` → green.
- [ ] **Step 5: Commit** `feat(db): a fighter merge moves FightBook spars, blocks and notes`.

### Task 5: The three notices and their switch

Built before the routes, so the request service injects `NotificationSchedulerService` from its
first commit (no optional constructor seam: an interface-typed or `T | undefined` parameter
un-injects in Nest).

**Files:**

- Create: `packages/db/migrations/NNNN_fightbook_notice_switch.sql`; `apps/api/src/modules/fightbook/spar-notices.ts` (+ test)
- Modify: `notification-scheduler.worker.ts` (`ImmediateNotificationKind` +
  `'spar_request_received' | 'spar_agreed' | 'spar_cancelled'`; `PREFERENCE_TOGGLE_COLUMNS` +
  `'fightbook'`), `alert-visibility.ts` (`CHECKS` null each, "a private spar, never public"),
  `alert-still-wanted.ts` (`WANTED` null each, "sent at once"), `alert-still-wanted.test.ts`
  (l.321-331 list), `notification-job-id.test.ts` (`KINDS`), `notification-switched-off.test.ts`
  (three `SWITCHED` rows and the pinned select string), `notice-texts.ts` + test, `{en,fr}/notices.ts`,
  `notifications.service.ts` (+ test default pin), `notifications/dto/notifications.dto.ts`,
  `tests/a11y/profile-stub.ts`, generated API client.

**Interfaces — Produces:**

```ts
export interface SparNoticeDeps {
  db: SupabaseClient;
  notifications: Pick<NotificationSchedulerService, 'sendImmediate'>;
  supabase: Pick<SupabaseService, 'getAuthAdminUser'>;
  logger: Pick<Logger, 'warn' | 'error'>;
}
export async function notifySparRequestReceived(
  deps: SparNoticeDeps,
  requestId: string,
  receiver: string,
): Promise<void>;
export async function notifySparAgreed(
  deps: SparNoticeDeps,
  requestId: string,
  asker: string,
): Promise<void>;
export async function notifySparCancelled(
  deps: SparNoticeDeps,
  requestId: string,
  other: string,
): Promise<void>;
```

Each: profile → `claimed_by_user_id` (none: nothing sent, a warning logged) → email via
`getAuthAdminUser` (the `refereeAccount` shape, `notification-events.service.ts:358-373`) →
`sendImmediate({ kind, entityId: requestId, userId, email, ...text, url, preference: 'fightbook' })`,
url `/me/fightbook?tab=inbox` (received) or `/me/fightbook?tab=spars`. Never throws: a failure is
logged with the request id. Texts (`notices.sparRequestReceived|sparAgreed|sparCancelled`, title +
body, no names): EN "New spar request" / "Open FightBook to answer."; "Spar agreed" / "Your spar
request was accepted. It is in My spars."; "Spar cancelled" / "A spar you agreed to was cancelled.";
FR "Nouvelle demande de spar" / "Ouvrez FightBook pour répondre."; "Spar accepté" / "Votre demande de
spar a été acceptée. Elle est dans Mes spars."; "Spar annulé" / "Un spar que vous aviez accepté a été
annulé.".

Migration: `ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS fightbook BOOLEAN NOT NULL DEFAULT TRUE;`

- [ ] **Step 1: Failing tests:** `spar-notices.test.ts` — each notice reads `claimed_by_user_id`
      (select string asserted), sends its kind, url and `preference: 'fightbook'`, sends nothing for an
      unclaimed profile, and logs instead of throwing when `sendImmediate` rejects; `notice-texts.test.ts`
      pins the six bilingual strings; `notification-switched-off.test.ts` rows; the service default
      includes `fightbook: true`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** the worker and notification
      suites and `pnpm --filter @myclash/i18n test` (directly, not through turbo) → green.
- [ ] **Step 5: Commit** `feat(api): FightBook notices, with their own switch`.

### Task 6: The FightBook module: the caller, the switch, and the ask

**Files:**

- Create: `fightbook.module.ts`, `fightbook.controller.ts`, `fightbook-caller.ts`,
  `fightbook-settings.service.ts`, `spar-requests.service.ts` (+ `.test.ts` each),
  `apps/api/src/common/throttling/throttle-fightbook-ask.ts`
- Modify: `apps/api/src/app.module.ts`, `throttler-options.ts` (+ test), `throttle-profiles.ts`
  (`FIGHTBOOK_ASK_THROTTLE = { limit: 20, ttl: 3_600_000 }`), generated API client.

**Interfaces — Produces:**

```ts
// fightbook-caller.ts
export interface FightBookCaller {
  userId: string;
  globalPersonId: string | null;
  enabled: boolean;
}
/** 401 signed out; 403 a staff login or a guest token (FightersController.list's rule). */
export async function fightBookCaller(
  req: FastifyRequest,
  db: SupabaseClient,
): Promise<FightBookCaller>;
/** The caller's live profile, or 403 { code: 'no_profile' }. */
export function requireProfile(caller: FightBookCaller): string;
/** The caller's live profile with FightBook on, or 403 { code: 'no_profile' | 'fightbook_off' }. */
export function requireFightBookOn(caller: FightBookCaller): string;
```

The live profile is read with `applyReachable` over `global_persons` where
`claimed_by_user_id = userId`, selecting `id, fightbook_enabled`. `fightBookCaller` contains the
literal `throw new UnauthorizedException(…)` (the route-authz scan follows an imported helper to
that literal, `route-authz-scan.ts:215-228`; a `throw unauthorized()` would not count).

Routes (`@Controller('me/fightbook')`; each handler starts `const caller = await this.caller(req)`,
a same-class helper over `fightBookCaller`, so the scan reads them as `me` routes that refuse
anonymous callers, verdict `self`, no ledger line):

- `GET settings` → `FightBookSettings`; `PATCH settings { enabled: boolean }` → `FightBookSettings`
  (`requireProfile`). Saving off also sets the caller's `pending` outbound requests to `withdrawn`
  (every save that says off; a failure there is a 5xx after the switch is saved, and the next save
  repairs it).
- `POST requests` `@ThrottleFightBookAsk()`, body (strict Zod):
  `{ receiverGlobalPersonId: uuid, kind: 'event'|'free', eventId?: uuid, day: 'YYYY-MM-DD', zone?: string, time?: 'HH:MM', place?: string(1-200), weapons: string[](1-5, distinct), message?: string(1-500) }`
  → `201 { id }`.

`SparRequestsService.ask(asker: string, input: AskSparInput): Promise<{ id: string }>`:

- `event` kind: read `events` (`id, status, event_kind, start_date, end_date, timezone`) and the
  asker's `persons` row (`event_id`, `global_person_id = asker`). Missing Event, not
  `isPublicEvent`, or no asker row → `bad_event`; `eventDayRefusal` → `bad_day`. Zone =
  `eventZone(event.timezone).zone`.
- `free` kind: `zone` must pass `isIanaZone`, else `bad_day`; `place` required.
- `sparExpiresAt(...) <= now` or the day more than `SPAR_MAX_DAYS_AHEAD` ahead → `bad_day`.
- Weapons: one read of the active catalog (`weapon_catalog`, `name`, `active = true`), each name
  matched by `resolveCatalogWeapon`'s rule (trimmed, case-insensitive); unknown → 400.
- `fightbook_ask` via `.rpc`; P0001 → `409` for `already_asked` / `not_again`, `400` for `self`,
  `403` for the others, body `{ code, message }`; any other error → 5xx.
- When the status is `pending`: `void notifySparRequestReceived(…)` — started, **not awaited**, so a
  pending and a blocked ask answer in the same time; it never throws (Task 5).

- [ ] **Step 1: Failing tests.**
  - `fightbook-caller.test.ts`: anonymous → 401; staff and guest identities → 403; claimed without a
    live profile → `globalPersonId: null`; the select string is exactly `'id, fightbook_enabled'`
    and the reachable filters are applied (captured calls).
  - `fightbook-settings.service.test.ts`: PATCH writes `fightbook_enabled` on the live profile and
    reads back; off also withdraws the caller's pending outbound (captured update filters: asker =
    caller, `status = pending`); on does not; no profile → 403 `no_profile`.
  - `spar-requests.service.test.ts` (ask): free request passes `p_expires_at` = `sparExpiresAt`;
    event request copies the Event's zone; a `test`-kind Event → `bad_event`; a draft Event →
    `bad_event`; the asker without a `persons` row → `bad_event`; a day outside the Event → `bad_day`;
    an unknown zone → `bad_day`; each P0001 code maps to its status and `{ code }`; **the answer for a
    `not_this_time` (blocked) ask equals the answer for a `pending` ask: `{ id }`**; **the handler
    resolves while the notifier's promise is still pending** (a never-settling notifier double);
    no notice for `not_this_time`; select strings asserted.
  - `throttler-options.test.ts`: the new throttler is keyed on the account and skipped unless the
    route carries the decorator.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; register `FightBookModule`; regenerate the client.
- [ ] **Step 4: Run** the module tests, `route-authz.test.ts`, `public-routes.test.ts`,
      `db-schema-conformance.test.ts`, `module-graph.test.ts`, `pnpm quality:openapi-drift` → green.
- [ ] **Step 5: Commit** `feat(api): a fighter switches FightBook on and asks for a spar`.

### Task 7: Inbox and My spars

**Files:** Create `spar-reads.service.ts`, `spar-views.ts` (+ tests); modify the controller and the
generated client.

**Interfaces — Produces:**

```ts
// spar-views.ts (pure). SparRow = the spar_requests columns the reads select, declared here.
/** The status every reader sees: a pending request past its end reads "not_this_time". */
export function effectiveSparStatus(
  row: { status: SparStatus; expires_at: string },
  now: Date,
): SparStatus;
export function toIncoming(
  row: SparRow,
  asker: SparFighter,
  eventName: string | null,
): IncomingSparRequest;
export function toSent(
  row: SparRow,
  receiver: SparFighter,
  eventName: string | null,
  now: Date,
): SentSparRequest;
export function toAgreed(
  row: SparRow,
  me: string,
  partner: SparFighter,
  eventName: string | null,
): AgreedSpar;
```

Routes (`requireFightBookOn`): `GET inbox` → `IncomingSparRequest[]` (receiver = me, `pending`,
`expires_at > now`, day then time ascending); `GET spars` → `MySpars` (Decision 12; `withdrawn` rows
not listed). Card fighters in one `global_persons` read (`id, given_name, family_name, photo_url`);
Event names in one `events` read (`id, name`).

- [ ] **Step 1: Failing tests.**
  - `spar-views.test.ts`: `toSent` over a decline without comment, a block-ended row, a swept expiry
    and an unswept expiry (`pending`, `expires_at` past) gives byte-identical JSON apart from `id`;
    a shared comment appears; `toAgreed` sets `cancelledByMe` from `cancelled_by` and the caller's
    side; a row whose Event was deleted gives `eventName: null`.
  - `spar-reads.service.test.ts`: **the same four rows through `mySpars()` give byte-identical
    `sent` entries apart from `id`** (end to end over the service); the Inbox query filters
    receiver, `status = pending`, `expires_at > now` (captured calls); select strings asserted for
    `spar_requests`, `global_persons`, `events`; FightBook off → 403 `fightbook_off`.
- [ ] **Step 2-4:** red, implement (regenerate the client), green.
- [ ] **Step 5: Commit** `feat(api): the Inbox and My spars`.

### Task 8: Answer, withdraw, cancel

**Files:** Modify `spar-requests.service.ts`, the controller (+ tests), the generated client.

**Interfaces — Produces:**

- `POST requests/:id/answer { answer: 'yes' | 'no', comment?: string(1-500), showComment?: boolean }`
  → `{ status }` via `fightbook_answer` (`requireFightBookOn`); `not_open` → 409, `bad_answer` → 400.
  `yes` → `void notifySparAgreed(…)`.
- `POST requests/:id/withdraw` → 204. One update: `status = 'withdrawn'` where `id`, asker = me,
  `status = 'pending'`, `expires_at > now` (a past-end request is already a "no": withdrawing it
  would show the asker it ran out and free them from the no-re-ask rule); zero rows → 409 `not_open`.
- `POST requests/:id/cancel { message?: string(1-500) }` → 204. Read `id, asker_global_person_id,
receiver_global_person_id, status`; the caller must be one side, else 404 (never 403, which would
  confirm the request exists); one update to `cancelled` with `cancelled_by` = the caller's side,
  `eq('status','agreed')` and `eq(<side column>, me)`; zero rows → 409 `not_open`. Then
  `void notifySparCancelled(…)` to the other side.

- [ ] **Step 1: Failing tests:** answer maps `not_open` → 409 and `bad_answer` → 400 and passes the
      five arguments with `p_receiver` = the caller's profile (never a body value); a stranger's answer
      gets 409 `not_open` from the function (the receiver condition) and nothing changes; the private
      comment goes with `p_comment_shared: false`; withdraw's update carries `status = pending` and
      `expires_at > now` (captured filters); cancel by a stranger → 404; a lost race (zero rows) → 409;
      notices start only after a won update.
- [ ] **Step 2-4:** red, implement, green.
- [ ] **Step 5: Commit** `feat(api): answer, withdraw and cancel a spar`.

### Task 9: Block and unblock

**Files:** Create `fightbook-blocks.service.ts` (+ test); modify the controller and the client.

**Interfaces — Produces:** `GET blocks` → `FightBookBlock[]`; `POST blocks { globalPersonId }` → 204
via `fightbook_block` (`self` → 400; `P0002` → 404); `DELETE blocks/:globalPersonId` → 204 (delete
where blocker = me and blocked = id; idempotent). Needs a live profile (`requireProfile`), not the
switch: a fighter who turned FightBook off still manages blocks.

- [ ] **Step 1: Failing tests:** the RPC gets `p_blocker` = the caller's profile, never a body value;
      unblock deletes only the caller's row (captured filters); the list's select string; **a blocked
      asker's ask answers exactly what an unblocked ask answers and queues no notice** (service level).
- [ ] **Step 2-4:** red, implement, green.
- [ ] **Step 5: Commit** `feat(api): block and unblock a fighter in FightBook`.

### Task 10: Unanswered requests end every hour

**Files:** Create `apps/api/src/workers/spar-request-expiry.worker.ts` (+ test); modify `workers.module.ts`.

**Interfaces — Produces:** `SparRequestExpiryWorker.sweep(now = new Date()): Promise<number>` — one
update `status = 'not_this_time'` where `status = 'pending'` and `expires_at <= now`, returning the
count; job scheduler `spar-request-expiry-hourly`, pattern `35 * * * *` (the event-status ticker's
`upsertJobScheduler` shape). A failed write is logged as a warning, never thrown. No notice
(ruling 663).

- [ ] **Step 1-4:** failing test (the filters, the count, a failed write logs and returns 0, the
      scheduler id and pattern), implement, green with `module-graph.test.ts`.
- [ ] **Step 5: Commit** `feat(api): an unanswered spar request ends at the end of its day`.

### Task 11: The docs

- [ ] ARCHITECTURE: a short "FightBook" section (tables, who reads what, the four "no" paths and
      what each still lets a fighter guess — an instant "no", and a blocked asker never meeting
      `already_asked`, both accepted under ruling 660; the races and their one-call answers;
      merge/erasure/anonymise/export/archive rules; rulings 642-665) and three §11ter.2 rows
      (`immediate`, `yes`). `pnpm quality:docs-drift` green.
- [ ] **Commit** `docs: FightBook slice 1`.

### Task 12: The menu entry and its glyph

**Files:** `packages/ui/src/components/NavIcon.tsx` (`fightBook` in the "Personal space" group of
`NAV_ICON_NAMES`; `fightBook: 'handshake'` in `NAV_ICON_GLYPHS`), generated `nav-icon-glyphs.ts`,
`apps/web-public/src/components/PublicPersonalShell.tsx` (entry
`{ href: '/me/fightbook', labelKey: 'publicApp.personalShell.nav.fightBook', icon: 'fightBook' }`
after People), i18n `nav.fightBook` "FightBook" in both languages, complexity baseline re-point
(`PublicPersonalShell.tsx:41` moves).

- [ ] **Step 1:** `node packages/ui/scripts/generate-nav-icons.mjs`; `nav-icon-glyphs.test.ts`,
      `nav-icon.test.ts` green; rebuild `@myclash/ui`.
- [ ] **Step 2:** Add the entry; `BottomNav` stays untouched (ruling 654).
- [ ] **Step 3: Commit** `feat(web-public): a FightBook entry in the personal-space menu` (the
      glyph rides in this commit: it has no other user).

### Task 13: The FightBook page: switch, no-profile path, settings panel

**Files:** Create `app/me/fightbook/page.tsx` (server wrapper, `titled('publicApp.titles.meFightBook')`),
`FightBookClient.tsx`, `FightBookSettingsPanel.tsx`, `use-fightbook.ts`,
`src/lib/fightbook/read-fightbook.ts`, `src/lib/fightbook/refusal.ts` (+ tests); i18n
`publicApp.fightBook.*`, `publicApp.titles.meFightBook`.

**Interfaces — Produces:**

- `readFightBookSettings(apiUrl, signal)`, `readInbox`, `readMySpars`, `readBlocks` — each wraps
  `apiRequest` and checks the body shape (the `src/lib/photos/my-photos.ts` pattern).
- `sparRefusalKey(code: string | null): KnownTranslationKey` — a `Record<SparRefusalCode,
KnownTranslationKey>` of whole literal keys (`publicApp.fightBook.refusal.<code>`, so the i18n
  reverse sweep sees each), anything else to `publicApp.fightBook.refusal.unknown`.
- `useFightBook()` — settings, inbox, spars and their retry.

States, in order: loading (`Spinner`), read failed (`ReadFailed` with retry), 401 →
`signInAgainHere()`, `hasProfile: false` → a panel saying FightBook needs a fighter profile with a
`Button asChild` link to `/me` (the claim path), `enabled: false` → what FightBook is (three
sentences) and the switch, else the tabs (Task 14) and the settings panel. Settings panel: the
switch (`SettingRow` + `Switch`, optimistic, rolled back on failure with a `role="alert"` line) and
the blocked list (name + Unblock button, `EmptyState` when empty). Layout: `<main className="px-4
py-6 sm:px-6 lg:px-8"><div className="mx-auto flex max-w-2xl flex-col gap-6">`, one H1.

- [ ] **Step 1: Failing tests** (jsdom, `createRoot` + `act`, `apiRequest` mocked, `<I18nProvider
locale="en">`): no profile shows the link to `/me`; off shows the switch and no tabs; turning on
      PATCHes `{ enabled: true }` and shows the tabs; a failed PATCH puts the switch back and shows the
      alert; unblock DELETEs and removes the row; `sparRefusalKey` covers every code (iterate
      `SPAR_REFUSAL_CODES`).
- [ ] **Step 2-4:** red, implement, green; `pnpm --filter @myclash/web-public lint`.
- [ ] **Step 5: Commit** `feat(web-public): the FightBook page, its switch and its settings`.

### Task 14: The Inbox and My spars tabs

**Files:** Create `InboxTab.tsx`, `MySparsTab.tsx`, `SparCard.tsx` (+ tests); i18n.

Tabs: `SegmentedTabs` with `inbox` (label carries the count when > 0) and `spars`; the tab lives in
`?tab=` (`router.replace`, the People hub pattern), default `inbox`.

- **Inbox card:** photo (`Avatar`), name, weapons, the day and time as stored (wall clock of the
  Event or of the asker; no conversion), the Event name or the place, message; buttons Yes
  (primary), Not this time (secondary, opens a `Modal` with an optional comment and a "Let them see
  my comment" checkbox, unticked), Block (`useConfirm`, danger). A won answer removes the card from
  the POST's answer (no re-read flash); a `not_open` refusal removes the card and shows "This
  request is no longer open".
- **My spars:** agreed spars grouped by day (a heading per day), each with Cancel (`PromptDialog`,
  optional message); cancelled ones show "Spar cancelled" and the message; then "Requests you sent":
  pending with Withdraw, "Not this time" with the shared comment when there is one.
- `EmptyState` for an empty Inbox and an empty My spars.

- [ ] **Step 1: Failing tests:** Inbox renders a card's fields from a stubbed answer; Yes POSTs
      `{ answer: 'yes' }` and removes the card; Not this time sends `{ answer: 'no', comment,
showComment: false }` by default; `not_open` removes the card and shows the line; Block confirms
      then POSTs the asker's id; My spars groups two spars on one day under one heading; a cancelled
      spar shows its message; a sent "Not this time" renders the same with and without the
      `comment: null` field; the tab follows `?tab=spars`.
- [ ] **Step 2-4:** red, implement, green; lint; i18n sweep direct.
- [ ] **Step 5: Commit** `feat(web-public): the Inbox and My spars tabs`.

### Task 15: The notice switch in settings

**Files:** `apps/web-public/app/me/settings/NotificationPreferences.tsx` (`Prefs.fightbook`, a
`SettingRow` after the Swiss one, disabled while the main switch is off), i18n
`publicApp.meSettings.notif.fightbook` + `fightbookDescription` ("New spar requests, a yes to your
request, and cancelled spars."), its test.

- [ ] **Step 1-4:** failing test (the row PATCHes `{ fightbook: false }`), implement, green.
- [ ] **Step 5: Commit** `feat(web-public): a FightBook switch in notification settings`.

### Task 16: Falsify, gates, review, push

- [ ] **Falsify each guarantee by hand** (Edit the guard out, prove the break landed with `git diff
-U0 | grep -c`, run the test, see red, compare the collected count, restore, see green):
  1. the four "no" paths' payload (`toSent` leaks `expires_at` or the raw status);
  2. a blocked ask's answer (return the RPC's status in the 201);
  3. the ask awaits the notice (await it: the never-settling test goes red);
  4. no notice for a blocked ask (drop the `pending` condition);
  5. the private comment (write it to `shared_comment` regardless: probe red);
  6. a block ends the blocker's own request as `withdrawn` (end it as `not_this_time`: probe red);
  7. withdraw after the end (drop `expires_at > now`: test red);
  8. a block aimed at the subject absent from their export (add the reach);
  9. the merge moves a block (drop the block move: merge probe red);
  10. erasure deletes each FightBook row (drop one delete), anonymise keeps them (call it there);
  11. answer after withdraw / after expiry (drop `status = 'pending'` / `expires_at > now()`: probe red);
  12. no re-asking (drop the 7-day clause: probe red);
  13. a hidden Event refused (drop the `isPublicEvent` check: test red).
- [ ] **Gates:** re-point the complexity baseline, run `gates.sh` (now 33 gates) from this session's
      scratchpad copy; `baseline-audit.mjs` prints `per-file changes: 0`.
- [ ] **Cold review:** `code-architecture-reviewer` over the slice; fold each finding as its own
      commit.
- [ ] **Push** after `git fetch`; `watch-ci.sh <sha>`; memory note `project_fightbook_slice1_*.md`
      and the MEMORY.md line; handoff and prompt rewritten.
