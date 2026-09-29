/**
 * The rows of the "find your profile" search (`GET /me/global-person-search`, ruling 105):
 * unclaimed, reachable profiles by a name the caller typed, 20 at most.
 *
 * A profile known only through entries hidden from the public is not offered (rulings 171b, 173):
 * every roster row of it is one the public may not know of (`knownRosterRows` read as
 * `THE_PUBLIC`, ruling 163 — a draft Tournament, a draft or test Event). A profile with no roster
 * row at all (an imported one) stays. Hidden profiles must not crowd out the rest, so the search
 * reads more rows until 20 are kept or none are left — up to 100 rows, five reads: past that it
 * offers what it has checked, never a row it has not.
 */
import { THE_PUBLIC } from '../../common/auth/competition-visibility';
import type { EventAuthzDeps } from '../../common/auth/event-authz';
import { knownRosterRows } from '../../common/auth/hidden-entrants';
import { applyReachable } from '../fighters/directory-predicate';

export const CLAIM_SEARCH_LIMIT = 20;
/** The longest read: it bounds the reads per keystroke and keeps the `.in()` list short. */
const MAX_READ = 100;

export interface ClaimSearchRow {
  id: string;
  slug: string;
  display_name: string;
  given_name: string;
  family_name: string;
  country_code: string | null;
  public_visibility: unknown;
  hema_ratings_id: string | null;
  clubs: { name: string } | { name: string }[] | null;
}

/** `safe` is the typed name, already stripped of PostgREST meta-characters. */
export async function searchClaimableProfiles(
  deps: EventAuthzDeps,
  safe: string,
): Promise<ClaimSearchRow[]> {
  let limit = CLAIM_SEARCH_LIMIT;
  for (;;) {
    const rows = await readRows(deps, safe, limit);
    const kept = await publiclyKnown(deps, rows);
    // While fewer than 20 are kept, hidden > limit - 20: the next read is longer, up to MAX_READ.
    if (kept.length >= CLAIM_SEARCH_LIMIT || rows.length < limit || limit >= MAX_READ) {
      // A longer read starts with the shorter one (the order ends on the id), so no more than 20
      // are kept — unless a profile is claimed between two reads.
      return kept.slice(0, CLAIM_SEARCH_LIMIT);
    }
    limit = Math.min(CLAIM_SEARCH_LIMIT + rows.length - kept.length, MAX_READ);
  }
}

async function readRows(deps: EventAuthzDeps, safe: string, limit: number) {
  const { data, error } = await applyReachable(
    deps.supabase.service
      .from('global_persons')
      .select(
        'id, slug, display_name, given_name, family_name, country_code, public_visibility, hema_ratings_id, clubs(name)',
      ),
  )
    .is('claimed_by_user_id', null)
    .or(`display_name.ilike.%${safe}%,given_name.ilike.%${safe}%,family_name.ilike.%${safe}%`)
    .order('display_name', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`global person search failed: ${error.message}`);
  return (data ?? []) as unknown as ClaimSearchRow[];
}

/** The profiles the public may know of: no roster row at all, or one it may know of. */
async function publiclyKnown(deps: EventAuthzDeps, profiles: ClaimSearchRow[]) {
  if (profiles.length === 0) return [];
  const { data, error } = await deps.supabase.service
    .from('persons')
    .select('id, event_id, global_person_id')
    .in(
      'global_person_id',
      profiles.map((profile) => profile.id),
    );
  // A 5xx: read as "no roster row", every profile would be offered.
  if (error) throw new Error(`profile roster read failed: ${error.message}`);
  const roster = ((data ?? []) as Array<Record<string, string>>).map((row) => ({
    id: row['id'] as string,
    eventId: row['event_id'] as string,
    profileId: row['global_person_id'] as string,
  }));
  const known = new Set(
    (await knownRosterRows(deps, roster, THE_PUBLIC)).map((row) => row.profileId),
  );
  const listed = new Set(roster.map((row) => row.profileId));
  return profiles.filter((profile) => !listed.has(profile.id) || known.has(profile.id));
}
