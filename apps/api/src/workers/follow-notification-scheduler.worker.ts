import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  followMatch,
  followReferee,
  followWorkshop,
} from '../modules/notifications/notice-texts/notice-texts';
import { isOver } from '../common/live-status';
import { readDutyStart } from '../modules/schedule/duty-windows';
import { SupabaseService } from '../modules/supabase/supabase.service';
import {
  computeNotificationDelayMs,
  NOTIFICATION_QUEUE,
  NOTIFICATION_SEND_JOB,
  type ScheduledNotificationJob,
} from './notification-scheduler.worker';
import { refereeAlertFollowers } from './referee-alert-followers';

interface MatchRow {
  id: string;
  match_number_label: string | null;
  scheduled_at: string | null;
  red_registration_id: string | null;
  blue_registration_id: string | null;
  lices?: { name?: string | null } | null;
  pools?: { name?: string | null } | null;
}

interface RegistrationRow {
  id: string;
  person_id: string | null;
  persons?: { given_name?: string | null; family_name?: string | null } | null;
}

interface FollowRow {
  followed_person_id: string | null;
  follower_user_id: string | null;
  notify_match_start?: boolean | null;
  notify_workshop_start?: boolean | null;
}

interface WorkshopSessionRow {
  id: string;
  starts_at: string | null;
  status: string | null;
  workshops?: { id?: string | null; title?: string | null; event_id?: string | null } | null;
}

interface RefereeAssignmentRow {
  id: string;
  person_id: string | null;
  event_id: string | null;
  pool_id: string | null;
  match_id: string | null;
  role: string | null;
  status: string | null;
  matches?: {
    match_number_label?: string | null;
    lices?: { name?: string | null } | null;
  } | null;
}

/** A Workshop session that can ring: timed, not cancelled, of a Workshop in an Event. */
interface TimedSession {
  id: string;
  startsAt: string;
  workshop: { id: string; title: string | null; eventId: string };
}

/** What a PostgREST read answers. */
interface Read {
  data: unknown;
  error: { message: string } | null;
}

/** What a failed read does at a retime, which is best effort: the end of its warning. */
const KEPT = '; their follower alerts stay as they were';
const NONE_SET = '; no follower reminder set';
const STAND_IN = '; a stand-in is said';

/** A followed roster row's profile and Event: what a duty and a Workshop are keyed on. */
interface FollowedProfile {
  globalPersonId: string;
  eventId: string;
}

interface NotificationPreferenceRow {
  user_id: string;
  enabled: boolean | null;
  match_starting_minutes_before: string | number | null;
  referee_starting_minutes_before?: string | number | null;
  workshop_starting_minutes_before?: string | number | null;
}

// Separator is '.', never ':' — see buildNotificationJobId in
// notification-scheduler.worker.ts for why a colon makes BullMQ throw.
export function buildFollowNotificationJobId(matchId: string, followerUserId: string): string {
  return `follow.match_starting.${matchId}.${followerUserId}`;
}

export function buildFollowRefereeJobId(assignmentId: string, followerUserId: string): string {
  return `follow.referee_starting.${assignmentId}.${followerUserId}`;
}

export function buildFollowWorkshopJobId(sessionId: string, followerUserId: string): string {
  return `follow.workshop_starting.${sessionId}.${followerUserId}`;
}

function fighterName(registration: RegistrationRow | undefined): string {
  const given = registration?.persons?.given_name?.trim() ?? '';
  const family = registration?.persons?.family_name?.trim() ?? '';
  return `${given} ${family}`.trim();
}

