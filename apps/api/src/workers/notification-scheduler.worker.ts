import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue, Processor } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { SentryReportingWorkerHost } from './sentry-reporting-worker-host';
import * as webPush from 'web-push';
import { MailService } from '../modules/mail/mail.service';
import {
  matchStarting,
  refereeStarting,
  workshopStarting,
} from '../modules/notifications/notice-texts/notice-texts';
import { readDutyStarts } from '../modules/schedule/duty-windows';
import { SupabaseService } from '../modules/supabase/supabase.service';
import { isStillWanted } from './alert-still-wanted';
import { isPublicAlert } from './alert-visibility';
import {
  ALERT_DROPPED,
  ALERT_SENT,
  DUTY_ALERT_KEPT,
  dutyAlertStep,
  hasFired,
  namedDuties,
  type AlertOutcome,
} from './duty-alert-rings';

export const NOTIFICATION_QUEUE = 'notification-scheduler';
export const NOTIFICATION_SEND_JOB = 'send';

export type ScheduledNotificationKind = 'match_starting' | 'workshop_starting' | 'referee_starting';

export type ImmediateNotificationKind =
  | 'assignment_changed'
  | 'workshop_cancelled'
  | 'waitlist_promoted'
  | 'results_published'
  | 'exchange_edit_rejected'
  | 'organizer_broadcast'
  // Immediate, NOT a FollowNotificationKind: those three are all scheduled
  // reminders about a followed PERSON, built exclusively by
  // FollowNotificationSchedulerService.replaceJob with its hardcoded 3-way
  // jobId switch. This one fires now, push-first with email fallback and
  // preference gating — which is exactly what sendImmediate already does.
  | 'organizer_published_event'
  // Immediate for the same reason: a Swiss round auto-pairs the instant the
  // previous one completes, so the pairing IS the news — a reminder scheduled
  // against its start time would arrive after fighters had already been called.
  | 'swiss_round_published';

export type FollowNotificationKind =
  'follow_match_starting' | 'follow_referee_starting' | 'follow_workshop_starting';

export type NotificationKind =
  ScheduledNotificationKind | ImmediateNotificationKind | FollowNotificationKind;

/**
 * The per-kind opt-outs, as column names.
 *
 * Declared as a const array so the SELECT below and the type both come from
 * ONE list — the three hand-written `Pick<…, 'enabled' | 'schedule_changes' |
 * …>` unions that used to enumerate this were a fourth place to forget a new
 * toggle, and a toggle missing from the select reads as `undefined`, which is
 * not `=== false`, so the opt-out silently stops working.
 */
export const PREFERENCE_TOGGLE_COLUMNS = [
  'schedule_changes',
  'results_published',
  'organizer_updates',
  'swiss_round_published',
] as const;

export type NotificationPreferenceToggle = (typeof PREFERENCE_TOGGLE_COLUMNS)[number];

export interface ScheduledNotificationJob {
  kind: NotificationKind;
  entityId: string;
  userId: string;
  recipientId?: string | null;
  forceEmail?: boolean;
  title: string;
  body: string;
  url: string;
  email?: string | null;
  emailSubject?: string | null;
  preference?: NotificationPreferenceToggle | null;
  severity?: 'info' | 'warning' | 'alert' | null;
  /** The start an alert was set for, where its builder says it: a duty alert rang for it (ruling 221). */
  startsAt?: string | null;
}

export interface ReminderInput extends ScheduledNotificationJob {
  startsAt: string | null;
  leadMinutes: number;
  now?: Date;
}

/** The columns the "your fight starts soon" alert is built from. */
interface MatchStartRow {
  id: string;
  match_number_label: string | null;
  scheduled_at: string | null;
  red_registration_id: string | null;
  blue_registration_id: string | null;
}

interface PushSubscriptionRow {
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
}

