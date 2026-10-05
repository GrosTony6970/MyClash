import { failureCode, failureMessage, type ApiFailure } from '@myclash/api-client';
import { SIGNUPS_DISABLED_CODE } from '@myclash/types';

/**
 * What the two admin sign-in screens say when the sign-in fails (operator ruling 301).
 *
 * The API answers a server error when it could not read the account's role or clubs. Neither
 * screen may turn that into "this account is not allowed".
 *
 * And what the sign-up screens say while a super admin has switched sign-ups off (operator
 * ruling 305): the form, the Google sign-up, and the sign-up page after a refused mail link.
 */

const SIGNUPS_OFF_KEY = 'auth.signup.signupsOff';

/** The Google callback's sentence for a refused exchange: the account, or the server. */
export function oauthFailureKey(failure: ApiFailure): string {
  if (failureCode(failure) === SIGNUPS_DISABLED_CODE) return SIGNUPS_OFF_KEY;
  const serverFault =
    failure.kind === 'network' ||
    (failure.kind === 'http' && failure.status >= 500 && failure.status !== 503);
  return serverFault ? 'auth.oauth.errors.exchangeFailed' : 'auth.oauth.errors.notAuthorized';
}

/**
 * The password form's own sentence for a failure, or undefined for the shared one.
 *
 * A 503 here is the maintenance lockdown, and the screen's own sentence names it. Expressed as
 * the FALLBACK so an `OperationalUnavailable` 503 — the one 5xx the filter leaves unscrubbed —
 * still wins with its own words.
 */
export function passwordLoginFallback(
  failure: ApiFailure,
  t: (key: string) => string,
): string | undefined {
  return failure.kind === 'http' && failure.status === 503
    ? t('admin.featureFlags.lockdownBanner')
    : undefined;
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
 * The sentence key for the reason the mailed sign-up link's door wrote in the sign-up page's
 * address (`SIGNUP_REFUSED_PARAM`), or `null`. A browser that follows a link cannot read a 503.
 */
export function signupRefusedKey(value: string | string[] | undefined): string | null {
  return value === SIGNUPS_DISABLED_CODE ? SIGNUPS_OFF_KEY : null;
}
