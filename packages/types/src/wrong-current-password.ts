/**
 * A wrong current password, typed by a signed-in account before a change of password or an
 * account deletion (operator ruling 329).
 *
 * The `code` of the 403 the API answers. A 401 at those two doors means the session ended:
 * the two used to share the 401, and the security page read both as a wrong password. The API
 * writes the value, web-public reads it back into a sentence.
 */
export const WRONG_CURRENT_PASSWORD_CODE = 'wrong_current_password';
