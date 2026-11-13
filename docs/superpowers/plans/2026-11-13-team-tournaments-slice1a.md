# Team Tournaments, slice 1a (foundations) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the base for team Tournaments with no screen change: the words, the renamed side
fields in the scoring engine, the tables, the side key, and a gate that forces every reader of a
Match side to be visited.

**Architecture:** A side of a Match is a Registration or a Team. Database columns keep their names
and gain a team twin. `sideKey(registrationId, teamId)` in `@myclash/types` gives the one id of a
side; the engine's Match-side fields are renamed `*SideId` and are fed that key. A root gate,
`quality:side-readers`, lists every non-test file that names a side link, with a "not yet" ratchet
that slices 1b and 1c empty.

**Tech Stack:** Postgres 17 migrations (`packages/db/migrations`), TypeScript, vitest, NestJS API,
node gate scripts (`scripts/lib/gate.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-13-team-tournaments-design.md`. Executors read both.
Where this plan says "the design", "decision N" or "call N", it means that file.

## Global Constraints

- Hard rule 2: `packages/rulesets/test/tf_v1.fal2026.test.ts` and
  `packages/rulesets/test/fixtures/fal2026.json` are not edited. Neither contains a renamed name.
- Hard rule 4: every new table has RLS on and a policy in the migration that creates it.
- Hard rule 9: one task below is one commit, unless the task says two.
- The clock is not touched in this slice: `apps/api/src/modules/matches/clock.service.ts`,
  `late-press.ts`, `level-step.ts`, `packages/rules/src/clock.ts`. That is why
  `matches/time-limit-result.ts` stays "not yet": its rows are read through `BOUT_COLUMNS`
  (`clock.service.ts:156-161`), which this slice may not widen.
- `apps/api/src/modules/matches/fighter-status.service.ts` gains no team path (decision 7).
- No screen changes and no new API route in this slice. No team can be created through the API
  before slice 1b; team rows exist only in tests and in the migration's own proof block.
- Next migration number is **0271** today. Re-check `ls packages/db/migrations | tail -1` right
  before creating each file; another session may have taken it.
- Any edit or script containing a backslash goes through the Write or Edit tool, never a heredoc.
- Before each commit: `git log --oneline -1`. Other sessions leave staged files in the index, so
  commit by path, `git commit -m "…" -- <paths>`, and never `git add -A` or a bare `git commit`.
  Diff named paths only.
- With each commit that edits code: `pnpm quality:complexity` (the baseline is keyed by line and
  `scoring.service.ts` is on it; re-point it for the edited file only) and the formatter on the
  touched files. Before each push: `git fetch`, then the full chain of the `myclash-gates` skill.
  Run `@myclash/api` and `@myclash/i18n` tests directly, not through turbo.
- Shared packages are read from `dist` on disk. After any change in `packages/rules`,
  `packages/rulesets` or `packages/types`: `pnpm turbo run build --filter="./packages/*"` before
  type-checking an app, and the API type-check goes through `nest build`.
- Entrant fields named `registrationId` (`StandingsRow`, `Fighter`, `SwissPlayer`,
  `ScorePoolFightersInput.registrationIds`) are **not** renamed in this slice (call 23).

## Review Focus

Failure modes the design implies and no happy-path test exercises, most likely first. Each has its
test in the task named.

1. **A mapper that compiles but skips the side key.** `redSideId: m['red_registration_id'] as
string` type-checks; a team then scores zero in silence. Expected: the gate goes red. Test:
   Task 8, "a raw assignment into a side id is a finding".
2. **A row holding both a Registration and a Team on one side.** Expected: the database refuses
   it, and `sideKey` throws if such a row is ever read. Tests: Task 5 proof block; Task 6
   "throws when both are present".
3. **Deleting an Event that holds teams.** Teams, slots and Matches die by cascade from one
   ancestor; a wrong foreign-key action fails the delete at once. Expected: the delete succeeds at
   commit. Test: Tasks 4 and 5, the cascade probe with team rows in its seed.
4. **Restoring an archive of a Tournament with teams.** Expected: no id of the source survives in
   the copy. Test: Task 4 and 5, the archive sentinel sweep with team rows in its fixture.
5. **A Match with no side yet (bracket placeholder).** Expected: `sideKey(null, null)` is `null`,
   and nothing treats two empty sides as the same side. Test: Task 6; Task 7 "the winner columns
   of a Match with no sides are refused, not guessed".

Known gap, stated and not closed here: the race "add a Registration while the kind changes" is
argued from the row locks in Task 4 and tested one writer at a time. A forced-overlap probe needs a
second writer through the API and belongs to slice 1b, where the teams routes land.

---

### Task 1: Save the design and this plan — DONE 2026-11-13

Done by the session that wrote them: the design is
`docs/superpowers/specs/2026-11-13-team-tournaments-design.md`, this plan is this file, and each
was committed alone. Start at Task 2.

### Task 2: The words and the rulings

**Files:**

- Modify: `docs/HIERARCHY.md` (`:80` diagram line, `:97` Match row, `:117` Fighter row, the
  definitions table, "Code naming")
- Create: `docs/decisions/ADR-022-team-is-a-second-kind-of-side.md`
- Modify: `docs/decisions/ADR-016-referee-rules-one-checker.md` (new dated section at the end)
- Modify: `CLAUDE.md` (hard rule 8)
- Modify: `docs/ARCHITECTURE.md` (data model section: the three new columns/tables; §7.3 is not
  touched in this slice)

**Interfaces:**

- Produces: the words **Team, Slot, Side, Line-up, Captain, Reserve, Leg**, with the meanings in
  the design's "Words" table, verbatim.

- [ ] **Step 1:** In `docs/HIERARCHY.md`: Match becomes "A single fight between two sides. Always
      belongs to a phase."; Fighter becomes "Competes in a tournament — holds a Registration, or a slot
      in a Team."; the identity diagram's last line becomes "the two sides of a fight are Registrations
      or Teams, never Persons"; add the seven words to the definitions table; add `teams`, `team_slots`
      to "Code naming".
- [ ] **Step 2:** Write ADR-022 in the shape of ADR-016 (Date, Status: Accepted, Context,
      Decision, Consequences). Decision: decision 6 of the design, the side key, the rename boundary of
      call 23, and "a missed reader is not safe; the gate is the guard". Consequences: approach A and
      why the operator declined it twice.
- [ ] **Step 3:** Append to ADR-016 a section "2026-11-13 — the rule's reach for Teams" with
      decision 11, verbatim.
- [ ] **Step 4:** In `CLAUDE.md` rule 8, after "These rules have no setting and no override." add:
      "They protect a person MyClash can name: a Fighter in a Team slot with no name is outside them,
      and the Teams screen and the referee board say so (ADR-016, 2026-11-13)."
- [ ] **Step 5:** Verify: `rg -n "between two sides" docs/HIERARCHY.md` prints one line;
      `rg -n "Team slot with no name" CLAUDE.md` prints one line; `pnpm quality:docs-drift` is green
      (it reads `CLAUDE.md`, `docs/ARCHITECTURE.md` and `CONTRIBUTING.md`).
- [ ] **Step 6:** Commit: `docs(hierarchy): a Match side is a Registration or a Team (ADR-022)`.

### Task 3: Rename the engine's Match-side fields

Names change; no value changes. One commit.

**Files:**

- Modify, `packages/rules/src`: `domain.ts:44-47` and `:83-87` (and the comments at `:60`, `:70`),
  `match-format.ts:400-410`, `:433-440`, `:840-851`, `tf_v1/score.ts:43-50`,
  `formula/derive-stats.ts:102-104`, `results/fighter-career.ts:226-229` and `:311-314` (the keys
  of the two `boutOutcomes` literals only), `index.ts`, and every test in that package that names
  the three fields.
- Modify, `packages/rulesets/src`: `tf_v1/index.ts:85-92`, `generic_points_cap/index.ts:187-196`,
  `match-format.ts`, `index.ts`, and every test that names the three fields;
  `packages/rulesets/test/tf_v1.afterblow-golden.test.ts:44-45`,
  `packages/rulesets/test/registered-editions.test.ts:129`.
- Modify, forced by the types: `packages/types/src/match-winner.ts:45`,
  `apps/api/src/modules/matches/correction-outcome.ts:30-47`,
  `apps/api/src/modules/matches/scoring.service.ts:105-153`, `:232`, `:254`, `:532`, `:603`, `:644`,
  `:840-845`, `apps/api/src/modules/pool-standings/ruleset-scores.ts:49-53`,
  `pool-standings/compute-rows.ts:118-134`, `matches/time-limit-result.ts:48-54` and `:138-144`,
  `staff/staff.service.ts:1901-1911`, `matches/match-summaries.ts:144-154`,
  `fighters/fighters.service.ts:1088-1094`, `fighters/recent-matches.ts:90`,
  `persons/public-schedule.service.ts:332-340`, and the tests of those files. The private method
  `endWinnerRegistrationId` (`scoring.service.ts:644`) becomes `endWinnerSideId`.

**Interfaces:**

- Produces, in `@myclash/rules`: `Match { redSideId: string; blueSideId: string }`,
  `ScoredMatch { redSideId: string; blueSideId: string; winnerSideId: string | null }`,
  `winnerColorFrom(bout: { winnerSideId?; redSideId?; blueSideId?; redScore?; blueScore? })`,
  `boutOutcomes(bout: { winnerSideId?; redSideId?; blueSideId?; ...; endReason })`,
  `getPointCapWinnerSideId(match, …)` (was `getPointCapWinnerRegistrationId`),
  `computeAggregates(registrationId: string, match: Pick<Match, 'redSideId'>, …)`.
- Unchanged on purpose: `resolveMatchWinner`'s own signature in `packages/types` (it maps inside,
  at `:45`), `CareerMatchInput`, every entrant `registrationId`, every DTO and wire name.

