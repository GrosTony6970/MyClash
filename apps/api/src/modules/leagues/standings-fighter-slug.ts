import { publiclyKnownProfileIds } from '../../common/auth/hidden-entrants';
import type { SupabaseService } from '../supabase/supabase.service';

type Row = Record<string, unknown>;

/**
 * Each standings row with `fighterSlug`: the address of the fighter's public page, so a ranked
 * name can open it (quick win F21). It is null for a profile the public may not know of
 * (`publiclyKnownProfileIds`, ruling 174): that page answers 404, so the name must be no link.
 * The profile's own `slug` is taken off the row: sent beside a null, it would say the page
 * exists. One question for all the rows; a failed question fails the read.
 *
 * The rows must embed `global_persons(…, slug, …)`.
 */
export async function withFighterSlugs(
  deps: { supabase: SupabaseService },
  rows: Row[],
): Promise<Row[]> {
  const profileIdOf = (row: Row) => String(row['global_person_id']);
  const known = await publiclyKnownProfileIds(deps, rows.map(profileIdOf));
  return rows.map((row) => {
    const embed = (row['global_persons'] as Row | null) ?? null;
    if (!embed) return { ...row, fighterSlug: null };
    const { slug, ...profile } = embed;
    const shown = known.has(profileIdOf(row)) && typeof slug === 'string' && slug !== '';
    return { ...row, global_persons: profile, fighterSlug: shown ? slug : null };
  });
}
