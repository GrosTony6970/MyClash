# Pools page overhaul: Configure / Matches / Standings

**Status**: design

**Audience**: organizers running tournaments via the web-admin during pool play.

---

## Context

The Pools page at [`/org/[slug]/events/[eventId]/pools`](apps/web-admin/app/org/[slug]/events/[eventId]/pools/page.tsx) exposes roughly 40% of the backend's pool-configuration surface. Operators can't see the generated matches per pool, and there's no standings view at all — `getPoolStandings()` doesn't exist. The page is `max-w-5xl`-constrained on wide monitors.

Three connected surfaces are overhauled together:

1. **Configure** — refactor the existing page to full-width, expose 5 hidden referee constraints, add hover help tooltips on each constraint.
2. **Matches** — new view showing per-pool match tables with inline lice/referee edits and tournament-configured fighter side colors.
3. **Standings** — greenfield. New backend `PoolStandingsService`. Per-pool + overall views. Ruleset-driven column schema. Live updates via realtime.

All three live as tabs inside the existing `/pools` URL.

---

## Goals

1. Make every backend-supported pool-generation option reachable from the UI.
2. Give operators a per-pool view of generated matches with inline triage (lice + referee).
3. Ship a live standings view that adapts to the tournament's ruleset.
4. Take advantage of full screen width — drop `max-w-5xl`.

## Non-goals

