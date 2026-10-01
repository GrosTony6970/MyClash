/**
 * A lock message the send gate dropped is sent again on publish, even the same day (ruling 186).
 * Claire locks the board at 10:00 while the Winter Secret is a draft: Marc's lock message is
 * queued, and the worker drops it at the gate. BullMQ keeps that job a day under its id, and a
 * plain send skips an id it holds: at 11:00 the publish must replace it, not be swallowed by it.
 * Runs through the real scheduler, over a queue that keeps its jobs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../../common/testing/supabase-chain';
import { NotificationSchedulerService } from '../../../workers/notification-scheduler.worker';
import { NotificationEventsService } from './notification-events.service';

const MARC_JOB = 'notification.assignment_changed.d-marc.u-marc';

function keepingQueue() {
  const jobs = new Map<string, { remove: () => Promise<void> }>();
  const added: string[] = [];
  return {
    added,
    getJob: vi.fn(async (id: string) => jobs.get(id) ?? null),
    // As BullMQ: adding under an id it still holds adds nothing.
    add: vi.fn(async (_name: string, _data: unknown, opts: { jobId: string }) => {
      if (jobs.has(opts.jobId)) return;
      added.push(opts.jobId);
      jobs.set(opts.jobId, {
        remove: async () => {
          jobs.delete(opts.jobId);
        },
      });
    }),
  };
}

let queue: ReturnType<typeof keepingQueue>;
let events: NotificationEventsService;

beforeEach(() => {
  const db = mockSupabase({
    referee_assignments: {
      rows: [
        {
          id: 'd-marc',
          event_id: 'e-winter',
          status: 'confirmed',
          person_id: 'gp-marc',
          role: 'Referee',
          pools: { phases: { tournament_id: 't-winter-secret' } },
          matches: null,
        },
      ],
    },
    global_persons: {
      rows: [{ id: 'gp-marc', claimed_by_user_id: 'u-marc' }],
    },
  });
  queue = keepingQueue();
  const getAuthAdminUser = async () => ({ ok: true, status: 200, data: { id: 'u-marc' } });
  events = new NotificationEventsService(
    { ...db, getAuthAdminUser } as never,
    new NotificationSchedulerService(queue as never, db as never),
  );
});

describe("Marc's lock message, dropped at 10:00, is sent again at 11:00 (ruling 186)", () => {
  it('the publish replaces the job the dropped lock message left', async () => {
    await events.assignmentChanged('d-marc');
    expect(queue.added).toEqual([MARC_JOB]);

    await events.lockedDutiesPublished('e-winter', 't-winter-secret');
    expect(queue.added).toEqual([MARC_JOB, MARC_JOB]);
  });

  it('a second lock of the same duty still sends nothing new', async () => {
    await events.assignmentChanged('d-marc');
    await events.assignmentChanged('d-marc');
    expect(queue.added).toEqual([MARC_JOB]);
  });
});