- [ ] **Step 1: Record the baseline.** Run and keep the pass counts:
      `pnpm --filter @myclash/rules test`, `pnpm --filter @myclash/rulesets test`,
      `pnpm --filter @myclash/types test`, `pnpm --filter @myclash/api test`,
      `pnpm --filter @myclash/web-staff test`.
- [ ] **Step 2: Rename in `packages/rules` and `packages/rulesets`.** Only the three field names
      and the one function name, in the declarations and readers listed above and in their tests.
- [ ] **Step 3: The two call sites the compiler will NOT catch.** The side fields of
      `winnerColorFrom` and `boutOutcomes` are optional, so a caller that passes a **variable** still
      carrying the old names compiles, and the stored winner is then ignored in silence: the bout is
      called by its points. Three callers do this, and all are changed by hand, now:
  - `apps/api/src/modules/fighters/recent-matches.ts:90` passes a `RecentMatchRow` variable. Map
    it explicitly, as in `match-winner.ts` below; `RecentMatchRow` keeps its own names.
  - `packages/types/src/match-winner.ts:45` passes `input`. Replace with
    `winnerColorFrom({ winnerSideId: input.winnerRegistrationId, redSideId:
input.redRegistrationId, blueSideId: input.blueRegistrationId, redScore: input.redScore,
blueScore: input.blueScore })`.
  - `apps/api/src/modules/matches/correction-outcome.ts` passes its `bout` to `boutOutcomes`
    (`:110-111`). Rename the fields of `CorrectionInput.bout` (`:33-43`) and of its builder
    `storedBout` (`scoring.service.ts:143-153`).
    Then list every call and read each one:
    `rg -n "winnerColorFrom\(|boutOutcomes\(|resolveMatchWinner\(|deriveMatchOutcome\(" apps packages`.
    A call that passes an object literal is caught by the compiler; a call that passes a variable is
    not, and is checked by eye.
- [ ] **Step 4: Build, and fix each compile error by renaming the key and nothing else.**
      `pnpm turbo run build --filter="./packages/*"`, then the API through `nest build`. In the API
      mappers the right-hand sides stay as they are (`redSideId: m['red_registration_id'] as string`);
      Task 7 changes them. Do not add a `default:` or a cast to quiet an error.
- [ ] **Step 5: Type-check.** Rebuild packages, then the API through `nest build`, then the three
      web apps — expected: clean.
