/**
 * A request of the bout screen that goes straight to the server, and not
 * through the queue: Reopen and Reset of the clock, Unlock, a forfeit, the
 * corrections, the void of an undo and the undo's read of the server.
 *
 * During the offline drill it is answered as a dead network is, and nothing
 * is sent (operator, 2026-10-12): the drill stopped the queue alone, so these
 * presses changed the server while the tablet said it was cut off. The answer
 * is the failure `apiRequest` builds from the service worker's own response,
 * so each caller says "no connection" through the path a real outage takes,
 * and the undo works on the tablet alone.
 *
 * The queue's own sends meet the drill in `SyncEngine.postExchange`. The
 * census of every request of the pad is `drill-census.test.ts`: a new one is
 * named there as stopped by the drill, or as left open with its reason.
 */
import { apiRequest, responseFailure, type ApiResult } from '@myclash/api-client';
import { isDrillActive } from './drill';
import { offlineResponse } from './failure-kind';

type Init = Parameters<typeof apiRequest>[2];

export async function padRequest<T>(
  apiUrl: string,
  path: string,
  init?: Init,
): Promise<ApiResult<T>> {
  if (!isDrillActive()) return apiRequest<T>(apiUrl, path, init);
  const answer = offlineResponse();
  return { ok: false, ...responseFailure(answer.status, await answer.json()) };
}