type NotificationPreferenceRow = {
  user_id: string;
  enabled: boolean;
  match_starting_minutes_before: string | number | null;
  workshop_starting_minutes_before: string | number | null;
  referee_starting_minutes_before: string | number | null;
} & { [K in NotificationPreferenceToggle]?: boolean | null };

/** The `enabled` master switch plus every per-kind toggle. */
type TogglePreferences = Pick<NotificationPreferenceRow, 'enabled' | NotificationPreferenceToggle>;

/**
 * Custom BullMQ job ids MUST NOT contain ':'.
 *
 * `Job.validateOptions` (bullmq/dist/cjs/classes/job.js) throws
 * `Custom Id cannot contain :` for any id with a colon, unless it splits into
 * exactly 3 parts — a compatibility carve-out for legacy repeatable jobs. The
 * ids here used to be `notification:<kind>:<entity>:<user>` (4 parts), so EVERY
 * `queue.add` threw, and the throw surfaced as a 500 on whatever request was
 * enqueueing. It went unnoticed because the enqueue paths only ever ran with an
 * empty recipient list (unclaimed fighters, sessions with no enrollees yet) —
 * `Promise.all([])` adds nothing. The first real recipient was the instructor
 * "Notify participants" broadcast, which failed for this reason.
 *
 * Separator is '.', which is legal in a Redis key and cannot appear in a UUID
 * or in a notification kind.
 */
export function buildNotificationJobId(
  kind: NotificationKind,
  entityId: string,
  userId: string,
): string {
  return `notification.${kind}.${entityId}.${userId}`;
}

export function computeNotificationDelayMs(
  startsAt: string,
  leadMinutes: number,
  now = new Date(),
): number {
  const notifyAt = new Date(startsAt).getTime() - leadMinutes * 60_000;
  return Math.max(0, notifyAt - now.getTime());
}

