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
 * all wrote while the switch was on. Nobody passes here: who signs up has no account yet,
 * so there is no super admin to let through.
 */
export async function assertNotReadOnly(supabase: SupabaseService): Promise<void> {
  if (await isFlagEnabledDirect(supabase, 'read_only_mode')) throw readOnlyModeRefusal();
}
