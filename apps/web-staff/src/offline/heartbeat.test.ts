import { describe, expect, it } from 'vitest';
import { computeHeartbeatMetrics } from './heartbeat';
import type { OutboxEntry } from './db';

function entry(over: Partial<OutboxEntry>): OutboxEntry {
  return {
    clientUuid: 'u',
    matchId: 'm',
    sequence: 1,
    type: 'clean',
    occurredAt: '2026-07-23T10:00:00Z',
    createdAt: 0,
    attempts: 0,
    ...over,
  };
}

const NOW = 100_000; // ms

describe('computeHeartbeatMetrics', () => {
  it('reports zeros for an empty outbox', () => {
    expect(computeHeartbeatMetrics([], 0, NOW)).toEqual({
      outboxDepth: 0,
      oldestPendingAgeSec: 0,
      rejectedCount: 0,
    });
  });

  it('counts depth and the oldest age in whole seconds', () => {
    const m = computeHeartbeatMetrics(
      [entry({ createdAt: NOW - 5_000 }), entry({ createdAt: NOW - 40_000 })],
      0,
      NOW,
    );
    expect(m.outboxDepth).toBe(2);
    expect(m.oldestPendingAgeSec).toBe(40);
  });

  it('uses the oldest entry regardless of array order (oldest first)', () => {
    const m = computeHeartbeatMetrics(
      [entry({ createdAt: NOW - 40_000 }), entry({ createdAt: NOW - 5_000 })],
      0,
      NOW,
    );
    // Oldest is now the FIRST element — a last-element bug would report 5, not 40.
    expect(m.oldestPendingAgeSec).toBe(40);
  });

  it('never reports a negative age when an entry timestamp is in the future', () => {
    const m = computeHeartbeatMetrics([entry({ createdAt: NOW + 5_000 })], 0, NOW);
    expect(m.oldestPendingAgeSec).toBe(0);
  });

  // The board says "{rejected} rejected". It counted queued hits that had failed to
  // send three times, which the server never refused, and never the hits the server DID
  // refuse, which wait in Review: those leave the queue.
  it('counts as rejected the hits held in Review, not the ones still trying', () => {
    const m = computeHeartbeatMetrics([entry({ attempts: 5 }), entry({ attempts: 1 })], 2, NOW);
    expect(m.rejectedCount).toBe(2);
    expect(m.outboxDepth).toBe(2);
  });

  it('reports a held hit with an empty queue', () => {
    expect(computeHeartbeatMetrics([], 3, NOW)).toEqual({
      outboxDepth: 0,
      oldestPendingAgeSec: 0,
      rejectedCount: 3,
    });
  });
});
