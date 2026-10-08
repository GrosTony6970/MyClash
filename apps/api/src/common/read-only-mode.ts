import { READ_ONLY_MODE_CODE } from '@myclash/types';
import type { SupabaseService } from '../modules/supabase/supabase.service';
import { isFlagEnabledDirect } from './feature-flag-direct';
import { OperationalUnavailableException } from './operational-exception';

/**
 * The refusal of read-only mode (operator ruling 334): the interceptor's, and the sign-up
 * doors' (ruling 341).
 *
 * Its words and its code reach the screen: a plain 503 is scrubbed by the exception filter,
 * and a web page read "Internal server error".
 */
export function readOnlyModeRefusal(): OperationalUnavailableException {
  return new OperationalUnavailableException({
    code: READ_ONLY_MODE_CODE,
    message: 'MyClash is in maintenance. Nothing can be saved for now. Try again later.',
  });
}

/**
 * Asked by a door under `auth/` that makes an account or a club (operator ruling 341).
 *
 * `ReadOnlyInterceptor` lets `auth/` through whole, so that a sign-in still works, and it
 * never meets a GET: a sign-up form, a Google sign-up and a click on a mailed sign-up link
 * all wrote while the switch was on. Nobody passes here, a super admin included: the
 * Google sign-up is the one door whose caller may hold an account already.
 *
 * It stops the club and the accounts WE make. The auth server makes one for a new address at
 * a sign-in by mailed link: that door asks `linkWouldMakeAccount` first (ruling 347). It still
 * makes one at Google, before this door is reached, and at its own sign-up address.
 */
export async function assertNotReadOnly(supabase: SupabaseService): Promise<void> {
  if (await isFlagEnabledDirect(supabase, 'read_only_mode')) throw readOnlyModeRefusal();
}
