/**
 * alert-still-wanted.ts — is a "starting soon" still WANTED when it fires? (operator ruling 213)
 *
 * An alert is queued when a bout, a duty or a Workshop gets its time, and it is removed or set
 * again when a follow or a booking changes. Each of those steps leaves a gap. Marc unfollows Léa
 * at the second an organiser moves her bout: the retime had read his follow, and writes his alert
 * back after it was removed. A booking is cancelled while the queue is down: its alert stays. A
 * roster row goes to another account: the old holder's alert stays.
 *
 * So the saved rows are read once more when the alert fires, and they decide:
 * - a follower's alert rings only if a saved follow of that account still wants it (for a
 *   duty, an Event follow or a hub follow: `referee-alert-followers.ts`);
 * - a duty's alert, the referee's own or a follower's, only while the duty is locked (ruling
 *   220): the unlock removes no alert, so this check is what silences an unlocked board;
 * - the alert of a booked Workshop, only if a roster row the account holds has a confirmed seat;
 * - a Fighter's own bout alert, only if the account holds the roster row of a Fighter of the bout.
 *
 * It sits beside `alert-visibility.ts`, which asks whether the thing is PUBLIC. That one runs
 * first: a draft's alert is dropped without reading who wanted it. A wrong TIME is not this
 * check's business: the retime owns it.
 */
import type { SupabaseService } from '../modules/supabase/supabase.service';
import type { NotificationKind, ScheduledNotificationJob } from './notification-scheduler.worker';
import { refereeAlertFollowers } from './referee-alert-followers';

type Db = SupabaseService['service'];
/** Does this account still want the alert about this bout, duty or session? */
type Wanted = (db: Db, entityId: string, userId: string) => Promise<boolean>;

interface Answer {
  data: unknown;
  error: { message: string } | null;
}

/** What a read answered. A failed read fails the job: it does not say "not wanted". */
function read<T>(what: string, { data, error }: Answer): T {
  if (error) throw new Error(`${what} read failed: ${error.message}`);
  return data as T;
}

/** The roster rows of the two Fighters of a bout; none when the bout is gone. */
async function fightersOf(db: Db, boutId: string): Promise<string[]> {
  const bout = read<{
    red_registration_id: string | null;
    blue_registration_id: string | null;
  } | null>(
    'alert bout',
    await db
      .from('matches')
      .select('red_registration_id, blue_registration_id')
      .eq('id', boutId)
      .maybeSingle(),
  );
  const entries = [bout?.red_registration_id, bout?.blue_registration_id].filter(
    (id): id is string => Boolean(id),
  );
  if (entries.length === 0) return [];
  const rows = read<Array<{ person_id: string | null }> | null>(
    'alert bout entries',
    await db.from('registrations').select('person_id').in('id', entries),
  );
  return (rows ?? []).map((row) => row.person_id).filter((id): id is string => Boolean(id));
}

type FollowSwitch = 'notify_match_start' | 'notify_workshop_start';

/** Does the account follow one of these roster rows, with this switch on? */
async function follows(
  db: Db,
  userId: string,
  personIds: string[],
  wants: FollowSwitch,
): Promise<boolean> {
  if (personIds.length === 0) return false;
  const rows = read<unknown[] | null>(
    'alert follows',
    await db
      .from('follows')
      .select('id')
      .eq('follower_user_id', userId)
      .eq(wants, true)
      .in('followed_person_id', personIds)
      .limit(1),
  );
  return (rows ?? []).length > 0;
}

/** The roster rows of these profiles in one Event: what a follow is keyed on. */
async function rosterRowsOf(db: Db, profileIds: string[], eventId: string): Promise<string[]> {
  if (profileIds.length === 0) return [];
  const rows = read<Array<{ id: string }> | null>(
    'alert roster rows',
    await db
      .from('persons')
      .select('id')
      .in('global_person_id', profileIds)
      .eq('event_id', eventId),
  );
  return (rows ?? []).map((row) => row.id);
}

const followsAFighter: Wanted = async (db, boutId, userId) =>
  follows(db, userId, await fightersOf(db, boutId), 'notify_match_start');

/** A duty as the check reads it: its referee, its Event, and whether it is locked. */
interface DutyRow {
  person_id: string | null;
  event_id: string | null;
  status: string | null;
}

/**
 * The duty, while it is LOCKED (operator ruling 220); null when it is unlocked or gone. The lock
 * is what tells a referee his duty. An unlocked board is being planned again: its alerts wait in
 * the queue, ring for nobody, and the next lock sets them again.
 */
