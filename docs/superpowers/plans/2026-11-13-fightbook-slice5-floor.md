# FightBook slice 5 (Floor tools) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** At a running Event, a FightBook fighter can say "Free to spar now" for an hour, post an
open call ("Longsword at 15:00") that others at the Event answer "I'm in" and the poster picks
from, and two fighters who agreed face to face can log the spar by scanning one's FightBook QR —
at an Event or anywhere — with the shower confirming it.

**Architecture:** Migration 0270 adds four deny-all tables — `fightbook_free_now`,
`spar_open_calls`, `spar_open_call_answers`, `fightbook_qr_codes` — and two SQL functions under the
pair lock of 0264: `fightbook_call_pick` writes an AGREED spar; `fightbook_qr_log` writes a PENDING
request the shower answers in her Inbox through the existing `fightbook_answer` (ruling 713), so a
block looks exactly like a "no". `fightbook_block` is re-defined to take back the blocker's "I'm
in" answers. The API adds `me/fightbook` routes, two notice kinds, a switch-off cleanup and an
hourly sweep of the short-lived rows. web-public's Find tab gains the switch, the badge, an
open-call section and a QR panel. The camera scanner moves from web-staff into a `@myclash/ui/scan`
subpath so both apps use one copy.

**Tech Stack:** Postgres 17 (plpgsql), NestJS + Zod DTOs, Next 16 / React 19, `@myclash/ui`,
`@myclash/i18n`, `qrcode.react` (already a web-public dependency), `jsqr` (moves to `@myclash/ui`),
Vitest, the replay probes (`scripts/`).

**Spec:** `docs/superpowers/specs/2026-11-10-fightbook-design.md` ("Finding a partner": Free to
spar now, Open call, Log by QR scan; "Answering": Block), `docs/ARCHITECTURE.md` §11septies, the
slice 4 plan in this folder. Rulings (2026-11-13, `C:\Users\Tony\.claude\plans\fightbook-handoff.md`):

