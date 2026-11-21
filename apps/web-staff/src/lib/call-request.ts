import { apiRequest, failureCode } from '@myclash/api-client';
import { classifySyncFailure } from '../offline/failure-kind';

/** Why a referee calls (ruling 952): the reasons the Live board names. */
export type CallReason = 'medic' | 'head_ref' | 'dispute';

export const CALL_REASONS: readonly CallReason[] = ['medic', 'head_ref', 'dispute'];

/**
 * `sent`: the control room's board shows the call. `offline`: no network, or a
 * server that is down: nobody saw it. `refused`: the server answered no (a
 * session that ended, an Event that is over).
 */
export type CallOutcome = 'sent' | 'offline' | 'refused';

/**
 * A referee's call from the pad: it raises "Needs attention" on the piste's row
 * of the Live board until an organiser acknowledges it.
 *
 * Never queued: a call that reaches nobody must say so now, so the referee
 * calls by voice. Not stopped by the offline drill either (`apiRequest`, not
 * `padRequest`): a call for a medic is never practice.
 */
export async function sendCall(apiUrl: string, reason: CallReason): Promise<CallOutcome> {
  const result = await apiRequest(apiUrl, '/api/v1/staff/attention', {
    method: 'POST',
    body: { reason },
  });
  if (result.ok) return 'sent';
  const status = result.kind === 'aborted' || result.kind === 'network' ? 0 : result.status;
  // The pad's one failure vocabulary: the service worker's 503 is no network.
  return classifySyncFailure(status, { code: failureCode(result) }) === 'offline'
    ? 'offline'
    : 'refused';
}
