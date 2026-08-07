// runtime-health.service.ts
import { Injectable } from '@nestjs/common';
import type { RuntimeHealthAlertSettingsService } from './runtime-health-alert-settings.service';
import type {
  DbMetric,
  DiskMetric,
  QueueMetric,
  RedisMetric,
  RuntimeHealthAlertSettings,
  RuntimeHealthResponseDto,
} from './dto/runtime-health.dto';
import { deriveStatus, worstStatus } from './runtime-health/status';

interface Collectors {
  collectDb: () => Promise<{
    maxConnections: number;
    connectionsByState: { active: number; idle: number; idleInTransaction: number; total: number };
    longestQuerySeconds: number;
    databaseSizeBytes: number;
    cacheHitRatio: number;
    uptimeSeconds: number;
  }>;
  collectRedis: () => Promise<{
    usedMemoryBytes: number;
    maxMemoryBytes: number;
    keys: number;
    connectedClients: number;
  }>;
  collectQueues: () => Promise<{ totalWaiting: number; totalFailed: number; queues: QueueRow[] }>;
  collectDisk: () => Promise<{
    mountpoint: string;
    sizeBytes: number;
    usedBytes: number;
    availBytes: number;
    usePercent: number;
  }>;
}
type QueueRow = { name: string; active: number; waiting: number; delayed: number; failed: number };

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'collector failed';
}

@Injectable()
export class AdminRuntimeHealthService {
  constructor(
    private readonly settingsService: RuntimeHealthAlertSettingsService,
    private readonly collectors: Collectors,
  ) {}

  async collect(): Promise<RuntimeHealthResponseDto> {
    const settings = await this.settingsService.getSettings();
    const [db, redis, queues, disk] = await Promise.allSettled([
      this.collectors.collectDb(),
      this.collectors.collectRedis(),
      this.collectors.collectQueues(),
      this.collectors.collectDisk(),
    ]);

    const database = this.mapDb(db, settings);
    const redisMetric = this.mapRedis(redis, settings);
    const queueMetric = this.mapQueues(queues, settings);
    const diskMetric = this.mapDisk(disk, settings);

    return {
      checkedAt: new Date().toISOString(),
      overall: worstStatus(
        database.status,
        redisMetric.status,
        queueMetric.status,
        diskMetric.status,
      ),
      database,
      redis: redisMetric,
      queues: queueMetric,
      disk: diskMetric,
    };
  }

  private mapDb(
    r: PromiseSettledResult<Awaited<ReturnType<Collectors['collectDb']>>>,
    s: RuntimeHealthAlertSettings,
  ): DbMetric {
    if (r.status === 'rejected') return { status: 'unavailable', error: errorText(r.reason) };
    const v = r.value;
    const pct = (v.connectionsByState.total / v.maxConnections) * 100;
    return {
      status: deriveStatus(pct, s.connWarnPct, s.connCritPct),
      connections: {
        inUse: v.connectionsByState.total,
        max: v.maxConnections,
        headroom: v.maxConnections - v.connectionsByState.total,
        byState: {
          active: v.connectionsByState.active,
          idle: v.connectionsByState.idle,
          idleInTransaction: v.connectionsByState.idleInTransaction,
        },
      },
      databaseSizeBytes: v.databaseSizeBytes,
      longestQuerySeconds: v.longestQuerySeconds,
      cacheHitRatio: v.cacheHitRatio,
      uptimeSeconds: v.uptimeSeconds,
    };
  }

  private mapRedis(
    r: PromiseSettledResult<Awaited<ReturnType<Collectors['collectRedis']>>>,
    s: RuntimeHealthAlertSettings,
  ): RedisMetric {
    if (r.status === 'rejected') return { status: 'unavailable', error: errorText(r.reason) };
    const v = r.value;
    // maxmemory 0 = unlimited → no memory-pressure signal.
    const pct = v.maxMemoryBytes > 0 ? (v.usedMemoryBytes / v.maxMemoryBytes) * 100 : 0;
    return {
      status: deriveStatus(pct, s.redisWarnPct, s.redisCritPct),
      usedMemoryBytes: v.usedMemoryBytes,
      maxMemoryBytes: v.maxMemoryBytes,
      keys: v.keys,
      connectedClients: v.connectedClients,
    };
  }

  private mapQueues(
    r: PromiseSettledResult<Awaited<ReturnType<Collectors['collectQueues']>>>,
    s: RuntimeHealthAlertSettings,
  ): QueueMetric {
    if (r.status === 'rejected') return { status: 'unavailable', error: errorText(r.reason) };
    const v = r.value;
    const backlogStatus = deriveStatus(v.totalWaiting, s.queueBacklogWarn, s.queueBacklogCrit);
    // Any failed job is at least a warning, independent of backlog size.
    // worstStatus() returns the 4-value MetricStatus (incl. 'unavailable'), but both inputs here
    // are always 3-value, so the result is safely narrowable to QueueMetricOk['status'].
    const status = (v.totalFailed > 0 ? worstStatus(backlogStatus, 'warning') : backlogStatus) as
      'healthy' | 'warning' | 'critical';
    return { status, totalWaiting: v.totalWaiting, totalFailed: v.totalFailed, queues: v.queues };
  }

  private mapDisk(
    r: PromiseSettledResult<Awaited<ReturnType<Collectors['collectDisk']>>>,
    s: RuntimeHealthAlertSettings,
  ): DiskMetric {
    if (r.status === 'rejected') return { status: 'unavailable', error: errorText(r.reason) };
    const v = r.value;
    return {
      status: deriveStatus(v.usePercent, s.diskWarnPct, s.diskCritPct),
      mountpoint: v.mountpoint,
      sizeBytes: v.sizeBytes,
      usedBytes: v.usedBytes,
      availBytes: v.availBytes,
      usePercent: v.usePercent,
    };
  }
}
