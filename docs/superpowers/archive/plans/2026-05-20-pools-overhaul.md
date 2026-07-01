# Pools Page Overhaul Implementation Plan

> **Status (2026-07-01 doc review):** Shipped — the tab-shell pools page, 5 referee constraints, per-pool matches editing, and ruleset-driven standings all shipped to `main`. Two deltas vs. this plan: the delivered page ships a 4th **Referees** tab, and the `accentClassFor` color-token util moved into `@myclash/ui` rather than living in `_tabs/`. Audited against code; see docs/DOC_REVIEW_2026-07-01.md.

<!-- -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `/pools` into a tabbed page (planned as 3 tabs — Configure / Matches / Standings; a 4th **Referees** tab was added during delivery), expose 5 hidden referee-constraint pool-generation options with hover-help tooltips, ship the first per-pool matches view with inline lice + referee editing and tournament-driven side colors, and ship a greenfield ruleset-driven standings view with Overall + By-pool modes and live updates.

**Architecture:** Frontend keeps the existing `/pools` URL but renders a tab shell with URL-hash routing (`#configure`/`#matches`/`#standings`; the shipped shell also adds `#referees`); progressive enablement based on pool + match state. Backend changes are additive: `GeneratePoolsDto` extension for 5 referee constraints (columns already exist in `pool_assignment_settings`), one new `referee_id` column on `matches`, a new general `UpdateMatchDto`, a new `PoolStandingsService` + `GET /tournaments/:id/pool-standings` endpoint that reads ruleset-declared `standingsColumns` + `rankingChain`, and `Ruleset` interface extensions exposing those declarations from each ruleset module. Realtime listens on the `matches` table for the pool phase via Supabase's existing channel pattern.

**Tech Stack:** NestJS + Zod (via `nestjs-zod` / `createZodDto`; the shipped `GeneratePoolsDto` uses Zod, not the class-validator decorators shown in Task 1 below) + Drizzle (backend), Next.js 16 App Router + React 19 + `@myclash/ui` (frontend), Supabase Postgres + Realtime, `@myclash/rulesets`, `@myclash/i18n` (EN + FR).

**Spec:** [docs/superpowers/specs/2026-05-20-pools-overhaul-design.md](docs/superpowers/specs/2026-05-20-pools-overhaul-design.md)

---

## File map

**Backend (modify):**

- `apps/api/src/modules/phases/dto/phases.dto.ts` — extend `GeneratePoolsDto` with 5 referee constraint fields.
- `apps/api/src/modules/matches/dto/matches.dto.ts` — add `UpdateMatchDto` (general PATCH).
- `apps/api/src/modules/matches/matches.controller.ts` + `matches.service.ts` — wire `PATCH /matches/:id` for `liceId` + `refereeId`.
- `packages/db/src/schema/matches.ts` — add `refereeId` column.
- `packages/rulesets/src/types.ts` — extend `Ruleset` interface with `standingsColumns` + `rankingChain`.
- `packages/rulesets/src/tf_v1/index.ts` + sibling rulesets — export `standingsColumns` + `rankingChain` declarations.
- `apps/api/src/app.module.ts` — register `PoolStandingsModule`.

**Backend (create):**

- DB migration for `matches.referee_id`.
- `apps/api/src/modules/pool-standings/pool-standings.module.ts`
- `apps/api/src/modules/pool-standings/pool-standings.controller.ts`
- `apps/api/src/modules/pool-standings/pool-standings.service.ts`
- `apps/api/src/modules/pool-standings/pool-standings.service.test.ts`

**Frontend (modify):**

- `apps/web-admin/app/org/[slug]/events/[eventId]/pools/page.tsx` — refactor into tab shell + Configure tab.
- `packages/i18n/src/index.ts` — new `organizer.pools.*` key tree (EN + FR).
- `packages/ui/src/index.ts` — export new `HelpTooltip`.

**Frontend (create):**

- `packages/ui/src/components/HelpTooltip.tsx` — CSS-only hover/focus tooltip.
- `packages/ui/src/components/HelpTooltip.test.tsx` — render test.
- `apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/MatchesTab.tsx`
- `apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/StandingsTab.tsx`
- `apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/color-token.test.ts` — tests the shipped util.
  - **Shipped:** the `accentClassFor()` util was not created under `_tabs/`; it lives in `@myclash/ui` at `packages/ui/src/utils/color-token.ts` (re-exported from `packages/ui/src/index.ts`), and `color-token.test.ts` imports `accentClassFor`/`ColorToken` from `@myclash/ui`. Tournament side-color parsing lives in `_tabs/parse-side-colors.ts`.

---

# Phase 1 — Backend foundation

## Task 1: Extend `GeneratePoolsDto` with 5 referee constraints

The 5 referee constraint columns already exist in `pool_assignment_settings` and `pool_generator.ts` already consumes them. This task surfaces them in the DTO so the frontend can write them through `POST /tournaments/:id/generate-pools`.

> **Shipped note (2026-07-01):** `GeneratePoolsDto` is Zod-based (`nestjs-zod` / `createZodDto`), not class-validator. The 5 fields shipped as Zod schema entries (e.g. `enforceRefereeNoBackToBack: z.boolean().optional()`, `refereeRestMinSlots: z.number().int().min(0).max(10).optional()`) inside a `.strict()` object — see `apps/api/src/modules/phases/dto/phases.dto.ts`. The class-validator decorator snippet below is the original plan draft; the delivered code uses the Zod equivalents.

**Files:**

- Modify: `apps/api/src/modules/phases/dto/phases.dto.ts:4-49`

- [ ] **Step 1: Read the current DTO**

```bash
sed -n '1,55p' apps/api/src/modules/phases/dto/phases.dto.ts
```

- [ ] **Step 2: Add the 5 fields to `GeneratePoolsDto`**

Inside the existing `GeneratePoolsDto` class (between the existing fields and the closing brace), add:

```ts
  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  enforceRefereeNoBackToBack?: boolean;

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  refereeRestMinSlots?: number;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  enforceDedicatedRefereeRest?: boolean;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  enforceFighterRefereeNoOverlap?: boolean;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  preferHighRatedReferees?: boolean;
```

If `IsBoolean` isn't already imported from `class-validator` at the top of the file, add it to the existing import line.

- [ ] **Step 3: Wire the DTO fields into `phases.service.ts:generatePools()`**

Find `apps/api/src/modules/phases/phases.service.ts` `generatePools()` method. Locate where it reads the existing `pool_assignment_settings` row before calling the generator. Merge the DTO fields into the settings before passing to the algorithm. The wiring pattern:

```ts
// Inside generatePools(), after reading current settings:
const effectiveSettings = {
  ...currentSettings,
  ...(dto.enforceRefereeNoBackToBack !== undefined && {
    enforceRefereeNoBackToBack: dto.enforceRefereeNoBackToBack,
  }),
  ...(dto.refereeRestMinSlots !== undefined && { refereeRestMinSlots: dto.refereeRestMinSlots }),
  ...(dto.enforceDedicatedRefereeRest !== undefined && {
    enforceDedicatedRefereeRest: dto.enforceDedicatedRefereeRest,
  }),
  ...(dto.enforceFighterRefereeNoOverlap !== undefined && {
    enforceFighterRefereeNoOverlap: dto.enforceFighterRefereeNoOverlap,
  }),
  ...(dto.preferHighRatedReferees !== undefined && {
    preferHighRatedReferees: dto.preferHighRatedReferees,
  }),
};

// Then pass effectiveSettings to the generator and persist to pool_assignment_settings.
```

If `phases.service.ts` already reads/writes `pool_assignment_settings` differently (e.g. a settings service), match that pattern. The key requirement: the 5 new DTO fields must reach the generator AND persist to the settings table so they survive across regenerations.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter api typecheck
```

Expected: clean.

- [ ] **Step 5: Run existing API tests**

```bash
pnpm --filter api test phases
```

Expected: all existing tests pass (no behavior regression).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/phases
git commit -m "feat(api): expose 5 referee constraints on GeneratePoolsDto"
```

---

## Task 2: Add `referee_id` column to `matches` table

The Matches tab's referee dropdown needs a place to write to. The column doesn't exist today.

**Files:**

- Modify: `packages/db/src/schema/matches.ts:10-47`
- Create: a Drizzle migration file under `packages/db/drizzle/` (path matches the existing migration naming convention).

- [ ] **Step 1: Add the column to the Drizzle schema**

Open `packages/db/src/schema/matches.ts`. In the `matches` table definition (around lines 10-47), add a new column alongside the existing `liceId`:

```ts
refereeId: uuid('referee_id'),  // FK to persons.id; nullable
```

Place it next to `liceId` for grouping. If `persons` is the right reference table (check by reading the existing schema for how `liceId` references `lices`), add `.references(() => persons.id, { onDelete: 'set null' })` to mirror the FK pattern. If unsure, leave it as a plain `uuid('referee_id')` and the implementer can decide based on the existing column conventions in the file.

- [ ] **Step 2: Generate the Drizzle migration**

```bash
pnpm --filter @myclash/db drizzle-kit generate
```

This creates a new migration file under `packages/db/drizzle/`. Inspect the generated file — it should be a single `ALTER TABLE matches ADD COLUMN referee_id uuid NULL` (plus FK if you added the reference).

- [ ] **Step 3: Verify the schema typechecks**

```bash
pnpm --filter @myclash/db typecheck
```

Expected: clean.

- [ ] **Step 4: Apply the migration to the dev database**

```bash
pnpm --filter @myclash/db drizzle-kit migrate
```

