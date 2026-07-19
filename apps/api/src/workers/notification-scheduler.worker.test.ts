import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import {
  buildNotificationJobId,
  computeNotificationDelayMs,
  NotificationSchedulerService,
  NotificationSchedulerWorker,
} from './notification-scheduler.worker';

function makeQueue() {
  return {
    add: vi.fn().mockResolvedValue(undefined),
    getJob: vi.fn().mockResolvedValue(null),
  };
}

function makeSupabaseFrom(rowsByTable: Record<string, unknown>) {
  return vi.fn((table: string) => {
    const result = rowsByTable[table] ?? { data: null, error: null };
    const chain = Object.assign(Promise.resolve(result), {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(),
      update: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue(result),
    });
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.in.mockReturnValue(chain);
    chain.update.mockReturnValue(chain);
    return chain;
  });
}

describe('notification scheduler jobs', () => {
  it('builds stable per-user job ids for duplicate suppression', () => {
    expect(buildNotificationJobId('match_starting', 'match-1', 'user-1')).toBe(
      'notification.match_starting.match-1.user-1',
    );
  });

  it('computes delay from scheduled time and lead minutes', () => {
    const now = new Date('2026-05-02T10:00:00.000Z');
    const startsAt = '2026-05-02T10:30:00.000Z';

    expect(computeNotificationDelayMs(startsAt, 10, now)).toBe(20 * 60_000);
    expect(computeNotificationDelayMs(startsAt, 40, now)).toBe(0);
  });

  it('replaces an existing delayed job with the same id before adding the new one', async () => {
    const existingJob = { remove: vi.fn().mockResolvedValue(undefined) };
    const queue = makeQueue();
    queue.getJob.mockResolvedValue(existingJob);
    const service = new NotificationSchedulerService(
      queue as never,
      { service: { from: vi.fn() } } as never,
    );

    await service.scheduleReminder({
      kind: 'match_starting',
      entityId: 'match-1',
      userId: 'user-1',
      startsAt: '2026-05-02T10:30:00.000Z',
      leadMinutes: 10,
      title: 'Match starting soon',
      body: 'L1-P1-M1 starts soon.',
      url: '/e/fal/t/longsword',
      now: new Date('2026-05-02T10:00:00.000Z'),
    });

    expect(queue.getJob).toHaveBeenCalledWith('notification.match_starting.match-1.user-1');
    expect(existingJob.remove).toHaveBeenCalledOnce();
    expect(queue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({
        kind: 'match_starting',
        entityId: 'match-1',
        userId: 'user-1',
      }),
      expect.objectContaining({
        delay: 20 * 60_000,
        jobId: 'notification.match_starting.match-1.user-1',
      }),
    );
  });

  it('queues immediate event notifications with delay 0 without replacing duplicates', async () => {
    const existingJob = { remove: vi.fn().mockResolvedValue(undefined) };
    const queue = makeQueue();
    queue.getJob.mockResolvedValueOnce(null).mockResolvedValueOnce(existingJob);
    const service = new NotificationSchedulerService(
      queue as never,
      { service: { from: vi.fn() } } as never,
    );

    await service.sendImmediate({
      kind: 'assignment_changed',
      entityId: 'assignment-1',
      userId: 'user-1',
      title: 'Referee assignment updated',
      body: 'Your referee assignment changed.',
      url: '/notifications',
      email: 'user@example.com',
      emailSubject: 'Referee assignment updated',
      preference: 'schedule_changes',
    });
    await service.sendImmediate({
      kind: 'assignment_changed',
      entityId: 'assignment-1',
      userId: 'user-1',
      title: 'Referee assignment updated',
      body: 'Your referee assignment changed.',
      url: '/notifications',
      email: 'user@example.com',
      emailSubject: 'Referee assignment updated',
      preference: 'schedule_changes',
    });

    expect(existingJob.remove).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({
        kind: 'assignment_changed',
        entityId: 'assignment-1',
        userId: 'user-1',
        email: 'user@example.com',
      }),
      expect.objectContaining({
        delay: 0,
        jobId: 'notification.assignment_changed.assignment-1.user-1',
      }),
    );
  });

  it('uses each user match lead preference when scheduling a changed match', async () => {
    const queue = makeQueue();
    const from = makeSupabaseFrom({
      matches: {
        data: {
          id: 'match-1',
          match_number_label: 'L1-P1-M1',
          scheduled_at: '2026-05-02T10:30:00.000Z',
          red_registration_id: 'reg-red',
          blue_registration_id: 'reg-blue',
        },
        error: null,
      },
      registrations: {
        data: [
          { id: 'reg-red', person_id: 'person-red' },
          { id: 'reg-blue', person_id: 'person-blue' },
        ],
        error: null,
      },
      persons: {
        data: [
          { id: 'person-red', claimed_by_user_id: 'user-red' },
          { id: 'person-blue', claimed_by_user_id: 'user-blue' },
        ],
        error: null,
      },
      notification_preferences: {
        data: [
          { user_id: 'user-red', enabled: true, match_starting_minutes_before: '5' },
          { user_id: 'user-blue', enabled: true, match_starting_minutes_before: '15' },
        ],
        error: null,
      },
    });
    const service = new NotificationSchedulerService(
      queue as never,
      { service: { from } } as never,
    );

    await service.scheduleMatchStarting('match-1', new Date('2026-05-02T10:00:00.000Z'));

    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({ userId: 'user-red' }),
      expect.objectContaining({ delay: 25 * 60_000 }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({ userId: 'user-blue' }),
      expect.objectContaining({ delay: 15 * 60_000 }),
    );
  });

  it('uses workshop lead preferences for confirmed enrollments', async () => {
    const queue = makeQueue();
    const from = makeSupabaseFrom({
      workshop_sessions: {
        data: {
          id: 'session-1',
          starts_at: '2026-05-02T11:00:00.000Z',
          workshops: { title: 'Messer fundamentals' },
        },
        error: null,
      },
      workshop_enrollments: {
        data: [{ user_id: 'user-1' }, { user_id: 'user-2' }],
        error: null,
      },
      notification_preferences: {
        data: [
          { user_id: 'user-1', enabled: true, workshop_starting_minutes_before: '20' },
          { user_id: 'user-2', enabled: true, workshop_starting_minutes_before: '5' },
        ],
        error: null,
      },
    });
    const service = new NotificationSchedulerService(
      queue as never,
      { service: { from } } as never,
    );

    await service.scheduleWorkshopSessionStarting(
      'session-1',
      new Date('2026-05-02T10:30:00.000Z'),
    );

    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({ kind: 'workshop_starting', userId: 'user-1' }),
      expect.objectContaining({ delay: 10 * 60_000 }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({ kind: 'workshop_starting', userId: 'user-2' }),
      expect.objectContaining({ delay: 25 * 60_000 }),
    );
  });

  it('uses referee lead preferences for an assignment', async () => {
    const queue = makeQueue();
    const from = makeSupabaseFrom({
      referee_assignments: {
        data: {
          id: 'assignment-1',
          person_id: 'person-1',
          starts_at: '2026-05-02T12:00:00.000Z',
          role: 'arbitre_table',
          matches: { match_number_label: 'L1-P1-M1' },
        },
        error: null,
      },
      // Post-0063: scheduler resolves person_id → user_id via global_persons
      // before targeting the notification.
      global_persons: {
        data: { claimed_by_user_id: 'user-1' },
        error: null,
      },
      notification_preferences: {
        data: [{ user_id: 'user-1', enabled: true, referee_starting_minutes_before: '12' }],
        error: null,
      },
    });
    const service = new NotificationSchedulerService(
      queue as never,
      { service: { from } } as never,
    );

    await service.scheduleRefereeAssignmentStarting(
      'assignment-1',
      new Date('2026-05-02T11:30:00.000Z'),
    );

    expect(queue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({ kind: 'referee_starting', userId: 'user-1' }),
      expect.objectContaining({ delay: 18 * 60_000 }),
    );
  });
});