- **705** All three tools in one plan and one build.
- **706** A blocked fighter **sees** the blocker's open calls and may answer "I'm in"; the poster
  never sees that answer; he gets "Not this time" when the call closes or another is picked (ruling
  672's rule). The poster's own lists hide the calls of fighters she blocked.
- **707** + **713** A QR scan sends the shower a spar request (Yes / Not this time); the spar is
  **agreed on her Yes**. "We sparred" afterwards as usual.
- **714** A **blocked** scan never reaches the shower (hidden from her Inbox, no notice) and waits
  as "sent" until its day ends, then reads "Not this time" — exactly a request she ignored. Asks
  keep their instant face (ruling 660).
- **708** The "free now" badge shows **only in Find's Event block**; the people page shows none.
- **709** The QR works **anywhere**: at an Event day both are on, the spar is that Event's, today;
  elsewhere the scanner types a place and it is a free-date spar today in the phone's zone.
- **710** **Several open calls at once** per fighter (the cap is Decision 6).
- **711** A QR code lasts **5 minutes** and works for **one scan**; the screen renews it.
- **712** Others see **just the call**: no names, no count. Only the poster sees who answered.

## In plain words

**Free to spar now.** Saturday, Hugo is at the Event and has nothing until 16:00. In Find, under
the Event, he switches "Free to spar now" on. For the next hour (or until the Event day ends, or he
switches it off), Léa — also at the Event, FightBook on — sees "Free now" on Hugo's card, and free
fighters come first. Nobody outside the Event sees it; the people page shows nothing.

**Open call.** Léa posts "Looking for a longsword spar at 15:00". Everyone at the Event with
FightBook on sees the call in Find with an "I'm in" button — no names, no count. Paul and Hugo tap
"I'm in"; Léa gets one notice and sees both names under her call. She picks Paul: the spar is
agreed and in both books, Paul gets a notice, and Hugo's call card says "Not this time". At 15:00
an unpicked call closes and every "I'm in" on it reads "Not this time". Léa can close a call early;
Paul can take his "I'm in" back. Léa may have up to 5 calls open on one Event day.

**QR log.** Julie and Marc agree by the ring. Marc taps "Scan a FightBook QR", picks Longsword and
the place — the Event they are both at today, or a place he types — then points his camera at
Julie's "My FightBook QR". Julie's phone buzzes "New spar request"; in her Inbox she taps Yes and
the spar is agreed in both books. A code works once and for 5 minutes; Julie's screen
shows a fresh one before it runs out, and the old one keeps working until its own 5 minutes end.

**Block.** Julie blocked Marc. Marc still sees her open calls and may answer; Julie never sees his
answer, and he gets "Not this time" like anyone not picked. Julie does not see Marc's calls. If
Marc scans Julie's QR, nothing reaches Julie; Marc's request says "sent" until the day ends, then
"Not this time" — exactly what he would see if she had ignored it. If Marc blocks Julie after answering her call, his answer is
taken back. A fighter who switches FightBook off disappears from every list at once.

## Global Constraints

- One migration: **0270** (max + 1 at commit time; renumber if another session lands one first).
  Pushed migrations are never edited: 0263-0269 stay. `fightbook_block` and `fightbook_answer` are
  re-defined in 0270 with `CREATE OR REPLACE` (0264's bodies plus Decisions 9 and 12b).
- New tables: RLS on, no policy (deny-all, 0247 pattern); **every table has an `id uuid` PK**
  (erasure reads back `.select('id')`, `erasure-fightbook.ts:86-90`); every CHECK a
  `CASE … ELSE false END`. SQL functions: SECURITY INVOKER, `search_path` pinned, revoked from
  `public`/`anon`/`authenticated`, granted to `service_role` (0264's shape), and take the 0264 pair
  lock before they read.
- Every user-facing string in `en` and `fr`; notice wording in the `notices` keys read by
  `bilingual()` in `notifications/notice-texts/notice-texts.ts`, **no names** (locked phone).
- Every route acts on the caller's own profile (`fightBookCaller`). Writes that ADD presence
  (switch on, post, answer, mint, scan) use `requireFightBookOn`; writes that REMOVE it (switch off,
  close, take back) use `requireProfile`, so an off fighter can always withdraw. A stranger's call
  id answers 404, never 403.
- **Ruling 672 holds everywhere:** no answer a fighter receives — payload, status code or timing —
  differs because someone else blocked them. Reads filter only the blocks the caller made
  (`blockedBy`); the other direction is decided inside SQL with the face an ask already has.
- Presence is private: free-now, calls and answers are read only by fighters with FightBook on and
  a `persons` row at that public Event (the `atEvent` gate); listed fighters pass
  `applyFightBookOn` (live, claimed, FightBook on). Nothing of slice 5 enters a public payload or
  the people-page read.
- Archived-lock ledger (`common/event-readonly/archived-lock.routes.test.ts`): routes placed by
  `:eventId` (`PUT`/`DELETE …/events/:eventId/free`, `POST …/events/:eventId/calls`) are NOT filed;
  raise the placed-route pin `toHaveLength(198)` to **201** with a comment naming this plan. File
  the unplaced writes (`calls/:id…`, `qr`, `qr/scan`). `route-authz.test.ts` stays green with no new
  ledger line. OpenAPI client regenerated in each API commit that adds a route.
- Every new DB read asserts its select string AND its owner filter with a fixture row the filter
  must exclude; every `.rpc()` payload's keys equal `lastFunctionParams(name)`. Every list says what
  bounds it (Decision 6, `AT_EVENT_MAX` — export it).
- Files ≤ 400 lines, functions ≤ 50, test files included (`quality:complexity` after prettier).
  `spar-find.service.ts` is 312 lines, `fightbook.controller.ts` 295, `subject-export.tables.ts`
  394 (not baselined): new routes in a new controller, new reads in new services, and the FightBook
  export entries move to `subject-export.fightbook.ts` before any is added.
- **Hard rule 3:** Task 7 touches web-staff (the scoring app). Its offline E2E specs
  (`tests/e2e/06-offline-sync*`, `tests/e2e/40-offline-bout*`) must pass before Task 7 commits and
  again in Task 11.
- Tokenized UI only; no raw ids in UI; no real names in fixtures; **no fixture constant named
  _API_/_KEY_/_TOKEN_/_SECRET_ over a uuid or hash** (CI's gitleaks `generic-api-key` rule). Web API
  paths written whole (the route-contract test reads literals).
- Commit subjects start lower-case. Messages via a file and `git commit -F`; `git fetch` +
  `git log --oneline -1` + `git status --short` before staging; explicit paths.

## Decisions taken in this plan (the builder's calls the design and rulings left open)

1. **`fightbook_free_now`** — `id uuid PK`; `global_person_id` UNIQUE → `global_persons` ON
   DELETE CASCADE (one Event at a time: one venue); `event_id NOT NULL` → `events` ON DELETE
   CASCADE; `until timestamptz NOT NULL`; `created_at`. A separate table, never columns on
   `global_persons`: presence must not ride on a profile row other reads select.
2. **Switch on** = upsert on `global_person_id` with `{event_id, until}`, where `until = min(now +
1 h, sparExpiresAt('event', today, eventZone))` — the end of the Event day `openEventDays` names
   as `today`. Mid-Event at 05:30, `today` is already the new day, so `until` = 06:30; on the
   morning after the LAST day, `today` is the last day and `until` = 06:00. Allowed only when the
   Event is public, the caller is on its roster and `today` is not null; else 400 `bad_event`.
   **Off** = delete. Every read requires `until > now()`; the hourly worker deletes expired rows.
3. **The badge**: `atEvent` returns `EventFindCard = FindCard & { freeNow: boolean }`, free-now
   fighters first, then `byName`, at most `AT_EVENT_MAX`; one read of `fightbook_free_now` for the
   listed ids, `event_id = eventId`, `until > now`. The caller's own state rides on
   `me/fightbook/events`: `FightBookEvent.freeUntil: string | null`.
4. **`spar_open_calls`** — `id uuid PK`; `poster_global_person_id` → `global_persons` ON DELETE
   CASCADE; `event_id NOT NULL` → `events` ON DELETE CASCADE; `spar_day date`, `zone text`,
   `spar_time time` (all NOT NULL: a call names its time, it closes then); `weapons text[] NOT NULL`
   (1-5 catalog names, as a request stores them); `status text NOT NULL` (`open`|`picked`|`closed`);
   `picked_global_person_id` → `global_persons` ON DELETE CASCADE (a deleted picked profile takes
   the call with it); `spar_request_id` → `spar_requests` ON DELETE SET NULL; `closes_at
timestamptz NOT NULL`; `created_at`. CHECK `spar_open_calls_status_shape`: `open`/`closed` ⇒
   both pick columns NULL; `picked` ⇒ `picked_global_person_id` NOT NULL. No message.
5. **A call is for today only**, at a time later than now and before the Event day ends:
   `closes_at` = `spar_day` + `spar_time` on the Event clock; else 400 `bad_time`. OPEN = `status =
'open' AND closes_at > now()`; nothing flips it at `closes_at` — every read and the pick use that
   predicate (`callIsOpen` in `open-call-views.ts` is its TS owner; the same clause in SQL).
6. **Caps** (ruling 710): at most **5** OPEN calls per poster per Event day (400 `too_many_calls`);
   an Event's `others` list shows at most **100**, soonest first; a call's answers at most **50**,
   oldest first. The write side is bounded by 5 × the roster, and answers by the roster.
7. **`spar_open_call_answers`** — `id uuid PK`; `call_id` → `spar_open_calls` ON DELETE CASCADE;
   `answerer_global_person_id` → `global_persons` ON DELETE CASCADE; `created_at`; UNIQUE
   `(call_id, answerer_global_person_id)`. "I'm in" = insert `ON CONFLICT DO NOTHING` (two taps,
   one answer); "Take back" = delete. Both only while the call is OPEN, only by a fighter on that
   Event's roster, never on one's own call (400 `self`); a call whose poster the caller blocked
   answers 404 (the caller cannot see it).
8. **What each fighter sees** (`GET me/fightbook/events/:eventId/calls`, the `atEvent` gate):
   - `mine`: the caller's calls of today (open, picked or closed), each with `answers` =
     answerers as `SparFighter`, through `applyFightBookOn`, **minus the fighters the caller
     blocked** (ruling 706), oldest first, at most 50.
   - `others`: other posters' OPEN calls whose poster passes `applyFightBookOn`, minus posters the
     caller blocked, plus every call of today the caller answered whatever its state. Each carries
     `myAnswer`: `'none' | 'in' | 'picked' | 'not_this_time'` — `picked` when
     `picked_global_person_id` is the caller, `not_this_time` when the caller answered and the call
     is picked by another or no longer open. No count, no answerer names (ruling 712).
   - A poster entered only in a Tournament hidden from the reader still shows: posting to the
     Event is the poster's own choice to be seen there.
9. **Block** (`fightbook_block`, re-defined): besides 0264's work it deletes the blocker's answers
   on the blocked fighter's calls (the blocker withdrew, as a block withdraws the blocker's own
   pending requests). The blocked fighter's answers on the blocker's calls stay, filtered by her
   read; if she unblocks, they show again.
10. **`fightbook_call_pick(p_call uuid, p_poster uuid, p_answerer uuid, p_expires_at timestamptz)
→ uuid`** (the spar's id): pair lock on (poster, answerer); `SELECT … FOR SHARE` on the answer
    row (a take-back waits or loses); the 0264 liveness predicate on both and **no block either
    way**, else `not_open`. Then ONE conditional `UPDATE spar_open_calls SET status = 'picked', …
WHERE id = p_call AND poster = p_poster AND status = 'open' AND closes_at > now()`; zero rows
    → `raise 'not_open'` — this UPDATE is the only gate on the call's state (no pre-check that
    could pass a second pick on its own). Then inserts the spar `agreed`, `agreed_at = now()`,
    asker = poster, receiver = answerer, kind `event`, the call's event, day, zone, time, weapons,
    `expires_at = p_expires_at`, and stores its id on the call. Skips the no-re-ask rule and the
    throttle (the poster chose).
11. **`fightbook_qr_codes`** — `id uuid PK`; `token_hash text` UNIQUE (sha256 hex of the raw token
    WITHOUT the `fb:` prefix: `hashPassToken(code.slice(3))`); `global_person_id` →
    `global_persons` ON DELETE CASCADE; `expires_at timestamptz NOT NULL`; `created_at`. **Mint**
    (`POST me/fightbook/qr`) deletes every code of the caller except the newest live one, then
    inserts one with `expires_at = now + 5 min`, and answers `{ code: 'fb:' + mintPassToken(),
expiresAt }`: the previous code stays valid until its own expiry (a scan begun on it still
    works), and at most 2 live codes exist (two tabs minting in the same instant can leave 3 for a
    few minutes; accepted). The mint route gets its OWN throttle, `FIGHTBOOK_QR_MINT_THROTTLE` =
    60 per hour per account (a new profile in `throttle-profiles.ts`, its decorator and its
    `throttler-options.ts` entry, as the ask throttle is registered): a screen re-minting every
    4.5 min uses ~13 an hour, and the panel reuses the code it already holds while more than 30 s
    remain, so opening and closing it does not mint. The web
    re-mints when less than 30 s remain by the SERVER's clock (it keeps `expiresAt − answeredAt` as
    a duration, never the phone's wall clock). The desk's `looksLikePassToken` already refuses a
    `fb:` code (`TOKEN_SHAPE` has no `:`).
12. **`fightbook_qr_log(p_token_hash text, p_scanner uuid, p_kind text, p_event_id uuid,
p_spar_day date, p_zone text, p_place text, p_weapons text[], p_expires_at timestamptz)
→ jsonb {id, notify}`** — the face of an ask (rulings 713, 714):
    `DELETE FROM fightbook_qr_codes WHERE token_hash = p AND expires_at > now() RETURNING
global_person_id` (of two scans at once, one finds the row; none → `bad_code`); `self`; the pair
    lock; 0264's checks in 0264's order (`fightbook_off`, `not_on_fightbook`, `you_blocked`); for
    kind `event`, `bad_event` unless the SHOWER has a `persons` row at `p_event_id`; then 0264's
    lines 96-107 verbatim: end the pair's pending scanner→shower requests past `expires_at` (the
    hourly job may not have run yet — without this step the insert trips
    `spar_requests_one_pending_uk` as a 23505 and the API answers 5xx), then `already_asked` for one
    still open. Inserts asker = scanner, receiver = shower, status **`pending` always** (ruling
    714: never `not_this_time`, even when the shower blocked the scanner), skipping only the ask's
    no-re-ask rule (she is showing her code). Returns `{id, notify}`, `notify` = the shower did
    NOT block the scanner. Every `raise` aborts the statement, so a refused scan leaves the code
    usable — except `bad_code` itself. The request expires at the end of its day (`sparExpiresAt`)
    and the hourly job ends it `not_this_time`, as any unanswered ask.
    12b. **Hidden from the blocker** (ruling 714): `SparReadsService.inbox` leaves out requests whose
    asker the caller blocked INSIDE the query, before `.limit(LIST_CAP)` (`.not('asker_global_person_id',
'in', …)` over `blockedBy`, as `browse` does at `spar-find.service.ts:187`; the caller's own
    blocks, so ruling 672 holds), and 0270
    re-defines `fightbook_answer` (`CREATE OR REPLACE`, 0264's body) to refuse `not_open` when the
    receiver blocked the asker, so no stray id can agree a spar with a blocked fighter. If she
    unblocks during the day, the request appears in her Inbox, as a blocked open-call answer does.
13. **The API side of a scan** returns `{ id }` only (as `ask` does, `spar-requests.service.ts:113`)
    and starts — not awaits — `notifySparRequestReceived` when `notify` is true, so a blocked scan
    answers byte-identically and as fast. The camera STOPS after the first submit (the hook re-emits
    a payload every 4 s, `camera.ts:107`, which would resend a refused code into the throttle); a
    refusal shows its sentence and a "Scan again" button. The form is filled BEFORE the camera opens
    (weapons, then "this Event" among the caller's Events with `today`, or "Somewhere else" with a
    place and the phone zone); the first `fb:` payload the camera reads submits at once. The API checks
    weapons (`catalogWeapons`), the Event (public, scanner on its roster, `today` open), place and
    zone (`onFreeDate`'s rules) BEFORE the rpc, so those refusals burn nothing. `catalogWeapons`
    and `onFreeDate` are private in `spar-requests.service.ts:225,234`: extract both to
    `spar-ask-rules.ts` as exported functions, one owner for ask, call and scan. The route carries
    `@ThrottleFightBookAsk()`: 20 per hour per account, counted per handler (Nest keys the
    throttler by class and handler), so scans have their own 20, apart from asks.
14. **Refusal words**: add `too_many_calls`, `bad_time`, `bad_code` to `SparRefusalCode`;
    `databaseRefusal` maps `bad_code` and `bad_event` to **400** (today an unknown word becomes 403:
    the status must not tell which side refused). `not_open` stays 409 on the pick, as on
    `fightbook_answer`; an answer on a call that is no longer open answers 409 `not_open` too.
15. **Notices** (two new kinds, preference `fightbook`, not in `PASSES_MAIN_SWITCH`):
    `spar_call_answered` to the poster ("Someone is in for your open call"): its job id is (kind,
    call, poster), so **one notice per call** — later answers do not buzz again (accepted); it is
    not sent when the poster blocked the answerer, and that block read runs INSIDE the started,
    un-awaited send. `spar_call_picked` to the picked fighter ("You were picked: the spar is in My
    spars"). No notice to the fighters not picked. A scan reuses `spar_request_received`. Register
    each kind in the `NotificationKind` union (`notification-scheduler.worker.ts`), `spar-notices.ts`,
    `CHECKS` (`alert-visibility.ts`: `null`, as the other spar kinds), `WANTED`
    (`alert-still-wanted.ts`: answered = the call is still OPEN; picked = the spar is `agreed`), and
    the kind lists pinned by `notification-job-id.test.ts` and `notification-switched-off.test.ts`.
16. **Switching FightBook off** (`fightbook-settings.service.ts`, beside its withdraw step) also
    deletes the fighter's free-now row, QR codes and answers, and closes their OPEN calls — and the
    reads filter through `applyFightBookOn` anyway (Decision 8), so a half-failed switch-off still
    hides them.
17. **The hourly sweep** (`spar-request-expiry.worker.ts`) also deletes free-now rows past `until`,
    QR codes past `expires_at`, and calls whose `closes_at` is more than 24 h past (answers by
    cascade; the spar a pick made stays). No retention setting: presence is kept only while needed.
18. **Privacy registries**: subject export (in the new `subject-export.fightbook.ts`) —
    `fightbook_free_now` (by `global_person_id`), `spar_open_calls` (by poster),
    `spar_open_call_answers` (by answerer only: a poster's download never names who answered);
    excluded — `fightbook_qr_codes` (token hashes, minutes long). Erasure `FIGHTBOOK_ROWS` — answers
    by answerer, calls by `picked_global_person_id` and by poster, free-now, QR codes, all before
    `spar_requests` (assert the `.select('id')` string in its test). Archive
    `ARCHIVE_EXCLUDED_TABLES` — `fightbook_free_now`, `spar_open_calls`. Merge: **none carried** —
    each row lives an hour to a day, and every read requires a live profile through
    `applyFightBookOn` (Decision 8), so a merged-away profile's rows show nowhere; written in
    §11septies.9 as a decision.
19. **The scanner** moves from `apps/web-staff/src/lib/scan/` (`camera.ts`, `decoder.ts`,
    `useCameraScanner.ts`, `camera.test.ts`) to `packages/ui/src/scan/` behind a new `"./scan"`
    export of `@myclash/ui` (the `@myclash/rules` subpath pattern); `jsqr` moves to `@myclash/ui`'s
    dependencies; the root barrel does NOT re-export it. `@myclash/ui` compiles as Node16 CommonJS:
    there `jsQR` from `import('jsqr')` types as a namespace with no call signature (TS2349), while
    at runtime the module's default IS the function — so `decoder.ts` casts the import's default to
    `typeof import('jsqr').default` with a comment saying why. The camera error sentences move with
    the scanner: `cameraErrorKey` and its keys become `common.scan.*` (EN + FR), used by
    `ScanOverlay.tsx` and the web-public scan view. `scan-result.ts` (desk-specific) stays.

## Review Focus

1. **A blocked fighter's view equals anyone's** (672/706/713/714). Ruling 714's own test: the same
   scan fixture with and without Julie's block, Marc's sent list deep-equal before `expires_at`
   (`pending`) and after it (`not_this_time`). Then Marc's `others` list, `myAnswer`,
   the scan's answer, status codes and timing are what an unblocked fighter gets in the same
   situation. Tests: the same fixture with and without Julie's block, payloads deep-equal; the scan
   handler raced against a never-settling notice send (the slice-1 race shape).
2. **Two picks / two scans at once**: one spar or one request, the other `not_open` / `bad_code`.
   Proved by a committed two-connection race harness on a real database (the
   `scripts/db-cascade-probe.mjs` pattern), not by sequential probe checks.
3. **Presence leaks**: not on the roster, Event not public, no open day today, FightBook off, a
   switched-off poster or answerer — each refused or absent. One fixture per gate on the switch,
   the badge, the calls read and the answer write.
4. **Time edges**: a call at 23:59 on a day ending 06:00 next morning; a past call time; free-now
   at 05:30 mid-Event (06:30) and on the morning after the last day (06:00); an Event in
   `America/New_York` for `closes_at` and `until` (the Paris blind spot).
5. **A scan refused before the code burns**: `bad_weapon` / `bad_event` / `bad_place` never reach
   the rpc; `fightbook_off` / `not_on_fightbook` / `you_blocked` / `already_asked` leave the code
   scannable; the scan begun on the previous code works after a re-mint.

## File map

API (`apps/api/src/modules/fightbook/`): new `free-now.service.ts`, `open-calls.service.ts`,
`open-call-views.ts`, `spar-qr.service.ts`, `fightbook-floor.controller.ts`, each with its test;
modify `spar-find.service.ts` (badge, `freeUntil`, export `AT_EVENT_MAX`), `spar-ask-rules.ts`
(`catalogWeapons`, `onFreeDate`), `spar-requests.service.ts` (use them; `databaseRefusal`),
`fightbook-settings.service.ts`, `spar-notices.ts`. Notifications:
`notifications/notice-texts/notice-texts.ts`, `alert-visibility.ts`, `alert-still-wanted.ts`,
`workers/notification-scheduler.worker.ts` (kind union), `notification-job-id.test.ts`,
`notification-switched-off.test.ts`. Also `workers/spar-request-expiry.worker.ts`,
`privacy/subject-export.tables.ts` → new `subject-export.fightbook.ts` (+ excluded),
`privacy/erasure-fightbook.ts`, `exports/archive.tables.ts`,
`common/event-readonly/archived-lock.routes.test.ts` + its ledger. Types:
`packages/types/src/fightbook.ts`. DB: `packages/db/migrations/0270_fightbook_floor.sql`,
`scripts/db-fightbook-probe.mjs` (+ `EXPECTED_CHECKS`, the service-role function list), new
`scripts/db-fightbook-race-probe.mjs` + its CI step (four registrations), `scripts/rls-probe-tables.mjs`
(`VERDICTS`). UI: `packages/ui/src/scan/*`, `packages/ui/package.json`. web-staff:
`ScanOverlay.tsx`, `app/desk/page.tsx`, `package.json`. web-public (`app/me/fightbook/`):
`FindTab.tsx` (wire-up), `FindCards.tsx` (badge), new `FreeNowSwitch.tsx`, `OpenCalls.tsx`,
`PostOpenCall.tsx`, `use-open-calls.ts`, `QrPanel.tsx`, `QrScan.tsx`;
`src/lib/fightbook/read-fightbook.ts`. i18n EN + FR. Docs: ARCHITECTURE §11septies.9, the spec.

---

### Task 1: Migration 0270

**Files:** Create `packages/db/migrations/0270_fightbook_floor.sql`.

**Interfaces — Produces:** the tables of Decisions 1, 4, 7, 11; `fightbook_call_pick`,
`fightbook_qr_log` (Decisions 10, 12); `fightbook_block` and `fightbook_answer` re-defined
(Decisions 9, 12b).

- [ ] Step 1: Write it: header naming rulings 705-714; every CHECK `CASE … ELSE false END`
      (`spar_open_calls_weapons` 1-5, `spar_open_calls_status_shape`, `fightbook_qr_codes_hash` = 64
      lower-hex chars); RLS on, no policy; indexes `spar_open_calls (event_id, spar_day, status)`,
      `spar_open_calls (poster_global_person_id, spar_day)`, `fightbook_free_now (event_id)`,
      `fightbook_qr_codes (global_person_id)`; the functions with 0264's revoke/grant lines.
- [ ] Step 2: `pnpm db:review` and `pnpm db:migrations:replay` → green.
- [ ] Step 3: Commit `feat(db): the FightBook floor tools tables and functions (0270)`.

### Task 2: The probes hold every floor rule

**Files:** Modify `scripts/db-fightbook-probe.mjs` (split to `db-fightbook-probe-floor.mjs` past
400 lines), its `EXPECTED_CHECKS` and service-role function list, `scripts/rls-probe-tables.mjs`
`VERDICTS` (the four tables, deny-all); create `scripts/db-fightbook-race-probe.mjs` with its five
registrations: the pnpm script; a step in the `db-replay` job with `if: ${{ !cancelled() &&
steps.replay.outcome == 'success' }}` and the disposable-database env guard the cascade probe uses
(`ci.yml:590-601`; it commits rows); its `CI_GATES` row with `job: 'Database replay'`
(`gates.ts:88`); `CONTRIBUTING.md`; the `myclash-gates` SKILL.md chain. Update the cascade probe's
"LAST: the one probe that commits rows" comment.

- [ ] Step 1: Probe checks, each comparing the constraint NAME or the raised word:
  - pick: happy path (spar `agreed`, call `picked`, both pick columns); a second pick → `not_open`;
    after `closes_at` → `not_open`; a non-answerer → `not_open`; a block each way → `not_open`
    each; by a non-poster → `not_open`; answerer switched off → `not_open`.
  - qr: happy path (code gone, request `pending`, asker = scanner); the same code again →
    `bad_code`; expired → `bad_code`; `self`; scanner blocked shower → `you_blocked` AND the code
    still exists; shower blocked scanner → `pending` with `notify` false (ruling 714), and
    `fightbook_answer` on it by the shower WHILE IT IS STILL OPEN (so only 12b's block clause can
    refuse it) → `not_open`; kind `event` with the shower off the roster
    → `bad_event` AND the code still exists; shower switched off → `not_on_fightbook`; an OPEN
    pending scanner→shower request → `already_asked` AND the code still exists; a pending one PAST
    its `expires_at` → ended `not_this_time` and the scan lands a new `pending`.
  - block: the blocker's answer on the blocked's call is gone; the reverse answer stays.
  - CHECKs: `picked` with no picked person → `spar_open_calls_status_shape`; 6 weapons →
    `spar_open_calls_weapons`; a 10-char hash → `fightbook_qr_codes_hash`.
- [ ] Step 2: Race probe (two committed connections, its own fixture rows cleaned in `finally`),
      with a CERTAIN overlap, not repetition: connection A `BEGIN`s and calls the pick (or scan)
      without committing; connection B makes the same call and must BLOCK (assert it has not returned
      after 500 ms via `pg_stat_activity` wait state); A commits; assert B's refusal — two picks with
      two answerers → one `agreed` spar, B `not_open`; two scans of one code → one request, B
      `bad_code`.
- [ ] Step 3: On a fresh replay every check green; break each clause of each function by hand once
      (`CREATE OR REPLACE` with it removed) and watch its check go red — `fightbook_answer`'s new
      receiver→asker block clause included; drop the conditional UPDATE's `status = 'open'` and
      watch the race probe go red.
- [ ] Step 4: Commit `test(db): the FightBook probes hold the floor tools`.

### Task 3: The registries, the sweep and the switch-off

**Files:** `privacy/subject-export.tables.ts` → `subject-export.fightbook.ts` (move the FightBook
entries first, no behaviour change), `subject-export.excluded.ts`, `privacy/erasure-fightbook.ts`,
`exports/archive.tables.ts`, `workers/spar-request-expiry.worker.ts`,
`fightbook-settings.service.ts`, their tests.

- [ ] Step 1: Failing tests: the coverage tests name the four tables (red on the migration alone —
      run them first); erasure deletes all six rows of Decision 18 with `.select('id')` asserted;
      `sweep(now)` deletes a free-now row with `until < now`, a code with `expires_at < now`, a call
      with `closes_at < now − 24h`, keeps one at `now − 23h` (`filtersFor` on each); switching off
      deletes free-now, codes and answers and closes open calls, each write scoped to the caller.
- [ ] Step 2: Implement per Decisions 16-18.
- [ ] Step 3: Green; commit `feat(privacy): the FightBook floor tables in every registry`.

### Task 4: Free to spar now (API)

**Files:** Create `free-now.service.ts` (+ test), `fightbook-floor.controller.ts` (+ test). Modify
`spar-find.service.ts`, `packages/types/src/fightbook.ts`, `archived-lock.routes.test.ts` (pin
201).

**Interfaces — Produces:** `PUT me/fightbook/events/:eventId/free` → `{ until: string }`;
`DELETE me/fightbook/events/:eventId/free` → 204; `FreeNowService.switchOn(me, eventId, now)`,
`switchOff(me, eventId)`, `freeAt(db, eventId, ids, now): Promise<Set<string>>`;
`EventFindCard`; `FightBookEvent.freeUntil`.

- [ ] Step 1: Failing tests: `until` = now + 1 h; mid-Event at 05:30 → 06:30 and on the morning
      after the last day → 06:00, for an Event in `America/New_York`; `bad_event` for not on roster /
      not public / no open day; `atEvent` puts a free fighter first with `freeNow`, ignores a row of
      ANOTHER Event and a row past `until` (fixture rows the filters must exclude); `myEvents` carries
      `freeUntil`, null for a past one. Select strings and filters asserted.
- [ ] Step 2: Implement; `fightBookCaller` + `requireFightBookOn` (PUT) / `requireProfile`
      (DELETE); uuid pipes on `:eventId`.
- [ ] Step 3: `pnpm openapi:client`; green; commit `feat(fightbook): free to spar now`.

### Task 5: Open calls (API)

**Files:** Create `open-calls.service.ts`, `open-call-views.ts` (+ tests); modify
`fightbook-floor.controller.ts`, `spar-ask-rules.ts` (extract `catalogWeapons`, `onFreeDate`),
`spar-requests.service.ts` (use them; `databaseRefusal`), types, the notice files of Decision 15.

**Interfaces — Produces:** `GET me/fightbook/events/:eventId/calls` → `OpenCallsAtEvent { mine:
MyOpenCall[]; others: OpenCallView[] }`, `OpenCallView { id; poster: SparFighter; weapons:
string[]; time: string; open: boolean; myAnswer: 'none' | 'in' | 'picked' | 'not_this_time' }`,
`MyOpenCall { id; weapons; time; state: 'open' | 'picked' | 'closed'; picked: SparFighter | null;
answers: SparFighter[] }`; `POST me/fightbook/events/:eventId/calls` `{ weapons: string[]; time:
'HH:MM' }` → `{ id }`; `DELETE me/fightbook/calls/:id` → 204; `PUT` / `DELETE
me/fightbook/calls/:id/answer` → 204; `POST me/fightbook/calls/:id/pick` `{ globalPersonId }` →
`{ requestId }`; `catalogWeapons(db, names)`, `onFreeDate(input)` exported from `spar-ask-rules.ts`.

- [ ] Step 1: Failing tests:
  - post: `bad_weapon`; `bad_time` for a past time and one after the day ends; the 6th OPEN call
    of the day → `too_many_calls` while a closed one does not count; `bad_event` per Decision 2.
  - read: Decision 8 field by field; a poster the caller blocked is absent from `others`; an
    answerer the caller blocked is absent from `mine.answers`; a switched-off poster and answerer
    are absent; **the fixture with Julie blocking Marc, read as Marc, deep-equals the unblocked
    read**; a closed call Marc answered reads `not_this_time`, one picked for Marc reads `picked`;
    no field carries a count or another answerer's id; at most 100 `others`, 50 answers.
  - answer: insert while open; 404 for an unknown call and for one whose poster the caller
    blocked; 409 `not_open` on a closed one; 400 `self` on one's own; refused off the roster; the
    notice is started not awaited (race test) and not sent when the poster blocked the answerer.
  - pick: payload keys equal `lastFunctionParams('fightbook_call_pick')`; `not_open` → 409;
    `spar_call_picked` sent to the picked one.
  - the existing ask tests still pass on the extracted `catalogWeapons` / `onFreeDate`.
- [ ] Step 2: Implement; notice texts + registrations of Decision 15.
- [ ] Step 3: `pnpm openapi:client`; green; commit `feat(fightbook): open calls`.

### Task 6: QR log (API)

**Files:** Create `spar-qr.service.ts` (+ test); modify `fightbook-floor.controller.ts`,
`spar-reads.service.ts` (`inbox`, Decision 12b), types.

**Interfaces — Produces:** `POST me/fightbook/qr` → `{ code: string; expiresAt: string }`;
`POST me/fightbook/qr/scan` `{ code: string; weapons: string[]; eventId?: uuid; place?: string;
zone?: string }` → `{ id: string }`.

- [ ] Step 1: Failing tests: mint deletes every code of the caller but the newest live one (a
      fixture with an expired, an older live and the newest live code: only the newest survives, plus
      the new one; another fighter's code is untouched), stores only
      `hashPassToken(raw)` (no raw token in any write), `expires_at` = now + 5 min, code starts `fb:`;
      scan refuses `bad_code` without `fb:` before any read; `bad_weapon` / `bad_event` / `bad_place`
      / `bad_zone` before the rpc (assert the rpc was NOT called); payload keys equal
      `lastFunctionParams('fightbook_qr_log')`; the event path sends kind `event`, the Event's
      `today` and zone; the free path sends the phone-zone date; `bad_code` and SQL `bad_event` → 400;
      `notify` true and false both answer `{ id }` only (deep-equal), and only `notify` true starts
      `notifySparRequestReceived` (race test: the handler resolves while the send never settles); the scan
      route carries `@ThrottleFightBookAsk()` and the mint route `FIGHTBOOK_QR_MINT_THROTTLE`;
      `SparReadsService.inbox` leaves out, in its query before the limit (`filtersFor(…, 'not')`
      asserted), a pending request whose asker the caller blocked, and keeps one whose asker blocked
      the CALLER (672).
- [ ] Step 2: Implement; reuse `mintPassToken`, `hashPassToken`, `onFreeDate`, `openEventDays`,
      `sparExpiresAt(kind, day, zone)`.
- [ ] Step 3: `pnpm openapi:client`; green; commit `feat(fightbook): log a spar by QR`.

### Task 7: One camera scanner (`@myclash/ui/scan`)

**Files:** `git mv` `apps/web-staff/src/lib/scan/{camera,decoder,useCameraScanner}.ts` +
`camera.test.ts` to `packages/ui/src/scan/`; create `packages/ui/src/scan/index.ts` (+
`camera-error.ts` holding `cameraErrorKey`); modify `packages/ui/package.json` (`"./scan"`
export, `jsqr`), `apps/web-staff/package.json` (drop `jsqr`), `ScanOverlay.tsx`, every web-staff
import, i18n (`scoring.scan.*` camera keys → `common.scan.*`), and the web-staff and web-public
Dockerfiles if they copy a package's `node_modules` by hand (`pnpm infra:review` decides).

- [ ] Step 1: Move; the `decoder.ts` cast of Decision 19; build `@myclash/ui`.
- [ ] Step 2: A script step AFTER that build (not a vitest test — turbo's `^build` does not build
      the package's own dist first): `dist/scan/decoder.js` contains `import('jsqr')` as a dynamic
      import, and `dist/index.js` does not mention `scan`.
- [ ] Step 3: web-staff typecheck, lint, tests; `pnpm perf:bundle:build && pnpm perf:bundle`;
      `pnpm infra:review`; the offline E2E specs (`tests/e2e/06-offline-sync*`,
      `tests/e2e/40-offline-bout*`) green.
- [ ] Step 4: Commit `refactor(ui): one camera scanner for every app`.

### Task 8: Free now and open calls on the Find tab (web-public)

**Files:** Create `FreeNowSwitch.tsx`, `OpenCalls.tsx`, `PostOpenCall.tsx`, `use-open-calls.ts`
(+ tests); modify `FindTab.tsx` (wire-up), `FindCards.tsx` (badge), `read-fightbook.ts`, i18n.

- [ ] Step 1: Failing tests: the switch and the open-call section render only when the shown Event
      has `today`; the switch shows "until HH:MM" from `freeUntil` and turns off on DELETE; a card with
      `freeNow` shows the badge, one without does not; `others` cards show the time, weapons and the
      face per `myAnswer` ("I'm in" / "Take back" / "Picked — it's in My spars" / "Not this time");
      `mine` cards list answers with "Pick" and a "Close" button; a pick answering `not_open` reloads
      the calls and says the call is no longer open; posting shows the `bad_time` /
      `too_many_calls` sentences.
- [ ] Step 2: Implement; reuse `useInFlight`, `sparRefusalKey`, `FindCards`, `useDayLabel`.
- [ ] Step 3: Green; commit `feat(fightbook): free now and open calls in Find`.

### Task 9: The QR panel (web-public)

**Files:** Create `QrPanel.tsx`, `QrScan.tsx` (+ tests); modify `FindTab.tsx` ("My FightBook QR",
"Scan a FightBook QR"), `read-fightbook.ts`, i18n.

- [ ] Step 1: Failing tests: the panel shows `QRCodeSVG` of `code` and re-mints when less than
      30 s remain, measured from the answer's own duration (fake timers, a phone clock set 10 minutes
      off still re-mints on time); the scan view shows the form first (weapons; today's Events or
      "Somewhere else" with a place), then starts `useCameraScanner` from `@myclash/ui/scan`, submits
      the first payload starting `fb:`, ignores others, and STOPS the camera after that submit (a
      payload re-emitted 4 s later sends nothing); the answer says "Sent — they confirm on their
      phone"; each refusal shows its sentence and "Scan again" — `bad_code`, `already_asked`,
      `you_blocked`, `not_on_fightbook`, `fightbook_off`, `bad_event`, `bad_place`; a camera error
      shows the `common.scan.*` sentence.
- [ ] Step 2: Implement; the zone via `Intl.DateTimeFormat().resolvedOptions().timeZone`, as the
      free-date ask does.
- [ ] Step 3: Green; `pnpm perf:bundle:build && pnpm perf:bundle`; commit
      `feat(fightbook): show and scan a FightBook QR`.

### Task 10: The docs

**Files:** `docs/ARCHITECTURE.md` (new §11septies.9 Floor tools: the four tables, the two
functions and the re-defined block and answer, Decisions 2, 5, 8-13, 16-19, the merge decision,
rulings 706/713/714; §11septies.3 Races: a switch-off does not stop a pick that already read
"FightBook on" — the pick's KEY SHARE does not conflict with the switch's UPDATE, as with
`fightbook_answer` today; accepted), the spec's slice 5 lines (overturned: the blocker hidden from
open-call lists → 706; a QR spar agreed on the scan → 713, 714).

- [ ] Step 1: Write; `pnpm quality:docs-drift` and `pnpm docs:mermaid` green.
- [ ] Step 2: Commit `docs(fightbook): the floor tools`.

### Task 11: Falsify, gates, review, push

- [ ] Step 1: Falsifier (code + SQL, the slice 4 kit): one case per guard of Decisions 2, 5-16 (12b included) and
      each Review Focus line; each red when broken, green when restored.
- [ ] Step 2: The 32 gates; the offline E2E specs; a fresh replay with every probe and the race
      probe; a local gitleaks over the pushed range.
- [ ] Step 3: Cold whole-slice review (`code-architecture-reviewer`, Opus); one fold wave; scoped
      re-review; gates + falsifier again; push; CI; memory note + handoff.
