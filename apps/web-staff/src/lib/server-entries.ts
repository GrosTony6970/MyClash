import { apiRequest, type ApiFailure } from '@myclash/api-client';
import { heldTo, SERVER_LIMIT_MS } from './time-limit';

/** One hit or card of a bout, as the server holds it. */
export interface ServerRow {
  kind: 'exchange' | 'penalty';
  id: string;
  /** The id the tablet gave it: what a waiting entry is matched by. */
  clientUuid: string;
  voided: boolean;
  occurredAt: string;
  sequence: number;
}

export type ServerRead = { rows: ServerRow[] } | { failure: ApiFailure };

interface RawRow {
  id: string;
  client_uuid: string;
  voided: boolean;
  sequence: number;
  occurred_at?: string | null;
}

const rowsOf = (kind: ServerRow['kind'], raw: RawRow[]): ServerRow[] =>
  raw.map((row) => ({
    kind,
    id: row.id,
    clientUuid: row.client_uuid,
    voided: row.voided,
    occurredAt: row.occurred_at ?? '',
    sequence: row.sequence,
  }));

/**
 * The two lists are public reads: to a caller they do not know they answer an
 * empty list, with a 200. So the card rules are read FIRST and alone: that
 * read is for who may score the bout, and a login that ran out is renewed by
 * it before the lists are asked. Both lists must answer: a card may be the
 * newest, so nothing is decided on half the bout.
 */
async function readAll(apiUrl: string, matchId: string, signal: AbortSignal): Promise<ServerRead> {
  const bout = `/api/v1/matches/${matchId}`;
  const mayScore = await apiRequest<unknown>(apiUrl, `${bout}/penalty-ruleset`, { signal });
  if (!mayScore.ok) return { failure: mayScore };
  const [hits, cards] = await Promise.all([
    apiRequest<RawRow[]>(apiUrl, `${bout}/exchanges`, { signal }),
    apiRequest<RawRow[]>(apiUrl, `${bout}/penalties`, { signal }),
  ]);
  if (!hits.ok) return { failure: hits };
  if (!cards.ok) return { failure: cards };
  return { rows: [...rowsOf('exchange', hits.data), ...rowsOf('penalty', cards.data)] };
}

/**
 * Every hit and card the server holds for a bout, read NOW, for a caller who
 * may score it (ruling 350). Never the screen's lists: they are read again
 * only when a send has ended.
 *
 * The whole read is held to one time limit (`heldTo`).
 */
export function readServerEntries(apiUrl: string, matchId: string): Promise<ServerRead> {
  return heldTo(SERVER_LIMIT_MS, (signal) => readAll(apiUrl, matchId, signal), {
    failure: { kind: 'aborted' },
  });
}
