import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue, Processor } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { SentryReportingWorkerHost } from './sentry-reporting-worker-host';
import * as webPush from 'web-push';
import { MailService } from '../modules/mail/mail.service';
import { SupabaseService } from '../modules/supabase/supabase.service';

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

@Injectable()
export class NotificationSchedulerService {
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
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }

  async sendImmediate(input: ScheduledNotificationJob): Promise<void> {
    const jobId = buildNotificationJobId(input.kind, input.entityId, input.userId);
    const existing = await this.queue.getJob(jobId);
    if (existing) return;

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
            title: 'Match starting soon',
            body: `${row.match_number_label ?? 'Your match'} starts soon.`,
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

  async scheduleWorkshopSessionStarting(sessionId: string, now = new Date()): Promise<void> {
    const { data: session } = await this.supabase.service
      .from('workshop_sessions')
      .select('id, starts_at, workshops ( title, slug )')
      .eq('id', sessionId)
      .maybeSingle();
    if (!session) return;

    const row = session as {
      id: string;
      starts_at: string | null;
      workshops?: { title?: string | null; slug?: string | null } | null;
    };
    const { data: enrollments } = await this.supabase.service
      .from('workshop_enrollments')
      .select('user_id')
      .eq('workshop_session_id', sessionId)
      .eq('status', 'confirmed');
    const userIds = Array.from(
      new Set(
        ((enrollments ?? []) as Array<{ user_id: string | null }>)
          .map((enrollment) => enrollment.user_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    const preferences = await this.getPreferencesByUser(userIds);
    await Promise.all(
      userIds.map((userId) => {
        const preference = preferences.get(userId);
        if (preference?.enabled === false) return undefined;
        return this.scheduleReminder({
          kind: 'workshop_starting',
          entityId: row.id,
          userId,
          startsAt: row.starts_at,
          leadMinutes: readLeadMinutes(preference, 'workshop_starting_minutes_before', 15),
          title: 'Workshop starting soon',
          body: `${row.workshops?.title ?? 'Your workshop'} starts soon.`,
          url: '/notifications',
          now,
        });
      }),
    );
  }

  async scheduleRefereeAssignmentStarting(assignmentId: string, now = new Date()): Promise<void> {
    // Post-0063: referee_assignments keys on person_id. Resolve to the
    // claimed user_id (notifications need a Supabase auth identity to
    // target). Unclaimed referees can't receive push/email — skip.
    const { data: assignment } = await this.supabase.service
      .from('referee_assignments')
      .select('id, person_id, starts_at, role, matches ( match_number_label )')
      .eq('id', assignmentId)
      .maybeSingle();
    if (!assignment) return;

    const row = assignment as {
      id: string;
      person_id: string | null;
      starts_at: string | null;
      role: string | null;
      matches?: { match_number_label?: string | null } | null;
    };
    if (!row.person_id) return;

    const { data: gp } = await this.supabase.service
      .from('global_persons')
      .select('claimed_by_user_id')
      .eq('id', row.person_id)
      .maybeSingle();
    const userId = (gp as { claimed_by_user_id: string | null } | null)?.claimed_by_user_id;
    if (!userId) return;

    const preferences = await this.getPreferencesByUser([userId]);
    const preference = preferences.get(userId);
    if (preference?.enabled === false) return;

    await this.scheduleReminder({
      kind: 'referee_starting',
      entityId: row.id,
      userId,
      startsAt: row.starts_at,
      leadMinutes: readLeadMinutes(preference, 'referee_starting_minutes_before', 10),
      title: 'Referee slot starting soon',
      body: `${row.role ?? 'Your referee assignment'} starts soon${
        row.matches?.match_number_label ? ` for ${row.matches.match_number_label}` : ''
      }.`,
      url: '/notifications',
      now,
    });
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

  async process(job: Job<ScheduledNotificationJob>): Promise<void> {
    const deliveryUserId = job.data.forceEmail ? null : job.data.userId;
    const preference = deliveryUserId ? await this.getPreference(deliveryUserId) : null;
    if (
      !deliveryUserId ||
      preference?.enabled === false ||
      this.isDisabledByPreference(job.data, preference)
    ) {
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

  private async getPreference(userId: string): Promise<TogglePreferences | null> {
    const { data } = await this.supabase.service
      .from('notification_preferences')
      .select(`user_id, enabled, ${PREFERENCE_TOGGLE_COLUMNS.join(', ')}`)
      .eq('user_id', userId)
      .maybeSingle();
    return (data as TogglePreferences | null) ?? null;
  }

  private isDisabledByPreference(
    job: ScheduledNotificationJob,
    preference: TogglePreferences | null,
  ): boolean {
    return Boolean(job.preference && preference?.[job.preference] === false);
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
