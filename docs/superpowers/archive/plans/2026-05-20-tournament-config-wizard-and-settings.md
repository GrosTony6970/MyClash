# Tournament Configuration Wizard + Settings Implementation Plan

> **Status (2026-07-01 doc review):** Superseded — the wizard, tabbed Settings page, `/rulesets` endpoint, and `/scoring-config`→`/settings` redirect all shipped (2026-06) and were then evolved past this plan (Settings now has 7 tabs, persistence switched to pluck-not-spread + default backfill). Kept for historical reference; do not re-execute. Audited against code.
>
> **For agentic workers (historical):** This plan is already SHIPPED and superseded — do NOT re-execute it. The unchecked `- [ ]` boxes below are point-in-time and were left as-authored; they do not mean work is outstanding.

**Goal:** Surface every backend-supported tournament configuration field through a 4-step create wizard and a tabbed Settings edit page, with a permanent redirect from the legacy `/scoring-config` URL.

**Architecture:** Backend changes are limited to extending existing tournament DTOs with new nested fields, adding deep-merge semantics to the PATCH path so per-step wizard PATCHes don't wipe each other, and a small new `GET /api/v1/rulesets` catalog endpoint. Frontend changes are: (1) rename `/scoring-config` to `/settings`, restructured as a 4-tab left-rail page; (2) replace the create page with a 4-step wizard that persists each step via existing POST/PATCH; (3) add Settings + Resume-setup affordances on the tournaments list row. No DB migrations — every new field lives inside existing JSONB columns.

> **Superseded (2026-07-01):** As shipped, the Settings page has **7** left-rail tabs — `basics`, `match-format`, `venues`, `display`, `advanced`, `locks`, `recap` — not the 4 planned here. And the per-step persistence contract evolved past whole-blob deep-merge: the wizard now plucks individual fields per step and backfills defaults on partial PATCH (commits 40ee6424, 5784d05c). `deepMergeJson` still exists and is used inside `events.service.ts` for the JSONB config merges, but it is no longer the sole PATCH contract described below.

**Tech Stack:** NestJS + class-validator (backend), Next.js 16 App Router + React 19 + `@myclash/ui` (frontend), Supabase (DB), `@myclash/rulesets` (ruleset catalog), `@myclash/i18n` (EN + FR).

**Spec:** [docs/superpowers/archive/specs/2026-05-20-tournament-config-wizard-and-settings-design.md](docs/superpowers/archive/specs/2026-05-20-tournament-config-wizard-and-settings-design.md)

---

## File map

**Backend (modify):**

- `apps/api/src/modules/events/dto/events.dto.ts` — extend Create/Update tournament DTOs.
- `apps/api/src/modules/events/events.service.ts` — wire deep-merge into `updateTournament`; ruleset-switch defaults.
- `apps/api/src/modules/events/tournament-config.test.ts` — new vitest cases.
- `apps/api/src/app.module.ts` — register new RulesetsModule.

**Backend (create):**

- `apps/api/src/modules/rulesets/rulesets.module.ts`
- `apps/api/src/modules/rulesets/rulesets.controller.ts`
- `apps/api/src/modules/rulesets/rulesets.controller.test.ts`
- `apps/api/src/common/deep-merge.ts` — small recursive merge utility.
- `apps/api/src/common/deep-merge.test.ts`

**Frontend (modify):**

- `apps/web-admin/next.config.ts` — add `redirects()` for `/scoring-config` → `/settings`.
- `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/page.tsx` — Settings link + Resume setup; trim edit modal.
- `packages/i18n/src/index.ts` — new EN + FR keys under `organizer.tournaments.wizard.*` and `.settings.*`.

**Frontend (create):**

- `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/[tournamentId]/settings/page.tsx` — left-rail tabbed Settings (replaces scoring-config).
- `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/[tournamentId]/settings/_components/BasicsTab.tsx`
- `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/[tournamentId]/settings/_components/MatchFormatTab.tsx`
- `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/[tournamentId]/settings/_components/DisplayTab.tsx`
- `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/[tournamentId]/settings/_components/AdvancedTab.tsx`
- `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/new/_wizard/WizardShell.tsx`
- `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/new/_wizard/Step1Basics.tsx`
- `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/new/_wizard/Step2MatchFormat.tsx`
- `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/new/_wizard/Step3Display.tsx`
- `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/new/_wizard/Step4Advanced.tsx`
- `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/new/_wizard/compute-wizard-step.ts`
- `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/new/_wizard/compute-wizard-step.test.ts`

**Frontend (replace):**

- `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/new/page.tsx` — now thin wrapper around `<WizardShell />`.

**Frontend (delete after redirect lands):**

- `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/[tournamentId]/scoring-config/page.tsx` — superseded by Settings page.

---

# Phase 1 — Backend foundation

## Task 1: Deep-merge utility

The wizard's per-step PATCHes target the same nested JSONB columns (`scoring_config`, `ruleset_config`, `lock_config`). Without deep-merge, step 2 saving `scoringConfig.pointCap` would wipe `scoringConfig.buttons` that step 3 had set. We need a tiny recursive merge that respects arrays as atomic (replace, not concat).

**Files:**

- Create: `apps/api/src/common/deep-merge.ts`
- Create: `apps/api/src/common/deep-merge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/common/deep-merge.test.ts
import { describe, expect, it } from 'vitest';
import { deepMergeJson } from './deep-merge';

describe('deepMergeJson', () => {
  it('merges nested objects key-by-key, preserving unrelated keys', () => {
    const base = { winBonus: 3, targetValues: { deepTarget: 2, shallowTarget: 1 } };
    const patch = { winBonus: 5 };
    expect(deepMergeJson(base, patch)).toEqual({
      winBonus: 5,
      targetValues: { deepTarget: 2, shallowTarget: 1 },
    });
  });

  it('replaces arrays atomically (no concat)', () => {
    const base = { buttons: [{ label: 'A' }, { label: 'B' }] };
    const patch = { buttons: [{ label: 'C' }] };
    expect(deepMergeJson(base, patch)).toEqual({ buttons: [{ label: 'C' }] });
  });

  it('returns patch when base is null/undefined', () => {
    expect(deepMergeJson(null, { a: 1 })).toEqual({ a: 1 });
    expect(deepMergeJson(undefined, { a: 1 })).toEqual({ a: 1 });
  });

  it('returns base when patch is null/undefined', () => {
    expect(deepMergeJson({ a: 1 }, null)).toEqual({ a: 1 });
    expect(deepMergeJson({ a: 1 }, undefined)).toEqual({ a: 1 });
  });

  it('explicit null in patch wipes the key', () => {
    expect(deepMergeJson({ a: 1, b: 2 }, { a: null })).toEqual({ a: null, b: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test deep-merge`
Expected: FAIL with "Cannot find module './deep-merge'".

- [ ] **Step 3: Implement deep-merge**

```ts
// apps/api/src/common/deep-merge.ts

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursive merge of `patch` onto `base` for JSON-shaped data.
 *
 * Rules:
 *   • Plain objects merge key-by-key (recursive).
 *   • Arrays replace atomically (callers who want concat must do it manually).
 *   • `null` in patch wipes the key in base (lets callers explicitly clear fields).
 *   • If base is null/undefined, returns patch unchanged.
 *   • If patch is null/undefined, returns base unchanged.
 */
export function deepMergeJson(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (base === undefined || base === null) return patch;
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;

  const result: JsonObject = { ...base };
  for (const key of Object.keys(patch)) {
    const patchValue = patch[key];
    if (patchValue === null) {
      result[key] = null;
    } else {
      result[key] = deepMergeJson(base[key], patchValue);
    }
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test deep-merge`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/deep-merge.ts apps/api/src/common/deep-merge.test.ts
git commit -m "feat(api): add deepMergeJson utility for nested JSONB patch merge"
```

---

## Task 2: GET /api/v1/rulesets catalog endpoint

Data-driven ruleset picker for the wizard's Basics step. Reads from the `@myclash/rulesets` registry.

**Files:**

- Create: `apps/api/src/modules/rulesets/rulesets.controller.ts`
- Create: `apps/api/src/modules/rulesets/rulesets.module.ts`
- Create: `apps/api/src/modules/rulesets/rulesets.controller.test.ts`
- Modify: `apps/api/src/app.module.ts` — register RulesetsModule

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/rulesets/rulesets.controller.test.ts
import { describe, expect, it } from 'vitest';
import { RulesetsController } from './rulesets.controller';

describe('RulesetsController', () => {
  it('returns the registry list mapped to { code, version, label }', () => {
    const controller = new RulesetsController();
    const result = controller.list();

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
    for (const entry of result) {
      expect(entry).toMatchObject({
        code: expect.any(String),
        version: expect.any(String),
        label: expect.any(String),
      });
    }
    // The well-known TF_v1 ruleset must be present.
    expect(result.find((r) => r.code === 'TF_v1')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test rulesets.controller`
Expected: FAIL with "Cannot find module './rulesets.controller'".

- [ ] **Step 3: Implement controller + module**

```ts
// apps/api/src/modules/rulesets/rulesets.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { registry } from '@myclash/rulesets';

interface RulesetSummary {
  code: string;
  version: string;
  label: string;
}

@ApiTags('rulesets')
@Controller('rulesets')
export class RulesetsController {
  /** GET /api/v1/rulesets — public catalog of available rulesets. */
  @Get()
  @ApiOperation({ summary: 'List available rulesets for the tournament config wizard' })
  list(): RulesetSummary[] {
    return registry.list().map((ruleset) => ({
      code: ruleset.code,
      version: ruleset.version,
      label: ruleset.label ?? `${ruleset.code} v${ruleset.version}`,
    }));
  }
}
```

```ts
// apps/api/src/modules/rulesets/rulesets.module.ts
import { Module } from '@nestjs/common';
import { RulesetsController } from './rulesets.controller';

@Module({
  controllers: [RulesetsController],
})
export class RulesetsModule {}
```

- [ ] **Step 4: Register the module in AppModule**

Open `apps/api/src/app.module.ts` and add the import:

```ts
import { RulesetsModule } from './modules/rulesets/rulesets.module';
```

Add `RulesetsModule` to the `imports` array.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter api test rulesets.controller`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter api typecheck`
Expected: clean.

