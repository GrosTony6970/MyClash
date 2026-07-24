import type { MetricStatus } from '../dto/runtime-health.dto';

/** Ascending metric (higher value = worse). warn/crit are inclusive lower bounds. */
export function deriveStatus(
  value: number,
  warn: number,
  crit: number,
): 'healthy' | 'warning' | 'critical' {
  if (value >= crit) return 'critical';
  if (value >= warn) return 'warning';
  return 'healthy';
}

const RANK: Record<MetricStatus, number> = {
  healthy: 0,
  unavailable: 1,
  warning: 2,
  critical: 3,
};

export function worstStatus(...statuses: MetricStatus[]): MetricStatus {
  return statuses.reduce<MetricStatus>(
    (worst, s) => (RANK[s] > RANK[worst] ? s : worst),
    'healthy',
  );
}
