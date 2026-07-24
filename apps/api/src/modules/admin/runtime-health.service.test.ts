// runtime-health.service.test.ts
import { describe, it, expect } from 'vitest';
import { AdminRuntimeHealthService } from './runtime-health.service';
import { DEFAULT_ALERT_SETTINGS } from './dto/runtime-health.dto';

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
});
