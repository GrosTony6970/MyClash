import type { SupabaseClient } from '@supabase/supabase-js';

/** The one answer of a sign-up by email, whatever the address holds: no address enumeration. */
export const SIGNUP_ANSWER = {
  message: 'If this email is new, a confirmation link has been sent.',
} as const;

type AuthAdmin = Pick<SupabaseClient['auth']['admin'], 'createUser' | 'generateLink'>;
type LinkCode = { hashed_token?: string } | null | undefined;

/**
 * What a sign-up by email found at its address (operator ruling 2026-10-16).
 *
 * - `created`: this call made the account. `code` is its confirmation code, or none when the
 *   auth server gave none: the account stands and its acceptance is recorded all the same.
 * - `unconfirmed`: an account made earlier waits for its confirmation: by a sign-up, or by an
 *   "email me a link" (which makes one with no password chosen). `code` is a fresh one (the old
 *   link stops working). It keeps any password it had. A password stored before the address
 *   is proven is a known hole: the "password only after proof" slice (ruling 2026-10-16).
 * - `none`: a confirmed account holds the address, or the auth server refused. `why` is for
 *   the log only: the caller answers the same words in every case.
 */
export type SignupAccount =
  | { kind: 'created'; userId: string; code: LinkCode }
  | { kind: 'unconfirmed'; code: LinkCode }
  | { kind: 'none'; why: string };

/**
 * Make the account, or find the unconfirmed one at this address.
 *
 * Two calls, because GoTrue's `generateLink('signup')` answers the same for a new address and
 * for one that waits for its confirmation: it hands back that account with a fresh code and
 * keeps its password (`adminGenerateLink`, GoTrue v2.195.0). Read as "made", a stranger
 * who typed Léa's address wrote a legal acceptance on her account. `createUser` alone tells
 * the two apart: it refuses any address that has an account, with `email_exists`.
 */
export async function signupAccount(
  admin: AuthAdmin,
  email: string,
  password: string,
): Promise<SignupAccount> {
  const made = await admin.createUser({ email, password, email_confirm: false });
  if (made.error && made.error.code !== 'email_exists') {
    return { kind: 'none', why: made.error.message };
  }
  const link = await admin.generateLink({ type: 'signup', email, password });
  if (!made.error) {
    return { kind: 'created', userId: made.data.user.id, code: link.data?.properties };
  }
  // A confirmed account: GoTrue refuses its link.
  if (link.error) return { kind: 'none', why: link.error.message };
  return { kind: 'unconfirmed', code: link.data.properties };
}