async function lockedDuty(db: Db, dutyId: string): Promise<DutyRow | null> {
  const duty = read<DutyRow | null>(
    'alert referee duty',
    await db
      .from('referee_assignments')
      .select('person_id, event_id, status')
      .eq('id', dutyId)
      .maybeSingle(),
  );
  return duty?.status === 'confirmed' ? duty : null;
}

const dutyIsLocked: Wanted = async (db, dutyId) => (await lockedDuty(db, dutyId)) !== null;

const followsTheReferee: Wanted = async (db, dutyId, userId) => {
  const duty = await lockedDuty(db, dutyId);
  if (!duty?.person_id || !duty.event_id) return false;
  // The rule the scheduler set the alert by, asked again for this account alone (ruling 217).
  const alerted = await refereeAlertFollowers(
    db,
    { profileId: duty.person_id, eventId: duty.event_id },
    read,
    userId,
  );
  return alerted.includes(userId);
};

const followsAnInstructor: Wanted = async (db, sessionId, userId) => {
  const session = read<{ workshop_id: string | null; workshops?: unknown } | null>(
    'alert Workshop session',
    await db
      .from('workshop_sessions')
      .select('workshop_id, workshops ( event_id )')
      .eq('id', sessionId)
      .maybeSingle(),
  );
  // A to-one embed, as PostgREST hands it: an object or a one-element array.
  const workshop = (
    Array.isArray(session?.workshops) ? session.workshops[0] : session?.workshops
  ) as { event_id?: string | null } | null | undefined;
  if (!session?.workshop_id || !workshop?.event_id) return false;
  const instructors = read<Array<{ global_person_id: string | null }> | null>(
    'alert instructors',
    await db
      .from('workshop_instructors')
      .select('global_person_id')
      .eq('workshop_id', session.workshop_id),
  );
  // An instructor typed as text only has no profile, so nobody follows him.
  const profiles = (instructors ?? [])
    .map((row) => row.global_person_id)
    .filter((id): id is string => Boolean(id));
  const rows = await rosterRowsOf(db, profiles, workshop.event_id);
  return follows(db, userId, rows, 'notify_workshop_start');
};

/** The roster rows this account holds, among `personIds` when given. */
async function heldRows(db: Db, userId: string, personIds?: string[]): Promise<string[]> {
  const query = db.from('persons').select('id').eq('claimed_by_user_id', userId);
  const rows = read<Array<{ id: string }> | null>(
    'alert roster rows',
    await (personIds ? query.in('id', personIds) : query),
  );
  return (rows ?? []).map((row) => row.id);
}

const holdsAConfirmedSeat: Wanted = async (db, sessionId, userId) => {
  // A booking names a roster row, not an account (`workshop_enrollments.user_id`).
  const rows = await heldRows(db, userId);
  if (rows.length === 0) return false;
  const seats = read<unknown[] | null>(
    'alert booking',
    await db
      .from('workshop_enrollments')
      .select('id')
      .eq('workshop_session_id', sessionId)
      .eq('status', 'confirmed')
      .in('user_id', rows)
      .limit(1),
  );
  return (seats ?? []).length > 0;
};

const holdsAFightersRow: Wanted = async (db, boutId, userId) => {
  const fighters = await fightersOf(db, boutId);
  if (fighters.length === 0) return false;
  return (await heldRows(db, userId, fighters)).length > 0;
};

/**
 * What each kind is checked against when it fires; null = not checked here. Every kind is named:
 * a new one fails the typecheck until it is placed.
 */
const WANTED: Record<NotificationKind, Wanted | null> = {
  follow_match_starting: followsAFighter,
  follow_referee_starting: followsTheReferee,
  follow_workshop_starting: followsAnInstructor,
  workshop_starting: holdsAConfirmedSeat,
  match_starting: holdsAFightersRow,
  // The referee's own alert: set for the account that holds his profile. The holder is not asked
  // again here, so not closed: a profile that changes holder leaves the old account's alert.
  referee_starting: dutyIsLocked,
  // The lock message: sent at once, by the lock, and again as a draft goes live
  // (`lockedDutiesPublished`).
  assignment_changed: null,
  // Sent at once, to a recipient decided at that moment.
  workshop_cancelled: null,
  waitlist_promoted: null,
  results_published: null,
  exchange_edit_rejected: null,
  exchange_edit_approved: null,
  organizer_broadcast: null,
  organizer_published_event: null,
  swiss_round_published: null,
};

export async function isStillWanted(
  supabase: SupabaseService,
  job: Pick<ScheduledNotificationJob, 'kind' | 'entityId' | 'userId'>,
): Promise<boolean> {
  const check = WANTED[job.kind];
  return check ? check(supabase.service, job.entityId, job.userId) : true;
}
