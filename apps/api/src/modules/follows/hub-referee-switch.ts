/**
 * hub-referee-switch.ts — the hub follow's switch "notify when refereeing" (operator rulings
 * 217, 217a).
 *
 * A follow made from the People hub is on a person's profile. It carries ONE switch, off at
 * first: tell me before he referees, in every Event where I have no Event follow of him
 * (`workers/referee-alert-followers.ts` owns that rule). This is its write, and what follows it.
 *
 * A leaf of `FollowsService`, which is long: the hub's PATCH and the hub unfollow both write the
 * switch, through the one statement below.
 */
import { NotFoundException } from '@nestjs/common';
import type { FollowNotificationSchedulerService } from '../../workers/follow-notification-scheduler.worker';
import type { SupabaseService } from '../supabase/supabase.service';

export interface HubSwitchDeps {
  supabase: SupabaseService;
  alerts: Pick<FollowNotificationSchedulerService, 'applyHubFollow'>;
}

/**
 * ONE statement on the account's own hub follow of that person; how many rows it changed (0 or
 * 1). PostgREST hands back no row unless asked, and "no row" is how a missing follow is told.
 * A failed write is a plain Error, a 5xx: never "no follow".
 */
export async function writeHubSwitch(
  supabase: SupabaseService,
  userId: string,
  globalPersonId: string,
  on: boolean,
): Promise<number> {
  const { data, error } = await supabase.service
    .from('directory_follows')
    .update({ notify_referee_start: on })
    .eq('follower_user_id', userId)
    .eq('followed_global_person_id', globalPersonId)
    .select('followed_global_person_id');
  if (error) throw new Error(`directory follow write failed: ${error.message}`);
  return (data as unknown[] | null)?.length ?? 0;
}

/**
 * Saves the switch, and it acts at once, as an Event follow's switch does (ruling 209): off
 * removes his waiting alerts about that person's duties, on sets them. Not best effort: the
 * switch is saved, a failure after it fails the call, and the same call again repairs the alerts.
 */
export async function setHubRefereeAlert(
  deps: HubSwitchDeps,
  globalPersonId: string,
  userId: string,
  on: boolean,
): Promise<{ globalPersonId: string; notifyRefereeStart: boolean }> {
  const saved = await writeHubSwitch(deps.supabase, userId, globalPersonId, on);
  // No row: he has no hub follow of that person (any more). A 404, the same for a person nobody
  // knows.
  if (saved === 0) throw new NotFoundException('Follow not found');
  await deps.alerts.applyHubFollow(globalPersonId, [userId]);
  return { globalPersonId, notifyRefereeStart: on };
}
