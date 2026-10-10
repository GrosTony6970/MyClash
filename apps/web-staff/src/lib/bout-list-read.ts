/**
 * One read of a bout's hits or cards, and which rows the bout screen shows
 * after it.
 *
 * The server's rows are kept on the tablet at each good read
 * (`offline/kept-bout.ts`). A read that finds no network gives that copy, so a
 * bout opened from the tablet lists the hits and cards of before, under the
 * ones the queue holds. The rule is the bout's own: a copy is shown only when
 * the server cannot be reached, and the screen says so.
 *
 * `classifySyncFailure` is the one owner of "is this no network", as in
 * `bout-read.ts`. A server fault opens no copy.
 *
 * THE RACE. The copy is read from the tablet's store, which answers late: the
 * server's answer to a LATER read may be on screen first. `listAfterRead`
 * never puts the tablet's rows over the server's rows of the same bout.
 */
import { classifySyncFailure, type FailureBody } from '../offline/failure-kind';
import { keepList, keptList, type BoutListName } from '../offline/kept-bout';

export type BoutListRead<T> =
  | { kind: 'server'; rows: T[] }
  /** No network: the rows the tablet kept at its last good read. */
  | { kind: 'tablet'; rows: T[] }
  /** No network, and the tablet never read this list. */
  | { kind: 'unreachable' }
  /** The server answered with a fault. Nothing is known about the list. */
  | { kind: 'failed'; status: number };

export async function readBoutList<T>(
  apiUrl: string,
  matchId: string,
  list: BoutListName,
  signal?: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<BoutListRead<T>> {
  try {
    const res = await fetchFn(`${apiUrl}/api/v1/matches/${matchId}/${list}`, {
      credentials: 'include',
      signal,
    });
    if (res.ok) {
      const rows = (await res.json()) as T[];
      // A store that refuses the write costs the next open with no network only.
      void keepList(matchId, list, rows).catch(() => undefined);
      return { kind: 'server', rows };
    }
    const body = (await res.json().catch(() => null)) as FailureBody | null;
    if (classifySyncFailure(res.status, body) !== 'offline') {
      return { kind: 'failed', status: res.status };
    }
  } catch {
    // No answer at all, or one that cannot be read: no network.
  }
  const kept = await keptList<T>(matchId, list).catch(() => null);
  return kept ? { kind: 'tablet', rows: kept } : { kind: 'unreachable' };
}

/** The rows a screen holds, the bout they belong to, and who gave them. */
export interface ShownList<T> {
  matchId: string;
  rows: T[];
  fromServer: boolean;
}

/** The list on screen after `read`, for the bout `matchId`. */
export function listAfterRead<T>(
  now: ShownList<T> | null,
  matchId: string,
  read: BoutListRead<T>,
): ShownList<T> | null {
  if (read.kind === 'server') return { matchId, rows: read.rows, fromServer: true };
  if (read.kind !== 'tablet') return now;
  if (now?.matchId === matchId && now.fromServer) return now;
  return { matchId, rows: read.rows, fromServer: false };
}
