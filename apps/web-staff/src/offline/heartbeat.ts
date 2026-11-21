import type { OutboxEntry } from './db';

export interface HeartbeatMetrics {
  outboxDepth: number;
  oldestPendingAgeSec: number;
  /** Hits the server refused, held in Review (`rejected` store): what the board calls rejected. */
  rejectedCount: number;
}

/**
 * Derive tablet sync-health metrics from the current outbox and the count of
 * hits held in Review. Pure.
 *
 * `rejectedCount` was the queued entries with three failed sends: hits the
 * server never refused, while the ones it DID refuse leave the queue for Review
 * and were never counted. A queue that does not drain is the board's own reading
 * of `oldestPendingAgeSec`.
 */
export function computeHeartbeatMetrics(
  entries: OutboxEntry[],
  heldCount: number,
  now: number,
): HeartbeatMetrics {
  if (entries.length === 0) {
    return { outboxDepth: 0, oldestPendingAgeSec: 0, rejectedCount: heldCount };
  }
  const oldestCreatedAt = entries.reduce((min, e) => Math.min(min, e.createdAt), Infinity);
  return {
    outboxDepth: entries.length,
    oldestPendingAgeSec: Math.max(0, Math.floor((now - oldestCreatedAt) / 1000)),
    rejectedCount: heldCount,
  };
}
