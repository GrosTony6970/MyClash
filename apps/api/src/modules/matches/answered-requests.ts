/**
 * A waiting correction request that a direct correction answers (rulings 253,
 * 253a, 254).
 *
 * A request names a hit and what to do with it. When somebody who needs no
 * review does that to the hit, the request can never be approved again
 * ("Exchange is already voided") and holds its slot in the review queue: the
 * index on `(exchange_id, request_type)` of pending rows allows one.
 *
 * - The same correction (a void for a void request, a restore for a restore
 *   request) closes the request as approved.
 * - An EDIT voids the hit and writes another in its place. A request to void
 *   the hit is then closed as rejected: the hit it named is gone, and a hit
 *   nobody asked about counts.
 *
 * Three callers can close one request: this, a review (a click on Approve or
 * on Reject, `FrozenResultsGuard.closeReviewed`) and a reset of the bout
 * (`closeResetRequests`, below). Each update names
 * `status = pending` and reads back what it changed, so only the call that
 * closed a request logs it and tells who asked.
 *
 * It runs AFTER the score is computed: the close waits on the notice queue, and
 * a score must not wait on a notice.
 */
import type { Logger } from '@nestjs/common';
import { insertAuditLog } from '../../common/audit-log';
import type { NotificationSchedulerService } from '../../workers/notification-scheduler.worker';
import {
  correctionApproved,
  correctionBoutReset,
  correctionHitChanged,
  correctionRejectedTitle,
} from '../notifications/notice-texts/notice-texts';
import type { SupabaseService } from '../supabase/supabase.service';
import type { ExchangeEditRequestRow, ExchangeEditRequestType } from './frozen-results.guard';

/**
 * Why every hit of a bout stopped counting: a reset voided them, or a door
 * deleted the bout with its phase (`phases/discard-fought-bouts.ts`, rulings
 * 276, 277). The audit line of each closed request says which.
 */
export type ResetCause = 'bout_reset' | 'bout_deleted';

/** What was done to the hit, by somebody who needs no review. */
export type DirectCorrection = ExchangeEditRequestType | 'edit';

export interface RequestClosureDeps {
  supabase: SupabaseService;
  notifications: NotificationSchedulerService;
  logger: Logger;
}

type Asker = Pick<ExchangeEditRequestRow, 'id' | 'requested_by_user_id'>;

/** Every approval tells who asked (ruling 253a). */
export async function tellApproved(deps: RequestClosureDeps, request: Asker): Promise<void> {
  await deps.notifications.sendImmediate({
    kind: 'exchange_edit_approved',
    entityId: request.id,
    userId: request.requested_by_user_id,
    ...correctionApproved(),
    url: '/notifications',
    preference: 'schedule_changes',
  });
}

/** The body is the reason as the reviewer wrote it, or a fixed reason (rulings 254, 257). */
export async function tellRejected(
  deps: RequestClosureDeps,
  request: Asker,
  reason: string,
): Promise<void> {
  await deps.notifications.sendImmediate({
    kind: 'exchange_edit_rejected',
    entityId: request.id,
    userId: request.requested_by_user_id,
    title: correctionRejectedTitle(),
    body: reason,
    url: '/notifications',
    preference: 'schedule_changes',
  });
}

/**
 * Close the requests this correction answers. Never throws: the correction has
 * landed, and a failed close must not answer its author with an error.
 *
 * `actorUserId` is absent for a pad: a staff account is not an account, and the
 * request then names no reviewer (as `closeResetRequests` does).
 */