- [ ] **Step 6: Tests.** The five commands of Step 1 — expected: the same pass counts as the
      baseline, and the same number of collected tests.
- [ ] **Step 6b: Prove Step 3 is held by a test, not by eye alone.** For each of the three silent
      callers, find or add one test of "a bout awarded against the points": the stored winner is red,
      blue has more points, the answer is red (`fighters/recent-matches.test.ts:42-49` is one already).
      Then put the old field names back in that one caller and see that test go red, with the
      collected count unchanged. Restore. A caller with no such test gets one in this commit; it is
      the only new test this task may add.
- [ ] **Step 7: Prove the diff changes names only.** On the paths of this task only, never the
      whole tree: `git diff -U0 -- <paths> | rg "^[+-][^+-]" | rg -v "SideId|RegistrationId"`.
      Expected: the lines of the three explicit mappings of Step 3, the one test Step 6b may add, and
      lines a formatter re-wrapped. Read each. Any other line is a change of value and is taken out.
- [ ] **Step 8: Golden test.** `pnpm --filter @myclash/rulesets exec vitest run
test/tf_v1.fal2026.test.ts` — expected: PASS; `git status --short packages/rulesets/test/fixtures`
      prints nothing.
- [ ] **Step 9: Commit:** `refactor(rules): a Match side is a side id, not a Registration id`.

### Task 3b: The archive can collect a table through two parents

A Tournament archive finds its Persons through Registrations
(`apps/api/src/modules/exports/archive.tables.ts:153`). A team member has none, so Task 4 needs
Persons found through team slots as well. Today a collect rule names one parent
(`archive.table-spec.ts:85-102`) and the resolver reads one (`archive.service.ts:736-741`). This
task widens the grammar and changes no archive.

**Files:**

- Modify: `apps/api/src/modules/exports/archive.table-spec.ts` (the `collect` type),
  `archive.service.ts:716-747` (the resolver), `archive.tables.test.ts:85-160` (the graph tests
  must walk every parent of a rule)
- Test: `apps/api/src/modules/exports/archive.service.test.ts`, or the resolver's nearest test file

**Interfaces:**

- Produces: in a table's `collect`, a scope may hold `CollectRule | readonly CollectRule[]`. For a
  list, the rows of each rule are fetched and merged, one row per `id`.

- [ ] **Step 1: Failing test.** A table collected through two parents whose rows overlap gives
      the union, each `id` once; a list with one rule gives what that rule gives alone.
- [ ] **Step 2:** Run it — FAIL. Implement: the resolver calls `rowsForRule` once per rule and
      merges by `id`. The graph tests read a list as several edges. Run — PASS.
- [ ] **Step 3:** `pnpm --filter @myclash/api exec vitest run src/modules/exports` — green, same
      collected count plus the new test. No table uses a list yet.
- [ ] **Step 4: Commit:** `refactor(exports): an archived table may be collected through two parents`.

### Task 4: Migration — a Tournament has a kind; teams and their slots

**Files:**

- Create: `packages/db/migrations/0271_team_tables.sql`
- Modify: `apps/api/src/modules/exports/archive.tables.ts` (entries `teams`, `team_slots`, placed
  after `registrations`; `SHARED_FK_COLUMNS` gains `team_id: { map: 'teams' }`; **and the persons
  of a Tournament archive are also collected through `team_slots`**: at `:153` the `tournament`
  scope becomes the list `[{ from: 'registrations', local: 'id', parent: 'person_id' }, { from:
'team_slots', local: 'id', parent: 'person_id' }]`, the grammar of Task 3b),
  `apps/api/src/modules/exports/archive.table-spec.ts:28` (`ID_MAP_NAMES` gains `'teams'`), the
  archive fixture used by `archive.service.test.ts` (one team, one **named** slot and one empty
  one), and the `en`/`fr` label per table that `archive.tables.test.ts` requires. The named slot is
  the point: with an unnamed one only, the sweep "no id of the source survives a restore" passes
  while a restored slot still points at a Person of the source Event.
- Modify: `apps/api/src/modules/privacy/subject-export.tables.ts`
  (`team_slots: { reaches: [{ column: 'person_id', reach: 'person' }], file: 'events.csv' }`)
- Modify: `scripts/db-cascade-probe.mjs` (`DEFERRED_KEYS` at `:91-101` gains
  `team_slots_person_id_fkey`, **kept in sorted order**, which `:163` and `:173` rely on; `SEEDED`
  at `:104-132` gains one line per new seeded row, or `EXPECTED_CHECKS` never moves),
  `packages/db/fixtures/cascade-probe-seed.sql` (a second, team Tournament in the seeded Event, one
  team, one named slot), `EXPECTED_CHECKS` to the number the probe then reports.
- Modify: the RLS probe. Its seed gains one team with one slot under the seed's published
  Tournament and one under its draft Tournament. `scripts/lib/rls-probe-tables.mjs` gains two
  `VERDICTS` lines (`teams`, `team_slots`: the published rows `visible`, the draft rows `hidden`)
  and two `API_ONLY_WRITES` lines. Nothing forces these lines, and without them a policy written
  `using (true)` passes every other check.
- Create: `scripts/lib/team-tables-probe.mjs`, called from `scripts/db-rls-probe.mjs` as its next
  numbered check, in the shape of check 15 (`scripts/lib/forfeit-draw-probe.mjs`): each case runs
  as the owner in a savepoint that is rolled back, and a refusal is matched **by constraint name
  or by the trigger's message**, not by "some error".

**Interfaces:**

- Produces: column `tournaments.entrant_kind text not null default 'individual'`
  (`'individual' | 'team'`), column `tournaments.team_default_size integer` (1–20, nullable),
  tables `teams` and `team_slots` as below, functions `entrant_kind_holds()` and
  `entrant_kind_is_settled()`.

- [ ] **Step 1: Write the migration.** Header in the 0270 style (`-- 0271: …`, numbered
      paragraphs, closing posture line). First statement: `set constraints all immediate;` (the rule
      of `0237_cascade_deletes_check_at_commit.sql:39-43`). Then:

