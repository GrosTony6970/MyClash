/**
 * The bracket override's referee writes: one PUT per changed role, in order, through the
 * per-bout door, which asks the one referee checker (ADR-016). Stops at the first write
 * that did not land.
 *
 * `confirmed` = the roles the organiser confirmed over their amber reasons, one at a time.
 * Only those carry `confirm: true`, so a later role is never confirmed unseen.
 */
import { apiRequest, type ApiFailure } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { refereeRefusal, type RefereeRefusal } from '@/lib/referee-reasons';
import type { RoleAssignment } from './diff-role-assignments';

const apiUrl = getPublicApiUrl();

export type RoleSaveOutcome =
  | { ok: true }
  | { ok: false; role: string; refusal: RefereeRefusal }
  | { ok: false; role: string; failure: ApiFailure };

export async function saveRoleChanges(
  matchId: string,
  changes: readonly RoleAssignment[],
  confirmed: readonly string[],
): Promise<RoleSaveOutcome> {
  for (const change of changes) {
    const r = await apiRequest(apiUrl, `/api/v1/matches/${matchId}/referee-role-assignments`, {
      method: 'PUT',
      body: {
        role: change.role,
        refereeId: change.refereeId,
        ...(confirmed.includes(change.role) ? { confirm: true } : {}),
      },
    });
    if (r.ok) continue;
    const refusal = refereeRefusal(r);
    return refusal
      ? { ok: false, role: change.role, refusal }
      : { ok: false, role: change.role, failure: r };
  }
  return { ok: true };
}
