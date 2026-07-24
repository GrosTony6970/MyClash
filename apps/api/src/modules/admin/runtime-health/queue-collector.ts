import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export const RUNTIME_HEALTH_QUEUE_NAMES = [
  'hema-ratings',
  'notification-scheduler',
  'event-status-ticker',
  'event-archive',
  'data-quality-deterministic',
  'tls-cert-monitor',
  'runtime-health-monitor',
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
        const c = await queue.getJobCounts();
        return {
          name,
          active: c.active ?? 0,
          waiting: c.waiting ?? 0,
          delayed: c.delayed ?? 0,
          failed: c.failed ?? 0,
        };
      } finally {
        // Only close queues we constructed via BullMQ (real factory returns a
        // Queue with close()); the test factory's close() is a harmless no-op.
        await queue.close().catch(() => undefined);
      }
    }),
  );

  return {
    totalWaiting: rows.reduce((sum, r) => sum + r.waiting, 0),
    totalFailed: rows.reduce((sum, r) => sum + r.failed, 0),
    queues: rows,
  };
}