```sql
alter table public.tournaments
  add column if not exists entrant_kind text not null default 'individual',
  add column if not exists team_default_size integer;
alter table public.tournaments
  add constraint tournaments_entrant_kind_known
    check (case when entrant_kind in ('individual', 'team') then true else false end),
  add constraint tournaments_team_default_size_range
    check (case when team_default_size is null then true
                when team_default_size between 1 and 20 then true else false end);

create table if not exists public.teams (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  name          text not null,
  slug          text not null,
  size          integer not null,
  seed          integer,
  color         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint teams_id_tournament_key unique (id, tournament_id),
  constraint teams_size_range check (case when size between 1 and 20 then true else false end),
  constraint teams_name_filled
    check (case when length(btrim(name)) between 1 and 120 then true else false end),
  constraint teams_slug_shape check (case when slug ~ '^[a-z0-9-]{2,100}$' then true else false end)
);
create unique index if not exists teams_tournament_name_key on public.teams (tournament_id, lower(name));
create unique index if not exists teams_tournament_slug_key on public.teams (tournament_id, slug);

create table if not exists public.team_slots (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null,
  tournament_id uuid not null,
  position      integer,
  person_id     uuid references public.persons (id) deferrable initially deferred,
  is_captain    boolean not null default false,
  retired_at    timestamptz,
  created_at    timestamptz not null default now(),
  constraint team_slots_team_fkey foreign key (team_id, tournament_id)
    references public.teams (id, tournament_id) on delete cascade,
  constraint team_slots_position_positive
    check (case when position is null then true when position >= 1 then true else false end),
  constraint team_slots_seat_or_reserve check (position is not null or person_id is not null),
  constraint team_slots_captain_is_named check (not is_captain or person_id is not null)
);
create unique index if not exists team_slots_one_per_position
  on public.team_slots (team_id, position) where position is not null and retired_at is null;
create unique index if not exists team_slots_one_team_per_person
  on public.team_slots (tournament_id, person_id) where person_id is not null and retired_at is null;
create unique index if not exists team_slots_one_captain
  on public.team_slots (team_id) where is_captain and retired_at is null;
create index if not exists team_slots_person_idx
  on public.team_slots (person_id) where person_id is not null;
```

There is no `logo_url` yet: the archive's guard wants every `_url` column carried or listed and
pins their number (`archive.migration-coverage.test.ts:359-382`), and nothing can write a logo
before the upload route of slice 1b. The column comes with that route.
The size limit of 20 is this plan's call; the design gives none. `team_slots.person_id` is
`NO ACTION DEFERRABLE INITIALLY DEFERRED` because a Person and a slot both die by cascade from
one Event, the case 0237 rules on. A slot's number is checked against its team's `size` by the
API in slice 1b, not here.

- [ ] **Step 2: RLS, in the same file.** `enable row level security` on both tables. Policies
      `teams_select` and `team_slots_select`, each a copy of `registrations_select`
      (`0203_draft_tournament_row_hidden.sql:38-52`) with the table name changed. No write policy and
      no revoke: 0247 closes writes on every new table.
- [ ] **Step 3: The kind trigger, in the same file.** Two functions, `language plpgsql`,
      `security invoker`, `set search_path = public, pg_catalog`, `revoke execute … from public, anon,
authenticated`, each raising `errcode = 'check_violation'`:
  - `entrant_kind_holds()` — `BEFORE INSERT OR UPDATE OF tournament_id` on `registrations` and on
    `teams`. It reads the Tournament's kind with `select entrant_kind … for share` and refuses a
    Registration unless the kind is `individual`, a Team unless it is `team`.
  - `entrant_kind_is_settled()` — `AFTER UPDATE OF entrant_kind` on `tournaments`, `WHEN
(old.entrant_kind is distinct from new.entrant_kind)`. It refuses the change when a
    Registration or a Team of that Tournament exists. Without the `WHEN`, a save that sends the
    same kind again would be refused on every Tournament that has entrants.
    The race, written in the header: the entrant's `for share` waits for a running change of kind
    and then reads the kind of after it; the change is checked **after** its own row lock, in a new
    snapshot, so it sees an entrant committed meanwhile. A `BEFORE UPDATE` check would not.
- [ ] **Step 4: The proof block, catalog only.** As 0239 to 0270 do, the migration proves what
      landed by reading the catalog and seeds no row (it also runs on production). It asserts:
      `relrowsecurity` is true on both tables; each has exactly one policy and its `qual` text contains
      `is_org_member` and `'published'`; each named constraint and each unique index exists exactly
      once; both triggers exist on their tables. End with `notify pgrst, 'reload schema';`.
- [ ] **Step 5: The behaviour, in the RLS probe.** `team-tables-probe.mjs` holds these cases:
      a second slot for one person in one Tournament is refused by `team_slots_one_team_per_person`;
      a second captain by `team_slots_one_captain`; a captain with no person by
      `team_slots_captain_is_named`; a Registration in a team Tournament and a Team in an individual
      one by the kind trigger; a change of kind with an entrant by the kind trigger; a change of kind
      with no entrant is taken; **an update that sends the same kind on a Tournament with entrants is
      taken**. The `VERDICTS` lines prove the policy: an outsider reads the published team and not the
      draft one.
- [ ] **Step 6: Registries.** The archive, subject-export, cascade-probe and RLS-probe edits
      listed under Files.
- [ ] **Step 7: Run.** `pnpm db:review` — green. `pnpm db:migrations:replay` on a throwaway
      Postgres 17 — green. `pnpm db:cascade-probe` — green with the new seed rows; set
      `EXPECTED_CHECKS` to its reported count. `pnpm db:rls-probe` — green, with one check more.
- [ ] **Step 8: Falsify, three times.** The replay script reads the migrations folder as it is
      (`scripts/replay-db-migrations.mjs:17`), so each break is made in the real file, with a scratch
      copy kept beside it to restore from; after each, `git diff --stat` on the file is empty again.
      (a) Delete the index `team_slots_one_team_per_person`, check the text changed, replay, run the
      RLS probe: the "second slot" case is red. (b) Write the `teams_select` policy as `using (true)`,
      replay, probe: the draft team's `hidden` verdict is red. (c) In `archive.tables.ts`, take
      `team_slots` out of the persons list: the archive's sentinel sweep on the Tournament path is red
      on the named slot.
