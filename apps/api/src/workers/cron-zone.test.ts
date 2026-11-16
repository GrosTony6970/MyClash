/**
 * Every job scheduler runs on UTC (ruling 829, `cron-zone.ts`).
 *
 * The daily jobs are read the way BullMQ reads them: each worker's `onModuleInit()` runs against a
 * queue double, the options it hands `upsertJobScheduler` are captured, and bullmq's own
 * `getNextMillis` computes the next run on a summer day (Paris is UTC+2). A decoy zone sits
 * before the captured options: only a worker that passes its own `tz` overrides it, so a missing
 * `tz` is red under any process zone, not only under TZ=Europe/Paris.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getNextMillis, type RepeatOptions } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { DataQualityDeterministicWorker } from './data-quality-deterministic.worker';
import { DataRetentionWorker } from './data-retention.worker';
import { HemaRatingsSyncWorker } from './hema-ratings-sync.worker';
import { TlsCertMonitorWorker } from './tls-cert-monitor.worker';

const SUMMER_MIDNIGHT = Date.parse('2026-07-15T00:00:00.000Z');
const DECOY: RepeatOptions = { tz: 'Asia/Tokyo' };

type Scheduled = { onModuleInit(): Promise<void> };

/** The repeat options a worker gives its one scheduler on start. */
async function capturedOptions(build: (queue: never) => Scheduled): Promise<RepeatOptions> {
  const queue = { upsertJobScheduler: vi.fn().mockResolvedValue(undefined) };
  await build(queue as never).onModuleInit();
  expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
  return queue.upsertJobScheduler.mock.calls[0]?.[1] as RepeatOptions;
}

const DAILY: Array<[string, (queue: never) => Scheduled, string]> = [
  [
    'HEMA Ratings sync',
    (q) => new HemaRatingsSyncWorker(q, {} as never, {} as never),
    '2026-07-15T03:30:00.000Z',
  ],
  [
    'data quality scan',
    (q) => new DataQualityDeterministicWorker(q, {} as never),
    '2026-07-15T04:00:00.000Z',
  ],
  [
    'data retention sweep',
    (q) => new DataRetentionWorker(q, {} as never),
    '2026-07-15T05:00:00.000Z',
  ],
  [
    'TLS certificate check',
    (q) => new TlsCertMonitorWorker(q, {} as never, {} as never),
    '2026-07-15T06:17:00.000Z',
  ],
];

describe('the night jobs run on UTC (ruling 829)', () => {
  it.each(DAILY)('the %s runs at its UTC hour on a summer day', async (_name, build, expected) => {
    const options = await capturedOptions(build);
    const next = getNextMillis(SUMMER_MIDNIGHT, { ...DECOY, ...options });
    expect(next && new Date(next).toISOString()).toBe(expected);
  });
});

describe('every job scheduler goes through utcCron', () => {
  it('each upsertJobScheduler call in the workers passes utcCron(...)', () => {
    const dir = __dirname;
    const calls = /upsertJobScheduler\(/g;
    const utc = /upsertJobScheduler\(\s*'[^']+',\s*utcCron\(/g;
    let total = 0;
    const plain: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.worker.ts'))) {
      const source = readFileSync(path.join(dir, file), 'utf8');
      const all = source.match(calls)?.length ?? 0;
      const zoned = source.match(utc)?.length ?? 0;
      total += all;
      if (zoned !== all) plain.push(`${file}: ${all - zoned} of ${all}`);
    }
    // 10 schedulers in 9 workers today: a scan that found none would prove nothing.
    expect(total).toBeGreaterThanOrEqual(10);
    expect(plain).toEqual([]);
  });
});
