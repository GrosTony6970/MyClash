# MCP slice 3 — organiser reads (the query panel's tools, shared) — plan

Spec: `docs/superpowers/specs/2026-11-24-mcp-server-design.md` § Slice 3. Branch `feat/mcp-server`
(worktree `.claude/worktrees/mcp-server`), draft PR #110. #110 merges after this slice (ruling 986).

## What changes, in plain words

1. **The query panel's access setting works as its names say** (ruling 966). Today "Organisers + head
   judges" lets in organisers only, because MyClash has no head-judge role. After: a head judge is
   **anyone on the Event's referee list** (ruling 987). "Anyone with tournament access" lets in the
   organisers, the Event's referees and anyone on the Event's roster. The check is one function, used
   by the panel and by Claude.
2. **The "coaches" choice goes** (ruling 988). MyClash has no coach. A Tournament set to it reads as
   "Organisers + the Event's referees".
3. **The panel's tools take names, never ids.** Today the model must pass a fighter's registration id
   to `get_fighter_stats`, and no tool ever shows one, so that tool cannot work. After: a pool, a
   fighter and a referee are named by name, in the panel and in Claude.
4. **The panel's pool standings come from the public table** (operator, plan approval). Today
   `get_pool_standings` ranks by wins, then points, which is not the ruleset's order, so the panel
   and the public Tournament page can disagree on who leads Pool 2. After: it reads the same pool
   tables as the public page, ranked by the ruleset.
5. **Claude gets twelve organiser tools** — the panel's thirteen minus `get_pool_standings`
   (`tournament_standings` already answers that from the public table). Each takes the Event slug and
   the Tournament slug, applies the Tournament's access setting, and answers with names only.

## Rulings (2026-11-26) — asked story-first

- **987** (story: Marc sets "Organisers + head judges"; Julie referees on piste 2 all weekend and is
  refused) — a head judge is anyone on that Event's referee list (`event_referees`), whatever their
  qualification. Panel and MCP.
- **988** (story: a coach asks Claude how his fighters are doing; MyClash has no coach) — remove the
  coaches setting; a Tournament set to it reads as the head-judges setting.

## Calls made (the operator may overrule)

- **C1. The policies nest.** `organizers_only` ⊂ `organizers_head_judges` ⊂
  `anyone_with_tournament_access`: an Event referee passes the widest one too, though not on the
  roster.
- **C2. The policy value keeps its name** (`organizers_head_judges`); only its label changes, to
  "Organizers + the Event's referees" / "Organisateurs + arbitres de l'Événement". Renaming the
  stored value buys nothing a reader sees.
- **C3. `estimate` and `history` read the Tournament's setting.** Today they check
  `organizers_only` whatever the setting, so a person the setting lets in can ask but not see their
  own history. The shared check reads the setting on all three routes.
- **C4. A read error in the access check throws** (a 500 in the panel, the generic failure in
  Claude). Today the roster read's error is ignored and reads as "not on the roster".
- **C5. MCP writes nothing** (ruling 985: the door passes read-only mode). No query history row, no
  AI key check, no per-hour limit (spec call D): the door's own throttle applies.
- **C6. Names resolve inside the shared tools.** `pool` is a pool's name (the panel's enum lists the
  names); `fighter` is a fighter's name (contains, case-insensitive); `judge` is a referee's name.
  A name that matches several fighters answers a plain message listing them, never a guess.
- **C7. No raw id in a tool's output.** The fallbacks `?? match.match_id` (find_matches,
  get_bracket_status) become an empty cell; `?? match.pool_id` goes (`pools.name` is NOT NULL,
  `0001_init.sql:339`, so it cannot fire).
- **C8. `event_status` stays out of v1** (spec: only if an existing read covers it; none does).
- **C9. The panel's `get_pool_standings` reads the public pool tables** (operator, at plan
  approval: "also fix panel standings"). It ranked by wins then points
  (`tournament-query.tools.service.ts:348`), not by the ruleset. Claude still does not get that
  tool: `tournament_standings` reads the same tables.
