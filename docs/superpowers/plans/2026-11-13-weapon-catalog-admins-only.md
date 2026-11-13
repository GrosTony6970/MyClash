# Only super admins add catalog weapons (ruling 695) — plan

Rulings: 695 (admins only add catalog weapons), 702 (the list is the whole catalog), 703 (an
unknown CSV weapon is skipped; the Global Profiles preview names it). Session c427a0a1,
2026-11-13. No migration.

## What changes, in plain words

- **Paul edits his profile.** He ticks weapons from the list, as today. The page sends each weapon's
  id only. If the server gets an id that is not in the catalog, it refuses the whole save ("Pick a
  weapon from the list") and **Paul's weapons stay as they were**. A name is never accepted, so no
  profile save can create a weapon.
- **Hidden weapons stay on the list** (702). Hiding still keeps a weapon off Find, the ask form,
  tournaments and workshops.
- **A super admin imports Global Profiles.** Row 4 says `Longsword|Longsowrd`. The preview shows
  "Not on the weapon list: Longsowrd" on row 4. On commit, the person gets Longsword only. No weapon
  is created.
- **An organiser imports a roster.** Same skip, no message (organisers cannot add weapons).
- **Super admins add weapons** on the existing `/admin/weapons` page. Nothing changes there.

## Recon (what the code does today)

Every door that writes `weapon_catalog` (no web role may write it since 0247, so the API is the
only door):

| Door                                                                                            | Today                                                                              | After                                                               |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `fighters.service.ts` `resolveWeaponInput` (profile save, `PATCH me` → `replaceFighterWeapons`) | trusts any `weaponId`; a `weaponName` with no slug match INSERTS an **active** row | removed; ids checked against the catalog before anything is deleted |
| `weapon-import.util.ts` `resolveWeaponCatalogId` (both CSV imports)                             | INSERTS an **inactive** row per unknown name                                       | removed; read-only match, unknown skipped                           |
| `weapons-admin.service.ts` create/update/delete                                                 | super admin only                                                                   | unchanged — the one door left                                       |
| `fighters.service.ts` `seedDefaultWeapons`                                                      | upserts the default list; **no caller**                                            | named, not touched (dead code)                                      |

Readers stay as they are: Find, the ask form and the strict pickers read `active = true`
(`spar-requests.service.ts` `catalogWeapons`, `weapon-catalog.util.ts` `resolveCatalogWeapon`);
the profile page reads the whole catalog (`GET /api/v1/weapons`).

## Assumptions (say if wrong)

1. **The profile DTO drops `weaponName` and requires `weaponId`.** The page already sends the id
   of a ticked box; the name was only a fallback that created rows. A request still carrying
   `weaponName` is refused by the strict schema (400, a validation message rather than "Pick a
   weapon from the list"). Only a direct API call can send one.
2. **The page keeps its generic "could not save" on this refusal.** Through the page, an unknown id
   happens only in a race: a super admin DELETES a weapon while Léa has her profile open with it
   ticked. She sees "could not save", reloads, the weapon is gone from the list, and the save works.
   Rare; no new UI text.
3. **CSV matching is by name OR slug**, both trimmed and case-insensitive. Today it is by slug
   only, and an admin rename keeps the old slug (`weapons-admin.service.ts` update), so after
   "Longsword" → "Long Sword" a cell saying `Long Sword` would match nothing. Matching the name as
   well keeps a renamed weapon importable under both spellings.

## Tasks (built inline: three tasks)

### Task 1 — profile save accepts catalog ids only

- `dto/fighters.dto.ts`: `fighterWeaponInputSchema` → `weaponId: z.uuid()` (required), no
  `weaponName`. Keep the 20 cap.
- `fighters.service.ts`: delete `resolveWeaponInput`. In `replaceFighterWeapons`, before the
  delete: one read `weapon_catalog.select('id').in('id', ids)`; any id missing →
  `BadRequestException('Pick a weapon from the list')`, nothing deleted. Then delete + insert as
  today. An empty list still clears the weapons.
- `FighterProfileClient.tsx`: `selectedWeaponRows` stops sending `weaponName`.
- Regenerate the API client schema: `pnpm openapi:client`, then `pnpm quality:openapi-drift`
  green (`packages/api-client/src/generated/schema.ts` carries `weaponName` today).
- Tests in a NEW focused file `fighters.weapons.test.ts` (`fighters.service.test.ts` is already in
  the complexity baseline's large-file list and test files count toward the 400-line cap): (a) an unknown id → 400 and NO delete
  call; (b) known ids → delete then insert with those ids; (c) assert the select string `id` and
  the `.in('id', …)` filter values; (d) the DTO refuses `{ weaponName }` alone and refuses a
  missing `weaponId`; (e) no `insert` into `weapon_catalog` on any path.

### Task 2 — imports never create weapons; the preview names unknown ones

- `weapon-import.util.ts`:
  - `readWeaponCatalog(service)` → `{ id, name, slug }[]`, ONE read (the catalog is small and only
    super admins add to it; the PostgREST row cap is far above it).
  - pure `matchCatalogWeapon(catalog, name)` → id or null (name or slug, trimmed, lower-case). A
    name whose slug is empty (`!!!`) matches nothing (the old resolver skipped it too).
  - pure `unknownWeaponNames(catalog, cell)` → the parsed cell's names with no match, in cell order,
    after the 20 cap.
  - `replaceFighterWeaponsFromCell` reads the catalog once, keeps the matched entries, skips the
    rest; inserts nothing into `weapon_catalog`. A cell whose names all miss is a no-op (the
    existing weapons stay — same rule as a blank cell).
- `fighters.service.ts` `previewGlobalPersonsImport`: read the catalog once; each `ok` and
  `duplicate` row carries `unknownWeapons: string[]` (invalid rows `[]`). The catalog read is an
  add-on to the preview: if it fails, the preview still loads, every row carries `[]`, and the API
  logs a warning (the commit then skips unknown names as usual). On commit the catalog is read once
  per row by the shared util (as before, one read per name); accepted.
- web-admin `admin/global-persons/import/page.tsx`: the status cell adds
  `t('admin.globalPersonsImport.unknownWeapons', { names })` in warning colour when the list is not
  empty — "Not on the weapon list: {names}" / « Hors de la liste des armes : {names} ».
- Roster import (`persons.service.ts`): no change beyond the shared util.
- Comments that described the old behaviour: `weapon-catalog.util.ts:32-33`,
  `weapons-admin.service.ts` (slug "the stable key fighter imports resolve by").
- Tests: util — exact name, other case, slug-only match (renamed weapon), unknown skipped, all
  unknown = no delete, no `weapon_catalog` insert ever; preview — a row with one unknown name
  carries it, a fully known row carries `[]`, ONE catalog read for the whole file; page — the
  sentence renders on a row with `unknownWeapons`, not on one without.

### Task 3 — docs

- ARCHITECTURE: one paragraph where the fighter weapons are described (or §11septies.6 beside the
  20-weapon cap): only super admins add catalog weapons; fighters pick ids; imports skip unknown
  names (rulings 695, 702, 703).

## Changed in the build (cold review, session c427a0a1)

- The catalog check runs at the TOP of `updateMyProfile`, before the profile, clubs or medals are
  written (it ran inside `replaceFighterWeapons`, after the rest of the profile was saved). It also
  refuses an id given twice ("Pick each weapon once").
- CSV matching tries the name first, then the slug: one weapon's name beats another's old slug.
- The profile page's payload moved into `apps/web-public/src/lib/profile-weapons.ts`
  (`weaponsToSave`), pinned by a test, so a returning `weaponName` goes red.
- A cell that spells one weapon twice links it once.

## Named, not fixed

- `seedDefaultWeapons` has no caller (dead code).
- Delete-then-insert is not atomic: a weapon deleted between the check and the insert fails the
  insert AFTER the delete, and the fighter loses their weapons (pre-existing shape; the race needs a
  super-admin delete in the same instant).
- A CSV cell whose FIRST weapon is unknown saves the rest with no favourite (the favourite is the
  cell's first entry).

## Verification

Falsify: drop the catalog check (→ 400 test red); put the insert back in the util (→ no-insert test
red); drop the name match / the slug match (→ each match test red); drop `unknownWeapons` from the
preview (→ red); drop the page sentence (→ red). Then the 32 gates, push, CI.
