// runtime-health.service.test.ts
import { describe, it, expect } from 'vitest';
import { AdminRuntimeHealthService } from './runtime-health.service';
import { DEFAULT_ALERT_SETTINGS } from './dto/runtime-health.dto';
import { collectPhotoStorage } from './runtime-health/photo-storage-collector';

const settingsService = { getSettings: async () => ({ ...DEFAULT_ALERT_SETTINGS }) } as never;

function make(overrides: Partial<ConstructorParameters<typeof AdminRuntimeHealthService>[1]> = {}) {
  return new AdminRuntimeHealthService(settingsService, {
    collectDb: async () => ({
      maxConnections: 100,
      connectionsByState: { active: 8, idle: 31, idleInTransaction: 3, total: 42 },
      longestQuerySeconds: 2,
      databaseSizeBytes: 1_000,
      cacheHitRatio: 0.99,
      uptimeSeconds: 1_000,
    }),
    collectRedis: async () => ({
      usedMemoryBytes: 120,
      maxMemoryBytes: 512,
      keys: 5,
      connectedClients: 3,
    }),
    collectQueues: async () => ({ totalWaiting: 3, totalFailed: 0, queues: [] }),
    collectDisk: async () => ({
      mountpoint: '/',
      sizeBytes: 100,
      usedBytes: 61,
      availBytes: 39,
      usePercent: 61,
    }),
    collectPhotoStorage: async () => ({
      configured: true,
      bucket: 'myclash-photos',
      latencyMs: 40,
    }),
    collectContainers: async () => ({ configured: true, running: 16, total: 16, problems: [] }),
    ...overrides,
  });
}

describe('AdminRuntimeHealthService.collect', () => {
  it('reports healthy when all metrics are under thresholds', async () => {
    const result = await make().collect();
    expect(result.overall).toBe('healthy');
    expect(result.database.status).toBe('healthy');
  });

  it('marks connections critical past the crit threshold', async () => {
    const result = await make({
      collectDb: async () => ({
        maxConnections: 100,
        connectionsByState: { active: 90, idle: 5, idleInTransaction: 0, total: 95 },
        longestQuerySeconds: 0,
        databaseSizeBytes: 1,
        cacheHitRatio: 1,
        uptimeSeconds: 1,
      }),
    }).collect();
    expect(result.database.status).toBe('critical');
    expect(result.overall).toBe('critical');
  });

  it('degrades a failed collector to unavailable without sinking the rest', async () => {
    const result = await make({
      collectDisk: async () => {
        throw new Error('ops-runner unreachable');
      },
    }).collect();
    expect(result.disk).toEqual({ status: 'unavailable', error: 'ops-runner unreachable' });
    expect(result.database.status).toBe('healthy');
    expect(result.overall).toBe('unavailable');
  });

  it('reports a healthy photo bucket with its name and response time', async () => {
    const result = await make().collect();
    expect(result.photoStorage).toEqual({
      status: 'healthy',
      bucket: 'myclash-photos',
      latencyMs: 40,
    });
  });

  it('shows an unset photo bucket as not configured and leaves the overall status alone', async () => {
    const result = await make({
      collectPhotoStorage: async () => ({ configured: false }),
    }).collect();
    expect(result.photoStorage).toEqual({ status: 'not_configured' });
    expect(result.overall).toBe('healthy');
  });

  it('degrades a failing photo bucket to unavailable, which counts in the overall status', async () => {
    const result = await make({
      collectPhotoStorage: async () => {
        throw new Error('NoSuchBucket');
      },
    }).collect();
    expect(result.photoStorage).toEqual({ status: 'unavailable', error: 'NoSuchBucket' });
    expect(result.overall).toBe('unavailable');
  });

  it('carries no bucket credentials in the response', async () => {
    const setting = {
      kind: 'on',
      config: {
        accessKeyId: 'AK-SHOULD-NOT-SHOW',
        secretAccessKey: 'SK-SHOULD-NOT-SHOW',
        bucket: 'myclash-photos',
        region: 'fr-par',
        endpoint: 'https://s3.fr-par.scw.cloud',
      },
    } as const;
    const result = await make({
      collectPhotoStorage: () => collectPhotoStorage(setting, async () => {}),
    }).collect();
    expect(result.photoStorage.status).toBe('healthy');
    expect(JSON.stringify(result)).not.toMatch(/SHOULD-NOT-SHOW/);
  });
});

describe('the containers tile (ruling 900)', () => {
  const dead = { service: 'web-public', state: 'exited', exitCode: 1, health: null };

  it('reports every container running as healthy, with the counts', async () => {
    const result = await make().collect();
    expect(result.containers).toEqual({ status: 'healthy', running: 16, total: 16, problems: [] });
    expect(result.overall).toBe('healthy');
  });

  it('a dead container makes the tile and the page critical, and names it', async () => {
    const result = await make({
      collectContainers: async () => ({
        configured: true,
        running: 15,
        total: 16,
        problems: [dead],
      }),
    }).collect();
    expect(result.containers).toEqual({
      status: 'critical',
      running: 15,
      total: 16,
      problems: [dead],
    });
    expect(result.overall).toBe('critical');
  });

  it('without the ops runner: not configured, and the page ignores it', async () => {
    const result = await make({ collectContainers: async () => ({ configured: false }) }).collect();
    expect(result.containers).toEqual({ status: 'not_configured' });
    expect(result.overall).toBe('healthy');
  });

  it('a runner that does not answer: unavailable, which counts in the page', async () => {
    const result = await make({
      collectContainers: async () => {
        throw new Error('Could not reach the ops runner.');
      },
    }).collect();
    expect(result.containers).toEqual({
      status: 'unavailable',
      error: 'Could not reach the ops runner.',
    });
    expect(result.overall).toBe('unavailable');
  });
});

describe('the queue tile and who works each queue (ruling 830)', () => {
  const row = (
    reason: 'no_consumer' | 'consumers_unreadable' | null,
    consumers: number | null,
  ) => ({
    name: 'event-archive',
    active: 0,
    waiting: 0,
    delayed: 0,
    failed: 0,
    consumers,
    reason,
  });
  const queues = (rows: ReturnType<typeof row>[], totalWaiting = 0) => ({
    collectQueues: async () => ({ totalWaiting, totalFailed: 0, queues: rows }),
  });

  it('a queue nobody works makes the tile and the page critical', async () => {
    const result = await make(queues([row(null, 1), row('no_consumer', 0)])).collect();
    expect(result.queues.status).toBe('critical');
    expect(result.overall).toBe('critical');
  });

  it('consumers that could not be read make a healthy backlog a warning', async () => {
    const result = await make(queues([row('consumers_unreadable', null)])).collect();
    expect(result.queues.status).toBe('warning');
  });

  it('unreadable consumers never soften a critical backlog', async () => {
    const result = await make(queues([row('consumers_unreadable', null)], 10_000)).collect();
    expect(result.queues.status).toBe('critical');
  });
});
