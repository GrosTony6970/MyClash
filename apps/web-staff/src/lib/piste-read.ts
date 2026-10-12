/**
 * One read of every bout of a piste, for the tablet to keep (quick-win ruling
 * 4: "Next match" with no network reaches the next bout; the operator ruled
 * that the tablet keeps its WHOLE piste).
 *
 * `GET /staff/lices/:liceId/bouts` gives each bout as the bout screen reads one
 * bout: its row and its summary. `boutOf` (`bout-read.ts`) builds both.
 *
 * REFUSED is not "nothing here". The route is for a PIN session assigned to the
 * piste, on an Event that is not over: an organiser with an account, a session
 * that ended, a finished Event all get a 401 or a 403. The tablet then keeps
 * what it holds: a pad still sends its queue after its Event has closed.
 *
 * Pure but for the fetch it is given.
 */
import type { MatchInfo } from '../components/MatchView';
import { classifySyncFailure, type FailureBody } from '../offline/failure-kind';
import { boutOf, type BoutRow, type BoutSummary } from './bout-read';

export type PisteRead =
  /**
   * The bouts of the piste, in the order of the piste list. A bout with no
   * summary has no names and no Tournament id, as on the bout screen.
   */
  | { kind: 'piste'; bouts: MatchInfo[] }
  /** No network: nothing is known. */
  | { kind: 'unreachable' }
  /** This session may not read the piste (401, 403). */
  | { kind: 'refused' }
  /** The server answered with a fault, or with something that is no piste. */
  | { kind: 'failed' };

interface PisteBody {
  bouts?: Array<{ match?: BoutRow | null; summary?: BoutSummary | null }>;
}

export async function readPiste(
  apiUrl: string,
  liceId: string,
  fetchFn: typeof fetch = fetch,
): Promise<PisteRead> {
  let res: Response;
  try {
    res = await fetchFn(`${apiUrl}/api/v1/staff/lices/${liceId}/bouts`, {
      credentials: 'include',
      cache: 'no-store',
    });
  } catch {
    return { kind: 'unreachable' };
  }
  if (res.status === 401 || res.status === 403) return { kind: 'refused' };
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as FailureBody | null;
    const offline = classifySyncFailure(res.status, body) === 'offline';
    return { kind: offline ? 'unreachable' : 'failed' };
  }
  const body = (await res.json().catch(() => null)) as PisteBody | null;
  if (!body || !Array.isArray(body.bouts)) return { kind: 'failed' };
  const bouts: MatchInfo[] = [];
  for (const { match, summary } of body.bouts) {
    if (!match?.id) return { kind: 'failed' };
    bouts.push(boutOf(match, summary ?? null));
  }
  return { kind: 'piste', bouts };
}
