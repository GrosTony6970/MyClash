/**
 * The lock request (ADR-019): locking tells every referee their duty. `{}` asks the API
 * to refuse while a duty breaks a rule with no override (409 `referee_lock_impossible`);
 * `{ confirm: true }` sends anyway. Its own module so the body is pinned by a test.
 */
import { apiRequest, type ApiResult } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';

const apiUrl = getPublicApiUrl();

export function requestLock(eventId: string, confirm: boolean): Promise<ApiResult<unknown>> {
  return apiRequest(apiUrl, `/api/v1/events/${eventId}/lock-referee-assignments`, {
    method: 'POST',
    body: confirm ? { confirm: true } : {},
  });
}
