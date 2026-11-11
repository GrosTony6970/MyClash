import type { Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseService } from '../supabase/supabase.service';
import type {
  ImmediateNotificationKind,
  NotificationSchedulerService,
} from '../../workers/notification-scheduler.worker';
import {
  sparAgreed,
  sparCancelled,
  sparRequestReceived,
  type NoticeEmailText,
} from '../notifications/notice-texts/notice-texts';

export interface SparNoticeDeps {
  db: Pick<SupabaseClient, 'from'>;
  notifications: Pick<NotificationSchedulerService, 'sendImmediate'>;
  supabase: Pick<SupabaseService, 'getAuthAdminUser'>;
  logger: Pick<Logger, 'warn' | 'error'>;
}

const INBOX = '/me/fightbook?tab=inbox';
const SPARS = '/me/fightbook?tab=spars';

/** A new request, to the fighter asked. */
export const notifySparRequestReceived = (d: SparNoticeDeps, requestId: string, receiver: string) =>
  notify(d, 'spar_request_received', requestId, receiver, sparRequestReceived(), INBOX);

/** A yes, to the fighter who asked. */
export const notifySparAgreed = (d: SparNoticeDeps, requestId: string, asker: string) =>
  notify(d, 'spar_agreed', requestId, asker, sparAgreed(), SPARS);

/** A cancelled spar, to the other fighter. */
export const notifySparCancelled = (d: SparNoticeDeps, requestId: string, other: string) =>
  notify(d, 'spar_cancelled', requestId, other, sparCancelled(), SPARS);

/**
 * One FightBook notice to the account that holds `profileId`, with that account's own address
 * for the email fallback (the referee lock message's rule, rulings 201, 201a). The FightBook
 * switch turns all three off (`preference: 'fightbook'`). A "Not this time" never comes here
 * (ruling 663).
 *
 * Never throws: the change it reports is saved before it is called, and the caller does not wait
 * for it (a blocked ask, which sends nothing, must answer as fast as every other ask). A profile no
 * account holds, an unreadable profile or a failed send is logged with the request id.
 */
async function notify(
  d: SparNoticeDeps,
  kind: ImmediateNotificationKind,
  requestId: string,
  profileId: string,
  text: NoticeEmailText,
  url: string,
): Promise<void> {
  try {
    const { data, error } = await d.db
      .from('global_persons')
      .select('claimed_by_user_id')
      .eq('id', profileId)
      .maybeSingle();
    if (error) throw new Error(`profile unreadable: ${error.message}`);
    const userId = (data as { claimed_by_user_id: string | null } | null)?.claimed_by_user_id;
    if (!userId) {
      d.logger.warn(`FightBook ${kind} of ${requestId}: no account holds the profile; not sent`);
      return;
    }
    const { status, data: account } = await d.supabase.getAuthAdminUser(userId);
    if (!account) d.logger.warn(`FightBook ${kind} of ${requestId}: account unreadable: ${status}`);
    await d.notifications.sendImmediate({
      kind,
      entityId: requestId,
      userId,
      email: account?.email ?? null,
      ...text,
      url,
      preference: 'fightbook',
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    d.logger.error(`FightBook ${kind} of ${requestId} was not sent: ${reason}`);
  }
}