function readLeadMinutes(
  row: Partial<NotificationPreferenceRow> | undefined,
  key: keyof Pick<
    NotificationPreferenceRow,
    | 'match_starting_minutes_before'
    | 'workshop_starting_minutes_before'
    | 'referee_starting_minutes_before'
  >,
  fallback: number,
): number {
  const raw = row?.[key];
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

@Injectable()
export class WebPushSender {
  private configured = false;

  constructor(private readonly config: ConfigService) {}

  async send(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: { title: string; body: string; url: string; severity?: 'info' | 'warning' | 'alert' },
  ): Promise<void> {
    this.configure();
    await webPush.sendNotification(subscription, JSON.stringify(payload));
  }

  private configure(): void {
    if (this.configured) return;
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY')?.trim();
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY')?.trim();
    const subject = this.config.get<string>('VAPID_SUBJECT')?.trim() || 'mailto:admin@myclash.fr';

    if (!publicKey || !privateKey) {
      throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be configured');
    }

    webPush.setVapidDetails(subject, publicKey, privateKey);
    this.configured = true;
  }
}

/** A `workshop_sessions` row as the own Workshop alert reads it. */
interface WorkshopSessionRow {
  id: string;
  starts_at: string | null;
  status: string | null;
  workshops?: { title?: string | null } | null;
}

/**
 * When a Workshop session rings: its start, or null when it has no time, is cancelled or has
 * begun. A delay cannot be negative, so the alert of a session already running would be sent at
 * once, as "starting soon".
 */
function sessionRingsAt(session: WorkshopSessionRow, now: Date): string | null {
  if (!session.starts_at || session.status === 'cancelled') return null;
  return new Date(session.starts_at).getTime() > now.getTime() ? session.starts_at : null;
}

/** A `referee_assignments` row as the referee's own reminder reads it. */
interface RefereeAssignmentRow {
  id: string;
  person_id: string | null;
  pool_id: string | null;
  match_id: string | null;
  role: string | null;
  matches?: { match_number_label?: string | null } | null;
}

@Injectable()
export class NotificationSchedulerService {
  private readonly logger = new Logger(NotificationSchedulerService.name);

  constructor(
    @InjectQueue(NOTIFICATION_QUEUE) private readonly queue: Queue,
    private readonly supabase: SupabaseService,
  ) {}

  async scheduleReminder(input: ReminderInput): Promise<void> {
    const jobId = buildNotificationJobId(input.kind, input.entityId, input.userId);
    const existing = await this.queue.getJob(jobId);
    await existing?.remove();

    if (!input.startsAt) return;

    await this.queue.add(NOTIFICATION_SEND_JOB, this.toJobData(input), {
      jobId,
      delay: computeNotificationDelayMs(input.startsAt, input.leadMinutes, input.now),
      // A duty alert that fired is kept: it is the memory of what rang (ruling 221).
      removeOnComplete: input.kind === 'referee_starting' ? DUTY_ALERT_KEPT : true,
      removeOnFail: 100,
    });
  }

  /**
   * Send now, once: a job already held under this id (a completed one is kept a day) wins. `replace`
   * sends it again on purpose, removing the held job first (ruling 186).
   */
  async sendImmediate(input: ScheduledNotificationJob, { replace = false } = {}): Promise<void> {
    const jobId = buildNotificationJobId(input.kind, input.entityId, input.userId);
    const existing = await this.queue.getJob(jobId);
    if (existing && !replace) return;
    await existing?.remove();

    await this.queue.add(NOTIFICATION_SEND_JOB, input, {
      jobId,
      delay: 0,
      removeOnComplete: { age: 86_400 },
      removeOnFail: 100,
    });
  }

  /**
   * Enqueue many immediate notifications at once.
   *
   * sendImmediate costs TWO Redis round trips per recipient (getJob probe +
   * add). That is fine for the handful of people affected by a schedule change,
   * but a publish announcement fans out to every follower — at a thousand
   * followers the caller would sit on two thousand sequential round trips
   * inside the HTTP request and the publish button would visibly hang.
   *
   * addBulk collapses each chunk into one round trip, and the getJob probe is
   * dropped: BullMQ already ignores a duplicate explicit jobId, and callers of
   * this path own a stronger guard anyway (see events.first_published_at).
   */
  async sendImmediateBulk(inputs: ScheduledNotificationJob[]): Promise<void> {
    const CHUNK = 500;
    for (let i = 0; i < inputs.length; i += CHUNK) {
      const chunk = inputs.slice(i, i + CHUNK).map((input) => ({
        name: NOTIFICATION_SEND_JOB,
        data: input,
        opts: {
          jobId: buildNotificationJobId(input.kind, input.entityId, input.userId),
          delay: 0,
          removeOnComplete: { age: 86_400 },
          removeOnFail: 100,
        },
      }));
      await this.queue.addBulk(chunk);
    }
  }

  async scheduleMatchStarting(matchId: string, now = new Date()): Promise<void> {
    await this.scheduleMatchStartingMany([matchId], now);
  }

  /**
   * Bring the "your fight starts soon" alert in line for MANY bouts at once.
   *
   * The single-bout call above delegates here, so there is ONE implementation
   * and the two cannot drift apart.
   *
   * WHY A BULK PATH EXISTS. Per bout this costs three database round trips
   * before it reaches the queue. The programme writes rewrite whole phases at a
   * time — regenerating a block can retime several hundred bouts — and several
   * hundred sequential round trips inside one HTTP request is not a slow
   * regeneration, it is a timeout. The reads below are set-based, so they cost
   * four queries whatever N is; only the queue work scales, and only with the
   * number of people who actually have an account.
   *
   * A null time still reaches `scheduleReminder`, which removes the existing
   * job before it checks. Unscheduling is a reschedule, and cancelling is what
   * this does for it.
   */
  async scheduleMatchStartingMany(matchIds: readonly string[], now = new Date()): Promise<void> {
    const ids = Array.from(new Set(matchIds.filter(Boolean)));
    if (ids.length === 0) return;

    const { data: matchRows, error } = await this.supabase.service
      .from('matches')
      .select('id, match_number_label, scheduled_at, red_registration_id, blue_registration_id')
      .in('id', ids);
    if (error) return;
    const rows = (matchRows ?? []) as MatchStartRow[];
    if (rows.length === 0) return;

    const userIdsByMatch = await this.claimedUsersByMatch(rows);
    const allUserIds = Array.from(new Set([...userIdsByMatch.values()].flat()));
    if (allUserIds.length === 0) return;
    const preferences = await this.getPreferencesByUser(allUserIds);

    await Promise.all(
      rows.flatMap((row) =>
        (userIdsByMatch.get(row.id) ?? []).map((userId) => {
          const preference = preferences.get(userId);
          if (preference?.enabled === false) return undefined;
          return this.scheduleReminder({
            kind: 'match_starting',
            entityId: row.id,
            userId,
            startsAt: row.scheduled_at,
            leadMinutes: readLeadMinutes(preference, 'match_starting_minutes_before', 10),
            ...matchStarting(row.match_number_label),
            url: '/notifications',
            now,
          });
        }),
      ),
    );
  }

  /**
   * Which accounts to alert for each bout: registration → person →
   * `claimed_by_user_id`, two set-based reads for the whole batch.
   *
   * Kept per bout rather than flattened. Two bouts that share no fighter must
   * not alert each other's people, and a single map of every user in the batch
   * would do exactly that.
   */
  private async claimedUsersByMatch(rows: MatchStartRow[]): Promise<Map<string, string[]>> {
    const registrationIds = Array.from(
      new Set(
        rows
          .flatMap((row) => [row.red_registration_id, row.blue_registration_id])
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (registrationIds.length === 0) return new Map();

    const { data: registrations } = await this.supabase.service
      .from('registrations')
      .select('id, person_id')
      .in('id', registrationIds);
    const personByRegistration = new Map(
      ((registrations ?? []) as Array<{ id: string; person_id: string | null }>).map((row) => [
        row.id,
        row.person_id,
      ]),
    );
    const personIds = Array.from(
      new Set([...personByRegistration.values()].filter((id): id is string => Boolean(id))),
    );
    if (personIds.length === 0) return new Map();

    const { data: persons } = await this.supabase.service
      .from('persons')
      .select('id, claimed_by_user_id')
      .in('id', personIds);
    const userByPerson = new Map(
      ((persons ?? []) as Array<{ id: string; claimed_by_user_id: string | null }>).map((row) => [
        row.id,
        row.claimed_by_user_id,
      ]),
    );

    const byMatch = new Map<string, string[]>();
    for (const row of rows) {
      const userIds = [row.red_registration_id, row.blue_registration_id]
        .map((registrationId) => (registrationId ? personByRegistration.get(registrationId) : null))
        .map((personId) => (personId ? userByPerson.get(personId) : null))
        .filter((id): id is string => Boolean(id));
      if (userIds.length > 0) byMatch.set(row.id, Array.from(new Set(userIds)));
    }
    return byMatch;
  }

  /**
   * The own Workshop "starting soon" alert follows each booking as SAVED (operator ruling 210): set
   * for a confirmed seat of a session that can ring, removed for anything else (a seat that is not
   * confirmed, a session that is cancelled, has no time or has started, an account whose main
   * switch is off).
   *
   * It goes to the ACCOUNT that holds the booking's roster row. A booking names a roster row
   * (`workshop_enrollments.user_id` holds a `persons.id`), and the alert used to be addressed to
   * that id as if it were an account: it reached nobody. A guest has no account, and is told
   * nothing, as for the two sister notices (Workshop cancelled, waitlist place).
   *
   * Two doors. An organiser saved the session (`onlyPersonId` absent): every booking of it. One
   * booking changed (`onlyPersonId`): that one alone, whether its row is still there or not.
   * Its three reads here are best effort: one that fails is logged, and the alerts stay as they
   * were. The switches unreadable count as never saved. The queue is not caught: a booking door
   * logs it (`EnrollmentService`), and a session save still fails on it, as before.
   *
   * Named, not closed. A booking tapped again, or a session saved, inside the lead time sends the
   * alert a second time: a sent job is gone, and the new one is due at once. A booking that read
   * the session's time just before an organiser moved it can write last, and ring at the old
   * time. An alert whose removal failed does not ring once its seat is no longer confirmed, or its
   * session is cancelled: both are read again when it fires (`alert-still-wanted.ts`, ruling 213;
   * `alert-visibility.ts`).
   */
  async scheduleWorkshopSessionStarting(
    sessionId: string,
    onlyPersonId?: string,
    now = new Date(),
  ): Promise<void> {
    const oneBooking = onlyPersonId !== undefined;
    const what = `Workshop session ${sessionId}`;
    const db = this.supabase.service;
    const session = this.workshopRead(
      what,
      await db
        .from('workshop_sessions')
        .select('id, starts_at, status, workshops ( title )')
        .eq('id', sessionId)
        .maybeSingle(),
    ) as WorkshopSessionRow | null;
    if (!session) return;

    const bookings = db
      .from('workshop_enrollments')
      .select('user_id, status')
      .eq('workshop_session_id', sessionId);
    const booked = this.workshopRead(
      `Bookings of ${what}`,
      await (oneBooking ? bookings.eq('user_id', onlyPersonId) : bookings),
    ) as Array<{ user_id: string | null; status: string | null }> | null;
    // A read that failed says nothing: read as "no booking", it would remove a confirmed seat's alert.
    if (!booked) return;
    const statusByRow = new Map(booked.map((row) => [row.user_id, row.status]));
    // One booking: its roster row even when the booking is gone, so a cancelled seat loses its alert.
    const rowIds = oneBooking ? [onlyPersonId] : booked.map((row) => row.user_id);
    const ids = rowIds.filter((id): id is string => Boolean(id));
    if (ids.length === 0) return;

    const holders = this.workshopRead(
      `Roster rows of the bookings of ${what}`,
      await db.from('persons').select('id, claimed_by_user_id').in('id', ids),
    ) as Array<{ id: string; claimed_by_user_id: string | null }> | null;
    if (holders) await this.setBookingAlerts(session, statusByRow, holders, now);
  }

  /** Each account's alert for its booking of a session, at the lead its switches say. */
  private async setBookingAlerts(
    session: WorkshopSessionRow,
    statusByRow: Map<string | null, string | null>,
    holders: Array<{ id: string; claimed_by_user_id: string | null }>,
    now: Date,
  ): Promise<void> {
    const ringsAt = sessionRingsAt(session, now);
    const preferences = await this.getPreferencesByUser(
      holders.map((row) => row.claimed_by_user_id).filter((id): id is string => Boolean(id)),
    );
    await Promise.all(
      holders.map((row) => {
        const userId = row.claimed_by_user_id;
        // A guest booking: no account to tell.
        if (!userId) return undefined;
        const preference = preferences.get(userId);
        const wanted = statusByRow.get(row.id) === 'confirmed' && preference?.enabled !== false;
        return this.scheduleReminder({
          kind: 'workshop_starting',
          entityId: session.id,
          userId,
          // A null time removes the alert: a seat that is not confirmed has none, nor has an
          // account whose main switch is off.
          startsAt: wanted ? ringsAt : null,
          leadMinutes: readLeadMinutes(preference, 'workshop_starting_minutes_before', 15),
          ...workshopStarting(session.workshops?.title),
          url: '/notifications',
          now,
        });
      }),
    );
  }

  /** A read of the own Workshop alert. Best effort: one that fails is logged, and sets nothing. */
  private workshopRead(
    what: string,
    { data, error }: { data: unknown; error: { message: string } | null },
  ): unknown {
    if (error) {
      this.logger.warn(`${what} unreadable; its alerts stay as they were: ${error.message}`);
    }
    return data;
  }

  /** The referee's own alert for one duty: as for many (`scheduleRefereeDutiesStarting`). */
  async scheduleRefereeAssignmentStarting(assignmentId: string, now = new Date()): Promise<void> {
    const row = await this.getRefereeAssignment(assignmentId);
    if (row) await this.scheduleRefereeDutiesStarting([row], now);
  }

  /**
   * The referee's own "your duty starts soon" for MANY duties: the lock tells one, a retime of
   * the bouts every locked duty they start (`MatchAlertRefresherService`). It goes to the account
   * that holds his profile; a referee nobody holds is told nothing. The holders, their switches
   * and the bouts are read in sets, not per duty.
   *
   * Each alert follows ruling 221 (`duty-alert-rings.ts`): set at its start, the record of one
   * that rang kept for the same start, one that still waits removed when the duty has started,
   * has no bout placed, or its account's main switch is off. The holders or the bouts
   * unreadable say nothing about the duties: their alerts stay as they were, with a warning. The
   * switches unreadable count as never saved, and nothing says so.
   */
  async scheduleRefereeDutiesStarting(
    duties: readonly RefereeAssignmentRow[],
    now = new Date(),
  ): Promise<void> {
    const holders = await this.holdersOf(duties);
    const told = duties.flatMap((duty) => {
      const userId = duty.person_id ? holders.get(duty.person_id) : undefined;
      return userId ? [{ duty, userId }] : [];
    });
    if (told.length === 0) return;
    const accounts = [...new Set(told.map((one) => one.userId))];
    const preferences = await this.getPreferencesByUser(accounts);

    // Read only once a reminder can be set.
    const starts = await this.refereeDutyStarts(told.map((one) => one.duty));
    if (!starts) return;
    await Promise.all(
      told.map(({ duty, userId }) => {
        const at = starts.get(duty.id) ?? null;
        return this.setOwnDutyAlert(duty, userId, preferences.get(userId), at, now);
      }),
    );
  }

  /** One duty's own alert: set it, keep the record of one that rang, or remove one that waits. */
  private async setOwnDutyAlert(
    duty: RefereeAssignmentRow,
    userId: string,
    preference: Partial<NotificationPreferenceRow> | undefined,
    startsAt: string | null,
    now: Date,
  ): Promise<void> {
    const held = await this.queue.getJob(
      buildNotificationJobId('referee_starting', duty.id, userId),
    );
    const rings = startsAt !== null && preference?.enabled !== false;
    const step = rings ? dutyAlertStep(startsAt, now, held) : 'remove';
    if (step === 'keep') return;
    // One that fired is kept: it is the memory of what rang.
    if (step === 'remove') {
      if (held && !hasFired(held)) await held.remove();
      return;
    }
    await this.scheduleReminder({
      kind: 'referee_starting',
      entityId: duty.id,
      userId,
      startsAt,
      leadMinutes: readLeadMinutes(preference, 'referee_starting_minutes_before', 10),
      ...refereeStarting(duty.role, duty.matches?.match_number_label),
      url: '/notifications',
      now,
    });
  }

  /**
   * The account that holds each referee's profile (post-0063 a duty names the profile, and an
   * alert needs an account). One read; a failed one is said, and tells nobody.
   */
  private async holdersOf(duties: readonly RefereeAssignmentRow[]): Promise<Map<string, string>> {
    const profileIds = [...new Set(duties.map((duty) => duty.person_id))].filter(
      (id): id is string => Boolean(id),
    );
    if (profileIds.length === 0) return new Map();
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select('id, claimed_by_user_id')
      .in('id', profileIds);
    if (error) {
      this.logger.warn(
        `Holders of ${profileIds.length} referee profile(s) unreadable; their reminders are left as they were: ${error.message}`,
      );
    }
    const rows = (data ?? []) as Array<{ id: string; claimed_by_user_id: string | null }>;
    return new Map(
      rows.flatMap((row) => (row.claimed_by_user_id ? [[row.id, row.claimed_by_user_id]] : [])),
    );
  }

  private async getRefereeAssignment(assignmentId: string): Promise<RefereeAssignmentRow | null> {
    const { data, error } = await this.supabase.service
      .from('referee_assignments')
      .select('id, person_id, pool_id, match_id, role, matches ( match_number_label )')
      .eq('id', assignmentId)
      .maybeSingle();
    if (error) {
      this.logger.warn(
        `Referee assignment ${assignmentId} unreadable; no reminder set: ${error.message}`,
      );
    }
    return (data as RefereeAssignmentRow | null) ?? null;
  }

  /**
   * Each duty's start: its earliest placed Match, null when none is placed. The Matches
   * unreadable is a different answer, `null` for the whole set, logged once.
   */
  private async refereeDutyStarts(
    duties: readonly RefereeAssignmentRow[],
  ): Promise<Map<string, string | null> | null> {
    try {
      return await readDutyStarts(
        this.supabase.service,
        duties.map((duty) => ({ id: duty.id, matchId: duty.match_id, poolId: duty.pool_id })),
      );
    } catch (err) {
      this.logger.warn(
        `Referee assignment ${namedDuties(duties)}: its Matches are unreadable; its reminder is left as it was: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  private async getPreferencesByUser(
    userIds: string[],
  ): Promise<Map<string, Partial<NotificationPreferenceRow>>> {
    if (userIds.length === 0) return new Map();
    const { data } = await this.supabase.service
      .from('notification_preferences')
      .select(
        'user_id, enabled, match_starting_minutes_before, workshop_starting_minutes_before, referee_starting_minutes_before',
      )
      .in('user_id', userIds);

    return new Map(
      ((data ?? []) as NotificationPreferenceRow[]).map((preference) => [
        preference.user_id,
        preference,
      ]),
    );
  }

  private toJobData(input: ReminderInput): ScheduledNotificationJob {
    return {
      kind: input.kind,
      entityId: input.entityId,
      userId: input.userId,
      title: input.title,
      body: input.body,
      url: input.url,
      startsAt: input.startsAt,
    };
  }
}

@Processor(NOTIFICATION_QUEUE)
@Injectable()
export class NotificationSchedulerWorker extends SentryReportingWorkerHost {
  private readonly logger = new Logger(NotificationSchedulerWorker.name);

  constructor(
    private readonly supabase: SupabaseService,
    _config: ConfigService,
    private readonly sender: WebPushSender,
    private readonly mail: MailService,
  ) {
    super();
  }

  /**
   * What came of the job, which BullMQ keeps as its `returnvalue`: a duty alert that fired is
   * kept a day, and a dropped one rang for nobody (ruling 221, `duty-alert-rings.ts`).
   */
  async process(job: Job<ScheduledNotificationJob>): Promise<AlertOutcome> {
    const dropped = await this.reasonToDrop(job.data);
    if (dropped) {
      this.logger.log(`Dropped ${job.data.kind} for ${job.data.entityId}: ${dropped}`);
      return ALERT_DROPPED;
    }
    await this.deliver(job);
    return ALERT_SENT;
  }

  /**
   * Why an alert whose minute came is not sent, or null. Asked when it FIRES: what was true when
   * it was queued may not be any more. Public first: a draft's alert reads nobody's follow.
   */
  private async reasonToDrop(job: ScheduledNotificationJob): Promise<string | null> {
    // Hidden (a draft, or one sent back to draft) or gone.
    if (!(await isPublicAlert(this.supabase, job))) return 'hidden or gone';
    // The follow, the booking or the roster row it was set for is no longer there (ruling 213),
    // or the duty is no longer locked (ruling 220).
    if (!(await isStillWanted(this.supabase, job))) return 'no longer wanted';
    return null;
  }

  private async deliver(job: Job<ScheduledNotificationJob>): Promise<void> {
    const deliveryUserId = job.data.forceEmail ? null : job.data.userId;
    const preference = deliveryUserId ? await this.getPreference(deliveryUserId) : null;
    if (this.isSwitchedOff(job.data, preference)) {
      return this.logger.log(`Skipped ${job.data.kind} for ${job.data.entityId}: switched off`);
    }
    // An address with no account, or an announcement to a reader whose main switch is off.
    if (!deliveryUserId || preference?.enabled === false) {
      await this.sendEmailFallback(job.data);
      await this.markRecipient(job.data, 'delivered');
      return;
    }

    const { data, error } = await this.supabase.service
      .from('push_subscriptions')
      .select('endpoint, p256dh_key, auth_key')
      .eq('user_id', deliveryUserId);

    if (error) throw new Error(`Failed to load push subscriptions: ${error.message}`);

    const subscriptions = (data ?? []) as PushSubscriptionRow[];
    if (subscriptions.length === 0) {
      await this.sendEmailFallback(job.data);
      await this.markRecipient(job.data, 'delivered');
      this.logger.log(
        `Sent ${job.data.kind} notification for ${job.data.entityId} to 0 subscriptions`,
      );
      return;
    }

    await Promise.all(
      subscriptions.map((subscription) =>
        this.sender.send(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh_key,
              auth: subscription.auth_key,
            },
          },
          {
            title: job.data.title,
            body: job.data.body,
            url: job.data.url,
            severity: job.data.severity ?? undefined,
          },
        ),
      ),
    );

    await this.markRecipient(job.data, 'delivered');
    this.logger.log(
      `Sent ${job.data.kind} notification for ${job.data.entityId} to ${subscriptions.length} subscriptions`,
    );
  }

  /** The reader's switches. Unreadable ones count as never saved: the notice goes, with a warning. */
  private async getPreference(userId: string): Promise<TogglePreferences | null> {
    const { data, error } = await this.supabase.service
      .from('notification_preferences')
      .select(`user_id, enabled, ${PREFERENCE_TOGGLE_COLUMNS.join(', ')}`)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) this.logger.warn(`Switches of ${userId} unreadable, taken as on: ${error.message}`);
    return (data as TogglePreferences | null) ?? null;
  }

  /**
   * Off means off (operator ruling 200): no push and no email. A notice is off
   * when its own switch is, or when the main switch is. A broadcast (an
   * organiser's, or an instructor's to a Workshop) passes the main switch and
   * goes by email: "the venue changed" is not a reminder. The email is the
   * fallback of a reader with no push subscription, never the answer to a switch.
   */
  private isSwitchedOff(
    job: ScheduledNotificationJob,
    preference: TogglePreferences | null,
  ): boolean {
    if (job.preference && preference?.[job.preference] === false) return true;
    return preference?.enabled === false && job.kind !== 'organizer_broadcast';
  }

  private async sendEmailFallback(job: ScheduledNotificationJob): Promise<void> {
    if (!job.email) return;
    if (job.kind === 'organizer_broadcast') {
      await this.mail.sendBroadcastNotification({
        to: job.email,
        subject: job.emailSubject ?? job.title,
        title: job.title,
        body: job.body,
        actionUrl: job.url,
        severity: job.severity ?? 'info',
      });
      return;
    }
    await this.mail.sendNotification({
      to: job.email,
      subject: job.emailSubject ?? job.title,
      title: job.title,
      body: job.body,
      actionUrl: job.url,
    });
  }

  private async markRecipient(
    job: ScheduledNotificationJob,
    status: 'delivered' | 'failed',
    error?: string,
  ): Promise<void> {
    if (!job.recipientId) return;
    await this.supabase.service
      .from('event_broadcast_recipients')
      .update({
        delivery_status: status,
        delivered_at: status === 'delivered' ? new Date().toISOString() : null,
        error: error ?? null,
      })
      .eq('id', job.recipientId);
  }
}
