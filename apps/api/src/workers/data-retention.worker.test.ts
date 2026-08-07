import { describe, expect, it, vi } from 'vitest';
import { DATA_RETENTION_JOB, DataRetentionWorker } from './data-retention.worker';

function makeWorker(sweep = vi.fn().mockResolvedValue({ guest_sessions: 3 })) {
  const queue = {
    add: vi.fn().mockResolvedValue(undefined),
    upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
  };
  const retention = { runSweep: sweep };
  return {
    worker: new DataRetentionWorker(queue as never, retention as never),
    queue,
    sweep,
  };
}

describe('DataRetentionWorker', () => {
  it('schedules a daily sweep at 05:00 UTC under a fixed scheduler id', async () => {
    const { worker, queue } = makeWorker();
    await worker.onModuleInit();

    const [schedulerId, repeatOpts, template] = queue.upsertJobScheduler.mock.calls[0] as [
      string,
      { pattern: string },
      { name: string; data: unknown },
    ];
    // Fixed scheduler id is what makes re-registration on every container boot
    // idempotent — BullMQ 6 upserts by this id, where v5 deduped by jobId.
    expect(schedulerId).toBe('data-retention-daily');
    // 05:00 keeps it clear of hema-ratings-sync (03:30) and data-quality (04:00).
    expect(repeatOpts.pattern).toBe('0 5 * * *');
    expect(template.name).toBe(DATA_RETENTION_JOB);
    expect(template.data).toEqual({});
  });

  it('delegates the sweep rather than reimplementing horizons', async () => {
    const { worker, sweep } = makeWorker();
    await expect(worker.sweep()).resolves.toEqual({ guest_sessions: 3 });
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('surfaces a sweep failure so BullMQ retries and Sentry sees it', async () => {
    const { worker } = makeWorker(vi.fn().mockRejectedValue(new Error('redis down')));
    await expect(worker.process({} as never)).rejects.toThrow('redis down');
  });
});
