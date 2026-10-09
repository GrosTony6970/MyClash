/**
 * The link that confirms a new account address (operator ruling 371). Its door
 * is the API's own: it sends its reader to the participant sign-in page, and
 * writes what became of the change in that page's address. Never the address
 * itself: a page's address stays in the browser's history and in every log.
 *
 * A link that is dead, or that nobody could check, is written as a mailed
 * sign-in link's is (`SIGNUP_REFUSED_PARAM`, `LINK_EXPIRED_CODE`, `LINK_UNCHECKED_CODE`).
 */

/** The query parameter that carries what became of the address change. */
export const EMAIL_CHANGE_PARAM = 'emailChange';

/** The account has the new address. */
export const EMAIL_CHANGED_CODE = 'changed';

/**
 * The auth server refused the change: the new address holds another account,
 * or the account is gone. A second click on the same link fails the same way.
 */
export const EMAIL_NOT_CHANGED_CODE = 'not_changed';
