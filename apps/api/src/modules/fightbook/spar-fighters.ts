import type { SupabaseClient } from '@supabase/supabase-js';
import type { SparFighter } from '@myclash/types';

type FighterRow = {
  id: string;
  display_name: string | null;
  given_name: string | null;
  family_name: string | null;
  photo_url: string | null;
  clubs?: unknown;
};

/** The club embed answers one object or null; any other shape is no club. */
function clubName(clubs: unknown): string | null {
  if (typeof clubs !== 'object' || clubs === null || Array.isArray(clubs)) return null;
  const name = (clubs as { name?: unknown }).name;
  return typeof name === 'string' && name.trim() ? name : null;
}

/**
 * The other fighter on a FightBook card, for each profile id: a name and a photo, nothing more
 * (a photo has no visibility switch, fighters/public-visibility.ts) and their club's name. One read for all. The one
 * owner, for the Inbox, My spars and the blocked list.
 */
export async function readSparFighters(
  db: Pick<SupabaseClient, 'from'>,
  ids: string[],
): Promise<Map<string, SparFighter>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await db
    .from('global_persons')
    .select('id, display_name, given_name, family_name, photo_url, clubs(name)')
    .in('id', ids);
  if (error) throw new Error(`FightBook fighters read failed: ${error.message}`);
  return new Map(
    ((data ?? []) as FighterRow[]).map((p) => [
      p.id,
      {
        globalPersonId: p.id,
        name: p.display_name?.trim() || `${p.given_name ?? ''} ${p.family_name ?? ''}`.trim(),
        photoUrl: p.photo_url || null,
        club: clubName(p.clubs),
      },
    ]),
  );
}

/** A profile the read did not find (deleted since): its id, and no name for the web to fill. */
export const unknownSparFighter = (id: string): SparFighter => ({
  globalPersonId: id,
  name: '',
  photoUrl: null,
  club: null,
});
