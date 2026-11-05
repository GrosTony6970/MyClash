import type { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PHOTO_CLEANUP_TICK, PHOTO_ORPHAN_SWEEP, PhotoCleanupWorker } from './photo-cleanup.worker';

function makeWorker() {
  const queue = { upsertJobScheduler: vi.fn().mockResolvedValue(undefined) };
  const worker = new PhotoCleanupWorker(queue as never, { service: {} } as never, null);
  const calls: string[] = [];
  const expire = vi.spyOn(worker.cleanup, 'expire').mockImplementation(async () => {
    calls.push('expire');
    return { events: [], photos: 0 };
  });
  const drain = vi.spyOn(worker.cleanup, 'drain').mockImplementation(async () => {
    calls.push('drain');
    return { deleted: 0 };
  });
  const sweep = vi.spyOn(worker.cleanup, 'sweep').mockImplementation(async () => {
    calls.push('sweep');
    return { deleted: 0 };
  });
  return { worker, queue, calls, expire, drain, sweep };
}

describe('PhotoCleanupWorker', () => {
  it('schedules the tick every 5 minutes and the orphan sweep hourly, under fixed ids', async () => {
    const { worker, queue } = makeWorker();
    await worker.onModuleInit();
    expect(queue.upsertJobScheduler.mock.calls).toEqual([
      ['photo-cleanup-tick', { pattern: '*/5 * * * *' }, { name: 'tick', data: {} }],
      ['photo-orphan-sweep', { pattern: '50 * * * *' }, { name: 'orphans', data: {} }],
    ]);
  });

  it('expires, then drains, on a tick: the expired photos leave the bucket in the same run', async () => {
    const { worker, calls } = makeWorker();
    await worker.process({ name: PHOTO_CLEANUP_TICK } as never);
    expect(calls).toEqual(['expire', 'drain']);
  });

  it('still drains when the expiry fails, then fails the job with the expiry error', async () => {
    const { worker, expire, calls } = makeWorker();
    expire.mockImplementationOnce(async () => {
      calls.push('expire');
      throw new Error('Photo expiry not read: boom');
    });
    await expect(worker.process({ name: PHOTO_CLEANUP_TICK } as never)).rejects.toThrow(
      'Photo expiry not read: boom',
    );
    expect(calls).toEqual(['expire', 'drain']);
  });

  it('traces both errors when the expiry and the drain fail in one tick', async () => {
    const { worker, expire, drain } = makeWorker();
    const logged = vi
      .spyOn((worker as unknown as { logger: Logger }).logger, 'error')
      .mockImplementation(() => undefined);
    expire.mockRejectedValueOnce(new Error('Photo expiry not read: permission denied'));
    drain.mockRejectedValueOnce(new Error('Photo drain stopped at k: HTTP 503'));
    await expect(worker.process({ name: PHOTO_CLEANUP_TICK } as never)).rejects.toThrow(
      'Photo drain stopped at k',
    );
    expect(logged).toHaveBeenCalledWith('Photo expiry not read: permission denied');
  });

  it('sweeps orphans on its own job', async () => {
    const { worker, calls } = makeWorker();
    await worker.process({ name: PHOTO_ORPHAN_SWEEP } as never);
    expect(calls).toEqual(['sweep']);
  });

  it('fails the job when the drain fails, so BullMQ records it and Sentry sees it', async () => {
    const { worker, drain } = makeWorker();
    drain.mockRejectedValueOnce(new Error('Photo drain stopped at k: HTTP 503'));
    await expect(worker.process({ name: PHOTO_CLEANUP_TICK } as never)).rejects.toThrow(
      'Photo drain stopped at k',
    );
  });

  it('refuses a job it does not know', async () => {
    const { worker } = makeWorker();
    await expect(worker.process({ name: 'purge-all' } as never)).rejects.toThrow(
      'Unknown photo clean-up job "purge-all"',
    );
  });
});
