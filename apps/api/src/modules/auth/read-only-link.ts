import { Logger } from '@nestjs/common';
import { isFlagEnabledDirect } from '../../common/feature-flag-direct';
import type { SupabaseService } from '../supabase/supabase.service';

const logger = new Logger('ReadOnlyLink');

/**
 * The first page only. The filter below answers every address that CONTAINS the one asked, so
 * an address with fifty look-alikes ahead of it reads as held by nobody, and gets no link.
 */
const PAGE = 50;

/**
 * Whether an account holds `email`: `null` when the auth server did not say.
 *
 * The auth server has no read by address. Its `filter` is a case-sensitive `LIKE` over a part
 * of the address, where `_` stands for any character, and it keeps an address in lower case
 * (probed on GoTrue v2.195.0). So the address is lowered, and the answer is compared whole.
 */
export async function holdsAccount(
  supabase: SupabaseService,
  email: string,
): Promise<boolean | null> {
  const address = email.trim().toLowerCase();
  const listed = await supabase.listAuthAdminUsers(1, PAGE, address);
  if (!listed.ok || !listed.data) return null;
  return listed.data.users.some((user) => user.email === address);
}

/**
 * Whether a sign-in link for `email` would make an account during read-only mode (operator
 * ruling 347).
 *
 * Asked for a sign-in link, the auth server makes an account for an address it does not know.
 * Read-only mode makes none: such an address gets no link, and its door answers as it does
 * for any address. An address that holds an account signs in as before (ruling 341). A read
 * the auth server did not answer makes no link either: nobody then signs in by link.
 *
 * The switch itself fails open, as everywhere (ruling 109a): a failed read of it sends the link.
 * Neither line below names the address.
 */
export async function linkWouldMakeAccount(
  supabase: SupabaseService,
  email: string,
): Promise<boolean> {
  if (!(await isFlagEnabledDirect(supabase, 'read_only_mode'))) return false;
  const held = await holdsAccount(supabase, email);
  if (held === true) return false;
  if (held === null) logger.warn('read-only mode: the account of an address was not read');
  else logger.log('read-only mode: no sign-in link for an address with no account');
  return true;
}
