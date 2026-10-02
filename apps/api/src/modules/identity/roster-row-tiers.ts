/**
 * roster-row-tiers.ts: the two tiers of the profile resolver that read ROSTER rows, not profiles.
 *
 * A profile does not always carry what would find it again: a HEMA Ratings id typed on a roster
 * row stays there (ruling 35), and a profile minted for a row whose address belongs to somebody
 * else is minted without the address (ruling 211). The roster rows keep both, and say which
 * profile they sit on. Leaves of `GlobalPersonResolverService`, split out at the 400-line cap.
 */
import type { Logger } from '@nestjs/common';
import { personEmailMatchesUser } from '../auth/person-email-match';
import { applyReachable } from '../fighters/directory-predicate';
import type { SupabaseService } from '../supabase/supabase.service';
import { sameName, type NameParts } from './same-name';

export interface RosterTierDeps {
  supabase: SupabaseService;
  logger: Logger;
}

/**
 * Before minting (operator ruling 211a): the live profile that roster rows carrying EXACTLY
 * this address and this SAME name already sit on, or null.
 *
 * Ruling 211 mints a profile WITHOUT an address that belongs to a profile of another name. No
 * tier could find that profile again: Léa typed as "Léa Roux-Martin", with no club and no HEMA
 * Ratings id, got a new profile at EVERY Event, and so did her brother at the family address.
 * Their roster rows still carry the address and the name, and say which profile they are on.
 *
 * The name is the ROW's, not the profile's: after an admin merge the rows point at the survivor,
 * whatever it is called, and the next row typed that way follows them there. A row not yet linked
 * is not read: the import and the registration door resolve a row that is already saved.
 *
 * Which profile (rulings 211b, 211c). It must be live, and have NO address of its own or THIS
 * one. "This row is linked to X" proves nothing by itself: an organiser may link a row to any
 * profile, so Bob could type Léa's name and address on a row of his own Event, link it to his
 * profile, and her next row in any club's Event would follow it there. The price: a row typed with
 * an address its fighter has since changed is not put on her profile, and gets a second one.
 * When the rows sit on several such profiles, the OLDEST is taken, and the log says so: giving up
 * minted one more at every Event.
 *
 * Best effort: a failed read is logged and links nothing, so the caller mints.
 */
export async function profileOfRosterAddress(
  deps: RosterTierDeps,
  email: string,
  name: NameParts,
): Promise<string | null> {
  const { data, error } = await deps.supabase.service
    .from('persons')
    .select('global_person_id, email, given_name, family_name')
    .ilike('email', email)
    .not('global_person_id', 'is', null);
  if (error) {
    deps.logger.warn(`roster address link: row read failed: ${error.message}`);
    return null;
  }
  const rows = (data ?? []) as Array<{
    global_person_id: string;
    email: string | null;
    given_name: string | null;
    family_name: string | null;
  }>;
  const linked = new Set(
    rows
      .filter((row) => personEmailMatchesUser(row.email, email))
      .filter((row) => sameName({ givenName: row.given_name, familyName: row.family_name }, name))
      .map((row) => row.global_person_id),
  );
  if (linked.size === 0) return null;

  const profiles = await applyReachable(
    deps.supabase.service
      .from('global_persons')
      .select('id, email, created_at')
      .in('id', [...linked]),
  ).order('created_at', { ascending: true });
  if (profiles.error) {
    deps.logger.warn(`roster address link: profile read failed: ${profiles.error.message}`);
    return null;
  }
  const usable = ((profiles.data ?? []) as Array<{ id: string; email: string | null }>).filter(
    (profile) => !profile.email || personEmailMatchesUser(profile.email, email),
  );
  const oldest = usable[0];
  if (!oldest) return null;
  const among = usable.length > 1 ? ` (the oldest of ${usable.length})` : '';
  deps.logger.log(`roster rows of the same address and name matched: ${oldest.id}${among}`);
  return oldest.id;
}

/**
 * After the email tier (operator rulings 43 and 44, 2026-09-22): the profile
 * every linked roster row typed with this HEMA Ratings id points at, asked
 * only when no profile holds the id and no tier above matched. Since
 * ruling 35 a typed id stays on the roster row, so a fighter first seen
 * without one would otherwise never be found by it again. The operator
 * accepted that one typo can then attach a stranger's later entries to the
 * wrong profile.
 *
 * Rows linked to two profiles link nothing. The profile must be live — erasure
 * blanks a profile's id but keeps the roster rows' own — and hold no HEMA
 * Ratings id of its own: once the fighter a typo sends strangers to sets
 * their real id, it stops; so it does once the id's owner has a profile.
 */
export async function profileOfRosterHemaId(
  deps: RosterTierDeps,
  hemaRatingsId: string,
): Promise<string | null> {
  const { data: rows } = await deps.supabase.service
    .from('persons')
    .select('global_person_id')
    .eq('hema_ratings_id', hemaRatingsId)
    .not('global_person_id', 'is', null);
  const linked = new Set(
    ((rows ?? []) as Array<{ global_person_id: string }>).map((row) => row.global_person_id),
  );
  if (linked.size !== 1) return null;

  const [profileId] = linked;
  const { data: live } = await applyReachable(
    deps.supabase.service.from('global_persons').select('id').eq('id', profileId),
  )
    .is('hema_ratings_id', null)
    .maybeSingle();
  if (!live) return null;
  // The one tier with an accepted false positive: leave a trace of it.
  deps.logger.log(`HEMA Ratings id ${hemaRatingsId} matched through roster rows: ${profileId}`);
  return (live as { id: string }).id;
}
