import { describe, expect, it } from 'vitest';
import { RETENTION_DAYS, RuntimeHealthSamplesService } from './runtime-health-samples.service';
import type { RuntimeHealthResponseDto } from './dto/runtime-health.dto';

type Row = Record<string, unknown>;

/**
 * Minimal PostgREST double. Records what the service asked for so the tests can
 * assert on the query rather than on a mocked return value.
 */
function makeSupabase(opts: { rows?: Row[]; error?: { message: string } } = {}) {
  const calls = {
    inserted: null as Row | null,
    deletedBefore: null as string | null,
    selectedSince: null as string | null,
    order: null as string | null,
  };

  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    insert: (row: Row) => {
      calls.inserted = row;
      return Promise.resolve({ error: opts.error ?? null });
    },
    delete: () => builder,
    lt: (_col: string, value: string) => {
      calls.deletedBefore = value;
      return builder;
    },
    select: () => builder,
    gte: (_col: string, value: string) => {
      calls.selectedSince = value;
      return builder;
    },
    order: (col: string) => {
      calls.order = col;
      return Promise.resolve({ data: opts.rows ?? [], error: opts.error ?? null });
    },
    // delete().lt().select() resolves without an order() call
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ data: opts.rows ?? [], error: opts.error ?? null }),
  });

  const service = new RuntimeHealthSamplesService({
    service: { from: () => builder },
  } as never);

  return { service, calls };
}

const snapshot: RuntimeHealthResponseDto = {
  checkedAt: '2026-08-07T12:00:00.000Z',
  overall: 'warning',
  database: {
    status: 'warning',
    connections: {
      inUse: 42,
      max: 100,
      headroom: 58,
      byState: { active: 3, idle: 39, idleInTransaction: 0 },
    },
    databaseSizeBytes: 1234,
    longestQuerySeconds: 2.5,
    cacheHitRatio: 0.9987,
    uptimeSeconds: 999,
  },
  redis: {
    status: 'healthy',
    usedMemoryBytes: 10,
    maxMemoryBytes: 20,
    keys: 5,
    connectedClients: 1,
  },
  queues: { status: 'healthy', totalWaiting: 7, totalFailed: 1, queues: [] },
  disk: {
    status: 'healthy',
    mountpoint: '/',
    sizeBytes: 100,
    usedBytes: 50,
    availBytes: 50,
    usePercent: 50,
  },
};

describe('RuntimeHealthSamplesService.record', () => {
  it('flattens a full snapshot into one row', async () => {
    const { service, calls } = makeSupabase();
    await expect(service.record(snapshot)).resolves.toBe(true);
    expect(calls.inserted).toMatchObject({
      sampled_at: '2026-08-07T12:00:00.000Z',
      overall: 'warning',
      conn_in_use: 42,
      conn_max: 100,
      cache_hit_ratio: 0.9987,
      queue_waiting: 7,
      disk_use_pct: 50,
    });
  });

  it('records nulls for an unavailable collector instead of losing the tick', async () => {
    // Promise.allSettled means one dead subsystem must not discard the others.
    const { service, calls } = makeSupabase();
    await service.record({
      ...snapshot,
      redis: { status: 'unavailable', error: 'conn refused' },
      disk: { status: 'unavailable', error: 'df failed' },
    });
    expect(calls.inserted).toMatchObject({
      conn_in_use: 42,
      redis_used_bytes: null,
      redis_max_bytes: null,
      disk_use_pct: null,
    });
  });

  it('reports failure without throwing, so the alert email still goes out', async () => {
    const { service } = makeSupabase({ error: { message: 'insert denied' } });
    await expect(service.record(snapshot)).resolves.toBe(false);
  });
});

describe('RuntimeHealthSamplesService.prune', () => {
  it('deletes strictly older than the retention window', async () => {
    const { service, calls } = makeSupabase({ rows: [{}, {}] });
    const now = new Date('2026-08-07T12:00:00.000Z');
    const removed = await service.prune(now);

    const expected = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    expect(calls.deletedBefore).toBe(expected);
    expect(removed).toBe(2);
  });
});

describe('RuntimeHealthSamplesService.getSeries', () => {
  it('coerces PostgREST numeric strings so the chart is not flat', async () => {
    // numeric comes back as a STRING to preserve precision; charting that
    // silently yields a flat line.
    const { service } = makeSupabase({
      rows: [
        {
          sampled_at: '2026-08-07T11:00:00.000Z',
          overall: 'healthy',
          conn_in_use: 10,
          conn_max: 100,
          db_size_bytes: 5,
          longest_query_seconds: '1.250',
          cache_hit_ratio: '0.9987',
          redis_used_bytes: 1,
          redis_max_bytes: 2,
          queue_waiting: 0,
          queue_failed: 0,
          disk_use_pct: '61.40',
        },
      ],
    });

    const { samples } = await service.getSeries(24);
    expect(samples[0]).toMatchObject({
      longestQuerySeconds: 1.25,
      cacheHitRatio: 0.9987,
      diskUsePct: 61.4,
    });
  });

  it('clamps the window to the retention period', async () => {
    const { service, calls } = makeSupabase();
    const now = new Date('2026-08-07T12:00:00.000Z');
    await service.getSeries(24 * 365, now);

    const earliest = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    expect(calls.selectedSince).toBe(earliest);
  });

  it('floors a nonsense window at one hour rather than rejecting it', async () => {
    const { service, calls } = makeSupabase();
    const now = new Date('2026-08-07T12:00:00.000Z');
    await service.getSeries(0, now);
    expect(calls.selectedSince).toBe('2026-08-07T11:00:00.000Z');
  });
});
