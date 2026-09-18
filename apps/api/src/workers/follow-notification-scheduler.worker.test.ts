import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor } from '../common/testing/supabase-chain';
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

/**
 * A duty's Matches come from the seeded double, which applies `.in()`. The decoy
 * Pool's Match is the earliest of all, and one Match of the duty's Pool is not
 * placed. The helper filters by Pool twice (the `.in()`, then per duty), so the
 * decoy shows only when both are lost; each alone is held in duty-windows.test.ts.
 */
const DUTY_MATCHES = [
  {
    id: 'm-late',
    pool_id: 'pool-1',
    phase_id: 'ph',
    scheduled_at: '2026-05-02T12:05:00.000Z',
    planned_duration_override_minutes: null,
  },
  {
    id: 'm-early',
    pool_id: 'pool-1',
    phase_id: 'ph',
    scheduled_at: '2026-05-02T12:00:00.000Z',
    planned_duration_override_minutes: null,
  },
  {
    id: 'm-unplaced',
    pool_id: 'pool-1',
    phase_id: 'ph',
    scheduled_at: null,
    planned_duration_override_minutes: null,
  },
  {
    id: 'm-decoy',
    pool_id: 'pool-decoy',
    phase_id: 'ph',
    scheduled_at: '2026-05-02T11:40:00.000Z',
    planned_duration_override_minutes: null,
  },
];

function withDutyMatches(
  local: ReturnType<typeof makeSupabaseFrom>,
  matches: Parameters<typeof mockSupabase>[0][string] = { rows: DUTY_MATCHES },
) {
  const seeded = mockSupabase({ matches });
  return vi.fn((table: string) => (table === 'matches' ? seeded.from(table) : local(table)));
}

const FOLLOW = {
  followed_person_id: 'person-ref',
  follower_user_id: 'user-1',
  notify_referee_start: true,
};

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

describe('follow notification scheduler — a followed referee starting', () => {
  const tables = (assignment: Record<string, unknown>, follows: unknown[] = [FOLLOW]) =>
    makeSupabaseFrom({
      referee_assignments: {
        data: {
          id: 'assignment-1',
          person_id: 'gp-ref',
          event_id: 'event-1',
          pool_id: null,
          match_id: null,
          role: 'arbitre_table',
          matches: null,
          ...assignment,
        },
        error: null,
      },
      persons: { data: [{ id: 'person-ref' }], error: null },
      follows: { data: follows, error: null },
      notification_preferences: {
        data: [{ user_id: 'user-1', enabled: true, referee_starting_minutes_before: '10' }],
        error: null,
      },
      global_persons: { data: { display_name: 'Ref Rita' }, error: null },
    });

  const service = (queue: ReturnType<typeof makeQueue>, from: unknown) =>
    new FollowNotificationSchedulerService(queue as never, { service: { from } } as never);

  it("queues each follower's alert from the duty's own Pool's earliest placed Match", async () => {
    const queue = makeQueue();
    const from = withDutyMatches(tables({ pool_id: 'pool-1' }));

    await service(queue, from).scheduleRefereeStarting(
      'assignment-1',
      new Date('2026-05-02T11:30:00.000Z'),
    );

    // 12:00 is the Pool's earliest placed Match; 10 minutes' lead from 11:30.
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({
        kind: 'follow_referee_starting',
        entityId: 'assignment-1',
        userId: 'user-1',
      }),
      expect.objectContaining({ delay: 20 * 60_000 }),
    );
    // The double ignores the projection: assert the read names no stored time.
    expect(selectsFor(from as never, 'referee_assignments')).toEqual([
      'id, person_id, event_id, pool_id, match_id, role, matches ( match_number_label, lices ( name ) )',
    ]);
    expect(selectsFor(from as never, 'matches')).toEqual([
      'id, pool_id, lice_id, phase_id, scheduled_at, planned_duration_override_minutes',
    ]);
  });

  it('times a duty on one Match from that Match', async () => {
    const queue = makeQueue();
    const from = withDutyMatches(tables({ match_id: 'm-late' }));

    await service(queue, from).scheduleRefereeStarting(
      'assignment-1',
      new Date('2026-05-02T11:30:00.000Z'),
    );

    expect(queue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({ kind: 'follow_referee_starting' }),
      expect.objectContaining({ delay: 25 * 60_000 }),
    );
  });

  it('queues nothing when nothing the duty covers is placed', async () => {
    const queue = makeQueue();
    const from = withDutyMatches(tables({ match_id: 'm-unplaced' }));

    await service(queue, from).scheduleRefereeStarting(
      'assignment-1',
      new Date('2026-05-02T11:30:00.000Z'),
    );

    expect(queue.add).not.toHaveBeenCalled();
  });

  it('reads no Match when nobody follows the referee', async () => {
    const queue = makeQueue();
    const from = withDutyMatches(tables({ pool_id: 'pool-1' }, []));

    await service(queue, from).scheduleRefereeStarting(
      'assignment-1',
      new Date('2026-05-02T11:30:00.000Z'),
    );

    expect(selectsFor(from as never, 'matches')).toEqual([]);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('says so, and queues nothing, when the Matches cannot be read', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const queue = makeQueue();
    const from = withDutyMatches(tables({ pool_id: 'pool-1' }), {
      data: null,
      error: { message: 'matches exploded' },
    });

    await service(queue, from).scheduleRefereeStarting(
      'assignment-1',
      new Date('2026-05-02T11:30:00.000Z'),
    );

    expect(queue.add).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('matches exploded');
    warn.mockRestore();
  });
});
