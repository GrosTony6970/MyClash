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
