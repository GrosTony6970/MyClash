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
- **This track works on the branch `feat/team-tournaments`** (operator, 2026-11-24), in its own
  worktree (`.claude/worktrees/team-tournaments`), never in the shared folder, which stays on
  `main` for the other sessions. A draft pull request into `main` carries CI (CI runs only on
  `push: main` and `pull_request: main`). The operator merges; no session merges it. The branch
  follows `main` by rebase before every push, pushed with `--force-with-lease`.
- Next migration number is **0281** today (re-based 2026-11-24; 0271-0280 went to other tracks).
  Re-check `ls packages/db/migrations | tail -1` right before creating each file, and again after
  every rebase: when `main` took a number this branch uses, rename the branch's file to the next
  free number, fix every reference to it (this plan, and the key of its line in
  `scripts/side-readers-ledger.json`, which scans `.sql`), and re-run `pnpm db:migrations:replay`.
- Any edit or script containing a backslash goes through the Write or Edit tool, never a heredoc.
- `rg` is not on the PATH of this machine's shells. Every `rg -n …` in this plan means
  `git grep -nE …` (or the Grep tool); a pipeline through a missing `rg` prints nothing and reads
  as a pass.
- Before each commit: `git log --oneline -1`. Other sessions leave staged files in the index, so
  commit by path: `git add <new paths>` (a new file must be added first, or
  `git commit -- <path>` refuses it), then `git commit -F <message file> -- <paths>`, the message
  written with the Write tool and ending with the Co-Authored-By trailer (`CLAUDE.md`, Workflow).
  Never `git add -A` or a bare `git commit`.
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

- Modify: `docs/HIERARCHY.md` (`:89` diagram line, `:106` Match row in the definitions table
  `:96-121`, `:150` Fighter row in the **Roles** table `:143-151`, "Code naming" `:194`)
- Create: `docs/decisions/ADR-022-team-is-a-second-kind-of-side.md`, and its row in the index
  table of `docs/decisions/README.md` (after ADR-021, `:54`)
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
      why the operator declined it twice. `quality:docs-drift` reads `docs/decisions/*.md` and
      checks each backticked path is tracked: ADR-022 names the gate by its pnpm script name only
      (`quality:side-readers`), never `scripts/check-side-readers.mjs`, which Task 8 creates.
- [ ] **Step 3:** Append to ADR-016 a section "2026-11-13 — the rule's reach for Teams" with
      decision 11, verbatim.
- [ ] **Step 4:** In `CLAUDE.md` rule 8, after "These rules have no setting and no override." add:
      "They protect a person MyClash can name: a Fighter in a Team slot with no name, or whose Person
      is linked to no Global Person, is outside them, and the screens that assign referees must say
      so (ADR-016, 2026-11-13)." (Design call 11 names both cases; the Teams screen and the referee
      board that show it come in slice 1c, so the sentence states the duty, not a screen that exists.)
