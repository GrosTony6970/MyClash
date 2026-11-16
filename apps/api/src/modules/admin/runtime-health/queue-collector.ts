import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { boundedCall } from '../../../common/bounded-call';
import { REDIS_CHECK_TIMEOUT_MS, redisGaveUp } from './redis-connection';

const logger = new Logger('RuntimeHealthQueues');

export const RUNTIME_HEALTH_QUEUE_NAMES = [
  'hema-ratings-sync',
  'notification-scheduler',
  'event-status-ticker',
  'event-archive',
  'data-quality-deterministic',
  'tls-cert-monitor',
  'runtime-health-monitor',
  'photo-cleanup',
  'spar-request-expiry',
] as const;

interface QueueLike {
  getJobCounts(): Promise<{ active: number; waiting: number; delayed: number; failed: number }>;
  close(): Promise<void>;
}

export async function collectQueues(
  connection: Redis,
  opts: {
    names?: readonly string[];
    queueFactory?: (name: string) => QueueLike;
    timeoutMs?: number;
  } = {},
): Promise<{
  totalWaiting: number;
  totalFailed: number;
  queues: Array<{ name: string; active: number; waiting: number; delayed: number; failed: number }>;
}> {
  const names = opts.names ?? RUNTIME_HEALTH_QUEUE_NAMES;
  const factory =
    opts.queueFactory ??
    ((name: string) => new Queue(name, { connection }) as unknown as QueueLike);

  const rows = await Promise.all(
    names.map(async (name) => {
      const queue = factory(name);
      try {
        const c = await boundedCall(
          () => queue.getJobCounts(),
          opts.timeoutMs ?? REDIS_CHECK_TIMEOUT_MS,
          redisGaveUp(`job counts of ${name}`),
        );
        return {
          name,
          active: c.active ?? 0,
          waiting: c.waiting ?? 0,
          delayed: c.delayed ?? 0,
          failed: c.failed ?? 0,
        };
      } finally {
        // Not awaited: the card must not wait on teardown (ruling 842). On the shared connection
        // bullmq 6.7.6 closes without waiting on Redis; what an abandoned Queue holds (its
        // wait-for-ready listeners, its queued commands) is released when Redis answers again.
        void queue.close().catch((err: unknown) => {
          logger.warn(`Queue ${name} did not close: ${err instanceof Error ? err.message : err}`);
        });
      }
    }),
  );

  return {
    totalWaiting: rows.reduce((sum, r) => sum + r.waiting, 0),
    totalFailed: rows.reduce((sum, r) => sum + r.failed, 0),
    queues: rows,
  };
}
