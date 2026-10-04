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
 * Two callers can close one request: this, and a review (a click on Approve or
 * on Reject, `FrozenResultsGuard.closeReviewed`). Each update names
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
  correctionHitChanged,
  correctionRejectedTitle,
} from '../notifications/notice-texts/notice-texts';
import type { SupabaseService } from '../supabase/supabase.service';
import type { ExchangeEditRequestRow, ExchangeEditRequestType } from './frozen-results.guard';

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

/** The body is the reason as the reviewer wrote it, or the fixed reason of ruling 254. */
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
 * request then names no reviewer (as `rejectPendingEditsForMatch` does).
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