function parseLeadMinutes(raw: string | number | null | undefined, fallback = 10): number {
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readLeadMinutes(row: NotificationPreferenceRow | undefined): number {
  return parseLeadMinutes(row?.match_starting_minutes_before);
}

function readRefereeLeadMinutes(row: NotificationPreferenceRow | undefined): number {
  return parseLeadMinutes(row?.referee_starting_minutes_before);
}

function readWorkshopLeadMinutes(row: NotificationPreferenceRow | undefined): number {
  return parseLeadMinutes(row?.workshop_starting_minutes_before, 15);
}

@Injectable()
export class FollowNotificationSchedulerService {
  private readonly logger = new Logger(FollowNotificationSchedulerService.name);

  constructor(
    @InjectQueue(NOTIFICATION_QUEUE) private readonly queue: Queue,
    private readonly supabase: SupabaseService,
  ) {}

  /**
   * Bring every follower's alert for this bout in line with what the bout now
   * says — including when it no longer says anything.
   *
   * TAKING THE TIME AWAY IS A RESCHEDULE TOO. This used to open with
   * `if (!match?.scheduled_at) return;`, so unscheduling a fight left every
   * follower's "starting soon" sitting in the queue, still timed off the old
   * slot. It then fired for a fight that was no longer on the board. The
   * personal scheduler next door never had the bug: its `scheduleReminder`
   * removes the existing job BEFORE it checks the time, so a null cancels.
   * Here the check came first, so the removal never ran.
   *
   * The follows still have to be resolved in that case — the job id is per
   * FOLLOWER, so there is no way to cancel without knowing who they are.
   */
  async scheduleMatchStarting(matchId: string, now = new Date()): Promise<void> {
    await this.scheduleMatchStartingMany([matchId], now);
  }

  /**
   * The same for many bouts, in four reads rather than four per bout.
   *
   * The single-bout call above delegates here, so there is ONE implementation.
   * The programme writes retime whole phases at once — regenerating a block can
   * move several hundred bouts — and a per-bout loop would put several hundred
   * sequential round trips inside one HTTP request.
   *
   * `onlyFollower` keeps it to one follower's alerts: `applyFollow` asks for his alone, and for
   * him a failed read throws (`dataOf`).
   */
  async scheduleMatchStartingMany(
    matchIds: readonly string[],
    now = new Date(),
    onlyFollower?: string,
  ): Promise<void> {
    const strict = onlyFollower !== undefined;
    const ids = Array.from(new Set(matchIds.filter(Boolean)));
    if (ids.length === 0) return;
    const matches = await this.getMatches(ids, strict);
    if (matches.length === 0) return;

    const registrations = await this.getRegistrations(
      matches.flatMap((match) => [match.red_registration_id, match.blue_registration_id]),
      strict,
    );
    const byRegistrationId = new Map(registrations.map((row) => [row.id, row]));
    const personIds = Array.from(
      new Set(registrations.map((row) => row.person_id).filter((id): id is string => Boolean(id))),
    );
    if (personIds.length === 0) return;

    const follows = await this.getClaimedMatchFollows(personIds, onlyFollower);
    if (follows.length === 0) return;
    const followsByPerson = new Map<string, FollowRow[]>();
    for (const follow of follows) {
      if (!follow.followed_person_id) continue;
      const existing = followsByPerson.get(follow.followed_person_id) ?? [];
      existing.push(follow);
      followsByPerson.set(follow.followed_person_id, existing);
    }
    const preferences = await this.getPreferences(
      follows.map((follow) => follow.follower_user_id).filter((id): id is string => Boolean(id)),
      strict,
    );

    await Promise.all(
      matches.map((match) =>
        this.applyMatchFollows(match, byRegistrationId, followsByPerson, preferences, now),
      ),
    );
  }

  /** One bout's followers, reschedule or cancel. Every read is already done. */
  private async applyMatchFollows(
    match: MatchRow,
    byRegistrationId: Map<string, RegistrationRow>,
    followsByPerson: Map<string, FollowRow[]>,
    preferences: Map<string, NotificationPreferenceRow>,
    now: Date,
  ): Promise<void> {
    const red = byRegistrationId.get(match.red_registration_id ?? '');
    const blue = byRegistrationId.get(match.blue_registration_id ?? '');
    // Only the people in THIS bout. Batching the reads must not let one bout's
    // followers be alerted about another's.
    const follows = [red?.person_id, blue?.person_id]
      .filter((id): id is string => Boolean(id))
      .flatMap((personId) => followsByPerson.get(personId) ?? []);
    if (follows.length === 0) return;

    if (!match.scheduled_at) return this.cancelMatchFollows(match.id, follows);
    const startsAt = match.scheduled_at;

    await Promise.all(
      follows.map((follow) => {
        if (!follow.follower_user_id || !follow.followed_person_id) return undefined;
        const preference = preferences.get(follow.follower_user_id);
        if (preference?.enabled === false) return undefined;

        const leadMinutes = readLeadMinutes(preference);
        const followedRegistration = red?.person_id === follow.followed_person_id ? red : blue;
        const opponentRegistration = followedRegistration === red ? blue : red;
        const job: ScheduledNotificationJob = {
          kind: 'follow_match_starting',
          entityId: match.id,
          userId: follow.follower_user_id,
          ...followMatch({
            fighter: fighterName(followedRegistration),
            opponent: fighterName(opponentRegistration),
            minutes: leadMinutes,
            label: match.pools?.name ?? match.match_number_label,
            piste: match.lices?.name,
          }),
          url: '/notifications',
        };
        return this.replaceJob(job, startsAt, leadMinutes, now);
      }),
    );
  }

  async cancelMatchStarting(matchId: string, followerUserId: string): Promise<void> {
    const existing = await this.queue.getJob(buildFollowNotificationJobId(matchId, followerUserId));
    await existing?.remove();
  }

  /** Drop this bout's alert for everyone following either fighter. */
  private async cancelMatchFollows(matchId: string, follows: FollowRow[]): Promise<void> {
    await Promise.all(
      follows.map((follow) =>
        follow.follower_user_id
          ? this.cancelMatchStarting(matchId, follow.follower_user_id)
          : undefined,
      ),
    );
  }

  /**
   * Bring ONE follower's waiting alerts about ONE person in line with his follows as SAVED
   * (rulings 207, 209). A follow, a switch change and an unfollow call it once their write landed.
   *
   * It removes his alerts about her bouts, her duties and her Workshop sessions, then sets them
   * again from the saved follows. Removing alone is wrong: an alert is ONE job per bout and
   * follower, whoever he follows in it. Marc follows Léa and Tom, who meet at 10:30, and mutes
   * Léa: the 10:30 alert stays, for Tom. It reads the saved rows, not switches handed over by the
   * caller, so it can only write what was saved at some moment.
   *
   * Alerts used to be set only when a bout or a Workshop session got or changed its time, and when
   * a duty was locked. So a follower who came after the timetable was built heard nothing until
   * something moved, and a switch turned off left its alert waiting.
   *
   * Nothing here is best effort. A failed read throws (the walk below, and every read of the three
   * `schedule*` methods when they are called for one follower), and so does the queue (Redis
   * down, or a job being sent, which cannot be removed). The follow is saved by then, the call
   * fails, and the same call again repairs the alerts.
   *
   * Races, named. The first two leave a job no saved follow wants. It stays in the queue, and it
   * does not ring: his follows are read again when it fires (`alert-still-wanted.ts`, ruling 213).
   * - A retime that read his follow BEFORE his unfollow or mute writes its job AFTER this call
   *   removed it. A later retime does not remove it: a retime touches only the followers it finds.
   * - Two calls at once, on then off: the first reads his follows before the second's write, and
   *   writes its job after the second removed it.
   * Not closed:
   * - This call read a bout's time BEFORE a retime, and writes its job AFTER the retime wrote its:
   *   an alert at the old time, until the bout is timed again.
   * - His follows of both Fighters of one bout write one job id twice, with either body.
   */
  async applyFollow(
    followedPersonId: string,
    followerUserId: string,
    now = new Date(),
  ): Promise<void> {
    const boutIds = await this.boutIdsOf(followedPersonId);
    await Promise.all(boutIds.map((id) => this.cancelMatchStarting(id, followerUserId)));
    await this.scheduleMatchStartingMany(boutIds, now, followerUserId);

    // A duty and a Workshop are keyed on the profile, a follow on the roster row of one Event.
    const profile = await this.profileOf(followedPersonId);
    if (!profile) return;
    await Promise.all(
      (await this.dutyIdsOf(profile)).map(async (id) => {
        await this.cancelRefereeStarting(id, followerUserId);
        await this.scheduleRefereeStarting(id, now, followerUserId);
      }),
    );
    await Promise.all(
      (await this.sessionIdsOf(profile)).map(async (id) => {
        await this.cancelWorkshopStarting(id, followerUserId);
        await this.scheduleWorkshopStarting(id, now, followerUserId);
      }),
    );
  }

  /** One column of a read of `applyFollow`. A failed read throws: it says nothing about alerts. */
  private idsOf(what: string, read: Read, column = 'id'): string[] {
    return this.rowsOf<Record<string, string>>(what, '', read, true).map((row) => row[column]!);
  }

  /** Every bout the followed roster row is entered in. */
  private async boutIdsOf(personId: string): Promise<string[]> {
    const registrationIds = this.idsOf(
      'Entries of a followed person',
      await this.supabase.service.from('registrations').select('id').eq('person_id', personId),
    );
    if (registrationIds.length === 0) return [];
    const list = registrationIds.join(',');
    return this.idsOf(
      'Bouts of a followed person',
      await this.supabase.service
        .from('matches')
        .select('id')
        .or(`red_registration_id.in.(${list}),blue_registration_id.in.(${list})`),
    );
  }

  /** The profile behind a followed roster row, with its Event; null when the row has none. */
  private async profileOf(personId: string): Promise<FollowedProfile | null> {
    const read = await this.supabase.service
      .from('persons')
      .select('global_person_id, event_id')
      .eq('id', personId)
      .maybeSingle();
    const row = this.dataOf('Followed person', '', read, true) as {
      global_person_id: string | null;
      event_id: string | null;
    } | null;
    if (!row?.global_person_id || !row.event_id) return null;
    return { globalPersonId: row.global_person_id, eventId: row.event_id };
  }

  /** The referee duties of the followed person in the Event of the follow. */
  private async dutyIdsOf({ globalPersonId, eventId }: FollowedProfile): Promise<string[]> {
    return this.idsOf(
      'Duties of a followed person',
      await this.supabase.service
        .from('referee_assignments')
        .select('id')
        .eq('person_id', globalPersonId)
        .eq('event_id', eventId),
    );
  }

  /** The sessions of the Workshops the followed person teaches in the Event of the follow. */
  private async sessionIdsOf({ globalPersonId, eventId }: FollowedProfile): Promise<string[]> {
    const taught = this.idsOf(
      'Workshops of a followed instructor',
      await this.supabase.service
        .from('workshop_instructors')
        .select('workshop_id')
        .eq('global_person_id', globalPersonId),
      'workshop_id',
    );
    if (taught.length === 0) return [];
    const workshopIds = this.idsOf(
      "Workshops of a follow's Event",
      await this.supabase.service
        .from('workshops')
        .select('id')
        .in('id', [...new Set(taught)])
        .eq('event_id', eventId),
    );
    if (workshopIds.length === 0) return [];
    return this.idsOf(
      'Sessions of a followed instructor',
      await this.supabase.service
        .from('workshop_sessions')
        .select('id')
        .in('workshop_id', workshopIds),
    );
  }

  private async replaceJob(
    job: ScheduledNotificationJob,
    startsAt: string,
    leadMinutes: number,
    now: Date,
  ): Promise<void> {
    const jobId =
      job.kind === 'follow_referee_starting'
        ? buildFollowRefereeJobId(job.entityId, job.userId)
        : job.kind === 'follow_workshop_starting'
          ? buildFollowWorkshopJobId(job.entityId, job.userId)
          : buildFollowNotificationJobId(job.entityId, job.userId);
    const existing = await this.queue.getJob(jobId);
    await existing?.remove();
    // What has already started rings for nobody: a delay cannot be negative, so the alert of a
    // bout fought an hour ago would be sent at once, as "starting soon".
    if (new Date(startsAt).getTime() <= now.getTime()) return;
    await this.queue.add(NOTIFICATION_SEND_JOB, job, {
      jobId,
      delay: computeNotificationDelayMs(startsAt, leadMinutes, now),
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }

  /**
   * What a read answered: the ONE owner of a failed read in this file.
   *
   * A retime is best effort (see `MatchAlertRefresherService`): a read that failed gives nothing,
   * and its warning says what that does (`otherwise`). For ONE follower (`strict`, `applyFollow`)
   * it throws: his alerts were removed just before, and a warning would leave them removed behind
   * a 200.
   *
   * A failed read used to say nothing: the bout read below asked for a `label` column the lices
   * table never had, PostgREST refused it each time, and no follower was ever told of a bout.
   */
  private dataOf(what: string, otherwise: string, { data, error }: Read, strict: boolean): unknown {
    if (error && strict) throw new Error(`${what} unreadable: ${error.message}`);
    if (error) this.logger.warn(`${what} unreadable${otherwise}: ${error.message}`);
    return data;
  }

  private rowsOf<T>(what: string, otherwise: string, read: Read, strict: boolean): T[] {
    return (this.dataOf(what, otherwise, read, strict) ?? []) as T[];
  }

  private async getMatches(matchIds: string[], strict: boolean): Promise<MatchRow[]> {
    return this.rowsOf<MatchRow>(
      'Bouts',
      KEPT,
      await this.supabase.service
        .from('matches')
        .select(
          'id, match_number_label, scheduled_at, red_registration_id, blue_registration_id, lices ( name ), pools ( name )',
        )
        .in('id', matchIds),
      strict,
    );
  }

  private async getRegistrations(
    registrationIds: Array<string | null>,
    strict: boolean,
  ): Promise<RegistrationRow[]> {
    const ids = registrationIds.filter((id): id is string => Boolean(id));
    if (ids.length === 0) return [];
    return this.rowsOf<RegistrationRow>(
      'Fighters of the bouts',
      KEPT,
      await this.supabase.service
        .from('registrations')
        .select('id, person_id, persons ( given_name, family_name )')
        .in('id', ids),
      strict,
    );
  }

  private async getClaimedMatchFollows(
    personIds: string[],
    onlyFollower?: string,
  ): Promise<FollowRow[]> {
    const query = this.supabase.service
      .from('follows')
      .select('followed_person_id, follower_user_id, notify_match_start')
      .in('followed_person_id', personIds)
      .eq('notify_match_start', true);
    const follows = this.rowsOf<FollowRow>(
      'Followers',
      '; their alerts stay as they were',
      await (onlyFollower === undefined ? query : query.eq('follower_user_id', onlyFollower)),
      onlyFollower !== undefined,
    );
    return follows.filter(
      (follow) => Boolean(follow.follower_user_id) && follow.notify_match_start !== false,
    );
  }

  private async getPreferences(
    userIds: string[],
    strict: boolean,
  ): Promise<Map<string, NotificationPreferenceRow>> {
    if (userIds.length === 0) return new Map();
    const preferences = this.rowsOf<NotificationPreferenceRow>(
      'Follower switches',
      ', taken as never saved',
      await this.supabase.service
        .from('notification_preferences')
        .select(
          'user_id, enabled, match_starting_minutes_before, referee_starting_minutes_before, workshop_starting_minutes_before',
        )
        .in('user_id', userIds),
      strict,
    );
    return new Map(preferences.map((row) => [row.user_id, row]));
  }

  // ── Referee-starting (followers of a person who is about to referee) ───────────

  /**
   * Schedule "someone you follow is about to referee" reminders. Who is alerted is
   * `refereeAlertFollowers`: the Event follows on the referee's roster rows with the switch on,
   * and the hub follows with theirs on where the follower has no Event follow (ruling 217).
   * Delivery reuses the same NOTIFICATION_QUEUE → push/email pipeline.
   *
   * Only a LOCKED duty rings (`getLockedDuty`). `onlyFollower` as for a bout.
   */
  async scheduleRefereeStarting(
    assignmentId: string,
    now = new Date(),
    onlyFollower?: string,
  ): Promise<void> {
    const strict = onlyFollower !== undefined;
    const assignment = await this.getLockedDuty(assignmentId, strict);
    if (!assignment?.person_id || !assignment.event_id) return;

    const followers = await refereeAlertFollowers(
      this.supabase.service,
      { profileId: assignment.person_id, eventId: assignment.event_id },
      (what, read, loses) => this.dataOf(what, `; ${loses}`, read, strict),
      onlyFollower,
    );
    if (followers.length === 0) return;

    // Read only once someone is waiting for it. The duty starts at its
    // earliest placed Match.
    const startsAt = await this.refereeDutyStart(assignment, strict);
    if (!startsAt) return;

    const preferences = await this.getPreferences(followers, strict);
    const refereeName = await this.getGlobalPersonName(assignment.person_id, strict);

    await Promise.all(
      followers.map((followerUserId) => {
        const preference = preferences.get(followerUserId);
        if (preference?.enabled === false) return undefined;

        const leadMinutes = readRefereeLeadMinutes(preference);
        const matchLabel = assignment.matches?.match_number_label;
        const liceName = assignment.matches?.lices?.name;
        const job: ScheduledNotificationJob = {
          kind: 'follow_referee_starting',
          entityId: assignment.id,
          userId: followerUserId,
          ...followReferee(refereeName, leadMinutes, matchLabel, liceName),
          url: '/notifications',
        };
        return this.replaceJob(job, startsAt, leadMinutes, now);
      }),
    );
  }

  async cancelRefereeStarting(assignmentId: string, followerUserId: string): Promise<void> {
    const existing = await this.queue.getJob(buildFollowRefereeJobId(assignmentId, followerUserId));
    await existing?.remove();
  }

  /**
   * Bring these followers' waiting alerts about ONE referee's duties in line with their follows
   * as SAVED (ruling 217). The hub switch, the hub unfollow and the removal of a person's
   * followers call it once their write landed: the hub follow is keyed on the profile, so the
   * walk is over the profile's duties, in every Event that is not over (nothing waits in one
   * that is: an assumption that bounds the work, not a check).
   *
   * As `applyFollow`: it removes, then sets again from the saved rows, because a duty's alert is
   * ONE job per duty and follower, whichever follow asked for it. Nothing is best effort: the
   * read below and every read of `scheduleRefereeStarting` for one follower throw. The switch is
   * saved by then, the call fails, and the same call again repairs the alerts.
   *
   * Cost, named: about four reads per duty and follower, inside the caller's request.
   *
   * Races, named. Each leaves a job no saved follow wants; it stays in the queue and does not
   * ring, because the follows are read again when it fires (`alert-still-wanted.ts`):
   * - two calls at once, on then off: the first reads the saved switch before the second's
   *   write, and writes its job after the second removed it;
   * - a lock that read the hub switch before it went off writes its job after this removed it.
   */
  async applyHubFollow(
    profileId: string,
    followerUserIds: readonly string[],
    now = new Date(),
  ): Promise<void> {
    if (followerUserIds.length === 0) return;
    const duties = this.rowsOf<{ id: string; events: unknown }>(
      'Duties of a followed referee',
      '',
      await this.supabase.service
        .from('referee_assignments')
        .select('id, events ( status )')
        .eq('person_id', profileId),
      true,
    );
    // A to-one embed, as PostgREST hands it: an object or a one-element array.
    const statusOf = ({ events }: { events: unknown }) =>
      (Array.isArray(events) ? events[0] : events)?.status;
    const ahead = duties.filter((duty) => !isOver(statusOf(duty))).map((duty) => duty.id);
    // One follower at a time: each reads and writes for one account, inside this request.
    for (const followerUserId of followerUserIds) {
      await Promise.all(
        ahead.map(async (id) => {
          await this.cancelRefereeStarting(id, followerUserId);
          await this.scheduleRefereeStarting(id, now, followerUserId);
        }),
      );
    }
  }

  /**
   * The duty, once it is locked: a follower hears of a duty when its referee does, and the lock
   * is what tells him (`lockAssignments`). A duty still being planned rings for nobody.
   */
  private async getLockedDuty(
    assignmentId: string,
    strict: boolean,
  ): Promise<RefereeAssignmentRow | null> {
    const read = await this.supabase.service
      .from('referee_assignments')
      .select(
        'id, person_id, event_id, pool_id, match_id, role, status, matches ( match_number_label, lices ( name ) )',
      )
      .eq('id', assignmentId)
      .maybeSingle();
    const what = `Referee assignment ${assignmentId}`;
    const duty = this.dataOf(what, NONE_SET, read, strict) as RefereeAssignmentRow | null;
    return duty?.status === 'confirmed' ? duty : null;
  }

  /** The duty's start, or null (logged) when its Matches cannot be read at a retime. */
  private async refereeDutyStart(
    assignment: RefereeAssignmentRow,
    strict: boolean,
  ): Promise<string | null> {
    try {
      return await readDutyStart(this.supabase.service, {
        id: assignment.id,
        matchId: assignment.match_id,
        poolId: assignment.pool_id,
      });
    } catch (err) {
      // `readDutyStart` throws a 400 for a read that failed. Here it is a failed read like any
      // other: a warning at a retime, a plain Error (a 5xx) for one follower.
      const error = { message: err instanceof Error ? err.message : String(err) };
      const what = `Referee assignment ${assignment.id}: its Matches are`;
      this.dataOf(what, NONE_SET, { data: null, error }, strict);
      return null;
    }
  }

  private async getGlobalPersonName(globalPersonId: string, strict: boolean): Promise<string> {
    const read = await this.supabase.service
      .from('global_persons')
      .select('display_name')
      .eq('id', globalPersonId)
      .maybeSingle();
    const row = this.dataOf('Name of a referee', STAND_IN, read, strict);
    return (row as { display_name?: string | null } | null)?.display_name?.trim() ?? '';
  }

  // ── Workshop-starting (followers of a workshop instructor) ─────────────────────

  /**
   * Schedule "an instructor you follow has a workshop starting" reminders.
   * Workshop instructors key on the GLOBAL person, whereas follows key on the
   * event-scoped persons.id — so we bridge global + event → persons.id, then read
   * the follows with notify_workshop_start on. Delivery reuses the same
   * NOTIFICATION_QUEUE → push/email pipeline.
   */
  async scheduleWorkshopStarting(
    sessionId: string,
    now = new Date(),
    onlyFollower?: string,
  ): Promise<void> {
    const strict = onlyFollower !== undefined;
    const session = await this.getTimedSession(sessionId, strict);
    if (!session) return;
    const { workshop } = session;

    const personRows = await this.getInstructorRows(workshop.id, workshop.eventId, strict);
    const personToGlobal = new Map(personRows.map((r) => [r.id, r.global_person_id]));
    // No roster row means no follow: the read below answers none for an empty list.
    const follows = await this.getClaimedWorkshopFollows([...personToGlobal.keys()], onlyFollower);
    if (follows.length === 0) return;

    const preferences = await this.getPreferences(
      follows.map((follow) => follow.follower_user_id).filter((id): id is string => Boolean(id)),
      strict,
    );
    const nameByGlobal = await this.getGlobalPersonNames(
      [...new Set(personRows.map((r) => r.global_person_id))],
      strict,
    );
    await Promise.all(
      follows.map((follow) => {
        if (!follow.follower_user_id || !follow.followed_person_id) return undefined;
        const preference = preferences.get(follow.follower_user_id);
        if (preference?.enabled === false) return undefined;

        const leadMinutes = readWorkshopLeadMinutes(preference);
        const globalId = personToGlobal.get(follow.followed_person_id);
        const instructor = globalId ? nameByGlobal.get(globalId) : undefined;
        const job: ScheduledNotificationJob = {
          kind: 'follow_workshop_starting',
          entityId: session.id,
          userId: follow.follower_user_id,
          ...followWorkshop(workshop.title, instructor, leadMinutes),
          url: '/notifications',
        };
        return this.replaceJob(job, session.startsAt, leadMinutes, now);
      }),
    );
  }

  async cancelWorkshopStarting(sessionId: string, followerUserId: string): Promise<void> {
    const existing = await this.queue.getJob(buildFollowWorkshopJobId(sessionId, followerUserId));
    await existing?.remove();
  }

  /** The session when it can ring; null for one with no time, cancelled, or of no Event. */
  private async getTimedSession(sessionId: string, strict: boolean): Promise<TimedSession | null> {
    const read = await this.supabase.service
      .from('workshop_sessions')
      .select('id, starts_at, status, workshops ( id, title, event_id )')
      .eq('id', sessionId)
      .maybeSingle();
    const what = `Workshop session ${sessionId}`;
    const row = this.dataOf(what, NONE_SET, read, strict) as WorkshopSessionRow | null;
    const workshop = row?.workshops;
    if (!row?.starts_at || row.status === 'cancelled') return null;
    if (!workshop?.id || !workshop.event_id) return null;
    return {
      id: row.id,
      startsAt: row.starts_at,
      workshop: { id: workshop.id, title: workshop.title ?? null, eventId: workshop.event_id },
    };
  }

  /** The instructors of a Workshop, as their roster rows in its Event: what a follow is keyed on. */
  private async getInstructorRows(
    workshopId: string,
    eventId: string,
    strict: boolean,
  ): Promise<Array<{ id: string; global_person_id: string }>> {
    const globalPersonIds = this.rowsOf<{ global_person_id: string | null }>(
      'Instructors of a Workshop',
      NONE_SET,
      await this.supabase.service
        .from('workshop_instructors')
        .select('global_person_id')
        .eq('workshop_id', workshopId)
        .not('global_person_id', 'is', null),
      strict,
    )
      .map((row) => row.global_person_id)
      .filter((id): id is string => Boolean(id));
    if (globalPersonIds.length === 0) return [];
    return this.rowsOf<{ id: string; global_person_id: string | null }>(
      'Roster rows of the instructors',
      NONE_SET,
      await this.supabase.service
        .from('persons')
        .select('id, global_person_id')
        .in('global_person_id', globalPersonIds)
        .eq('event_id', eventId),
      strict,
    ).filter((row): row is { id: string; global_person_id: string } =>
      Boolean(row.global_person_id),
    );
  }

  private async getClaimedWorkshopFollows(
    personIds: string[],
    onlyFollower?: string,
  ): Promise<FollowRow[]> {
    if (personIds.length === 0) return [];
    const query = this.supabase.service
      .from('follows')
      .select('followed_person_id, follower_user_id, notify_workshop_start')
      .in('followed_person_id', personIds)
      .eq('notify_workshop_start', true);
    const follows = this.rowsOf<FollowRow>(
      'Followers of an instructor',
      NONE_SET,
      await (onlyFollower === undefined ? query : query.eq('follower_user_id', onlyFollower)),
      onlyFollower !== undefined,
    );
    return follows.filter(
      (follow) => Boolean(follow.follower_user_id) && follow.notify_workshop_start !== false,
    );
  }

  private async getGlobalPersonNames(
    globalPersonIds: string[],
    strict: boolean,
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (globalPersonIds.length === 0) return map;
    const read = await this.supabase.service
      .from('global_persons')
      .select('id, display_name')
      .in('id', globalPersonIds);
    const rows = this.rowsOf<{ id: string; display_name: string | null }>(
      'Names of the instructors',
      STAND_IN,
      read,
      strict,
    );
    for (const row of rows) {
      const name = row.display_name?.trim() ?? '';
      if (name) map.set(row.id, name);
    }
    return map;
  }
}
