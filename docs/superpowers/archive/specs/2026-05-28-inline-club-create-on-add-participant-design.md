# Inline "Create new club" on add-participant

**Date:** 2026-05-28
**Status:** Approved
**Scope:** Single-participant add form on the admin events/persons page.

## Problem

When an organizer adds a participant to an event and types a club name that
doesn't exist in the club list, today they have to abandon the form,
navigate to the clubs admin, create the club, then come back and re-enter
the participant. The CSV import path solved the same problem long ago by
auto-creating unknown clubs with `unverified='true'`. The single-add flow
just never got the same affordance.

This spec brings that one-action UX to the single-participant add form, on
the same server pattern the CSV path already uses.

## Goals & non-goals

**Goals**

- An organizer typing a not-found club name sees an explicit
  "+ Create new club X" option in the dropdown, and selecting it creates
  the club and the participant in one submit.
- Auto-created clubs are marked `unverified='true'`, identical to CSV
  imports, so the existing super-admin "review unverified clubs" surface
  picks them up without any new UI.
- No new API endpoints, no new auth gates, no new database columns. The
  change reuses existing primitives.

**Non-goals**

- The edit-participant form. Corrections to an existing fighter's club
  stay deliberate ("pick from list") to avoid accidental new-club creation
  during clean-up sessions.
- The CSV import flow — already auto-creates.
- Surfacing the "unverified" badge on the participant row itself. The
  club tile already shows it where needed.
- Adding city / country / abbreviation at create time. The super-admin
  clubs review page is where those get filled in later.

## User flow

1. Organizer opens the "Add participant" modal on
   `/org/:slug/events/:eventId/persons`.
2. They type "Lyon AMHE" into the club search field.
3. The existing typeahead returns no matches.
4. The dropdown shows one synthetic row at the bottom:
   `+ Create new club "Lyon AMHE" (unverified)`.
5. Organizer clicks (or presses Enter on) that row.
6. The field collapses into a chip: `New club: Lyon AMHE`. The form's
   internal state tracks `newClubName="Lyon AMHE"` and `selectedClubId=null`.
7. Organizer fills in the rest of the participant fields and submits.
8. Server creates the club (`unverified='true'`) and the participant in
   one request. Modal closes. Participant list refreshes with the new
   fighter; subsequent typeahead lookups now include "Lyon AMHE" as a
   regular suggestion.

## Server contract

Extend `CreatePersonDto` with one optional field:

```ts
@ApiPropertyOptional({
  description:
    'Auto-create a club with this name (unverified) and attach the new participant to it. ' +
    'Mutually exclusive with clubId. Server enforces non-empty trimmed value.',
})
@IsOptional()
@IsString()
newClubName?: string;
```

DTO-level invariants (enforced in a class-level validator, mirroring the
existing patterns in this file):

- If both `clubId` and `newClubName` are set → 400.
- If `newClubName` is set and trims to an empty string → 400.

`PersonsService.create` adds one branch at the top: when `newClubName` is
present and `clubId` isn't, call the existing private
`resolveOrCreateClub(name)` helper (already used by CSV import — looks up
by normalized name, inserts with `unverified='true'` if missing,
idempotent on duplicate names), then proceed with the resolved id as if
the caller had passed `clubId` to begin with. Existing auth gates and
returned shape unchanged.

No new endpoints. No new RLS policies. No new env vars.

## Edge cases & how we handle them

- **Case-insensitive duplicate match.** If the typed text matches an
  existing club name when both are lowercased and trimmed, the dropdown
  shows the existing club as a normal suggestion and does NOT show the
  create-row. This prevents two "Lyon AMHE" / "lyon amhe" rows.
- **Race between two organizers creating the same club name.**
  `resolveOrCreateClub` looks up by normalized name before inserting, so
  the second writer reads the first writer's row and reuses its id. No
  duplicate rows.
- **Whitespace-only `newClubName`.** Rejected at DTO validation → 400.
- **Both `clubId` and `newClubName` set.** Rejected at DTO validation → 400. Client never sends this; the guard exists to lock the API
  contract for future callers.

## Test plan (vertical slices, RED-then-GREEN)

1. **`PersonsService.create` happy path** — vitest unit on the service.
   Given `{ newClubName: 'Lyon AMHE', … }`, mock the chained Supabase
   queries to assert:
   - A `clubs` insert fires with `name='Lyon AMHE'` and
     `unverified='true'`.
   - The subsequent `persons` insert references the resolved club id.
   - The returned payload has the new club attached.
   - RED: today's service ignores `newClubName` → club insert never
     fires.
2. **DTO xor invariant** — vitest on `CreatePersonDto` (or whatever
   harness `apps/api/src/modules/persons/dto/persons.dto.test.ts`
   already uses). Submitting `{ clubId, newClubName }` together fails
   class-validator. Submitting `newClubName: '   '` fails.
3. **Combobox UX** — frontend test on `persons/page.tsx`. With no
   matching suggestions, typing "Foo" reveals the `+ Create new club`
   row. Clicking it sets a `data-testid="new-club-chip"` element with
   "Foo" as its label and clears the search input. RED first against
   today's combobox (no create row).

Each slice ships in its own commit. The frontend test goes last because
it depends on the DTO + service slices being green.

## Risk & rollback

- **Risk:** an organizer accidentally creates a duplicate-but-misspelled
  club ("Lyon AMHE" vs "Lyon Amhe"). Mitigation: case-insensitive
  duplicate detection in the dropdown closes the typo path. Super-admin
  merge is the fallback for genuine duplicates that slip through.
- **Risk:** abuse — an organizer floods the clubs table by creating
  bogus rows. Mitigation: the same auth gate (organizer-admin on the
  path's org) already controls the participant flow, and the
  `unverified` flag makes the rows trivially findable for cleanup. No
  new exposure vs. the CSV path.
- **Rollback:** the DTO change is additive; the service branch is gated
  on `newClubName` being set, so removing the new path is a single
  revert. The frontend create-row can be feature-flagged behind a
  client-side const if needed during rollout.

## Critical files

- `apps/web-admin/app/org/[slug]/events/[eventId]/persons/page.tsx` —
  add-participant modal: club picker (lines 1203-1254 today) and
  submit handler (lines 329-416 today).
- `apps/api/src/modules/persons/dto/persons.dto.ts` — extend
  `CreatePersonDto` (lines 13-61 today).
- `apps/api/src/modules/persons/persons.service.ts` — `create()`
  method; reuse the existing private `resolveOrCreateClub()` helper.

The edit-participant modal at the same `persons/page.tsx` (lines
1395-1445 today) is explicitly **not** touched.

## References

- CSV import preview banner: `apps/web-admin/app/org/[slug]/events/[eventId]/persons/import/page.tsx`
  (lines 323-337) — existing "New clubs will be created (unverified)"
  UI pattern that the new flow mirrors conceptually.
- `clubs.unverified` schema: `packages/db/src/schema/fighters.ts:16`
  (the boolean-as-text column with the `'true'`/`'false'` convention).
- Super-admin review surface: `apps/web-admin/app/admin/clubs/page.tsx`.
