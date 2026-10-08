/**
 * "Sign-ups off" (operator ruling 305): a super admin's switch that refuses a new
 * organizer account at every door — the sign-up form, the mailed sign-up link
 * and the Google sign-up.
 *
 * The API writes the value, web-admin reads it back into a sentence.
 */

/**
 * The `code` of the 503 a sign-up door answers while the switch is on. Also the
 * value of `SIGNUP_REFUSED_PARAM` when the mailed link's door refuses.
 */
export const SIGNUPS_DISABLED_CODE = 'signups_disabled';

/**
 * The query parameter by which the mailed link's door tells the sign-up page why
 * it made no account. A browser that follows a link cannot read a 503's body.
 */
export const SIGNUP_REFUSED_PARAM = 'refused';

/**
 * What a mailed link's door writes in `SIGNUP_REFUSED_PARAM` when the link signs
 * nobody in, for the sign-in page of its site or the sign-up page.
 *
 * The auth server refused the link's code: made up, used, or past its life
 * (operator ruling 362).
 */
export const LINK_EXPIRED_CODE = 'link_expired';

/**
 * The auth server gave no judgment of the link's code (operator ruling 360): a
 * throttle, a fault, no answer. The page says to open the link again. It may
 * work: the auth server can still spend a code it answered too late about.
 */
export const LINK_UNCHECKED_CODE = 'link_unchecked';

/**
 * The sign-up link was spent and its organization could not be written (operator
 * ruling 363). The account stands: a second sign-up BY EMAIL LINK mails a link
 * that makes it. The password choice refuses an address that holds an account.
 */
export const CLUB_NOT_MADE_CODE = 'club_not_made';

/**
 * The sentence key of a mailed link that signed nobody in, for the reason its
 * door wrote in the page's address, or null. One owner for the organizer app
 * and the participant app: both sign-in pages read the same two reasons.
 */
export function refusedLinkKey(reason: unknown): string | null {
  if (reason === LINK_EXPIRED_CODE) return 'auth.login.errors.linkExpired';
  return reason === LINK_UNCHECKED_CODE ? 'auth.login.errors.linkUnchecked' : null;
}