If the test reports a missing `ruleset.label` field, check `packages/rulesets/src/types.ts` (or wherever `Ruleset` is typed) and either widen the type to include an optional `label`, or have the controller compute the label from `code` + `version` only. The fallback `ruleset.label ?? \`${ruleset.code} v${ruleset.version}\`` already covers this — the type may just need updating to allow the optional field.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/rulesets apps/api/src/app.module.ts
git commit -m "feat(api): GET /rulesets catalog endpoint for the tournament wizard picker"
```

---

## Task 3: Extend Create/Update tournament DTOs with full nested config fields

The existing `UpdateTournamentDto` already has `scoringConfig`, `rulesetConfig`, `lockConfig` as raw `Record<string, unknown>` fields. We tighten the types with nested DTOs so the wizard's step PATCHes are validated, and add the same nested fields to `CreateTournamentDto` so the wizard's step-1 POST can include extras (rare but supported).

**Files:**

- Modify: `apps/api/src/modules/events/dto/events.dto.ts:204-285`

- [ ] **Step 1: Read the current DTOs**

Read `apps/api/src/modules/events/dto/events.dto.ts:200-290` to see the current `CreateTournamentDto` + `UpdateTournamentDto` + `TournamentScoringConfig` + `TournamentLockConfig` types.

- [ ] **Step 2: Add nested validation DTOs**

Just BEFORE `CreateTournamentDto` (around line 204), insert:

```ts
import {
  ValidateNested,
  IsBoolean,
  IsNumber,
  IsString,
  IsIn,
  Min,
  Max,
  IsArray,
  IsOptional,
  IsUUID,
  MaxLength,
  MinLength,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

// Note: the import line above may overlap with the file's existing imports — merge,
// don't duplicate.

class TargetValuesDto {
  @IsOptional() @IsNumber() @Min(0) @Max(20) deepTarget?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(20) shallowTarget?: number;
}

class ForfeitPolicyDto {
  @IsOptional() @IsBoolean() forfeitDrawsCount?: boolean;
  @IsOptional() @IsBoolean() forfeitFighterBefore1stMatch?: boolean;
  @IsOptional() @IsNumber() @Min(1) @Max(10) disqualifyAfter?: number;
}

class TournamentRulesetConfigDto {
  @IsOptional() @IsNumber() @Min(0) @Max(20) winBonus?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(10_000) afterblowWindowMs?: number;
  @IsOptional() @ValidateNested() @Type(() => TargetValuesDto) targetValues?: TargetValuesDto;
  @IsOptional() @ValidateNested() @Type(() => ForfeitPolicyDto) forfeitPolicy?: ForfeitPolicyDto;
}

class TournamentLockConfigDto {
  @IsOptional() @IsBoolean() autoLockEnabled?: boolean;
  @IsOptional() @IsNumber() @Min(0) @Max(1440) autoLockDelayMinutes?: number;
  @IsOptional() @IsBoolean() autoLockCompletedPools?: boolean;
  @IsOptional() @IsBoolean() autoLockCompletedBrackets?: boolean;
}
```

- [ ] **Step 3: Modify CreateTournamentDto to accept the nested optional fields**

Locate the existing `CreateTournamentDto` and add these fields just before the closing brace:

```ts
  @IsOptional()
  @ValidateNested()
  @Type(() => TournamentRulesetConfigDto)
  rulesetConfig?: TournamentRulesetConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => TournamentLockConfigDto)
  lockConfig?: TournamentLockConfigDto;

  @IsOptional()
  @IsObject()
  scoringConfig?: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  penaltyRulesetId?: string;
```

- [ ] **Step 4: Modify UpdateTournamentDto to use the typed nested DTOs**

In `UpdateTournamentDto`, REPLACE the existing raw `rulesetConfig?: Record<string, unknown>` and `lockConfig?: TournamentLockConfig` field declarations with the typed nested DTOs (matching the Create variant). Keep `scoringConfig` as `Record<string, unknown>` for now — its inner shape is complex and the existing `normalizeTournamentScoringConfig()` handles validation:

```ts
  @IsOptional()
  @ValidateNested()
  @Type(() => TournamentRulesetConfigDto)
  rulesetConfig?: TournamentRulesetConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => TournamentLockConfigDto)
  lockConfig?: TournamentLockConfigDto;
```

Also add `penaltyRulesetId`, `rulesetCode`, `rulesetVersion` as optional fields if not already present:

```ts
  @IsOptional() @IsUUID() penaltyRulesetId?: string | null;
  @IsOptional() @IsString() @MaxLength(50) rulesetCode?: string;
  @IsOptional() @IsString() @MaxLength(20) rulesetVersion?: string;
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter api typecheck`
Expected: clean.

If anything in `events.service.ts` references the old raw types, update those call sites — the typed DTO fields are still structurally `Record<string, unknown>`-compatible because every field is optional.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/events/dto/events.dto.ts
git commit -m "feat(api): tighten tournament DTOs with typed nested config validation"
```

---

## Task 4: Deep-merge nested JSONB on updateTournament

`updateTournament` currently replaces `scoringConfig` / `rulesetConfig` / `lockConfig` outright. The wizard saves them step-by-step; without deep-merge, step 3 (Display) would wipe step 2 (Match Format). Wire `deepMergeJson` in.

**Files:**

- Modify: `apps/api/src/modules/events/events.service.ts:598-643`
- Modify: `apps/api/src/modules/events/tournament-config.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/modules/events/tournament-config.test.ts`:

```ts
import { deepMergeJson } from '../../common/deep-merge';

describe('updateTournament — deep-merge of nested config', () => {
  it('PATCH with { rulesetConfig: { winBonus: 5 } } preserves other rulesetConfig keys', () => {
    const stored = { winBonus: 3, targetValues: { deepTarget: 2, shallowTarget: 1 } };
    const patch = { winBonus: 5 };
    const merged = deepMergeJson(stored, patch);
    expect(merged).toEqual({
      winBonus: 5,
      targetValues: { deepTarget: 2, shallowTarget: 1 },
    });
  });

  it('PATCH with { scoringConfig: { pointCap: 7 } } preserves stored buttons array', () => {
    const stored = { pointCap: 5, buttons: { clean: [{ label: 'A' }] } };
    const patch = { pointCap: 7 };
    const merged = deepMergeJson(stored, patch);
    expect(merged).toEqual({
      pointCap: 7,
      buttons: { clean: [{ label: 'A' }] },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass** (deepMergeJson already exists from Task 1)

Run: `pnpm --filter api test tournament-config`
Expected: PASS (both new cases).

- [ ] **Step 3: Wire deep-merge into updateTournament**

Open `apps/api/src/modules/events/events.service.ts:598-643`. Locate the body of `updateTournament`. Today the method builds an `updates` object that gets passed to `.update(updates)`. Change it so that when `dto.scoringConfig`, `dto.rulesetConfig`, or `dto.lockConfig` is present in the patch, the existing row is read first and the patch is deep-merged onto the stored value before writing.

Add at the top of the file (next to other imports):

```ts
import { deepMergeJson } from '../../common/deep-merge';
```

Replace the update method's body (preserving its existing validation/normalization calls). The shape becomes:

```ts
async updateTournament(tournamentId: string, dto: UpdateTournamentDto, userId: string) {
  // Read current row so we can deep-merge any nested JSONB fields the caller
  // included in the patch. Without this, a wizard step saving only one nested
  // key would wipe everything else under that JSONB column.
  const { data: current, error: readError } = await this.supabase.service
    .from('tournaments')
    .select('*')
    .eq('id', tournamentId)
    .maybeSingle();
  if (readError) throw new BadRequestException(readError.message);
  if (!current) throw new NotFoundException(`Tournament ${tournamentId} not found`);

  const updates: Record<string, unknown> = {};
  if (dto.name !== undefined) updates['name'] = dto.name;
  if (dto.weapon !== undefined) updates['weapon'] = dto.weapon;
  if (dto.category !== undefined) updates['category'] = dto.category;
  if (dto.status !== undefined) updates['status'] = dto.status;
  if (dto.rulesetCode !== undefined) updates['ruleset_code'] = dto.rulesetCode;
  if (dto.rulesetVersion !== undefined) updates['ruleset_version'] = dto.rulesetVersion;
  if (dto.penaltyRulesetId !== undefined) updates['penalty_ruleset_id'] = dto.penaltyRulesetId;

  if (dto.scoringConfig !== undefined) {
    const merged = deepMergeJson(
      (current as Record<string, unknown>)['scoring_config'] ?? {},
      dto.scoringConfig,
    );
    updates['scoring_config'] = normalizeTournamentScoringConfig(merged);
  }
  if (dto.lockConfig !== undefined) {
    const merged = deepMergeJson(
      (current as Record<string, unknown>)['lock_config'] ?? {},
      dto.lockConfig,
    );
    updates['lock_config'] = normalizeTournamentLockConfig(merged);
  }
  if (dto.rulesetConfig !== undefined) {
    const merged = deepMergeJson(
      (current as Record<string, unknown>)['ruleset_config'] ?? {},
      dto.rulesetConfig,
    );
    updates['ruleset_config'] = validateTournamentRulesetConfig(merged);
  }

  updates['updated_at'] = new Date().toISOString();

  const { data, error } = await this.supabase.service
    .from('tournaments')
    .update(updates)
    .eq('id', tournamentId)
    .select('*')
    .single();
  if (error) throw new BadRequestException(error.message);
  return data;
}
```

Add `NotFoundException` to the existing `@nestjs/common` import if not already present.

- [ ] **Step 4: Run the test suite for events**

Run: `pnpm --filter api test events`
Expected: all existing tests still pass (the deep-merge change is transparent for full-object PATCHes).

If a test fails because it expected the old "wipe-and-replace" behavior, update it to assert the new merge behavior — that's the correct contract going forward.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/events apps/api/src/common
git commit -m "feat(api): deep-merge nested config on PATCH /tournaments/:id"
```

---

## Task 5: Ruleset-switch defaults on updateTournament

When `rulesetCode` changes (e.g., TF_v1 → Generic_PointsCap), TF_v1-specific keys inside `ruleset_config` become meaningless. Clear them and fill defaults from the new ruleset.

**Files:**

- Modify: `apps/api/src/modules/events/events.service.ts` — extend the rulesetCode branch.
- Modify: `apps/api/src/modules/events/tournament-config.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/modules/events/tournament-config.test.ts`:

```ts
import { defaultRulesetConfigFor } from '../../modules/events/ruleset-defaults';
// (Path may differ; this helper is created in this task.)

describe('updateTournament — ruleset switch resets ruleset_config to new ruleset defaults', () => {
  it('switching TF_v1 → Generic_PointsCap clears TF_v1 internals', () => {
    const stored = { winBonus: 3, targetValues: { deepTarget: 2 } };
    const next = defaultRulesetConfigFor('Generic_PointsCap', '1');
    // Generic_PointsCap shouldn't have winBonus or targetValues
    expect(next).not.toHaveProperty('winBonus');
    expect(next).not.toHaveProperty('targetValues');
  });

  it('staying on TF_v1 keeps existing ruleset_config (no reset)', () => {
    const stored = { winBonus: 5 };
    const next = defaultRulesetConfigFor('TF_v1', '1');
    // Defaults exist, but the merge in updateTournament should retain stored values.
    // (Reset only fires when the code changes.)
    expect(next).toHaveProperty('winBonus');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test tournament-config`
