/**
 * The lock request (ADR-019): locking tells every referee their duty. `{}` asks the API
 * to refuse while a duty breaks a rule with no override (409 `referee_lock_impossible`,
 * each duty with a `key`); `{ confirmedDuties }` sends anyway over exactly the duties the
 * refusal listed, by those keys (ruling 138). Its own module so the body is pinned.
 */
import { apiRequest, type ApiResult } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';

const apiUrl = getPublicApiUrl();

export function requestLock(
  eventId: string,
  confirmedDuties: readonly string[],
): Promise<ApiResult<unknown>> {
  return apiRequest(apiUrl, `/api/v1/events/${eventId}/lock-referee-assignments`, {
    method: 'POST',
    body: confirmedDuties.length > 0 ? { confirmedDuties } : {},
  });
}
