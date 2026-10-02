/**
 * followers-removal.ts — her "people may follow me" switched off removes her followers (operator
 * ruling 208).
 *
 * Léa switches the choice off. The people who already followed her used to stay: she stayed in
 * Marc's "Following" tab, and he was still told before her bouts. Now the follows on her go, in
 * every Event, with each follower's waiting alerts about her. Switched on again, people must
 * follow her again.
 *
 * A leaf, called by the privacy controller: `FollowsService` depends on `PrivacyService`, so a
 * call from the privacy service into the follows service would be a module cycle. The fighter
 * merge calls it too, by profile, when it leaves its survivor "off" (ruling 212): what a failure
 * leaves there is said at that call (`merge.service.ts`).
 *
 * THE ORDER keeps a failure repairable. The followers are read before anything is deleted, and
 * their rows go LAST: once a row is gone, nothing says whose alerts are left. In between the rows
 * are MUTED, because the scheduler sets a follower's alerts again from his follows as saved
 * (`applyFollow`): a muted follow wants none, and an alert that also serves another follow of his
 * (her opponent, whom he follows too) stays.
 *
 * A hub follow has a switch too (ruling 217): the ones that are on are muted once her roster
 * rows are read, before any Event follow is touched; their followers' waiting duty alerts go
 * once the Event follows are gone, and the hub follows go last. A second run after a failure
 * finds those switches off and walks nobody: an alert left then stays in the queue and does not
 * ring (`alert-still-wanted.ts`).
 *
 * WHAT A FAILURE LEAVES. The choice is saved before this runs, so no new follow lands
 * (`FollowsService.follow` refuses), and a failure here answers a 5xx with the choice already off
 * and her followers muted, not gone. The settings page puts its switch back to on, so her next
 * tap sends "off" again and this runs again. After a reload the page reads off: the repair is
 * then on, and off again.
 *
 * Races, named. Each needs a call that was already running when she saved:
 * - a follow that passed the check, and is inserted after the followers were read here: its row
 *   goes with the delete, or stays when nobody followed her yet (not closed);
 * - a "follow everywhere" whose directory follow lands after the delete below: she stays in his
 *   "Following" tab, and each Event follow is then refused (not closed);
 * - a follower who turns a switch back on between the mute and the delete, or a retime that read
 *   his follow before the mute: an alert is set again after his were removed.
 * An alert left behind by any of them does not ring once its follow is gone: the follows are read
 * again when it fires (`alert-still-wanted.ts`, ruling 213).
 */
import { isOver } from '../../common/live-status';
import type { FollowNotificationSchedulerService } from '../../workers/follow-notification-scheduler.worker';
import type { SupabaseService } from '../supabase/supabase.service';

export interface FollowersRemovalDeps {
  supabase: SupabaseService;
  alerts: Pick<FollowNotificationSchedulerService, 'applyFollow' | 'applyHubFollow'>;
}

interface Answer {
  data: unknown;
  error: { message: string } | null;
}

/** Every switch of a follow off: it wants no alert. */
const MUTED = {
  notify_match_start: false,
  notify_referee_start: false,
  notify_workshop_start: false,
};

/** A failed read or write is a plain Error, a 5xx: never "nobody follows her". */
function answered(what: string, { data, error }: Answer): unknown {
  if (error) throw new Error(`${what} failed: ${error.message}`);
  return data;
}

/** A to-one embed, as PostgREST hands it: an object or a one-element array. */
const one = (value: unknown): Record<string, unknown> | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as Record<string, unknown> | null;

/**
 * Removes the followers of the live profile this account holds. Safe to run again: the privacy
 * controller calls it on EVERY save that says "off", not only on the one that changes the choice.
 */
export async function removeFollowersOf(deps: FollowersRemovalDeps, userId: string): Promise<void> {
  const db = deps.supabase.service;
  const profile = answered(
    'followed profile read',
    await db
      .from('global_persons')
      .select('id')
      .eq('claimed_by_user_id', userId)
      .is('merged_into_id', null)
      .maybeSingle(),
  ) as { id: string } | null;
  if (profile) await removeFollowersOfProfile(deps, profile.id);
}

/**
 * Removes the followers of one profile, whoever holds it. The door of a merge that leaves its
 * surviving profile "off" (ruling 212): the survivor may have no account, or another one.
 */
export async function removeFollowersOfProfile(
  deps: FollowersRemovalDeps,
  profileId: string,
): Promise<void> {
  const db = deps.supabase.service;
  // One roster row per Event she is in: a short list, so it rides in the URL as it is.
  const roster = (answered(
    'followed roster rows read',
    await db.from('persons').select('id, events ( status )').eq('global_person_id', profileId),
  ) ?? []) as Array<{ id: string; events: unknown }>;
  const rowIds = roster.map((row) => row.id);
  // The hub switches that are on go off before any follow is touched, in one statement that
  // hands back whose they were (ruling 217): only they can have an alert set by a hub follow,
  // about a duty in an Event where they have no Event follow. Muted, the scheduler sets none of
  // them again.
  const hubFollowers = (
    (answered(
      'directory followers mute',
      await db
        .from('directory_follows')
        .update({ notify_referee_start: false })
        .eq('followed_global_person_id', profileId)
        .eq('notify_referee_start', true)
        .select('follower_user_id'),
    ) ?? []) as Array<{ follower_user_id: string }>
  ).map((row) => row.follower_user_id);
  if (rowIds.length > 0) await removeEventFollows(deps, roster, rowIds);
  await deps.alerts.applyHubFollow(profileId, hubFollowers);

  answered(
    'directory followers delete',
    await db.from('directory_follows').delete().eq('followed_global_person_id', profileId),
  );
}

/** The follows on her roster rows: muted, their alerts removed, then deleted. */
async function removeEventFollows(
  deps: FollowersRemovalDeps,
  roster: Array<{ id: string; events: unknown }>,
  rowIds: string[],
): Promise<void> {
  const db = deps.supabase.service;
  const follows = (answered(
    'followers read',
    await db
      .from('follows')
      .select('followed_person_id, follower_user_id')
      .in('followed_person_id', rowIds),
  ) ?? []) as Array<{ followed_person_id: string; follower_user_id: string | null }>;
  if (follows.length === 0) return;

  answered(
    'followers mute',
    await db.from('follows').update(MUTED).in('followed_person_id', rowIds),
  );
  const notOver = new Set(
    roster.filter((row) => !isOver(one(row.events)?.['status'])).map((row) => row.id),
  );
  // One follower at a time: each call reads and writes for one account, inside this request.
  for (const follow of follows) {
    // A guest session has no account to tell, so it has no alert.
    if (!follow.follower_user_id || !notOver.has(follow.followed_person_id)) continue;
    await deps.alerts.applyFollow(follow.followed_person_id, follow.follower_user_id);
  }
  answered('followers delete', await db.from('follows').delete().in('followed_person_id', rowIds));
}
