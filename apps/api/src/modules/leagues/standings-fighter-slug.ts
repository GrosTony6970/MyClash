import { publiclyKnownProfileIds } from '../../common/auth/hidden-entrants';
import { isReachableEmbed } from '../fighters/directory-predicate';
import type { SupabaseService } from '../supabase/supabase.service';

type Row = Record<string, unknown>;

/**
 * Each standings row with `fighterSlug`: the address of the fighter's public page, so a ranked
 * name can open it (quick win F21). It is null when that page answers 404, so the name must be no
 * link: a profile the public may not know of (`publiclyKnownProfileIds`, ruling 174), and one
 * that was merged away or erased (`isReachableEmbed`). These are the two rules of the page's own
 * read (`FightersService.getBySlug`).
 *
 * The row keeps the profile's name and club only. Its `slug` is taken off: sent beside a null, it
 * would say the page exists. One question for all the rows; a failed question fails the read.
 *
 * The rows must embed `global_persons(display_name, slug, clubs(…))` with `REACHABLE_COLUMNS`.
 */
export async function withFighterSlugs(
  deps: { supabase: SupabaseService },
  rows: Row[],
): Promise<Row[]> {
  const profileIdOf = (row: Row) => String(row['global_person_id']);
  const known = await publiclyKnownProfileIds(deps, rows.map(profileIdOf));
  return rows.map((row) => {
    const profile = row['global_persons'] as Row;
    const hasPage = isReachableEmbed(profile) && known.has(profileIdOf(row));
    return {
      ...row,
      global_persons: { display_name: profile['display_name'], clubs: profile['clubs'] },
      fighterSlug: hasPage ? profile['slug'] : null,
    };
  });
}