- End-to-end Playwright tests for the three tabs.
- Visual regression of the pool grid layout or column accents.
- Realtime reconnect-after-disconnect handling (matches the existing scoring screen's behavior).
- Race-condition handling on simultaneous lice edits — last-write-wins is acceptable.
- Public-facing standings page. The Standings tab is for organizer staff.

---

## Architecture

**Three-tab shell** at `/pools`: `Configure | Matches | Standings`. URL anchors `#configure` (default), `#matches`, `#standings`. Progressive enablement: Matches enabled once pools exist; Standings enabled once at least one match has `status: 'completed'`. Disabled tabs render muted with a tooltip. All tabs drop `max-w-5xl` → `w-full`.

---

## Configure tab

**Layout**

Sticky right sidebar (~280px) holds the config form + lifecycle actions. Pool grid fills left as `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`. Conflict banner spans full width above the grid.

**Sidebar fields with hover-help tooltips** (small `ⓘ` icon next to each label):

- **`schoolSeparation`** (toggle, default on) — _Try to place fighters from the same club in different pools. Reduces same-club matches during pool play. When the algorithm can't fully separate (small clubs / few pools), it minimizes the count of same-club pairings instead of refusing to generate._
- **`skillBalance`** (toggle, default on) — _Distribute high-skill and low-skill fighters evenly across pools using HEMA Ratings scores. Pools end up with comparable average rating so no pool is a "death pool" of all top seeds._
- **`enforceRefereeNoBackToBack`** (toggle, default off) — _Prevent a referee from being scheduled to officiate two pools in a row. Gives them a break between duties._
- **`refereeRestMinSlots`** (number, 0-10, default 1; disabled when noBackToBack is off) — _How many pools a referee must rest between officiating duties. 1 = at least one pool gap between two pools they ref. Higher = more recovery time._
- **`enforceDedicatedRefereeRest`** (toggle, default off) — _Ensure referees who are also competing get a rest between the pool they're refereeing and the pool they're fighting in, so they're not switching roles back-to-back._
- **`enforceFighterRefereeNoOverlap`** (toggle, default on) — _Never schedule a fighter to referee the same pool they're fighting in. This should always be on — turn it off only for unusual events where roles intentionally overlap._
- **`preferHighRatedReferees`** (toggle, default off) — _When multiple referees are available for the same time slot, prefer those with higher referee ratings._

**Tooltip implementation**

New `<HelpTooltip text={...}>ⓘ</HelpTooltip>` component in [`packages/ui/src/components/HelpTooltip.tsx`](packages/ui/src/components/HelpTooltip.tsx). CSS-only show/hide (`group-hover:block group-focus-within:block`). Keyboard-accessible: icon is a `<button type="button">` with `aria-label={\`Help: ${text}\`}`, tooltip exposed via `aria-describedby`. Mirrors the existing pattern at [`apps/web-admin/app/admin/users/page.tsx:91`](apps/web-admin/app/admin/users/page.tsx#L91).

**i18n**

All 7 help strings under `organizer.pools.configure.help.*` (EN + FR).

**Lifecycle actions** at bottom of sidebar (existing behavior preserved):

- `Generate` (primary)
- `+ Add empty pool`
- `Delete all`
- `Force regenerate` (danger, shown only when pools exist)

**Pool grid + conflict banner + drag-drop**: existing components, unchanged behavior.

---

## Matches tab

**Layout**

Stacked sections, one per pool. Each section header shows `Pool A (8 fighters · 28 matches · 12 done / 16 scheduled)` derived from the match list. Section body is a 7-column table.

**Columns**

| Col     | Source                                       | Editable? | Notes                                                                       |
| ------- | -------------------------------------------- | --------- | --------------------------------------------------------------------------- |
| Round   | `match.round_number`                         | no        | Sorted ascending                                                            |
| Red     | red registration → display name + club chip  | no        | 4px left accent bar from `tournament.scoring_config.display.sideColors.red` |
| Blue    | blue registration → display name + club chip | no        | Same accent treatment for blue                                              |
| Score   | `red_score` + `blue_score` or `—`            | no        | "5 — 3" when completed                                                      |
| Status  | `match.status`                               | no        | Pill: scheduled / ready / running / completed / forfeit                     |
| Lice    | `match.lice_id`                              | **yes**   | Dropdown: every Lice in event + "Unassigned"                                |
| Referee | `match.referee_id`                           | **yes**   | Dropdown: every person `is_referee` in event + "Unassigned"                 |

**Tournament-color binding**

Read `scoring_config.display.sideColors.{red, blue}` from the tournament. Map color tokens → Tailwind classes via a new util `apps/web-admin/.../matches-tab/color-token.ts` exporting `accentClassFor(token: ColorToken): string`. 8 supported tokens: red, blue, green, yellow, purple, orange, black, white. Unknown tokens fall back to red/blue literals.

**Row click**

Anywhere except the editable dropdown cells → navigates to the existing scorekeeping screen `/matches/[matchId]`. Dropdown cells `event.stopPropagation()` so editing doesn't navigate.

**Inline edit semantics**

Change a dropdown → optimistic local update → `PATCH /api/v1/matches/:id` with `{ lice_id }` or `{ referee_id }`. On 200: toast confirms. On error: revert local state + toast the error.

**Realtime**

Supabase channel `pool-matches-list-${tournamentId}` listening `event: '*'` on `matches` filtered by `phase_id=eq.${poolPhaseId}`. Merges incoming payloads into local state by `id`. Subscribes on tab mount, tears down on tab change.

UX consequences:

- Scorekeeper on another machine completes a match → Status/Score columns flip live.
- Another operator changes a Lice → this tab reflects the change.
- This operator's own optimistic update + the realtime echo of that update gracefully no-op (merge is idempotent by id).

---

## Standings tab

**Layout**

Pill toggle `Overall | By pool` at top (default **Overall**). URL anchor `#standings-overall` / `#standings-by-pool`. Refresh preserves the choice. CSV export buttons per scope.

**Overall view**: one table covering every fighter in the tournament, ranked by the ruleset's tiebreaker chain.

**By pool view**: per-pool sections stacked vertically, each its own ranked table. "Export all pools" header button generates a single combined CSV with an extra `Pool` column.

**Column schema is ruleset-driven**

Chrome columns always present: Rank, Fighter (+ club chip), Status. Dynamic columns come from the ruleset module's `standingsColumns` declaration:

- **TF_v1**: `W, L, D, F, ptsScored, ptsConceded, diff, doubles, hitsGiven, hitsReceived`
- **TF_v1_no_afterblow**: `W, L, D, F, ptsScored, ptsConceded, diff`
- **Generic_PointsCap**: `W, L, D, ptsScored, ptsConceded, diff`

The frontend table is generic — it iterates the `columns` array from the API response and renders whatever the ruleset declared. No hardcoded TF_v1 assumptions in the component.

**Live updates**

Same Supabase realtime pattern as Matches tab. Each match change triggers a full standings refetch (not row-patching, since ranking can shift on any change). One channel per active view.

**CSV export**

Client-side. Tiny RFC 4180 escape helper (quote fields containing `,`, `"`, or newlines; double internal quotes). No CSV library dependency. Filename: `<event-slug>-<tournament-slug>-<pool-or-overall>-standings.csv`. "Export all pools" generates one CSV with a leading `Pool` column.

**Empty / loading / error states**

- No completed matches yet → "No matches completed yet. Standings will appear as scorekeepers finish matches."
- Loading → skeleton table.
- API error → error banner with Retry.

---

## Backend additions

### Ruleset package extensions

[`packages/rulesets/src/types.ts`](packages/rulesets/src/types.ts) — extend the `Ruleset` interface:

```ts
export interface StandingsColumn {
  key: string;
  label: string;
  type: 'number' | 'string';
  sortDesc?: boolean;
}

export interface RankingRule {
  key: string;
  direction: 'asc' | 'desc';
}

export interface Ruleset {
  // existing: code, version, displayName, …
  standingsColumns: StandingsColumn[];
  rankingChain: RankingRule[];
  computeStandingsRows(matches: PoolMatchInput[], members: PoolMemberInput[]): StandingsRow[];
}
```

`PoolMatchInput` / `PoolMemberInput` / `StandingsRow` are shared types defined in the same file.

**Per-ruleset modules**:

- [`packages/rulesets/src/tf_v1/`](packages/rulesets/src/tf_v1/) — exports `standingsColumns`, `rankingChain`, `computeStandingsRows`. The math for TF_v1 (W/L/D/F + doubles + hits + points) likely already lives in scoring services — task work extracts it into pure functions on the ruleset module.
- [`packages/rulesets/src/tf_v1_no_afterblow/`](packages/rulesets/src/tf_v1_no_afterblow/) — same shape, no doubles column.
- [`packages/rulesets/src/generic_points_cap/`](packages/rulesets/src/generic_points_cap/) — minimal column set.
- FormulaRuleset gets an empty columns array + a "Ruleset doesn't expose standings yet" message in v1.

### New pool-standings module

Files (new):

- `apps/api/src/modules/pool-standings/pool-standings.module.ts`
- `apps/api/src/modules/pool-standings/pool-standings.controller.ts`
- `apps/api/src/modules/pool-standings/pool-standings.service.ts`
- `apps/api/src/modules/pool-standings/pool-standings.service.test.ts`

Modify `apps/api/src/app.module.ts` — register `PoolStandingsModule`.

**Endpoint**: `GET /api/v1/tournaments/:tournamentId/pool-standings?mode=by-pool|overall` (default `overall`). Guarded by the existing scorekeeper-role-or-higher check.

**Service flow**:

1. Read tournament → `(ruleset_code, ruleset_version)`.
2. `registry.get(code, version)` → `Ruleset`. Read `standingsColumns` + `rankingChain` + `computeStandingsRows`.
3. Query all completed matches in the tournament's pool phase, joining pool_members → persons → clubs.
4. Call `ruleset.computeStandingsRows(matches, members)` → per-fighter rows keyed by column key.
5. Apply `rankingChain` to sort.
6. Build response: `{ columns, rows }` (overall) or `{ columns, pools: [{ poolId, poolName, status, rows }] }` (by-pool).

**Response shape**

```ts
// mode=overall
{
  rulesetCode: string,
  rulesetVersion: string,
  columns: StandingsColumn[],
  rows: StandingsRow[],
}

// mode=by-pool
{
  rulesetCode: string,
  rulesetVersion: string,
  columns: StandingsColumn[],
  pools: Array<{
    poolId: string,
    poolName: string,
    status: 'in_progress' | 'completed',
    rows: StandingsRow[],
  }>,
}

interface StandingsRow {
  rank: number,
  registrationId: string,
  displayName: string,
  club: { id: string, name: string, abbreviation: string | null } | null,
  status: 'in_progress' | 'completed',
  stats: Record<string, number | string>,  // keyed by column.key
}
```

### Pool-generation referee-constraint pass-through

[`apps/api/src/modules/phases/dto/phases.dto.ts`](apps/api/src/modules/phases/dto/phases.dto.ts) — extend `GeneratePoolsDto` with 5 optional fields validated with class-validator:

- `enforceRefereeNoBackToBack?: boolean`
- `refereeRestMinSlots?: number` (0-10)
- `enforceDedicatedRefereeRest?: boolean`
- `enforceFighterRefereeNoOverlap?: boolean`
- `preferHighRatedReferees?: boolean`

[`apps/api/src/modules/phases/phases.service.ts`](apps/api/src/modules/phases/phases.service.ts) `generatePools()` — merge these into the `pool_assignment_settings` row before invoking the algorithm.

[`apps/api/src/modules/phases/pool-generator.ts`](apps/api/src/modules/phases/pool-generator.ts) — verify the generator already consumes these settings from `pool_assignment_settings` (the schema already exists per audit). Wire them in if not.

**No new endpoint** — existing `POST /tournaments/:tournamentId/generate-pools` accepts the extended DTO.

### Match PATCH — lice + referee fields

Verify `UpdateMatchDto` accepts `liceId?: string | null` + `refereeId?: string | null`. If not, add them with `@IsUUID() @IsOptional()`. Wire `matches.service` to write `lice_id` / `referee_id` columns. Columns already exist on `matches` (no migration).

### No DB migrations

All new fields live inside existing JSONB columns (`pool_assignment_settings`) or existing typed columns (`matches.lice_id`, `matches.referee_id`). Ruleset extensions are TS/exports only.

### Realtime infrastructure

No backend changes. `matches` table is already published to Supabase realtime (the existing scoring screen uses it). New subscriptions from Matches and Standings tabs reuse the same infrastructure.

---

## Testing strategy

### Backend vitest

- `pool-standings.service.test.ts`:
  - TF_v1 4-fighter pool computes correct W/L/D + tiebreakers.
  - Empty completed-matches yields empty rows.
  - `overall` mode flattens across pools and applies the ranking chain globally.
  - `by-pool` mode preserves pool boundaries; each pool's rows are independently sorted.
  - Ruleset switch produces different column schemas (TF_v1 vs Generic_PointsCap).
- Per-ruleset `<code>-standings.test.ts` files: each ruleset's `computeStandingsRows` produces the expected stats on canonical input.
- Existing `pool-generator.test.ts` — extend with one case verifying the 5 referee-constraint fields flow from DTO into the algorithm.

### Frontend vitest

- Unit test on `accentClassFor(token)` — given each of 8 supported color tokens, returns the right Tailwind class. Plus fallback for unknown tokens.
- No render tests for the three tabs (form + table glue covered by manual smoke).

### Manual smoke

**Configure tab**

1. Open `/pools` on 1440px viewport. Full-width layout, sticky right sidebar.
2. `ⓘ` tooltips appear on hover/focus for each constraint.
3. Toggle `enforceRefereeNoBackToBack` off → `refereeRestMinSlots` becomes disabled.
4. Click Generate → server-side log confirms 5 referee fields arrive in the DTO. Pool grid populates. Matches tab unlocks.

**Matches tab**

1. Per-pool sections render with summary chips.
2. Change `sideColors.red` to `yellow` in Settings → Display → return to Matches → Red column accent is now yellow.
3. Change a row's Lice → optimistic update + toast.
4. Open page in second browser tab → change Lice in first tab → second tab reflects within ~1s (realtime).
5. Complete a match via scoring screen → Score and Status columns update live.
6. Click row → navigates to scoring screen.

**Standings tab**

1. With ≥1 completed match, Standings unlocks. Default opens on Overall.
2. Overall table renders TF_v1 column set.
3. Switch to By pool → URL updates. Refresh preserves view.
4. Complete another match → both views refetch automatically.
5. Click Export CSV → file downloads with correct columns + filename.
6. Switch ruleset to Generic_PointsCap in Settings → Basics → Standings columns change (no Doubles / Hits / F).
7. Pool with zero completed matches: fighters show status "in progress".

### Not tested

- End-to-end Playwright on the three tabs.
- Visual regression of pool grid or column accents.
- Realtime reconnect-after-disconnect.
- Simultaneous lice edits from two operators (last-write-wins is acceptable).
- Mid-tournament ruleset switch edge cases.

---

## Reuse signals

- `HelpTooltip` pattern from [`apps/web-admin/app/admin/users/page.tsx:91`](apps/web-admin/app/admin/users/page.tsx#L91) — extract into `@myclash/ui`.
- `<SortableHeader>` + `useSortableList` already in `@myclash/ui` — apply to the Standings tables for column-header sorting (free).
- `<DataTable>`, `<StatusBadge>`, `<RowActionButton>` from `@myclash/ui` for the Matches tab.
- Supabase realtime pattern from the existing scoring screen.
- `Intl.Collator` for locale-aware fighter name sort (already used in `SortableHeader`).
- `useFocusTrap` from `@myclash/ui` if any new modal lands (probably not).

---

## Open items for the implementation plan

- Confirm `UpdateMatchDto` already accepts `liceId` + `refereeId`. If not, add as optional fields with `@IsUUID()`.
- Confirm `pool_generator.ts` already reads the 5 referee constraint fields from `pool_assignment_settings`. If it ignores them today, wire them into the algorithm.
- Confirm TF_v1's `rankingChain` and per-fighter stat math exist somewhere in the scoring services. If yes, extract into the ruleset module. If no, write fresh based on observation 263.
- Decide whether `FormulaRuleset` ships with an empty standings schema (v1) or full standings support (out of scope).
- Confirm Supabase realtime is enabled on the `matches` table for the relevant Postgres replication slot (the scoring screen demonstrably uses it, so this should be automatic).
