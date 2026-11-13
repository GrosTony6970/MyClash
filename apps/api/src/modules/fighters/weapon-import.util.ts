/**
 * Shared helper for importing a fighter's weapons from a CSV cell, used by
 * both the global-persons importer (fighters.service) and the event
 * participant importer (persons.service). Weapons live on global_persons via
 * fighter_weapons, so both import paths converge here once a global person is
 * resolved.
 *
 * Cell format (pipe-separated, first entry = favorite):
 *   "Longsword:intermediate|Rapier|Sabre:beginner"
 * The part after ':' is an optional skill level. Unknown levels are treated as
 * "no level" rather than failing the row.
 */

import { MAX_FIGHTER_WEAPONS } from './fighter-weapon-names';

export const WEAPON_LEVELS = ['just_for_fun', 'beginner', 'intermediate', 'advanced'] as const;
export type WeaponLevel = (typeof WEAPON_LEVELS)[number];

export interface ParsedImportWeapon {
  weaponName: string;
  level: WeaponLevel | null;
  favorite: boolean;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/** Parse a weapons CSV cell into structured entries (empty when blank). */
export function parseWeaponsCell(raw: string | null | undefined): ParsedImportWeapon[] {
  if (!raw) return [];
  const out: ParsedImportWeapon[] = [];
  raw
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .forEach((part, index) => {
      const [namePart, levelPart] = part.split(':').map((segment) => segment?.trim() ?? '');
      if (!namePart) return;
      const normalizedLevel = (levelPart ?? '').toLowerCase();
      const level = (WEAPON_LEVELS as readonly string[]).includes(normalizedLevel)
        ? (normalizedLevel as WeaponLevel)
        : null;
      out.push({ weaponName: namePart, level, favorite: index === 0 });
    });
  // The cell's order is the fighter's order: entries past the cap are dropped. The imports report
  // only rows that were not saved; a shortened cell still saves its row, so the extra entries are
  // dropped without a report.
  return out.slice(0, MAX_FIGHTER_WEAPONS);
}

/** The service client; `from` is `unknown` for the TS2589 reason in `weapon-catalog.util.ts`. */
export interface WeaponDbClient {
  from: (table: string) => unknown;
}

interface WeaponDbTable {
  select: (columns: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  insert: (rows: Record<string, unknown>[]) => PromiseLike<{ error: { message: string } | null }>;
  delete: () => { eq: (column: string, value: unknown) => PromiseLike<{ error: unknown }> };
}

const table = (service: WeaponDbClient, name: string) => service.from(name) as WeaponDbTable;

export interface CatalogWeaponRow {
  id: string;
  name: string;
  slug: string;
}

/**
 * The whole weapon catalog, hidden weapons included (ruling 702), in ONE read. It stays small:
 * only super admins add to it (ruling 695).
 */
export async function readWeaponCatalog(service: WeaponDbClient): Promise<CatalogWeaponRow[]> {
  const { data, error } = await table(service, 'weapon_catalog').select('id, name, slug');
  if (error) throw new Error(`weapon catalogue read failed: ${error.message}`);
  return (data ?? []) as CatalogWeaponRow[];
}

/**
 * The catalog weapon a CSV name means: its name first (case and outer spaces aside), then its
 * slug, which catches the old spelling of a renamed weapon (a rename keeps the slug). The name
 * wins when one weapon has the name and another the slug. Never creates one.
 */
export function matchCatalogWeapon(catalog: CatalogWeaponRow[], name: string): string | null {
  const wanted = name.trim().toLowerCase();
  const slug = slugify(name);
  if (!slug) return null;
  const hit =
    catalog.find((w) => w.name.trim().toLowerCase() === wanted) ??
    catalog.find((w) => w.slug === slug);
  return hit ? hit.id : null;
}

/** The cell's names that match no catalog weapon, in cell order (ruling 703's preview line). */
export function unknownWeaponNames(
  catalog: CatalogWeaponRow[],
  raw: string | null | undefined,
): string[] {
  return parseWeaponsCell(raw)
    .map((weapon) => weapon.weaponName)
    .filter((name) => matchCatalogWeapon(catalog, name) === null);
}

/**
 * Replace a global person's weapons from a CSV cell. A blank/empty cell is a
 * no-op (it does NOT wipe existing weapons) so importing a roster that omits
 * the column never destroys profile data. A name not in the catalog is skipped
 * (ruling 703): an import never creates a catalog weapon (ruling 695), and a
 * cell whose every name is skipped is a no-op too.
 */
export async function replaceFighterWeaponsFromCell(
  service: WeaponDbClient,
  globalPersonId: string,
  raw: string | null | undefined,
): Promise<void> {
  const weapons = parseWeaponsCell(raw);
  if (weapons.length === 0) return;

  const catalog = await readWeaponCatalog(service);
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const [index, weapon] of weapons.entries()) {
    const weaponId = matchCatalogWeapon(catalog, weapon.weaponName);
    // Two spellings of one weapon (its name and its old slug) would break the unique pair.
    if (!weaponId || seen.has(weaponId)) continue;
    seen.add(weaponId);
    rows.push({
      global_person_id: globalPersonId,
      weapon_id: weaponId,
      favorite: weapon.favorite,
      level: weapon.level,
      sort_order: index,
    });
  }
  if (rows.length === 0) return;

  await table(service, 'fighter_weapons').delete().eq('global_person_id', globalPersonId);
  const { error } = await table(service, 'fighter_weapons').insert(rows);
  if (error) throw new Error(error.message);
}