Expected: migration applied. If the dev DB isn't accessible, document that the migration will run on next `pnpm db:migrate` and skip this step locally — CI will apply it.

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat(db): add matches.referee_id column"
```

---

## Task 3: Add `UpdateMatchDto` + wire `PATCH /matches/:id`

The Matches tab needs `PATCH /matches/:id` accepting `liceId` and `refereeId`. Only `UpdateMatchStatusDto` exists today (for status-only updates).

**Files:**

- Modify: `apps/api/src/modules/matches/dto/matches.dto.ts`
- Modify: `apps/api/src/modules/matches/matches.controller.ts`
- Modify: `apps/api/src/modules/matches/matches.service.ts`

- [ ] **Step 1: Add `UpdateMatchDto`**

In `apps/api/src/modules/matches/dto/matches.dto.ts`, append a new class after the existing DTOs:

```ts
export class UpdateMatchDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  liceId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  refereeId?: string | null;
}
```

Verify `IsUUID` + `IsOptional` are already imported from `class-validator` at the top of the file; if not, add them to the existing import line.

- [ ] **Step 2: Wire `PATCH /matches/:id` in the controller**

Open `apps/api/src/modules/matches/matches.controller.ts`. Find an existing endpoint method (e.g. the status update). Add:

```ts
@Patch(':id')
@ApiBearerAuth()
@ApiOperation({ summary: 'Update lice and/or referee assignment for a match' })
@ApiParam({ name: 'id', type: 'string', format: 'uuid' })
async update(
  @Param('id', ParseUUIDPipe) id: string,
  @Body() dto: UpdateMatchDto,
) {
  return this.matches.update(id, dto);
}
```

Add `UpdateMatchDto` to the import statement at the top alongside other DTOs.

- [ ] **Step 3: Implement `matches.service.ts:update()`**

In `apps/api/src/modules/matches/matches.service.ts`, add:

```ts
async update(matchId: string, dto: UpdateMatchDto) {
  const updates: Record<string, unknown> = {};
  if (dto.liceId !== undefined) updates['lice_id'] = dto.liceId;
  if (dto.refereeId !== undefined) updates['referee_id'] = dto.refereeId;
  if (Object.keys(updates).length === 0) {
    throw new BadRequestException('No fields to update');
  }
  updates['updated_at'] = new Date().toISOString();

  const { data, error } = await this.supabase.service
    .from('matches')
    .update(updates)
    .eq('id', matchId)
    .select('*')
    .single();
  if (error) throw new BadRequestException(error.message);
  if (!data) throw new NotFoundException(`Match ${matchId} not found`);
  return data;
}
```

Add `BadRequestException`, `NotFoundException` from `@nestjs/common` to the existing import if not already there. Also import `UpdateMatchDto` from `./dto/matches.dto`.

- [ ] **Step 4: Typecheck + run matches tests**

```bash
pnpm --filter api typecheck
pnpm --filter api test matches
```

Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/matches
git commit -m "feat(api): PATCH /matches/:id accepts liceId + refereeId"
```

---

## Task 4: Extend `Ruleset` interface with `standingsColumns` + `rankingChain`

The Standings tab is ruleset-driven. Each ruleset module must declare which columns its standings table shows and what tiebreaker chain to apply.

**Files:**

- Modify: `packages/rulesets/src/types.ts` (around lines 107-153 where `Ruleset` interface lives)

- [ ] **Step 1: Add the two new types**

Before the existing `Ruleset` interface in `packages/rulesets/src/types.ts`, add:

```ts
export interface StandingsColumn {
  /** Stable key used in row.stats[key] and in the rankingChain. */
  key: string;
  /** Header label, e.g. 'Wins'. Plain string; consumer applies i18n on top if needed. */
  label: string;
  /** Render hint. */
  type: 'number' | 'string';
  /** True when higher = better (e.g. wins, points). False/undefined for fields where lower is better (doubles, hits received). */
  sortDesc?: boolean;
}

export interface RankingRule {
  /** Matches a StandingsColumn.key. */
  key: string;
  /** 'desc' = higher is better. */
  direction: 'asc' | 'desc';
}
```

- [ ] **Step 2: Add to the `Ruleset` interface**

Inside the existing `Ruleset` interface (around line 107), add these properties alongside the existing ones (do NOT remove or rename existing properties — `computePoolStandings`, `computeMatchScore`, `displayName`, `code`, `version` etc. all stay):

```ts
  /** Declarative column schema for the pool-standings table. Dynamic columns shown
   *  alongside fixed Rank/Fighter/Status chrome columns. */
  standingsColumns: StandingsColumn[];

  /** Tiebreaker chain applied to standings. Order matters — first rule is primary,
   *  later rules break ties. */
  rankingChain: RankingRule[];
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @myclash/rulesets typecheck
```

Expected: FAIL — each existing ruleset module (TF_v1, TF_v1_no_afterblow, Generic_PointsCap, FormulaRuleset) won't compile because they don't implement the new required properties. That's expected; Task 5 adds the implementations.

If you want to land Task 4 cleanly before Task 5, temporarily mark the two new properties as optional (`?:`) and remove the optionality in Task 5. Otherwise, land Tasks 4 + 5 in a single commit.

For this plan we'll land Tasks 4 + 5 together (deferred commit), so leave the properties non-optional.

---

## Task 5: Per-ruleset `standingsColumns` + `rankingChain` declarations

Each ruleset module exports its own declarations. TF_v1 already has tiebreaker math at `packages/rulesets/src/tf_v1/standings.ts` (the existing `pickOpponent`/`computeAggregates` pattern); this task extracts the column declarations + tiebreaker order into the typed exports.

**Files:**

- Modify: `packages/rulesets/src/tf_v1/index.ts`
- Modify: `packages/rulesets/src/tf_v1_no_afterblow/index.ts`
- Modify: `packages/rulesets/src/generic_points_cap/index.ts`
- Modify: `packages/rulesets/src/formula/index.ts` (or wherever FormulaRuleset is exported)

- [ ] **Step 1: TF_v1 declarations**

Open `packages/rulesets/src/tf_v1/index.ts`. Find the exported `TF_v1` object (a `Ruleset`). Add these properties:

```ts
import type { StandingsColumn, RankingRule } from '../types';

const TF_V1_STANDINGS_COLUMNS: StandingsColumn[] = [
  { key: 'W', label: 'Wins', type: 'number', sortDesc: true },
  { key: 'L', label: 'Losses', type: 'number', sortDesc: false },
  { key: 'D', label: 'Draws', type: 'number', sortDesc: true },
  { key: 'F', label: 'Forfeits', type: 'number', sortDesc: false },
  { key: 'ptsScored', label: 'Points scored', type: 'number', sortDesc: true },
  { key: 'ptsConceded', label: 'Points conceded', type: 'number', sortDesc: false },
  { key: 'diff', label: 'Differential', type: 'number', sortDesc: true },
  { key: 'doubles', label: 'Doubles', type: 'number', sortDesc: false },
  { key: 'hitsGiven', label: 'Hits given', type: 'number', sortDesc: true },
  { key: 'hitsReceived', label: 'Hits received', type: 'number', sortDesc: false },
];

const TF_V1_RANKING_CHAIN: RankingRule[] = [
  // Mirror the existing tiebreaker order from packages/rulesets/src/tf_v1/standings.ts lines 14-19.
  { key: 'ptsScored', direction: 'desc' },
  { key: 'W', direction: 'desc' },
  { key: 'doubles', direction: 'asc' },
  { key: 'hitsReceived', direction: 'asc' },
];
```

Add `standingsColumns: TF_V1_STANDINGS_COLUMNS` and `rankingChain: TF_V1_RANKING_CHAIN` to the `TF_v1` object literal (the existing `Ruleset` export).

- [ ] **Step 2: TF_v1_no_afterblow declarations**

`packages/rulesets/src/tf_v1_no_afterblow/index.ts`: same shape minus the `doubles` column and the `doubles` ranking rule.

```ts
const TF_V1_NO_AFTERBLOW_STANDINGS_COLUMNS: StandingsColumn[] = [
  { key: 'W', label: 'Wins', type: 'number', sortDesc: true },
  { key: 'L', label: 'Losses', type: 'number', sortDesc: false },
  { key: 'D', label: 'Draws', type: 'number', sortDesc: true },
  { key: 'F', label: 'Forfeits', type: 'number', sortDesc: false },
  { key: 'ptsScored', label: 'Points scored', type: 'number', sortDesc: true },
  { key: 'ptsConceded', label: 'Points conceded', type: 'number', sortDesc: false },
  { key: 'diff', label: 'Differential', type: 'number', sortDesc: true },
];

const TF_V1_NO_AFTERBLOW_RANKING_CHAIN: RankingRule[] = [
  { key: 'ptsScored', direction: 'desc' },
  { key: 'W', direction: 'desc' },
  { key: 'diff', direction: 'desc' },
];
```

Add the two to the existing `TF_v1_no_afterblow` object.

- [ ] **Step 3: Generic_PointsCap declarations**

`packages/rulesets/src/generic_points_cap/index.ts`:

```ts
const GENERIC_STANDINGS_COLUMNS: StandingsColumn[] = [
  { key: 'W', label: 'Wins', type: 'number', sortDesc: true },
  { key: 'L', label: 'Losses', type: 'number', sortDesc: false },
  { key: 'D', label: 'Draws', type: 'number', sortDesc: true },
  { key: 'ptsScored', label: 'Points scored', type: 'number', sortDesc: true },
  { key: 'ptsConceded', label: 'Points conceded', type: 'number', sortDesc: false },
  { key: 'diff', label: 'Differential', type: 'number', sortDesc: true },
];

const GENERIC_RANKING_CHAIN: RankingRule[] = [
  { key: 'W', direction: 'desc' },
  { key: 'diff', direction: 'desc' },
  { key: 'ptsScored', direction: 'desc' },
];
```

- [ ] **Step 4: FormulaRuleset — empty declarations**

If `FormulaRuleset` exists in the package, give it empty declarations + a comment:

```ts
// FormulaRuleset doesn't expose pre-defined standings; the standings tab will
// render a "Ruleset doesn't expose standings yet" empty state for tournaments
// using this ruleset. Future work can expand this.
const FORMULA_STANDINGS_COLUMNS: StandingsColumn[] = [];
const FORMULA_RANKING_CHAIN: RankingRule[] = [];
```

- [ ] **Step 5: Build the rulesets package**

```bash
pnpm --filter @myclash/rulesets build
```

Expected: clean.

- [ ] **Step 6: Typecheck the workspace**

```bash
pnpm -r typecheck
```

Expected: clean across all packages.

