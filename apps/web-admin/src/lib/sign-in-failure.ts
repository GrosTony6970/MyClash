import type { ApiFailure } from '@myclash/api-client';

/**
 * What the two admin sign-in screens say when the sign-in fails (operator ruling 301).
 *
 * The API answers a server error when it could not read the account's role or clubs. Neither
 * screen may turn that into "this account is not allowed".
 */

/** The Google callback's sentence for a refused exchange: the account, or the server. */
export function oauthFailureKey(failure: ApiFailure): string {
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
