import { describe, it, expect, vi } from 'vitest';
import { collectQueues, QUEUE_RECHECK_MS } from './queue-collector';

const counts = { active: 0, waiting: 1, delayed: 0, failed: 0 };
const consumer = (queue: string) => ({ rawname: `bull:${Buffer.from(queue).toString('base64')}` });

/** A queue double whose consumer reads answer `reads` in turn (a number of consumers, or a row list). */
function queueOf(name: string, reads: Array<number | Array<{ rawname?: string }> | Error>) {
  let read = 0;
  return {
    getJobCounts: async () => counts,
    getWorkers: vi.fn(async () => {
      const answer = reads[Math.min(read++, reads.length - 1)]!;
      if (answer instanceof Error) throw answer;
      return typeof answer === 'number'
        ? Array.from({ length: answer }, () => consumer(name))
        : answer;
    }),
    close: async () => undefined,
  };
}

async function collect(reads: Record<string, Array<number | Array<{ rawname?: string }> | Error>>) {
  const queues = Object.fromEntries(Object.entries(reads).map(([n, r]) => [n, queueOf(n, r)]));
  const sleep = vi.fn(async () => undefined);
  const result = await collectQueues({} as never, {
    names: Object.keys(reads),
    queueFactory: (name) => queues[name]!,
    sleep,
    timeoutMs: 50,
  });
  return { result, sleep, queues };
}

describe('collectQueues', () => {
  it('sums waiting + failed across queues and returns per-queue rows', async () => {
    const byName: Record<string, typeof counts> = {
      'notification-scheduler': { active: 1, waiting: 3, delayed: 0, failed: 0 },
      'event-archive': { active: 0, waiting: 2, delayed: 1, failed: 2 },
    };
    const result = await collectQueues({} as never, {
      names: ['notification-scheduler', 'event-archive'],
      queueFactory: (name) => ({
        getJobCounts: async () => byName[name]!,
        getWorkers: async () => [consumer(name)],
        close: async () => undefined,
      }),
    });
    expect(result.totalWaiting).toBe(5);
    expect(result.totalFailed).toBe(2);
    expect(result.queues[1]).toEqual({
      name: 'event-archive',
      active: 0,
      waiting: 2,
      delayed: 1,
      failed: 2,
      consumers: 1,
      reason: null,
    });
  });
});

describe('who works each queue (rulings 830, 840)', () => {
  it('counts the consumers and does not wait when every queue has one', async () => {
    const { result, sleep } = await collect({ a: [2], b: [1] });
    expect(result.queues.map((q) => [q.consumers, q.reason])).toEqual([
      [2, null],
      [1, null],
    ]);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('a queue read at 0 that has a consumer on the re-read is healthy', async () => {
    const { result, sleep } = await collect({ a: [0, 1] });
    expect(sleep).toHaveBeenCalledExactlyOnceWith(QUEUE_RECHECK_MS);
    expect(result.queues[0]).toMatchObject({ consumers: 1, reason: null });
  });

  it('a queue read at 0 twice has nobody working it', async () => {
    const { result } = await collect({ a: [0, 0] });
    expect(result.queues[0]).toMatchObject({ consumers: 0, reason: 'no_consumer' });
  });

  it('waits once per check, and re-reads only the queues read at 0', async () => {
    const { sleep, queues } = await collect({ a: [0, 0], b: [0, 0], c: [3] });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(queues['a']!.getWorkers).toHaveBeenCalledTimes(2);
    expect(queues['b']!.getWorkers).toHaveBeenCalledTimes(2);
    expect(queues['c']!.getWorkers).toHaveBeenCalledTimes(1);
  });

  it('a queue read at 0 whose re-read fails is unknown, not nobody working', async () => {
    const { result, sleep } = await collect({ a: [0, new Error('NOPERM')] });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(result.queues[0]).toMatchObject({ consumers: null, reason: 'consumers_unreadable' });
  });

  it('a Redis with no CLIENT command (a stand-in row with no rawname) is unknown, not 1', async () => {
    const { result } = await collect({ a: [[{}]] });
    expect(result.queues[0]).toMatchObject({ consumers: null, reason: 'consumers_unreadable' });
  });

  it('a consumer read that fails is unknown, and the counts are kept', async () => {
    const { result } = await collect({ a: [new Error('NOPERM this user has no permissions')] });
    expect(result.queues[0]).toMatchObject({
      waiting: 1,
      consumers: null,
      reason: 'consumers_unreadable',
    });
  });

  it('a consumer read that never answers is unknown after the bound, and the counts are kept', async () => {
    const result = await collectQueues({} as never, {
      names: ['a'],
      queueFactory: () => ({
        getJobCounts: async () => counts,
        getWorkers: () => new Promise(() => {}),
        close: async () => undefined,
      }),
      timeoutMs: 20,
    });
    expect(result.queues[0]).toMatchObject({ waiting: 1, consumers: null });
  });
});