- [ ] **Step 7: Commit Tasks 4 + 5 together**

```bash
git add packages/rulesets
git commit -m "feat(rulesets): declare standingsColumns + rankingChain per ruleset"
```

---

## Task 6: `PoolStandingsService` + `PoolStandingsController` + `PoolStandingsModule`

The new endpoint `GET /api/v1/tournaments/:tournamentId/pool-standings?mode=by-pool|overall`.

**Files:**

- Create: `apps/api/src/modules/pool-standings/pool-standings.module.ts`
- Create: `apps/api/src/modules/pool-standings/pool-standings.controller.ts`
- Create: `apps/api/src/modules/pool-standings/pool-standings.service.ts`
- Create: `apps/api/src/modules/pool-standings/pool-standings.service.test.ts`
- Modify: `apps/api/src/app.module.ts` (register the module)

- [ ] **Step 1: Write the failing test**

`apps/api/src/modules/pool-standings/pool-standings.service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { PoolStandingsService } from './pool-standings.service';

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

function makeChain(result: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  for (const k of ['select', 'eq', 'in', 'order']) {
    (chain as Record<string, unknown>)[k] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

function makeAwaitableChain(result: { data: unknown; error: unknown } = { data: [], error: null }) {
  const promise = Promise.resolve(result);
  const chain = Object.assign(promise, {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
  });
  for (const k of ['select', 'eq', 'in', 'order']) {
    (chain as unknown as Record<string, unknown>)[k] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

describe('PoolStandingsService', () => {
  it('returns empty rows and the ruleset columns when no matches are completed', async () => {
    // Tournament row: ruleset TF_v1 v1
    const tournamentChain = makeChain({
      data: { id: 't-1', ruleset_code: 'TF_v1', ruleset_version: '1' },
      error: null,
    });
    // No pool phase
    const phaseChain = makeChain({ data: { id: 'phase-1' }, error: null });
    // No pools
    const poolsChain = makeAwaitableChain({ data: [], error: null });
    // No matches
    const matchesChain = makeAwaitableChain({ data: [], error: null });

    fromMock
      .mockReturnValueOnce(tournamentChain)
      .mockReturnValueOnce(phaseChain)
      .mockReturnValueOnce(poolsChain)
      .mockReturnValueOnce(matchesChain);

    const service = new PoolStandingsService(mockSupabase as never);
    const result = await service.getPoolStandings('t-1', 'overall');

    expect(result.rulesetCode).toBe('TF_v1');
    expect(result.columns.length).toBeGreaterThan(0);
    expect(Array.isArray((result as { rows?: unknown[] }).rows)).toBe(true);
    expect((result as { rows: unknown[] }).rows.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter api test pool-standings
```

Expected: FAIL with "Cannot find module './pool-standings.service'".

- [ ] **Step 3: Implement the service**

`apps/api/src/modules/pool-standings/pool-standings.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { registry } from '@myclash/rulesets';
import type { StandingsColumn, RankingRule } from '@myclash/rulesets';
import { SupabaseService } from '../supabase/supabase.service';

export interface StandingsRow {
  rank: number;
  registrationId: string;
  displayName: string;
  club: { id: string; name: string; abbreviation: string | null } | null;
  status: 'in_progress' | 'completed';
  stats: Record<string, number | string>;
}

export type PoolStandingsResponse =
  | {
      rulesetCode: string;
      rulesetVersion: string;
      columns: StandingsColumn[];
      rows: StandingsRow[];
    }
  | {
      rulesetCode: string;
      rulesetVersion: string;
      columns: StandingsColumn[];
      pools: Array<{
        poolId: string;
        poolName: string;
        status: 'in_progress' | 'completed';
        rows: StandingsRow[];
      }>;
    };

@Injectable()
export class PoolStandingsService {
  constructor(private readonly supabase: SupabaseService) {}

  async getPoolStandings(
    tournamentId: string,
    mode: 'by-pool' | 'overall',
  ): Promise<PoolStandingsResponse> {
    // 1. Tournament + ruleset.
    const { data: tournament, error: tournamentError } = await this.supabase.service
      .from('tournaments')
      .select('id, ruleset_code, ruleset_version')
      .eq('id', tournamentId)
      .maybeSingle();
    if (tournamentError) throw new BadRequestException(tournamentError.message);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentId} not found`);

    const rulesetCode = (tournament as { ruleset_code: string }).ruleset_code;
    const rulesetVersion = (tournament as { ruleset_version: string }).ruleset_version;
    const ruleset = registry.get(rulesetCode, rulesetVersion);
    if (!ruleset) {
      throw new BadRequestException(`Ruleset ${rulesetCode} v${rulesetVersion} not registered`);
    }

    const columns = ruleset.standingsColumns;
    const rankingChain = ruleset.rankingChain;

    // 2. Pool phase for this tournament.
    const { data: phase } = await this.supabase.service
      .from('phases')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('type', 'pool')
      .maybeSingle();
    const phaseId = (phase as { id?: string } | null)?.id;
    if (!phaseId) {
      return mode === 'overall'
        ? { rulesetCode, rulesetVersion, columns, rows: [] }
        : { rulesetCode, rulesetVersion, columns, pools: [] };
    }

    // 3. Pools + members.
    const { data: pools } = await this.supabase.service
      .from('pools')
      .select(
        'id, name, pool_members(registration_id, registrations(id, persons(id, given_name, family_name, display_name, clubs(id, name, abbreviation))))',
      )
      .eq('phase_id', phaseId)
      .order('sort_order', { ascending: true });
    const poolRows = (pools ?? []) as Array<{
      id: string;
      name: string;
      pool_members: Array<{
        registration_id: string;
        registrations: {
          id: string;
          persons: {
            id: string;
            given_name: string;
            family_name: string;
            display_name: string | null;
            clubs: { id: string; name: string; abbreviation: string | null } | null;
          };
        };
      }>;
    }>;

    // 4. Matches in this phase (only completed matches contribute to stats).
    const { data: matches } = await this.supabase.service
      .from('matches')
      .select(
        'id, pool_id, status, red_registration_id, blue_registration_id, red_score, blue_score, scoring_payload',
      )
      .eq('phase_id', phaseId);
    const matchRows = (matches ?? []) as Array<{
      id: string;
      pool_id: string;
      status: string;
      red_registration_id: string;
      blue_registration_id: string;
      red_score: number | null;
      blue_score: number | null;
      scoring_payload: Record<string, unknown> | null;
    }>;

    // 5. Per-pool standings.
    const perPool = poolRows.map((pool) => {
      const poolMatches = matchRows.filter((m) => m.pool_id === pool.id);
      const completed = poolMatches.filter((m) => m.status === 'completed');
      const poolStatus: 'in_progress' | 'completed' =
        poolMatches.length > 0 && completed.length === poolMatches.length
          ? 'completed'
          : 'in_progress';
      const rows = this.computeRows(pool, completed, columns, rankingChain, poolStatus);
      return { poolId: pool.id, poolName: pool.name, status: poolStatus, rows };
    });

    if (mode === 'by-pool') {
      return { rulesetCode, rulesetVersion, columns, pools: perPool };
    }

    // 6. Overall: flatten + re-rank globally.
    const allRows = perPool.flatMap((p) => p.rows);
    const ranked = this.applyRanking(allRows, rankingChain);
    return { rulesetCode, rulesetVersion, columns, rows: ranked };
  }

  private computeRows(
    pool: {
      id: string;
      name: string;
      pool_members: Array<{
        registration_id: string;
        registrations: {
          id: string;
          persons: {
            id: string;
            given_name: string;
            family_name: string;
            display_name: string | null;
            clubs: { id: string; name: string; abbreviation: string | null } | null;
          };
        };
      }>;
    },
    completedMatches: Array<{
      red_registration_id: string;
      blue_registration_id: string;
      red_score: number | null;
      blue_score: number | null;
      scoring_payload: Record<string, unknown> | null;
    }>,
    columns: StandingsColumn[],
    rankingChain: RankingRule[],
    poolStatus: 'in_progress' | 'completed',
  ): StandingsRow[] {
    // Initialize a stats object per member with all column keys at 0.
    const statsByReg = new Map<string, Record<string, number>>();
    for (const member of pool.pool_members) {
      const empty: Record<string, number> = {};
      for (const col of columns) {
        empty[col.key] = 0;
      }
      statsByReg.set(member.registration_id, empty);
    }

    for (const m of completedMatches) {
      const red = statsByReg.get(m.red_registration_id);
      const blue = statsByReg.get(m.blue_registration_id);
      if (!red || !blue) continue;
      const rs = m.red_score ?? 0;
      const bs = m.blue_score ?? 0;

      // Common columns
      red['ptsScored'] = (red['ptsScored'] ?? 0) + rs;
      red['ptsConceded'] = (red['ptsConceded'] ?? 0) + bs;
      blue['ptsScored'] = (blue['ptsScored'] ?? 0) + bs;
      blue['ptsConceded'] = (blue['ptsConceded'] ?? 0) + rs;

      if (rs > bs) {
        red['W'] = (red['W'] ?? 0) + 1;
        blue['L'] = (blue['L'] ?? 0) + 1;
      } else if (bs > rs) {
        blue['W'] = (blue['W'] ?? 0) + 1;
        red['L'] = (red['L'] ?? 0) + 1;
      } else {
        red['D'] = (red['D'] ?? 0) + 1;
        blue['D'] = (blue['D'] ?? 0) + 1;
      }

      // Doubles, hits, forfeits from scoring_payload if the ruleset declares them.
      const payload = m.scoring_payload ?? {};
      const doubles = Number((payload as { doubles?: number }).doubles ?? 0);
      const redHitsGiven = Number((payload as { redHitsGiven?: number }).redHitsGiven ?? 0);
      const blueHitsGiven = Number((payload as { blueHitsGiven?: number }).blueHitsGiven ?? 0);
      const redForfeit = Boolean((payload as { redForfeit?: boolean }).redForfeit);
      const blueForfeit = Boolean((payload as { blueForfeit?: boolean }).blueForfeit);

      if ('doubles' in red) red['doubles'] = (red['doubles'] ?? 0) + doubles;
      if ('doubles' in blue) blue['doubles'] = (blue['doubles'] ?? 0) + doubles;
      if ('hitsGiven' in red) red['hitsGiven'] = (red['hitsGiven'] ?? 0) + redHitsGiven;
      if ('hitsGiven' in blue) blue['hitsGiven'] = (blue['hitsGiven'] ?? 0) + blueHitsGiven;
      if ('hitsReceived' in red) red['hitsReceived'] = (red['hitsReceived'] ?? 0) + blueHitsGiven;
      if ('hitsReceived' in blue) blue['hitsReceived'] = (blue['hitsReceived'] ?? 0) + redHitsGiven;
      if (redForfeit && 'F' in red) red['F'] = (red['F'] ?? 0) + 1;
      if (blueForfeit && 'F' in blue) blue['F'] = (blue['F'] ?? 0) + 1;
    }

    // Compute derived `diff` if the ruleset declares it.
    for (const stats of statsByReg.values()) {
      if ('diff' in stats) {
        stats['diff'] = (stats['ptsScored'] ?? 0) - (stats['ptsConceded'] ?? 0);
      }
    }

    // Materialize rows.
    const rows: StandingsRow[] = pool.pool_members.map((member) => {
      const person = member.registrations.persons;
      const displayName = person.display_name ?? `${person.given_name} ${person.family_name}`;
      return {
        rank: 0, // assigned in applyRanking
        registrationId: member.registration_id,
        displayName,
        club: person.clubs,
        status: poolStatus,
        stats: statsByReg.get(member.registration_id) ?? {},
      };
    });

    return this.applyRanking(rows, rankingChain);
  }

  private applyRanking(rows: StandingsRow[], rankingChain: RankingRule[]): StandingsRow[] {
    const sorted = [...rows].sort((a, b) => {
      for (const rule of rankingChain) {
        const av = Number(a.stats[rule.key] ?? 0);
        const bv = Number(b.stats[rule.key] ?? 0);
        if (av !== bv) {
          return rule.direction === 'desc' ? bv - av : av - bv;
        }
      }
      return 0;
    });
    return sorted.map((row, i) => ({ ...row, rank: i + 1 }));
  }
}
```

- [ ] **Step 4: Implement the controller**

`apps/api/src/modules/pool-standings/pool-standings.controller.ts`:

```ts
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PoolStandingsService } from './pool-standings.service';

