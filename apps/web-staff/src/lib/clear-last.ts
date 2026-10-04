import { apiRequest } from '@myclash/api-client';
import { classifySyncFailure } from '../offline/failure-kind';
import { refusalMessage } from './refusal-copy';

type Translate = Parameters<typeof refusalMessage>[1];

export type ClearLastOutcome =
  | { kind: 'voided' }
  /**
   * The Event is over: for an organiser's account the server files a correction
   * request and answers 202. The hit is NOT voided, and stays on the screen
   * until somebody approves the request.
   */
  | { kind: 'sent-for-review' }
  /** `message` is null when there is nothing to say (the caller gave up). */
  | { kind: 'failed'; message: string | null };

/**
 * Void one hit the server holds: the server half of "Clear last exchange".
 *
 * The 202 was read as a void that landed: the screen refreshed, said nothing,
 * and the hit stayed.
 */
export async function voidOnServer(
  apiUrl: string,
  exchangeId: string,
  t: Translate,
): Promise<ClearLastOutcome> {
  const result = await apiRequest<{ pendingReview?: boolean } | null>(
    apiUrl,
    `/api/v1/exchanges/${exchangeId}/void`,
    { method: 'PATCH', body: { reason: 'Clear last exchange (referee)' } },
  );
  if (result.ok) return { kind: result.data?.pendingReview ? 'sent-for-review' : 'voided' };

  // Still the classifier the outbox drain uses, so the pad keeps ONE failure
  // vocabulary: the service worker's synthetic 503 reads as offline, not as the
  // server having an opinion. A `network` failure is the same event one layer
  // down, which is the status 0 it already took.
  const kind = classifySyncFailure(
    result.kind === 'aborted' || result.kind === 'network' ? 0 : result.status,
    null,
  );
  return {
    kind: 'failed',
    message:
      kind === 'offline'
        ? t('scoring.corrections.onlineOnly')
        : refusalMessage(result, t, 'scoring.corrections.clearLastFailed'),
  };
}