- [ ] **Step 9: API tests, run directly.** `pnpm --filter @myclash/api exec vitest run
src/modules/exports src/modules/privacy src/common/db-schema-conformance.test.ts` — green,
      with the collected count not lower than before.
- [ ] **Step 10: Commit:** `feat(db): a Tournament has a kind; teams and their slots (0271)`.

### Task 5: Migration — a team twin beside each side link

**Files:**

- Create: `packages/db/migrations/0272_team_twins.sql`
- Modify: `apps/api/src/modules/exports/archive.tables.ts` (`SHARED_FK_COLUMNS` gains
  `red_team_id`, `blue_team_id`, `winner_team_id`, `team_a_id`, `team_b_id`,
  `forfeiting_team_id`, each `{ map: 'teams' }`), the archive fixture (one team Match, one team
  Pool member).
- Modify: `scripts/db-cascade-probe.mjs` (`DEFERRED_KEYS` gains `matches_red_team_id_fkey`,
  `matches_blue_team_id_fkey`, `match_forfeits_forfeiting_team_id_fkey`,
  `match_forfeits_winner_team_id_fkey`, in sorted order; `SEEDED` gains the new rows),
  `packages/db/fixtures/cascade-probe-seed.sql` (a team Match and a team forfeit),
  `EXPECTED_CHECKS`.
- Modify: `scripts/lib/team-tables-probe.mjs` (the cases of Step 3).

**Interfaces:**

- Produces these nine columns, each `uuid references public.teams (id)`, with the delete action of
  its Registration twin:

| Table             | New column           | On delete           | Check added                                                                 |
| ----------------- | -------------------- | ------------------- | --------------------------------------------------------------------------- |
| `pool_members`    | `team_id`            | cascade             | `pool_members_one_entrant`: exactly one of `registration_id`, `team_id`     |
| `bracket_slots`   | `team_a_id`          | set null            | `bracket_slots_a_one_kind`: at most one of `registration_a_id`, `team_a_id` |
| `bracket_slots`   | `team_b_id`          | set null            | `bracket_slots_b_one_kind`                                                  |
| `matches`         | `red_team_id`        | no action, deferred | `matches_red_one_kind`                                                      |
| `matches`         | `blue_team_id`       | no action, deferred | `matches_blue_one_kind`                                                     |
| `matches`         | `winner_team_id`     | set null            | `matches_winner_one_kind`                                                   |
| `match_penalties` | `team_id`            | cascade             | `match_penalties_one_side`: exactly one                                     |
| `match_forfeits`  | `forfeiting_team_id` | no action, deferred | `match_forfeits_forfeiting_one_kind`: exactly one                           |
| `match_forfeits`  | `winner_team_id`     | no action, deferred | `match_forfeits_winner_one_kind`: at most one                               |

- [ ] **Step 1: Write the migration.** `set constraints all immediate;` first. Add the nine
      columns. Write each check with `num_nonnulls(a, b) = 1` or `<= 1`. Also:
  - `alter column … drop not null` on `pool_members.registration_id`,
    `match_penalties.registration_id`, `match_forfeits.forfeiting_registration_id`.
  - `matches_sides_same_kind`: a Match never has a Registration on one side and a Team on the
    other.
  - Replace `match_forfeits_draw_has_no_winner` (`0239:33-35`), which today reads "no winner
    Registration" as "draw" and would refuse a team win. Drop it **by name with no `IF EXISTS`**,
    as 0239 did, and add it again as `check ((score_policy = 'draw') = (winner_registration_id is
null and winner_team_id is null))`.
  - `create unique index pool_members_pool_team_key on public.pool_members (pool_id, team_id)
where team_id is not null`.
    No "team of the same Tournament" trigger: nothing checks that for a Registration today either,
    and adding it for one kind only is a second rule to keep in step.
- [ ] **Step 2: The proof block, catalog only.** Each of the eleven constraint names above exists
      exactly once. For `match_forfeits_draw_has_no_winner`, compare its `pg_get_constraintdef` text
      with the expected text, as `0239_match_forfeits_draw.sql:54-61` does. Do not count "checks that
      mention `score_policy`": two do, `match_forfeits_score_policy_allowed` (`0239:28-30`) and this
      one.
- [ ] **Step 3: The behaviour, in the RLS probe.** Add to `team-tables-probe.mjs`: a Pool member
      with both ids is refused by `pool_members_one_entrant`; with neither, by the same; a Match with a
      Registration red and a Team blue by `matches_sides_same_kind`; a team win on a forfeit that is
      not a draw is taken; a draw with a winner Team is refused by
      `match_forfeits_draw_has_no_winner`. Check 15 (`forfeit-draw-probe.mjs`) must still pass
      untouched: the constraint keeps its name.
- [ ] **Step 4: Registries**, as listed under Files.
- [ ] **Step 5: Run.** `pnpm db:review` (new unindexed-foreign-key warnings on the twin columns
      are expected; list them in the commit body, their indexes come with their first reader in 1b),
      `pnpm db:migrations:replay`, `pnpm db:cascade-probe`, `pnpm db:rls-probe` — green.
- [ ] **Step 5b: Falsify.** In the real file, with a scratch copy to restore from, delete
      `and winner_team_id is null` from the rewritten check; replay — expected: the proof block fails
      on the definition text. Restore; `git diff --stat` on the file is empty.
- [ ] **Step 6: API tests, run directly:** `pnpm --filter @myclash/api exec vitest run
src/modules/exports src/common/db-schema-conformance.test.ts` — green.
- [ ] **Step 7: Commit:** `feat(db): a team twin beside each side link (0272)`.

### Task 6: `sideKey`

**Files:**

- Create: `packages/types/src/side-key.ts`
- Test: `packages/types/src/side-key.test.ts`
- Modify: `packages/types/src/index.ts` (export it)

**Interfaces:**

- Produces: `export function sideKey(registrationId: string | null | undefined, teamId: string |
null | undefined): string | null`

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from 'vitest';
import { sideKey } from './side-key';

