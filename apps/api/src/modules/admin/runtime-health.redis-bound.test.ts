/**
 * Ruling 842: with Redis down, the health card answers. The runtime-health Redis connection keeps
 * `maxRetriesPerRequest: null`, so a command never settles; each Redis-backed read runs under
 * `boundedCall`, and its tile says "unavailable" with the code `timeout`.
 */
import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { BoundedCallTimeout } from '../../common/bounded-call';
import { DEFAULT_ALERT_SETTINGS } from './dto/runtime-health.dto';
import { AdminRuntimeHealthService } from './runtime-health.service';
import { collectQueues } from './runtime-health/queue-collector';
import { collectRedis } from './runtime-health/redis-collector';

const never = <T>(): Promise<T> => new Promise<T>(() => {});
const counts = { active: 0, waiting: 1, delayed: 0, failed: 0 };
// One consumer, so no check here waits for the re-read (that is queue-collector.test.ts's).
const getWorkers = async () => [{ rawname: 'bull:ZXZlbnQtYXJjaGl2ZQ==' }];

describe('the Redis-backed collectors give up at their bound', () => {
  it('collectRedis rejects with a BoundedCallTimeout when Redis never answers', async () => {
    const hung = { info: () => never<string>(), dbsize: () => never<number>() };
    const read = collectRedis(hung, { timeoutMs: 20 });
    await expect(read).rejects.toBeInstanceOf(BoundedCallTimeout);
    await expect(read).rejects.toThrow('Redis did not answer within 20 ms (info)');
  });

  it('collectQueues rejects with a BoundedCallTimeout when a job count never answers', async () => {
    const read = collectQueues({} as never, {
      names: ['event-archive'],
      queueFactory: () => ({
        getJobCounts: () => never(),
        getWorkers,
        close: async () => undefined,
      }),
      timeoutMs: 20,
    });
    await expect(read).rejects.toBeInstanceOf(BoundedCallTimeout);
  });

  it('collectQueues answers although a queue close never settles', async () => {
    const read = await collectQueues({} as never, {
      names: ['event-archive'],
      queueFactory: () => ({ getJobCounts: async () => counts, getWorkers, close: () => never() }),
      timeoutMs: 20,
    });
    expect(read.totalWaiting).toBe(1);
  });

  it('a queue close that fails leaves a warning, not silence', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await collectQueues({} as never, {
      names: ['event-archive'],
      queueFactory: () => ({
        getJobCounts: async () => counts,
        getWorkers,
        close: () => Promise.reject(new Error('socket gone')),
      }),
    });
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith('Queue event-archive did not close: socket gone'),
    );
    warn.mockRestore();
  });
});

const settingsService = { getSettings: async () => ({ ...DEFAULT_ALERT_SETTINGS }) } as never;
const timedOut = () => Promise.reject(new BoundedCallTimeout('Redis did not answer within 5 ms'));

const DB = {
  maxConnections: 100,
  connectionsByState: { active: 1, idle: 1, idleInTransaction: 0, total: 2 },
  longestQuerySeconds: 0,
  databaseSizeBytes: 1,
  cacheHitRatio: 1,
  uptimeSeconds: 1,
};

function service(overrides: Partial<ConstructorParameters<typeof AdminRuntimeHealthService>[1]>) {
  return new AdminRuntimeHealthService(settingsService, {
    collectDb: async () => DB,
    collectRedis: async () => ({
      usedMemoryBytes: 1,
      maxMemoryBytes: 0,
      keys: 0,
      connectedClients: 1,
    }),
    collectQueues: async () => ({ totalWaiting: 0, totalFailed: 0, queues: [] }),
    collectDisk: async () => ({
      mountpoint: '/',
      sizeBytes: 1,
      usedBytes: 0,
      availBytes: 1,
      usePercent: 0,
    }),
    collectPhotoStorage: async () => ({ configured: false }),
    collectContainers: async () => ({ configured: false }),
    ...overrides,
  });
}

describe('a Redis timeout reaches the card as the code timeout', () => {
  it('the Redis tile says timeout', async () => {
    const health = await service({ collectRedis: timedOut }).collect();
    expect(health.redis).toEqual({ status: 'unavailable', error: 'timeout' });
  });

  it('the queue tile says timeout', async () => {
    const health = await service({ collectQueues: timedOut }).collect();
    expect(health.queues).toEqual({ status: 'unavailable', error: 'timeout' });
  });

  it('any other Redis failure keeps its own message', async () => {
    const refused = () => Promise.reject(new Error('connect ECONNREFUSED'));
    const health = await service({ collectRedis: refused }).collect();
    expect(health.redis).toEqual({ status: 'unavailable', error: 'connect ECONNREFUSED' });
  });

  it('the photo probe timeout stays its prose: only the Redis tiles map the code', async () => {
    const probeTimedOut = () =>
      Promise.reject(new BoundedCallTimeout('Photo bucket did not answer within 20 ms (probe)'));
    const health = await service({ collectPhotoStorage: probeTimedOut }).collect();
    expect(health.photoStorage).toEqual({
      status: 'unavailable',
      error: 'Photo bucket did not answer within 20 ms (probe)',
    });
  });
});