Expected: FAIL with "Cannot find module 'ruleset-defaults'".

- [ ] **Step 3: Implement the ruleset-defaults helper**

Create `apps/api/src/modules/events/ruleset-defaults.ts`:

```ts
import { registry } from '@myclash/rulesets';

/**
 * Returns the default `ruleset_config` JSONB shape for the given ruleset.
 * Falls back to an empty object if the ruleset has no exposed defaults.
 */
export function defaultRulesetConfigFor(code: string, version: string): Record<string, unknown> {
  const ruleset = registry.get(code, version);
  if (!ruleset) return {};
  // The ruleset's `defaults` (or equivalent property) holds the default config.
  // If the @myclash/rulesets exports use a different property name, adjust here.
  const defaults = (ruleset as { defaults?: Record<string, unknown> }).defaults;
  return defaults ? { ...defaults } : {};
}
```

If the `@myclash/rulesets` package doesn't yet expose `defaults`, add a hardcoded fallback inside this helper for the two known rulesets (TF_v1, Generic_PointsCap) — but the cleaner long-term fix is to expose defaults from each ruleset module. Document the decision inline.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test tournament-config`
Expected: PASS.

- [ ] **Step 5: Apply reset logic in updateTournament**

In `apps/api/src/modules/events/events.service.ts:updateTournament`, locate the block that handles `dto.rulesetCode`. Replace it with:

```ts
import { defaultRulesetConfigFor } from './ruleset-defaults';

// inside updateTournament:
const currentCode = (current as { ruleset_code?: string }).ruleset_code;
const currentVersion = (current as { ruleset_version?: string }).ruleset_version;
const codeChanged = dto.rulesetCode !== undefined && dto.rulesetCode !== currentCode;
const versionChanged = dto.rulesetVersion !== undefined && dto.rulesetVersion !== currentVersion;

if (dto.rulesetCode !== undefined) updates['ruleset_code'] = dto.rulesetCode;
if (dto.rulesetVersion !== undefined) updates['ruleset_version'] = dto.rulesetVersion;

if (codeChanged || versionChanged) {
  // Switching ruleset wipes the existing config and seeds defaults from the
  // new ruleset. Caller-provided rulesetConfig in the same PATCH is merged
  // on top of those defaults.
  const newDefaults = defaultRulesetConfigFor(
    dto.rulesetCode ?? currentCode ?? 'TF_v1',
    dto.rulesetVersion ?? currentVersion ?? '1',
  );
  const callerPatch = dto.rulesetConfig ?? {};
  updates['ruleset_config'] = validateTournamentRulesetConfig(
    deepMergeJson(newDefaults, callerPatch),
  );
} else if (dto.rulesetConfig !== undefined) {
  // Same ruleset — merge caller patch onto the existing stored config.
  const merged = deepMergeJson(
    (current as Record<string, unknown>)['ruleset_config'] ?? {},
    dto.rulesetConfig,
  );
  updates['ruleset_config'] = validateTournamentRulesetConfig(merged);
}
```

- [ ] **Step 6: Run the test suite for events**

Run: `pnpm --filter api test events`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/events
git commit -m "feat(api): reset ruleset_config to new ruleset defaults on rulesetCode switch"
```

---

# Phase 2 — Shared frontend utility

## Task 6: computeWizardStep utility + tests

A pure function that takes a tournament row and returns which wizard step the user should resume on. Used by the tournaments list (`Resume setup` deep-link) and the wizard's auto-resume logic.

**Files:**

- Create: `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/new/_wizard/compute-wizard-step.ts`
- Create: `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/new/_wizard/compute-wizard-step.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// compute-wizard-step.test.ts
import { describe, expect, it } from 'vitest';
import { computeWizardStep, type WizardTournamentInput } from './compute-wizard-step';

function row(overrides: Partial<WizardTournamentInput>): WizardTournamentInput {
  return {
    id: 't-1',
    name: 'T',
    slug: 't',
    ruleset_code: 'TF_v1',
    ruleset_version: '1',
    scoring_config: null,
    ruleset_config: null,
    lock_config: null,
    status: 'draft',
    ...overrides,
  };
}

