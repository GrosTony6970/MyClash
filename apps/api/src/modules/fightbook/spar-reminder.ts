import type { Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { zonedToUtcIso } from '@myclash/time';
import type { NotificationSchedulerService } from '../../workers/notification-scheduler.worker';
import { sparStarting } from '../notifications/notice-texts/notice-texts';

export const SPAR_REMINDER_LEAD_MINUTES = 10;

export interface SparReminderDeps {
  db: Pick<SupabaseClient, 'from'>;
  notifications: Pick<NotificationSchedulerService, 'scheduleReminder'>;
  logger: Pick<Logger, 'warn' | 'error'>;
}

interface SparRow {
  status: string;
  spar_day: string;
  spar_time: string | null;
  zone: string;
  asker_global_person_id: string;
  receiver_global_person_id: string;
}

const SPARS = '/me/fightbook?tab=spars';

/**
 * The phone reminder of an agreed spar that has a time, to both fighters, 10 minutes before it
 * starts. Called once, when the spar becomes agreed (a Yes, a pick), and started, not awaited. A
 * spar agreed inside its last 10 minutes gets none (ruling 745). Nothing removes the job later:
 * `alert-still-wanted.ts` asks again when it fires. No names (a locked phone) and no email
 * (ruling 746). Never throws: the spar is already saved; a failure is logged with the request id.
 */
export async function scheduleSparReminders(
  d: SparReminderDeps,
  requestId: string,
  now = new Date(),
): Promise<void> {
  try {
    const { data, error } = await d.db
      .from('spar_requests')
      .select(
        'status, spar_day, spar_time, zone, asker_global_person_id, receiver_global_person_id',
      )
      .eq('id', requestId)
      .maybeSingle();
    if (error) throw new Error(`spar unreadable: ${error.message}`);
    const spar = data as SparRow | null;
    if (spar?.status !== 'agreed' || !spar.spar_time) return;
    // PostgREST returns a TIME as '15:00:00'; `zonedToUtcIso` takes only 'HH:MM'.
    const startsAt = zonedToUtcIso(spar.spar_day, spar.spar_time.slice(0, 5), spar.zone);
    if (!startsAt) return;
    const rings = new Date(startsAt).getTime() - SPAR_REMINDER_LEAD_MINUTES * 60_000;
    if (rings <= now.getTime()) return;
    await ring(d, requestId, startsAt, [
      spar.asker_global_person_id,
      spar.receiver_global_person_id,
    ]);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    d.logger.error(`FightBook spar_starting of ${requestId} was not set: ${reason}`);
  }
}

async function ring(
  d: SparReminderDeps,
  requestId: string,
  startsAt: string,
  profiles: string[],
): Promise<void> {
  const { data, error } = await d.db
    .from('global_persons')
    .select('id, claimed_by_user_id')
    .in('id', profiles);
  if (error) throw new Error(`profiles unreadable: ${error.message}`);
  const accounts = ((data ?? []) as Array<{ claimed_by_user_id: string | null }>)
    .map((profile) => profile.claimed_by_user_id)
    .filter((userId): userId is string => Boolean(userId));
  if (accounts.length < profiles.length) {
    d.logger.warn(`FightBook spar_starting of ${requestId}: a profile has no account; not set`);
  }
  const { title, body } = sparStarting();
  for (const userId of new Set(accounts)) {
    await d.notifications.scheduleReminder({
      kind: 'spar_starting',
      entityId: requestId,
      userId,
      startsAt,
      leadMinutes: SPAR_REMINDER_LEAD_MINUTES,
      title,
      body,
      url: SPARS,
      preference: 'fightbook',
    });
  }
}