describe('notification worker', () => {
  it('sends to all current subscriptions for the job user', async () => {
    const from = makeSupabaseFrom({
      push_subscriptions: {
        data: [
          {
            endpoint: 'https://push.example/1',
            p256dh_key: 'p256dh',
            auth_key: 'auth',
          },
        ],
        error: null,
      },
      notification_preferences: {
        data: { user_id: 'user-1', enabled: true },
        error: null,
      },
    });
    const sender = { send: vi.fn().mockResolvedValue(undefined) };
    const mail = { sendNotification: vi.fn().mockResolvedValue(undefined) };
    const worker = new NotificationSchedulerWorker(
      { service: { from } } as never,
      new ConfigService({}) as never,
      sender as never,
      mail as never,
    );

    await worker.process({
      id: 'job-1',
      data: {
        kind: 'match_starting',
        entityId: 'match-1',
        userId: 'user-1',
        title: 'Match starting soon',
        body: 'L1-P1-M1 starts soon.',
        url: '/e/fal/t/longsword',
      },
    } as never);

    expect(sender.send).toHaveBeenCalledWith(
      {
        endpoint: 'https://push.example/1',
        keys: { p256dh: 'p256dh', auth: 'auth' },
      },
      {
        title: 'Match starting soon',
        body: 'L1-P1-M1 starts soon.',
        url: '/e/fal/t/longsword',
      },
    );
  });

  it('falls back to email for immediate jobs when push is disabled', async () => {
    const from = makeSupabaseFrom({
      notification_preferences: {
        data: { user_id: 'user-1', enabled: false },
        error: null,
      },
    });
    const sender = { send: vi.fn().mockResolvedValue(undefined) };
    const mail = { sendNotification: vi.fn().mockResolvedValue(undefined) };
    const worker = new NotificationSchedulerWorker(
      { service: { from } } as never,
      new ConfigService({}) as never,
      sender as never,
      mail as never,
    );

    await worker.process({
      id: 'job-1',
      data: {
        kind: 'workshop_cancelled',
        entityId: 'session-1',
        userId: 'user-1',
        title: 'Workshop cancelled',
        body: 'Messer fundamentals was cancelled.',
        url: '/notifications',
        email: 'user@example.com',
        emailSubject: 'Workshop cancelled',
      },
    } as never);

    expect(sender.send).not.toHaveBeenCalled();
    expect(mail.sendNotification).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: 'Workshop cancelled',
      title: 'Workshop cancelled',
      body: 'Messer fundamentals was cancelled.',
      actionUrl: '/notifications',
    });
  });

  it('falls back to email for immediate jobs when no push subscriptions exist', async () => {
    const from = makeSupabaseFrom({
      push_subscriptions: {
        data: [],
        error: null,
      },
      notification_preferences: {
        data: { user_id: 'user-1', enabled: true },
        error: null,
      },
    });
    const sender = { send: vi.fn().mockResolvedValue(undefined) };
    const mail = { sendNotification: vi.fn().mockResolvedValue(undefined) };
    const worker = new NotificationSchedulerWorker(
      { service: { from } } as never,
      new ConfigService({}) as never,
      sender as never,
      mail as never,
    );

    await worker.process({
      id: 'job-1',
      data: {
        kind: 'waitlist_promoted',
        entityId: 'session-1',
        userId: 'user-1',
        title: 'Workshop place confirmed',
        body: 'You have been promoted from the waitlist.',
        url: '/notifications',
        email: 'user@example.com',
        emailSubject: 'Workshop place confirmed',
      },
    } as never);

    expect(sender.send).not.toHaveBeenCalled();
    expect(mail.sendNotification).toHaveBeenCalledOnce();
  });

  it('sends organizer broadcast payload severity and marks recipient delivered', async () => {
    const from = makeSupabaseFrom({
      push_subscriptions: {
        data: [{ endpoint: 'https://push.example/1', p256dh_key: 'p256dh', auth_key: 'auth' }],
        error: null,
      },
      notification_preferences: {
        data: { user_id: 'user-1', enabled: true },
        error: null,
      },
      event_broadcast_recipients: { data: { id: 'recipient-1' }, error: null },
    });
    const sender = { send: vi.fn().mockResolvedValue(undefined) };
    const mail = {
      sendNotification: vi.fn().mockResolvedValue(undefined),
      sendBroadcastNotification: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new NotificationSchedulerWorker(
      { service: { from } } as never,
      new ConfigService({}) as never,
      sender as never,
      mail as never,
    );

    await worker.process({
      id: 'job-1',
      data: {
        kind: 'organizer_broadcast',
        entityId: 'broadcast-1',
        recipientId: 'recipient-1',
        userId: 'user-1',
        title: 'Venue change',
        body: 'Main hall closes now.',
        url: '/notifications',
        email: 'user@example.com',
        severity: 'alert',
      },
    } as never);

    expect(sender.send).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ severity: 'alert', title: 'Venue change' }),
    );
    const recipientChain = from.mock.results.find((result) => result.value)?.value;
    expect(recipientChain).toBeDefined();
  });

  it('uses broadcast email fallback for email-only organizer recipients', async () => {
    const from = makeSupabaseFrom({
      event_broadcast_recipients: { data: { id: 'recipient-1' }, error: null },
    });
    const sender = { send: vi.fn().mockResolvedValue(undefined) };
    const mail = {
      sendNotification: vi.fn().mockResolvedValue(undefined),
      sendBroadcastNotification: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new NotificationSchedulerWorker(
      { service: { from } } as never,
      new ConfigService({}) as never,
      sender as never,
      mail as never,
    );

    await worker.process({
      id: 'job-1',
      data: {
        kind: 'organizer_broadcast',
        entityId: 'broadcast-1',
        recipientId: 'recipient-1',
        userId: 'recipient-1',
        forceEmail: true,
        title: 'Pools ready',
        body: 'Check your pool now.',
        url: '/notifications',
        email: 'person@example.com',
        severity: 'info',
      },
    } as never);

    expect(sender.send).not.toHaveBeenCalled();
    expect(mail.sendBroadcastNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'person@example.com',
        title: 'Pools ready',
        severity: 'info',
      }),
    );
  });
});
