import { apiRequest, type ApiFailure } from '@myclash/api-client';
import { createTranslator } from '@myclash/i18n/runtime';
import { messages } from '@myclash/i18n/staff';
import type { ExchangeRow, Penalty } from '@myclash/ui';
import { classifySyncFailure } from '../offline/failure-kind';
import { newestOf } from '../offline/newest-entry';
import type { TakenBack } from '../offline/take-back';
import { refusalMessage } from './refusal-copy';

type Translate = Parameters<typeof refusalMessage>[1];

/**
 * Saved on the hit or the card, and on the request for review when the Event
 * is over. The reviewer may read either language, so it is one sentence in
 * both, French first, as a notice is (ruling 258). Not the referee's language:
 * `t` is.
 */
const CLEAR_LAST_REASON = [messages.fr, messages.en]
  .map((tree) => createTranslator(tree)('scoring.corrections.clearLastReason'))
  .join(' / ');

export type ClearLastOutcome =
  /** The entry is gone: deleted on the tablet, or voided on the server. */
  | { kind: 'voided' }
  /**
   * The Event is over: for an organiser's account the server files a correction
   * request and answers 202. The hit is NOT voided, and stays on the screen
   * until somebody approves the request.
   */
  | { kind: 'sent-for-review' }
  /** `message` is null when there is nothing to say (the bout holds no entry). */
  | { kind: 'failed'; message: string | null };

/** One entry the server holds: a hit or a card, each voided by its own route. */
export interface ServerEntry {
  kind: 'exchange' | 'penalty';
  id: string;
}

const VOID_PATH: Record<ServerEntry['kind'], (id: string) => string> = {
  exchange: (id) => `/api/v1/exchanges/${id}/void`,
  penalty: (id) => `/api/v1/match-penalties/${id}/void`,
};

/**
 * Still the classifier the outbox drain uses, so the pad keeps ONE failure
 * vocabulary: the service worker's synthetic 503 reads as offline, not as the
 * server having an opinion. A `network` failure is the same event one layer
 * down, which is the status 0 it already took.
 */
function failed(failure: ApiFailure, t: Translate): ClearLastOutcome {
  const status = failure.kind === 'aborted' || failure.kind === 'network' ? 0 : failure.status;
  const offline = classifySyncFailure(status, null) === 'offline';
  return {
    kind: 'failed',
    message: offline
      ? t('scoring.corrections.onlineOnly')
      : refusalMessage(failure, t, 'scoring.corrections.clearLastFailed'),
  };
}

/**
 * Void one entry the server holds: the server half of the undo.
 *
 * The 202 was read as a void that landed: the screen refreshed, said nothing,
 * and the hit stayed.
 */
export async function voidOnServer(
  apiUrl: string,
  entry: ServerEntry,
  t: Translate,
): Promise<ClearLastOutcome> {
  const result = await apiRequest<{ pendingReview?: boolean } | null>(
    apiUrl,
    VOID_PATH[entry.kind](entry.id),
    { method: 'PATCH', body: { reason: CLEAR_LAST_REASON } },
  );
  if (result.ok) return { kind: result.data?.pendingReview ? 'sent-for-review' : 'voided' };
  return failed(result, t);
}

/**
 * The newest live entry the server holds for a bout, read NOW. Never the
 * screen's lists: they are read again only when a send has ended, so during
 * one they miss the hits it has already delivered, and the undo voided the
 * hit before the one just pressed. Both reads must answer: a card may be the
 * newest, so a hit is not picked on half the list.
 */
async function newestOnServer(
  apiUrl: string,
  matchId: string,
): Promise<{ entry: ServerEntry | undefined } | { failure: ApiFailure }> {
  const [hits, cards] = await Promise.all([
    apiRequest<ExchangeRow[]>(apiUrl, `/api/v1/matches/${matchId}/exchanges`),
    apiRequest<Penalty[]>(apiUrl, `/api/v1/matches/${matchId}/penalties`),
  ]);
  if (!hits.ok) return { failure: hits };
  if (!cards.ok) return { failure: cards };
  const live = [
    ...hits.data.map((hit) => ({
      kind: 'exchange' as const,
      id: hit.id,
      voided: hit.voided,
      occurredAt: hit.occurredAt,
      sequence: hit.sequence,
    })),
    ...cards.data.map((card) => ({
      kind: 'penalty' as const,
      id: card.id,
      voided: card.voided,
      occurredAt: card.occurred_at ?? '',
      sequence: card.sequence,
    })),
  ].filter((entry) => !entry.voided);
  return { entry: newestOf(live, (entry) => entry) };
}

/**
 * "Undo last entry": take back the newest hit or card of a bout, wherever it
 * is (rulings 317, 318).
 *
 * The tablet first: an entry that waits there has not reached the server, and
 * deleting it needs no network. `takeBack` waits for the answer of an entry
 * that is on its way, and names it when the server took it: that one is voided
 * by its id. An answer can carry no id (the store then keeps none, or the
 * entry's own uuid after a second try): the fresh read finds it. With nothing
 * on the tablet the newest entry is the server's.
 */
export async function undoLastEntry(deps: {
  apiUrl: string;
  matchId: string;
  t: Translate;
  takeBack: (matchId: string) => Promise<TakenBack>;
}): Promise<ClearLastOutcome> {
  const { apiUrl, matchId, t } = deps;
  const taken = await deps.takeBack(matchId);
  if (taken.kind === 'removed') return { kind: 'voided' };
  if (taken.kind === 'landed' && taken.serverId && taken.serverId !== taken.entry.clientUuid) {
    return voidOnServer(apiUrl, { kind: taken.entry.kind ?? 'exchange', id: taken.serverId }, t);
  }
  const newest = await newestOnServer(apiUrl, matchId);
  if ('failure' in newest) return failed(newest.failure, t);
  if (!newest.entry) return { kind: 'failed', message: null };
  return voidOnServer(apiUrl, newest.entry, t);
}
