import { describe, expect, it, vi } from 'vitest';
import {
  buildFollowNotificationJobId,
  FollowNotificationSchedulerService,
} from './follow-notification-scheduler.worker';

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
      maybeSingle: vi.fn().mockResolvedValue(result),
    });
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.in.mockReturnValue(chain);
    chain.or.mockReturnValue(chain);
    return chain;
  });
}

describe('follow notification scheduler', () => {
  it('builds stable per-follower match notification job ids', () => {
    expect(buildFollowNotificationJobId('match-1', 'user-1')).toBe(
      'follow:match_starting:match-1:user-1',
    );
  });

  it('queues delayed match-start notifications for claimed followers only', async () => {
    const queue = makeQueue();
    const from = makeSupabaseFrom({
      matches: {
        data: {
          id: 'match-1',
          match_number_label: 'L1-P1-M1',
          scheduled_at: '2026-05-02T10:30:00.000Z',
          red_registration_id: 'reg-red',
          blue_registration_id: 'reg-blue',
          lices: { name: 'Lice 1' },
          pools: { name: 'Pool A' },
        },
        error: null,
      },
      registrations: {
        data: [
          {
            id: 'reg-red',
            person_id: 'person-red',
            persons: { given_name: 'Jean', family_name: 'Dupont' },
          },
          {
            id: 'reg-blue',
            person_id: 'person-blue',
            persons: { given_name: 'Marie', family_name: 'Martin' },
          },
        ],
        error: null,
      },
      follows: {
        data: [
          {
            followed_person_id: 'person-red',
            follower_user_id: 'user-1',
            notify_match_start: true,
          },
          {
            followed_person_id: 'person-red',
            follower_guest_session_id: 'guest-1',
            notify_match_start: true,
          },
          {
            followed_person_id: 'person-blue',
            follower_user_id: 'user-2',
            notify_match_start: false,
          },
        ],
        error: null,
      },
      notification_preferences: {
        data: [{ user_id: 'user-1', enabled: true, match_starting_minutes_before: '10' }],
        error: null,
      },
    });
    const service = new FollowNotificationSchedulerService(
      queue as never,
      { service: { from } } as never,
    );

    await service.scheduleMatchStarting('match-1', new Date('2026-05-02T10:00:00.000Z'));

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({
        kind: 'follow_match_starting',
        entityId: 'match-1',
        userId: 'user-1',
        title: 'Followed fighter starting soon',
        body: 'Jean Dupont fights in 10 min - Pool A vs Marie Martin on Lice 1.',
      }),
      expect.objectContaining({
        jobId: 'follow:match_starting:match-1:user-1',
        delay: 20 * 60_000,
      }),
    );
  });

  it('replaces an existing follower job when a match is rescheduled', async () => {
    const existingJob = { remove: vi.fn().mockResolvedValue(undefined) };
    const queue = makeQueue();
    queue.getJob.mockResolvedValue(existingJob);
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
          {
            id: 'reg-red',
            person_id: 'person-red',
            persons: { given_name: 'Jean', family_name: 'Dupont' },
          },
          {
            id: 'reg-blue',
            person_id: 'person-blue',
            persons: { given_name: 'Marie', family_name: 'Martin' },
          },
        ],
        error: null,
      },
      follows: {
        data: [
          {
            followed_person_id: 'person-red',
            follower_user_id: 'user-1',
            notify_match_start: true,
          },
        ],
        error: null,
      },
      notification_preferences: {
        data: [{ user_id: 'user-1', enabled: true, match_starting_minutes_before: '10' }],
        error: null,
      },
    });
    const service = new FollowNotificationSchedulerService(
      queue as never,
      { service: { from } } as never,
    );

    await service.scheduleMatchStarting('match-1', new Date('2026-05-02T10:00:00.000Z'));

    expect(queue.getJob).toHaveBeenCalledWith('follow:match_starting:match-1:user-1');
    expect(existingJob.remove).toHaveBeenCalledOnce();
    expect(queue.add).toHaveBeenCalledTimes(1);
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

    expect(queue.getJob).toHaveBeenCalledWith('follow:match_starting:match-1:user-1');
    expect(queue.getJob).toHaveBeenCalledWith('follow:match_starting:match-2:user-1');
    expect(existingJob.remove).toHaveBeenCalledTimes(2);
  });
});
