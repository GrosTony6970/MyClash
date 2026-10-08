import { apiRequest, type ApiResult } from '@myclash/api-client';
import { createTranslator } from '@myclash/i18n/runtime';
import { messages } from '@myclash/i18n/staff';

/**
 * Saved on the hit or the card, and on the request for review when the Event
 * is over. The reviewer may read either language, so it is one sentence in
 * both, French first, as a notice is (ruling 258). Not the referee's language:
 * `t` is.
 */
const CLEAR_LAST_REASON = [messages.fr, messages.en]
  .map((tree) => createTranslator(tree)('scoring.corrections.clearLastReason'))
  .join(' / ');

/** One entry the server holds: a hit or a card, each voided by its own route. */
export interface ServerEntry {
  kind: 'exchange' | 'penalty';
  id: string;
}

const VOID_PATH: Record<ServerEntry['kind'], (id: string) => string> = {
  exchange: (id) => `/api/v1/exchanges/${id}/void`,
  penalty: (id) => `/api/v1/match-penalties/${id}/void`,
};

/** The one request that voids an entry for the pad's undo, with its fixed reason. */
export function askVoid(
  apiUrl: string,
  entry: ServerEntry,
  signal?: AbortSignal,
): Promise<ApiResult<{ pendingReview?: boolean } | null>> {
  return apiRequest(apiUrl, VOID_PATH[entry.kind](entry.id), {
    method: 'PATCH',
    body: { reason: CLEAR_LAST_REASON },
    signal,
  });
}
