import { CLAIM_REFUSED_PARAM, isClaimLinkRefusal, type ClaimLinkRefusal } from '@myclash/types';

/** The sentence for each reason the API refused an emailed claim link (ruling 57). */
const CLAIM_REFUSAL_MESSAGE_KEYS: Record<ClaimLinkRefusal, string> = {
  held_by_another: 'publicApp.claim.refused.heldByAnother',
  email_mismatch: 'publicApp.claim.refused.emailMismatch',
  not_found: 'publicApp.claim.refused.notFound',
  check_failed: 'publicApp.claim.refused.checkFailed',
};

/**
 * The message key for the refusal a query string carries, or null when it
 * carries none — or a value this build does not know, which says nothing
 * rather than something wrong.
 */
export function claimRefusalMessageKey(search: string): string | null {
  const value = new URLSearchParams(search).get(CLAIM_REFUSED_PARAM);
  return isClaimLinkRefusal(value) ? CLAIM_REFUSAL_MESSAGE_KEYS[value] : null;
}