- **C11. Claude applies the public Event gate first** (`readableEventBySlug`, as every slice 2
  tool does), then the policy. The panel's route checks the policy only, so a referee on a draft
  Event's list gets in through the panel and not through Claude. Accepted.
- **C12. A refusal is `ForbiddenException`, nothing else.** `assertOrgRole` throws it for "not a
  member" and "role too low" (`organizations.service.ts:44,591`) and a plain `Error` on a failed
  read (`:586`); `assertQueryAccess` throws `ForbiddenException` for its own "no". Claude turns that
  class alone into the refusal; any other throw is the generic failure.
- **C10. One table of tool arguments** (`QUERY_TOOL_SPECS`) builds the panel's JSON definitions and
  Claude's zod input. Two hand-kept lists would drift.

## Pre-flight (verify in code before Task 1; record each in the ledger)

- `event_referees(event_id, person_id)` keyed by `global_persons.id` since 0063;
  `global_persons.claimed_by_user_id` UNIQUE (0063 `global_persons_claimed_by_user_id_uk`).
- `persons_event_id_claimed_by_user_id_key` (0220): one roster row per account per Event.
- The CHECK on `tournament_query_settings.access_policy` (0033) is auto-named: read its real name
  from a PG17 replay before the migration drops it (memory: a wrong name fails SILENTLY).
- Migration number: `main` ends at 0280; the team-tournaments branch holds 0281-0285. This slice
  takes **0286** — re-check both right before creating the file.
- **Overlap:** team-tournaments `0284_query_matches_team_sides.sql` rewrites
  `vw_tournament_query_matches`. This slice changes no view; Task 3 reads only columns that exist
  on `main`. Whoever merges second re-runs the tool tests.
- The tournament slug: unique per Event? Read the constraint; the MCP read is by
  `(event_id, slug)`.
- `vw_tournament_query_pools.pool_name` and `vw_tournament_query_matches` column names on `main`.
- Which a11y/browser specs open the Event page holding `TournamentQueryPanel` (run them after T2).

## Tasks (subagent-driven; one task = one commit, or a task + its fix commits)

### T1 — one access check for the query tools (966, 987, C1, C3, C4)

- New `apps/api/src/modules/tournament-query/tournament-query.access.ts`, the one owner:
  - `queryTournamentContext(supabase, tournamentId)` — moved from the service's private
    `getTournamentContext` (same select string).
  - `readQuerySettings(supabase, tournamentId)` — moved `getSettings` + `mapSettings`.
  - `assertQueryAccess(deps, tournament, userId, settings)` — `organizers_only`: org admin.
    `organizers_head_judges`: admin, or an Event referee. `anyone_with_tournament_access`: admin, an
    Event referee, or a claimed roster row at the Event. Anything else: refused.
  - `isEventReferee(supabase, eventId, userId)`: `global_persons` by `claimed_by_user_id`, then
    `event_referees` by `(event_id, person_id)`. Read errors throw.
- `TournamentQueryService` calls these; `estimate` and `history` pass the real settings.
- Tests (`tournament-query.access.test.ts`): a table of policy × reader (org admin, Event referee,
  roster fighter, stranger, `anonymous`) → in/out, each row a case; every select string and `eq`
  asserted; a read error throws. Service tests: `estimate` and `history` honour the setting. Each
  new branch falsified (remove it → its case goes red).

### T2 — remove the coaches setting (988, C2)

- Migration `packages/db/migrations/0286_query_access_no_coaches.sql`: rows at
  `organizers_head_judges_coaches` → `organizers_head_judges`; drop the CHECK by its real name; add
  it back with three values. Replayed on PG17 (`pnpm db:migrations:replay`), and the old value is
  refused after it.
- DTO enum and the service's value list lose the value (one list: the DTO's; the service reads it).
- Panel `TournamentQueryPanel.tsx`: the option goes. i18n en + fr: `access.coaches` goes;
  `access.headJudges` relabelled (C2).
- `pnpm openapi:client` (the DTO changed); the generated file alone, in its own commit of this task.
- Tests: the DTO refuses the old value; the panel lists three options. Run the browser specs of
  that page locally.

