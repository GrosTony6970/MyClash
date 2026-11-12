# FightBook slice 2 (Asking surfaces + Find a partner) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fighter with FightBook on can ask another fighter for a spar from that fighter's public
profile, from the Event people page (each search row and the person page), and from a new **Find a
partner** tab that lists FightBook users at their Event and then all of FightBook, page by page,
with photos.

**Architecture:** No migration. Five new read routes under `me/fightbook` answer, for the signed-in
caller only, who may be asked and who to find. The public pages stay public: the button loads in
the browser from those routes, never from the page's public data. One shared ask dialog serves all
three places and posts to slice 1's `POST me/fightbook/requests`.

**Tech Stack:** NestJS + Zod DTOs, Next 16 / React 19, `@myclash/ui` (`Modal`), `@myclash/i18n`,
Vitest.

**Spec:** `docs/superpowers/specs/2026-11-10-fightbook-design.md` (rulings 642-661), slice 1 plan
`docs/superpowers/plans/2026-11-11-fightbook-slice1-core.md`, `docs/ARCHITECTURE.md` §11septies.
Rulings taken for this plan (2026-11-12): **672** a blocker stays listed in the blocked fighter's
Find (his asks still end "Not this time"); the blocker's own Find hides the fighters she blocked.
**673** below the same-Event block, a search over all FightBook users (widened by 675 below);
the weapon filter applies to both. **674** "Ask to spar" on the Event person page (beside Follow)
AND on each row of the people search. **675** (widens 673) the second section browses ALL
FightBook users, by name, 20 per page with "Show more", narrowed by an optional name and the
weapon; every Find card shows the fighter's photo.

## In plain words

**Three new places to ask.** Julie opens Marc's public profile. If she is signed in, has FightBook
on, and Marc has FightBook on too, an "Ask to spar" button appears under his name. Signed-out
visitors and everyone else see the page exactly as today: the button is never in the page's public
data; Julie's browser asks the API after the page loads. The same button appears beside Follow on
an Event's person page, and on each row of the Event's people search.

**One form.** The button opens a small form: an Event (one of the published Events Julie is on and
whose days have not ended, with its day) or a free date and place; one to five weapons; an optional
time and message. Sending answers "Request sent" or one sentence saying why not.

**Find a partner.** A third tab in FightBook. At the top, everyone with FightBook on who is at
Julie's Event (today's Event, else her next one; a picker if several run today). Below, "All of
FightBook": every FightBook user on MyClash, by name, 20 at a time with "Show more", and a box to
narrow it by name. A weapon filter narrows both lists ("all sabre fighters"). Each card has the
fighter's photo (their initials when they have none), name, club, weapons, and "Ask to spar".

**Block (ruling 672).** If Marc blocked Julie, nothing changes for Julie: Marc still shows in her
Find and his profile still shows the button; her request ends "Not this time", as in slice 1. Marc's
own Find and buttons hide Julie, because he knows he blocked her.

**Who is never listed:** anyone with FightBook off, a merged-away, deleted or erased profile, an
unclaimed profile, yourself, and someone entered only in a draft Tournament (ruling 129).

**Minor 8 of slice 1's review is fixed here:** a free date without a place, an unknown weapon, and a
missing zone each get their own refusal code and sentence.

## Global Constraints

- No new table and no migration. The only DB reads are new SELECTs on existing tables.
- Every user-facing string in `en` and `fr` (`packages/i18n/src/messages/{en,fr}/publicApp.ts`).
- Every route acts on the caller's own profile (`fightBookCaller` + `requireFightBookOn`): 401
  signed out, 403 staff login / guest / `no_profile` / `fightbook_off`.
- **No FightBook data in any public projection.** `fighters.service.test.ts`'s public key pin and
  the people lookup payload do not change.
- Every new DB read in a test asserts its select string AND its owner filter, with a fixture row
  the filter must exclude (prompt §5).
- Web API paths written whole as literals (`frontend-route-contract`); the OpenAPI client
  regenerated in each API commit that adds a route (`quality:openapi-drift`).
- Files ≤ 400 lines, functions ≤ 50 (`quality:complexity`, after prettier); test files count.
  Baselined files may grow; re-point the baseline and audit with `baseline-audit.mjs`.
- Tokenized UI only; no raw ids in UI; no real names in fixtures.
- Commit subjects start lower-case ("the FightBook …", never "FightBook …" / "My spars …").
  Messages via a file and `git commit -F`; `git fetch` + `git log --oneline -1` before staging;
  explicit paths.

## Decisions taken in this plan (the builder's calls the design left open)

1. **"May be asked"** (`askable`) = the target is live (`applyReachable`), claimed, FightBook on,
   not the caller, and **not blocked by the caller**. Whether the target blocked the caller is
   never read (672). One predicate owner: the filter chain `applyFightBookOn(q)` =
   `applyReachable(q).eq('fightbook_enabled', true).not('claimed_by_user_id', 'is', null)` (the
   `applyReachable` shape), used by `fightBookOnFighters(ids)` (extracted from
   `SparReadsService.answerableAskers`, which then calls it) AND by the browse read (675), so
   one falsifier breaks both. The weapon filter has one owner too: `applyWeapon(q, weaponId)` adds
   `.eq('fighter_weapons.weapon_id', weaponId)` to a select that embeds
   `fighter_weapons!inner(weapon_id)` — the pattern the directory's club filter already runs in
   production (`clubs!inner` + `.eq('clubs.slug', …)`, `fighters.service.ts:392,422`). Both the
   Event block (`fightBookOnFighters(ids, weaponId?)`) and the browse use it, so paging stays
   exact (a filter applied after a page was read would shrink pages). `askableFighters` = `fightBookOnFighters` minus me, minus my blocks
   (one read: `fightbook_blocks.select('blocked_global_person_id').eq('blocker_global_person_id',
me)` — no `.in()`). Every `.in()` over a roster-sized id list (`fightBookOnFighters`,
   `readSparFighters`, `readFighterWeaponNames`) reads in `inListChunks` pieces
   (`common/postgrest-in-list.ts`, 200 ids each): an Event of 300 must not 5xx.
