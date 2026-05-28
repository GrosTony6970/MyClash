# Inline "Create new club" on add-participant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an organizer create an unknown club inline while adding a participant — one form submission creates both rows. Mirrors the existing CSV-import auto-create-unverified-club pattern.

**Architecture:** Single round-trip. `CreatePersonDto` gains an optional `newClubName` field (mutually exclusive with `clubId`). `PersonsService.createPerson` branches at the top: when `newClubName` is set and `clubId` isn't, resolves-or-creates the club via a new CSV-agnostic helper extracted from the existing `resolveOrCreateClub`, then proceeds. Frontend club combobox appends a synthetic `+ Create new club "X" (unverified)` row when no case-insensitive match exists.

**Tech Stack:** NestJS + Fastify + class-validator (api), Next.js 16 + React + Tailwind (web-admin), Vitest (both sides), Supabase service-role for DB writes.

**Spec:** [`docs/superpowers/specs/2026-05-28-inline-club-create-on-add-participant-design.md`](../specs/2026-05-28-inline-club-create-on-add-participant-design.md)

---

## File structure

| File                                                                                          | Action     | Responsibility                                                                                                                        |
| --------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/persons/persons.service.ts`                                             | Modify     | Extract `resolveOrCreateClubByName` (pure name→id, no CSV report). Add `newClubName` branch at top of `createPerson`.                 |
| `apps/api/src/modules/persons/dto/persons.dto.ts`                                             | Modify     | Add `newClubName?: string` to `CreatePersonDto` with non-empty + xor-with-`clubId` validators.                                        |
| `apps/api/src/modules/persons/dto/persons.dto.test.ts`                                        | **Create** | DTO validation tests — mirror `events/dto/events.dto.test.ts`.                                                                        |
| `apps/api/src/modules/persons/persons.service.test.ts`                                        | Modify     | New describe block: `createPerson — newClubName branch`.                                                                              |
| `apps/web-admin/app/org/[slug]/events/[eventId]/persons/_components/club-picker-rows.ts`      | **Create** | Pure helper computing dropdown rows from typed text + suggestions. Returns `{kind: 'existing', club} \| {kind: 'create', name}` rows. |
| `apps/web-admin/app/org/[slug]/events/[eventId]/persons/_components/club-picker-rows.test.ts` | **Create** | Unit tests for the helper. Matches the established pure-logic web-admin testing style.                                                |
| `apps/web-admin/app/org/[slug]/events/[eventId]/persons/page.tsx`                             | Modify     | Use the new helper to render rows. Track `newClubName` form state. Send it in the POST body.                                          |

Each task below ships its own commit. The three test-first slices map 1-to-1 to the spec's "Test plan" section.

---

## Task 1: Service supports `newClubName`

**Files:**

- Modify: `apps/api/src/modules/persons/persons.service.ts`
- Modify: `apps/api/src/modules/persons/persons.service.test.ts`

The existing private `resolveOrCreateClub(clubName, clubAbv, clubCity, report)` is bound to the CSV-import flow (its last param mutates a `CsvImportReport`). Extract a CSV-agnostic core that takes only a name and returns `Promise<string | null>`. The CSV wrapper keeps its report side-effect by calling the new core. Then add a branch at the top of `createPerson` that resolves `newClubName` into `clubId` before the existing logic runs.

### Step 1.1: Write the failing test

- [ ] Open `apps/api/src/modules/persons/persons.service.test.ts`. Append at the bottom (after the last existing `describe`):

```ts
describe('PersonsService.createPerson — newClubName branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a new unverified club and links the participant when newClubName is set', async () => {
    const { supabase, queueResult, insertCaptures } = makeSupabase();
    // 1) email uniqueness check → no match
    queueResult('persons', { data: null, error: null });
    // 2) find_club_by_name RPC (called from the new resolveOrCreateClubByName)
    //    returns no match → fallthrough to insert
    //    NB: rpc() returns the chain too; makeChain treats the trailing .limit
    //    awaitable as the result.
    // 3) clubs insert → returns the new club id
    queueResult('clubs', { data: { id: 'club-new' }, error: null });
    // 4) global_persons matcher inserts a fresh row (no HEMA, no DOB)
    queueResult('global_persons', { data: { id: 'gp-new' }, error: null });
    // 5) persons insert → returns the row
    queueResult('persons', {
      data: { id: 'p-1', global_person_id: 'gp-new', club_id: 'club-new', clubs: null },
      error: null,
    });

    // Mock the RPC path used by resolveOrCreateClubByName.
    (supabase.service as unknown as { rpc: typeof vi.fn }).rpc = vi.fn(() => ({
      limit: vi.fn().mockResolvedValue({ data: null, error: null }),
    }));

    const service = new PersonsService(
      supabase as never,
      { maskEmail: () => '' } as never,
      {} as never,
    );

    await service.createPerson(
      'event-1',
      { ...baseDto, newClubName: 'Lyon AMHE' } as never,
      'actor-1',
    );

    // Club insert payload
    expect(insertCaptures['clubs']).toHaveLength(1);
    expect(insertCaptures['clubs']![0]).toMatchObject({
      name: 'Lyon AMHE',
      unverified: 'true',
    });
    // Person insert links to the new club id
    expect(insertCaptures['persons']).toHaveLength(1);
    expect(insertCaptures['persons']![0]).toMatchObject({ club_id: 'club-new' });
  });

  it('ignores newClubName when clubId is already provided (defensive)', async () => {
    // The DTO layer guards against both being set, but PersonsService should
    // still behave correctly if a future caller passes both: clubId wins.
    const { supabase, queueResult, insertCaptures } = makeSupabase();
    queueResult('persons', { data: null, error: null }); // email uniq
    queueResult('global_persons', { data: { id: 'gp-new' }, error: null });
    queueResult('persons', {
      data: { id: 'p-1', global_person_id: 'gp-new', club_id: 'club-existing', clubs: null },
      error: null,
    });

    const service = new PersonsService(
      supabase as never,
      { maskEmail: () => '' } as never,
      {} as never,
    );

    await service.createPerson(
      'event-1',
      { ...baseDto, clubId: 'club-existing', newClubName: 'Should be ignored' } as never,
      'actor-1',
    );

    // No clubs insert fired
    expect(insertCaptures['clubs']).toBeUndefined();
    // Person linked to the existing club
    expect(insertCaptures['persons']![0]).toMatchObject({ club_id: 'club-existing' });
  });
});
```

### Step 1.2: Run the tests to verify they fail

- [ ] Run:

```bash
pnpm -F @myclash/api test -- --run persons.service.test
```

Expected: both new tests **FAIL** because today's `createPerson` ignores `newClubName` (no `clubs` insert is fired, the `insertCaptures['clubs']` assertion blows up).

### Step 1.3: Extract `resolveOrCreateClubByName` from the existing CSV helper

- [ ] Open `apps/api/src/modules/persons/persons.service.ts`. Find the existing private `resolveOrCreateClub` (around line 611). Replace it with this pair of methods (CSV-agnostic core + CSV-side wrapper):

```ts
/**
 * Resolve a free-text club name to an existing club id, or create a
 * new unverified club row. Used by both:
 *   - CSV import (via the `resolveOrCreateClub` wrapper below, which
 *     also pushes the new club name into the import report).
 *   - The single-participant add flow (when an organizer types a
 *     club name that doesn't match any existing club and accepts the
 *     "+ Create new club" dropdown row).
 *
 * The lookup uses the `find_club_by_name` Postgres RPC (trigram +
 * unaccent) with threshold 0.4 — same as the CSV path. Returns null
 * only on a DB-level insert failure; callers may decide to surface
 * that as a 400 or just skip the club link.
 */
