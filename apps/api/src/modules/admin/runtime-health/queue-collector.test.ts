import { describe, it, expect } from 'vitest';
import { collectQueues } from './queue-collector';

describe('collectQueues', () => {
  it('sums waiting + failed across queues and returns per-queue rows', async () => {
    const counts: Record<
      string,
      { active: number; waiting: number; delayed: number; failed: number }
    > = {
      'notification-scheduler': { active: 1, waiting: 3, delayed: 0, failed: 0 },
      'event-archive': { active: 0, waiting: 2, delayed: 1, failed: 2 },
    };
    const queueFactory = (name: string) => ({
      getJobCounts: async () => counts[name]!,
      close: async () => undefined,
    });
    const result = await collectQueues({} as never, {
      names: ['notification-scheduler', 'event-archive'],
      queueFactory,
    });
    expect(result.totalWaiting).toBe(5);
    expect(result.totalFailed).toBe(2);
    expect(result.queues).toHaveLength(2);
    expect(result.queues[1]).toEqual({
      name: 'event-archive',
      active: 0,
      waiting: 2,
      delayed: 1,
      failed: 2,
    });
  });
});