describe('computeWizardStep', () => {
  it('returns 2 when basics are set but match format is not', () => {
    expect(computeWizardStep(row({}))).toBe(2);
  });

  it('returns 3 when match format is set but display buttons are not', () => {
    expect(computeWizardStep(row({ scoring_config: { pointCap: 5 } }))).toBe(3);
  });

  it('returns 4 when display is set but advanced is not', () => {
    expect(
      computeWizardStep(
        row({ scoring_config: { pointCap: 5, buttons: { clean: [{ label: 'A' }] } } }),
      ),
    ).toBe(4);
  });

  it('returns null when all four steps are complete', () => {
    expect(
      computeWizardStep(
        row({
          scoring_config: { pointCap: 5, buttons: { clean: [{ label: 'A' }] } },
          ruleset_config: { winBonus: 5 },
        }),
      ),
    ).toBe(null);
  });

  it('returns 1 when basics are missing (defensive)', () => {
    expect(computeWizardStep(row({ name: '' }))).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web-admin test compute-wizard-step`
Expected: FAIL.

- [ ] **Step 3: Implement the utility**

```ts
// compute-wizard-step.ts

export interface WizardTournamentInput {
  id: string;
  name: string | null;
  slug: string | null;
  ruleset_code: string | null;
  ruleset_version: string | null;
  scoring_config: Record<string, unknown> | null;
  ruleset_config: Record<string, unknown> | null;
  lock_config: Record<string, unknown> | null;
  status: string;
}

/**
 * Returns the wizard step number (1-4) the user should resume on, or `null`
 * if every step has been completed at least once.
 *
 * Heuristic — driven by which JSONB blobs have been written to. Operators
 * can always click step indicators to jump back; this function just decides
 * the DEFAULT step for `Resume setup` and the wizard auto-open.
 */
export function computeWizardStep(row: WizardTournamentInput): 1 | 2 | 3 | 4 | null {
  if (!row.name || !row.slug || !row.ruleset_code) return 1;
  const scoring = row.scoring_config ?? {};
  const ruleset = row.ruleset_config ?? {};
  if (!('pointCap' in scoring)) return 2;
  const buttons = (scoring as { buttons?: { clean?: unknown[] } }).buttons;
  if (!buttons || !Array.isArray(buttons.clean) || buttons.clean.length === 0) return 3;
  // Advanced is "done" if EITHER TF_v1 ruleset_config has been touched OR
  // lock_config is non-default. Both being default means step 4 wasn't visited.
  const rulesetTouched = Object.keys(ruleset).length > 0;
  const lockTouched = row.lock_config != null && Object.keys(row.lock_config).length > 0;
  if (!rulesetTouched && !lockTouched) return 4;
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web-admin test compute-wizard-step`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add apps/web-admin/app/org/\[slug\]/events/\[eventId\]/tournaments/new/_wizard
git commit -m "feat(web-admin): computeWizardStep utility for draft resume routing"
```

---

# Phase 3 — Settings page (rename + tabs)

## Task 7: Rename /scoring-config → /settings (file move, content unchanged)

Move the existing scoring-config page wholesale to the new `/settings` path. Same content, new URL. This keeps the diff in this task purely a rename so the per-tab restructure happens in subsequent tasks against a known-working baseline.

**Files:**

- Create: `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/[tournamentId]/settings/page.tsx`
- Delete: `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/[tournamentId]/scoring-config/page.tsx`

- [ ] **Step 1: Copy the existing scoring-config page to the new path**

```bash
cp "apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/[tournamentId]/scoring-config/page.tsx" \
   "apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/[tournamentId]/settings/page.tsx"
```

If the new directory doesn't exist, create it first.

- [ ] **Step 2: Delete the scoring-config file (the redirect handles old URLs in the next task)**

```bash
rm "apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/[tournamentId]/scoring-config/page.tsx"
rmdir "apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/[tournamentId]/scoring-config" 2>/dev/null || true
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web-admin typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web-admin/app/org
git commit -m "refactor(web-admin): rename tournaments/[id]/scoring-config to /settings"
```

---

## Task 8: Add /scoring-config → /settings permanent redirect

Honor any bookmarks / external links to the old URL.

**Files:**

- Modify: `apps/web-admin/next.config.ts`

- [ ] **Step 1: Read the current next.config.ts**

```bash
cat apps/web-admin/next.config.ts
```

- [ ] **Step 2: Add a redirects() block**

In `next.config.ts`, inside the exported config object, add:

```ts
async redirects() {
  return [
    {
      source: '/org/:slug/events/:eventId/tournaments/:tournamentId/scoring-config',
      destination: '/org/:slug/events/:eventId/tournaments/:tournamentId/settings#match-format',
      permanent: true,
    },
  ];
},
```

If the file is `.mjs` style with a named export, adapt the syntax. Keep alphabetical / logical ordering of config keys consistent with the file's existing style.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web-admin typecheck`
Expected: clean.

- [ ] **Step 4: Manual verify the redirect**

Start the web-admin dev server and visit any old `/scoring-config` URL. It should 308 to `/settings#match-format` and load the new page.

- [ ] **Step 5: Commit**

```bash
git add apps/web-admin/next.config.ts
git commit -m "feat(web-admin): permanent redirect /scoring-config -> /settings"
```

---

## Task 9: Settings page shell — left-rail tab layout

> **Superseded (2026-07-01):** The shipped page has 7 tabs (`basics`, `match-format`, `venues`, `display`, `advanced`, `locks`, `recap`), not the 4 shown below. The `TabKey`/`TABS` snippet in this task is the original 4-tab draft.

Replace the renamed `settings/page.tsx` body with a left-rail tab layout. Each tab is its own component (extracted in tasks 10-13). The URL hash drives which tab is active (`#basics`, `#match-format`, `#display`, `#advanced`).

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/[tournamentId]/settings/page.tsx`

- [ ] **Step 1: Rewrite the file**

Replace the content of `settings/page.tsx` with:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AdminPageHeader } from '@myclash/ui';
import { t } from '@myclash/i18n';
import { BasicsTab } from './_components/BasicsTab';
import { MatchFormatTab } from './_components/MatchFormatTab';
import { DisplayTab } from './_components/DisplayTab';
import { AdvancedTab } from './_components/AdvancedTab';

type TabKey = 'basics' | 'match-format' | 'display' | 'advanced';

const TABS: Array<{ key: TabKey; labelKey: string }> = [
  { key: 'basics', labelKey: 'organizer.tournaments.settings.basics' },
  { key: 'match-format', labelKey: 'organizer.tournaments.settings.matchFormat' },
  { key: 'display', labelKey: 'organizer.tournaments.settings.display' },
  { key: 'advanced', labelKey: 'organizer.tournaments.settings.advanced' },
];

function readHashTab(): TabKey {
  if (typeof window === 'undefined') return 'basics';
  const hash = window.location.hash.replace('#', '');
  return TABS.find((tab) => tab.key === hash)?.key ?? 'basics';
}

export default function TournamentSettingsPage() {
  const params = useParams<{ slug: string; eventId: string; tournamentId: string }>();
  const [active, setActive] = useState<TabKey>('basics');

  useEffect(() => {
    setActive(readHashTab());
    function onHash() {
      setActive(readHashTab());
    }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function selectTab(key: TabKey) {
    window.location.hash = `#${key}`;
  }

  return (
    <main id="main-content" className="mx-auto w-full px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow="Tournament"
        title={t('organizer.tournaments.settings.title')}
        subtitle={t('organizer.tournaments.settings.subtitle')}
      />

      <div className="mt-6 grid grid-cols-[200px_1fr] gap-8">
        <nav aria-label="Settings sections" className="flex flex-col gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => selectTab(tab.key)}
              className={[
                'text-left px-3 py-2 rounded-md text-sm font-medium transition-colors',
                active === tab.key ? 'bg-red-800 text-white' : 'text-slate-700 hover:bg-slate-100',
              ].join(' ')}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </nav>

        <section>
          {active === 'basics' && <BasicsTab tournamentId={params.tournamentId} />}
          {active === 'match-format' && <MatchFormatTab tournamentId={params.tournamentId} />}
          {active === 'display' && <DisplayTab tournamentId={params.tournamentId} />}
          {active === 'advanced' && <AdvancedTab tournamentId={params.tournamentId} />}
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web-admin typecheck`
Expected: FAIL — the four `*Tab` components don't exist yet. That's expected; the next tasks create them.

- [ ] **Step 3: Create placeholder stubs for the four tab components**

Create `_components/BasicsTab.tsx`, `_components/MatchFormatTab.tsx`, `_components/DisplayTab.tsx`, `_components/AdvancedTab.tsx` each with the same stub body (replace the name):

```tsx
'use client';

export function BasicsTab({ tournamentId }: { tournamentId: string }) {
  return (
    <div className="text-sm text-slate-500">
      Basics tab — under construction (tournament {tournamentId})
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web-admin typecheck`
Expected: clean.

- [ ] **Step 5: Manual verify**

Visit `/org/<slug>/events/<id>/tournaments/<id>/settings`. The page renders the page header, the four-tab left rail, and the "under construction" placeholder for whichever tab is active. Clicking tabs updates the URL hash and changes the displayed placeholder.

- [ ] **Step 6: Commit**

```bash
git add apps/web-admin/app/org
git commit -m "feat(web-admin): Settings page shell with left-rail tabs"
```

---

## Task 10: BasicsTab — name, slug, weapon, category, ruleset, penaltyRulesetId

Fields backed by PATCH `/tournaments/:id`.

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/[tournamentId]/settings/_components/BasicsTab.tsx`

- [ ] **Step 1: Implement BasicsTab**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { t } from '@myclash/i18n';
import { useToast } from '@myclash/ui';

interface Ruleset {
  code: string;
  version: string;
  label: string;
}
interface PenaltyRuleset {
  id: string;
  name: string;
}

interface TournamentBasics {
  name: string;
  slug: string;
  weapon: string | null;
  category: string | null;
  rulesetCode: string;
  rulesetVersion: string;
  penaltyRulesetId: string | null;
}

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

export function BasicsTab({ tournamentId }: { tournamentId: string }) {
  const toast = useToast();
  const [data, setData] = useState<TournamentBasics | null>(null);
  const [rulesets, setRulesets] = useState<Ruleset[]>([]);
  const [penaltyRulesets, setPenaltyRulesets] = useState<PenaltyRuleset[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void Promise.all([
      fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, { credentials: 'include' }).then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch(`${apiUrl}/api/v1/rulesets`, { credentials: 'include' }).then((r) =>
        r.ok ? r.json() : [],
      ),
      fetch(`${apiUrl}/api/v1/penalty-rulesets`, { credentials: 'include' }).then((r) =>
        r.ok ? r.json() : [],
      ),
    ]).then(([t, r, p]) => {
      if (t) {
        setData({
          name: t.name,
          slug: t.slug,
          weapon: t.weapon,
          category: t.category,
          rulesetCode: t.ruleset_code,
          rulesetVersion: t.ruleset_version,
          penaltyRulesetId: t.penalty_ruleset_id,
        });
      }
      setRulesets(r as Ruleset[]);
      setPenaltyRulesets(p as PenaltyRuleset[]);
    });
  }, [tournamentId]);

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          weapon: data.weapon ?? undefined,
          category: data.category ?? undefined,
          rulesetCode: data.rulesetCode,
          rulesetVersion: data.rulesetVersion,
          penaltyRulesetId: data.penaltyRulesetId,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      toast.success(t('organizer.tournaments.settings.saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  if (!data) return <p className="text-sm text-slate-500">{t('common.loading')}</p>;

  return (
    <div className="space-y-4">
      <h2 className="font-display text-xl text-slate-900">
        {t('organizer.tournaments.settings.basics')}
      </h2>

      <Field label={t('organizer.tournaments.settings.name')}>
        <input
          value={data.name}
          onChange={(e) => setData({ ...data, name: e.target.value })}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </Field>

      <Field label={t('organizer.tournaments.settings.slug')}>
        <input
          value={data.slug}
          disabled
          className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 font-mono"
        />
        <p className="text-xs text-slate-400 mt-1">
          {t('organizer.tournaments.settings.slugLocked')}
        </p>
      </Field>

      <Field label={t('organizer.tournaments.settings.weapon')}>
        <input
          value={data.weapon ?? ''}
          onChange={(e) => setData({ ...data, weapon: e.target.value || null })}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </Field>

      <Field label={t('organizer.tournaments.settings.category')}>
        <input
          value={data.category ?? ''}
          onChange={(e) => setData({ ...data, category: e.target.value || null })}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </Field>

      <Field label={t('organizer.tournaments.settings.ruleset')}>
        <select
          value={`${data.rulesetCode}:${data.rulesetVersion}`}
          onChange={(e) => {
            const [code, version] = e.target.value.split(':');
            setData({ ...data, rulesetCode: code!, rulesetVersion: version! });
          }}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {rulesets.map((r) => (
            <option key={`${r.code}:${r.version}`} value={`${r.code}:${r.version}`}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t('organizer.tournaments.settings.penaltyRuleset')}>
        <select
          value={data.penaltyRulesetId ?? ''}
          onChange={(e) => setData({ ...data, penaltyRulesetId: e.target.value || null })}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">{t('common.none')}</option>
          {penaltyRulesets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
      >
        {saving ? t('common.saving') : t('organizer.tournaments.settings.save')}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      {children}
    </label>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web-admin typecheck`
Expected: clean.

- [ ] **Step 3: Manual verify**

Visit `/.../settings#basics`. The form loads with current values; saving updates the tournament.

- [ ] **Step 4: Commit**

```bash
git add apps/web-admin/app/org
git commit -m "feat(web-admin): Settings BasicsTab"
```

---

## Task 11: MatchFormatTab — pointCap, timer, time limits, soft clock, max double hits, afterblow mode, scoring direction

These fields all live under `scoring_config` JSONB. PATCH sends only `scoringConfig`; deep-merge preserves the buttons/display fields.

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/[tournamentId]/settings/_components/MatchFormatTab.tsx`

- [ ] **Step 1: Implement MatchFormatTab**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { t } from '@myclash/i18n';
import { useToast } from '@myclash/ui';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface MatchFormat {
  pointCap: number;
  timerMode: 'countdown' | 'countup';
  timeLimitsSeconds: { pool: number | null; bracket: number | null; finals: number | null };
  softClockLimitSeconds: number;
  maxDoubleHits: number | null;
  afterblowMode: 'full' | 'deductive';
  scoringDirection: 'normal' | 'reverse_zero_loses';
}

const DEFAULTS: MatchFormat = {
  pointCap: 5,
  timerMode: 'countdown',
  timeLimitsSeconds: { pool: 180, bracket: 240, finals: 300 },
  softClockLimitSeconds: 60,
  maxDoubleHits: 3,
  afterblowMode: 'full',
  scoringDirection: 'normal',
};

export function MatchFormatTab({ tournamentId }: { tournamentId: string }) {
  const toast = useToast();
  const [data, setData] = useState<MatchFormat>(DEFAULTS);
  const [rulesetCode, setRulesetCode] = useState<string>('TF_v1');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((row) => {
        if (!row) return;
        setRulesetCode(row.ruleset_code);
        const sc = (row.scoring_config ?? {}) as Partial<MatchFormat>;
        setData({
          pointCap: sc.pointCap ?? DEFAULTS.pointCap,
          timerMode: sc.timerMode ?? DEFAULTS.timerMode,
          timeLimitsSeconds: { ...DEFAULTS.timeLimitsSeconds, ...(sc.timeLimitsSeconds ?? {}) },
          softClockLimitSeconds: sc.softClockLimitSeconds ?? DEFAULTS.softClockLimitSeconds,
          maxDoubleHits: sc.maxDoubleHits ?? DEFAULTS.maxDoubleHits,
          afterblowMode: sc.afterblowMode ?? DEFAULTS.afterblowMode,
          scoringDirection: sc.scoringDirection ?? DEFAULTS.scoringDirection,
        });
      });
  }, [tournamentId]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scoringConfig: data }),
      });
      if (!res.ok) throw new Error('Save failed');
      toast.success(t('organizer.tournaments.settings.saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  const isTfV1 = rulesetCode === 'TF_v1';

  return (
    <div className="space-y-4">
      <h2 className="font-display text-xl text-slate-900">
        {t('organizer.tournaments.settings.matchFormat')}
      </h2>

      <NumberField
        label={t('organizer.tournaments.settings.pointCap')}
        value={data.pointCap}
        onChange={(v) => setData({ ...data, pointCap: v })}
        min={1}
        max={50}
      />

      <SelectField
        label={t('organizer.tournaments.settings.timerMode')}
        value={data.timerMode}
        onChange={(v) => setData({ ...data, timerMode: v as 'countdown' | 'countup' })}
        options={[
          { value: 'countdown', label: t('organizer.tournaments.settings.timerCountdown') },
          { value: 'countup', label: t('organizer.tournaments.settings.timerCountup') },
        ]}
      />

      <NumberField
        label={t('organizer.tournaments.settings.timePool')}
        value={data.timeLimitsSeconds.pool ?? 0}
        onChange={(v) =>
          setData({ ...data, timeLimitsSeconds: { ...data.timeLimitsSeconds, pool: v } })
        }
        min={0}
        max={3600}
        suffix="s"
      />
      <NumberField
        label={t('organizer.tournaments.settings.timeBracket')}
        value={data.timeLimitsSeconds.bracket ?? 0}
        onChange={(v) =>
          setData({ ...data, timeLimitsSeconds: { ...data.timeLimitsSeconds, bracket: v } })
        }
        min={0}
        max={3600}
        suffix="s"
      />
      <NumberField
        label={t('organizer.tournaments.settings.timeFinals')}
        value={data.timeLimitsSeconds.finals ?? 0}
        onChange={(v) =>
          setData({ ...data, timeLimitsSeconds: { ...data.timeLimitsSeconds, finals: v } })
        }
        min={0}
        max={3600}
        suffix="s"
      />

      <NumberField
        label={t('organizer.tournaments.settings.softClock')}
        value={data.softClockLimitSeconds}
        onChange={(v) => setData({ ...data, softClockLimitSeconds: v })}
        min={0}
        max={600}
        suffix="s"
      />

      <NumberField
        label={t('organizer.tournaments.settings.maxDoubleHits')}
        value={data.maxDoubleHits ?? 0}
        onChange={(v) => setData({ ...data, maxDoubleHits: v })}
        min={0}
        max={20}
      />

      {isTfV1 && (
        <SelectField
          label={t('organizer.tournaments.settings.afterblowMode')}
          value={data.afterblowMode}
          onChange={(v) => setData({ ...data, afterblowMode: v as 'full' | 'deductive' })}
          options={[
            { value: 'full', label: t('organizer.tournaments.settings.afterblowFull') },
            { value: 'deductive', label: t('organizer.tournaments.settings.afterblowDeductive') },
          ]}
        />
      )}

      <SelectField
        label={t('organizer.tournaments.settings.scoringDirection')}
        value={data.scoringDirection}
        onChange={(v) =>
          setData({ ...data, scoringDirection: v as MatchFormat['scoringDirection'] })
        }
        options={[
          { value: 'normal', label: t('organizer.tournaments.settings.scoringNormal') },
          {
            value: 'reverse_zero_loses',
            label: t('organizer.tournaments.settings.scoringReverse'),
          },
        ]}
      />

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
      >
        {saving ? t('common.saving') : t('organizer.tournaments.settings.save')}
      </button>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-32 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        {suffix && <span className="text-xs text-slate-500">{suffix}</span>}
      </div>
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web-admin typecheck`
Expected: clean.

- [ ] **Step 3: Manual verify**

Save a value (e.g., change `pointCap` from 5 to 7). Reload the page — value persists. Check that the BasicsTab values weren't wiped (deep-merge sanity).

- [ ] **Step 4: Commit**

```bash
git add apps/web-admin/app/org
git commit -m "feat(web-admin): Settings MatchFormatTab"
```

---

## Task 12: DisplayTab — side colors, scoring buttons (clean + afterblow)

Lift the existing scoring-config Display section verbatim — extract into the tab component.

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/[tournamentId]/settings/_components/DisplayTab.tsx`

- [ ] **Step 1: Implement DisplayTab**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { t } from '@myclash/i18n';
import { useToast } from '@myclash/ui';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface CleanButton {
  label: string;
  value: number;
  visible: boolean;
}
interface AfterblowButton {
  label: string;
  attackerPts: number;
  defenderPts: number;
  visible: boolean;
}
interface DisplayState {
  sideColors: { red: string; blue: string };
  buttons: { clean: CleanButton[]; afterblow: AfterblowButton[] };
}

const DEFAULTS: DisplayState = {
  sideColors: { red: 'red', blue: 'blue' },
  buttons: {
    clean: [{ label: 'Point', value: 1, visible: true }],
    afterblow: [{ label: 'Afterblow', attackerPts: 1, defenderPts: 1, visible: true }],
  },
};

const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'black', 'white'];

export function DisplayTab({ tournamentId }: { tournamentId: string }) {
  const toast = useToast();
  const [data, setData] = useState<DisplayState>(DEFAULTS);
  const [rulesetCode, setRulesetCode] = useState<string>('TF_v1');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((row) => {
        if (!row) return;
        setRulesetCode(row.ruleset_code);
        const sc = (row.scoring_config ?? {}) as Partial<DisplayState>;
        setData({
          sideColors: sc.display?.sideColors ?? DEFAULTS.sideColors,
          buttons: {
            clean: sc.buttons?.clean ?? DEFAULTS.buttons.clean,
            afterblow: sc.buttons?.afterblow ?? DEFAULTS.buttons.afterblow,
          },
        });
      });
  }, [tournamentId]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scoringConfig: {
            display: { sideColors: data.sideColors },
            buttons: data.buttons,
          },
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      toast.success(t('organizer.tournaments.settings.saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="font-display text-xl text-slate-900">
        {t('organizer.tournaments.settings.display')}
      </h2>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-slate-600">
          {t('organizer.tournaments.settings.sideColors')}
        </legend>
        <div className="flex gap-3">
          {(['red', 'blue'] as const).map((side) => (
            <label key={side} className="flex-1">
              <span className="block text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                {side}
              </span>
              <select
                value={data.sideColors[side]}
                onChange={(e) =>
                  setData({ ...data, sideColors: { ...data.sideColors, [side]: e.target.value } })
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {COLORS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-slate-600">
          {t('organizer.tournaments.settings.cleanButtons')}
        </legend>
        {data.buttons.clean.map((btn, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input
              value={btn.label}
              onChange={(e) =>
                setData({
                  ...data,
                  buttons: {
                    ...data.buttons,
                    clean: data.buttons.clean.map((b, j) =>
                      j === i ? { ...b, label: e.target.value } : b,
                    ),
                  },
                })
              }
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="Label"
            />
            <input
              type="number"
              value={btn.value}
              onChange={(e) =>
                setData({
                  ...data,
                  buttons: {
                    ...data.buttons,
                    clean: data.buttons.clean.map((b, j) =>
                      j === i ? { ...b, value: Number(e.target.value) } : b,
                    ),
                  },
                })
              }
              className="w-20 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="checkbox"
              checked={btn.visible}
              onChange={(e) =>
                setData({
                  ...data,
                  buttons: {
                    ...data.buttons,
                    clean: data.buttons.clean.map((b, j) =>
                      j === i ? { ...b, visible: e.target.checked } : b,
                    ),
                  },
                })
              }
            />
            <button
              type="button"
              onClick={() =>
                setData({
                  ...data,
                  buttons: { ...data.buttons, clean: data.buttons.clean.filter((_, j) => j !== i) },
                })
              }
              className="text-xs text-red-700 hover:underline"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setData({
              ...data,
              buttons: {
                ...data.buttons,
                clean: [...data.buttons.clean, { label: '', value: 1, visible: true }],
              },
            })
          }
          className="text-xs text-slate-700 hover:underline"
        >
          + Add clean button
        </button>
      </fieldset>

      {rulesetCode === 'TF_v1' && (
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-slate-600">
            {t('organizer.tournaments.settings.afterblowButtons')}
          </legend>
          {data.buttons.afterblow.map((btn, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                value={btn.label}
                onChange={(e) =>
                  setData({
                    ...data,
                    buttons: {
                      ...data.buttons,
                      afterblow: data.buttons.afterblow.map((b, j) =>
                        j === i ? { ...b, label: e.target.value } : b,
                      ),
                    },
                  })
                }
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="Label"
              />
              <input
                type="number"
                value={btn.attackerPts}
                onChange={(e) =>
                  setData({
                    ...data,
                    buttons: {
                      ...data.buttons,
                      afterblow: data.buttons.afterblow.map((b, j) =>
                        j === i ? { ...b, attackerPts: Number(e.target.value) } : b,
                      ),
                    },
                  })
                }
                className="w-16 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="number"
                value={btn.defenderPts}
                onChange={(e) =>
                  setData({
                    ...data,
                    buttons: {
                      ...data.buttons,
                      afterblow: data.buttons.afterblow.map((b, j) =>
                        j === i ? { ...b, defenderPts: Number(e.target.value) } : b,
                      ),
                    },
                  })
                }
                className="w-16 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="checkbox"
                checked={btn.visible}
                onChange={(e) =>
                  setData({
                    ...data,
                    buttons: {
                      ...data.buttons,
                      afterblow: data.buttons.afterblow.map((b, j) =>
                        j === i ? { ...b, visible: e.target.checked } : b,
                      ),
                    },
                  })
                }
              />
              <button
                type="button"
                onClick={() =>
                  setData({
                    ...data,
                    buttons: {
                      ...data.buttons,
                      afterblow: data.buttons.afterblow.filter((_, j) => j !== i),
                    },
                  })
                }
                className="text-xs text-red-700 hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setData({
                ...data,
                buttons: {
                  ...data.buttons,
                  afterblow: [
                    ...data.buttons.afterblow,
                    { label: '', attackerPts: 1, defenderPts: 1, visible: true },
                  ],
                },
              })
            }
            className="text-xs text-slate-700 hover:underline"
          >
            + Add afterblow button
          </button>
        </fieldset>
      )}

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
      >
        {saving ? t('common.saving') : t('organizer.tournaments.settings.save')}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web-admin typecheck`
Expected: clean.

- [ ] **Step 3: Manual verify**

Update a side color and save. Reload — value persists. Verify MatchFormat values weren't wiped.

- [ ] **Step 4: Commit**

```bash
git add apps/web-admin/app/org
git commit -m "feat(web-admin): Settings DisplayTab"
```

---

## Task 13: AdvancedTab — TF_v1 ruleset internals + lockConfig

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/[tournamentId]/settings/_components/AdvancedTab.tsx`

- [ ] **Step 1: Implement AdvancedTab**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { t } from '@myclash/i18n';
import { useToast } from '@myclash/ui';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface RulesetConfigTF {
  winBonus: number;
  afterblowWindowMs: number;
  targetValues: { deepTarget: number; shallowTarget: number };
  forfeitPolicy: {
    forfeitDrawsCount: boolean;
    forfeitFighterBefore1stMatch: boolean;
    disqualifyAfter: number;
  };
}
interface LockConfig {
  autoLockEnabled: boolean;
  autoLockDelayMinutes: number;
  autoLockCompletedPools: boolean;
  autoLockCompletedBrackets: boolean;
}

const TF_DEFAULTS: RulesetConfigTF = {
  winBonus: 3,
  afterblowWindowMs: 1000,
  targetValues: { deepTarget: 2, shallowTarget: 1 },
  forfeitPolicy: {
    forfeitDrawsCount: false,
    forfeitFighterBefore1stMatch: false,
    disqualifyAfter: 2,
  },
};
const LOCK_DEFAULTS: LockConfig = {
  autoLockEnabled: false,
  autoLockDelayMinutes: 30,
  autoLockCompletedPools: false,
  autoLockCompletedBrackets: false,
};

export function AdvancedTab({ tournamentId }: { tournamentId: string }) {
  const toast = useToast();
  const [rulesetCode, setRulesetCode] = useState<string>('TF_v1');
  const [tf, setTf] = useState<RulesetConfigTF>(TF_DEFAULTS);
  const [lock, setLock] = useState<LockConfig>(LOCK_DEFAULTS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((row) => {
        if (!row) return;
        setRulesetCode(row.ruleset_code);
        const rc = (row.ruleset_config ?? {}) as Partial<RulesetConfigTF>;
        setTf({
          winBonus: rc.winBonus ?? TF_DEFAULTS.winBonus,
          afterblowWindowMs: rc.afterblowWindowMs ?? TF_DEFAULTS.afterblowWindowMs,
          targetValues: { ...TF_DEFAULTS.targetValues, ...(rc.targetValues ?? {}) },
          forfeitPolicy: { ...TF_DEFAULTS.forfeitPolicy, ...(rc.forfeitPolicy ?? {}) },
        });
        const lc = (row.lock_config ?? {}) as Partial<LockConfig>;
        setLock({
          autoLockEnabled: lc.autoLockEnabled ?? LOCK_DEFAULTS.autoLockEnabled,
          autoLockDelayMinutes: lc.autoLockDelayMinutes ?? LOCK_DEFAULTS.autoLockDelayMinutes,
          autoLockCompletedPools: lc.autoLockCompletedPools ?? LOCK_DEFAULTS.autoLockCompletedPools,
          autoLockCompletedBrackets:
            lc.autoLockCompletedBrackets ?? LOCK_DEFAULTS.autoLockCompletedBrackets,
        });
      });
  }, [tournamentId]);

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { lockConfig: lock };
      if (rulesetCode === 'TF_v1') body['rulesetConfig'] = tf;
      const res = await fetch(`${apiUrl}/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Save failed');
      toast.success(t('organizer.tournaments.settings.saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="font-display text-xl text-slate-900">
        {t('organizer.tournaments.settings.advanced')}
      </h2>

      {rulesetCode === 'TF_v1' && (
        <fieldset className="space-y-3 rounded-md border border-slate-200 p-4">
          <legend className="px-2 text-xs font-medium text-slate-600">
            TF_v1 ruleset internals
          </legend>
          <NumField
            label="Win bonus"
            value={tf.winBonus}
            onChange={(v) => setTf({ ...tf, winBonus: v })}
            min={0}
            max={20}
          />
          <NumField
            label="Afterblow window (ms)"
            value={tf.afterblowWindowMs}
            onChange={(v) => setTf({ ...tf, afterblowWindowMs: v })}
            min={0}
            max={10000}
          />
          <NumField
            label="Deep target points"
            value={tf.targetValues.deepTarget}
            onChange={(v) => setTf({ ...tf, targetValues: { ...tf.targetValues, deepTarget: v } })}
            min={0}
            max={20}
          />
          <NumField
            label="Shallow target points"
            value={tf.targetValues.shallowTarget}
            onChange={(v) =>
              setTf({ ...tf, targetValues: { ...tf.targetValues, shallowTarget: v } })
            }
            min={0}
            max={20}
          />
          <BoolField
            label="Forfeit counts as draw"
            value={tf.forfeitPolicy.forfeitDrawsCount}
            onChange={(v) =>
              setTf({ ...tf, forfeitPolicy: { ...tf.forfeitPolicy, forfeitDrawsCount: v } })
            }
          />
          <BoolField
            label="Forfeit before 1st match → auto-DQ"
            value={tf.forfeitPolicy.forfeitFighterBefore1stMatch}
            onChange={(v) =>
              setTf({
                ...tf,
                forfeitPolicy: { ...tf.forfeitPolicy, forfeitFighterBefore1stMatch: v },
              })
            }
          />
          <NumField
            label="Disqualify after N forfeits"
            value={tf.forfeitPolicy.disqualifyAfter}
            onChange={(v) =>
              setTf({ ...tf, forfeitPolicy: { ...tf.forfeitPolicy, disqualifyAfter: v } })
            }
            min={1}
            max={10}
          />
        </fieldset>
      )}

      <fieldset className="space-y-3 rounded-md border border-slate-200 p-4">
        <legend className="px-2 text-xs font-medium text-slate-600">Auto-lock</legend>
        <BoolField
          label="Auto-lock enabled"
          value={lock.autoLockEnabled}
          onChange={(v) => setLock({ ...lock, autoLockEnabled: v })}
        />
        <NumField
          label="Auto-lock delay (minutes)"
          value={lock.autoLockDelayMinutes}
          onChange={(v) => setLock({ ...lock, autoLockDelayMinutes: v })}
          min={0}
          max={1440}
        />
        <BoolField
          label="Auto-lock completed pools"
          value={lock.autoLockCompletedPools}
          onChange={(v) => setLock({ ...lock, autoLockCompletedPools: v })}
        />
        <BoolField
          label="Auto-lock completed brackets"
          value={lock.autoLockCompletedBrackets}
          onChange={(v) => setLock({ ...lock, autoLockCompletedBrackets: v })}
        />
      </fieldset>

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
      >
        {saving ? t('common.saving') : t('organizer.tournaments.settings.save')}
      </button>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-700">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
      />
    </label>
  );
}

function BoolField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-700">{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web-admin typecheck`
Expected: clean.

- [ ] **Step 3: Manual verify**

Change `winBonus` from 3 to 5 and save. Reload. Verify pointCap (MatchFormat) and buttons (Display) weren't wiped.

- [ ] **Step 4: Commit**

```bash
git add apps/web-admin/app/org
git commit -m "feat(web-admin): Settings AdvancedTab (TF_v1 internals + auto-lock)"
```

---

# Phase 4 — Create wizard

## Task 14: Wizard shell — step indicator, navigation, draft persistence

**Files:**

- Create: `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/new/_wizard/WizardShell.tsx`
- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/new/page.tsx` (replace with thin wrapper)

- [ ] **Step 1: Implement the shell**

```tsx
// _wizard/WizardShell.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminPageHeader, useToast } from '@myclash/ui';
import { t } from '@myclash/i18n';
import { Step1Basics } from './Step1Basics';
import { Step2MatchFormat } from './Step2MatchFormat';
import { Step3Display } from './Step3Display';
import { Step4Advanced } from './Step4Advanced';

type Step = 1 | 2 | 3 | 4;

const STEPS: Array<{ n: Step; key: string }> = [
  { n: 1, key: 'organizer.tournaments.wizard.basics' },
  { n: 2, key: 'organizer.tournaments.wizard.matchFormat' },
  { n: 3, key: 'organizer.tournaments.wizard.display' },
  { n: 4, key: 'organizer.tournaments.wizard.advanced' },
];

interface Props {
  slug: string;
  eventId: string;
  initialTournamentId: string | null;
  initialStep: Step;
}

export function WizardShell({ slug, eventId, initialTournamentId, initialStep }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [tournamentId, setTournamentId] = useState<string | null>(initialTournamentId);
  const [step, setStep] = useState<Step>(initialStep);

  function goNext() {
    if (step < 4) setStep((step + 1) as Step);
  }
  function goBack() {
    if (step > 1) setStep((step - 1) as Step);
  }
  function finish(publish: boolean) {
    if (publish && tournamentId) {
      void fetch(`${process.env['NEXT_PUBLIC_API_URL']}/api/v1/tournaments/${tournamentId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'published' }),
      });
    }
    toast.success(t('organizer.tournaments.wizard.finishedToast'));
    router.push(`/org/${slug}/events/${eventId}/tournaments`);
  }

  return (
    <main id="main-content" className="mx-auto w-full max-w-3xl px-6 py-12 lg:px-8">
      <AdminPageHeader
        eyebrow={t('organizer.tournaments.wizard.eyebrow')}
        title={t('organizer.tournaments.wizard.title')}
      />

      <ol className="flex items-center gap-2 mt-6 mb-8 text-xs font-medium">
        {STEPS.map((s) => (
          <li
            key={s.n}
            className={[
              'flex items-center gap-1 px-3 py-1.5 rounded-full',
              s.n === step
                ? 'bg-red-800 text-white'
                : s.n < step
                  ? 'bg-slate-200 text-slate-700 cursor-pointer'
                  : 'bg-slate-100 text-slate-400',
            ].join(' ')}
            onClick={() => s.n < step && setStep(s.n)}
          >
            <span>
              {s.n}/{STEPS.length}
            </span>
            <span>{t(s.key)}</span>
          </li>
        ))}
      </ol>

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        {step === 1 && (
          <Step1Basics
            eventId={eventId}
            initialTournamentId={tournamentId}
            onCreated={(id) => {
              setTournamentId(id);
              goNext();
            }}
          />
        )}
        {step === 2 && tournamentId && (
          <Step2MatchFormat tournamentId={tournamentId} onNext={goNext} onBack={goBack} />
        )}
        {step === 3 && tournamentId && (
          <Step3Display tournamentId={tournamentId} onNext={goNext} onBack={goBack} />
        )}
        {step === 4 && tournamentId && (
          <Step4Advanced tournamentId={tournamentId} onBack={goBack} onFinish={finish} />
        )}
      </div>

      <button
        type="button"
        onClick={() => router.push(`/org/${slug}/events/${eventId}/tournaments`)}
        className="mt-4 text-xs text-slate-500 hover:text-slate-700"
      >
        {t('actions.cancel')}
      </button>
    </main>
  );
}
```

- [ ] **Step 2: Replace the create page with a thin wrapper**

```tsx
// new/page.tsx
'use client';

import { useSearchParams, useParams } from 'next/navigation';
import { WizardShell } from './_wizard/WizardShell';

export default function NewTournamentPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const searchParams = useSearchParams();
  const draftId = searchParams.get('id');
  const stepParam = searchParams.get('step');
  const step = (stepParam ? Math.min(4, Math.max(1, parseInt(stepParam, 10))) : 1) as 1 | 2 | 3 | 4;

  return (
    <WizardShell
      slug={params.slug}
      eventId={params.eventId}
      initialTournamentId={draftId}
      initialStep={step}
    />
  );
}
```

- [ ] **Step 3: Stub the step components**

Create `Step1Basics.tsx`, `Step2MatchFormat.tsx`, `Step3Display.tsx`, `Step4Advanced.tsx` each with a placeholder body that calls the expected callbacks. Example for Step1:

```tsx
// Step1Basics.tsx
'use client';
export function Step1Basics({
  eventId,
  initialTournamentId,
  onCreated,
}: {
  eventId: string;
  initialTournamentId: string | null;
  onCreated: (id: string) => void;
}) {
  return (
    <div>
      <p className="text-sm text-slate-500">Step 1 — Basics (stub)</p>
      <button
        onClick={() => onCreated('stub-id')}
        className="mt-2 rounded bg-red-800 text-white px-3 py-1 text-sm"
      >
        Next
      </button>
    </div>
  );
}
```

Same shape for the other three stubs, each calling its own onNext/onBack/onFinish callback.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web-admin typecheck`
Expected: clean.

- [ ] **Step 5: Manual verify**

Visit `/.../tournaments/new`. The wizard shell renders with a step indicator showing `1/4 Basics`. Clicking through the stubs advances steps and the indicator updates.

- [ ] **Step 6: Commit**

```bash
git add apps/web-admin/app/org
git commit -m "feat(web-admin): tournament wizard shell with step indicator"
```

---

## Task 15: Wizard Step 1 — Basics (POST creates the draft)

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/new/_wizard/Step1Basics.tsx`

- [ ] **Step 1: Implement Step1Basics**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { t } from '@myclash/i18n';
import { useToast } from '@myclash/ui';

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

interface Ruleset {
  code: string;
  version: string;
  label: string;
}
interface PenaltyRuleset {
  id: string;
  name: string;
}

function slugify(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export function Step1Basics({
  eventId,
  initialTournamentId,
  onCreated,
}: {
  eventId: string;
  initialTournamentId: string | null;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [weapon, setWeapon] = useState('');
  const [category, setCategory] = useState('');
  const [rulesetCode, setRulesetCode] = useState('TF_v1');
  const [rulesetVersion, setRulesetVersion] = useState('1');
  const [penaltyRulesetId, setPenaltyRulesetId] = useState<string>('');
  const [rulesets, setRulesets] = useState<Ruleset[]>([]);
  const [penaltyRulesets, setPenaltyRulesets] = useState<PenaltyRuleset[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void Promise.all([
      fetch(`${apiUrl}/api/v1/rulesets`, { credentials: 'include' }).then((r) => r.json()),
      fetch(`${apiUrl}/api/v1/penalty-rulesets`, { credentials: 'include' }).then((r) =>
        r.ok ? r.json() : [],
      ),
    ]).then(([r, p]) => {
      setRulesets(r);
      setPenaltyRulesets(p);
    });

    if (initialTournamentId) {
      fetch(`${apiUrl}/api/v1/tournaments/${initialTournamentId}`, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .then((row) => {
          if (!row) return;
          setName(row.name);
          setSlug(row.slug);
          setWeapon(row.weapon ?? '');
          setCategory(row.category ?? '');
          setRulesetCode(row.ruleset_code);
          setRulesetVersion(row.ruleset_version);
          setPenaltyRulesetId(row.penalty_ruleset_id ?? '');
        });
    }
  }, [initialTournamentId]);

  async function submit() {
    if (!name.trim()) {
      toast.error(t('organizer.tournaments.wizard.nameRequired'));
      return;
    }
    setSubmitting(true);
    try {
      if (initialTournamentId) {
        await fetch(`${apiUrl}/api/v1/tournaments/${initialTournamentId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            weapon: weapon || null,
            category: category || null,
            rulesetCode,
            rulesetVersion,
            penaltyRulesetId: penaltyRulesetId || null,
          }),
        });
        onCreated(initialTournamentId);
      } else {
        const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            slug: slug || slugify(name),
            weapon: weapon || undefined,
            category: category || undefined,
            rulesetCode,
            rulesetVersion,
            penaltyRulesetId: penaltyRulesetId || undefined,
          }),
        });
        if (!res.ok) throw new Error('Create failed');
        const created = await res.json();
        const newUrl = `${window.location.pathname}?id=${created.id}&step=2`;
        window.history.replaceState(null, '', newUrl);
        onCreated(created.id);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="font-display text-xl text-slate-900">
        {t('organizer.tournaments.wizard.basics')}
      </h2>

      <label className="block">
        <span className="block text-xs font-medium text-slate-600 mb-1">
          {t('organizer.tournaments.wizard.name')}
        </span>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!initialTournamentId) setSlug(slugify(e.target.value));
          }}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-slate-600 mb-1">
          {t('organizer.tournaments.wizard.slug')}
        </span>
        <input
          value={slug}
          onChange={(e) => setSlug(slugify(e.target.value))}
          disabled={!!initialTournamentId}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono disabled:bg-slate-50"
        />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-slate-600 mb-1">
          {t('organizer.tournaments.wizard.weapon')}
        </span>
        <input
          value={weapon}
          onChange={(e) => setWeapon(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-slate-600 mb-1">
          {t('organizer.tournaments.wizard.category')}
        </span>
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-slate-600 mb-1">
          {t('organizer.tournaments.wizard.ruleset')}
        </span>
        <select
          value={`${rulesetCode}:${rulesetVersion}`}
          onChange={(e) => {
            const [c, v] = e.target.value.split(':');
            setRulesetCode(c!);
            setRulesetVersion(v!);
          }}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {rulesets.map((r) => (
            <option key={`${r.code}:${r.version}`} value={`${r.code}:${r.version}`}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-slate-600 mb-1">
          {t('organizer.tournaments.wizard.penaltyRuleset')}
        </span>
        <select
          value={penaltyRulesetId}
          onChange={(e) => setPenaltyRulesetId(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">{t('common.none')}</option>
          {penaltyRulesets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting || !name.trim()}
          className="rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
        >
          {t('actions.next')}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web-admin typecheck`
Expected: clean.

- [ ] **Step 3: Manual verify**

Visit `/.../tournaments/new`. Fill name, click Next. URL changes to `?id=<new>&step=2`. Refresh — page reloads at step 2 with the draft loaded.

- [ ] **Step 4: Commit**

```bash
git add apps/web-admin/app/org
git commit -m "feat(web-admin): wizard Step 1 (Basics) — POST creates draft tournament"
```

---

## Task 16: Wizard Step 2 — Match Format (PATCH)

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/new/_wizard/Step2MatchFormat.tsx`

- [ ] **Step 1: Implement Step2MatchFormat**

Re-use the body of `MatchFormatTab` from Task 11 with these differences:

- Component name is `Step2MatchFormat`.
- Props are `{ tournamentId: string; onNext: () => void; onBack: () => void }`.
- After successful save, call `onNext()` instead of just showing a toast.
- Add a `Back` button next to the primary action that calls `onBack()`.

Specifically replace the JSX footer:

```tsx
<div className="flex justify-between">
  <button
    type="button"
    onClick={onBack}
    className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
  >
    {t('actions.back')}
  </button>
  <button
    type="button"
    onClick={async () => {
      await save();
      onNext();
    }}
    disabled={saving}
    className="rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
  >
    {saving ? t('common.saving') : t('actions.next')}
  </button>
</div>
```

(Where `save()` is the same as MatchFormatTab's — PATCH `scoringConfig` and toast on error.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web-admin typecheck`
Expected: clean.

- [ ] **Step 3: Manual verify**

Walk Step 1 → Step 2. Edit pointCap and click Next. URL step param becomes 3. Refresh — wizard reopens at step 3.

- [ ] **Step 4: Commit**

```bash
git add apps/web-admin/app/org
git commit -m "feat(web-admin): wizard Step 2 (Match Format)"
```

---

## Task 17: Wizard Step 3 — Display

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/new/_wizard/Step3Display.tsx`

- [ ] **Step 1: Implement Step3Display**

Mirror Task 16's pattern: copy the body of `DisplayTab` (Task 12) into `Step3Display`. Props are `{ tournamentId: string; onNext: () => void; onBack: () => void }`. Replace the single Save button with Back + Next (Next calls `await save(); onNext()`).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web-admin typecheck`
Expected: clean.

- [ ] **Step 3: Manual verify**

Walk through to Step 3. Change a button label and click Next. URL step param = 4. Refresh — page lands on step 4. Verify Match Format values (pointCap) weren't wiped.

- [ ] **Step 4: Commit**

```bash
git add apps/web-admin/app/org
git commit -m "feat(web-admin): wizard Step 3 (Display)"
```

---

## Task 18: Wizard Step 4 — Advanced + finish

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/new/_wizard/Step4Advanced.tsx`

- [ ] **Step 1: Implement Step4Advanced**

Mirror Task 16's pattern: copy the body of `AdvancedTab` (Task 13). Props are `{ tournamentId: string; onBack: () => void; onFinish: (publish: boolean) => void }`. Footer:

```tsx
<div className="flex items-center gap-3 justify-between">
  <button
    type="button"
    onClick={onBack}
    className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
  >
    {t('actions.back')}
  </button>
  <label className="flex items-center gap-2 text-xs text-slate-600">
    <input
      type="checkbox"
      checked={publishOnFinish}
      onChange={(e) => setPublishOnFinish(e.target.checked)}
    />
    {t('organizer.tournaments.wizard.publishOnFinish')}
  </label>
  <button
    type="button"
    onClick={async () => {
      await save();
      onFinish(publishOnFinish);
    }}
    disabled={saving}
    className="rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:opacity-50"
  >
    {saving ? t('common.saving') : t('organizer.tournaments.wizard.finish')}
  </button>
</div>
```

Add a `const [publishOnFinish, setPublishOnFinish] = useState(false);` near the top.

Also add a "Use defaults and finish" shortcut at the top:

```tsx
<div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
  <button
    type="button"
    onClick={async () => {
      onFinish(false);
    }}
    className="font-medium text-amber-900 hover:underline"
  >
    {t('organizer.tournaments.wizard.useDefaultsAndFinish')} →
  </button>
</div>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web-admin typecheck`
Expected: clean.

- [ ] **Step 3: Manual verify**

Walk the full wizard. At step 4, click Finish — toast confirms, page redirects to the tournaments list, the new tournament appears in `draft` status (or `published` if the checkbox was ticked).

- [ ] **Step 4: Commit**

```bash
git add apps/web-admin/app/org
git commit -m "feat(web-admin): wizard Step 4 (Advanced) + finish"
```

---

# Phase 5 — Discoverability

## Task 19: Tournaments list — Settings link + Resume setup for drafts

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/page.tsx`

- [ ] **Step 1: Add the Settings + Resume setup affordances**

Open `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/page.tsx`. In the row actions section (currently around lines 270-400), add the imports at the top:

```tsx
import Link from 'next/link';
import { computeWizardStep } from '../new/_wizard/compute-wizard-step';
```

Then in the row-actions JSX (find the existing per-row action buttons block — likely around the row map), add — note we use `row` as the row variable name to avoid colliding with the `t` i18n function; rename if the existing code already uses a different name like `tournament`:

```tsx
// Inside the .map((row) => ...) for each tournament row:
<Link
  href={`/org/${slug}/events/${eventId}/tournaments/${row.id}/settings#basics`}
  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
>
  {t('organizer.tournaments.settings.action')}
</Link>;

{
  (() => {
    if (row.status !== 'draft') return null;
    const wizardStep = computeWizardStep({
      id: row.id,
      name: row.name,
      slug: row.slug,
      ruleset_code: row.ruleset_code,
      ruleset_version: row.ruleset_version,
      scoring_config: row.scoring_config,
      ruleset_config: row.ruleset_config,
      lock_config: row.lock_config,
      status: row.status,
    });
    if (wizardStep === null) return null;
    return (
      <>
        <Link
          href={`/org/${slug}/events/${eventId}/tournaments/new?id=${row.id}&step=${wizardStep}`}
          className="rounded-md bg-red-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-900"
        >
          {t('organizer.tournaments.list.resumeSetup')}
        </Link>
        <span className="text-xs text-slate-400">Draft — step {wizardStep} of 4</span>
      </>
    );
  })();
}
```

If the existing row map uses a different variable name (e.g., `t`, `tour`, `tournament`), pick a non-`t` name for the row so the i18n function `t(...)` isn't shadowed. The plan assumes `row`; rename consistently throughout the row map if you rename the binding.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web-admin typecheck`
Expected: clean.

- [ ] **Step 3: Manual verify**

In the tournaments list, drafts now have a Resume setup button that deep-links into the wizard at the right step. Non-draft tournaments show only the Settings link.

- [ ] **Step 4: Commit**

```bash
git add apps/web-admin/app/org
git commit -m "feat(web-admin): tournaments list — Settings + Resume setup affordances"
```

---

## Task 20: Edit modal trim + Open settings banner

**Files:**

- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/page.tsx:402-461`

- [ ] **Step 1: Trim the modal to name + status only**

Inside the existing edit modal (`apps/web-admin/app/org/[slug]/events/[eventId]/tournaments/page.tsx:402-461`):

- REMOVE the `weapon` and `category` inputs.
- Keep `name` and `status` only.
- The save handler (`saveEdit()`) already PATCHes only the fields in its body; ensure it sends only `{ name, status }`.

Add a banner just above the modal's action buttons:

```tsx
<div className="my-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
  {t('organizer.tournaments.editModal.openSettingsHint')}{' '}
  <Link
    href={`/org/${slug}/events/${eventId}/tournaments/${editing.id}/settings#basics`}
    className="font-semibold underline"
    onClick={() => setEditing(null)}
  >
    {t('organizer.tournaments.editModal.openSettingsLink')} →
  </Link>
</div>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web-admin typecheck`
Expected: clean.

- [ ] **Step 3: Manual verify**

Open the edit modal on a tournament. Only name + status visible. The Open settings link closes the modal and navigates to Settings.

- [ ] **Step 4: Commit**

```bash
git add apps/web-admin/app/org
git commit -m "refactor(web-admin): trim edit modal to name+status; add Open settings banner"
```

---

# Phase 6 — i18n + final verification

## Task 21: Add EN + FR i18n keys

**Files:**

- Modify: `packages/i18n/src/index.ts`

- [ ] **Step 1: Add the EN keys under organizer.tournaments**

In `packages/i18n/src/index.ts`, locate the English `organizer.tournaments` block (around line 1566-1602). Append two new sub-objects just before the closing brace of `tournaments`:

```ts
wizard: {
  eyebrow: 'New tournament',
  title: 'Create a tournament',
  basics: 'Basics',
  matchFormat: 'Match format',
  display: 'Display',
  advanced: 'Advanced',
  name: 'Name',
  slug: 'URL slug',
  weapon: 'Weapon',
  category: 'Category',
  ruleset: 'Ruleset',
  penaltyRuleset: 'Penalty ruleset',
  nameRequired: 'Name is required.',
  pointCap: 'Point cap',
  timerMode: 'Timer mode',
  timeLimits: 'Time limits',
  publishOnFinish: 'Publish on finish',
  finish: 'Finish',
  useDefaultsAndFinish: 'Use defaults and finish',
  finishedToast: 'Tournament saved.',
},
settings: {
  title: 'Tournament settings',
  subtitle: 'Configure rules, timer, display, and advanced behavior.',
  action: 'Settings',
  basics: 'Basics',
  matchFormat: 'Match format',
  display: 'Display',
  advanced: 'Advanced',
  name: 'Name',
  slug: 'URL slug',
  slugLocked: 'The slug is locked after creation.',
  weapon: 'Weapon',
  category: 'Category',
  ruleset: 'Ruleset',
  penaltyRuleset: 'Penalty ruleset',
  pointCap: 'Point cap',
  timerMode: 'Timer mode',
  timerCountdown: 'Countdown',
  timerCountup: 'Count up',
  timePool: 'Pool match time',
  timeBracket: 'Bracket match time',
  timeFinals: 'Finals match time',
  softClock: 'Soft clock',
  maxDoubleHits: 'Max double hits',
  afterblowMode: 'Afterblow mode',
  afterblowFull: 'Full',
  afterblowDeductive: 'Deductive',
  scoringDirection: 'Scoring direction',
  scoringNormal: 'Normal',
  scoringReverse: 'Reverse (zero loses)',
  sideColors: 'Fighter side colors',
  cleanButtons: 'Clean-hit buttons',
  afterblowButtons: 'Afterblow buttons',
  save: 'Save changes',
  saved: 'Saved.',
},
list: {
  resumeSetup: 'Resume setup',
},
editModal: {
  openSettingsHint: 'Looking for timer, fighter colors, or advanced rules?',
  openSettingsLink: 'Open settings',
},
```

- [ ] **Step 2: Add the FR keys**

Locate the French `organizer.tournaments` block (around line 3749-3887). Add the same three sub-objects with French translations. Sample translations:

```ts
wizard: {
  eyebrow: 'Nouveau tournoi',
  title: 'Creer un tournoi',
  basics: 'Bases',
  matchFormat: 'Format des matchs',
  display: 'Affichage',
  advanced: 'Avance',
  name: 'Nom',
  slug: 'Slug URL',
  weapon: 'Arme',
  category: 'Categorie',
  ruleset: 'Reglement',
  penaltyRuleset: 'Reglement de penalites',
  nameRequired: 'Le nom est obligatoire.',
  pointCap: 'Plafond de points',
  timerMode: 'Mode chronometre',
  timeLimits: 'Limites de temps',
  publishOnFinish: 'Publier a la fin',
  finish: 'Terminer',
  useDefaultsAndFinish: 'Utiliser les defauts et terminer',
  finishedToast: 'Tournoi enregistre.',
},
settings: {
  title: 'Parametres du tournoi',
  subtitle: 'Configurez les regles, le chronometre, l\'affichage et le comportement avance.',
  action: 'Parametres',
  basics: 'Bases',
  matchFormat: 'Format des matchs',
  display: 'Affichage',
  advanced: 'Avance',
  name: 'Nom',
  slug: 'Slug URL',
  slugLocked: 'Le slug est verrouille apres la creation.',
  weapon: 'Arme',
  category: 'Categorie',
  ruleset: 'Reglement',
  penaltyRuleset: 'Reglement de penalites',
  pointCap: 'Plafond de points',
  timerMode: 'Mode chronometre',
  timerCountdown: 'Decompte',
  timerCountup: 'Croissant',
  timePool: 'Duree des poules',
  timeBracket: 'Duree des brackets',
  timeFinals: 'Duree des finales',
  softClock: 'Horloge souple',
  maxDoubleHits: 'Doubles maximum',
  afterblowMode: 'Mode contre-frappe',
  afterblowFull: 'Complet',
  afterblowDeductive: 'Deductif',
  scoringDirection: 'Direction du score',
  scoringNormal: 'Normal',
  scoringReverse: 'Inverse (zero perd)',
  sideColors: 'Couleurs des cotes',
  cleanButtons: 'Boutons coups nets',
  afterblowButtons: 'Boutons contre-frappes',
  save: 'Enregistrer',
  saved: 'Enregistre.',
},
list: {
  resumeSetup: 'Reprendre la configuration',
},
editModal: {
  openSettingsHint: 'Vous cherchez le chronometre, les couleurs ou les regles avancees ?',
  openSettingsLink: 'Ouvrir les parametres',
},
```

- [ ] **Step 3: Build the i18n package**

Run: `pnpm --filter @myclash/i18n build`
Expected: clean.

- [ ] **Step 4: Typecheck the workspace**

Run: `pnpm -r typecheck`
Expected: clean across all packages.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/src/index.ts
git commit -m "i18n: tournament wizard + settings keys (EN + FR)"
```

---

## Task 22: Final verification

End-to-end check before declaring done.

- [ ] **Step 1: Run the full backend test suite**

Run: `pnpm --filter api test`
Expected: all tests pass (existing + new deep-merge + ruleset-switch + GET /rulesets cases).

- [ ] **Step 2: Run web-admin tests**

Run: `pnpm --filter web-admin test`
Expected: all tests pass (existing + new compute-wizard-step cases).

- [ ] **Step 3: Full workspace typecheck**

Run: `pnpm -r typecheck`
Expected: clean.

- [ ] **Step 4: Manual smoke — create flow**

Visit `/org/<slug>/events/<eventId>/tournaments/new`. Walk the 4-step wizard:

1. Step 1: Fill name + ruleset, click Next. URL changes to `?id=<new>&step=2`. Tournament appears in DB with `status: 'draft'`.
2. Refresh the page mid-wizard. Returns to step 2 with the draft loaded.
3. Step 2: Edit pointCap, click Next.
4. Step 3: Edit side colors, click Next.
5. Step 4: Tick "Publish on finish", click Finish.
6. Redirects to tournaments list. New tournament is `published`.

- [ ] **Step 5: Manual smoke — edit flow**

From the tournaments list, click Settings on the new tournament:

1. Lands on `/.../settings#basics` with the left rail visible.
2. Click each tab in turn — each shows the correct values from the create flow.
3. Edit one field per tab and click Save Changes. Reload — values persist.
4. Verify that saving Display did NOT wipe Match Format values, and that saving Advanced did NOT wipe Display.

- [ ] **Step 6: Manual smoke — Resume setup**

Create another tournament. Walk to step 2 then close the tab without completing. From the tournaments list, the draft has a Resume setup button. Click it — wizard reopens at step 2 with the draft loaded.

- [ ] **Step 7: Manual smoke — legacy URL redirect**

Visit any old `/scoring-config` URL (e.g., manually navigate to `/org/<slug>/events/<eventId>/tournaments/<tournamentId>/scoring-config`). Browser 308-redirects to `/settings#match-format`.

- [ ] **Step 8: Manual smoke — ruleset switch**

From an existing TF_v1 tournament, change ruleset to `Generic_PointsCap` in the Basics tab and save. Refresh. The ruleset config defaults to Generic's defaults; the previous TF_v1-specific `winBonus` etc. are gone. (The Advanced tab will not show TF_v1 fields when the ruleset is Generic.)

- [ ] **Step 9: Commit any final cleanup**

If any test failures or smoke issues surfaced fixes, commit them:

```bash
git add .
git commit -m "fix(tournament-config): smoke-test fixes"
```

- [ ] **Step 10: Done.**
