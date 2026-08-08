import type { OutboxEntry } from './db';

/** Retry attempts at which a queued exchange is treated as stuck (matches the
 *  sync engine's maxConsecutiveFailures). */
export const STUCK_ATTEMPTS = 3;

export interface HeartbeatMetrics {
  outboxDepth: number;
  oldestPendingAgeSec: number;
  rejectedCount: number;
}

/** Derive tablet sync-health metrics from the current outbox snapshot. Pure. */
export function computeHeartbeatMetrics(entries: OutboxEntry[], now: number): HeartbeatMetrics {
  if (entries.length === 0) {
    return { outboxDepth: 0, oldestPendingAgeSec: 0, rejectedCount: 0 };
  }
  const oldestCreatedAt = entries.reduce((min, e) => Math.min(min, e.createdAt), Infinity);
  return {
    outboxDepth: entries.length,
    oldestPendingAgeSec: Math.max(0, Math.floor((now - oldestCreatedAt) / 1000)),
    rejectedCount: entries.filter((e) => e.attempts >= STUCK_ATTEMPTS).length,
  };
}