- [ ] **Step 5:** Verify: `rg -n "between two sides" docs/HIERARCHY.md` prints one line;
      `rg -n "Team slot with no name" CLAUDE.md` prints one line; `pnpm quality:docs-drift` is green
      (it reads the `.md` files of `docs/`, `docs/design/`, `docs/decisions/` and the root docs,
      not sub-folders, `check-docs-drift.mjs:56-72`, and refuses a backticked path git does not
      track, `:311`, `:325-331`, `:347`: no doc of this task cites **any path a later task
      creates** — `0281_…`, `0282_…`, `packages/types/src/side-key.ts`, `winner-columns.ts`,
      `scripts/lib/team-tables-probe.mjs`, the gate's script or its ledger).
- [ ] **Step 6:** Commit: `docs(hierarchy): a Match side is a Registration or a Team (ADR-022)`.

### Task 3: Rename the engine's Match-side fields

Names change; no value changes. One commit.

**Files:**

- Modify, `packages/rules/src`: `domain.ts:44-47` and `:83-87` (and the comments at `:60`, `:70`),
  `match-format.ts:400-410`, `:433-440`, `:840-851`, `tf_v1/score.ts:43-50`,
  `formula/derive-stats.ts:102-104`, `results/fighter-career.ts:256-259` and `:341-344` (the keys
  of the two `boutOutcomes` literals only; the `CareerMatchInput` fields at `:23-25`, `:208-211`,
  `:284-287`, `:329-334` keep their names), `index.ts`, and every test in that package that names
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
  `staff/staff.service.ts:1981-1991`, `matches/match-summaries.ts:145-155`,
  `fighters/fighters.service.ts:1062-1068`, `fighters/recent-matches.ts:92`,
  `persons/public-schedule.service.ts:385-393`, and the tests of those files.
  (`correction-outcome.ts`: the `redecide` variant at `:29` carries `winnerRegistrationId` too;
  the range is `:29-47`.) The private method
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
  - `apps/api/src/modules/fighters/recent-matches.ts:92` passes a `RecentMatchRow` variable. Map
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
- [ ] **Step 5: Type-check.** Rebuild packages, then the API through `nest build`, then
      `pnpm turbo run typecheck` — expected: clean. `nest build` and the package builds read
      `tsconfig.build.json`, which leaves the tests out; only `typecheck` (`tsc --noEmit`, e.g.
      `packages/rulesets/tsconfig.json` includes `test/`) checks the renamed fields in test files.
      (`formula/derive-stats.ts:87-88` also names the fields; the compiler finds it.)
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

- Modify: `apps/api/src/modules/exports/archive.table-spec.ts` (the `collect` type, `:143-146`),
  `archive.service.ts:716-747` (the resolver), `archive-references.ts:84-86` (`carriedIds` reads
  `collectRuleFor(...)` and `rule.include`: it must read a list), `archive.tables.test.ts`
  (`rulesOf` `:80-83`, the graph tests `:85-158`, the scoring-only test near `:170-190`: each must
  walk every rule of a list). Every other caller of `collectRuleFor` is found with
  `rg -n "collectRuleFor\(|\.collect\b" apps/api/src/modules/exports` and read.
- Test: `apps/api/src/modules/exports/archive.service.test.ts`, or the resolver's nearest test file

**Interfaces:**

- Produces: in a table's `collect`, a scope may hold `CollectRule | readonly CollectRule[]`. For a
  list, the rows of each rule are fetched and merged, one row per `id`. The rules of one list
  share one `include` value; the type or a registry test refuses a list that mixes them, so
  `carriedIds` reads one answer.

- [ ] **Step 1: Failing test.** A table collected through two parents whose rows overlap gives
      the union, each `id` once; a list with one rule gives what that rule gives alone. No table
      uses a list before Task 4, so the test does not go through the fixed registry
      (`archive.table-spec.ts:143-146`): the per-rule fetch and the merge are one exported function
      that takes the rule (or list) as an argument, and the test calls it with a made-up list over
      a mocked database. Task 4's `team_slots` entry is then the first real list.
- [ ] **Step 2:** Run it — FAIL. Implement: the resolver calls `rowsForRule` once per rule and
      merges by `id`. The graph tests read a list as several edges. Run — PASS.
- [ ] **Step 3:** `pnpm --filter @myclash/api exec vitest run src/modules/exports` — green, same
      collected count plus the new test. No table uses a list yet.
- [ ] **Step 4: Commit:** `refactor(exports): an archived table may be collected through two parents`.

### Task 4: Migration — a Tournament has a kind; teams and their slots

**Files:**

- Create: `packages/db/migrations/0281_team_tables.sql`
- Modify: `apps/api/src/modules/exports/archive.tables.ts` (entries `teams`, `team_slots`, placed
  after `registrations`; `SHARED_FK_COLUMNS` gains `team_id: { map: 'teams' }`; **and the persons
  of a Tournament archive are also collected through `team_slots`**: at `:153` the `tournament`
  scope becomes the list `[{ from: 'registrations', local: 'id', parent: 'person_id' }, { from:
'team_slots', local: 'id', parent: 'person_id' }]`, the grammar of Task 3b),
  `apps/api/src/modules/exports/archive.table-spec.ts:28` (`ID_MAP_NAMES` gains `'teams'`), the
  archive fixture used by `archive.service.test.ts` (one team, one **named** slot and one empty
  one), and the `en`/`fr` label per table that `archive.tables.test.ts` requires
  (`packages/i18n/src/messages/{en,fr}/organizer.ts`). The named slot is
  the point: with an unnamed one only, the sweep "no id of the source survives a restore" passes
  while a restored slot still points at a Person of the source Event.
- Modify: `apps/api/src/modules/exports/archive-references.ts:61-63`: `ROSTER_REFERENCES` gains
  `['team_slots.person_id', ['event', 'tournament']]`. Without it the dangling-reference check
  skips that column, because it reads every other `person_id` as a global person (`:52-60`,
  `:105`), and a slot naming a Person outside the archive passes. Test it in the shape of
  `archive-references.test.ts:70-81`: a slot naming `p-ghost` is found as dangling; remove the
  line and watch that test go red (falsifier (c) below removes the collect rule, not this line).
- Modify: `apps/api/src/modules/privacy/subject-export.tables.ts`
  (`team_slots: { reaches: [{ column: 'person_id', reach: 'person' }], file: 'events.csv' }`)
- Modify: `scripts/db-cascade-probe.mjs` (`DEFERRED_KEYS` at `:92-102` gains
  `team_slots_person_id_fkey`, **kept in sorted order**, which `:165` and `:175` rely on; reword
  the comment at `:91` and the label at `:174`, which say "the nine keys" of 0237; `SEEDED` at `:105-134` gains one line
  per new seeded row, or `EXPECTED_CHECKS` never moves),
  `packages/db/fixtures/cascade-probe-seed.sql` (a second, team Tournament in the seeded Event, with
  its own phase and its own `match_rules` copy (Task 5 seeds its team Match there; `match_rules_id`
  is NOT NULL, `0232:95`, and `matches_rules_of_its_tournament` refuses another Tournament's copy,
  `0232:131-134`), one team, one named slot, each with its `SEEDED` line),
  `EXPECTED_CHECKS` (`:76`, 78 today): 78 plus one per new `SEEDED` line
  (`db-cascade-probe.mjs:269`), written **before** the run and then compared with what the probe
  reports.
- Modify: the RLS probe. The seed's existing Tournaments already hold Registrations
  (`packages/db/fixtures/rls-probe-seed.sql:41-46`, `:71-85`), so the kind trigger of Step 3 would
  refuse a Team there and the whole probe would go red. The seed gains **two new Tournaments with
  `entrant_kind = 'team'`**: one published and one draft, **both under the published Event
  `…0a`** (the pattern of the draft Tournament `…0c`, `rls-probe-seed.sql:44-45`; under the draft
  Event the Event check would hide it and falsifier (b) could not go red). One team with one slot
  under each. Update `CONTRIBUTING.md:23` ("the twenty-four checks") and the summary sentence of
  `db-rls-probe.mjs:251` with the header. `scripts/lib/rls-probe-tables.mjs` gains the two Tournament ids in the
  `tournaments` verdicts (`:15`), two `VERDICTS` lines (`:7`; `teams`, `team_slots`: the published
  rows `visible`, the draft rows `hidden`) and two `API_ONLY_WRITES` lines (`:229`). Nothing forces
  these lines, and without them a policy written `using (true)` passes every other check. Update the
  header of `scripts/db-rls-probe.mjs` (`:14` "twenty-four checks", `:37` "checks 8 to 24") to the
  new count. Checks 22 (`signed-in-reads-probe.mjs`:
  a new table is closed to signed-in readers), 23 (`dead-policy-probe.mjs`: every rule is a read
  rule its role can run) and 24 (`function-door-probe.mjs`: `service_role` runs every function in
  `public`) must stay green with the new tables and functions.
- Create: `scripts/lib/team-tables-probe.mjs`, wired as **check 25** in
  `scripts/lib/rls-probe-later-checks.mjs` (`laterCheckFailures`, `:27-48`; `db-rls-probe.mjs` is
  at its line cap and takes no new check), in the shape of check 15
  (`scripts/lib/forfeit-draw-probe.mjs`): each case runs
  as the owner in a savepoint that is rolled back, and a refusal is matched **by constraint name
  or by the trigger's message**, not by "some error". The seed holds no phase, `match_rules` copy
  or Match in the team Tournaments, so the Task 5 cases build their own inside the savepoint, as
  `forfeit-draw-probe.mjs` builds its rows.

**Interfaces:**

- Produces: column `tournaments.entrant_kind text not null default 'individual'`
  (`'individual' | 'team'`), column `tournaments.team_default_size integer` (1–10, nullable),
  tables `teams` and `team_slots` as below, functions `entrant_kind_holds()` and
  `entrant_kind_is_settled()`.

- [ ] **Step 1: Write the migration.** Header in the 0276 style (`-- 0281: …`, numbered
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
                when team_default_size between 1 and 10 then true else false end);

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
  constraint teams_size_range check (case when size between 1 and 10 then true else false end),
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
The size limit of 10 is the operator's (2026-11-24: "lower, e.g. 10"; the plan had proposed 20).
A team's size counts its numbered seats; reserves hold no position and are not counted by it. `team_slots.person_id` is
`NO ACTION DEFERRABLE INITIALLY DEFERRED` because a Person and a slot both die by cascade from
one Event, the case 0237 rules on. A slot's number is checked against its team's `size` by the
API in slice 1b, not here.

- [ ] **Step 2: RLS, in the same file.** `enable row level security` on both tables. Policies
      `teams_select` and `team_slots_select`, for the public (`anon`) reader only, in the shape of
      `match_protests_select` (`0276_match_protests.sql:60-73`): one `EXISTS` over the Tournament
      and its Event, both `status in ('published','running','completed')`, and **no
      `is_super_admin()` or `is_org_member()` branch**. Since 0273 a signed-in token reads nothing
      through the database, so that branch can open for no one (0274's rule, 0276:15-17), and the
      rule calls no helper (0275: none to grant). Do not copy `registrations_select` (0203:38-52):
      it predates 0273. No write policy and no revoke: 0247 closes writes on every new table
      (default privileges, `0247:146-169`; check 20 holds it).
- [ ] **Step 3: The kind trigger, in the same file.** Two functions, `language plpgsql`,
      `security invoker`, `set search_path = public, pg_catalog`, `revoke execute … from public, anon,
authenticated` (redundant since 0275 closes new functions, kept as the statement of intent; never
      from `service_role`, which check 24 requires), both `VOLATILE` (the default, written out: the
      race argument below needs a new snapshot per query, which only a volatile function takes),
      each raising `errcode = 'check_violation'` with `constraint = 'entrant_kind_holds'` /
      `'entrant_kind_is_settled'` in its `USING` clause, so the probe matches by that name:
  - `entrant_kind_holds()` — `BEFORE INSERT OR UPDATE OF tournament_id` on `registrations` and on
    `teams`. It reads the Tournament's kind with `select entrant_kind … for share` and refuses a
    Registration unless the kind is `individual`, a Team unless it is `team`. When no Tournament
    row is found it returns `NEW`, so the foreign key refuses the row with its own error (23503).
  - `entrant_kind_is_settled()` — `AFTER UPDATE OF entrant_kind` on `tournaments`, `WHEN
(old.entrant_kind is distinct from new.entrant_kind)`. It refuses the change when a
    Registration or a Team of that Tournament exists. Without the `WHEN`, a save that sends the
    same kind again would be refused on every Tournament that has entrants.
    The race, written in the header: the entrant's `for share` waits for a running change of kind
    and then reads the kind of after it; the change is checked **after** its own row lock, in a new
    snapshot, so it sees an entrant committed meanwhile. A `BEFORE UPDATE` check would not.
- [ ] **Step 4: The proof block, catalog only.** As 0239 onward do, the migration proves what
      landed by reading the catalog and seeds no row (it also runs on production). It asserts:
      `relrowsecurity` is true on both tables; each has exactly one policy, `FOR SELECT`, whose `qual`
      text contains `'published'` and contains neither `is_org_member` nor `is_super_admin`; each
      named constraint and each unique index exists exactly
      once; the three triggers exist on their tables (`entrant_kind_holds` on `registrations` and on
      `teams`, `entrant_kind_is_settled` on `tournaments`); both functions have
      `provolatile = 'v'` (precedent: `scripts/lib/fighter-status-probe.mjs:347`). End with
      `notify pgrst, 'reload schema';`.
- [ ] **Step 5: The behaviour, in the RLS probe.** `team-tables-probe.mjs` holds these cases:
      a second slot for one person in one Tournament is refused by `team_slots_one_team_per_person`;
      a second captain by `team_slots_one_captain`; a captain with no person by
      `team_slots_captain_is_named`; a slot with no position and no person by
      `team_slots_seat_or_reserve`; a team of size 11 by `teams_size_range`; a Registration in a team Tournament and a Team in an individual
      one by the kind trigger; a change of kind with an entrant by the kind trigger; a change of kind
      with no entrant is taken; **an update that sends the same kind on a Tournament with entrants is
      taken**. The `VERDICTS` lines prove the policy: an outsider reads the published team and not the
      draft one.
- [ ] **Step 6: Registries.** The archive, subject-export, cascade-probe and RLS-probe edits
      listed under Files.
- [ ] **Step 7: Run.** `pnpm db:review` — green. `pnpm db:migrations:replay` on a throwaway
      Postgres 17 — green. `pnpm db:cascade-probe` — green with the new seed rows, and its count
      equals the `EXPECTED_CHECKS` computed under Files. `pnpm db:rls-probe` — green, with one check
      more. Also, per the gates skill for any change under `packages/db/`: `pnpm db:merge-probe`,
      `pnpm db:fightbook-probe` and the FightBook race probe (`myclash-gates` SKILL.md `:85-88`).
- [ ] **Step 8: Falsify, three times.** The replay script reads the migrations folder as it is
      (`scripts/replay-db-migrations.mjs:16`), so each break is made in the real file, with a scratch
      copy kept beside it to restore from; after each, `git diff --stat` on the file is empty again.
      The proof block of Step 4 catches a missing index or a policy without `'published'` first,
      so each break must get past it to reach the probe it is meant to prove:
      (a) Delete the index `team_slots_one_team_per_person` **and** its line in the proof block,
      check both texts changed, replay (green), run the RLS probe: the "second slot" case is red.
      (b) In `teams_select`, add `'draft'` to `t.status in (…)` (the proof block still passes),
      replay, probe: the draft team's `hidden` verdict is red. (c) In `archive.tables.ts`, take
      `team_slots` out of the persons list: the archive's sentinel sweep on the Tournament path is red
      on the named slot. The fixture's named slot must hold a Person **with no Registration** in that
      Tournament, or the Person is still collected through Registrations and the sweep stays green
      (mind the `p-2` roster test, `archive.service.test.ts:1217-1229`).
- [ ] **Step 9: API tests, run directly.** `pnpm --filter @myclash/api exec vitest run
src/modules/exports src/modules/privacy src/common/db-schema-conformance.test.ts` — green,
      with the collected count not lower than before.
- [ ] **Step 10: Commit:** `feat(db): a Tournament has a kind; teams and their slots (0281)`.

### Task 5: Migration — a team twin beside each side link

**Files:**

- Create: `packages/db/migrations/0282_team_twins.sql`
- Modify: `apps/api/src/modules/exports/archive.tables.ts` (`SHARED_FK_COLUMNS`, `:100-132`, gains
  `red_team_id`, `blue_team_id`, `winner_team_id`, `team_a_id`, `team_b_id`,
  `forfeiting_team_id`, each `{ map: 'teams' }`; `team_id` came with Task 4), the archive fixture
  (one team Match, one team Pool member, one team protest).
- Modify: `scripts/db-cascade-probe.mjs` (`DEFERRED_KEYS` gains `matches_red_team_id_fkey`,
  `matches_blue_team_id_fkey`, `match_forfeits_forfeiting_team_id_fkey`,
  `match_forfeits_winner_team_id_fkey`, in sorted order; `SEEDED` gains the new rows),
  `packages/db/fixtures/cascade-probe-seed.sql` (a team Match **with a `winner_team_id`**, so the
  `set null` path runs on delete, a team forfeit and a team protest), `EXPECTED_CHECKS`. Compute
  the expected number before running (the count before this task plus the checks its new
  `SEEDED` lines add), then compare with what the probe reports; a value copied from the probe's
  own report proves nothing. The same holds for Task 4's `EXPECTED_CHECKS` (78 today).
- Modify: `scripts/lib/team-tables-probe.mjs` (the cases of Step 3).

**Interfaces:**

- Produces these ten columns, each `uuid references public.teams (id)`, with the delete action of
  its Registration twin (the actions read from the catalog on 2026-11-24: `0001:347`,
  `0001:362-363`, `0237:62-83`, `0001:403`, `0016:44`, `0276:36`):

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
| `match_forfeits`  | `winner_team_id`     | no action, deferred | none: `…_forfeiting_one_kind` and `…_same_kind` already imply at most one   |
| `match_protests`  | `team_id`            | cascade             | `match_protests_one_side`: exactly one (operator, 2026-11-24)               |

`match_protests` (0276) did not exist when this plan was first written. The operator ruled on
2026-11-24 that it gets its twin now, like every other side link; filing a protest for a team is
built with the team screens. `match_forfeits.replacement_registration_id` (`0032:14`, the reserve
who took a Fighter's place) gets **no** twin: a team's reserves are its slots (decision 12), so a
team forfeit never names a replacement Registration.

- [ ] **Step 1: Write the migration.** `set constraints all immediate;` first. Add the ten
      columns. Write each check with `num_nonnulls(a, b) = 1` or `<= 1`. Also:
  - `alter column … drop not null` on `pool_members.registration_id`,
    `match_penalties.registration_id`, `match_forfeits.forfeiting_registration_id`,
    `match_protests.registration_id`.
  - `match_protests` is in the `supabase_realtime` publication with `REPLICA IDENTITY FULL`
    (`0276:75-92`): a new column rides along; nothing to change there.
  - `matches_sides_same_kind`: a Match never has a Registration on one side and a Team on the
    other.
  - `matches_winner_same_kind`: a winner Team only on a Match with no Registration side, a winner
    Registration only on a Match with no Team side:
    `check ((winner_team_id is null or (red_registration_id is null and blue_registration_id is null))
and (winner_registration_id is null or (red_team_id is null and blue_team_id is null)))`.
  - `match_forfeits_same_kind`: a team forfeit never names a winner Registration, an individual one
    never a winner Team: `check ((forfeiting_team_id is null or winner_registration_id is null) and
(forfeiting_registration_id is null or winner_team_id is null))`.
  - Replace `match_forfeits_draw_has_no_winner` (`0239:33-35`), which today reads "no winner
    Registration" as "draw" and would refuse a team win. Drop it **by name with no `IF EXISTS`**,
    as 0239 did, and add it again as `check ((score_policy = 'draw') = (winner_registration_id is
null and winner_team_id is null))`.
  - `create unique index pool_members_pool_team_key on public.pool_members (pool_id, team_id)
where team_id is not null`.
    No "team of the same Tournament" trigger: nothing checks that for a Registration today either,
    and adding it for one kind only is a second rule to keep in step.
- [ ] **Step 2: The proof block, catalog only.** Each of the thirteen constraint names above exists
      exactly once, and **each one's `pg_get_constraintdef` text equals its expected text**, as
      `0239_match_forfeits_draw.sql:54-61` does for one: a name alone passes a check written wrong.
      The unique index `pool_members_pool_team_key` exists exactly once. The header says why
      `match_forfeits.winner_team_id` has no one-kind check of its own: `…_forfeiting_one_kind`
      plus `…_same_kind` imply it, and Postgres tests a table's checks in name order, so such a
      check could never be the one that refuses a row.
      Take each expected text from a first replay, read it against the table above, then pin it.
      End the file with `notify pgrst, 'reload schema';` (precedent `0279_device_piste.sql:86`). Do not count "checks that
      mention `score_policy`": two do, `match_forfeits_score_policy_allowed` (`0239:28-30`) and this
      one.
- [ ] **Step 3: The behaviour, in the RLS probe.** Add to `team-tables-probe.mjs`: a Pool member
      with both ids is refused by `pool_members_one_entrant`; with neither, by the same; a Match with a
      Registration red and a Team blue by `matches_sides_same_kind`; a team win on a forfeit that is
      not a draw is taken; a draw with a winner Team is refused by
      `match_forfeits_draw_has_no_winner`; a protest with both a Registration and a Team, or with
      neither, by `match_protests_one_side`; a team Match with a winner Registration by
      `matches_winner_same_kind`; a team forfeit with a winner Registration by
      `match_forfeits_same_kind`; and **one "both present" case per one-kind check**:
      `matches_red_one_kind`, `matches_blue_one_kind`, `matches_winner_one_kind`,
      `bracket_slots_a_one_kind`, `bracket_slots_b_one_kind`, `match_penalties_one_side`,
      `match_forfeits_forfeiting_one_kind`, each refused by its name; and the same team twice in
      one Pool, refused by `pool_members_pool_team_key`. Postgres tests a table's checks in name
      order and reports the first that fails, so each case sets the other columns so that the named
      check is the first to fail (e.g. `matches_winner_one_kind` on a Match with no sides, before
      `matches_winner_same_kind` can fire). Check 15 (`forfeit-draw-probe.mjs`) must still pass
      untouched: the constraint keeps its name.
- [ ] **Step 4: Registries**, as listed under Files.
- [ ] **Step 5: Run.** `pnpm db:review`, `pnpm db:migrations:replay`, `pnpm db:cascade-probe`,
      `pnpm db:rls-probe` — green. (`db:review`'s foreign-key index check reads only
      `<col>_id UUID … REFERENCES` lines of a `create table`, `check-db-review.mjs:328-338`, so the
      `add column` twins raise no warning; their indexes still come with their first reader in 1b.)
- [ ] **Step 5b: Falsify.** In the real file, with a scratch copy to restore from, delete
      `and winner_team_id is null` from the rewritten check; replay — expected: the proof block fails
      on the definition text. Restore; `git diff --stat` on the file is empty.
- [ ] **Step 6: API tests, run directly:** `pnpm --filter @myclash/api exec vitest run
src/modules/exports src/common/db-schema-conformance.test.ts` — green.
- [ ] **Step 7: Commit:** `feat(db): a team twin beside each side link (0282)`.

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

### Task 7a: A bout waiting for a Fighter takes no Start, hit, card or colour swap

**Operator ruling, 2026-11-24.** Task 7 Step 0 found that a bracket bout with a missing side (a
placeholder with no side, or a one-sided bout whose other Fighter is still to come) can be
started and scored today: `clockAction` "validates nothing against the slot"
(`phases/bracket-dependents.ts:226-228`), and the pad opens such a bout with blank names
(`apps/web-staff/src/lib/bout-read.ts:112-118`). The operator ruled: **refuse it before saving**,
on the server and on the pad, with a message in English and French, in this slice. This task
touches the clock's Start doors, which the Global Constraints keep untouched; the ruling
supersedes that constraint for this one check, and only this check.

**Files:**

- Create: `apps/api/src/modules/matches/bout-sides.ts` (+ `bout-sides.test.ts`), and
  `bout-sides.doors.test.ts` (one test per door).
- Modify (server): `matches/bout-not-started.ts` (`assertBoutTakes`, `:48-55`),
  `matches/matches.service.ts` (`openRoundOf` select `:700`, `swapFighterColor` `:951-985`,
  `getLockableMatch` select `:1259`), `matches/clock.service.ts` (`clockAction` after the lock
  check `:255-257`; `BOUT_COLUMNS` `:156-161` gains `red_team_id, blue_team_id`),
  `matches/late-press.ts` (`placeLatePress`, after the lock check `:302-317`),
  `penalties/penalties.service.ts` (`:933`, `getMatchContext` carries the team ids too).
- Modify (pad): create `apps/web-staff/src/lib/bout-sides.ts` (+ test);
  `lib/refusal-copy.ts` (`REFUSED_WHOLE` `:121-138`, `HELD_PRESS` `:144-155`);
  `components/MatchView.tsx` (`onClockAction` `:430-461`, `scoringEnabled` `:511-517`, a banner
  in the locked-banner style `:785-798`), `components/ScoringCenterControls.tsx` (Start
  `:416-430`, a `startBlocked` prop), `components/MatchCorrectionsDrawer.tsx` (colour swap
  `:249-256`, direct card `:407`), `lib/bout-read.ts` (`BoutRow` `:53-75`, `boutOf` `:129-169`) and
  the file of the `MatchInfo` type: the side ids widen to `string | null` and gain the team ids —
  the compiler's complaints are the checklist, no cast to quiet them.
- Modify (API, named): `penalties.service.ts` `getMatchContext` (`:1390`) and its `MatchContext`
  interface (`:1945-1960`) gain the team ids and `redSideId`/`blueSideId`.
- Tests (browser): `tests/a11y/pad-clock-stub.ts` gains an option for a bout with an empty side
  (its `ROW` side ids widen to `string | null`, `:18`; `openBout` must not wait for an enabled
  Start, `:249`); a new spec in `tests/a11y/` uses it (the stub's `arrived`/`sent` recorders,
  `:57`, `:71`, show that the Space key posts nothing).
- Modify (strings): `packages/i18n/src/messages/{en,fr}/scoring.ts`: `scoring.match.waitingForFighter`
  (the banner), `scoring.corrections.boutSideMissing` (a call sent at once),
  `scoring.quarantine.boutSideMissing` (a held entry: kept, not lost; retry once both Fighters are
  on the bout, or discard it).

**Interfaces:**

- Produces (API): `BOUT_SIDE_MISSING = 'bout_side_missing'` and
  `assertBothSides(sides: { red: string | null; blue: string | null })`. It throws
  `ConflictException({ message: 'This bout is waiting for a Fighter. It takes no Start, hit, card
or colour swap until both sides are known.', code: BOUT_SIDE_MISSING })`. A **409**: the pad's
  queue keeps a coded 409 as held, shown, and resendable by the referee (`sync.ts:443-460`); a 422
  would be resent on every drain (`sync.ts:751`, `:811-829`). The code is **not** added to
  `NEVER_AGAIN` (`offline/can-send-again.ts:15-23`): the Fighter may arrive later.
- A side is judged **by side, not by Registration**: each guarded door computes
  `sides = { red: sideKey(red_registration_id, red_team_id), blue: sideKey(…) }` (Task 6) from the
  row it read, so a team bout of slice 1b is never refused. `assertBoutTakes` gains an **explicit,
  optional** field: `bout: { id; status; sides?: { red: string | null; blue: string | null } }`.
  "Not judged" means **`sides` was not passed** — never "a key happens to be missing": the card
  door's `MatchContext` is camelCase (`penalties.service.ts:1428-1429`, `:1945-1960`) and the hit
  door builds a fresh object (`matches.service.ts:709-713`), so a key-based rule would silently never
  fire there. Hit door: pass `sides` into the object at `:709-713` from the widened `openRoundOf`
  select (`:700`; do not share that literal with `round-advance.ts:121`, pinned at
  `round-advance.writes.test.ts:264`). Card door: `getMatchContext` (`:1390`) selects the team ids
  and exposes `redSideId`/`blueSideId`; `:933` passes `sides`. Protests (`protests.service.ts:78-79`)
  pass no `sides`: they are outside the ruling.
- Produces (pad), one owner for the decision: `apps/web-staff/src/lib/bout-sides.ts` exports
  `sideMissing(match)` (pure, unit-tested). The raw bout reads are `select('*')`
  (`matches.service.ts:127-129`, `staff/lice-bouts.ts:52-54`), so the team ids are on the wire since
  0282: `BoutRow` (`bout-read.ts:53-75`), `boutOf` (`:129-169`) and `MatchInfo` gain
  `red_team_id`/`blue_team_id` (`redTeamId`/`blueTeamId`), so a kept copy (`offline/kept-bout.ts:30-34`)
  carries them, and `sideMissing` judges each side through `sideKey`.
- Pad Start has **one owner**: `onClockAction` (`MatchView.tsx:430-461`) refuses `start` when
  `sideMissing` (outside its `!force` branch), which covers the button, the Space key
  (`:703-714`) and the resume dialog's force path (`:976`). The button is also greyed
  (`startBlocked` prop on `ScoringCenterControls`, `:416-430`) for the eye. Hits, double,
  no-exchange and ruleset cards follow `scoringEnabled` (`:511-517`); the letter keys press only
  enabled buttons (`lib/pad-keys.ts:29-33`). The drawer gets `sideMissing` and disables the swap
  and the direct card.
- An offline tablet whose kept copy was saved while a side was empty refuses Start until it reads
  the bout again online, even if the Fighter was placed meanwhile (controller's ruling: its names
  are blank anyway; a read online cures it).
- Words (EN; FR in the vocabulary `packages/i18n/src/messages/fr/scoring.ts` already uses for
  bout, Fighter and side): `scoring.match.waitingForFighter` "Waiting for a Fighter. This bout
  takes no Start, hit, card or colour swap until both sides are known.";
  `scoring.corrections.boutSideMissing` "This bout is waiting for a Fighter. Try again once both
  sides are known."; `scoring.quarantine.boutSideMissing` "Held here, not lost: this bout was
  waiting for a Fighter. Retry once both Fighters are on the bout, or discard it." The held key is
  generic: `heldReason` falls back to `HELD_PRESS` for every kind (`refusal-copy.ts:232-233`), so it
  words held hits and cards too.

**Where the check runs, and where it does not:**

- Hits and cards: inside `assertBoutTakes`, after `assertScoredAfterLastReset` and **before** the
  direct-card exemption (so a direct card is refused too). The replay probes (`savedHitOf`
  `matches.service.ts:554`, `savedCardOf` `penalties.service.ts:927-928`) run before it, so a resend
  of a saved hit or card is still answered "saved". Protests (`protests.service.ts:78`) pass no
  sides and are not judged: protests are outside the ruling.
- Start: `clockAction` for `action === 'start'`, right after the lock check (`clock.service.ts:255-257`;
  this door has no replay probe); `placeLatePress` for `'start'`, after its lock check
  (`late-press.ts:311`). On the late door `pressIsSaved` (`clock.service.ts:380`) and `alreadyTrue`
  (`:390`) run first, so a saved queued Start is still answered.
- Colour swap: `swapFighterColor`, after `assertMatchUnlocked`, on the row it already reads.
- **Not guarded, on purpose:** card void (`penalties.service.ts:1127-1171`) — the only way to clear
  a direct card left on a bout that `clearDependentPairing` emptied (`bracket-dependents.ts:231-236`);
  exchange void/revert/edit, clock End, end-round — unreachable once Start is refused; the side-order
  swap (`MatchCorrectionsDrawer.tsx:257-264`, `matches.service.ts:987-999`), which changes no side;
  and a `resume` of a bout started before a side was cleared (its hits are refused anyway).
  `getLockableMatch`'s select (`matches.service.ts:1259`) is shared with `swapFighterSide` and the
  lock checks: widening it is harmless; pin it with the others.

- [ ] **Step 1: Failing tests (API).** `bout-sides.test.ts`: both known → passes; red missing →
      throws `bout_side_missing`; blue missing → throws; `assertBoutTakes` without `sides` → not
      judged. A team side is a door concern: the door computes `sideKey(null, 't') === 't'`.
      `bout-sides.doors.test.ts`, one test per door, each asserting the 409 code AND that **nothing
      was written** (no insert/update on the mock): a hit, a queued card, a direct card, an HTTP
      Start, a late Start (asserting `bout_side_missing` exactly: the late door has other coded
      refusals, `late-press.ts:311-312`), a colour swap; a team bout (Registration ids null, team ids
      set) passes each door; and a resend of a saved hit, of a saved card and of a saved queued Start
      is still answered as saved. Every select string the guard widens is pinned whole
      (`selectsFor` + `toEqual`).
- [ ] **Step 2:** Run — FAIL. Implement. Run — PASS. Then the API suite directly
      (`pnpm --filter @myclash/api test`) — green; tests that pin `BOUT_COLUMNS` or the widened
      selects gain the team columns and nothing else (known: `bout-not-started.test.ts:126`,
      `penalties.bout-copy.test.ts:148`; list each in the commit body).
- [ ] **Step 3: Failing tests (pad).** The decision is pure code, so it is tested as code:
      `lib/bout-sides.test.ts` (`sideMissing`: both known, red empty, blue empty, a team side, a
      kept copy without team ids); `refusal-copy.test.ts`: `bout_side_missing` in both maps, with the
      exact EN words pinned in the shape of `:69-75`; a test that `canSendAgain` answers `true`
      for the code `bout_side_missing`, beside `offline/sync.retry-curable.test.ts`. The
      web-staff vitest runs in `node` with no React setup (`apps/web-staff/vitest.config.ts`), so
      `scoring-center.screens.test.ts` (text pins) holds the wiring only. **The behaviour is proved in
      the browser:** a new a11y story in `tests/a11y/` on the pad clock stub
      (`tests/a11y/pad-clock-stub.ts`, with `red_registration_id: null`): Start is disabled, the
      Space key records no POST (the route-recording pattern of `pad-offline-drill.spec.ts:30-37`),
      the banner text shows, and the drawer's swap and direct card are disabled. Run — FAIL.
      Implement. Run — PASS (`pnpm test:e2e` runs `tests/a11y` in CI's `Playwright and Axe` job;
      locally run the one spec with `pnpm exec playwright test <file>`).
- [ ] **Step 4: i18n.** The three keys in `en` and `fr`; `pnpm --filter @myclash/i18n test` run
      directly — green.
- [ ] **Step 5: Falsify, once per call site** (same collected count each time; scratch copies
      outside the repo; restore and compare): remove the check in `assertBoutTakes` → the hit and
      card door tests go red; in `clockAction` → the HTTP Start test; in `placeLatePress` → the late
      Start test; in `swapFighterColor` → the swap test. On the pad, make `onClockAction` ignore
      `sideMissing` → the a11y story's "Space records no POST" goes red.
- [ ] **Step 6:** `pnpm --filter @myclash/web-staff test`, `pnpm turbo run typecheck`,
      `pnpm --filter @myclash/api build`, prettier, `pnpm quality:complexity`. Hard rule 3: the
      offline E2E specs pick only bouts with both sides (`06-offline-sync.spec.ts:104`,
      `40-offline-bout.spec.ts:95`, `tests/a11y/pad-clock-stub.ts:18-19`), so they stay green; they
      run in Task 9.
- [ ] **Step 7: Commit:** `feat(scoring): a bout waiting for a Fighter takes no Start, hit, card or swap`.

### Task 7: The API feeds the engine the side key, and writes its winner back by side

This task is the scoring service only. Its reads and its writes sit in one file, so a test can
pin the read string and the written row together.

**Files:**

- Create: `apps/api/src/modules/matches/winner-columns.ts`, test `winner-columns.test.ts`
- Modify: `apps/api/src/modules/matches/scoring.service.ts`: `rulesetMatch` (`:125-141`),
  `storedBout` (`:143-153`), the winner writes at `:232`, `:254` and `:840-845`, the `matches`
  select strings that feed them, and `buildRoundClosure` (`:809-819`), which has no bout row in
  scope today and receives it as a new parameter. Its end-on-time caller (`:1125`) gets `ctx`
  from `loadRoundContext`, which already returns `matchRow: m` (`:1276`, `:1315`): pass
  `ctx.matchRow`, add no second field.
- Modify: `apps/api/src/modules/matches/reopen-match-columns.ts:28` and `:96`, and
  `unplayed-match-columns.ts:57`: where a reopen or a replay clears `winner_registration_id`, it
  clears `winner_team_id` too.
- **This widens the clock's writes by one null column, without editing the clock's files.**
  `noResultColumns` is spread into the clock's reopen and uncomplete writes, directly at
  `clock.service.ts:599` and through `reopenedResultColumns` at `:847`, and into scoring's own
  (`scoring.service.ts:249`, `:1053`). Tests that pin those writes whole with `toEqual` gain
  `winner_team_id: null` and nothing else: `clock-uncomplete-result.test.ts` (`:75-80`, `:103`,
  `:127`, `:142`), `reopen-match-columns.test.ts` (`:26-34`, `:112-117`), and every other test
  that `rg -n "winner_registration_id: null" apps/api/src --glob "*.test.ts"` finds beside a
  spread of these helpers. `unplayedMatchColumns` also writes through `phases/revert-match.ts:65`
  and `matches.service.ts:1065` (`resetMatch`); run `phases.service.test.ts` (`:1763`, `:2177`,
  `:2677`, `:2721`) and `matches.service.test.ts` (`:1096`) and widen any whole-row pin they hold.
  List each widened test file in the commit body.
- Test: `scoring.service` tests, the reopen and unplayed tests, and the widened tests above.

**Interfaces:**

- Consumes: `sideKey` (Task 6); columns `red_team_id`, `blue_team_id`, `winner_team_id` (Task 5).
- Produces: `export function winnerColumns(row: { red_registration_id: string | null;
red_team_id: string | null; blue_registration_id: string | null; blue_team_id: string | null },
winnerSideId: string | null): { winner_registration_id: string | null; winner_team_id: string |
null }`. It finds the winner's colour by comparing `winnerSideId` with `sideKey` of each side and
  returns that side's own two columns; `null` gives both `null`; an id that is neither side throws.

Not in this task, and left "not yet, 1b" in the gate's ledger, each for a stated reason:

- `matches/time-limit-result.ts` (mappers at `:48-54`, `:138-144`, and a **fourth winner write at
  `:147-148`**): its rows come through the clock's read list, which this slice touches only to add
  the team ids for Task 7a's guard; its mappers wait for 1b.
- `pool-standings/compute-rows.ts` and `ruleset-scores.ts`: a team bout is skipped at
  `compute-rows.ts:102-104` before any side is read, their reads live in
  `pool-standings.service.ts:155`, and Swiss feeds them too
  (`swiss/swiss-standings.service.ts:156-167`). They change with the entrant fields, in 1b.
- The card comparison (`scoring.service.ts:628`), the scheduler
  (`schedule/match-scheduler.ts:267`), the scorekeeper screen
  (`apps/web-staff/src/offline/pending-events.ts`), forfeits.

- [ ] **Step 0: Can a Match with a missing side reach scoring today?** Two cases: a bracket
      placeholder with no side, and a one-sided bracket bout whose other side is still to come
      (`phases.service.ts:704-710`). List **every** caller of the recompute
      (`git grep -nE "recomputeMatchScore\(|\.recompute\(" -- apps/api/src ':!*.test.ts'`; 17 call
      sites on 2026-11-24), plus the doors that reach `rulesetMatch` through `loadRoundContext`
      (`scoring.service.ts:1304`: `endRoundOnTime` and `advanceRound`, `matches.service.ts:1085`,
      `:1100`), not only the start and Exchange doors: several write first and recompute after — `createExchange`
      (`matches.service.ts:597-622`), `swapFighterColor` (`:951-984`, offered on the pad,
      `MatchCorrectionsDrawer.tsx:252`), the card door (`penalties.service.ts:1029`) — and the
      Start count is not best effort (`scoring.service.ts:1464`, `start-count.ts:96`), so a tablet
      would re-send it forever. Read the pad's bout list filter (`apps/web-staff`) and settle each
      caller and each case with a citation. If none reaches such a Match, Step 4's throw stands. If
      one does, the throw turns a write that succeeds today into a 500 after the write, and the
      pad's queue retries it (`matches.service.ts:555-558`, `:607-610`): **stop and ask the
      operator** before building Step 4.
      **Settled 2026-11-24:** such a Match does reach scoring (pad Start, hits, swap, a direct card,
      a card void). The operator ruled "refuse before saving": Task 7a guards Start, hits, cards and
      swap. One door stays open on purpose: the card void, which is how a direct card left on a bout
      that `clearDependentPairing` emptied is cleared, and which recomputes after it writes. So
      **Step 4 does not throw** (controller's ruling): a missing side is passed through as today.
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
  - every `matches` select string that feeds `rulesetMatch`, `storedBout` or a winner write
    (`MATCH_ROW_SELECT`, `ROUND_CONTEXT_SELECT`, `scoring.service.ts:115-122`) is pinned whole with
    `toEqual` and holds `red_team_id`, `blue_team_id` and `winner_team_id`. Selects that read no side
    (e.g. `heldResult`, `'status, red_score, blue_score'`, `:1516`) are left as they are;
  - a bout row with no side on red (`red_registration_id: null, red_team_id: null`) hands the
    engine `redSideId === null` exactly as today's `m['red_registration_id'] as string` did (the
    card-void path of Step 0 must still recompute), and never `''`.
- [ ] **Step 4:** Run them — FAIL. Change `rulesetMatch` and `storedBout` to
      `sideKey(row.red_registration_id, row.red_team_id)` and add the team columns to the selects.
      `Match.redSideId` is a `string`, and today a missing side already arrives as `null` through a
      cast. Keep that value: `sideKey(...) as string`, with a one-line comment naming Task 7a's guard
      and the card-void path that still recomputes such a bout. Never `?? ''`: two empty sides would
      compare equal (the `null === null` trap) and a card on `''` would match. The gate's raw-assignment
      rule accepts this, because the value contains `sideKey(`. Run — PASS.
- [ ] **Step 5: Failing tests for the outbound writes**, one per write: a team Match the engine
      ends for red writes `winner_team_id: 'team-r'` and `winner_registration_id: null`, for the
      single-fight path (`:232`, `:254`) and for a best-of round closure (`:840-845`). And: a reopened
      team Match has both winner columns cleared. Then replace each write with
      `...winnerColumns(row, winnerSideId)`, pass the row into `buildRoundClosure`, and add the clear.
      Run — PASS.
- [ ] **Step 6: Individual behaviour is unchanged.** `pnpm --filter @myclash/api test` —
      expected: green. `git diff` on the test files of this task shows added tests, widened select
      strings and the added `winner_team_id: null` of the widened writes only; no result of an
      existing individual case changed.
- [ ] **Step 7: Falsify.** In `rulesetMatch`, put back `m['red_registration_id'] as string`; the
      mapper test of Step 3 goes red; the collected count is unchanged; restore.
- [ ] **Step 8:** `pnpm --filter @myclash/api exec vitest run
src/common/db-schema-conformance.test.ts src/modules/matches/bout-columns.schema.test.ts` — green
      (the new columns exist since 0282). The select constants are checked by
      `bout-columns.schema.test.ts`; `db-schema-conformance` skips constants
      (`bout-columns.schema.test.ts:17-19`).
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

- Files: `git ls-files --cached --others --exclude-standard --deduplicate` (tracked files plus new
  files git does not ignore; `--deduplicate` because a conflicted path is listed once per stage
  during a rebase), keeping only paths that exist on disk (a deletion not yet staged is still
  listed). The gate's header says that in the shared folder `--others` also sees other sessions'
  untracked files, so a red may name a file this session did not write. Not a walk of the disk: a walk counts the ignored `apps/*/next-env.d.ts`
  (`.gitignore:47`) that any Next build leaves, and the `scanned` test then differs by machine. Not
  `git ls-files` alone: it misses a new file until it is staged, so a new reader passes on the
  machine that wrote it. Extensions `.ts`, `.tsx`, `.mjs`, `.sql`; kept when the path
  starts with `apps/`, `packages/` or `scripts/`, and dropped when it is a test or a generated
  file: `*.test.*`, `*.spec.*`, `*.fixtures.*`, `*.harness.ts`, `*test-helpers*`, any
  `/testing/` segment, `packages/db/fixtures/`, `packages/api-client/src/generated/`, and the
  gate's own files.
- `SIDE_TOKENS`, matched **anywhere in a word, not as whole words**: `red_registration_id`,
  `blue_registration_id`, `winner_registration_id`, `registration_a_id`, `registration_b_id`,
  `forfeiting_registration_id`, `redRegistrationId`, `blueRegistrationId`,
  `winnerRegistrationId`, `registrationAId`, `registrationBId`, `forfeitingRegistrationId`,
  `redRegId`, `blueRegId`. A
  whole-word match would miss a side read through a foreign-key name:
  `apps/api/src/modules/schedule/live-state.service.ts:243-244` reads both sides only as
  `registrations!matches_red_registration_id_fkey`. `redRegId` / `blueRegId` are how the shared
  UI compares a card or a protest with a Match side (`packages/ui/src/utils/bout-flow.ts:173`,
  `exchange-timeline.ts:251`, `:291`).
- Plus `registration_id` and `registrationId` as whole words, counted only in a file that also
  names `pool_members`, `match_penalties`, `match_forfeits`, `match_protests`, `penalt` or
  `protest` (the last two anywhere in a word and **ignoring case**: a card or protest helper rarely
  names its table, and writes "Penalty" as often as `penalty`).
- **Readers the tokens cannot see are listed by hand** (`"byHand": true`, `hits` 0) and are not
  treated as stale while their file exists. With the widened bare rule no such file is known
  today: `apps/web-staff/src/offline/db.ts` (`:164`, a queued card's `registrationId`) now hits,
  because it says "Penalty" and "protests", and gets a normal line. After Step 3, run the
  gate and check that each of these is a hit or a `byHand` line:
  `packages/ui/src/utils/protest-chip.ts:17`, `apps/web-staff/src/offline/resolve-entry-card.ts:56`,
  `packages/types/src/penalties.ts:110`, `packages/ui/src/utils/bout-flow.ts`,
  `packages/ui/src/utils/exchange-timeline.ts` (the cold review of 2026-11-24 found them with no
  token).
- Verdicts: `side-key` (visited, compares or builds sides through `sideKey`); `individual-only`
  (visited, team Matches are out on purpose, with the reason); `no-side-read` (names a link and
  reads no side: a probe's list of key names, an archive column map, a schema test); `not-yet`
  (not visited; its `why` starts with its slice, `1b:`, `1c:` or `2:`).
- Findings: a file with hits and no ledger line; a **visited** line whose `hits` differs from the
  file ("re-read this file, then update the count"); a line for a file with no hits and not
  `byHand` ("delete this line"); a line, `byHand` or not, for a file that is not in the file list
  ("delete this line"); an empty `why`; a `not-yet` with no slice. A `not-yet` line
  pins no count: the file is read whole in its slice, and other sessions editing it meanwhile are
  not stopped.
- **One verdict per file, so a file with open work stays `not-yet`.** A file is `side-key` only
  when every side read in it is done. `apps/api/src/modules/matches/scoring.service.ts` keeps the
  card comparison (`:628`) for 1b, so its line is `not-yet` with the `why` "1b: card comparison
  `:628`; mapper and winner writes done in 1a". Files Task 3 renamed and that no longer hold a
  token get no line at all (a line would be "delete this line").
- Raw assignments, in `.ts` and `.tsx` under `apps/` only. For each `(red|blue|winner)SideId`
  followed by `:`, read the value: when the rest of the line after `:` is empty, the value starts
  on the next line (a value the formatter wrapped); it ends at the first `,`, `;`, closing brace or
  line end at depth 0. It is a finding unless that value contains `sideKey(` or another `SideId`,
  or is a type (`string`, `null`, `undefined` joined by `|`, as in the inline types at
  `correction-outcome.ts:30` and `:47` and the interface `CorrectionInput.bout`, `:35-43`). The
  shorthand `{ redSideId }` passes: it copies a side id.
- The same rule the other way: a write into `winner_registration_id` whose value contains
  `SideId` is a finding ("a side id written into a Registration column; use `winnerColumns`").
  A write is any of `winner_registration_id:`, `['winner_registration_id'] =` and
  `.winner_registration_id =`: scoring writes the second shape
  (`scoring.service.ts:232`, `:254`, `:840`). Its value is read across lines, up to the first `;`
  or top-level `,` (the write at `:840-845` is a ternary over five lines). `winner-columns.ts`
  computes the value into local variables and writes `winner_registration_id: registrationId`,
  which holds no `SideId` and passes; the gate names no file as an exception.
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
  - `a side id written into winner_registration_id is a finding` — in each of the three shapes,
    including `matchUpdates['winner_registration_id'] = scored.winnerSideId;` and the five-line
    ternary shape of `scoring.service.ts:840-845` with `match.redSideId` on a wrapped line
  - `a type wrapped over several members is not an assignment` — source
    `bout: { redSideId?: string | null; winnerSideId: string | null; endReason: string }`
  - `bare registration_id counts only beside a side table, a penalty or a protest`
  - `a test file is not scanned`; `a harness file is not scanned`
  - `a byHand line for a file that does not exist is a finding`
  - `the ratchet: the ledger holds exactly N not-yet lines` — `N` is the pinned number of Step 4;
    the message says "this number may only go down"
  - `the real ledger lists the readers earlier drafts of this gate missed` —
    `apps/api/src/modules/schedule/live-state.service.ts`, `apps/web-staff/src/offline/db.ts`,
    and the five files of the cold review of 2026-11-24 listed under "The rule"
  - `scanned is the number of files the filters keep` — the test builds the list itself from
    `git ls-files --cached --others --exclude-standard --deduplicate`, with the same filters and
    the same "exists on disk" check, and compares; the number is above 100. A floor alone
    ("at least 150") is the shape `scripts/check-design-drift.test.mjs:295-297` rejects.
  - the registration pins, in the shape of `scripts/check-design-drift.test.mjs:315-351`: the
    pnpm script is the gate alone; CI runs it as its own step and never behind `&&`; `CI_GATES`
    holds `step: 'Check Match side readers'`; importing the gate does not run it; and
    `CONTRIBUTING.md` names `pnpm quality:side-readers` (the shape of
    `scripts/check-docs-drift.test.mjs:393`), which `gates.drift.test.ts` never reads.
- [ ] **Step 2:** `node --test scripts/check-side-readers.test.mjs` — expected: FAIL, module not
      found.
- [ ] **Step 3:** Implement the gate to the rule above.
- [ ] **Step 4: Fill the ledger.** Run the gate; it lists every unlisted file with its count. For
      each, read the file and write its line:
  - `side-key`: a file Task 7 changed whose every side read is done (`winner-columns.ts`; not
    `scoring.service.ts`, see "One verdict per file").
  - `individual-only`, with the reason from the design: one person's history and profile
    (`fighters/`, `results/fighter-career.ts`), the HEMA Ratings export, the fighter-status settle
    code (decision 7), Swiss (non-goal), migrations whose function a later migration replaced.
  - `not-yet`, with its slice: everything else. Known ones: `1b:` the card comparison, the
    scheduler, the scorekeeper screen, standings, Pool generation, forfeits, protests
    (`matches/` protest code and the pad's protest queue, `pending-events.ts:289`),
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
      **visited** file (`side-key` or `individual-only`; a `not-yet` line pins no count); the gate
      goes red with "re-read this file"; revert. In `scoring.service.ts`, put back
      `matchUpdates['winner_registration_id'] = scored.winnerSideId;`: red with "use
      `winnerColumns`"; revert. The new file of the next check is left **unstaged**: the gate
      must see it through `--others`. Add a new file under
      `apps/api/src` that reads it; the gate goes red with "no ledger line"; delete it.
- [ ] **Step 7:** `pnpm --filter @myclash/api exec vitest run
src/modules/admin/ci-health` — green (`gates.drift.test.ts` compares `ci.yml` with `CI_GATES`).
- [ ] **Step 8: The counts written in prose.** One more Lint step makes 29 steps and 26 gates
      (28 / 25 on 2026-11-24, re-count with `countLintSteps` after the rebase).
      `scripts/check-docs-drift.mjs:162-236` reads the whole doc corpus (`docCorpus()`, `:56-72`)
      with three phrasings (`:194-197`). Today the claims are seven, in six files: `CLAUDE.md:152-153`
      ("twenty-eight further steps", split over the line break), `CONTRIBUTING.md:17` and `:81-82`,
      `docs/ARCHITECTURE.md:4684`, `docs/CODE_QUALITY_REVIEW.md:17`,
      `.claude/skills/myclash-gates/SKILL.md:8-9`. Find them again with
      `rg -n "further (steps|independent gates|gates)" -g "*.md"` rather than trust these lines.
      `docs/CODE_QUALITY_REVIEW.md:17` also lists gates by name ("fourteen"): add this one and
      correct the number in words.
      Add the gate to the list under "Before pushing" in `CONTRIBUTING.md` and to the chain in the
      gates skill. `git add` the new script before running `pnpm test:scripts`
      (`package-manifests.test.mjs` requires every script target to be tracked). Run
      `pnpm quality:docs-drift` — green.
- [ ] **Step 9: Commit:** `test(quality): every reader of a Match side is listed (quality:side-readers)`.

### Task 9: Close the slice

- [ ] **Step 1:** The full chain of the `myclash-gates` skill, from a clean build of the shared
      packages.
- [ ] **Step 2:** `git diff --stat <commit before Task 3>..HEAD -- apps/api/src/modules/matches/clock.service.ts
apps/api/src/modules/matches/late-press.ts packages/rules/src/clock.ts
apps/api/src/modules/matches/level-step.ts apps/api/src/modules/matches/fighter-status.service.ts
packages/rulesets/test/fixtures packages/rulesets/test/tf_v1.fal2026.test.ts` —
      expected: no output, except `clock.service.ts` and `late-press.ts`. Those two changed under
      Task 7a (the operator's ruling of 2026-11-24, which supersedes "clock not touched" for that
      guard only): their expected diff is Task 7a's guard (with the two team columns it reads)
      and the one `row` cast. (The clock's
      writes also widen by `winner_team_id: null` through `noResultColumns`, Task 7, with no
      change to its files.)
- [ ] **Step 2b: Hard rule 3.** Task 3 changes `@myclash/rules` and `winnerColorFrom`, which the
      scoring pad reaches (`packages/types/src/match-winner.ts:45`,
      `apps/web-staff/src/components/MatchResultOverlay.tsx:133`). Only one of the four offline
      specs runs in CI: `tests/a11y/pad-offline-drill.spec.ts`, in the `Playwright and Axe` job
      (`pnpm test:e2e`, `ci.yml:536`). The other three are under `tests/e2e/`, which
      `playwright.config.ts:9` ignores. They run only through `playwright.e2e.config.ts` against a
      running stack (`E2E_BASE_URL`, `E2E_STAFF_URL`), and the `E2E (prod)` workflow is manual and
      has failed since 10-29 (`e2e-prod.yml:6-13`).
      **Before bringing up or rebuilding any stack, ask the operator.** The dev stack has fixed
      container names (`infra/docker-compose.dev.yml:42`, `:84`, …), so the machine holds one, shared
      with the other sessions. A local run also needs: (a) `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`,
      `E2E_ORG_SLUG` (`tests/e2e/global-setup.ts:27-29`); (b) an organiser account that administers
      that org (`scripts/seed-min.ts:9-11` makes only a super admin and an org with no owner); (c) a
      session the staff host can read: in dev the cookie is host-only
      (`apps/api/src/modules/auth/auth.service.ts:2401-2406`) and the dev stack has no `/staff`
      route on the admin host, so `SESSION_COOKIE_DOMAIN=.myclash.localhost`; (d) the branch's
      migrations applied to that database and a `.env` in the worktree. Without these a red pad
      spec reads as a Task 3 regression when it is a setup gap. Once the operator agrees, run each
      one alone, as `pnpm exec playwright test -c playwright.e2e.config.ts <spec>` with `<spec>`
      `tests/e2e/06-offline-sync.spec.ts`, then `08-offline-custom-ruleset.spec.ts`, then
      `40-offline-bout.spec.ts` (`pnpm test:e2e:prod -- <file>` ignores the filter),
      with `E2E_BASE_URL` / `E2E_STAFF_URL` pointing at it. Never point them at the deployed site:
      it runs `main`, not this branch.
      The slice is not reported done until the three are green here and the a11y drill is green on
      the pull request.
      **Operator ruling, 2026-11-24:** the three offline specs 06, 08 and 40 are skipped for
      slice 1a and owed by slice 1b, which changes the pad far more. The a11y drill runs on the
      pull request.
- [ ] **Step 3:** Review the slice with `code-architecture-reviewer` (CLAUDE.md routing). Then
      `git fetch`, rebase onto `origin/main` (renumber 0281/0282 if `main` took them, re-run the
      replay and both probes), the gate chain again, and
      `git push --force-with-lease origin feat/team-tournaments`. Watch CI on the draft pull request.
- [ ] **Step 3b: The closing commit's duty** (`CLAUDE.md`, "Where authority lives"): this plan is
      deleted. The spec stays in `docs/superpowers/specs/`, because it covers slices 1a to 5; its
      three pointers to this plan (spec `:5-6`, `:418`, `:602`) are updated to say slice 1a shipped
      and name its commits, and its "nine twins" (`:416`) becomes ten. `docs/superpowers/README.md`
      links this plan (`:31`) and says the spec is "Nothing is built" (`:28-29`): update both; no
      gate reads that folder, so a dead link there lands in silence.
- [ ] **Step 4:** Report to the operator in plain language: what exists now, what does not (no
      screen, no route), and the size of the "not yet" list that slices 1b and 1c must empty. The
      pull request stays a draft until the operator says otherwise; the operator merges it.

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
- **A team's size is 1 to 10** (operator, 2026-11-24; the design gave no number).
- **The operator gave "go" on 2026-11-24** and accepted the gate's cost for the other sessions.
- **The kind race is argued and tested one writer at a time**, not under forced overlap; that
  probe comes with the teams routes in 1b.
- **Indexes on the twin columns** come in 1b with their first readers. `db:review` does not warn
  about them (it reads only `create table` lines), so 1b must remember them by this line.
- **Reopen and replay clear `winner_team_id`**, so the clock's writes gain one null column in 1a;
  its files and logic do not change.
- **Protests get their team twin now** (operator, 2026-11-24); filing one for a team is 1b.
- **A bout waiting for a Fighter is refused before saving** (Task 7a, operator, 2026-11-24). It was
  not in the design; Task 7 Step 0 found that such a bout can be started and scored today. The card
  void stays open, and the scoring code passes a missing side through as before.
- **For 1b, from the Task 7a review:** `clearDependentPairing` nulls only the Registration ids
  (`bracket-dependents.ts:234`) and `swapFighterColor` swaps only the Registration ids
  (`matches.service.ts:955-958`). An emptied team bout would keep its team ids and the guard would
  not fire. Both are side readers the gate lists `not-yet`: `swapFighterColor` for 1b,
  `clearDependentPairing` for 1c (brackets are 1c in the design).
- **Deleting a Person who holds a team slot** fails at commit with a raw foreign-key error: the
  delete checks Registrations only (`persons.service.ts:267-282`). No slot can be created through
  the API before 1b, so 1b adds the check with the teams routes.
- **No twin for `match_forfeits.replacement_registration_id`**: a team's reserves are its slots.
- **The forfeit snapshot's JSON paths** (`archive.tables.ts:417-421`) map
  `winner_registration_id` only. No team forfeit is written before 1b, so the
  `winner_team_id` paths come with the forfeit code in 1b.
- **A cost for the other sessions.** Once the gate is in, a session that adds a side read to a
  **visited** file must re-read that file and update one number. A session that adds a **new**
  file with a side read must give it a ledger line, and cannot make it `not-yet` (that raises the
  pinned count, which the ratchet refuses): it must decide whether the file handles a team side
  (`side-key`), leaves teams out on purpose (`individual-only`), or reads no side
  (`no-side-read`). Files not yet visited do not stop anyone.

## Review record of this plan

`myclash-plan-review`, 2026-11-13.

- Pass 1, one cold reviewer: 1 BLOCKER, 7 MAJOR, 7 MINOR. All folded in. The BLOCKER: the gate's
  whole-word tokens missed two readers that exist today, so "every reader is listed" was false.
- Pass 2, by the author on the amended text: 0 BLOCKER, 0 MAJOR, 2 MINOR folded in (a docs-drift
  run in Task 2; excuse lines written from the gate's output, never from memory). CONVERGED with
  open questions: the gate's known limit above, and whether a corrected Exchange keeps its slot
  stamp (slice 2). The amended plan has not had a second cold pass; one before building is cheap.

Re-based on `main` at `a44b413fa`, 2026-11-24 (476 commits after the plan). Three read-only
passes checked every citation. Most held. What changed and was folded in: migration numbers
0271/0272 → 0281/0282; the read rule follows 0276, not 0203 (0273-0275 closed signed-in reads and
helper grants); `match_protests` (0276) is a new side link and gets a twin (operator ruling); the
new RLS check is 25 in `rls-probe-later-checks.mjs`; Task 3b also covers `archive-references.ts`;
`ROSTER_REFERENCES` gains `team_slots.person_id`; ADR-022 gets an index row and must not cite the
gate's file before it exists; the docs-drift claims are seven in six files; moved line numbers.

`myclash-plan-review`, 2026-11-24, on the re-based text.

- Pass 3, one cold reviewer (`plan-reviewer`): 1 BLOCKER, 6 MAJOR, 16 MINOR. The controller
  checked the BLOCKER and every MAJOR in code before folding. BLOCKER: the RLS-probe seed's
  Tournaments already hold Registrations, so the kind trigger would refuse the seeded teams; the
  seed gains two team Tournaments. MAJOR: reopen and replay widen the clock's writes (stated, the
  widened tests listed); the gate missed `redRegId` readers in the shared UI and card/protest
  helpers (tokens widened, five files pinned); the gate walked the disk (now `git ls-files`); the
  reverse rule missed the `['winner_registration_id'] =` shape; one verdict per file could not
  hold `scoring.service.ts` (now `not-yet` with its open item); two falsifiers died on the proof
  block before reaching the probe (rewritten to get past it). All 16 MINOR folded in, including two
  more same-kind checks (`matches_winner_same_kind`, `match_forfeits_same_kind`), `VOLATILE`
  pinned, a null side throws instead of `''`, `turbo run typecheck` for test files, the right
  schema test, the hard rule 3 run on the pull request.
- Pass 4, a second cold reviewer on the amended text: 1 BLOCKER, 1 MAJOR, 8 MINOR, 5 NIT. Most
  pass-3 folds held in code. BLOCKER: three of the four offline specs never run in CI
  (`playwright.config.ts:9` ignores `tests/e2e/**`; `e2e-prod.yml` is manual and red since 10-29),
  so Task 9 runs them against a local stack built from the branch, or stops and asks. MAJOR: a
  tracked-only file list hides a new reader until it is staged; the gate reads
  `--cached --others --exclude-standard`. All MINOR and NIT folded in, among them the draft team
  Tournament under the published Event, the team Tournament's `match_rules` copy in the cascade
  seed, the reverse rule read across lines, the `unplayedMatchColumns` writers, and Task 7 Step 0
  (settle whether a Match with no side reaches scoring before building the throw).
- Pass 5, a third cold reviewer: 0 BLOCKER, 2 MAJOR, 6 MINOR, 10 NIT. MAJOR: the Task 5 proof
  block checked constraint names only, and the probe tried "both present" on two tables of eight
  (every check's definition text is now pinned and every one-kind check gets a probe case); the
  local route for the offline specs lacked its accounts, cookie domain and migrations, and asked
  the operator too late (now listed, and the operator is asked before any stack is touched). All
  MINOR and NIT folded in, among them the closing commit's plan deletion, the full list of
  recompute callers in Task 7 Step 0, `git grep` in place of the missing `rg`, and an
  `EXPECTED_CHECKS` computed before the run.
- Pass 6, a fourth cold reviewer: 0 BLOCKER, 1 MAJOR, 5 MINOR, 4 NIT. MAJOR: the probe case for
  `match_forfeits_winner_one_kind` could never pass. Postgres tests a table's checks in name order,
  and `…_forfeiting_one_kind` or `…_same_kind` always refuses such a row first; together they
  already imply it. The check is dropped (thirteen constraints) and the header says why. MINOR and
  NIT folded in: Task 4's `EXPECTED_CHECKS` computed before the run, a proof line and probe case
  for `pool_members_pool_team_key` and two more Task 4 cases, commits through `git add` and
  `git commit -F`, `docs/superpowers/README.md` in the closing commit, the real recompute callers
  and the `loadRoundContext` doors in Task 7 Step 0, `level-step.ts` and the golden test in the
  Task 9 diff.

- Task 7a (added 2026-11-24 after the operator's ruling), one cold pass: 0 BLOCKER, 2 MAJOR,
  4 MINOR, 5 NIT, all folded in. MAJOR: the guard judged snake_case keys that the card door
  (camelCase `MatchContext`) and the hit door (a fresh object) never carry, so it would never fire
  there — now an explicit `sides` input computed by each door; the pad's text-pin tests could not
  show behaviour — now a pure `sideMissing` plus one browser a11y story.

```text
NOT CONVERGED — 4 passes, 0 BLOCKER, 1 MAJOR outstanding at the fourth pass
```

The skill's four-pass limit was reached with that one MAJOR open. It is closed by deleting a
check that the other two imply, which no fifth pass was run to confirm. The trend over the four
passes: 1/6 → 1/1 → 0/2 → 0/1 (BLOCKER/MAJOR). Open questions for the build: whether the team
Tournaments under the RLS seed's published Event change a count another check reads (settled by
the first `pnpm db:rls-probe` run in Task 4 Step 7); whether a Match with a missing side reaches
scoring (Task 7 Step 0).