@ApiTags('pool-standings')
@ApiBearerAuth()
@Controller()
export class PoolStandingsController {
  constructor(private readonly service: PoolStandingsService) {}

  /** GET /api/v1/tournaments/:tournamentId/pool-standings?mode=by-pool|overall */
  @Get('tournaments/:tournamentId/pool-standings')
  @ApiOperation({ summary: 'Compute pool standings for a tournament' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'mode', enum: ['by-pool', 'overall'], required: false })
  async get(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Query('mode') modeRaw?: string,
  ) {
    const mode = modeRaw === 'by-pool' ? 'by-pool' : 'overall';
    return this.service.getPoolStandings(tournamentId, mode);
  }
}
```

- [ ] **Step 5: Module + register in AppModule**

`apps/api/src/modules/pool-standings/pool-standings.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { PoolStandingsController } from './pool-standings.controller';
import { PoolStandingsService } from './pool-standings.service';

@Module({
  imports: [SupabaseModule],
  controllers: [PoolStandingsController],
  providers: [PoolStandingsService],
})
export class PoolStandingsModule {}
```

Then open `apps/api/src/app.module.ts` and add:

```ts
import { PoolStandingsModule } from './modules/pool-standings/pool-standings.module';
```

Add `PoolStandingsModule` to the `imports` array of the `@Module({...})` decorator.

- [ ] **Step 6: Run the test**

```bash
pnpm --filter api test pool-standings
```

Expected: PASS.

- [ ] **Step 7: Full API test suite**

```bash
pnpm --filter api test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/pool-standings apps/api/src/app.module.ts
git commit -m "feat(api): PoolStandingsService + GET /tournaments/:id/pool-standings"
```

---

# Phase 2 — Shared frontend primitives

## Task 7: `HelpTooltip` component in `@myclash/ui`

CSS-only hover/focus tooltip used by the Configure tab's referee-constraint labels.

**Files:**

- Create: `packages/ui/src/components/HelpTooltip.tsx`
- Modify: `packages/ui/src/index.ts` (add export)

- [ ] **Step 1: Implement the component**

`packages/ui/src/components/HelpTooltip.tsx`:

```tsx
'use client';

import * as React from 'react';

export interface HelpTooltipProps {
  /** Help text shown in the tooltip popover. */
  text: string;
  /** Optional accessible label override for the trigger button. */
  ariaLabel?: string;
}

/**
 * Small inline help-text affordance — a circled ⓘ icon that reveals a
 * 280px tooltip on hover or focus. CSS-only show/hide via the parent
 * `group` class. Keyboard-accessible: trigger is a real `<button>` exposed
 * with an aria-label, and the tooltip is referenced by aria-describedby
 * for screen-reader users.
 */
export const HelpTooltip: React.FC<HelpTooltipProps> = ({ text, ariaLabel }) => {
  const id = React.useId();
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={ariaLabel ?? `Help: ${text}`}
        aria-describedby={id}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-red-800/30"
      >
        ⓘ
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-[280px] -translate-x-1/2 rounded-md bg-slate-950 px-3 py-2 text-left text-xs font-medium leading-5 text-white shadow-lg group-hover:block group-focus-within:block"
      >
        {text}
      </span>
    </span>
  );
};
```

- [ ] **Step 2: Export from `@myclash/ui`**

Open `packages/ui/src/index.ts`. Add (alphabetically or wherever sibling components are exported):

```ts
export { HelpTooltip } from './components/HelpTooltip';
export type { HelpTooltipProps } from './components/HelpTooltip';
```

- [ ] **Step 3: Build the package**

```bash
pnpm --filter @myclash/ui build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/HelpTooltip.tsx packages/ui/src/index.ts
git commit -m "feat(ui): HelpTooltip component for inline form help text"
```

---

## Task 8: `accentClassFor(token)` color util + tests

Maps the tournament's `scoring_config.display.sideColors.{red,blue}` color tokens to Tailwind class names for the Matches tab column accents.

> **Shipped note (2026-07-01):** the `accentClassFor()` util was ultimately placed in `@myclash/ui` (`packages/ui/src/utils/color-token.ts`, exported from `packages/ui/src/index.ts`) rather than under `_tabs/color-token.ts`. The delivered `_tabs/color-token.test.ts` imports `accentClassFor`/`ColorToken` from `@myclash/ui`, and `_tabs/parse-side-colors.ts` holds the side-color parsing. The `./color-token` import shown in the steps below (and in Task 12's MatchesTab) is superseded by `@myclash/ui`.

**Files:**

- Create: `apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/color-token.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/color-token.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { accentClassFor, type ColorToken } from './color-token';

