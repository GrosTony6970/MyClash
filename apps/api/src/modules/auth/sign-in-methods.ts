import type { SupabaseAuthUser } from '../supabase/supabase.service';

/**
 * Whether an account signs in with a password (operator ruling 349).
 *
 * Only the auth server knows: it lists the account's `identities`. While it gives no answer,
 * `getAuthUser` hands back the claims of the login, which carry no list. That is "not known",
 * never "no password": the security page drew a passworded account as a Google one, and the
 * account deletion asked no password. A plain Error, so a server error: nothing was judged.
 *
 * "A password" is an `email` identity. The auth server gives one to an account made by a
 * mailed sign-in link too, and answers an empty list, never none, for an account with no
 * identity (read on GoTrue v2.195.0).
 */
export function signsInWithPassword(user: SupabaseAuthUser): boolean {
  const identities = (user as { identities?: unknown }).identities;
  if (!Array.isArray(identities)) {
    throw new Error('The auth server did not answer how this account signs in');
  }
  return identities.some((identity: { provider?: string }) => identity.provider === 'email');
}
