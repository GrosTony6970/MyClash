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
  return out;
}

type WeaponDbClient = {
  from: (table: string) => {
    select: (columns?: string) => {
      eq: (
        column: string,
        value: unknown,
      ) => {
        maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
      };
    };
    insert: (payload: Record<string, unknown> | Record<string, unknown>[]) => {
      select: (columns?: string) => {
        single: () => Promise<{ data: unknown; error: { message: string } | null }>;
      };
    } & Promise<{ error: { message: string } | null }>;
    delete: () => { eq: (column: string, value: unknown) => Promise<{ error: unknown }> };
  };
};

/** Resolve a weapon name to a weapon_catalog id, creating the catalog row if new. */
async function resolveWeaponCatalogId(
  service: WeaponDbClient,
  name: string,
): Promise<string | null> {
  const slug = slugify(name);
  if (!slug) return null;
  const { data: existing } = await service
    .from('weapon_catalog')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (existing) return String((existing as { id: unknown }).id);
  // Import-created rows land INACTIVE: fighter imports run on the service client
  // (bypassing the super-admin weapon_catalog_write RLS), so an unvetted name
  // must not silently appear in the strict tournament/workshop picker
  // (GET /weapons?active=true). A super-admin promotes it via /admin/weapons.
  // active=false does not gate the fighter_weapons FK, so the link still works
  // and the weapon still shows on the (non-strict) fighter profile picker.
  const { data, error } = await service
    .from('weapon_catalog')
    .insert({ name, slug, active: false })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data ? String((data as { id: unknown }).id) : null;
}

/**
 * Replace a global person's weapons from a CSV cell. A blank/empty cell is a
 * no-op (it does NOT wipe existing weapons) so importing a roster that omits
 * the column never destroys profile data.
 */
export async function replaceFighterWeaponsFromCell(
  service: WeaponDbClient,
  globalPersonId: string,
  raw: string | null | undefined,
): Promise<void> {
  const weapons = parseWeaponsCell(raw);
  if (weapons.length === 0) return;

  const rows: Record<string, unknown>[] = [];
  for (const [index, weapon] of weapons.entries()) {
    const weaponId = await resolveWeaponCatalogId(service, weapon.weaponName);
    if (!weaponId) continue;
    rows.push({
      global_person_id: globalPersonId,
      weapon_id: weaponId,
      favorite: weapon.favorite,
      level: weapon.level,
      sort_order: index,
    });
  }
  if (rows.length === 0) return;

  await service.from('fighter_weapons').delete().eq('global_person_id', globalPersonId);
  const { error } = await service.from('fighter_weapons').insert(rows);
  if (error) throw new Error(error.message);
}