describe('accentClassFor', () => {
  const cases: Array<[ColorToken, string]> = [
    ['red', 'bg-red-700'],
    ['blue', 'bg-blue-700'],
    ['green', 'bg-green-700'],
    ['yellow', 'bg-yellow-400'],
    ['purple', 'bg-purple-700'],
    ['orange', 'bg-orange-600'],
    ['black', 'bg-slate-900'],
    ['white', 'bg-slate-100'],
  ];

  it.each(cases)('maps token %s to %s', (token, expected) => {
    expect(accentClassFor(token)).toBe(expected);
  });

  it('falls back to red-700 for an unknown token', () => {
    expect(accentClassFor('unknown' as ColorToken)).toBe('bg-red-700');
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

```bash
pnpm --filter web-admin test color-token
```

Expected: FAIL with "Cannot find module './color-token'".

- [ ] **Step 3: Implement the util**

`apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/color-token.ts`:

```ts
export type ColorToken =
  | 'red'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'purple'
  | 'orange'
  | 'black'
  | 'white';

const MAP: Record<ColorToken, string> = {
  red: 'bg-red-700',
  blue: 'bg-blue-700',
  green: 'bg-green-700',
  yellow: 'bg-yellow-400',
  purple: 'bg-purple-700',
  orange: 'bg-orange-600',
  black: 'bg-slate-900',
  white: 'bg-slate-100',
};

/**
 * Resolve a tournament's configured side-color token into a Tailwind
 * background-color class for the Matches tab column accent. Unknown
 * tokens fall back to `bg-red-700`.
 */
export function accentClassFor(token: ColorToken | string | null | undefined): string {
  if (!token || !(token in MAP)) return MAP.red;
  return MAP[token as ColorToken];
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter web-admin test color-token
```

Expected: PASS (9/9).

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter web-admin typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add "apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs"
git commit -m "feat(web-admin): accentClassFor color-token util + tests"
```

---

# Phase 3 — Pools page tab shell + Configure refactor

## Task 9: Pools page tab shell

Replace the current single-page layout with a tab shell. Move the existing Configure content into the first tab (with full-width layout + sticky right sidebar). Matches + Standings are stub tabs that the next phase fills in.

> **Shipped note (2026-07-01):** the delivered shell is a 4-tab layout — a `referees` tab (`#referees`, rendering `_tabs/RefereesTab.tsx`) was added on top of the three below. The shipped `TabKey` union is `'configure' | 'matches' | 'standings' | 'referees'`.

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/pools/page.tsx`
- Create: `apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/MatchesTab.tsx` (stub)
- Create: `apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/StandingsTab.tsx` (stub)

- [ ] **Step 1: Read the current page**

```bash
sed -n '1,120p' "apps/web-admin/app/org/[slug]/events/[eventId]/pools/page.tsx"
sed -n '460,530p' "apps/web-admin/app/org/[slug]/events/[eventId]/pools/page.tsx"
```

Identify the `<main className="p-8 max-w-5xl">` wrapper (line 468) and the closing `</main>` tag.

- [ ] **Step 2: Replace the wrapper with the tab shell**

In `apps/web-admin/app/org/[slug]/events/[eventId]/pools/page.tsx`, change the `<main>` opening from `className="p-8 max-w-5xl"` to `className="w-full px-6 py-8 lg:px-8"`.

Add this state hook near the top of the component (alongside the existing `useState` declarations):

```tsx
type TabKey = 'configure' | 'matches' | 'standings';

const TABS: Array<{ key: TabKey; labelKey: string }> = [
  { key: 'configure', labelKey: 'organizer.pools.tabs.configure' },
  { key: 'matches', labelKey: 'organizer.pools.tabs.matches' },
  { key: 'standings', labelKey: 'organizer.pools.tabs.standings' },
];

function readHashTab(): TabKey {
  if (typeof window === 'undefined') return 'configure';
  const hash = window.location.hash.replace('#', '');
  return TABS.find((tab) => tab.key === hash)?.key ?? 'configure';
}
```

Inside the component:

```tsx
const [activeTab, setActiveTab] = useState<TabKey>('configure');

useEffect(() => {
  setActiveTab(readHashTab());
  function onHash() {
    setActiveTab(readHashTab());
  }
  window.addEventListener('hashchange', onHash);
  return () => window.removeEventListener('hashchange', onHash);
}, []);

function selectTab(key: TabKey) {
  window.location.hash = `#${key}`;
}
```

Just inside the new `<main>`, add the tab nav:

```tsx
<nav aria-label="Pools sections" className="mb-6 flex gap-1 border-b border-slate-200">
  {TABS.map((tab) => {
    const disabled =
      (tab.key === 'matches' && !poolPhaseId) || (tab.key === 'standings' && !poolPhaseId);
    return (
      <button
        key={tab.key}
        type="button"
        onClick={() => !disabled && selectTab(tab.key)}
        disabled={disabled}
        title={disabled ? t('organizer.pools.tabs.disabledHint') : undefined}
        className={[
          'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
          activeTab === tab.key
            ? 'border-red-800 text-red-800'
            : disabled
              ? 'border-transparent text-slate-300 cursor-not-allowed'
              : 'border-transparent text-slate-600 hover:text-slate-900',
        ].join(' ')}
      >
        {t(tab.labelKey)}
      </button>
    );
  })}
</nav>
```

- [ ] **Step 3: Wrap the existing Configure content in a conditional**

Find the existing config form + pool grid block (approx. lines 502-902). Wrap the entire thing in:

```tsx
{
  activeTab === 'configure' && (
    <>
      {/* existing Configure content stays here unchanged for now;
       Task 10 refactors the layout to sticky sidebar */}
    </>
  );
}

{
  activeTab === 'matches' && poolPhaseId && (
    <MatchesTab tournamentId={selectedTournament} poolPhaseId={poolPhaseId} />
  );
}

{
  activeTab === 'standings' && poolPhaseId && (
    <StandingsTab tournamentId={selectedTournament} poolPhaseId={poolPhaseId} />
  );
}
```

Add the imports at the top of the file:

```tsx
import { MatchesTab } from './_tabs/MatchesTab';
import { StandingsTab } from './_tabs/StandingsTab';
```

- [ ] **Step 4: Create the stubs**

`apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/MatchesTab.tsx`:

```tsx
'use client';

export function MatchesTab({
  tournamentId,
  poolPhaseId,
}: {
  tournamentId: string;
  poolPhaseId: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
      Matches tab — under construction (tournament {tournamentId}, phase {poolPhaseId})
    </div>
  );
}
```

`apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/StandingsTab.tsx`:

```tsx
'use client';

export function StandingsTab({
  tournamentId,
  poolPhaseId,
}: {
  tournamentId: string;
  poolPhaseId: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
      Standings tab — under construction (tournament {tournamentId}, phase {poolPhaseId})
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter web-admin typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add "apps/web-admin/app/org/[slug]/events/[eventId]/pools"
git commit -m "feat(web-admin): /pools tab shell + stub Matches/Standings tabs"
```

---

## Task 10: Configure tab — full-width layout with sticky right sidebar

Now refactor the Configure content (still inside `page.tsx` for v1) so the form + lifecycle actions live in a sticky right sidebar and the pool grid fills the left as 3-4 columns.

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/pools/page.tsx`

- [ ] **Step 1: Restructure the Configure block**

Inside the `{activeTab === 'configure' && (` block, replace the existing single-column layout with a 2-column grid. Outline:

```tsx
{activeTab === 'configure' && (
  <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
    <div className="space-y-4">
      {/* Conflict banner — full width above the grid */}
      {conflicts && <ConflictBanner conflicts={conflicts} />}

      {/* Pool grid — responsive columns */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {(pools ?? []).map((pool) => (
          // existing pool-card JSX moved here unchanged
        ))}
      </div>
    </div>

    {/* Sticky right sidebar */}
    <aside className="sticky top-6 self-start space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      {/* Existing config form moved here:
         - mode toggle, poolCount/targetSize, schoolSep, skillBalance
       */}

      {/* Referee constraints section — added in Task 11 */}

      {/* Lifecycle actions */}
      <div className="space-y-2 border-t border-slate-200 pt-4">
        {/* Generate / Add empty / Delete all / Force regenerate buttons */}
      </div>
    </aside>
  </div>
)}
```

The existing form fields, pool cards, conflict banner, and lifecycle button handlers are moved unchanged — just rearranged into the new layout. Keep the existing `<ConflictBanner>` and pool-card JSX exactly as it is in the current file; only the surrounding wrappers change.

If `ConflictBanner` is inline JSX (not a separate component), keep it inline — don't extract for this task.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web-admin typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "apps/web-admin/app/org/[slug]/events/[eventId]/pools/page.tsx"
git commit -m "feat(web-admin): Pools Configure tab full-width + sticky sidebar"
```

---

## Task 11: Configure tab — 5 referee constraints with HelpTooltips

Add the 5 referee constraint controls to the sidebar + the existing 2 basic constraints, each with a `<HelpTooltip>` ⓘ next to the label.

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/pools/page.tsx`

- [ ] **Step 1: Add state hooks for the 5 referee constraints**

Near the existing `schoolSep` / `skillBalance` state, add:

```tsx
const [refNoBackToBack, setRefNoBackToBack] = useState(true);
const [refRestMinSlots, setRefRestMinSlots] = useState(1);
const [refDedicatedRest, setRefDedicatedRest] = useState(true);
const [refFighterNoOverlap, setRefFighterNoOverlap] = useState(true);
const [refPreferHighRated, setRefPreferHighRated] = useState(true);
```

When loading existing pool_assignment_settings (if there's an effect that does this), populate these from the response. Otherwise the defaults above match the schema defaults.

- [ ] **Step 2: Add the import for `HelpTooltip`**

At the top of `page.tsx`:

```tsx
import { HelpTooltip } from '@myclash/ui';
```

- [ ] **Step 3: Render the 7 constraint controls in the sidebar**

Inside the `<aside>` block, between the basic config (mode + counts) and the lifecycle actions, insert:

```tsx
<div className="space-y-3 border-t border-slate-200 pt-4">
  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
    {t('organizer.pools.configure.constraints')}
  </h3>

  <label className="flex items-center justify-between gap-2 text-sm">
    <span className="flex items-center">
      {t('organizer.pools.configure.schoolSeparation')}
      <HelpTooltip text={t('organizer.pools.configure.help.schoolSeparation')} />
    </span>
    <input type="checkbox" checked={schoolSep} onChange={(e) => setSchoolSep(e.target.checked)} />
  </label>

  <label className="flex items-center justify-between gap-2 text-sm">
    <span className="flex items-center">
      {t('organizer.pools.configure.skillBalance')}
      <HelpTooltip text={t('organizer.pools.configure.help.skillBalance')} />
    </span>
    <input
      type="checkbox"
      checked={skillBalance}
      onChange={(e) => setSkillBalance(e.target.checked)}
    />
  </label>

  <div className="border-t border-slate-100 pt-3" />

  <label className="flex items-center justify-between gap-2 text-sm">
    <span className="flex items-center">
      {t('organizer.pools.configure.refNoBackToBack')}
      <HelpTooltip text={t('organizer.pools.configure.help.refNoBackToBack')} />
    </span>
    <input
      type="checkbox"
      checked={refNoBackToBack}
      onChange={(e) => setRefNoBackToBack(e.target.checked)}
    />
  </label>

  <label className="flex items-center justify-between gap-2 text-sm">
    <span className="flex items-center">
      {t('organizer.pools.configure.refRestMinSlots')}
      <HelpTooltip text={t('organizer.pools.configure.help.refRestMinSlots')} />
    </span>
    <input
      type="number"
      min={0}
      max={10}
      value={refRestMinSlots}
      onChange={(e) =>
        setRefRestMinSlots(Math.max(0, Math.min(10, parseInt(e.target.value, 10) || 0)))
      }
      disabled={!refNoBackToBack}
      className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50"
    />
  </label>

  <label className="flex items-center justify-between gap-2 text-sm">
    <span className="flex items-center">
      {t('organizer.pools.configure.refDedicatedRest')}
      <HelpTooltip text={t('organizer.pools.configure.help.refDedicatedRest')} />
    </span>
    <input
      type="checkbox"
      checked={refDedicatedRest}
      onChange={(e) => setRefDedicatedRest(e.target.checked)}
    />
  </label>

  <label className="flex items-center justify-between gap-2 text-sm">
    <span className="flex items-center">
      {t('organizer.pools.configure.refFighterNoOverlap')}
      <HelpTooltip text={t('organizer.pools.configure.help.refFighterNoOverlap')} />
    </span>
    <input
      type="checkbox"
      checked={refFighterNoOverlap}
      onChange={(e) => setRefFighterNoOverlap(e.target.checked)}
    />
  </label>

  <label className="flex items-center justify-between gap-2 text-sm">
    <span className="flex items-center">
      {t('organizer.pools.configure.refPreferHighRated')}
      <HelpTooltip text={t('organizer.pools.configure.help.refPreferHighRated')} />
    </span>
    <input
      type="checkbox"
      checked={refPreferHighRated}
      onChange={(e) => setRefPreferHighRated(e.target.checked)}
    />
  </label>
</div>
```

- [ ] **Step 4: Send the 5 fields when invoking Generate**

Find the existing `handleGenerate` (or similarly named) function that POSTs `/tournaments/:id/generate-pools`. Extend the body to include the 5 new fields:

```ts
body: JSON.stringify({
  poolCount: mode === 'poolCount' ? poolCount : undefined,
  targetSize: mode === 'targetSize' ? targetSize : undefined,
  enforceSchoolSeparation: schoolSep,
  enforceSkillBalance: skillBalance,
  enforceRefereeNoBackToBack: refNoBackToBack,
  refereeRestMinSlots: refRestMinSlots,
  enforceDedicatedRefereeRest: refDedicatedRest,
  enforceFighterRefereeNoOverlap: refFighterNoOverlap,
  preferHighRatedReferees: refPreferHighRated,
}),
```

The existing fields stay as they are; the 5 new ones are appended.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter web-admin typecheck
```

Expected: clean. The i18n keys don't exist yet — that's fine because `t()` accepts any string and falls back to the key itself at runtime. Task 18 adds the actual translations.

- [ ] **Step 6: Commit**

```bash
git add "apps/web-admin/app/org/[slug]/events/[eventId]/pools/page.tsx"
git commit -m "feat(web-admin): expose 5 referee constraints in Pools Configure tab"
```

---

# Phase 4 — Matches tab

## Task 12: Matches tab — per-pool tables (read-only, no realtime yet)

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/MatchesTab.tsx`

- [ ] **Step 1: Replace the stub**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { t } from '@myclash/i18n';
import { accentClassFor, type ColorToken } from './color-token';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface MatchRow {
  id: string;
  pool_id: string;
  round_number: number;
  red_registration_id: string;
  blue_registration_id: string;
  red_name: string;
  red_club_abbrev: string | null;
  blue_name: string;
  blue_club_abbrev: string | null;
  red_score: number | null;
  blue_score: number | null;
  status: string;
  lice_id: string | null;
  referee_id: string | null;
}

interface PoolWithMatches {
  poolId: string;
  poolName: string;
  matches: MatchRow[];
}

interface MatchesTabProps {
  tournamentId: string;
  poolPhaseId: string;
  slug: string;
  eventId: string;
}

export function MatchesTab({ tournamentId, poolPhaseId, slug, eventId }: MatchesTabProps) {
  const [pools, setPools] = useState<PoolWithMatches[]>([]);
  const [redColor, setRedColor] = useState<ColorToken>('red');
  const [blueColor, setBlueColor] = useState<ColorToken>('blue');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Promise.all([
      fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}/pools-with-matches`, {
        credentials: 'include',
      }).then((r) => (r.ok ? r.json() : [])),
      fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, { credentials: 'include' }).then((r) =>
        r.ok ? r.json() : null,
      ),
    ]).then(([poolsData, tournamentData]) => {
      setPools(poolsData as PoolWithMatches[]);
      const sc = (
        tournamentData as {
          scoring_config?: { display?: { sideColors?: { red: string; blue: string } } };
        } | null
      )?.scoring_config;
      if (sc?.display?.sideColors) {
        setRedColor((sc.display.sideColors.red as ColorToken) ?? 'red');
        setBlueColor((sc.display.sideColors.blue as ColorToken) ?? 'blue');
      }
      setLoading(false);
    });
  }, [tournamentId]);

  if (loading) {
    return <p className="text-sm text-slate-500">{t('common.loading')}</p>;
  }

  return (
    <div className="space-y-8">
      {pools.map((pool) => {
        const done = pool.matches.filter((m) => m.status === 'completed').length;
        const total = pool.matches.length;
        return (
          <section key={pool.poolId} className="rounded-lg border border-slate-200 bg-white">
            <header className="border-b border-slate-200 px-4 py-3">
              <h3 className="font-semibold text-slate-900">{pool.poolName}</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {t('organizer.pools.matches.summary', { done: String(done), total: String(total) })}
              </p>
            </header>

            {pool.matches.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">
                {t('organizer.pools.matches.empty')}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2 w-16">{t('organizer.pools.matches.round')}</th>
                    <th className="px-4 py-2">{t('organizer.pools.matches.red')}</th>
                    <th className="px-4 py-2">{t('organizer.pools.matches.blue')}</th>
                    <th className="px-4 py-2 w-24">{t('organizer.pools.matches.score')}</th>
                    <th className="px-4 py-2 w-32">{t('organizer.pools.matches.status')}</th>
                    <th className="px-4 py-2 w-32">{t('organizer.pools.matches.lice')}</th>
                    <th className="px-4 py-2 w-32">{t('organizer.pools.matches.referee')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pool.matches.map((m) => (
                    <tr
                      key={m.id}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                    >
                      <td className="px-4 py-2 text-slate-500">{m.round_number}</td>
                      <td className="px-4 py-2">
                        <Link
                          href={`/org/${slug}/events/${eventId}/matches/${m.id}`}
                          className="flex items-center gap-2 hover:underline"
                        >
                          <span
                            className={`h-6 w-1 rounded ${accentClassFor(redColor)}`}
                            aria-hidden="true"
                          />
                          <span className="font-medium text-slate-900">{m.red_name}</span>
                          {m.red_club_abbrev && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                              {m.red_club_abbrev}
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="px-4 py-2">
                        <Link
                          href={`/org/${slug}/events/${eventId}/matches/${m.id}`}
                          className="flex items-center gap-2 hover:underline"
                        >
                          <span
                            className={`h-6 w-1 rounded ${accentClassFor(blueColor)}`}
                            aria-hidden="true"
                          />
                          <span className="font-medium text-slate-900">{m.blue_name}</span>
                          {m.blue_club_abbrev && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                              {m.blue_club_abbrev}
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="px-4 py-2 font-mono text-slate-700">
                        {m.status === 'completed'
                          ? `${m.red_score ?? 0} — ${m.blue_score ?? 0}`
                          : '—'}
                      </td>
                      <td className="px-4 py-2">
                        <StatusPill status={m.status} />
                      </td>
                      <td className="px-4 py-2 text-slate-400 italic">—</td>
                      <td className="px-4 py-2 text-slate-400 italic">—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    scheduled: 'bg-slate-100 text-slate-700',
    ready: 'bg-amber-100 text-amber-700',
    running: 'bg-red-100 text-red-700',
    completed: 'bg-green-100 text-green-700',
    forfeit: 'bg-slate-200 text-slate-600',
    disqualified: 'bg-slate-200 text-slate-600',
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? colors.scheduled}`}
    >
      {status}
    </span>
  );
}
```

- [ ] **Step 2: Update the props passed from `page.tsx`**

In `page.tsx`, find the `<MatchesTab ...>` render and add `slug` + `eventId` to the props:

```tsx
{
  activeTab === 'matches' && poolPhaseId && (
    <MatchesTab
      tournamentId={selectedTournament}
      poolPhaseId={poolPhaseId}
      slug={slug}
      eventId={eventId}
    />
  );
}
```

`slug` + `eventId` come from `useParams<{ slug: string; eventId: string }>()` — if the existing code doesn't extract them yet, add the destructure.

- [ ] **Step 3: Confirm the backend endpoint exists**

The component fetches `GET /api/v1/tournaments/:id/pools-with-matches`. If this endpoint doesn't exist yet, that's a blocker — find an equivalent existing endpoint (e.g. `GET /tournaments/:id/pools` may already include matches, or `GET /events/:id/matches?phase_id=...` may serve). Adjust the fetch URL + shape accordingly.

If no equivalent exists, add a new lightweight endpoint to the existing `phases.controller.ts` or `pools.controller.ts` that returns the per-pool matches shape. This is in-scope for the same task because the Matches tab needs the data.

The response shape the component expects: `Array<{ poolId, poolName, matches: MatchRow[] }>`. The `matches` array entries match the `MatchRow` interface in the component.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter web-admin typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add "apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/MatchesTab.tsx" "apps/web-admin/app/org/[slug]/events/[eventId]/pools/page.tsx"
git commit -m "feat(web-admin): Matches tab — per-pool tables with tournament-driven colors"
```

---

## Task 13: Matches tab — inline lice + referee editing

Add inline dropdowns for `lice_id` and `referee_id` per row. PATCHes via the new `UpdateMatchDto` endpoint from Task 3.

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/MatchesTab.tsx`

- [ ] **Step 1: Add lices + referees state**

Inside the component:

```tsx
interface Lice {
  id: string;
  name: string;
}
interface Referee {
  id: string;
  display_name: string;
}

const [lices, setLices] = useState<Lice[]>([]);
const [referees, setReferees] = useState<Referee[]>([]);

useEffect(() => {
  void Promise.all([
    fetch(`${apiUrl}/api/v1/events/${eventId}/lices`, { credentials: 'include' }).then((r) =>
      r.ok ? r.json() : [],
    ),
    fetch(`${apiUrl}/api/v1/events/${eventId}/persons?is_referee=true`, {
      credentials: 'include',
    }).then((r) => (r.ok ? r.json() : [])),
  ]).then(([licesData, refereesData]) => {
    setLices(licesData as Lice[]);
    setReferees(refereesData as Referee[]);
  });
}, [eventId]);
```

If `/api/v1/events/:eventId/persons?is_referee=true` doesn't filter by referee role today, find the equivalent endpoint that returns event-scoped referees and adjust.

- [ ] **Step 2: Add the PATCH handler**

```tsx
async function updateMatchAssignment(
  matchId: string,
  field: 'liceId' | 'refereeId',
  value: string | null,
) {
  // Optimistic update
  setPools((prev) =>
    prev.map((pool) => ({
      ...pool,
      matches: pool.matches.map((m) =>
        m.id === matchId ? { ...m, [field === 'liceId' ? 'lice_id' : 'referee_id']: value } : m,
      ),
    })),
  );
  try {
    const res = await fetch(`${apiUrl}/api/v1/matches/${matchId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    if (!res.ok) throw new Error('Update failed');
  } catch (err) {
    // Revert on error — refetch the row
    console.error('Match assignment update failed:', err);
    // For v1, log to console; toast is added by Phase 5 polish.
  }
}
```

- [ ] **Step 3: Replace the placeholder dashes with dropdowns**

In the table body, replace:

```tsx
<td className="px-4 py-2 text-slate-400 italic">—</td>
<td className="px-4 py-2 text-slate-400 italic">—</td>
```

with:

```tsx
<td className="px-4 py-2">
  <select
    value={m.lice_id ?? ''}
    onClick={(e) => e.stopPropagation()}
    onChange={(e) => updateMatchAssignment(m.id, 'liceId', e.target.value || null)}
    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
  >
    <option value="">{t('common.none')}</option>
    {lices.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
  </select>
</td>
<td className="px-4 py-2">
  <select
    value={m.referee_id ?? ''}
    onClick={(e) => e.stopPropagation()}
    onChange={(e) => updateMatchAssignment(m.id, 'refereeId', e.target.value || null)}
    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
  >
    <option value="">{t('common.none')}</option>
    {referees.map((r) => <option key={r.id} value={r.id}>{r.display_name}</option>)}
  </select>
</td>
```

The `onClick={(e) => e.stopPropagation()}` prevents the row-click navigation from firing when the user clicks the dropdown (the row click is added in the next step via wrapping the Link with a clickable row).

Actually wait — looking at the current component, the Red/Blue cells already contain `<Link>` so row-level click isn't a thing. The dropdowns just need to NOT also be Links. The `onClick` stopPropagation isn't strictly required here, but keeping it is defensive (in case row-click is added later).

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter web-admin typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add "apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/MatchesTab.tsx"
git commit -m "feat(web-admin): inline lice + referee dropdowns on Matches tab"
```

---

## Task 14: Matches tab — Supabase realtime

Subscribe to the `matches` table filtered to this pool phase. Each update patches the row in local state by `id`.

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/MatchesTab.tsx`

- [ ] **Step 1: Find the existing Supabase realtime usage**

Read `apps/web-admin/app/org/[slug]/events/[eventId]/matches/[matchId]/page.tsx` (or wherever the scoring screen lives) to find the Supabase client import + channel subscription pattern. The exact import path and helper used (`createBrowserClient` vs `createClient` vs a shared singleton in `apps/web-admin/src/lib/supabase.ts`) is repo-specific — use whatever the scoring screen uses.

- [ ] **Step 2: Add the realtime subscription**

In `MatchesTab.tsx`, near the other `useEffect` hooks, add:

```tsx
useEffect(() => {
  if (!poolPhaseId) return;
  const supabase = getSupabaseBrowserClient(); // or whatever the scoring screen uses
  const channel = supabase
    .channel(`pool-matches-list-${tournamentId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'matches', filter: `phase_id=eq.${poolPhaseId}` },
      (payload) => {
        const incoming = payload.new as MatchRow | undefined;
        if (!incoming) return;
        setPools((prev) =>
          prev.map((pool) => ({
            ...pool,
            matches: pool.matches.map((m) => (m.id === incoming.id ? { ...m, ...incoming } : m)),
          })),
        );
      },
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}, [tournamentId, poolPhaseId]);
```

Add the supabase client import at the top of the file — match the scoring screen's exact import path.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web-admin typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/MatchesTab.tsx"
git commit -m "feat(web-admin): realtime subscription on Matches tab"
```

---

# Phase 5 — Standings tab

## Task 15: Standings tab — toggle, hash routing, data fetch, generic table

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/StandingsTab.tsx`

- [ ] **Step 1: Replace the stub**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { t } from '@myclash/i18n';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface StandingsColumn {
  key: string;
  label: string;
  type: 'number' | 'string';
  sortDesc?: boolean;
}

interface StandingsRow {
  rank: number;
  registrationId: string;
  displayName: string;
  club: { id: string; name: string; abbreviation: string | null } | null;
  status: 'in_progress' | 'completed';
  stats: Record<string, number | string>;
}

interface OverallResponse {
  rulesetCode: string;
  rulesetVersion: string;
  columns: StandingsColumn[];
  rows: StandingsRow[];
}

interface ByPoolResponse {
  rulesetCode: string;
  rulesetVersion: string;
  columns: StandingsColumn[];
  pools: Array<{
    poolId: string;
    poolName: string;
    status: 'in_progress' | 'completed';
    rows: StandingsRow[];
  }>;
}

type Mode = 'overall' | 'by-pool';

interface StandingsTabProps {
  tournamentId: string;
  poolPhaseId: string;
}

function readHashMode(): Mode {
  if (typeof window === 'undefined') return 'overall';
  const hash = window.location.hash.replace('#', '');
  if (hash === 'standings-by-pool') return 'by-pool';
  return 'overall';
}

export function StandingsTab({ tournamentId }: StandingsTabProps) {
  const [mode, setMode] = useState<Mode>('overall');
  const [overall, setOverall] = useState<OverallResponse | null>(null);
  const [byPool, setByPool] = useState<ByPoolResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setMode(readHashMode());
    function onHash() {
      setMode(readHashMode());
    }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    setLoading(true);
    const url = `${apiUrl}/api/v1/tournaments/${tournamentId}/pool-standings?mode=${mode}`;
    fetch(url, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (mode === 'overall') setOverall(data as OverallResponse);
        else setByPool(data as ByPoolResponse);
        setLoading(false);
      });
  }, [tournamentId, mode]);

  function selectMode(m: Mode) {
    window.location.hash = m === 'overall' ? '#standings-overall' : '#standings-by-pool';
    setMode(m);
  }

  function downloadCsv(
    columns: StandingsColumn[],
    rows: StandingsRow[],
    filename: string,
    includePool?: boolean,
  ) {
    const headers = [
      'Rank',
      'Fighter',
      'Club',
      ...(includePool ? ['Pool'] : []),
      ...columns.map((c) => c.label),
      'Status',
    ];
    const lines = [headers.map(csvEscape).join(',')];
    for (const row of rows) {
      const r: string[] = [
        String(row.rank),
        row.displayName,
        row.club?.name ?? '',
        ...(includePool ? [(row as StandingsRow & { _poolName?: string })._poolName ?? ''] : []),
        ...columns.map((c) => String(row.stats[c.key] ?? '')),
        row.status,
      ];
      lines.push(r.map(csvEscape).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="inline-flex gap-1 rounded-md border border-slate-200 bg-white p-1">
          <button
            type="button"
            onClick={() => selectMode('overall')}
            className={`rounded px-3 py-1 text-sm font-medium ${mode === 'overall' ? 'bg-red-800 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
          >
            {t('organizer.pools.standings.overall')}
          </button>
          <button
            type="button"
            onClick={() => selectMode('by-pool')}
            className={`rounded px-3 py-1 text-sm font-medium ${mode === 'by-pool' ? 'bg-red-800 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
          >
            {t('organizer.pools.standings.byPool')}
          </button>
        </div>

        {mode === 'overall' && overall && (
          <button
            type="button"
            onClick={() => downloadCsv(overall.columns, overall.rows, 'overall-standings.csv')}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {t('organizer.pools.standings.exportCsv')}
          </button>
        )}
        {mode === 'by-pool' && byPool && byPool.pools.length > 0 && (
          <button
            type="button"
            onClick={() => {
              const allRows = byPool.pools.flatMap((p) =>
                p.rows.map(
                  (r) => ({ ...r, _poolName: p.poolName }) as StandingsRow & { _poolName: string },
                ),
              );
              downloadCsv(byPool.columns, allRows, 'all-pools-standings.csv', true);
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {t('organizer.pools.standings.exportAllPools')}
          </button>
        )}
      </div>

      {loading && <p className="text-sm text-slate-500">{t('common.loading')}</p>}

      {!loading &&
        mode === 'overall' &&
        overall &&
        (overall.rows.length === 0 ? (
          <EmptyState />
        ) : (
          <StandingsTable columns={overall.columns} rows={overall.rows} />
        ))}

      {!loading &&
        mode === 'by-pool' &&
        byPool &&
        (byPool.pools.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-6">
            {byPool.pools.map((pool) => (
              <section key={pool.poolId} className="rounded-lg border border-slate-200 bg-white">
                <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <h3 className="font-semibold text-slate-900">{pool.poolName}</h3>
                  <button
                    type="button"
                    onClick={() =>
                      downloadCsv(byPool.columns, pool.rows, `${pool.poolName}-standings.csv`)
                    }
                    className="text-xs text-slate-600 hover:underline"
                  >
                    {t('organizer.pools.standings.exportPool')}
                  </button>
                </header>
                {pool.rows.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-slate-400">
                    {t('organizer.pools.standings.emptyPool')}
                  </p>
                ) : (
                  <StandingsTable columns={byPool.columns} rows={pool.rows} />
                )}
              </section>
            ))}
          </div>
        ))}
    </div>
  );
}

function StandingsTable({ columns, rows }: { columns: StandingsColumn[]; rows: StandingsRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th className="px-4 py-2 w-16">{t('organizer.pools.standings.rank')}</th>
          <th className="px-4 py-2">{t('organizer.pools.standings.fighter')}</th>
          {columns.map((c) => (
            <th key={c.key} className="px-4 py-2 text-right">
              {c.label}
            </th>
          ))}
          <th className="px-4 py-2">{t('organizer.pools.standings.status')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.registrationId}
            className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
          >
            <td className="px-4 py-2 font-mono text-slate-700">{row.rank}</td>
            <td className="px-4 py-2">
              <span className="font-medium text-slate-900">{row.displayName}</span>
              {row.club && (
                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                  {row.club.abbreviation ?? row.club.name}
                </span>
              )}
            </td>
            {columns.map((c) => (
              <td key={c.key} className="px-4 py-2 text-right font-mono text-slate-700">
                {row.stats[c.key] ?? '—'}
              </td>
            ))}
            <td className="px-4 py-2">
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${row.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}
              >
                {row.status}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
      {t('organizer.pools.standings.noMatchesYet')}
    </div>
  );
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web-admin typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/StandingsTab.tsx"
git commit -m "feat(web-admin): Standings tab — Overall + By-pool views with CSV export"
```

---

## Task 16: Standings tab — Supabase realtime

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/StandingsTab.tsx`

- [ ] **Step 1: Add the realtime subscription**

Inside the `StandingsTab` component, add:

```tsx
useEffect(() => {
  if (!poolPhaseId) return;
  const supabase = getSupabaseBrowserClient(); // matches the helper used in MatchesTab + scoring screen
  const channel = supabase
    .channel(`pool-standings-${tournamentId}-${mode}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'matches', filter: `phase_id=eq.${poolPhaseId}` },
      () => {
        // Refetch on any change. Pools are small; one refetch per event is fine.
        const url = `${apiUrl}/api/v1/tournaments/${tournamentId}/pool-standings?mode=${mode}`;
        void fetch(url, { credentials: 'include' })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (mode === 'overall') setOverall(data as OverallResponse);
            else setByPool(data as ByPoolResponse);
          });
      },
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}, [tournamentId, poolPhaseId, mode]);
```

`poolPhaseId` is a prop. Match the supabase-client import to the same helper used in `MatchesTab` (added in Task 14).

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web-admin typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "apps/web-admin/app/org/[slug]/events/[eventId]/pools/_tabs/StandingsTab.tsx"
git commit -m "feat(web-admin): realtime subscription on Standings tab"
```

---

# Phase 6 — i18n + final verification

## Task 17: EN + FR i18n keys for `organizer.pools.*`

All UI strings introduced by Tasks 9-16 use `t()` keys that don't exist yet. Add them.

**Files:**

- Modify: `packages/i18n/src/index.ts`

- [ ] **Step 1: Find an insertion point**

Open `packages/i18n/src/index.ts`. Find the existing English `organizer` object (search for `organizer:`). Inside it, add a new `pools` sub-object.

- [ ] **Step 2: Add the EN keys**

Inside the `organizer` object (EN section):

```ts
      pools: {
        tabs: {
          configure: 'Configure',
          matches: 'Matches',
          standings: 'Standings',
          disabledHint: 'This tab unlocks once pools (and matches) are generated.',
        },
        configure: {
          constraints: 'Constraints',
          schoolSeparation: 'School separation',
          skillBalance: 'Skill balance',
          refNoBackToBack: 'No back-to-back refereeing',
          refRestMinSlots: 'Min rest pools',
          refDedicatedRest: 'Dedicated referee rest',
          refFighterNoOverlap: 'Fighter ≠ referee in own pool',
          refPreferHighRated: 'Prefer high-rated refs',
          help: {
            schoolSeparation:
              'Try to place fighters from the same club in different pools. Reduces same-club matches during pool play. When the algorithm can\'t fully separate (small clubs / few pools), it minimizes the count of same-club pairings instead of refusing to generate.',
            skillBalance:
              'Distribute high-skill and low-skill fighters evenly across pools using HEMA Ratings scores. Pools end up with comparable average rating so no pool is a "death pool" of all top seeds.',
            refNoBackToBack:
              'Prevent a referee from being scheduled to officiate two pools in a row. Gives them a break between duties.',
            refRestMinSlots:
              'How many pools a referee must rest between officiating duties. 1 = at least one pool gap between two pools they ref. Higher = more recovery time. Only used when "No back-to-back" is on.',
            refDedicatedRest:
              'Ensure referees who are also competing get a rest between the pool they\'re refereeing and the pool they\'re fighting in, so they\'re not switching roles back-to-back.',
            refFighterNoOverlap:
              'Never schedule a fighter to referee the same pool they\'re fighting in. This should always be on — turn it off only for unusual events where roles intentionally overlap.',
            refPreferHighRated:
              'When multiple referees are available for the same time slot, prefer those with higher referee ratings.',
          },
        },
        matches: {
          round: 'Round',
          red: 'Red',
          blue: 'Blue',
          score: 'Score',
          status: 'Status',
          lice: 'Lice',
          referee: 'Referee',
          summary: '{done} of {total} matches done',
          empty: 'No matches generated for this pool.',
        },
        standings: {
          overall: 'Overall',
          byPool: 'By pool',
          rank: 'Rank',
          fighter: 'Fighter',
          status: 'Status',
          exportCsv: 'Export CSV',
          exportPool: 'Export pool',
          exportAllPools: 'Export all pools',
          noMatchesYet: 'No matches completed yet. Standings will appear as scorekeepers finish matches.',
          emptyPool: 'No matches completed in this pool yet.',
        },
      },
```

- [ ] **Step 3: Add the FR keys**

Find the French `organizer` object and add the same `pools` sub-object with French translations:

```ts
      pools: {
        tabs: {
          configure: 'Configurer',
          matches: 'Combats',
          standings: 'Classement',
          disabledHint: 'Cet onglet se déverrouille une fois les poules (et les combats) générés.',
        },
        configure: {
          constraints: 'Contraintes',
          schoolSeparation: 'Séparation des clubs',
          skillBalance: 'Équilibre des niveaux',
          refNoBackToBack: 'Pas d\'arbitrage consécutif',
          refRestMinSlots: 'Repos min. (poules)',
          refDedicatedRest: 'Repos arbitre dédié',
          refFighterNoOverlap: 'Combattant ≠ arbitre dans sa poule',
          refPreferHighRated: 'Préférer arbitres notés',
          help: {
            schoolSeparation:
              'Placer si possible les combattants du même club dans des poules différentes. Réduit les combats entre coéquipiers en poule. Quand l\'algorithme ne peut pas séparer complètement (clubs petits / peu de poules), il minimise le nombre de paires plutôt que de refuser la génération.',
            skillBalance:
              'Répartir équitablement les combattants forts et faibles entre les poules selon les scores HEMA Ratings. Les poules ont des moyennes comparables — pas de « poule de la mort ».',
            refNoBackToBack:
              'Empêche un arbitre d\'officier deux poules consécutives. Lui laisse une pause entre ses missions.',
            refRestMinSlots:
              'Nombre de poules de repos exigé entre deux arbitrages. 1 = au moins une poule d\'écart. Plus haut = plus de récupération. Utilisé uniquement avec « pas consécutif ».',
            refDedicatedRest:
              'Garantit que les arbitres qui combattent ont une pause entre la poule qu\'ils arbitrent et la poule où ils combattent, pour ne pas enchaîner deux rôles d\'affilée.',
            refFighterNoOverlap:
              'Ne jamais assigner un combattant à l\'arbitrage de sa propre poule. À laisser activé — désactiver uniquement pour des événements particuliers où les rôles se chevauchent volontairement.',
            refPreferHighRated:
              'Quand plusieurs arbitres sont disponibles pour le même créneau, préférer ceux avec une meilleure notation.',
          },
        },
        matches: {
          round: 'Manche',
          red: 'Rouge',
          blue: 'Bleu',
          score: 'Score',
          status: 'Statut',
          lice: 'Piste',
          referee: 'Arbitre',
          summary: '{done} sur {total} combats terminés',
          empty: 'Aucun combat généré pour cette poule.',
        },
        standings: {
          overall: 'Global',
          byPool: 'Par poule',
          rank: 'Rang',
          fighter: 'Combattant',
          status: 'Statut',
          exportCsv: 'Exporter CSV',
          exportPool: 'Exporter cette poule',
          exportAllPools: 'Exporter toutes les poules',
          noMatchesYet: 'Aucun combat terminé. Le classement apparaîtra à mesure que les arbitres valident les combats.',
          emptyPool: 'Aucun combat terminé dans cette poule pour l\'instant.',
        },
      },
```

- [ ] **Step 4: Build i18n + workspace typecheck**

```bash
pnpm --filter @myclash/i18n build
pnpm -r typecheck
```

Both expected clean.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/src/index.ts
git commit -m "i18n: pools overhaul keys (EN + FR)"
```

---

## Task 18: Final verification

End-to-end check before declaring done.

- [ ] **Step 1: Full backend test suite**

```bash
pnpm --filter api test
```

Expected: all pass (existing + new pool-standings cases).

- [ ] **Step 2: Web-admin tests**

```bash
pnpm --filter web-admin test
```

Expected: all pass (existing + color-token + HelpTooltip).

- [ ] **Step 3: Full workspace typecheck**

```bash
pnpm -r typecheck
```

Expected: clean.

- [ ] **Step 4: Manual smoke — Configure tab**

1. Visit `/org/<slug>/events/<eventId>/pools` on a 1440px viewport. Layout is full-width; sticky right sidebar holds the config form + 7 constraint controls.
2. Hover the ⓘ next to each constraint label. Tooltip appears with the localized help text. Tab to focus the ⓘ — tooltip also appears.
3. Toggle `enforceRefereeNoBackToBack` off → `refereeRestMinSlots` input becomes disabled.
4. Click Generate. Network tab shows the 5 new fields in the POST body. Pools appear. The Matches tab becomes enabled.

- [ ] **Step 5: Manual smoke — Matches tab**

1. Open the Matches tab. Each pool renders a section with summary chip (`X done / Y total`).
2. Red and Blue column accents reflect the tournament's configured `sideColors`. Change `sideColors.red` to `yellow` in Settings → Display → return to Matches → Red column accent is now yellow.
3. Change a row's Lice dropdown → row updates optimistically.
4. Open the page in a second browser tab. Change a row's Lice in the first tab → second tab reflects within ~1s (realtime).
5. Click a row → navigates to the scorekeeping screen.

- [ ] **Step 6: Manual smoke — Standings tab**

1. With at least one completed match, Standings unlocks. Default opens on Overall.
2. URL fragment becomes `#standings-overall`.
3. Overall table renders the TF_v1 column set (W, L, D, F, ptsScored, ptsConceded, diff, doubles, hitsGiven, hitsReceived).
4. Switch to By pool → URL becomes `#standings-by-pool`. Refresh — still on By pool.
5. Complete another match via the scoring screen → standings refetches automatically (realtime).
6. Click Export CSV → file downloads with the right filename + columns.
7. Switch the tournament's ruleset to `Generic_PointsCap` (Settings → Basics) → return to Standings → column set changes (no doubles, no hits, no F).

- [ ] **Step 7: Push**

```bash
git push
```

- [ ] **Step 8: Done.**
