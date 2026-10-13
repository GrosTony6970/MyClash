/**
 * What the sign-in screen says when a sign-in fails (quick wins S1 and S3).
 *
 * The PIN form said one sentence for every cause, and the email form printed
 * the request line. Each cause now has its own sentence, because each asks
 * something else of the volunteer: type again, wait, find the wifi, or fetch
 * an organiser.
 *
 * Not `failureMessage` of `@myclash/api-client`: its sentence for a 401 is "your
 * session has expired", and nobody is signed in here. For any other 4xx it
 * prints the server's own English sentence.
 *
 * Each function answers a KEY. The form translates it.
 */

import type { ApiFailure } from '@myclash/api-client';
import { OFFLINE_CODE } from '../offline/failure-kind';

/**
 * The two answers that are no word of the API, or null.
 *
 * No network has two shapes: a request that threw, and the 503 the pad's
 * service worker answers itself (`offlineResponse()`). An answer with no
 * problem+json body is the edge's: a ban after too many refusals of one
 * address, which a whole hall shares.
 */
function notTheApi(failure: ApiFailure): string | null {
  if (failure.kind === 'network') return 'common.apiFailure.network';
  if (failure.kind === 'http' && failure.code === OFFLINE_CODE) return 'common.apiFailure.network';
  const edge =
    failure.kind === 'unauthenticated' && failure.detail === null && failure.code === null;
  return edge ? 'common.apiFailure.blocked' : null;
}

/**
 * The PIN form's sentence for a sign-in that failed.
 *
 * The API says 401 for an unknown username and for a wrong PIN alike, and 403
 * for a disabled account and for an Event that is over alike: one sentence
 * names both causes each time. A 400 keeps the old sentence: a username under
 * three letters, which no account has.
 */
export function pinLoginFailureKey(failure: ApiFailure): string {
  const said = notTheApi(failure);
  if (said) return said;
  if (failure.kind === 'unauthenticated') {
    return failure.status === 401 ? 'scoring.login.errors.wrongPin' : 'scoring.login.errors.closed';
  }
  if (failure.kind === 'http') {
    if (failure.status === 429) return 'scoring.login.errors.tooManyTries';
    if (failure.status === 404) return 'scoring.login.errors.eventNotFound';
    if (failure.status >= 500) return 'scoring.login.errors.serverFault';
  }
  return 'scoring.login.localLoginError';
}

/**
 * What the PIN form lacks before it may ask the server, or null.
 *
 * The list of Events has no row chosen until a tap: the form then sent an empty
 * Event and the server answered "Validation failed".
 */
export function missingBeforeSignIn(eventSlugOrCode: string): string | null {
  return eventSlugOrCode.trim() === '' ? 'scoring.login.errors.noEvent' : null;
}

/**
 * The email form's sentence for a login link that was not sent (quick win S3).
 *
 * The form printed the request line: "POST /api/v1/auth/magic-link failed
 * (400): Validation failed". A 400 here is an address the browser took and the
 * server refused. The 429 is one bucket for a whole hall: ten links an hour.
 */
export function magicLinkFailureKey(failure: ApiFailure): string {
  const said = notTheApi(failure);
  if (said) return said;
  if (failure.kind === 'http' && failure.status === 429) return 'common.apiFailure.tooManyRequests';
  if (failure.kind === 'http' && failure.status === 400) return 'scoring.login.errors.emailRefused';
  return 'scoring.login.errors.linkNotSent';
}
