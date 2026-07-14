import { BadRequestException } from '@nestjs/common';

/**
 * Minimal structural view of the Supabase service client used to read the
 * weapon catalog. `from` returns `unknown` ON PURPOSE: structurally matching the
 * full supabase-js `from()` return type against a nested interface makes TS
 * recurse deep enough to throw TS2589 ("excessively deep") at unrelated call
 * sites. Widening to `unknown` keeps `this.supabase.service` trivially
 * assignable from any module; we cast the builder to the shape we need inside.
 */
export interface CatalogWeaponClient {
  from: (table: string) => unknown;
}

interface CatalogWeaponQuery {
  select: (columns?: string) => {
    eq: (
      column: string,
      value: unknown,
    ) => PromiseLike<{ data: Array<{ name: string }> | null; error: { message: string } | null }>;
  };
}

/**
 * Resolve a submitted weapon string to its canonical active-catalog name, or
 * throw `BadRequestException` if it isn't an active `weapon_catalog` entry.
 *
 * Matches by NAME (case-insensitive, trimmed) — not slug — because the
 * tournament/workshop pickers submit an exact catalog name and renamed
 * entries keep a non-matching slug (e.g. 'Sword & Buckler' → slug
 * 'sword-and-buckler'). Returns the catalog's canonical casing so storage is
 * consistent. Never creates rows (unlike the fighter-import
 * `resolveWeaponCatalogId`, which upserts by slug).
 */
export async function resolveCatalogWeapon(
  client: CatalogWeaponClient,
  name: string,
): Promise<string> {
  const wanted = name.trim().toLowerCase();
  const { data, error } = await (client.from('weapon_catalog') as CatalogWeaponQuery)
    .select('name')
    .eq('active', true);
  if (error) throw new BadRequestException(error.message);
  const match = (data ?? []).find((w) => w.name.trim().toLowerCase() === wanted);
  if (!match) {
    throw new BadRequestException(`Weapon "${name}" is not an active catalog entry`);
  }
  return match.name;
}
