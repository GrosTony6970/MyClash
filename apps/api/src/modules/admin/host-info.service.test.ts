import { cpus, totalmem } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { AdminHostInfoService } from './host-info.service';
import type {
  AdminSystemActionsService,
  DiskUsageResult,
  HostFactsResult,
} from './system-actions.service';

const FACTS: HostFactsResult = {
  hostname: 'myclash-vps-01',
  os: 'Debian GNU/Linux 12 (bookworm)',
  osVersion: '12',
  kernelVersion: '6.1.0-18-amd64',
  architecture: 'x86_64',
  cpuCount: 4,
  memoryTotalBytes: 8_348_332_032,
  dockerVersion: '27.3.1',
};

const DISK: DiskUsageResult = {
  mountpoint: '/srv/myclash',
  sizeBytes: 50_000_000_000,
  usedBytes: 32_000_000_000,
  availBytes: 18_000_000_000,
  usePercent: 65,
};

function service(overrides: {
  getHostFacts?: () => Promise<HostFactsResult>;
  getDiskUsage?: () => Promise<DiskUsageResult>;
}) {
  return new AdminHostInfoService({
    getHostFacts: overrides.getHostFacts ?? (() => Promise.resolve(FACTS)),
    getDiskUsage: overrides.getDiskUsage ?? (() => Promise.resolve(DISK)),
  } as unknown as AdminSystemActionsService);
}

describe('AdminHostInfoService', () => {
  it('reports the daemon answer plus disk when both reads succeed', async () => {
    const result = await service({}).collect();

    expect(result.source).toBe('docker');
    expect(result).toMatchObject({ ...FACTS, diskTotalBytes: 50_000_000_000 });
    expect(result.diskMountpoint).toBe('/srv/myclash');
    expect(result.error).toBeUndefined();
  });

  it('keeps CPU and RAM from this process when the sidecar is unreachable', async () => {
    // The panel must not go blank because ops-runner is restarting. os.cpus()
    // and os.totalmem() read the HOST even from inside a container on Linux, so
    // two of the facts survive with no sidecar at all.
    const result = await service({
      getHostFacts: () => Promise.reject(new Error('ops-runner request failed')),
    }).collect();

    expect(result.source).toBe('runtime');
    expect(result.hostname).toBeNull();
    expect(result.os).toBeNull();
    expect(result.cpuCount).toBe(cpus().length);
    expect(result.memoryTotalBytes).toBe(totalmem());
    // The disk read is independent, so it still lands.
    expect(result.diskTotalBytes).toBe(50_000_000_000);
    expect(result.error).toBe('ops-runner request failed');
  });

  it('keeps host identity when only the disk read fails', async () => {
    const result = await service({
      getDiskUsage: () => Promise.reject(new Error('df failed')),
    }).collect();

    expect(result.source).toBe('docker');
    expect(result.hostname).toBe('myclash-vps-01');
    expect(result.diskTotalBytes).toBeNull();
    expect(result.diskMountpoint).toBeNull();
    expect(result.error).toBe('df failed');
  });

  it('reports unknown, not an error, when nothing can be read', async () => {
    const result = await service({
      getHostFacts: () => Promise.reject(new Error('sidecar down')),
      getDiskUsage: () => Promise.reject(new Error('sidecar down')),
    }).collect();

    expect(result.source).toBe('unknown');
    expect(result.cpuCount).toBe(cpus().length);
    expect(result.error).toBe('sidecar down');
  });

  it('never throws — a total failure still resolves to a partial panel', async () => {
    // Deliberate divergence from getDiskUsage(), which throws so runtime-health
    // can mark a metric `unavailable`. This is descriptive inventory: failing the
    // whole card would hide the facts that are still perfectly readable.
    const collect = service({
      getHostFacts: () => Promise.reject(new Error('boom')),
      getDiskUsage: () => Promise.reject(new Error('boom')),
    }).collect();

    await expect(collect).resolves.toBeDefined();
  });

  it('falls back to the process reading when the daemon could not size the box', async () => {
    // `docker info` reports 0 for a value it could not determine, which the
    // sidecar already nulls out. A partial daemon answer must not be worse than
    // no daemon at all.
    const result = await service({
      getHostFacts: () => Promise.resolve({ ...FACTS, cpuCount: null, memoryTotalBytes: null }),
    }).collect();

    expect(result.hostname).toBe('myclash-vps-01');
    expect(result.cpuCount).toBe(cpus().length);
    expect(result.memoryTotalBytes).toBe(totalmem());
  });

  it('reads both sources concurrently', async () => {
    // Serialising them would double the worst-case wait on a panel the operator
    // is watching load, for no benefit — neither read depends on the other.
    const order: string[] = [];
    const slowFacts = vi.fn(async () => {
      order.push('facts:start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('facts:end');
      return FACTS;
    });
    const fastDisk = vi.fn(async () => {
      order.push('disk:start');
      return DISK;
    });

    await service({ getHostFacts: slowFacts, getDiskUsage: fastDisk }).collect();

    expect(order).toEqual(['facts:start', 'disk:start', 'facts:end']);
  });
});
