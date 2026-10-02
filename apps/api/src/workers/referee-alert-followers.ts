/**
 * referee-alert-followers.ts — who is alerted before a referee's duty (operator rulings 217,
 * 217a, 217b, 217c). The ONE owner of that rule: the scheduler that sets the alert and the check
 * that asks again when it fires both call it.
 *
 * A duty names a profile and an Event. A follow is one of two things:
 * - an Event follow, on a roster row of that profile in that Event, with its own switch
 *   (`follows.notify_referee_start`);
 * - a hub follow, on the profile itself, with one switch (`directory_follows.notify_referee_start`,
 *   off at first).
 *
 * An account is alerted when its Event follow has the switch on. An account with a hub follow
 * whose switch is on is alerted in every Event where it has NO Event follow of that person; where
 * it has one, that Event's own switch decides. So Marc, who follows Paul from the hub, hears of
 * Paul's duties in an Event where Paul has no roster row, and of the ones in an Event Paul joined
 * after the follow.
 *
 * A TEST Event is hidden from the public, and a hub follower is anybody. There the hub switch
 * rings only for a member of the Event's organisation, any role (ruling 217c). The ruling is
 * about the hub switch: an Event follow is asked for no membership, so one made while the Event
 * was still a standard one goes on ringing (ruling 185), and a platform admin or a staff account
 * that is no member gets no hub alert there. A draft is not this file's business: its alert is
 * dropped when it fires, for everyone (`alert-visibility.ts`).
 *
 * Before, only the roster rows of the Event were asked: a referee taken from the directory has
 * none there, so nothing could ring for his followers.
 */
import { asEventKind, isPubliclyVisible } from '@myclash/types';
import type { SupabaseService } from '../modules/supabase/supabase.service';

type Db = SupabaseService['service'];

/** What a PostgREST read answers. */
export interface Answer {
  data: unknown;
  error: { message: string } | null;
}

/**
 * The caller's rule for a failed read: it throws, or it says so itself and hands back `null`.
 * A read that worked hands back its rows. `loses` says what a caller that goes on gives up.
 */
export type RowsOf = (what: string, answer: Answer, loses: string) => unknown;

/** What a failed read costs when the caller goes on: everybody, or the hub followers alone. */
const NOBODY_TOLD = 'no follower reminder set';
const NO_HUB_FOLLOWER_TOLD = 'the hub followers get no reminder';

interface Duty {
  profileId: string;
  eventId: string;
}

interface EventFollow {
  follower_user_id: string | null;
  notify_referee_start: boolean | null;
}

/**
 * The accounts alerted before a duty of `profileId` in `eventId`; with `onlyFollower`, that
 * account alone, or nobody.
 *
 * A failed read of the roster rows or of the Event follows answers NOBODY: read as "no Event
 * follow", it would ring a hub follower whose Event switch is off. A failed read about the hub
 * followers leaves the Event followers alerted.
 */
export async function refereeAlertFollowers(
  db: Db,
  { profileId, eventId }: Duty,
  rows: RowsOf,
  onlyFollower?: string,
): Promise<string[]> {
  const roster = rows(
    'Roster rows of a referee',
    await db.from('persons').select('id').eq('global_person_id', profileId).eq('event_id', eventId),
    NOBODY_TOLD,
  ) as Array<{ id: string }> | null;
  if (!roster) return [];

  // No roster row means no Event follow: nothing to read.
  const rowIds = roster.map((row) => row.id);
  const eventFollows =
    rowIds.length === 0
      ? []
      : (rows(
          'Followers of a referee',
          await eventFollowsOn(db, rowIds, onlyFollower),
          NOBODY_TOLD,
        ) as EventFollow[] | null);
  if (!eventFollows) return [];

  // Exactly `true`: a switch that was never read is not "on". A guest session's follow names no
  // account: it alerts nobody.
  const alerted = new Set(
    eventFollows
      .filter((follow) => follow.notify_referee_start === true)
      .map((follow) => follow.follower_user_id)
      .filter((id): id is string => Boolean(id)),
  );
  const decidedByEvent = new Set(eventFollows.map((follow) => follow.follower_user_id));
  const hubFollows = rows(
    'Hub followers of a referee',
    await hubFollowsWithTheSwitchOn(db, profileId, onlyFollower),
    NO_HUB_FOLLOWER_TOLD,
  ) as Array<{ follower_user_id: string }> | null;
  const hubFollowers = (hubFollows ?? [])
    .map((row) => row.follower_user_id)
    .filter((id) => !decidedByEvent.has(id));
  for (const id of await whoMayBeTold(db, eventId, hubFollowers, rows, onlyFollower)) {
    alerted.add(id);
  }
  return [...alerted];
}

/** The Event follows on these roster rows, whatever their switch: the rule reads it. */
async function eventFollowsOn(db: Db, rowIds: string[], onlyFollower?: string): Promise<Answer> {
  const query = db
    .from('follows')
    .select('follower_user_id, notify_referee_start')
    .in('followed_person_id', rowIds);
  return onlyFollower === undefined ? query : query.eq('follower_user_id', onlyFollower);
}

async function hubFollowsWithTheSwitchOn(
  db: Db,
  profileId: string,
  onlyFollower?: string,
): Promise<Answer> {
  const query = db
    .from('directory_follows')
    .select('follower_user_id')
    .eq('followed_global_person_id', profileId)
    .eq('notify_referee_start', true);
  return onlyFollower === undefined ? query : query.eq('follower_user_id', onlyFollower);
}

/**
 * Among these hub followers, the ones a duty of this Event may be told to (ruling 217c): all of
 * them, but in a TEST Event only the members of its organisation. The kind alone is asked, not
 * the status: a draft's alert is set, and dropped when it fires unless the Event went public.
 * The members are read whole (a club has few), not by a list of followers in the URL.
 */
async function whoMayBeTold(
  db: Db,
  eventId: string,
  hubFollowers: string[],
  rows: RowsOf,
  onlyFollower?: string,
): Promise<string[]> {
  if (hubFollowers.length === 0) return [];
  const event = rows(
    'Event of a duty',
    await db.from('events').select('event_kind, organization_id').eq('id', eventId).maybeSingle(),
    NO_HUB_FOLLOWER_TOLD,
  ) as { event_kind: string | null; organization_id: string } | null;
  if (!event) return [];
  if (isPubliclyVisible(asEventKind(event.event_kind))) return hubFollowers;

  const members = db
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', event.organization_id);
  const found = rows(
    'Members of the club of a test Event',
    await (onlyFollower === undefined ? members : members.eq('user_id', onlyFollower)),
    NO_HUB_FOLLOWER_TOLD,
  ) as Array<{ user_id: string }> | null;
  const isMember = new Set((found ?? []).map((row) => row.user_id));
  return hubFollowers.filter((id) => isMember.has(id));
}
