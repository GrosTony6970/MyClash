import type { SupabaseClient } from '@supabase/supabase-js';
import { inListChunks } from '../../common/postgrest-in-list';

/** Weapons shown per directory row before the column stops being scannable. */
export const DIRECTORY_WEAPONS_SHOWN = 3;

/**
 * global_person_id → weapon names, favourites first, then `sort_order`. One read per id chunk, so
 * a page costs one query, not one per fighter (`getFighterWeaponLinks` is the per-fighter read for
 * a profile). `cap` undefined keeps every weapon. The one owner, for the directory and FightBook's
 * Find cards. A failed read throws: showing a fighter with no weapons would be a lie.
 *
 * Each fighter sits in exactly one chunk, so the order inside a chunk is the order per fighter.
 */
export async function readFighterWeaponNames(
  db: Pick<SupabaseClient, 'from'>,
  ids: string[],
  cap?: number,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const chunk of inListChunks(ids)) {
    const { data, error } = await db
      .from('fighter_weapons')
      .select('global_person_id, favorite, sort_order, weapon_catalog(name)')
      .in('global_person_id', chunk)
      .order('favorite', { ascending: false })
      .order('sort_order', { ascending: true });
    if (error) throw new Error(`Fighter weapons read failed: ${error.message}`);

    for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
      const gp = raw['global_person_id'] as string;
      const name = (raw['weapon_catalog'] as { name?: string | null } | null)?.name;
      if (!name) continue;
      const list = out.get(gp) ?? [];
      if ((cap === undefined || list.length < cap) && !list.includes(name)) list.push(name);
      out.set(gp, list);
    }
  }
  return out;
}