describe('sideKey', () => {
  it('is the Registration id of an individual side', () => {
    expect(sideKey('reg-1', null)).toBe('reg-1');
  });
  it('is the Team id of a team side', () => {
    expect(sideKey(null, 'team-1')).toBe('team-1');
  });
  it('is null for a side not known yet, and reads undefined as null', () => {
    expect(sideKey(null, null)).toBeNull();
    expect(sideKey(undefined, undefined)).toBeNull();
  });
  it('throws when both are present: the database refuses that row', () => {
    expect(() => sideKey('reg-1', 'team-1')).toThrow(/both a Registration and a Team/);
  });
  it('does not read an empty string as an id', () => {
    expect(sideKey('', 'team-1')).toBe('team-1');
    expect(sideKey('', '')).toBeNull();
  });
});
```

- [ ] **Step 2:** `pnpm --filter @myclash/types exec vitest run src/side-key.test.ts` — expected:
      FAIL, module not found.
- [ ] **Step 3:** Implement `sideKey` to those five cases. The file's doc comment says what a side
      is and cites ADR-022.
- [ ] **Step 4:** Same command — expected: PASS, 5 tests.
- [ ] **Step 5: Falsify.** Make the both-present case return the Registration id; the fourth test
      goes red; restore.
- [ ] **Step 6:** `pnpm turbo run build --filter=@myclash/types`.
- [ ] **Step 7: Commit:** `feat(types): one key for a Match side`.

### Task 7: The API feeds the engine the side key, and writes its winner back by side

This task is the scoring service only. Its reads and its writes sit in one file, so a test can
pin the read string and the written row together.

**Files:**

- Create: `apps/api/src/modules/matches/winner-columns.ts`, test `winner-columns.test.ts`
- Modify: `apps/api/src/modules/matches/scoring.service.ts`: `rulesetMatch` (`:125-141`),
  `storedBout` (`:143-153`), the winner writes at `:232`, `:254` and `:840-845`, the `matches`
  select strings that feed them, and `buildRoundClosure` (`:809-819`), which has no bout row in
  scope today and receives it as a new parameter.
- Modify: `apps/api/src/modules/matches/reopen-match-columns.ts:28` and `:96`: where a reopen
  clears `winner_registration_id`, it clears `winner_team_id` too.
- Test: `scoring.service` tests and the reopen tests.

**Interfaces:**

- Consumes: `sideKey` (Task 6); columns `red_team_id`, `blue_team_id`, `winner_team_id` (Task 5).
- Produces: `export function winnerColumns(row: { red_registration_id: string | null;
red_team_id: string | null; blue_registration_id: string | null; blue_team_id: string | null },
winnerSideId: string | null): { winner_registration_id: string | null; winner_team_id: string |
null }`. It finds the winner's colour by comparing `winnerSideId` with `sideKey` of each side and
  returns that side's own two columns; `null` gives both `null`; an id that is neither side throws.

Not in this task, and left "not yet, 1b" in the gate's ledger, each for a stated reason:

- `matches/time-limit-result.ts` (mappers at `:48-54`, `:138-144`, and a **fourth winner write at
  `:147-148`**): its rows come through the clock's read list, which this slice does not touch.
- `pool-standings/compute-rows.ts` and `ruleset-scores.ts`: a team bout is skipped at
  `compute-rows.ts:102-104` before any side is read, their reads live in
  `pool-standings.service.ts:155`, and Swiss feeds them too
  (`swiss/swiss-standings.service.ts:156-167`). They change with the entrant fields, in 1b.
- The card comparison (`scoring.service.ts:628`), the scheduler
  (`schedule/match-scheduler.ts:267`), the scorekeeper screen
  (`apps/web-staff/src/offline/pending-events.ts`), forfeits.

- [ ] **Step 1: Failing test for `winnerColumns`.** Cases: individual red wins →
      `{ winner_registration_id: 'reg-r', winner_team_id: null }`; team blue wins →
      `{ winner_registration_id: null, winner_team_id: 'team-b' }`; `null` → both `null`; an id that is
      neither side → throws `/neither side/`; a row with no sides and a non-null winner → throws.
- [ ] **Step 2:** Run it — FAIL. Implement. Run — PASS.
- [ ] **Step 3: Failing tests through the scoring service**, in the house pattern
      (`selectsFor(db.from, 'matches')`, `apps/api/src/common/testing/supabase-chain.ts:213`):
  - scoring an Exchange on a bout row `{ red_registration_id: null, red_team_id: 'team-r',
blue_registration_id: null, blue_team_id: 'team-b' }` hands the engine a Match with
    `redSideId === 'team-r'` and `blueSideId === 'team-b'` (assert on what the ruleset double
    received);
  - every `matches` select string the service sends is pinned whole with `toEqual`, and each
    holds `red_team_id`, `blue_team_id` and `winner_team_id`.
- [ ] **Step 4:** Run them — FAIL. Change `rulesetMatch` and `storedBout` to
      `sideKey(row.red_registration_id, row.red_team_id)` and add the team columns to the selects.
      Run — PASS.
- [ ] **Step 5: Failing tests for the outbound writes**, one per write: a team Match the engine
      ends for red writes `winner_team_id: 'team-r'` and `winner_registration_id: null`, for the
      single-fight path (`:232`, `:254`) and for a best-of round closure (`:840-845`). And: a reopened
      team Match has both winner columns cleared. Then replace each write with
      `...winnerColumns(row, winnerSideId)`, pass the row into `buildRoundClosure`, and add the clear.
      Run — PASS.
- [ ] **Step 6: Individual behaviour is unchanged.** `pnpm --filter @myclash/api test` —
      expected: green. `git diff` on the test files of this task shows added tests and widened select
      strings only; no result of an existing individual case changed.
- [ ] **Step 7: Falsify.** In `rulesetMatch`, put back `m['red_registration_id'] as string`; the
      mapper test of Step 3 goes red; the collected count is unchanged; restore.
- [ ] **Step 8:** `pnpm --filter @myclash/api exec vitest run
src/common/db-schema-conformance.test.ts` — green (the new columns exist since 0272).
- [ ] **Step 9: Commit:** `refactor(matches): scoring feeds the engine a side key and writes its winner by side`.

### Task 8: The gate `quality:side-readers`

**Files:**

- Create: `scripts/check-side-readers.mjs`, `scripts/check-side-readers.test.mjs`,
  `scripts/side-readers-ledger.json`
- Modify: `package.json` (`"quality:side-readers": "node scripts/check-side-readers.mjs"`, alone,
  not chained), `.github/workflows/ci.yml` (Lint job: step `Check Match side readers`, with
  `if: '!cancelled()'`, `run: pnpm quality:side-readers`),
  `apps/api/src/modules/admin/ci-health/gates.ts` (`{ job: 'Lint', step: 'Check Match side
readers' }`), `CONTRIBUTING.md`, `.claude/skills/myclash-gates/SKILL.md`, and the four other
  documents that state the number of Lint steps (Step 8).

**Interfaces:**

- Produces, exported for the test: `SIDE_TOKENS`, `countSideHits(source: string): number`,
  `findRawSideAssignments(source: string, repoPath: string): string[]`,
  `judge(files: { path: string; source: string }[], ledger): { findings: string[]; scanned:
number }`, and `gate` (`defineGate({ name: 'Match side readers', entry: import.meta.url, … })`).
- Ledger shape: `{ "readers": { "<repo path>": { "verdict": "side-key" | "individual-only" |
"no-side-read" | "not-yet", "hits": <n>, "why": "<text>", "byHand"?: true } },
"rawSideAssignments": { "<repo path>": { "count": <n>, "why": "<text>" } } }`.

**The rule.**

- Files: `walkRepoFiles(root, { extensions: ['.ts', '.tsx', '.mjs', '.sql'] })`
  (`scripts/lib/repo-scan.mjs`), kept when the path starts with `apps/`, `packages/` or
  `scripts/`, and dropped when it is a test or a generated file: `*.test.*`, `*.spec.*`,
  `*.fixtures.ts`, any `/testing/` segment, `packages/db/fixtures/`,
  `packages/api-client/src/generated/`, and the gate's own files.
- `SIDE_TOKENS`, matched **anywhere in a word, not as whole words**: `red_registration_id`,
  `blue_registration_id`, `winner_registration_id`, `registration_a_id`, `registration_b_id`,
  `forfeiting_registration_id`, `redRegistrationId`, `blueRegistrationId`,
  `winnerRegistrationId`, `registrationAId`, `registrationBId`, `forfeitingRegistrationId`. A
  whole-word match would miss a side read through a foreign-key name:
  `apps/api/src/modules/schedule/live-state.service.ts:241-242` reads both sides only as
  `registrations!matches_red_registration_id_fkey`.
- Plus `registration_id` and `registrationId` as whole words, counted only in a file that also
  names `pool_members`, `match_penalties` or `match_forfeits`.
- **Readers the tokens cannot see are listed by hand** (`"byHand": true`, `hits` 0) and are not
  treated as stale. The first is `apps/web-staff/src/offline/db.ts` (`:158`, a queued card's
  `registrationId`, with no table name near it).
- Verdicts: `side-key` (visited, compares or builds sides through `sideKey`); `individual-only`
  (visited, team Matches are out on purpose, with the reason); `no-side-read` (names a link and
  reads no side: a probe's list of key names, an archive column map, a schema test); `not-yet`
  (not visited; its `why` starts with its slice, `1b:`, `1c:` or `2:`).
- Findings: a file with hits and no ledger line; a **visited** line whose `hits` differs from the
  file ("re-read this file, then update the count"); a line for a file with no hits or no file and
  not `byHand` ("delete this line"); an empty `why`; a `not-yet` with no slice. A `not-yet` line
  pins no count: the file is read whole in its slice, and other sessions editing it meanwhile are
  not stopped.
- Raw assignments, in `.ts` and `.tsx` under `apps/` only. For each `(red|blue|winner)SideId`
  followed by `:`, read the text up to the next comma or closing brace at the same depth (so a
  value the formatter wrapped onto the next line is read whole). It is a finding unless that text
  contains `sideKey(` or another `SideId`, or is a type (`string`, `null`, `undefined` joined by
  `|`, as in the inline types at `correction-outcome.ts:30` and `:47`). The shorthand
  `{ redSideId }` passes: it copies a side id.
- The same rule the other way: `winner_registration_id` followed by `:` whose value contains
  `SideId` is a finding ("a side id written into a Registration column; use `winnerColumns`").
- A file may be excused from either by a `rawSideAssignments` line with the exact count and a
  reason.
- `scanned` is the number of files read after the filters.

- [ ] **Step 1: Write the failing tests** in `scripts/check-side-readers.test.mjs`
      (`node:test`, in the style of `scripts/check-todos.test.mjs`), on made-up sources through
      `judge`:
  - `a reader nobody listed is a finding`
  - `a visited reader whose count changed is a finding`
  - `a not-yet reader whose count changed is not a finding`
  - `a ledger line for a file with no hits is a finding, unless it is listed by hand`
  - `a not-yet without its slice is a finding`
  - `a side read through a foreign-key name is a hit` — source
    `'red:registrations!matches_red_registration_id_fkey(persons(given_name))'`
  - `a raw assignment into a side id is a finding` — source
    `const m = { redSideId: row['red_registration_id'] as string };`
  - `a raw assignment wrapped onto the next line is still a finding`
  - `an assignment through sideKey passes, on one line or wrapped`
  - `a type declaration is not an assignment` — source `interface Bout { redSideId: string; }`
  - `a side id written into winner_registration_id is a finding`
  - `bare registration_id counts only beside a side table`
  - `a test file is not scanned`
  - `the ratchet: the ledger holds exactly N not-yet lines` — `N` is the pinned number of Step 4;
    the message says "this number may only go down"
  - `the real ledger lists the two readers a first draft of this gate missed` —
    `apps/api/src/modules/schedule/live-state.service.ts` and `apps/web-staff/src/offline/db.ts`
  - `scanned is the number of files the filters keep` — the test builds the list itself from
    `git ls-files` with the same filters and compares; the number is above 100. A floor alone
    ("at least 150") is the shape `scripts/check-design-drift.test.mjs:295-297` rejects.
  - the registration pins, in the shape of `scripts/check-design-drift.test.mjs:315-351`: the
    pnpm script is the gate alone; CI runs it as its own step and never behind `&&`; `CI_GATES`
    holds `step: 'Check Match side readers'`; importing the gate does not run it.
- [ ] **Step 2:** `node --test scripts/check-side-readers.test.mjs` — expected: FAIL, module not
      found.
- [ ] **Step 3:** Implement the gate to the rule above.
- [ ] **Step 4: Fill the ledger.** Run the gate; it lists every unlisted file with its count. For
      each, read the file and write its line:
  - `side-key`: the files Task 7 changed, and the engine files Task 3 renamed.
  - `individual-only`, with the reason from the design: one person's history and profile
    (`fighters/`, `results/fighter-career.ts`), the HEMA Ratings export, the fighter-status settle
    code (decision 7), Swiss (non-goal), migrations whose function a later migration replaced.
  - `not-yet`, with its slice: everything else. Known ones: `1b:` the card comparison, the
    scheduler, the scorekeeper screen, standings, Pool generation, forfeits,
    `packages/types/src/match-winner.ts` and its nine display callers, the SQL function
    `fighter_blow_value_stats` (`0189_blow_value_stats_any_value.sql:41`, which returns rows with
    an empty id for a team bout); `1c:` bracket advance, final ranking, the referee rule's two
    copies, the personal schedule, the four people and privacy paths.
    Some files keep a raw value in a side id. The gate names them with their counts; write a
    `rawSideAssignments` line for each, never from memory. Expected, on purpose:
    `staff/staff.service.ts` and `matches/match-summaries.ts` (they ask only how many rounds a bout
    has, and pass `''`; no side is read), `fighters/fighters.service.ts` and
    `fighters/recent-matches.ts` (one person's history). Expected, until 1b, with `1b:` in the
    reason: `matches/time-limit-result.ts`, `pool-standings/compute-rows.ts`,
    `pool-standings/ruleset-scores.ts`, `persons/public-schedule.service.ts`. A file the gate names
    that is in neither list is read before it is excused: it may be a mapper Task 7 should have
    changed.
    Then set `N` in the ratchet test to the count of `not-yet` lines.

  **A limit of this gate, known and stated in its header comment:** a helper that reads
  `registration_id` from a penalty or Pool row without naming the table is not counted. Such a
  file is added by hand (`byHand`) when a slice finds it.

- [ ] **Step 5:** `node --test scripts/check-side-readers.test.mjs` — PASS. `pnpm
quality:side-readers` — green, and its summary names the three counts.
- [ ] **Step 6: Falsify on the real repo.** Add one line reading `row.red_registration_id` to a
      listed file; the gate goes red with "re-read this file"; revert. Add a new file under
      `apps/api/src` that reads it; the gate goes red with "no ledger line"; delete it.
- [ ] **Step 7:** `pnpm --filter @myclash/api exec vitest run
src/modules/admin/ci-health` — green (`gates.drift.test.ts` compares `ci.yml` with `CI_GATES`).
- [ ] **Step 8: The counts written in prose.** One more Lint step makes 29 steps and 26 gates,
      and `scripts/check-docs-drift.mjs:162-236` compares that with six places. Update each:
      `CLAUDE.md:124` ("twenty-eight further steps"), `CONTRIBUTING.md:17` and `:76-77`,
      `docs/ARCHITECTURE.md:4101`, `docs/CODE_QUALITY_REVIEW.md:17`,
      `.claude/skills/myclash-gates/SKILL.md:8-9`. Add the gate to the list under "Before pushing" in
      `CONTRIBUTING.md` and to the chain in the gates skill. Run `pnpm quality:docs-drift` — green.
- [ ] **Step 9: Commit:** `test(quality): every reader of a Match side is listed (quality:side-readers)`.

### Task 9: Close the slice

- [ ] **Step 1:** The full chain of the `myclash-gates` skill, from a clean build of the shared
      packages.
- [ ] **Step 2:** `git diff --stat <commit before Task 3>..HEAD -- apps/api/src/modules/matches/clock.service.ts
apps/api/src/modules/matches/late-press.ts packages/rules/src/clock.ts
apps/api/src/modules/matches/fighter-status.service.ts packages/rulesets/test/fixtures` —
      expected: no output.
- [ ] **Step 3:** Review the slice with `code-architecture-reviewer` (CLAUDE.md routing), then
      `git fetch` and push.
- [ ] **Step 4:** Report to the operator in plain language: what exists now, what does not (no
      screen, no route), and the size of the "not yet" list that slices 1b and 1c must empty.

## What this plan moved or left out, against the design

- **The side resolver moved to 1b.** In 1a nobody would call it.
- **The team logo column moved to 1b**, with its upload route. The archive's guard refuses a
  `_url` column nothing carries.
- **Standings and the time-limit result stay "not yet" until 1b.** Only the scoring service is fed
  the side key in 1a. In 1b the clock's read list (`BOUT_COLUMNS`) must gain the team columns;
  the design's "the clock is not touched" means its logic, not that list.
- **The archive learns to collect a table through two parents** (Task 3b). The design did not
  foresee it; a team member has no Registration to be found through.
- **No "team of the same Tournament" trigger.** No such rule exists for a Registration.
- **The limit of 20 Fighters per team** is this plan's call.
- **The kind race is argued and tested one writer at a time**, not under forced overlap; that
  probe comes with the teams routes in 1b.
- **Indexes on the twin columns** come in 1b with their first readers; `db:review` warns until
  then.
- **A cost for the other sessions.** Once the gate is in, a session that adds a side read to a
  **visited** file must re-read that file and update one number. Files not yet visited do not
  stop anyone.

## Review record of this plan

`myclash-plan-review`, 2026-11-13.

- Pass 1, one cold reviewer: 1 BLOCKER, 7 MAJOR, 7 MINOR. All folded in. The BLOCKER: the gate's
  whole-word tokens missed two readers that exist today, so "every reader is listed" was false.
- Pass 2, by the author on the amended text: 0 BLOCKER, 0 MAJOR, 2 MINOR folded in (a docs-drift
  run in Task 2; excuse lines written from the gate's output, never from memory). CONVERGED with
  open questions: the gate's known limit above, and whether a corrected Exchange keeps its slot
  stamp (slice 2). The amended plan has not had a second cold pass; one before building is cheap.
