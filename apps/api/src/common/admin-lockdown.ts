import { ADMIN_LOCKDOWN_CODE } from '@myclash/types';
import { OperationalUnavailableException } from './operational-exception';

/**
 * The refusal of the maintenance lockdown (operator ruling 308): the sign-in door's and the
 * interceptor's.
 *
 * It was a plain 503. The exception filter replaces the words of every plain 5xx, so an
 * organiser read "Internal server error" while the lockdown was on, and no screen could tell
 * the lockdown from a 503 of the edge. This one keeps its words and carries a code: a sign-in
 * screen says the lockdown in the reader's language for the code, and nothing else for it.
 */
export function adminLockdownRefusal(): OperationalUnavailableException {
  return new OperationalUnavailableException({
    code: ADMIN_LOCKDOWN_CODE,
    message: 'MyClash admin is temporarily restricted to super admins. Please try again later.',
  });
}

/** Is this the lockdown's refusal? For a door that answers a browser, which cannot read a 503. */
export function isAdminLockdownRefusal(refusal: unknown): boolean {
  if (!(refusal instanceof OperationalUnavailableException)) return false;
  return (refusal.getResponse() as { code?: unknown }).code === ADMIN_LOCKDOWN_CODE;
}