export async function closeAnsweredRequests(
  deps: RequestClosureDeps,
  hit: { exchangeId: string; did: DirectCorrection; actorUserId?: string },
): Promise<void> {
  try {
    const edited = hit.did === 'edit';
    const reason = correctionHitChanged();
    const now = new Date().toISOString();
    const { data, error } = await deps.supabase.service
      .from('exchange_edit_requests')
      .update({
        ...(edited ? { status: 'rejected', rejection_reason: reason } : { status: 'approved' }),
        reviewed_by_user_id: hit.actorUserId ?? null,
        reviewed_at: now,
        updated_at: now,
      })
      .eq('exchange_id', hit.exchangeId)
      .eq('request_type', edited ? 'void_exchange' : hit.did)
      .eq('status', 'pending')
      .select('*');
    if (error) throw new Error(error.message);

    for (const request of (data ?? []) as ExchangeEditRequestRow[]) {
      const audit = await insertAuditLog(deps.supabase.service, {
        actorUserId: hit.actorUserId ?? null,
        action: edited ? 'exchange_edit_request.reject' : 'exchange_edit_request.approve',
        entityType: 'exchange_edit_request',
        entityId: request.id,
        payload: edited
          ? { request, reason, answeredBy: hit.did }
          : { request, answeredBy: hit.did },
      });
      if (audit.error) {
        deps.logger.warn(`No audit row for request ${request.id}: ${audit.error.message}`);
      }
      await (edited ? tellRejected(deps, request, reason) : tellApproved(deps, request));
    }
  } catch (cause) {
    deps.logger.warn(
      `Could not close the requests on exchange ${hit.exchangeId}: ${(cause as Error).message}`,
    );
  }
}

/**
 * Close the pending requests of bouts whose hits a reset has just voided
 * (rulings 257, 260), and hand back the ones this call closed.
 *
 * A request names an EXCHANGE. Once a reset voids every exchange of its bout,
 * both pending shapes rot, in opposite directions:
 *
 *   - `void_exchange` can never be approved again. `voidExchange` refuses an
 *     already-voided exchange, so the row sits in the review queue forever and
 *     holds the one pending slot of its hit.
 *   - `revert_void_exchange` is worse, because it still WORKS. Approving one
 *     un-voids a hit the reset threw away and recomputes the score of a bout
 *     nobody has fought yet.
 *
 * A reopen that KEEPS the hits (a clock reopen, a status change) closes nothing:
 * the request still names a hit that counts, and it waits (ruling 260).
 *
 * Rejected rather than deleted: somebody asked, and is told why. The update
 * names `status = pending` and reads back what it changed, so only the call
 * that closed a request logs it and tells who asked. `reviewed_by_user_id` is
 * the actor or NULL: a pad's staff account is not an account.
 *
 * Never throws: the reset has landed, and a failed close must not fail it. It
 * tells nobody: the reset has steps left, and none of them waits on the notice
 * queue (`tellResetRequests`, called last).
 */
export async function closeResetRequests(
  deps: RequestClosureDeps,
  matchIds: readonly string[],
  actorUserId?: string,
  cause: ResetCause = 'bout_reset',
): Promise<ExchangeEditRequestRow[]> {
  if (matchIds.length === 0) return [];
  const reason = correctionBoutReset();
  let closed: ExchangeEditRequestRow[];
  try {
    const now = new Date().toISOString();
    const { data, error } = await deps.supabase.service
      .from('exchange_edit_requests')
      .update({
        status: 'rejected',
        reviewed_by_user_id: actorUserId ?? null,
        reviewed_at: now,
        rejection_reason: reason,
        updated_at: now,
      })
      .in('match_id', [...matchIds])
      .eq('status', 'pending')
      .select('*');
    if (error) throw new Error(error.message);
    closed = (data ?? []) as ExchangeEditRequestRow[];
  } catch (cause) {
    deps.logger.warn(
      `Could not close pending exchange edits for ${matchIds.join(', ')}: ${(cause as Error).message}`,
    );
    return [];
  }

  // The requests are closed by now: a lost audit line must not hide them from the telling.
  for (const request of closed) {
    const audit = await insertAuditLog(deps.supabase.service, {
      actorUserId: actorUserId ?? null,
      action: 'exchange_edit_request.reject',
      entityType: 'exchange_edit_request',
      entityId: request.id,
      payload: { request, reason, answeredBy: cause },
    }).catch((cause: Error) => ({ error: cause }));
    if (audit.error) {
      deps.logger.warn(`No audit row for request ${request.id}: ${audit.error.message}`);
    }
  }
  return closed;
}

/** Tell who asked for each request a reset closed. Never throws; one failed notice stops no other. */
export async function tellResetRequests(
  deps: RequestClosureDeps,
  closed: readonly Asker[],
): Promise<void> {
  for (const request of closed) {
    await tellRejected(deps, request, correctionBoutReset()).catch((cause: Error) => {
      deps.logger.warn(`Could not tell who asked for request ${request.id}: ${cause.message}`);
    });
  }
}
