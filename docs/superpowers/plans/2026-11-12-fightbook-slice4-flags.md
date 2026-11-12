# FightBook slice 4 (Safety flags) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fighter can flag a safety problem about the partner of a spar, from the spar day on.
The flag reaches the Event's club admins (an Event spar) or the MyClash super admins (a free-date
spar) as an alert and in a list in web-admin with a "handled" mark. The flagged fighter never
reads it, even when they are an admin, after an unlink, or after a fighter merge. A flag is deleted
after 2 years.

**Architecture:** Migration 0269 adds two deny-all tables: `spar_flags` holds what the reporter
wrote and a snapshot of the spar, so the flag outlives the spar; `spar_flag_admin` holds what only
admins may know (the flagged account at write time, the "handled" mark), kept out of every data
download. One SQL predicate, `fightbook_flag_shown`, is the only owner of "who must never read this
flag". The club list, the platform list, the handled mark and the alert's recipients all go
through it, as SQL functions the FightBook probe runs on a real database. A fighter merge moves no
flag; the predicate follows merges both ways (`fightbook_profile_family`). The API gains one
fighter route, a notice (the first to club or platform admins) and two admin route sets. web-public
gets the flag form on the spar card; web-admin gets a club page, a platform page and a retention
field.

**Tech Stack:** Postgres 17 (plpgsql), NestJS + Zod DTOs, Next 16 / React 19, `@myclash/ui`,
`@myclash/i18n`, Vitest, the replay probes (`scripts/`).

**Spec:** `docs/superpowers/specs/2026-11-10-fightbook-design.md` ("After the spar" → Safety
flag; rulings 645, 648, 656, 658, 661), `docs/ARCHITECTURE.md` §11septies, the slice 3 plan in
this folder. Rulings taken for this plan (2026-11-12, recorded in
`C:\Users\Tony\.claude\plans\fightbook-handoff.md`):

- **691** A flag can be sent **from 00:00 of the spar day**, on its own form apart from the
  thank-you. An undo of "We sparred" leaves the flag in place.
- **692** The club's admins (minus the flagged fighter) get the alert and the list. **Platform
  super admins also see and handle every flag** in their own web-admin list, with no alert. With
  no club admin left, the alert goes to the super admins.
