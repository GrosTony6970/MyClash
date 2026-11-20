import type {
  MetricStatus,
  RuntimeHealthResponseDto,
} from '../modules/admin/dto/runtime-health.dto';
import { describeContainerProblem } from '../modules/admin/runtime-health/containers-collector';

// A 'not_configured' metric (photoStorage, containers) is in neither alert tier: it stays quiet.
export const METRIC_KEYS = [
  'database',
  'redis',
  'queues',
  'disk',
  'photoStorage',
  'containers',
] as const;

export function statusOf(snapshot: RuntimeHealthResponseDto, key: string): MetricStatus {
  // `!` is safe: key always comes from METRIC_KEYS, which are guaranteed
  // properties of RuntimeHealthResponseDto (noUncheckedIndexedAccess just
  // can't see that through the Record<string, ...> cast).
  return (snapshot as unknown as Record<string, { status: MetricStatus }>)[key]!.status;
}

/**
 * The metrics at or above a level. 'unavailable' (collector threw / subsystem unreachable) is
 * bucketed at the CRITICAL tier: a dead subsystem is at least as bad as a critical reading, so it
 * must alarm at the default level rather than being gated behind 'warning'. The alert email and
 * the agent's wake-up both read it.
 */
export function keysAtLeast(
  snapshot: RuntimeHealthResponseDto,
  level: 'warning' | 'critical',
): string[] {
  const bad: MetricStatus[] =
    level === 'critical' ? ['critical', 'unavailable'] : ['warning', 'critical', 'unavailable'];
  return METRIC_KEYS.filter((k) => bad.includes(statusOf(snapshot, k)));
}

/** A metric's status; for the containers, followed by the ones at fault (ruling 900). */
export function detailOf(snapshot: RuntimeHealthResponseDto, key: string): string {
  const status = statusOf(snapshot, key);
  const { containers } = snapshot;
  if (key !== 'containers' || !('problems' in containers)) return status;
  return `${status} (${containers.problems.map(describeContainerProblem).join(', ')})`;
}
