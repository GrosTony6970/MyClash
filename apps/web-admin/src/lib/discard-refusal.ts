import { failureCode, failureMessage, type ApiFailure } from '@myclash/api-client';

/**
 * What the API answers a door that would delete fought bouts.
 *
 * Three doors delete a whole phase and its bouts: the forced "generate Pools
 * again", "Regenerate bracket" and "Delete bracket". With a fought bout among
 * them, only the organisation's owner passes (ruling 279), and the API refuses
 * an admin with the code `discard_requires_owner`. Its own sentence is English,
 * so these screens ask here first and fall back to `failureMessage`.
 */
export function discardFailureMessage(
  failure: ApiFailure,
  t: (key: string) => string,
  fallback: string,
): string | null {
  if (failureCode(failure) === 'discard_requires_owner') {
    return t('admin.common.discardRequiresOwner');
  }
  return failureMessage(failure, t, fallback);
}

/**
 * How many fought bouts a forced "generate Pools again" would delete, when the
 * API refused it for that reason (ruling 280); `null` for every other answer.
 * The Pools page shows the count in a second confirm, and its yes sends the
 * discard.
 */
export function foughtBoutsAtStake(failure: ApiFailure): number | null {
  if (failureCode(failure) !== 'scored_bouts_would_be_discarded') return null;
  const count = failure.kind === 'http' ? failure.details?.['scoredMatches'] : null;
  return typeof count === 'number' ? count : null;
}
