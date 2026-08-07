import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export type MetricStatus = 'healthy' | 'warning' | 'critical' | 'unavailable';

interface Unavailable {
  status: 'unavailable';
  error: string;
}

export interface DbMetricOk {
  status: 'healthy' | 'warning' | 'critical';
  connections: {
    inUse: number;
    max: number;
    headroom: number;
    byState: { active: number; idle: number; idleInTransaction: number };
  };
  databaseSizeBytes: number;
  longestQuerySeconds: number;
  cacheHitRatio: number;
  uptimeSeconds: number;
}
export type DbMetric = DbMetricOk | Unavailable;

export interface RedisMetricOk {
  status: 'healthy' | 'warning' | 'critical';
  usedMemoryBytes: number;
  maxMemoryBytes: number;
  keys: number;
  connectedClients: number;
}
export type RedisMetric = RedisMetricOk | Unavailable;

export interface QueueMetricOk {
  status: 'healthy' | 'warning' | 'critical';
  totalWaiting: number;
  totalFailed: number;
  queues: Array<{
    name: string;
    active: number;
    waiting: number;
    delayed: number;
    failed: number;
  }>;
}
export type QueueMetric = QueueMetricOk | Unavailable;

export interface DiskMetricOk {
  status: 'healthy' | 'warning' | 'critical';
  mountpoint: string;
  sizeBytes: number;
  usedBytes: number;
  availBytes: number;
  usePercent: number;
}
export type DiskMetric = DiskMetricOk | Unavailable;

export interface RuntimeHealthResponseDto {
  checkedAt: string;
  overall: MetricStatus;
  database: DbMetric;
  redis: RedisMetric;
  queues: QueueMetric;
  disk: DiskMetric;
}

/**
 * One retained tick of the monitor. Every metric is nullable because the
 * collectors run under Promise.allSettled — a Redis outage still records the
 * database and disk readings, and the nulls mark the gap rather than hiding it.
 */
export interface RuntimeHealthSample {
  sampledAt: string;
  overall: MetricStatus;
  connInUse: number | null;
  connMax: number | null;
  dbSizeBytes: number | null;
  longestQuerySeconds: number | null;
  /** Fraction in 0..1, as stored — the UI multiplies by 100. */
  cacheHitRatio: number | null;
  redisUsedBytes: number | null;
  redisMaxBytes: number | null;
  queueWaiting: number | null;
  queueFailed: number | null;
  diskUsePct: number | null;
}

export interface RuntimeHealthSeriesResponseDto {
  since: string;
  samples: RuntimeHealthSample[];
}

export interface RuntimeHealthAlertSettings {
  enabled: boolean;
  recipientEmails: string[];
  emailLevel: 'warning' | 'critical';
  checkIntervalMinutes: number;
  cooldownMinutes: number;
  connWarnPct: number;
  connCritPct: number;
  redisWarnPct: number;
  redisCritPct: number;
  diskWarnPct: number;
  diskCritPct: number;
  queueBacklogWarn: number;
  queueBacklogCrit: number;
  updatedAt: string | null;
}

export const DEFAULT_ALERT_SETTINGS: RuntimeHealthAlertSettings = {
  enabled: true,
  recipientEmails: [],
  emailLevel: 'critical',
  checkIntervalMinutes: 15,
  cooldownMinutes: 360,
  connWarnPct: 70,
  connCritPct: 90,
  redisWarnPct: 75,
  redisCritPct: 90,
  diskWarnPct: 80,
  diskCritPct: 90,
  queueBacklogWarn: 500,
  queueBacklogCrit: 2000,
  updatedAt: null,
};

const pct = z.number().int().min(1).max(100);

export const updateAlertSettingsSchema = z
  .object({
    enabled: z.boolean(),
    recipientEmails: z.array(z.string().email()).max(20),
    emailLevel: z.enum(['warning', 'critical']),
    checkIntervalMinutes: z.number().int().min(1).max(1440),
    cooldownMinutes: z.number().int().min(0).max(10080),
    connWarnPct: pct,
    connCritPct: pct,
    redisWarnPct: pct,
    redisCritPct: pct,
    diskWarnPct: pct,
    diskCritPct: pct,
    queueBacklogWarn: z.number().int().min(0),
    queueBacklogCrit: z.number().int().min(0),
  })
  .partial()
  .strict()
  .superRefine((val, ctx) => {
    const pairs: Array<[keyof typeof val, keyof typeof val]> = [
      ['connWarnPct', 'connCritPct'],
      ['redisWarnPct', 'redisCritPct'],
      ['diskWarnPct', 'diskCritPct'],
      ['queueBacklogWarn', 'queueBacklogCrit'],
    ];
    for (const [warnKey, critKey] of pairs) {
      const warn = val[warnKey];
      const crit = val[critKey];
      if (typeof warn === 'number' && typeof crit === 'number' && warn >= crit) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [critKey],
          message: `${String(critKey)} must be greater than ${String(warnKey)}`,
        });
      }
    }
  });

export class UpdateAlertSettingsDto extends createZodDto(updateAlertSettingsSchema) {}
