import { ADMIN_LOCKDOWN_CODE, LINK_EXPIRED_CODE, LINK_UNCHECKED_CODE } from '@myclash/types';
import { isAdminLockdownRefusal } from '../../common/admin-lockdown';
import { MailedCodeRefused, MailedCodeUnjudged } from './auth-server-calls';

type RefusedLink =
  typeof ADMIN_LOCKDOWN_CODE | typeof LINK_EXPIRED_CODE | typeof LINK_UNCHECKED_CODE;

/**
 * Why a mailed link's door signs nobody in, as the page it sends its reader to
 * reads it (`SIGNUP_REFUSED_PARAM`). A browser that followed a link cannot read
 * a 401 or a 503: it showed the refusal as raw text on the API's address
 * (operator rulings 324, 362).
 *
 * For the `.catch` of the sign-in at a link's door. Any other fault is thrown
 * again: it is no refusal of the link, and "open it again" would be untrue of a
 * code that is spent.
 */
export function refusedLinkOrThrow(fault: unknown): RefusedLink {
  if (isAdminLockdownRefusal(fault)) return ADMIN_LOCKDOWN_CODE;
  if (fault instanceof MailedCodeRefused) return LINK_EXPIRED_CODE;
  if (fault instanceof MailedCodeUnjudged) return LINK_UNCHECKED_CODE;
  throw fault;
}