- **693** One of four reasons ("Too hard / unsafe", "Unsafe equipment", "Disrespectful or
  harassing", "Other") **+ a required text** of up to 1000 characters.
- **694** The reporter sees **"sent" only** ("You flagged this spar"). "Handled" is for admins.
- **696** While the flagged fighter's profile (and every profile merged with it) is held by **no
  account**, the flag leaves the club list and shows to super admins only; it returns when the
  profile is linked again.
- **697** A **cancelled** spar can be flagged too (status `agreed`, `done` or `cancelled`), from
  00:00 of its day.
- **698** The safety alert **passes the main notification switch, by email** (no buzz), as an
  organiser broadcast does.

## In plain words

**Sending a flag.** On Saturday at an Event, Marc and Julie spar. Marc keeps hitting Julie's head
hard after she asked him to slow down. On her phone, under the spar in My spars, Julie taps
"Report a safety problem". She picks "Too hard / unsafe", writes what happened and sends it. The
form tells her first: the club running the Event reads it with her name; Marc never sees it. Her
spar card then says "You flagged this spar — the Event's organisers have it". One flag per spar,
final. If Marc cancels the spar afterwards, she can still flag it. For a free-date spar, "the
organisers" are the MyClash team.

**Who reads it.** The club's admins get "A safety report needs a look", with no names and no
reason (it can show on a locked phone); an admin who switched all notices off gets it by email. It
opens the club's "Safety reports" page in web-admin: who reported, who was reported, the spar, the
reason, the text, and a "Handled" box. The MyClash super admins read and mark every flag of every
club on their own page.

**Marc never reads it.** Not when he is an admin of that club (no alert, not listed; if he is the
only admin, the super admins get the alert). Not after unlinking his profile ("This profile is not
me"): the flag remembers his account, and while his profile is held by nobody the flag shows to
super admins only. Not after a merge of his two profiles. No card, count or data-download line
tells him.

**How long.** A flag is deleted 2 years after it was sent (a retention setting). If Julie deletes
her account, the flag stays with her name removed. If Marc deletes his, his flags go with it.

## Global Constraints

- One migration: **0269** (max + 1 at commit time; renumber if another session lands one first).
  Pushed migrations are never edited: 0263-0268 stay. No merge migration (Decision 8).
- New tables: RLS on, no policy (deny-all, 0247 pattern); every CHECK a `CASE … ELSE false END`
  (a CHECK written as an OR reads NULL and passes); `spar_flags` has an `id uuid` PK. SQL
  functions: SECURITY INVOKER, `search_path` pinned, revoked from `public`/`anon`/`authenticated`,
  granted to `service_role` (the 0264 shape).
- Every user-facing string in `en` and `fr`; notice wording in the `notices` i18n keys read by
  `bilingual()` in `notice-texts.ts`, **no names and no reason** (locked phone).
- The fighter route acts on the caller's own profile (`fightBookCaller` + `requireProfile`: an off
  fighter still flags, ruling 666). A stranger's spar id answers 404, never 403.
- **The flagged fighter never reads a flag about them**: not in a payload, a card, either list, an
  alert, the audit log or their data download (anti-goal 4, ruling 656), also when they are a club
  admin or a super admin, after an unlink, and after a merge. `fightbook_flag_shown` is its one
  owner; nothing else decides it.
- Every new write route is filed in `apps/api/src/common/testing/archived-lock-ledger.ts`; every
  platform route gets its row in `modules/admin/guards/platform-role-coverage.test.ts` (375 lines:
  split it if it passes 400); `route-authz.test.ts` stays green with **no new ledger line** (its
  scan passes `assertOrgRole`, `PlatformRoleGuard` and `me` paths, `route-authz-scan.ts:64-65,
237`; `UNDECIDED` is a ratchet). OpenAPI client regenerated in each API commit that adds a route.
- Every new DB read asserts its select string AND its owner filter, with a fixture row the filter
  must exclude; every `.rpc()` payload's keys equal `lastFunctionParams(name)`. Every paged read
  says what bounds the write side.
- Files ≤ 400 lines, functions ≤ 50, test files included (`quality:complexity` after prettier).
  `subject-export.tables.ts` is at 387 lines: split it if the entry takes it past 400.
- Tokenized UI only; no raw ids in UI; no real names in fixtures. Web API paths written whole (the
  route-contract test reads literals).
- Commit subjects start lower-case ("the FightBook …"). Messages via a file and `git commit -F`;
  `git fetch` + `git log --oneline -1` + `git status --short` before staging; explicit paths.

## Decisions taken in this plan (the builder's calls the design and rulings left open)

1. **`spar_flags`** — what the reporter wrote, and the spar it was about: `id uuid` PK;
   `spar_request_id` → `spar_requests` **ON DELETE SET NULL** (an erased reporter's spars are
   deleted, the flag stays); `reporter_global_person_id` → `global_persons` **ON DELETE SET
   NULL**, nullable; `subject_global_person_id NOT NULL` → `global_persons` ON DELETE CASCADE; the
   snapshot: `kind text NOT NULL` (`event`|`free`), `event_id` → `events` ON DELETE SET NULL,
   `organization_id` → `organizations` ON DELETE SET NULL (the Event's club at write time),
   `spar_day date NOT NULL`, `place text`, `weapons text[] NOT NULL`; `reason text NOT NULL`
   (`too_hard`, `equipment`, `disrespect`, `other`); `body text NOT NULL` 1-1000 characters;
   `created_at timestamptz NOT NULL`. CHECKs (named `spar_flags_two_fighters`, `_reason`, `_body`):
   reporter ≠ subject (true when the reporter is null), reason in the four, body length. Unique
   `(spar_request_id, reporter_global_person_id)`. Indexes: `(organization_id, created_at desc)`,
   `(created_at desc)`, and one per FK (`db:review`).
2. **`spar_flag_admin`** — what only admins may know: `flag_id uuid` PK → `spar_flags(id)` ON
   DELETE CASCADE, `subject_user_id uuid` (the account holding the flagged profile when the flag
   was written; null when none; no FK, the actor-UUID shape), `handled_at timestamptz` (null = not
   handled). Written with its flag in one transaction. Its own table because the data download
   carries whole rows (`subject-export.reach.ts`): on `spar_flags`, `handled_at` would reach the
   reporter (ruling 694 shows "sent" only) and `subject_user_id` would hand the reporter another
   person's account id. It sits in `SUBJECT_EXPORT_EXCLUDED_TABLES` with that reason (to the
   subject it would reveal the flag, Art. 15(4)).
3. **`fightbook_profile_family(p_ids uuid[]) returns uuid[]`** — the ids plus every profile joined
   to them by `merged_into_id`, both ways, transitively (a recursive CTE with `UNION`, never
   `UNION ALL`: the walk goes both ways, so `UNION ALL` cycles A→B→A; the reverse walk uses the
   `merged_into_id` index, `0012_fighter_merge.sql:10`; a revert clears `merged_into_id`,
   `0268:573`, so a reverted merge splits the family again). STABLE. `family`, `shown`,
   `flags_page` and `recipients` are `language sql` (a plpgsql `returns table` whose column names
   match the table's raises "column reference … is ambiguous").
4. **`fightbook_flag_shown(p_flag uuid, p_caller uuid, p_club boolean) returns boolean`** — the one
   owner of "who must never read this flag". False when `p_caller` = the flag's `subject_user_id`;
   false when `p_caller` claims (`claimed_by_user_id`, any state, deleted or merged included) any
   profile of the subject's family; when `p_club`, also false unless some profile of the subject's
   family is claimed by an account (ruling 696). Else true. STABLE. Accepted residual (696 sends
   an unheld flag to the super admins): a super admin who unlinked their own profile BEFORE being
   flagged reads that flag on the platform list until they link it again.
5. **`fightbook_flag(p_request, p_reporter, p_reason, p_body, p_now) returns uuid`**, one
   transaction, the `fightbook_review` shape (`0267:155-177`): read the request plainly (none →
   `not_open`); KEY SHARE on both profiles in id order (a merge takes FOR UPDATE on them first);
   the request FOR UPDATE, re-checking both profile columns; the reporter is its asker or
   receiver, status in (`agreed`, `done`, `cancelled`), both profiles live (`merged_into_id`,
   `deleted_at`, `account_deleted_at` null), else `not_open` (P0001). A flag on this request by any
   profile of the reporter's family → return `null`. Else insert the flag (snapshot,
   `organization_id` from `events`, `btrim(p_body)`, `created_at = p_now`) and its
   `spar_flag_admin` row (`subject_user_id` = the subject's `claimed_by_user_id`), return the id; a
   unique violation also returns `null`. The window (691) is checked by the API on the row's
   immutable `spar_day`/`zone` (`sparWindows(row).markFrom`, its one owner), as `markDone` does; no
   end in the API (the web offers the form while the spar shows in My spars, 30 days).
6. **`fightbook_flags_page(p_caller uuid, p_org uuid, p_offset int, p_limit int)`** returns, by
   name, `id, created_at, reason, body, reporter_global_person_id, subject_global_person_id, kind,
event_id, organization_id, spar_day, place, weapons, handled_at` (never `subject_user_id`: the
   API never holds it), where `p_org` is null (platform) or `organization_id = p_org` (club),
   and `fightbook_flag_shown(id, p_caller, p_org is not null)`, by `created_at desc, id desc`. The
   filter runs inside the query, so a page is never cut short after it was read (a short page
   would tell the reader a flag was hidden). **`fightbook_flag_mark(p_caller, p_org, p_flag,
p_handled boolean, p_now timestamptz) returns boolean`**: true means "in that scope and shown",
   whatever the mark was before (a second PUT answers 204, idempotent); on set `handled_at =
coalesce(handled_at, p_now)`, on clear null; false (→ 404) writes nothing. **`fightbook_flag_recipients(p_flag uuid, p_roles text[])
returns table (user_id uuid, audience text, org_slug text)`**: the reporter's accounts (every
   claim on the reporter's family) are left out; club = `organization_members` of the flag's club
   with `role = any(p_roles)` and `fightbook_flag_shown(flag, user, true)`; when none (or no club),
   `platform_roles` with `role = 'super_admin'` and `fightbook_flag_shown(flag, user, false)`.
   **`fightbook_flags_erase(p_uid uuid, p_ids uuid[]) returns jsonb`** `{ deleted, cleared }`,
   reaching no further than the erased account: it deletes a flag whose subject is a profile of
   `fightbook_profile_family(p_ids)` that `p_uid` claims or that no account holds (in a merge of two
   claimed profiles, the other account's profile is not erased with this one); it deletes a flag
   whose `subject_user_id = p_uid` while its subject is unheld or held by `p_uid` (not after a wrong
   autolink was undone and someone else holds it); it clears `reporter_global_person_id` only on
   profiles `p_uid` claims.
7. **API.** `POST me/fightbook/requests/:id/flag`, body `{ reason, text }` (Zod: reason enum; text
   trimmed, 1-1000), 204, in `FightBookAfterController` (155 lines). `SparFlagService.raise`:
   `readMySide` (404 for a stranger), status in the three and `now >= markFrom`, else 409
   `not_open`; then the rpc; an id starts the alert (not awaited); `null` → 204, no second alert (two
   taps: the second asked for what happened). Club routes `GET
organizations/:orgId/fightbook/flags?page=`, `PUT` and `DELETE …/flags/:flagId/handled`: gate
   `orgs.assertOrgRole(orgId, userId, 'admin')`, user id from `requireRequestUserId(req, supabase)`
   (`photos.controller.ts:300-303`), no platform fallback. Platform routes `GET
admin/fightbook/flags?page=` (`@PlatformRole('super_admin')`: a bare GET admits every tier,
   `platform-role.guard.ts:118-125`), `PUT`/`DELETE admin/fightbook/flags/:flagId/handled`
   (default super admin), `@UseGuards(PlatformRoleGuard)` as `photo-platform.controller.ts`,
   `p_caller` from `getActorId(req)` (the `actorUserId` the guard stamps,
   `platform-role.guard.ts`). Both
   read 20 + 1 rows per page through `fightbook_flags_page`, then add names (`readSparFighters`),
   Event names (`readSparEventNames`) and, on the platform list, club names. The write side: one
   flag per reporter-family per spar, deleted after 2 years. `SparFlagListItem = { id; createdAt;
reason; text; reporter: SparFighter | null; flagged: SparFighter; kind; eventName; club; day;
place; weapons; handled }`, `SparFlagPage = { items; more }`.
8. **Merge: no flag moves.** The flag keeps its profile ids; `fightbook_flag_shown`, the recipients
   and erasure follow the merge family. So the merge record (`audit_log`, readable by every platform
   tier, `platform-role-coverage.test.ts:129,169`) never names a flag, and there is no 0270.
   Accepted residual: a fighter's data download leaves out the flags they wrote from a profile
   later merged into the one they hold (the export reaches by the held profile's id).
9. **The alert.** Kind `spar_flag_raised`, `entityId` = flag id, one `sendImmediate` per recipient,
   the account's email (`getAuthAdminUser`), no `preference` (the `fightbook` switch is the
   fighter's own). The worker's one exception to the main switch becomes a set,
   `PASSES_MAIN_SWITCH = new Set(['organizer_broadcast', 'spar_flag_raised'])`
   (`notification-scheduler.worker.ts:886`), so a reader with the main switch off gets it by email
   only (`:834-843`, ruling 698). Only `:886` takes the set: the template choice in
   `sendEmailFallback` stays `=== 'organizer_broadcast'`, or the flag would go out as a broadcast. URL absolute on web-admin from `DOMAIN`:
   `https://admin.${DOMAIN}/org/${org_slug}/fightbook-flags` (club),
   `https://admin.${DOMAIN}/admin/fightbook-flags` (platform). The email fallback keeps a whole
   address as it is (`54cb85908`). Text FR "Un signalement de sécurité à examiner" / "Un combattant
   a signalé un problème de sécurité sur un spar.", EN "A safety report needs a look" / "A fighter
   reported a safety problem on a spar." `CHECKS`/`WANTED` `null`. `p_roles` =
   `rolesAtLeast('admin')`, a new export of `organizations.service.ts` beside `roleAtLeast` (`:64`),
   so the role order keeps one owner (`ORG_ROLE_ORDER`, `:48`). Never throws (logs the flag id).
10. **The reporter's card.** `AgreedSpar.iFlagged: boolean`: a fifth batch read in
    `SparThanksService.cardExtras` (`spar_flags` select `spar_request_id`, `eq
reporter_global_person_id me`, `in spar_request_id`); `NO_EXTRAS.iFlagged = false`;
    `agreedFrom` (`fightbook-patches.ts:14-27`) sets `iFlagged: false`. After a merge the card may
    offer the form again for a spar the other profile flagged; a second send returns `null` (204),
    accepted.
11. **Retention**: `data_retention_settings.spar_flag_days integer NOT NULL DEFAULT 730` (the 0161
    column shape, `0161:76-79`); a `SWEEPS` entry on `spar_flags.created_at`; the settings mapping;
    the Zod `days` rule; web-admin `HORIZONS` with a `hintKey`. The admin rows go by cascade.
12. **Erasure**: `redactSubject` calls `fightbook_flags_erase(uid, globalPersonIds)` beside
    `eraseFightBookRows` (`erasure.service.ts:77`), counts under `spar_flags` and
    `spar_flags.reporter`. Anonymisation keeps flags (the account stays).
13. **Export and archive**: `spar_flags` in `SUBJECT_EXPORT_TABLES`, reaching **the reporter only**,
    note: flags about the subject are left out on purpose (ruling 658, Art. 15(4)): a spar has one
    partner, so a flag names its writer; a departure from gear-check notes, which their subject
    receives. `spar_flag_admin` in `SUBJECT_EXPORT_EXCLUDED_TABLES` (Decision 2). `spar_flags` in
    `ARCHIVE_EXCLUDED_TABLES`. The spec's line placing flags in the excluded set is corrected in
    Task 10 (the coverage test lets a table sit in one set only).
14. **Web.** `SparFlag.tsx` under `SparAfter` on each card with status `agreed`, `done` or
    `cancelled` once the reader's clock passes `markFrom`: one quiet link "Report a safety
    problem"; the form: four radios, the text (required, `maxLength` 1000), "Your name goes with
    this report. {The Event's organisers | The MyClash team} will read it. {partner} never sees
    it.", Send. After sending, or on `iFlagged`: "You flagged this spar — {the Event's organisers
    have it | the MyClash team has it}." The words follow the spar's `kind` only, never where the
    alert went. The reason labels live once in `common.fightBookFlagReason.<code>` (both apps load
    `common`). web-admin: a new nav icon name `safetyReports` (glyph `shield-alert`) in
    `NAV_ICON_NAMES` / `NAV_ICON_GLYPHS` (`packages/ui/src/components/NavIcon.tsx`), glyph file
    regenerated (`node packages/ui/scripts/generate-nav-icons.mjs`), `ui` dist rebuilt before the
    apps typecheck; club page `/org/[slug]/fightbook-flags` (org sidebar, `inWorkshops: true`),
    platform page `/admin/fightbook-flags` (admin nav, `minRole: 'super_admin'`); one shared
    `SparFlagList` with "Show more" and a "Handled" checkbox; a 403 on the club page shows "Only the
    club's admins can read safety reports".

## Review Focus

1. **Marc is an admin of the club, Julie flags him** — no alert to Marc, the club list never shows
   it to him, the other admin gets it; Marc the only admin → the super admins. Tasks 2 and 5.
2. **Marc unlinks his profile, before or after the flag** — after: still hidden from him
   (`subject_user_id`); before: the flag leaves the club list (super admins only) and returns when
   his profile is linked again. Task 2.
3. **Marc's two profiles were merged** (both claimed, or the claim moved to the survivor) — the
   flag about either profile is hidden from both accounts; after a revert, the family splits.
   Task 2.
4. **Two taps on Send** — one flag, one alert, both answers 204. Tasks 2 and 6.
5. **Julie deletes her account after flagging** — the flag stays with "An erased account" as
   reporter and its spar details (snapshot). Tasks 2, 3 and 7.

---

## File map

**DB** — `packages/db/migrations/0269_fightbook_safety_flags.sql`;
`scripts/lib/fightbook-probe-flags.mjs` (new; split if past 400 lines),
`scripts/db-fightbook-probe.mjs`, `scripts/lib/rls-probe-tables.mjs`,
`packages/db/fixtures/rls-probe-seed.sql`.

**Types** — `packages/types/src/fightbook.ts` (`SPAR_FLAG_REASONS`, `SparFlagReason`,
`SparFlagListItem`, `SparFlagPage`, `AgreedSpar.iFlagged`).

**API** — `modules/fightbook/`: `spar-flag.service.ts` (new), `spar-flag-notice.ts` (new),
`spar-flag-admin.service.ts` + `spar-flag-admin.controller.ts` (new),
`fightbook-after.controller.ts`, `spar-thanks.service.ts`, `spar-views.ts`, `fightbook.module.ts`;
`modules/organizations/organizations.service.ts` (`rolesAtLeast`); `modules/privacy/` export
tables, `subject-export.excluded.ts`, `erasure.service.ts`, `retention.service.ts`,
`privacy-admin.controller.ts`; `modules/exports/archive.tables.ts`; `workers/` kind,
`PASSES_MAIN_SWITCH`, `alert-visibility.ts`, `alert-still-wanted.ts`, the kind-list tests;
`notice-texts.ts`; `archived-lock-ledger.ts`, `platform-role-coverage.test.ts`.

**Web** — web-public `app/me/fightbook/SparFlag.tsx` (new), `SparCard.tsx`,
`fightbook-patches.ts`, `use-spar-after.ts`; web-admin `src/components/fightbook/SparFlagList.tsx`
(new), `app/org/[slug]/fightbook-flags/page.tsx` (new), `app/admin/fightbook-flags/page.tsx`
(new), `src/components/org-nav-items.ts`, `src/components/admin-nav.ts`,
`app/admin/data-retention/page.tsx`; `packages/ui/src/components/NavIcon.tsx` + generated glyphs;
i18n `packages/i18n/src/messages/{en,fr}/` (`common`, `publicApp`, `admin`, `organizer`,
`notices`).

**Docs** — ARCHITECTURE §11septies.8 "Safety flags" + §11septies.5 + §11ter.2 row; the spec's
"Safety flag" lines and Build order 4.

---

### Task 1: Migration 0269

**Files:** Create `packages/db/migrations/0269_fightbook_safety_flags.sql`; modify
`scripts/lib/rls-probe-tables.mjs`, `packages/db/fixtures/rls-probe-seed.sql` (template:
`a2d2ffdaf`).

**Interfaces:** Produces the tables of Decisions 1-2, the retention column of Decision 11 and the
functions of Decisions 3-6 with exactly those signatures.

- [ ] **Step 1:** Write the migration; its header says what and why, rulings 691-698, why two
      tables, why no flag moves on a merge, and that `fightbook_flag_shown` is the one owner.
- [ ] **Step 2:** RLS probe: both tables deny-all. `pnpm db:review` green.
- [ ] **Step 3:** Fresh `replay.sh`: replay, rls, merge, cascade, fightbook all 0. On the live
      schema: one CHECK per name on `spar_flags` (`pg_constraint`); reason `rude` refused by
      `spar_flags_reason`, a 1001-character body by `spar_flags_body` (the constraint NAME, not
      23514); each function `has_function_privilege('authenticated', …, 'execute')` false.
- [ ] **Step 4:** Commit `feat(fightbook): the safety flag tables and functions (0269)`.

### Task 2: The probe holds every flag rule

**Files:** Create `scripts/lib/fightbook-probe-flags.mjs`; modify `scripts/db-fightbook-probe.mjs`
(declared count, header list).

- [ ] **Step 1:** Named checks, each in its savepoint, grouped by function.
- [ ] **Step 1a:** `fightbook_flag` — on `agreed`, `done`, `cancelled`: an id, the snapshot equals
      the request, `created_at = p_now`, `spar_flag_admin.subject_user_id` = the subject's account.
      On `pending`, `not_this_time`, `withdrawn`: `not_open`. A stranger: `not_open`. A second flag
      by the same reporter: `null`, one row. The partner's flag: its own row. A merged-away
      reporter: `not_open`.
- [ ] **Step 1b:** `fightbook_profile_family` — S merged into T gives `{S, T}` from either; a chain
      A→B→C gives all three; a revert splits it.
- [ ] **Step 1c:** `fightbook_flag_shown` — the subject's account: false. An unrelated club admin:
      true. Marc unlinked AFTER the flag: still false for him (snapshot). Marc unlinked BEFORE
      (snapshot null, no claim): false for every caller with `p_club`, true for a super admin
      without. Linked again: true for the other admins. S merged into T, both claimed by different
      accounts: false for both. Claim moved to the survivor: false for it on a flag about S. A flag
      about T written during the merge, read after the revert with the claim moved back: hidden from
      the account that held T when it was written, hidden from the club while T is unheld, shown to a
      super admin.
- [ ] **Step 1d:** `fightbook_flags_page` — the club scope lists only its club and never a hidden
      flag; the page is exact (11 flags, 2 hidden: offset 0 limit 5 gives 5 rows, offset 5 gives
      4); newest first; no `subject_user_id` column in the result.
- [ ] **Step 1e:** `fightbook_flag_mark` — sets and clears `handled_at`; a second set keeps the
      first `handled_at` and answers true; another club, or a flag hidden from the caller: false,
      nothing written.
- [ ] **Step 1f:** `fightbook_flag_recipients` — owner and admin listed, a `referee` member not;
      the subject's and the reporter's accounts left out; the subject the only admin: super admins,
      `audience` `platform`; no club: super admins; a `platform_admin` never listed; `org_slug`
      filled for `club`.
- [ ] **Step 1g:** `fightbook_flags_erase` — deletes the flags about the erased account's family
      profiles and the unlinked one (`subject_user_id = p_uid`, unheld); clears its reporter link;
      in a merge of two claimed profiles, erasing account A leaves the flags about B's profile and
      B's reporter link; a flag whose `subject_user_id = p_uid` but whose profile another account
      now holds stays.
- [ ] **Step 1h:** FK actions — an Event deleted keeps `organization_id`; the request deleted keeps
      the flag; deleting a flag deletes its admin row; only `service_role` executes each function.
- [ ] **Step 2:** Fresh replay → green. Break `fightbook_flag_shown`'s snapshot clause by hand → its
      checks red; restore. Commit `test(fightbook): the probe holds every safety flag rule`.

### Task 3: The privacy registries

**Files:** Modify `subject-export.tables.ts`, `subject-export.excluded.ts`,
`subject-export.service.test.ts`, `archive.tables.ts`, `erasure.service.ts` (+ test),
`erasure.aimed-rows.test.ts`.

- [ ] **Step 1:** Failing tests: the export map gives `spar_flags` exactly
      `['reporter_global_person_id']`; `spar_flag_admin` is in the excluded set; `redactSubject`
      calls `fightbook_flags_erase` with keys equal to `lastFunctionParams` (`p_uid`, `p_ids` = the
      claimed profile ids read before the claim is cleared) and adds both counts; a refusal throws.
- [ ] **Step 2:** Registry entries (Decision 13) and the erasure call (Decision 12); the privacy and
      exports suites PASS, coverage tests included. Commit `feat(fightbook): safety flags in the data
download, the archive and erasure`.

### Task 4: The retention horizon

**Files:** Modify `retention.service.ts` (+ test), `privacy-admin.controller.ts` (+ test),
`apps/web-admin/app/admin/data-retention/page.tsx`, i18n (label + hint, en + fr), OpenAPI.

- [ ] **Step 1:** Failing tests: the sweep deletes `spar_flags` with `lt('created_at', now − 730
days)` by default (assert the recorded cutoff); `0` skips it; settings round-trip
      `sparFlagDays`; the PATCH schema accepts 0-10000.
- [ ] **Step 2:** Implement (Decision 11); "Safety reports (FightBook)" / "Signalements de sécurité
      (FightBook)". PASS; commit `feat(privacy): safety flags are deleted after two years (ruling
661)`.

### Task 5: The alert

**Files:** Create `modules/fightbook/spar-flag-notice.ts` + test; modify
`organizations.service.ts` (+ test for `rolesAtLeast`), `workers/notification-scheduler.worker.ts`
(kind, `PASSES_MAIN_SWITCH`), `alert-visibility.ts`, `alert-still-wanted.ts`,
`notification-job-id.test.ts`, `notification-switched-off.test.ts` (NOT in `UNSWITCHED`, which
asserts "no email" with the main switch off, `:155-161`; its own case beside the broadcast one,
`:164-175`: main switch off → `{ phone: 0, email: 1 }` through `mail.sendNotification`),
`alert-still-wanted.test.ts`, `notice-texts.ts` (+ test), `notices` i18n. Template: `e30042ebe`.

**Interfaces:** Produces `rolesAtLeast(min: OrgRole): OrgRole[]` and `notifySparFlagRaised(deps:
SparNoticeDeps & { domain: string }, flagId: string): Promise<void>`.

- [ ] **Step 1:** Failing tests: `rolesAtLeast('admin')` → `['admin', 'owner']`; the notice calls
      `fightbook_flag_recipients` with `{ p_flag, p_roles }` (keys = `lastFunctionParams`), one
      `sendImmediate` per row, kind `spar_flag_raised`, no `preference`, URL
      `https://admin.example.test/org/club-slug/fightbook-flags` for `club` and
      `https://admin.example.test/admin/fightbook-flags` for `platform`, title and body hold no name
      and no reason; a failed rpc logs and resolves. The worker: `spar_flag_raised` with `enabled:
false` → email, no ring; `organizer_broadcast` unchanged.
- [ ] **Step 2:** Implement (Decision 9); PASS; commit `feat(fightbook): a safety flag alerts the
club's admins, or the super admins (rulings 692, 698)`.

### Task 6: Sending a flag (API) and the reporter's card

**Files:** Create `modules/fightbook/spar-flag.service.ts` + test; modify
`fightbook-after.controller.ts` (+ test), `spar-thanks.service.ts` (+ test), `spar-views.ts`,
`fightbook.module.ts`, `packages/types/src/fightbook.ts`,
`apps/web-public/app/me/fightbook/fightbook-patches.ts` (`agreedFrom`) + the spar-card fixtures,
`archived-lock-ledger.ts`, OpenAPI.

**Interfaces:** Consumes `notifySparFlagRaised`. Produces `SparFlagService.raise(me, requestId,
input: { reason: SparFlagReason; text: string }, now?: Date): Promise<void>`, `flagSchema`,
`SPAR_FLAG_REASONS = ['too_hard', 'equipment', 'disrespect', 'other'] as const`, `AgreedSpar.iFlagged`.

- [ ] **Step 1:** Failing tests: a stranger → 404, no rpc; `pending` → 409 `not_open`; `cancelled`
      after `markFrom` → the rpc; one minute before `markFrom` → 409; the payload keys equal
      `lastFunctionParams('fightbook_flag')`; a free-date row in `America/Montreal` opens at Montreal
      midnight; an id starts the alert, not awaited (a never-settling send still resolves); `null` →
      204, no alert; P0001 → 409. Schema through `safeParse`: blank text, 1001 characters, reason
      `rude` → refused. `cardExtras`: my flag → `iFlagged` true; the partner's flag about me
      (fixture) → false; select string and owner filter asserted.
- [ ] **Step 2:** Implement (Decisions 5, 7, 10); PASS; commit `feat(fightbook): a fighter flags a
safety problem on a spar (rulings 691, 693, 697)`.

### Task 7: The two admin lists and the handled mark (API)

**Files:** Create `modules/fightbook/spar-flag-admin.service.ts` + test,
`spar-flag-admin.controller.ts` + test; modify `fightbook.module.ts` (`OrganizationsModule` is
already imported, `fightbook.module.ts:3,22`; add the platform guard's wiring as
`photo-platform.controller.ts`), `platform-role-coverage.test.ts`, `archived-lock-ledger.ts`,
OpenAPI, types.

- [ ] **Step 1:** Failing tests: the club list calls `assertOrgRole(orgId, userId, 'admin')` before
      any read (a refusal → 403, no rpc), then `fightbook_flags_page` with `{ p_caller, p_org,
p_offset: 20 × page, p_limit: 21 }` (keys = `lastFunctionParams`); 21 rows → `more`; names
      from `readSparFighters`, a null reporter → `reporter: null`, the Event name, `club` null; the
      platform list passes `p_org: null` and fills `club` from `organizations.name` (select string
      asserted). Marks: PUT → `fightbook_flag_mark(…, p_handled: true, p_now)`, DELETE → `false`; a
      PUT on a flag already handled → 204 (the rpc answers true); the rpc answering
      false → 404. The platform GET carries `@PlatformRole('super_admin')` (coverage row); the
      writes the default.
- [ ] **Step 2:** Implement (Decision 7); PASS; commit `feat(fightbook): the safety report lists for
club and super admins, with a handled mark (ruling 692)`.

### Task 8: The flag form (web-public)

**Files:** Create `app/me/fightbook/SparFlag.tsx` + test; modify `SparCard.tsx`,
`fightbook-patches.ts` (`flagged` sets `iFlagged`, idempotent; + test), `use-spar-after.ts` (a
`flag(id, body)` handler beside `review`, through `writeFightBook` from
`@/lib/fightbook/read-fightbook`, the path written whole, as `use-spar-after.ts:68-88`), i18n
(`publicApp.fightBook.flag.*`, `common.fightBookFlagReason.*`, en + fr).

- [ ] **Step 1:** Failing tests: before `markFrom` → no link; `agreed`, `done`, `cancelled` after
      `markFrom` → "Report a safety problem"; the form shows four radios, the text box (`maxLength`
      1000), the sentence naming who reads it by `kind` and the partner's name; Send disabled until
      a reason and a non-blank text; Send posts `/api/v1/me/fightbook/requests/{id}/flag` with `{
reason, text }`; 204 → "You flagged this spar…" and no form; 409 → the refusal sentence, form
      kept; `iFlagged` → the line only; buttons disabled while the write runs (`useInFlight`).
- [ ] **Step 2:** Implement (Decision 14); PASS; commit `feat(fightbook): report a safety problem
from the spar card (ruling 694)`.

### Task 9: The safety report pages (web-admin)

**Files:** Modify `packages/ui/src/components/NavIcon.tsx` + generated glyphs (rebuild `ui` dist);
create `src/components/fightbook/SparFlagList.tsx` + test, the two pages; modify
`org-nav-items.ts` + its test, `admin-nav.ts` + `admin-nav.test.ts`, i18n
(`organizer.shell.nav.fightBookFlags`, `admin.shell.nav.fightBookFlags`, the list words). Template:
`app/admin/photos/page.tsx`, `app/org/[slug]/events/[eventId]/photos/page.tsx`.

- [ ] **Step 1:** Failing tests: a row shows date, reason (`common.fightBookFlagReason.*`), text,
      reporter or "An erased account", flagged name, day, Event or place, weapons, club (platform
      only), "Handled"; ticking PUTs, unticking DELETEs, a failure restores the box with a sentence;
      "Show more" asks `page=1`; empty → "No safety reports"; the club page on 403 → "Only the
      club's admins can read safety reports"; the nav entries (org: every member; admin: super
      admin only) with icon `safetyReports`.
- [ ] **Step 2:** Implement; PASS; commit `feat(web-admin): the safety report pages`.

### Task 10: The docs

**Files:** `docs/ARCHITECTURE.md` (§11septies.8 "Safety flags": the window, the two tables and
why, `fightbook_flag_shown` as the one owner and the merge family, the lock, recipients and the
main switch, the lists, retention, erasure, the export; §11septies.5; §11ter.2 row), the spec's
"Safety flag" lines (a "Built in slice 4 (rulings 691-698)" note; the export line corrected) and
Build order 4.

- [ ] **Step 1:** Write; `pnpm format:check` green (run `--write` until `--check` passes); commit
      `docs(fightbook): safety flags (rulings 691-698)`.

### Task 11: Falsify, gates, review, push

- [ ] **Step 1:** `falsify-fb4.mjs` (slice 3's shape; SQL cases on the kept replay container), one
      case per guarantee: each clause of `fightbook_flag_shown` (snapshot, claim, family, held); the
      page's scope filter; the mark's scope and shown checks; the recipients' role filter, its
      reporter exclusion and its platform fallback; the erase's family and `p_uid` clauses; the
      flag's status set; the API's `markFrom` check; the club route's `assertOrgRole`; the platform
      GET's decorator; `iFlagged`'s owner filter; the export reach (reporter only); the retention
      sweep; `PASSES_MAIN_SWITCH`. Each: break, prove the break landed, red, restore, green.
- [ ] **Step 2:** `gates.sh` (32 gates) green; fresh `replay.sh` green (fightbook probe count up).
- [ ] **Step 3:** Cold whole-slice review (`code-architecture-reviewer`, Opus); one fold wave +
      scoped re-review; re-run gates + falsifier; `git fetch`, push, watch CI; memory note,
      `fightbook-prompt.md`, handoff.