private async resolveOrCreateClubByName(name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const { data: matches } = await this.supabase.service
    .rpc('find_club_by_name', { search_name: trimmed, threshold: 0.4 })
    .limit(1);

  const first = (matches as Array<{ id: string; name: string; confidence: string }> | null)?.[0];
  if (first) return first.id;

  const slug = trimmed
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

  const uniqueSlug = `${slug}-${Date.now().toString(36)}`;

  const { data: newClub, error } = await this.supabase.service
    .from('clubs')
    .insert({
      name: trimmed,
      slug: uniqueSlug,
      abbreviation: null,
      city: null,
      unverified: 'true',
    })
    .select('id')
    .single();

  if (error) {
    this.logger.warn(`Could not create club "${trimmed}": ${error.message}`);
    return null;
  }

  return (newClub as { id: string }).id;
}

/** CSV-flavoured wrapper: resolves a club name and also records it for the import report. */
private async resolveOrCreateClub(
  clubName: string | undefined,
  clubAbv: string | undefined,
  clubCity: string | undefined,
  report: CsvImportReport,
): Promise<string | null> {
  const searchTerm = clubAbv ?? clubName ?? '';

  const { data: matches } = await this.supabase.service
    .rpc('find_club_by_name', { search_name: searchTerm, threshold: 0.4 })
    .limit(1);

  const first = (matches as Array<{ id: string; name: string; confidence: string }> | null)?.[0];
  if (first) return first.id;

  if (clubAbv && clubName) {
    const { data: nameMatches } = await this.supabase.service
      .rpc('find_club_by_name', { search_name: clubName, threshold: 0.4 })
      .limit(1);
    const nameFirst = (nameMatches as Array<{ id: string }> | null)?.[0];
    if (nameFirst) return nameFirst.id;
  }

  const name = clubName ?? clubAbv ?? '';
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

  const uniqueSlug = `${slug}-${Date.now().toString(36)}`;

  const { data: newClub, error } = await this.supabase.service
    .from('clubs')
    .insert({
      name,
      slug: uniqueSlug,
      abbreviation: clubAbv?.toUpperCase() ?? null,
      city: clubCity ?? null,
      unverified: 'true',
    })
    .select('id')
    .single();

  if (error) {
    this.logger.warn(`Could not create club "${name}": ${error.message}`);
    return null;
  }

  if (!report.newClubsForReview.includes(name)) {
    report.newClubsForReview.push(name);
  }

  return (newClub as { id: string }).id;
}
```

The CSV wrapper keeps the abbreviation fallback (CSV rows have both `club` and `club_abv` columns) and the report side-effect. The new helper is the minimal name→id path for the organizer-side single-add flow.

### Step 1.4: Wire `newClubName` into `createPerson`

- [ ] In the same file, locate `createPerson` (around line 98). Insert this branch immediately after the function signature and before the email-uniqueness check (i.e. between current line 102 and 103):

```ts
async createPerson(
  eventId: string,
  dto: CreatePersonDto,
  createdByUserId: string,
): Promise<Person> {
  // Inline "Create new club" support. When the organizer accepted the
  // "+ Create new club X" dropdown row in the add-participant modal,
  // the client sends `newClubName` instead of `clubId`. Resolve it to
  // a real id (creating an unverified club if needed) before the rest
  // of the flow runs. clubId wins if both are set — DTO validation
  // rejects that combination, but the service is defensive.
  let resolvedClubId = dto.clubId ?? null;
  if (!resolvedClubId && dto.newClubName) {
    resolvedClubId = await this.resolveOrCreateClubByName(dto.newClubName);
  }

  const email = dto.email ? dto.email.toLowerCase().trim() : null;
  // … rest of the existing function unchanged …
```

- [ ] Then thread `resolvedClubId` through the rest of the function. Replace **every** remaining occurrence of `dto.clubId` inside `createPerson` with `resolvedClubId`. There are two:
  - In the `resolveOrCreateGlobalPerson` payload (currently `clubId: dto.clubId ?? null`).
  - In the `persons` insert payload (currently `club_id: dto.clubId ?? null`).

Final form of those two spots:

```ts
const globalPersonId =
  dto.globalPersonId ??
  (await this.resolveOrCreateGlobalPerson({
    givenName: dto.givenName,
    familyName: dto.familyName,
    clubId: resolvedClubId,
    hemaRatingsId: dto.hemaRatingsId ?? null,
    dateOfBirth: dto.dateOfBirth ?? null,
    genderCategory: dto.genderCategory ?? null,
  }));

const { data, error } = await this.supabase.service
  .from('persons')
  .insert({
    event_id: eventId,
    given_name: dto.givenName.trim(),
    family_name: dto.familyName.trim(),
    email,
    club_id: resolvedClubId,
    hema_ratings_id: dto.hemaRatingsId ?? null,
    // … rest of the insert payload unchanged …
```

### Step 1.5: Run the tests to verify they pass

- [ ] Run:

```bash
pnpm -F @myclash/api test -- --run persons.service.test
```

Expected: both new tests **PASS**. Existing tests in the file still pass (the refactor of `resolveOrCreateClub` preserves its signature and CSV behavior).

### Step 1.6: Typecheck

- [ ] Run:

```bash
pnpm -F @myclash/api typecheck
```

Expected: clean (no errors). DTO doesn't yet declare `newClubName` — slice 1 references it via `{ ... } as never` casts in the tests, so the service-side code still compiles.

### Step 1.7: Commit

- [ ] Run:

```bash
git add apps/api/src/modules/persons/persons.service.ts apps/api/src/modules/persons/persons.service.test.ts
git commit -m "feat(api): support newClubName on createPerson via extracted helper

Extracts a CSV-agnostic resolveOrCreateClubByName(name) from the
existing CSV-import-flavoured resolveOrCreateClub, and branches
createPerson at the top: when newClubName is set and clubId isn't,
resolve it to a club id (creating an unverified row if missing)
before the rest of the flow runs.

Tests lock the happy path (new club inserted with unverified=true,
person linked to it) and the defensive clubId-wins fallback.

DTO field declaration ships in the next commit; this slice is the
service-layer change only."
```

---

## Task 2: DTO `newClubName` field + xor invariant

**Files:**

- Modify: `apps/api/src/modules/persons/dto/persons.dto.ts`
- Create: `apps/api/src/modules/persons/dto/persons.dto.test.ts`

### Step 2.1: Write the failing tests

- [ ] Create `apps/api/src/modules/persons/dto/persons.dto.test.ts` with:

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreatePersonDto } from './persons.dto';

/**
 * Locks the "newClubName" invariants for the add-participant flow:
 *   - the field is optional and accepts a non-empty trimmed string;
 *   - it is mutually exclusive with `clubId` (sending both → 400);
 *   - whitespace-only values are rejected.
 *
 * The class-level validator enforces both rules so a malformed
 * payload is rejected at the ValidationPipe boundary, before it
 * reaches PersonsService.createPerson.
 */
describe('CreatePersonDto — newClubName', () => {
  const base = { givenName: 'Jean', familyName: 'Dupont' };

  it('accepts a valid newClubName when clubId is absent', async () => {
    const dto = plainToInstance(CreatePersonDto, { ...base, newClubName: 'Lyon AMHE' });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toEqual([]);
  });

  it('accepts neither newClubName nor clubId', async () => {
    const dto = plainToInstance(CreatePersonDto, base);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toEqual([]);
  });

  it('rejects sending both clubId and newClubName', async () => {
    const dto = plainToInstance(CreatePersonDto, {
      ...base,
      clubId: '00000000-0000-0000-0000-000000000001',
      newClubName: 'Lyon AMHE',
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(errors)).toMatch(
      /clubId.*newClubName|newClubName.*clubId|mutually exclusive/i,
    );
  });

  it('rejects a whitespace-only newClubName', async () => {
    const dto = plainToInstance(CreatePersonDto, { ...base, newClubName: '   ' });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.length).toBeGreaterThan(0);
  });
});
```

### Step 2.2: Run the tests to verify they fail

- [ ] Run:

```bash
pnpm -F @myclash/api test -- --run persons.dto.test
```

Expected: first test **FAILS** with `forbidNonWhitelisted` rejecting the unknown `newClubName` property; the xor and whitespace tests also fail because no rule rejects them yet.

### Step 2.3: Add the field + validators

- [ ] Open `apps/api/src/modules/persons/dto/persons.dto.ts`. Add imports for `Validate`, `ValidatorConstraint`, `ValidatorConstraintInterface`, and `ValidationArguments` from `class-validator` at the top:

```ts
import {
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  type ValidationArguments,
} from 'class-validator';
```

- [ ] Add a class-level validator constraint **above** `CreatePersonDto`:

```ts
@ValidatorConstraint({ name: 'ClubIdOrNewClubName', async: false })
class ClubIdOrNewClubNameConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const obj = args.object as { clubId?: string; newClubName?: string };
    const hasId = typeof obj.clubId === 'string' && obj.clubId.length > 0;
    const hasName = typeof obj.newClubName === 'string';
    if (hasId && hasName) return false;
    if (hasName && obj.newClubName!.trim().length === 0) return false;
    return true;
  }
  defaultMessage(): string {
    return 'clubId and newClubName are mutually exclusive, and newClubName must be a non-empty trimmed string';
  }
}
```

- [ ] Inside `CreatePersonDto`, add the field declaration immediately after `clubId` (around line 34):

```ts
@ApiProperty({
  required: false,
  description:
    'Auto-create a new club with this name (unverified=true) and attach the participant to it. ' +
    'Mutually exclusive with clubId. Trims to a non-empty value.',
})
@IsOptional()
@IsString()
@MaxLength(200)
@Validate(ClubIdOrNewClubNameConstraint)
newClubName?: string;
```

The `@Validate` decorator on a single property is enough to make class-validator run the constraint with the whole object available via `args.object`.

### Step 2.4: Run the tests to verify they pass

- [ ] Run:

```bash
pnpm -F @myclash/api test -- --run persons.dto.test
```

Expected: all four tests **PASS**.

- [ ] Run the persons.service tests again to confirm slice 1 still works now that the DTO declares the field:

```bash
pnpm -F @myclash/api test -- --run persons.service.test
```

Expected: still green.

### Step 2.5: Typecheck

- [ ] Run:

```bash
pnpm -F @myclash/api typecheck
```

Expected: clean.

### Step 2.6: Commit

- [ ] Run:

```bash
git add apps/api/src/modules/persons/dto/persons.dto.ts apps/api/src/modules/persons/dto/persons.dto.test.ts
git commit -m "feat(api): add newClubName to CreatePersonDto with xor + non-empty guards

newClubName joins clubId on CreatePersonDto as a mutually exclusive
alternative. A class-level ValidatorConstraint enforces:
- sending both clubId and newClubName → validation error;
- whitespace-only newClubName → validation error.

Lock the invariants with a new persons.dto.test.ts (mirrors the
events.dto.test.ts pattern: plainToInstance + validate with
whitelist + forbidNonWhitelisted)."
```

---

## Task 3: Frontend — `+ Create new club` row in the add-participant combobox

**Files:**

- Create: `apps/web-admin/app/org/[slug]/events/[eventId]/persons/_components/club-picker-rows.ts`
- Create: `apps/web-admin/app/org/[slug]/events/[eventId]/persons/_components/club-picker-rows.test.ts`
- Modify: `apps/web-admin/app/org/[slug]/events/[eventId]/persons/page.tsx`

Web-admin uses pure-logic unit tests (see `pools/_tabs/match-scores-merge.test.ts`, `tournaments/new/_wizard/compute-wizard-step.test.ts`). The plan follows that convention: extract the "given typed text + suggestions, compute dropdown rows" decision into a pure helper, test it, then wire it into the JSX.

### Step 3.1: Write the failing tests for the row-builder helper

- [ ] Create `apps/web-admin/app/org/[slug]/events/[eventId]/persons/_components/club-picker-rows.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeClubPickerRows, type ClubSuggestion, type ClubPickerRow } from './club-picker-rows';

const lyon: ClubSuggestion = { id: 'c-lyon', name: 'Lyon AMHE', abbreviation: 'LYO' };
const paris: ClubSuggestion = { id: 'c-paris', name: 'Paris Fencing', abbreviation: 'PAR' };

describe('computeClubPickerRows', () => {
  it('returns an empty array when typed text is blank', () => {
    expect(computeClubPickerRows('', [lyon, paris])).toEqual([]);
    expect(computeClubPickerRows('   ', [lyon, paris])).toEqual([]);
  });

  it('returns matching existing-club rows when suggestions are non-empty', () => {
    const rows = computeClubPickerRows('Ly', [lyon, paris]);
    expect(rows).toEqual<ClubPickerRow[]>([
      { kind: 'existing', club: lyon },
      { kind: 'existing', club: paris },
    ]);
  });

  it('appends a create-row when the typed text has no case-insensitive exact match', () => {
    const rows = computeClubPickerRows('Bordeaux Sword Club', [lyon, paris]);
    expect(rows).toEqual<ClubPickerRow[]>([
      { kind: 'existing', club: lyon },
      { kind: 'existing', club: paris },
      { kind: 'create', name: 'Bordeaux Sword Club' },
    ]);
  });

  it('does NOT append a create-row when an existing club matches case-insensitively', () => {
    // Typo casing or trailing space should still match the existing club, not offer a duplicate.
    expect(computeClubPickerRows('lyon amhe', [lyon])).toEqual<ClubPickerRow[]>([
      { kind: 'existing', club: lyon },
    ]);
    expect(computeClubPickerRows('  LYON AMHE  ', [lyon])).toEqual<ClubPickerRow[]>([
      { kind: 'existing', club: lyon },
    ]);
  });

  it('offers a create-row even when there are zero suggestions', () => {
    expect(computeClubPickerRows('Brand New Club', [])).toEqual<ClubPickerRow[]>([
      { kind: 'create', name: 'Brand New Club' },
    ]);
  });

  it('preserves the user-typed casing in the create-row name (trims whitespace)', () => {
    expect(computeClubPickerRows('  Lyon AMHE 2  ', [lyon])).toEqual<ClubPickerRow[]>([
      { kind: 'existing', club: lyon },
      { kind: 'create', name: 'Lyon AMHE 2' },
    ]);
  });
});
```

### Step 3.2: Run the tests to verify they fail

- [ ] Run:

```bash
pnpm -F @myclash/web-admin test -- --run club-picker-rows
```

Expected: all six tests **FAIL** — the helper file doesn't exist yet.

### Step 3.3: Implement the helper

- [ ] Create `apps/web-admin/app/org/[slug]/events/[eventId]/persons/_components/club-picker-rows.ts`:

```ts
/**
 * Pure helper used by the add-participant club picker.
 *
 * Given the user's typed text and the current backend-filtered
 * suggestions, decide what rows to render in the dropdown:
 *   - the existing suggestions, in order; and
 *   - a synthetic "+ Create new club X" row when the typed text
 *     has no case-insensitive trimmed match among the suggestions.
 *
 * Returning `[]` for empty input is what lets the JSX hide the
 * dropdown entirely when the field is blank.
 *
 * Kept as a pure function so the testable decision lives outside
 * the React component — match-scores-merge.ts / compute-wizard-step.ts
 * are the established pattern in this app.
 */
export interface ClubSuggestion {
  id: string;
  name: string;
  abbreviation?: string | null;
}

export type ClubPickerRow =
  | { kind: 'existing'; club: ClubSuggestion }
  | { kind: 'create'; name: string };

export function computeClubPickerRows(
  typedText: string,
  suggestions: ReadonlyArray<ClubSuggestion>,
): ClubPickerRow[] {
  const trimmed = typedText.trim();
  if (!trimmed) return [];

  const existingRows: ClubPickerRow[] = suggestions.map((club) => ({ kind: 'existing', club }));

  const hasExactMatch = suggestions.some(
    (c) => c.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );

  if (hasExactMatch) return existingRows;
  return [...existingRows, { kind: 'create', name: trimmed }];
}
```

### Step 3.4: Run the tests to verify they pass

- [ ] Run:

```bash
pnpm -F @myclash/web-admin test -- --run club-picker-rows
```

Expected: all six tests **PASS**.

### Step 3.5: Wire the helper into `persons/page.tsx`

- [ ] Open `apps/web-admin/app/org/[slug]/events/[eventId]/persons/page.tsx`. Add the import near the top, alongside the existing local-component imports:

```ts
import {
  computeClubPickerRows,
  type ClubSuggestion as ClubPickerSuggestion,
} from './_components/club-picker-rows';
```

- [ ] Add a new piece of form state below the existing `selectedClubId` / `selectedClubLabel` declarations (search for `setSelectedClubLabel` in the file to find them; they live in the same `useState` cluster as `clubSearch`). Add:

```ts
const [newClubName, setNewClubName] = useState<string | null>(null);
```

- [ ] Replace the add-modal club picker block (currently lines 1203-1254 — the entire `<div>` containing `<label>Club</label>`) with the version below. This block:
  - keeps the existing `<input>` search field;
  - renders dropdown rows from `computeClubPickerRows`;
  - clicking an existing-row selects the club like before;
  - clicking a create-row stores the typed text in `newClubName` state, clears the suggestions, and shows a green chip;
  - the chip wording is "New club: X (will be created)";
  - the input clears `selectedClubId` AND `newClubName` whenever the user types again.

```tsx
<div>
  <label className="block text-xs font-medium text-gray-700 mb-1">Club</label>
  <input
    type="search"
    value={clubSearch}
    onChange={(e) => {
      setClubSearch(e.target.value);
      setSelectedClubId(null);
      setSelectedClubLabel('');
      setNewClubName(null);
    }}
    placeholder="Search by name or abbreviation, or type to create a new one…"
    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
  />
  {!selectedClubId &&
    !newClubName &&
    (() => {
      const rows = computeClubPickerRows(clubSearch, clubSuggestions as ClubPickerSuggestion[]);
      if (rows.length === 0) return null;
      return (
        <div className="border border-gray-200 rounded-lg mt-1 max-h-36 overflow-y-auto">
          {rows.map((row, idx) =>
            row.kind === 'existing' ? (
              <button
                key={`existing-${row.club.id}`}
                type="button"
                onClick={() => {
                  setSelectedClubId(row.club.id);
                  setSelectedClubLabel(row.club.name);
                  setClubSearch(row.club.name);
                  setClubSuggestions([]);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
              >
                <span className="font-medium">{row.club.name}</span>
                {row.club.abbreviation && (
                  <span className="text-gray-400 ml-2 text-xs">{row.club.abbreviation}</span>
                )}
              </button>
            ) : (
              <button
                key={`create-${idx}`}
                type="button"
                data-testid="new-club-create-row"
                onClick={() => {
                  setNewClubName(row.name);
                  setSelectedClubId(null);
                  setSelectedClubLabel('');
                  setClubSuggestions([]);
                }}
                className="w-full text-left px-3 py-2 text-sm text-red-700 hover:bg-red-50 border-b border-gray-100 last:border-0 font-medium"
              >
                + Create new club &quot;{row.name}&quot; (unverified)
              </button>
            ),
          )}
        </div>
      );
    })()}
  {selectedClubId && (
    <p className="text-xs text-green-700 mt-1">
      {selectedClubLabel}{' '}
      <button
        type="button"
        className="underline"
        onClick={() => {
          setSelectedClubId(null);
          setSelectedClubLabel('');
          setClubSearch('');
        }}
      >
        Clear
      </button>
    </p>
  )}
  {newClubName && (
    <p className="text-xs text-green-700 mt-1" data-testid="new-club-chip">
      New club: <span className="font-medium">{newClubName}</span> (will be created){' '}
      <button
        type="button"
        className="underline"
        onClick={() => {
          setNewClubName(null);
          setClubSearch('');
        }}
      >
        Clear
      </button>
    </p>
  )}
</div>
```

- [ ] Update the `handleAdd` submit body to send `newClubName` when the user opted into create. Replace the existing `body: JSON.stringify({ ... })` block (around line 342) with:

```ts
body: JSON.stringify({
  givenName: addForm.givenName.trim(),
  familyName: addForm.familyName.trim(),
  email: addForm.email.trim() || null,
  clubId: selectedClubId || null,
  newClubName: newClubName || null,
  hemaRatingsId,
  globalPersonId: selectedGlobalId || null,
}),
```

- [ ] At the end of `handleAdd` (right after the existing `setAddForm(EMPTY_ADD_FORM)` reset, around line 317 — or wherever the form clears on success), add the reset for the new state:

```ts
setNewClubName(null);
```

If the existing code path clears `selectedClubId`/`selectedClubLabel` on success, mirror that for `newClubName`.

### Step 3.6: Typecheck

- [ ] Run:

```bash
pnpm -F @myclash/web-admin typecheck
```

Expected: clean. If TS complains that `clubSuggestions` doesn't match `ClubPickerSuggestion` (because the page's local `ClubSuggestion` type may have stricter fields), narrow the cast to only `{ id, name, abbreviation }`. The cast in the snippet above (`clubSuggestions as ClubPickerSuggestion[]`) handles that.

### Step 3.7: Run the helper tests one more time

- [ ] Run:

```bash
pnpm -F @myclash/web-admin test -- --run club-picker-rows
```

Expected: still green.

### Step 3.8: Commit

- [ ] Run:

```bash
git add apps/web-admin/app/org/[slug]/events/[eventId]/persons/_components/club-picker-rows.ts apps/web-admin/app/org/[slug]/events/[eventId]/persons/_components/club-picker-rows.test.ts apps/web-admin/app/org/[slug]/events/[eventId]/persons/page.tsx
git commit -m "feat(web-admin): inline '+ Create new club' row in add-participant picker

When the organizer types a club name with no case-insensitive match
among existing suggestions, the dropdown appends a synthetic
'+ Create new club X (unverified)' row. Clicking it places a
'New club: X (will be created)' chip in the form. On submit the
body now sends newClubName alongside clubId; the server creates the
unverified club and links the participant in one request.

The row-building decision lives in a pure helper
(_components/club-picker-rows.ts) so the testable logic stays
outside the React component — same pattern as
pools/_tabs/match-scores-merge.ts."
```

---

## Task 4: End-to-end smoke (manual)

**Files:** none

The three unit slices cover the regression-locking surface. This task is the operator-side verification the spec calls out.

- [ ] Run the full api test suite to confirm no regression:

```bash
pnpm -F @myclash/api test
```

Expected: all tests pass.

- [ ] Boot the dev stack (or deploy to a staging environment) and exercise the flow:
  1. Log in as an org-admin.
  2. Navigate to `/org/test-org/events/<eventId>/persons`.
  3. Click "Add participant".
  4. Fill given name / family name.
  5. In the club field, type a name that doesn't exist (e.g. `Bordeaux Sword Club`).
  6. Confirm the dropdown shows `+ Create new club "Bordeaux Sword Club" (unverified)`.
  7. Click it. Confirm the chip `New club: Bordeaux Sword Club (will be created)` appears.
  8. Submit the form.
  9. Confirm the participant row appears with the new club name.
  10. Re-open the add modal, type `bordeaux` (lowercase): the dropdown shows the existing club row, NOT a create-row (case-insensitive dedup).
  11. Open the org's clubs admin page (`/org/test-org/events/<eventId>/clubs`): the new club is listed with the "unverified" badge.

- [ ] If anything in steps 1-11 doesn't behave as expected, file the discrepancy in this plan as a follow-up bullet rather than patching ad-hoc.

---

## Self-review (run by the planning author, not the implementer)

**Spec coverage check:**

- Goal "Create club + participant in one submit" → Tasks 1 + 3 cover the server branch and the UI trigger; Task 4 verifies the round-trip.
- Goal "Auto-created clubs marked `unverified='true'`" → Task 1 step 1.3 sets `unverified: 'true'` in the insert; Task 1 step 1.1 asserts it.
- Goal "No new endpoints / auth / schema" → only `persons.service.ts` and `persons.dto.ts` change on the api side. Confirmed.
- Non-goal "Edit-participant form" → not touched; the edit modal at `persons/page.tsx:1395-1445` is intentionally left alone.
- Non-goal "CSV import" → the CSV wrapper `resolveOrCreateClub` is preserved in step 1.3.
- Non-goal "Surfacing unverified status on participant card" → the page-level changes only touch the picker; no participant-row UI changes.

**Edge cases from the spec:**

- Case-insensitive duplicate match → covered by `computeClubPickerRows` test "does NOT append a create-row when an existing club matches case-insensitively" (Task 3.1).
- Race on simultaneous creates → relies on `find_club_by_name` RPC returning the existing row on the second writer's lookup; not a code path we add, but inherited from the existing CSV helper which already handles this in production.
- Whitespace-only `newClubName` → covered by DTO test (Task 2.1) and by `computeClubPickerRows`'s blank-input handling (Task 3.1).
- Both `clubId` and `newClubName` set → covered by DTO test (Task 2.1) AND a defensive service-level test (Task 1.1 second case).

**Placeholder scan:** every code block above is concrete. No TBDs, no "implement appropriate error handling", no orphan references.

**Type consistency:**

- `newClubName` is `string` (optional) everywhere — DTO field, service branch, helper input shape, page state (`string | null`).
- `ClubPickerRow` discriminant uses `kind: 'existing' | 'create'` consistently in helper, tests, and JSX.
- The CSV-side `resolveOrCreateClub` signature (`clubName, clubAbv, clubCity, report`) is preserved unchanged; only the body is split.

No issues found.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-inline-club-create-on-add-participant.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
