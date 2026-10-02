/**
 * roster-names-of-address.ts — the name check of the sign-in profile link (operator ruling 218).
 *
 * A sign-in gives an account the unclaimed profile that carries its address. An address alone
 * proves little: Claire typed Léa's address on Tom's roster row, Tom's profile was minted with
 * it, and Léa's sign-in was given Tom's profile, his name and his results. So before a profile is
 * given, every roster row that carries the address is read. When one of them has another name
 * than the profile, nothing is given: she claims her profile from her page.
 *
 * The same name is `sameName` (ruling 211): the same words, in any order, case or accents. A
 * profile with no name equals no row.
 *
 * What it cannot see: when the mistyped row is the only roster row of the address, every row has
 * the profile's name, and the profile is given. What it costs: a rightful owner whose address is
 * also on a row of another name (a family address, a name typed another way once) is given
 * nothing either, and claims from her page. A roster row of a test Event counts like any other.
 *
 * A failed read gives nothing. The sign-in asks again the next time.
 */
import type { Logger } from '@nestjs/common';
import { sameName } from '../identity/same-name';
import type { SupabaseService } from '../supabase/supabase.service';
import { personEmailMatchesUser } from './person-email-match';

export interface NamedProfile {
  id: string;
  given_name: string | null;
  family_name: string | null;
}

/**
 * Whether the sign-in must NOT give `profile` to the account of `email`. Says why in the log, by
 * id only: a name or an address in a log is personal data.
 */
export async function anotherNameOnRoster(
  deps: { supabase: SupabaseService; logger: Pick<Logger, 'log' | 'warn'> },
  userId: string,
  email: string,
  profile: NamedProfile,
): Promise<boolean> {
  const refused = `global-person link refused for user ${userId}`;
  const { data, error } = await deps.supabase.service
    .from('persons')
    .select('email, given_name, family_name')
    .ilike('email', email);
  if (error) {
    deps.logger.warn(
      `${refused}: roster rows of the account's address unreadable: ${error.message}`,
    );
    return true;
  }

  const name = { givenName: profile.given_name, familyName: profile.family_name };
  const another = (
    (data ?? []) as Array<{
      email: string | null;
      given_name: string | null;
      family_name: string | null;
    }>
  )
    // `ilike` reads `_` and `%` in an address as wildcards: keep the rows of exactly this one.
    .filter((row) => personEmailMatchesUser(row.email, email))
    .some((row) => !sameName({ givenName: row.given_name, familyName: row.family_name }, name));
  if (another) {
    deps.logger.log(
      `${refused}: a roster row of the account's address has another name than global_persons ${profile.id}`,
    );
  }
  return another;
}