### T3 — names, not ids, in the shared tools (C6, C7, C10)

- `tournament-query.tools.ts`: `QUERY_TOOL_SPECS` (name, description, args with a kind each:
  string, number range, fixed enum, weapon, pool, lice, division, club list). The panel's
  `buildTournamentToolDefinitions(context)` builds from it. `pool_id` → `pool`, `fighter_id` →
  `fighter`, `judge_id` → `judge`.
- `TournamentToolContext.poolIds` → `poolNames` (`getToolContext` reads `pool_name`);
  `validateToolCall` checks names.
- `tournament-query.tools.service.ts`: `execute` resolves names (pool by name, fighter by contains,
  judge by contains); several fighters → a `list` result naming them. Output fallbacks per C7.
- Tests: definitions carry no `*_id` argument; `get_fighter_stats` and `find_matches` by name;
  several matches → the list; no output holds a raw id (`expectNoRawIds` on each tool's result).

### T3b — the panel's pool standings from the public table (C9)

- Move `toPools` (`mcp/tools/tournament-standings.ts:94`) to the pool-standings module
  (`pool-standings/pool-table-rows.ts`), the one owner of "a pool table as rows of rank, name,
  club and the ruleset's columns"; `tournament_standings` imports it from there.
- `TournamentQueryToolsService.getPoolStandings` reads `PoolStandingsService.getPoolStandings(
tournamentId, 'by-pool')` (the public page's read), keeps the pool named by `pool` (or all), and
  maps it through the moved function: columns Rank, Pool, Fighter, Club, then the ruleset's own
  columns in its order. `TournamentQueryModule` imports `PoolStandingsModule`.
- Tests: the rank order is the service's, not wins-then-points (a fixture where the two disagree);
  the pool filter; a Tournament with no pool tables answers the empty result; `tournament_standings`
  tests stay green unchanged.

### T4 — the twelve tools in Claude (C5, C8, C9)

- `apps/api/src/modules/mcp/tools/tournament-query.ts`: `registerOrganiserTools(server, caller,
deps)`. Per tool: zod input = `{ event: slug, tournament: slug }` + the spec's args;
  `readableEventBySlug` → the Tournament by `(event_id, slug)` (unknown →
  `noTournamentRefusal`) → `readQuerySettings` → `assertQueryAccess` (refused → one plain sentence
  naming the setting) → `getToolContext` → `validateToolCall` (its message as the refusal) →
  `execute`. Through `answer()`. All `readOnlyHint: true`.
- `McpToolDeps` gains the tools service; `TournamentQueryModule` exports it; `McpModule` imports
  `TournamentQueryModule`; `pnpm openapi:client` (route order), the file alone in its own commit.
- Tests: per tool, an organiser gets an answer with no raw id; a stranger gets the refusal under
  `organizers_only`; an Event referee gets in under `organizers_head_judges`; the membership read
  fails → the generic failure, not the refusal (C12); nothing is written (no `insert`/`upsert` on
  the mock); the HTTP test's tool list holds 22 tools, all read-only.
- Real boot once (a module cycle shows only there): build the API, `PORT=4001 node
apps/api/dist/main.js` reaches "listening".

### T5 — docs and the connector e2e

- ARCHITECTURE §28.5b (the twelve tools, the access setting, what MCP skips), and the query
  panel's section (the shared check, the setting's three values).
- `tests/e2e/48-mcp-connector.spec.ts`: one organiser tool as fighter A on a demo Tournament →
  the refusal under `organizers_only` (fighter A is no organiser). Pre-flight: confirm the fixture.
- Closing commit: delete this plan (the spec stays in `specs/` until slice 4).

## Verification

Each task: its tests, each guard falsified, the complexity baseline re-pointed for its edited files
(`docs/code-quality-complexity-baseline.json:409-412` holds four of them), `git status --short` and `git stash list` after every
subagent. Then the whole-branch review, one fix wave and a scoped re-review, `myclash-gates`, the
browser specs of the panel page, push, CI.