2. **Routes** (all `GET`, all `requireFightBookOn`):
   - `me/fightbook/fighters/:globalPersonId/askable` → `{ askable: boolean }` (profile page).
   - `me/fightbook/events/:eventId/askable?persons=<ids>` → `Record<personId, globalPersonId>` for
     the askable rows only (people search row and person page; 1-50 roster ids). Answers `{}` for
     an Event that is not public (`isPublicEvent`), ids of another Event's roster, and hidden
     entrants (`hiddenEntrantIds` with the caller's `publicReader`). The caller need not be on the
     Event: a visitor may still ask by free date. This leaks nothing: the people lookup already
     returns each row's `global_person_id` publicly (`lookup.controller.ts:43,158`). Every Event read
     that feeds `hiddenEntrantIds` selects `id, status, organization_id, event_kind`
     (`isInsider` → `assertOrgRole(event.organization_id)`, `competition-visibility.ts:128`).
     `:eventId` takes `ParseUUIDPipe` on both Event routes.
   - `me/fightbook/events` → `FightBookEvent[]`: published Events the caller has a `persons` row
     for, with the days not yet ended (`sparExpiresAt('event', day, zone) > now`), by first open
     day, then name (test the tie in Task 4);
     `today` = the latest open day whose start (00:00 Event clock) has passed, else null
     (between 00:00 and 06:00 two open days have started: the later one is today).
   - `me/fightbook/events/:eventId/find?weapon=` → `FindCard[]`: askable fighters with a `persons`
     row at that Event, hidden entrants left out, by name, at most 200. 400 `bad_event` unless the
     Event is public and the caller is on its roster (as ruling 665 for asks).
   - `me/fightbook/find?q=&weapon=&page=` → `FindPage = { items: FindCard[]; more: boolean }`
     (ruling 675: ALL of FightBook, paged). `page` 0-based, ≤ 500; 20 per page. One read:
     `applyFightBookOn`, `applyWeapon` when `weapon` is set, `.neq('id', me)`, and when I blocked
     anyone, ONE `.not('id', 'in', list)` with `list` the string `(id1,id2,…)` of at most
     `IN_LIST_MAX` (200) of my blocked ids (one filter in one URL: chunking would not shorten it);
     any further blocked ids are dropped from the page in memory, so a page may run short for
     someone with over 200 blocks — accepted
     (the string form: postgrest-js passes the value as given, an array would arrive without
     brackets and PostgREST refuses it; in the query, so pages stay full),
     `.order('family_name').order('given_name').order('id')`, `.range(page*20, page*20+20)` (21
     rows: the 21st only sets `more`). `q` narrows by name: it goes through
     `sanitizePostgrestFilterValue`, then `%` and `_` are stripped, and the length is checked AFTER
     that: under 2 characters → no name filter (browse all), else the `or` of three `ilike`
     (given, family, display). No index on `fightbook_enabled` (0263): accepted at today's size,
     no migration in this slice.
   - `weapon` is a catalog weapon **id** (`z.uuid()`), as the web's select lists them from
     `GET /api/v1/weapons?active=true`; no name matching.
   - The query schemas (`askableQuerySchema`, `findQuerySchema`, `browseQuerySchema`) are exported
     from the controller, like `askSchema`, and tested with `safeParse` (a Zod pipe does not run
     on a direct service call).
3. **Find ignores `listed_in_directory`** (design, _my call_ there): Find lists only FightBook users
   to FightBook users.
4. **Cards gain the club.** `SparFighter` gets `club: string | null` (the `clubs(name)` embed on
   `global_persons`, no visibility switch exists for it); `readSparFighters` stays the one owner, so
   the Inbox, My spars and the blocked list show it too (slice 1 Decision 9: "club comes with slice
   2's cards"). Still no profile link on a card.
5. **Weapons on a Find card** = the fighter's declared weapons, favourites first, at most 3
   (`DIRECTORY_WEAPONS_SHOWN`). The read moves out of `FightersService.getFavoriteWeaponNames` into
   `fighters/fighter-weapon-names.ts` (one owner, both callers). It now **throws on a failed read**
   (today it reads `{ data }` only and shows no weapons) — the directory then 5xx's instead of
   listing fighters with no weapons. A weapon filter (Decision 1's `applyWeapon`) matches any
   declared weapon, not only the 3 shown; a fighter with none declared is left out when a filter
   is set.
6. **Refusal codes (Minor 8):** `bad_place` (free date with no place), `bad_weapon` (a weapon not in
   the active catalog), `bad_zone` (free date with no or an unknown IANA zone). All `400 { code }`.
7. **The ask dialog** (`AskSparDialog`, `@myclash/ui` `Modal`): kind radio (Event / free date; Event
   only offered when `me/fightbook/events` lists one), Event select + day select from its `days`
   (preselected when opened from that Event's people page and the caller is on it; else the first
   Event and its `today` or first day), free date (`<input type="date">`, min = today, place 1-200,
   zone = `Intl.DateTimeFormat().resolvedOptions().timeZone`), weapons as checkboxes from
   `GET /api/v1/weapons?active=true` (1-5), optional time (`<input type="time">`), optional message
   (≤500). Submit disabled while sending. Success: "Request sent" + link to `/me/fightbook?tab=spars`;
   refusal: `sparRefusalKey(code)`.
8. **The button component** `AskToSpar` (`src/components/fightbook/`) takes the receiver's
   `globalPersonId`, `name`, optional `eventId`. Two thin wrappers own the reads:
   `ProfileAskToSpar` (profile; one `askable` read) and the people page's batch read. Any read
   result other than askable — 401, 403, a failure, a bad shape — renders **nothing**: no button, no
   sentence (a sentence would tell a non-user about FightBook state). **No `askable` read for a
   visitor who is not signed in:** each page asks `fetchMe` once (the person page already does,
   `viewerType`, `[personId]/page.tsx:83-101`) and reads `askable` only on `claimed`. A signed-out
   view then costs one `/me` call, not an `askable` 401 plus the `/me` renewal behind it
   (`renew-login.ts:82-85`) on every view and every search answer (global limit 120/min per IP,
   `throttler-options.ts:58-60`, shared by a whole venue). A failed `fetchMe` renders nothing and
   never sends anyone to sign in.
9. **People search rows:** the card's border, padding and hover move from the `<div>` inside the
   `<Link>` (`people/page.tsx:156-157`) to the `<li>`, a flex row: the `<Link>` keeps the
   name/club/roles block and grows; the Ask button sits beside it, outside the link (a button inside
   an anchor is invalid). After each search answer the page reads `askable` for the listed ids
   once; an answer for an older id list is dropped (it must not paint buttons on new rows).
   **Person page:** the button goes in the row that holds Follow; when Follow is replaced by the
   "prefers not to be followed" sentence (`[personId]/page.tsx:232-250`), the button sits under
   that sentence.
10. **Find tab** (`?tab=find`): the Event block follows the design (`design.md:81-83`): the Event
    whose `today` is set; a picker only when several have `today`; none today → the soonest
    upcoming; none at all → no Event block. Then the weapon filter (catalog select, "Any weapon"),
    then **"All of FightBook"** (675): the first page loads with the tab; a name box narrows it
    (debounce 250 ms; under 2 letters = everyone); "Show more" appends the next page while `more`.
    A new name or weapon starts again at page 0, and an answer for an older name, weapon or page is
    dropped (key = `q|weapon|page`), so "Show more" never appends rows of an older search. An
    appended page drops cards already shown (by `globalPersonId`): someone switching FightBook on
    between pages shifts the offset and would repeat a card (and a React key). Every
    card shows the fighter's photo through `Avatar` (initials when there is none). Query strings
    built with `URLSearchParams`. An ask from Find calls `refresh()` so My spars shows the new
    request.
11. **Throttling:** reads use the global throttler; asking keeps slice 1's 20/h/account.

## Review Focus

1. **A fighter typing fast in the people search** — an `askable` answer for "Pa" lands after the
   rows for "Pau": no button may appear on a row the answer did not cover. Test in Task 9.
2. **Marc switched FightBook off after Julie's button showed** — her ask answers
   `403 not_on_fightbook`; the dialog shows its sentence and stays open. Test in Task 7.
3. **An Event whose last day ended at 06:00 this morning** — not in `me/fightbook/events`; Find then
   shows only "All of FightBook", with no empty Event block. Tests in Tasks 4 and 10.
4. **A roster row with no fighter profile, or an unclaimed one** — no button, no error, the other
   rows still get theirs. Test in Task 3.
5. **Julie at two Events today** — the picker shows both; the default is the first by day then name;
   switching re-reads the block. With one Event today and one next month, no picker: today's. Test
   in Task 10.
6. **An Event of 300 people** — Find's Event block reads in chunks of 200 ids and answers, never a
   5xx. Test in Task 6 (a 250-row roster).
7. **Hugo taps "Show more", then types a name before page 2 answers** — page 2 of the old list
   must not land under the new list. Test in Task 10.

---

## File map

**Types** — `packages/types/src/fightbook.ts`: `SparFighter.club`, `FightBookEvent`, `FindCard`,
three refusal codes.

**API** (`apps/api/src/modules/fightbook/`)

- `spar-askable.ts` (new) — `fightBookOnFighters`, `askableFighters` (pure DB helpers).
- `spar-find.service.ts` (new) — the five reads; `spar-find.service.test.ts` (+ a second test file
  if over 400 lines).
- `spar-ask-rules.ts` — `openEventDays`.
- `spar-fighters.ts` — club; `spar-reads.service.ts` — calls `fightBookOnFighters`.
- `spar-requests.service.ts` — Minor 8 codes; its private `isOnRoster` moves to `spar-askable.ts`
  as `isOnEventRoster(db, me, eventId)` (one owner: the ask and Find's Event block both call it);
  `fightbook.controller.ts` — five routes + query DTOs; `fightbook.module.ts` — `SparFindService`,
  and `imports: [OrganizationsModule]` (`organizations.module.ts:17` exports `OrganizationsService`;
  `hiddenEntrantIds` needs `orgs` for `isInsider`, `competition-visibility.ts:129`). Its imports are
  `UserDirectoryModule` and `PrivacyModule`; `module-graph.test.ts` stays green (run it).
- `apps/api/src/modules/fighters/fighter-weapon-names.ts` (new) + `fighters.service.ts`;
  `DIRECTORY_WEAPONS_SHOWN` (= 3, `fighters.service.ts:144`) moves there, exported.
- Name search: `sanitizePostgrestFilterValue` (`common/postgrest-filter.ts:20`).

**Cost on the public pages, accepted:** a signed-out visitor's browser sends one `GET
/api/v1/me` per page view (Decision 8), which answers `anonymous`; nothing renders. The public HTML
is unchanged.

**Web** (`apps/web-public/`)

- `src/lib/fightbook/read-fightbook.ts` — four reads; `refusal.ts` — three keys.
- `src/components/fightbook/AskSparDialog.tsx`, `AskToSpar.tsx`, `ProfileAskToSpar.tsx` (new).
- `app/fighters/[slug]/page.tsx`; `app/e/[eventSlug]/people/page.tsx`;
  `app/e/[eventSlug]/people/[personId]/page.tsx`.
- `app/me/fightbook/FindTab.tsx` (new), `FightBookTabs.tsx`, `SparCard.tsx` (club line).

**Docs** — `docs/ARCHITECTURE.md` §11septies (a "Finding and asking" subsection), the design spec's
Block and Find lines (672, 673), the slice 1 plan untouched.

---

### Task 1: Refusal codes for the free date and the weapons (Minor 8)

**Files:** `packages/types/src/fightbook.ts`, `apps/api/src/modules/fightbook/spar-requests.service.ts`,
`spar-requests.ask.test.ts`, `apps/web-public/src/lib/fightbook/refusal.ts`, i18n en/fr.

**Interfaces:** Produces `SparRefusalCode` with `'bad_place' | 'bad_weapon' | 'bad_zone'`.

- [ ] **Step 1: Rewrite the existing cases** in `spar-requests.ask.test.ts` (no duplicates): the
      zone rows of the `it.each` at `:161-164` ("an unknown zone", "no zone") move to a new
      `it.each` expecting `[400, 'bad_zone']` via `codeOf` (the "more than a year ahead" row stays
      `bad_day`); the test at `:170-177` becomes two, expecting `[400, 'bad_place']` and
      `[400, 'bad_weapon']`. Run `pnpm --filter @myclash/api exec vitest run
src/modules/fightbook/spar-requests.ask.test.ts` → those 4 cases FAIL, the rest pass.
- [ ] **Step 2:** Add the three codes to `SPAR_REFUSAL_CODES`; `onFreeDate` throws
      `badRequest('bad_zone'|'bad_place', …)`; `catalogWeapons` throws `badRequest('bad_weapon', …)`.
      `refusal.ts` maps each (the `Record` makes the compiler demand them); en/fr sentences
      ("Pick a place for a free date." / "Choisis un lieu pour une date libre.", "That weapon is not
      on the list." / "Cette arme n'est pas dans la liste.", "Your time zone could not be read." /
      "Ton fuseau horaire n'a pas pu être lu."). Tests green; `pnpm --filter @myclash/types build`
      before the API typecheck.
- [ ] **Step 3: Commit** `fix(fightbook): every ask refusal names its code`.

### Task 2: A card names the fighter's club

**Files:** `packages/types/src/fightbook.ts`, `spar-fighters.ts` (+ its test, or the reads test that
covers it), `apps/web-public/app/me/fightbook/SparCard.tsx`, the web tests building `SparFighter`.

**Interfaces:** Produces `SparFighter = { globalPersonId; name; photoUrl; club: string | null }`;
`unknownSparFighter` sets `club: null`.

- [ ] **Step 1: Failing test:** `readSparFighters` select string is exactly
      `'id, display_name, given_name, family_name, photo_url, clubs(name)'`; a row with
      `clubs: { name: 'Club A' }` maps to `club: 'Club A'`; `clubs: null` → `null`; an array embed
      → `null` (a wrong shape is no club, never a crash).
- [ ] **Step 2:** Implement; `SparCard` shows the club under the name (`text-xs text-muted`) when set.
      Fix the API fixtures (`spar-views.test.ts`, `spar-reads.service.test.ts`,
      `fightbook-blocks.service.test.ts`) and the web fixtures the compiler names. Rebuild
      `@myclash/types` first; API + web tests and typecheck green.
- [ ] **Step 3: Commit** `feat(fightbook): a spar card names the fighter's club`.

### Task 3: Who may be asked, and the two `askable` routes

**Files:** Create `spar-askable.ts`, `spar-find.service.ts`, `spar-find.service.test.ts`. Modify
`spar-reads.service.ts` (+ test still green), `fightbook.controller.ts`, `fightbook.module.ts`,
`fightbook.controller.test.ts`, OpenAPI client.

**Interfaces:**

- `applyFightBookOn<T>(query: T): T` — Decision 1's chain.
- `fightBookOnFighters(db, ids: string[]): Promise<Set<string>>` — live, claimed, on:
  `applyFightBookOn(global_persons.select('id')).in('id', chunk)` for each `inListChunks(ids)`.
- `askableFighters(db, me: string, ids: string[], weaponId?: string): Promise<Set<string>>` — the
  above (passing `weaponId` to `fightBookOnFighters(ids, weaponId?)`, Task 6) minus `me` minus my
  blocks (Decision 1's one read).
- `isOnEventRoster(db, me, eventId): Promise<boolean>` — moved from `SparRequestsService`.
- `SparFindService.askableFighter(me, globalPersonId): Promise<{ askable: boolean }>`.
- `SparFindService.askableAtEvent(me, eventId, personIds: string[], reader: PublicReader):
Promise<Record<string, string>>`.

- [ ] **Step 1: Failing tests** (`spar-find.service.test.ts`, seeded double; assert every select
      string and `filtersFor(…, 'eq'|'in'|'is')`):
      `askableFighter` true for an on, live, claimed fighter; false for: off, unclaimed, merged,
      erased, self, one **I** blocked. **`askableFighter` answers the same when the target blocked
      me** (fixture: block row target→me; assert equal to the no-block answer — ruling 672).
      `askableAtEvent`: maps only askable rows of THAT Event (a roster row of another Event in the
      fixture, same ids passed, is excluded); `{}` for a draft and a test Event **whose roster holds
      an askable row among the ids passed** (else the test holds nothing); a hidden entrant is left
      out — seed a draft-only Tournament entry and an `orgs` stub whose `assertOrgRole` throws
      `ForbiddenException` (`competition-visibility.ts:129-136`); a row with `global_person_id` null
      is skipped, the others still answer (Review Focus 4). Controller test: `askableQuerySchema`
      `safeParse` refuses 0 ids, 51 ids and a non-uuid; both Event routes carry `ParseUUIDPipe` on
      `eventId`, asserted on the route-argument metadata (`ROUTE_ARGS_METADATA` from
      `@nestjs/common/constants`) — a direct handler call never runs the pipe, and
      `http-edge-app.ts` mounts only its own controllers (`:225-233`).
- [ ] **Step 2: Implement.** `inbox`'s `answerableAskers` becomes a call to `fightBookOnFighters`
      (its test unchanged and green). Controller: `askableFighter` with `ParseUUIDPipe`;
      `askableAtEvent` with a Zod query `{ persons: string }` split on `,`, each `z.uuid()`, 1-50.
      Controller test: both routes call `requireFightBookOn` (off → 403 `fightbook_off`).
- [ ] **Step 3:** `pnpm --filter @myclash/api build && pnpm openapi:client`; route-authz,
      openapi-drift and api tests green.
- [ ] **Step 4: Commit** `feat(fightbook): the API says who the caller may ask`.

### Task 4: My Events for asking and finding

**Files:** `spar-ask-rules.ts` (+ `spar-ask-rules.test.ts`), `spar-find.service.ts` (+ test),
controller, types, OpenAPI client.

**Interfaces:**

- `openEventDays(event: { start_date; end_date; timezone }, now: Date): { days: string[]; today:
string | null }` — pure.
- `FightBookEvent = { id: string; name: string; days: string[]; today: string | null }`.
- `SparFindService.myEvents(me, now = new Date()): Promise<FightBookEvent[]>`.

- [ ] **Step 1: Failing tests:** `openEventDays` for a 2-day Event in `Europe/Paris`: at Saturday
      10:00 local → days `[sat, sun]`, today `sat`; at Sunday 05:59 local → `[sat, sun]`, today `sun`
      (Saturday's day ends 06:00 Sunday — `sat` stays listed until then); at Monday 06:00 local →
      `[]`; an `America/New_York` Event read on a UTC clock (prompt §5: test a non-Paris zone).
      `myEvents`: only Events with a `persons` row for me (a row of another fighter in the fixture
      is excluded — assert the `eq('global_person_id', me)` filter), only public ones, none whose
      days all ended (Review Focus 3), soonest first day; two Events with the same first day sort
      by name.
- [ ] **Step 2: Implement.** Read `persons.select('event_id').eq('global_person_id', me)`, then
      `events.select('id, name, status, event_kind, start_date, end_date, timezone').in('id', …)
.gte('end_date', yesterday)`; `isPublicEvent`; `openEventDays`. Route `GET
me/fightbook/events`. Regenerate the client. Green.
- [ ] **Step 3: Commit** `feat(fightbook): the API lists the Events a fighter can ask at`.

### Task 5: One owner for a fighter's weapons

**Files:** Create `apps/api/src/modules/fighters/fighter-weapon-names.ts` + test; modify
`fighters.service.ts` (its tests stay green).

**Interfaces:** `readFighterWeaponNames(db, ids: string[], cap?: number): Promise<Map<string,
string[]>>` — favourites first, then `sort_order`; `cap` undefined = all; throws on a read error.

- [ ] **Step 1: Failing test:** select string `'global_person_id, favorite, sort_order,
weapon_catalog(name)'`, the `.in('global_person_id', ids)` filter, cap 3 keeps 3, no cap keeps
      all, a failed read throws (Decision 5).
- [ ] **Step 2:** Move the body (reading in `inListChunks` pieces); `getFavoriteWeaponNames` calls
      it with `DIRECTORY_WEAPONS_SHOWN`, which moves into the new file, exported.
- [ ] **Step 3:** The move shifts every baselined function below `fighters.service.ts:524`
      (baseline keys 979, 1226, 1380, 1651, 2179, 2245, 2389): prettier, then
      `node scripts/check-complexity.mjs --write-baseline`, then `baseline-audit.mjs` →
      `per-file changes: 0`; `pnpm quality:complexity` green.
- [ ] **Step 4: Commit** `refactor(api): a fighter's weapon names have one owner`.

### Task 6: Find a partner — the Event block and all of FightBook

**Files:** `spar-find.service.ts` (+ test file(s)), `spar-askable.ts` (`applyWeapon`), controller
(+ test), types, OpenAPI client; Step 0: `common/testing/supabase-chain-seeded.ts` (398 lines),
`supabase-chain-internals.ts`, a new file split out of the seeded double, `supabase-chain.test.ts`.

- [ ] **Step 0: Teach the seeded double to page and to exclude a list** (its own commit, first).
      Today `range` is `UNSIMULATED` and throws on a seeded table (`supabase-chain-internals.ts:87`,
      `supabase-chain-seeded.ts:361-367`) and `.not` accepts only `is` and `eq` (`:305-308`), so
      every `browse` test would throw before asserting. First move the filter evaluation out of
      `supabase-chain-seeded.ts` into its own file (the cap is 400 lines), then add `range(from,
  to)` (applied after `order`, inclusive `to`, as PostgREST) and `.not(col, 'in', '(a,b)')`
      (parses the parenthesised list; an array or a string without brackets THROWS, because
      PostgREST refuses it). Tests in `supabase-chain.test.ts` for both, including the throw.
      Rules: `range` and `limit` together → the one called LAST wins (PostgREST), tested both
      ways; `total()` keeps counting every match, ignoring `range`; a CANNED table still lets
      `range` through unapplied (`supabase-chain-internals.ts:80-86`). Run
      `ai-usage.service.test.ts` by name (it chains `.range` on a canned table), then
      `pnpm --filter @myclash/api test` green. Commit
      `test(api): the seeded double pages and excludes a list`.

**Interfaces:**

- `FindCard = { fighter: SparFighter; weapons: string[] }`;
  `FindPage = { items: FindCard[]; more: boolean }`; `FIND_PAGE_SIZE = 20`.
- `applyWeapon<T>(query: T, weaponId: string | undefined): T` and the select fragment it needs.
- `SparFindService.atEvent(me, eventId, weaponId: string | undefined, reader): Promise<FindCard[]>`.
- `SparFindService.browse(me, q: string | undefined, weaponId: string | undefined, page: number):
Promise<FindPage>`.

- [ ] **Step 1: Failing tests:** `atEvent` lists askable fighters on that Event's roster by name
      (case-insensitive), hidden entrants out, self out, one I blocked out, **one who blocked me IN**
      (672), at most 200; 400 `bad_event` for a draft Event and for a public Event I am not on.
      With a weapon id, the select string embeds `fighter_weapons!inner(weapon_id)` and
      `filtersFor(…, 'eq')` holds `['fighter_weapons.weapon_id', id]`; without one, neither. These
      weapon tests assert the select string and the filter ONLY: the double compares a dotted
      column against the row's own key (`supabase-chain-seeded.ts:295`) and returns nothing, so no
      weapon test expects rows back; Step 2's probe is the behaviour test. A
      250-row roster with 220 askable fighters answers (each `.in()` call in the double carries
      ≤ 200 ids — assert it) (Review Focus 6). `browse`: no `q` → no `or` filter, all FightBook
      users by name; `q` `' a '`, `'%%'` and `'(('` → no `or` filter either; `q` `'Ma,rc'` reaches
      the `or` filter sanitized (assert the string); the three `order` calls, `.neq('id', me)` and
      `range(20, 40)` for page 1 asserted; 21 rows answered → 20 items and `more: true`, 20 → `more:
  false`; only FightBook users (the `applyFightBookOn` filters asserted, with an off, an
      unclaimed and a merged fixture row that must be excluded); blocked-by-me out via the
      `not in` filter, value exactly `(${ids.join(',')})` (asserted, and absent when I blocked
      nobody; 201 blocks → one `not in` of 200 ids, and the 201st blocked fighter, seeded on the
      page, is still absent from `items`), blocked-me in. `browseQuerySchema`
      refuses `page` -1, 501 and a non-uuid `weapon`.
- [ ] **Step 2: PROBE the embed on a real PostgREST before relying on it** (prompt §5: a library
      claim is probed). On the local stack (or a replay with PostgREST), seed two FightBook fighters,
      one declaring the weapon; run the exact `browse` read with `applyWeapon`; it returns ONE row,
      once (a to-many `!inner` must not repeat the parent). Record the command and result in the
      ledger. If it repeats or errors, stop and report before Step 3.
- [ ] **Step 3: Implement** with `askableFighters(db, me, ids, weaponId)`, `readSparFighters`,
      `readFighterWeaponNames` (cap `DIRECTORY_WEAPONS_SHOWN`: it only feeds the cards now). Routes `GET me/fightbook/events/:eventId/find` (query
      `{ weapon?: uuid }`) and `GET me/fightbook/find` (query `{ q?: string ≤ 80, weapon?: uuid,
  page?: int 0-500 }`). Regenerate the client. Green, including `pnpm quality:complexity`.
- [ ] **Step 4: Commit** `feat(fightbook): find a partner at your Event or in all of FightBook`.

### Task 7: The ask dialog and its button

**Files:** Create `src/components/fightbook/AskSparDialog.tsx`, `AskToSpar.tsx`,
`AskSparDialog.test.tsx`; modify `read-fightbook.ts` (+ test), i18n en/fr.

**Interfaces:**

- `readFightBookEvents(apiUrl, signal?)`, `readAskableFighter(apiUrl, id, signal?)`,
  `readAskableAtEvent(apiUrl, eventId, personIds, signal?)`, `readFindAtEvent(apiUrl, eventId,
weapon, signal?)`, `readFindBrowse(apiUrl, q, weapon, page, signal?)` — each a `FightBookRead<T>`
  with its shape check (`readFindBrowse` needs an `items` array and a boolean `more`).
- `<AskToSpar receiverGlobalPersonId name eventId? apiUrl onSent? />` renders the button and owns
  the dialog's open state.

- [ ] **Step 1: Failing tests** (stubbed `apiRequest`): the dialog posts exactly
      `{ receiverGlobalPersonId, kind: 'event', eventId, day, weapons: ['Longsword'] }` (no
      `time`/`message` keys when empty); a free date posts `{ kind: 'free', day, zone, place, … }`
      with the browser zone; with no Events the Event choice is absent; opened with an `eventId`
      the caller is on, that Event is preselected; Submit disabled until a weapon is ticked and while
      sending; `403 not_on_fightbook` shows that sentence and keeps the dialog open (Review Focus 2);
      `201` shows "Request sent" and calls `onSent`. Shape checks: `readAskableFighter` needs a
      boolean `askable`; `readAskableAtEvent` accepts `{}` and an object whose values are all
      strings, rejects `[]`, `null` and `{ a: 1 }`; the list reads reject `{}`; `readFightBookEvents`
      rejects an item without a `days` array. Query strings built with `URLSearchParams` (assert the
      encoded path for a `q` of `'Lé a&b'`).
- [ ] **Step 2: Implement.** i18n keys under `publicApp.fightBook.ask.*` (button, title, where,
      event, day, freeDate, place, weapons, time, message, send, sent, seeSpars), en + fr.
- [ ] **Step 3: Commit** `feat(fightbook): one form to ask for a spar`.

### Task 8: "Ask to spar" on the fighter profile

**Files:** Create `src/components/fightbook/ProfileAskToSpar.tsx` (+ test); modify
`app/fighters/[slug]/page.tsx` (one element under the links / share row).

- [ ] **Step 1: Failing tests:** reads `askable` only after `fetchMe` answers `claimed` (no
      `askable` read for `anonymous`, `guest`, or a failed `fetchMe`); renders nothing before its
      read answers, and nothing for a 401, a 403, a failure, `{}`, and `{ askable: false }`; renders
      the button for `{ askable: true }`; renders nothing (and reads nothing) for an empty
      `fighterId`.
- [ ] **Step 2: Implement**; place `<ProfileAskToSpar fighterId={fighter.id} name=… />` in the
      header block. `fighters.service.test.ts`'s public key pin untouched and green.
- [ ] **Step 3:** Re-point the complexity baseline (`--write-baseline` after prettier;
      `baseline-audit.mjs` → `per-file changes: 0`).
- [ ] **Step 4: Commit** `feat(fightbook): ask a fighter from their profile`.

### Task 9: "Ask to spar" on the Event people page

**Files:** `app/e/[eventSlug]/people/page.tsx`, `app/e/[eventSlug]/people/[personId]/page.tsx`,
a hook `src/components/fightbook/use-askable-at-event.ts` (+ test).

**Interfaces:** `useAskableAtEvent(apiUrl, eventId: string | null, personIds: string[], signedIn:
boolean): Record<string, string>` — the effect is keyed on `` `${eventId}|${personIds.join(',')}` `` (a new array
each render must not loop); it stores `{ key, map }` from the answer and returns
`state.key === key ? state.map : {}` during render, so it never sets state synchronously in the
effect (`react-hooks/set-state-in-effect`, `--max-warnings 0`) and an answer for an older key is
never shown; `{}` on any non-data read.

- [ ] **Step 0: The people search's own stale rows** (its own commit, first): a query under 2
      letters clears the rows but leaves the search in flight (`people/page.tsx:66-69`), so old
      rows come back. Test: type "Pau", then clear to "P" before the answer → no rows; the stubbed
      `fetch` must reject with an `AbortError` when its signal aborts (the page's catch,
      `people/page.tsx:82`), or the test does not exercise the abort. Fix: abort
      the controller on that path. Commit `fix(web-public): a cleared people search stays empty`.
- [ ] **Step 1: Failing tests:** the hook shows nothing from a slower answer for an older id list
      (Review Focus 1: resolve "Pau" first, then "Pa"; only "Pau"'s map is returned); no read for an
      empty list, a null Event, or `signedIn` false; `{}` on 403; a re-render with an equal new
      array reads once.
- [ ] **Step 2: Implement.** Search page: one `fetchMe` on mount → `signedIn`; rows per Decision 9
      with `<AskToSpar …eventId>` for ids in the map. Person page: the hook with `[personId]` and
      its OWN flag `askerSignedIn`, set true only when `fetchMe` answers ok with
      `type === 'claimed'` — never `viewerType`, which starts `'claimed'` and stays so on a failed
      `/me` (`[personId]/page.tsx:62-65, 94-96`); the button per Decision 9. Page tests (person page
      AND search page): `/me` pending → no `askable` read; `/me` failed → none; `anonymous` → none;
      `claimed` → one.
- [ ] **Step 3:** Baseline re-point + audit, as Task 8. `pnpm --filter @myclash/web-public lint`
      green.
- [ ] **Step 4: Commit** `feat(fightbook): ask from the Event people page`.

### Task 10: The Find a partner tab

**Files:** Create `app/me/fightbook/FindTab.tsx` + `FindTab.test.tsx`; modify `FightBookTabs.tsx`
(three tabs, `?tab=find`), i18n en/fr (`publicApp.fightBook.tabs.find`, `publicApp.fightBook.find.*`).

- [ ] **Step 1: Failing tests:** `?tab=find` opens Find; the Event block per Decision 10: two
      Events today → a picker, default the first (by day, then name), switching re-reads (Review
      Focus 5); one Event today and one next month → no picker, today's; none today, two upcoming →
      no picker, the soonest; no Events → no Event block, "All of FightBook" alone (Review Focus 3).
      "All of FightBook" reads page 0 with the tab; "Show more" shows while `more` and appends page
      1; a name or weapon change reads page 0 again and replaces the list; **Review Focus 7**: tap
      "Show more", type a name, then resolve the old page 1 last → the new list has no old rows.
      The weapon select re-reads both lists with the weapon id. Each card renders `Avatar` with
      the fighter's `photoUrl` (an `<img>` with that `src`), and initials when it is null. A failed
      read shows the retry sentence; an ask sent from a card calls `refresh`.
      A page 1 that repeats a page-0 card shows it once.
- [ ] **Step 2: Implement.** Cards: `Avatar` (photo), name, club, weapons, `<AskToSpar>`. The "All
      of FightBook" section is its own file and hook from the start (`AllOfFightBook.tsx`,
      `use-fightbook-browse.ts`), with its own test file (`AllOfFightBook.test.tsx`: paging, Review
      Focus 7, the repeat, the avatar); `FindTab.test.tsx` keeps the Event block, the picker cases,
      the weapon select, retry and refresh. Both test files stay under 400 lines.
- [ ] **Step 3: Commit** `feat(fightbook): the find a partner tab`.

### Task 11: The docs

- [ ] `docs/ARCHITECTURE.md` §11septies.5 "Finding and asking": the five routes, Decision 1's
      predicate, 672's asymmetry, why the button never sits in public data. Design spec: the Block
      paragraph's "You disappear from their Find…" becomes ruling 672's rule; "if none, Find shows
      everyone" becomes ruling 675's paged list of all FightBook users. `pnpm quality:docs-drift`
      green.
- [ ] **Commit** `docs(fightbook): finding and asking, rulings 672-675`.

### Task 12: Falsify, gates, review, push

- [ ] **Falsify** (add each to `falsify-fb.mjs`; break, prove it landed, red, restore, green):
      F1 `askableFighters` reads the target's blocks too (blocked-me out) → the 672 equality tests
      red. F2 drop `applyReachable` from `fightBookOnFighters` → merged/erased tests red. F3 drop the
      `.eq('fightbook_enabled', true)` → off-fighter tests red. F4 drop the `event_id` filter in
      `askableAtEvent` → the other-Event row test red. F5 drop `hiddenEntrantIds` → hidden-entrant
      tests red. F6 drop the `isPublicEvent` check in `askableAtEvent` / `atEvent` → draft tests red.
      F7 drop the roster check in `atEvent` → not-on-Event test red (this one guards the design's
      rule, not privacy: the roster is public). F8 `ProfileAskToSpar` renders the button on 403 →
      its test red. F9 drop the `state.key === key` guard in `useAskableAtEvent` → Review Focus 1
      test red. F10 drop `sanitizePostgrestFilterValue` → the `or`-string test red. F11 drop "minus
      my blocks" → blocked-by-me tests red. F12 drop "minus me" → self tests red. F13 drop the
      `claimed_by_user_id` filter from `applyFightBookOn` → unclaimed tests red in BOTH
      `fightBookOnFighters` and `browse`. F14 skip `inListChunks` in `fightBookOnFighters` → the
      250-row test red. F15 drop the `fetchMe` gate in `ProfileAskToSpar` → the anonymous test red.
      F16 the person page passes `viewerType === 'claimed'` instead of `askerSignedIn` → the
      "`/me` pending / failed" page tests red. F17 drop `applyWeapon`'s `.eq` → the weapon filter
      tests red in BOTH `atEvent` and `browse`. F18 drop the `q|weapon|page` key guard in the
      "All of FightBook" list → Review Focus 7 test red. F19 `browse` drops the `not in` (my
      blocks) filter → blocked-by-me test red.
- [ ] **Named, not fixed:** `hiddenEntrantIds` puts all draft-only entrants in one `.in()`
      (`hidden-entrants.ts:55`): over 200 such entrants at one Event, a 5xx. The people lookup
      already has it; not new here. Report it to the operator.
- [ ] Full `gates.sh` (32 gates) green; fresh `replay.sh` (no migration, the FightBook probe still 47) green.
- [ ] Cold `code-architecture-reviewer`; fold; a second cold pass if folds touch the stale-answer
      race; `git fetch`; push; `watch-ci.sh <sha>`; memory note + MEMORY.md line.
