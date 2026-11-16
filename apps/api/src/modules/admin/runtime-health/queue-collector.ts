import { Logger } from '@nestjs/common';
import {
  RUNTIME_HEALTH_QUEUE_NAMES,
  type QueueConsumerReason,
  type RuntimeHealthQueueRow,
} from '@myclash/types';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { boundedCall } from '../../../common/bounded-call';
import { REDIS_CHECK_TIMEOUT_MS, redisGaveUp } from './redis-connection';

const logger = new Logger('RuntimeHealthQueues');

/**
 * How long a check waits before it reads again the queues it found with no consumer (ruling 840).
 * A worker that has just started connects its consumers a moment after it boots: a queue still at
 * 0 after the wait has nobody working it.
 */
export const QUEUE_RECHECK_MS = 3_000;

export type QueueRow = RuntimeHealthQueueRow;

/** A row of bullmq's `getWorkers()`: a real consumer carries the connection name it matched. */
interface ConsumerRow {
  rawname?: string;
}

interface QueueLike {
  getJobCounts(): Promise<{ active: number; waiting: number; delayed: number; failed: number }>;
  getWorkers(): Promise<ConsumerRow[]>;
  close(): Promise<void>;
}

type Counts = Pick<QueueRow, 'active' | 'waiting' | 'delayed' | 'failed'>;

/** A queue's job counts, within the bound; a timeout fails the whole queue metric. */
async function readCounts(queue: QueueLike, name: string, ms: number): Promise<Counts> {
  const c = await boundedCall(() => queue.getJobCounts(), ms, redisGaveUp(`job counts of ${name}`));
  return {
    active: c.active ?? 0,
    waiting: c.waiting ?? 0,
    delayed: c.delayed ?? 0,
    failed: c.failed ?? 0,
  };
}

/**
 * The consumers working a queue, or null when they cannot be read. bullmq answers a Redis with no
 * CLIENT command (renamed or missing) with one stand-in row that carries no `rawname`: never count
 * it as 0 or 1. Any other failure (an ACL refusal, NOPERM, is rethrown by bullmq; a timeout) lands
 * in the catch. Both are logged. Never throws: the counts stand alone.
 */
async function readConsumers(queue: QueueLike, name: string, ms: number): Promise<number | null> {
  try {
    const rows = await boundedCall(
      () => queue.getWorkers(),
      ms,
      redisGaveUp(`consumers of ${name}`),
    );
    if (!rows.some((row) => !row.rawname)) return rows.length;
    logger.warn(`The consumers of ${name} were not read: Redis has no CLIENT command`);
    return null;
  } catch (err) {
    logger.warn(
      `The consumers of ${name} were not read: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}

type Watched = Array<{ name: string; queue: QueueLike }>;

/**
 * Ruling 840: a queue read at 0 is read once more after the wait; it is critical only if it is
 * still at 0. One wait per check, for every such queue at once.
 */
async function recheckZeros(
  queues: Watched,
  consumers: Array<number | null>,
  ms: number,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  if (!consumers.includes(0)) return;
  await sleep(QUEUE_RECHECK_MS);
  await Promise.all(
    queues.map(async ({ name, queue }, i) => {
      if (consumers[i] === 0) consumers[i] = await readConsumers(queue, name, ms);
    }),
  );
}

/**
 * Not awaited: the card must not wait on teardown (ruling 842). On the shared connection bullmq
 * 6.7.6 closes without waiting on Redis; what an abandoned Queue holds (its wait-for-ready
 * listeners, its queued commands) is released when Redis answers again.
 */
function closeAll(queues: Watched): void {
  for (const { name, queue } of queues) {
    void queue.close().catch((err: unknown) => {
      logger.warn(`Queue ${name} did not close: ${err instanceof Error ? err.message : err}`);
    });
  }
}

function reasonOf(consumers: number | null): QueueConsumerReason | null {
  if (consumers === null) return 'consumers_unreadable';
  return consumers === 0 ? 'no_consumer' : null;
}

export async function collectQueues(
  connection: Redis,
  opts: {
    names?: readonly string[];
    queueFactory?: (name: string) => QueueLike;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<{ totalWaiting: number; totalFailed: number; queues: QueueRow[] }> {
  const ms = opts.timeoutMs ?? REDIS_CHECK_TIMEOUT_MS;
  const sleep = opts.sleep ?? ((t: number) => new Promise<void>((done) => setTimeout(done, t)));
  const factory =
    opts.queueFactory ??
    ((name: string) => new Queue(name, { connection }) as unknown as QueueLike);
  const queues: Watched = (opts.names ?? RUNTIME_HEALTH_QUEUE_NAMES).map((name) => ({
    name,
    queue: factory(name),
  }));

  try {
    const [counts, consumers] = await Promise.all([
      Promise.all(queues.map(({ name, queue }) => readCounts(queue, name, ms))),
      Promise.all(queues.map(({ name, queue }) => readConsumers(queue, name, ms))),
    ]);
    await recheckZeros(queues, consumers, ms, sleep);
    const rows = queues.map(({ name }, i): QueueRow => {
      const seen = consumers[i] ?? null;
      return { name, ...counts[i]!, consumers: seen, reason: reasonOf(seen) };
    });
    return {
      totalWaiting: rows.reduce((sum, r) => sum + r.waiting, 0),
      totalFailed: rows.reduce((sum, r) => sum + r.failed, 0),
      queues: rows,
    };
  } finally {
    closeAll(queues);
  }
}
