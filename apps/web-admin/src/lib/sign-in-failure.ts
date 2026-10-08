import { failureCode, failureMessage, type ApiFailure } from '@myclash/api-client';
import {
  ADMIN_LOCKDOWN_CODE,
  CLUB_NOT_MADE_CODE,
  READ_ONLY_MODE_CODE,
  refusedLinkKey,
  SIGNUPS_DISABLED_CODE,
} from '@myclash/types';

/**
 * What the two admin sign-in screens say when the sign-in fails (operator ruling 301).
 *
 * The API answers a server error when it could not read the account's role or clubs. Neither
 * screen may turn that into "this account is not allowed".
 *
 * The maintenance lockdown is told by its code and by nothing else (operator ruling 308). A
 * 503 with another code, or with none (the edge's, while the API is down), is a server fault.
 *
 * And what the sign-up screens say while a super admin has switched sign-ups off (operator
 * ruling 305): the form, the Google sign-up, and the sign-up page after a refused mail link.
 */

const SIGNUPS_OFF_KEY = 'auth.signup.signupsOff';
/** The one sentence of the lockdown, the shared one (operator ruling 328). */
const LOCKDOWN_KEY = 'common.apiFailure.adminLockdown';
/** Read-only mode's, the shared one too: it refuses a sign-up (operator ruling 341). */
const READ_ONLY_KEY = 'common.apiFailure.readOnlyMode';

/** The Google callback's sentence for a refused exchange: a switch, the account, or the server. */
export function oauthFailureKey(failure: ApiFailure): string {
  const code = failureCode(failure);
  if (code === SIGNUPS_DISABLED_CODE) return SIGNUPS_OFF_KEY;
  if (code === ADMIN_LOCKDOWN_CODE) return LOCKDOWN_KEY;
  if (code === READ_ONLY_MODE_CODE) return READ_ONLY_KEY;
  const serverFault =
    failure.kind === 'network' || (failure.kind === 'http' && failure.status >= 500);
  return serverFault ? 'auth.oauth.errors.exchangeFailed' : 'auth.oauth.errors.notAuthorized';
}

/**
 * The password form's sentence for a refused sign-in.
 *
 * One of its own, then the shared one, which says the lockdown by its code (rulings 326,
 * 328). A 401 the API wrote is a wrong address or password here, where nobody is signed in
 * yet: the shared sentence for a 401 says "your session has expired" (operator ruling 309).
 * A 401 with no code is the edge's, and stays the shared "the connection was blocked".
 */
export function passwordLoginMessage(
  failure: ApiFailure,
  t: (key: string) => string,
): string | null {
  const wrongPassword =
    failure.kind === 'unauthenticated' && failure.status === 401 && failure.code !== null;
  return wrongPassword ? t('auth.login.errors.wrongPassword') : failureMessage(failure, t);
}

/**
 * The sign-up form's sentence for a refused sign-up.
 *
 * Both coded answers are read through `failureCode` and NOT `detail`: each is thrown with an
 * explicit `code:`, which the API passes through verbatim. A stale agreement means the policy
 * moved on while this tab was open.
 */
export function signupFailureMessage(
  failure: ApiFailure,
  t: (key: string) => string,
): string | null {
  const code = failureCode(failure);
  if (code === 'legal_version_stale') return t('legal.accept.stale');
  if (code === SIGNUPS_DISABLED_CODE) return t(SIGNUPS_OFF_KEY);
  return failureMessage(failure, t, t('admin.common.signupFailed'));
}

/**
 * The sentence key for the reason a mailed link's door wrote in the page's address
 * (`SIGNUP_REFUSED_PARAM`), or `null`. A browser that follows a link cannot read a 503.
 *
 * The sign-up link's door writes "sign-ups off", read-only mode (operator ruling 341) or the
 * lockdown to the sign-up page, and the sign-in link's door writes the lockdown to the sign-in
 * page (operator ruling 324). Both doors write a link that signed nobody in (rulings 360,
 * 362), and the sign-up link's door an organization that was not written (ruling 363).
 */
export function signupRefusedKey(value: string | string[] | undefined): string | null {
  if (value === ADMIN_LOCKDOWN_CODE) return LOCKDOWN_KEY;
  if (value === READ_ONLY_MODE_CODE) return READ_ONLY_KEY;
  if (value === CLUB_NOT_MADE_CODE) return 'auth.signup.orgNotMade';
  return value === SIGNUPS_DISABLED_CODE ? SIGNUPS_OFF_KEY : refusedLinkKey(value);
}
