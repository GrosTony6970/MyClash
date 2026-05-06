import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
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
  | 'organizer_broadcast';

export type FollowNotificationKind = 'follow_match_starting';

export type NotificationKind =
  | ScheduledNotificationKind
  | ImmediateNotificationKind
  | FollowNotificationKind;

export type NotificationPreferenceToggle = 'schedule_changes' | 'results_published';

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

interface PushSubscriptionRow {
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
}

interface NotificationPreferenceRow {
  user_id: string;
  enabled: boolean;
  match_starting_minutes_before: string | number | null;
  workshop_starting_minutes_before: string | number | null;
  referee_starting_minutes_before: string | number | null;
  schedule_changes?: boolean | null;
  results_published?: boolean | null;
}

export function buildNotificationJobId(
  kind: NotificationKind,
  entityId: string,
  userId: string,
): string {
  return `notification:${kind}:${entityId}:${userId}`;
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

  async scheduleMatchStarting(matchId: string, now = new Date()): Promise<void> {
    const { data: match, error } = await this.supabase.service
      .from('matches')
      .select('id, match_number_label, scheduled_at, red_registration_id, blue_registration_id')
      .eq('id', matchId)
      .maybeSingle();

    if (error || !match) return;
    const row = match as {
      id: string;
      match_number_label: string | null;
      scheduled_at: string | null;
      red_registration_id: string | null;
      blue_registration_id: string | null;
    };
    const registrationIds = [row.red_registration_id, row.blue_registration_id].filter(
      (id): id is string => Boolean(id),
    );
    if (registrationIds.length === 0) return;

    const { data: registrations } = await this.supabase.service
      .from('registrations')
      .select('id, person_id')
      .in('id', registrationIds);
    const personIds = ((registrations ?? []) as Array<{ person_id: string | null }>)
      .map((registration) => registration.person_id)
      .filter((id): id is string => Boolean(id));
    if (personIds.length === 0) return;

    const { data: persons } = await this.supabase.service
      .from('persons')
      .select('id, claimed_by_user_id')
      .in('id', personIds);
    const userIds = Array.from(
      new Set(
        ((persons ?? []) as Array<{ claimed_by_user_id: string | null }>)
          .map((person) => person.claimed_by_user_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    const preferences = await this.getPreferencesByUser(userIds);
    await Promise.all(
      userIds.map((userId) => {
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
    );
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
    const { data: assignment } = await this.supabase.service
      .from('referee_assignments')
      .select('id, user_id, starts_at, role, matches ( match_number_label )')
      .eq('id', assignmentId)
      .maybeSingle();
    if (!assignment) return;

    const row = assignment as {
      id: string;
      user_id: string | null;
      starts_at: string | null;
      role: string | null;
      matches?: { match_number_label?: string | null } | null;
    };
    if (!row.user_id) return;

    const preferences = await this.getPreferencesByUser([row.user_id]);
    const preference = preferences.get(row.user_id);
    if (preference?.enabled === false) return;

    await this.scheduleReminder({
      kind: 'referee_starting',
      entityId: row.id,
      userId: row.user_id,
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
export class NotificationSchedulerWorker extends WorkerHost {
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

  private async getPreference(
    userId: string,
  ): Promise<Pick<
    NotificationPreferenceRow,
    'enabled' | 'schedule_changes' | 'results_published'
  > | null> {
    const { data } = await this.supabase.service
      .from('notification_preferences')
      .select('user_id, enabled, schedule_changes, results_published')
      .eq('user_id', userId)
      .maybeSingle();
    return (
      (data as Pick<
        NotificationPreferenceRow,
        'enabled' | 'schedule_changes' | 'results_published'
      > | null) ?? null
    );
  }

  private isDisabledByPreference(
    job: ScheduledNotificationJob,
    preference: Pick<
      NotificationPreferenceRow,
      'enabled' | 'schedule_changes' | 'results_published'
    > | null,
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
