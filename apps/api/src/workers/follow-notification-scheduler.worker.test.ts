import { describe, expect, it, vi } from 'vitest';
import { FollowNotificationSchedulerService } from './follow-notification-scheduler.worker';

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
      or: vi.fn(),
      not: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue(result),
    });
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.in.mockReturnValue(chain);
    chain.or.mockReturnValue(chain);
    chain.not.mockReturnValue(chain);
    return chain;
  });
}

describe('follow notification scheduler — workshops, referees, unfollow', () => {
  it('queues delayed workshop-start notifications for claimed followers of the instructor', async () => {
    const queue = makeQueue();
    const from = makeSupabaseFrom({
      workshop_sessions: {
        data: {
          id: 'session-1',
          starts_at: '2026-05-02T14:00:00.000Z',
          status: 'scheduled',
          workshops: { id: 'workshop-1', title: 'Longsword Basics', event_id: 'event-1' },
        },
        error: null,
      },
      workshop_instructors: {
        data: [{ global_person_id: 'gp-coach' }],
        error: null,
      },
      persons: {
        data: [{ id: 'person-coach', global_person_id: 'gp-coach' }],
        error: null,
      },
      follows: {
        data: [
          {
            followed_person_id: 'person-coach',
            follower_user_id: 'user-1',
            notify_workshop_start: true,
          },
          {
            followed_person_id: 'person-coach',
            follower_user_id: 'user-2',
            notify_workshop_start: false,
          },
        ],
        error: null,
      },
      notification_preferences: {
        data: [{ user_id: 'user-1', enabled: true, workshop_starting_minutes_before: '15' }],
        error: null,
      },
      global_persons: {
        data: [{ id: 'gp-coach', display_name: 'Coach Ada' }],
        error: null,
      },
    });
    const service = new FollowNotificationSchedulerService(
      queue as never,
      { service: { from } } as never,
    );

    await service.scheduleWorkshopStarting('session-1', new Date('2026-05-02T13:30:00.000Z'));

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({
        kind: 'follow_workshop_starting',
        entityId: 'session-1',
        userId: 'user-1',
        title: 'Followed instructor workshop soon',
        body: 'Longsword Basics with Coach Ada starts in 15 min.',
      }),
      expect.objectContaining({
        jobId: 'follow.workshop_starting.session-1.user-1',
        delay: 15 * 60_000,
      }),
    );
  });

  it('does not schedule a workshop reminder for a cancelled session', async () => {
    const queue = makeQueue();
    const from = makeSupabaseFrom({
      workshop_sessions: {
        data: {
          id: 'session-1',
          starts_at: '2026-05-02T14:00:00.000Z',
          status: 'cancelled',
          workshops: { id: 'workshop-1', title: 'Longsword Basics', event_id: 'event-1' },
        },
        error: null,
      },
    });
    const service = new FollowNotificationSchedulerService(
      queue as never,
      { service: { from } } as never,
    );

    await service.scheduleWorkshopStarting('session-1', new Date('2026-05-02T13:30:00.000Z'));

    expect(queue.add).not.toHaveBeenCalled();
  });

  it('cancels pending match jobs when a claimed user unfollows a person', async () => {
    const existingJob = { remove: vi.fn().mockResolvedValue(undefined) };
    const queue = makeQueue();
    queue.getJob.mockResolvedValue(existingJob);
    const from = makeSupabaseFrom({
      registrations: {
        data: [{ id: 'reg-1' }],
        error: null,
      },
      matches: {
        data: [{ id: 'match-1' }, { id: 'match-2' }],
        error: null,
      },
    });
    const service = new FollowNotificationSchedulerService(
      queue as never,
      { service: { from } } as never,
    );

    await service.cancelForFollowedPerson('person-1', 'user-1');

    expect(queue.getJob).toHaveBeenCalledWith('follow.match_starting.match-1.user-1');
    expect(queue.getJob).toHaveBeenCalledWith('follow.match_starting.match-2.user-1');
    expect(existingJob.remove).toHaveBeenCalledTimes(2);
  });
});
