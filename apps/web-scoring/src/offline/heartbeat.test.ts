import { describe, expect, it } from 'vitest';
import { computeHeartbeatMetrics, STUCK_ATTEMPTS } from './heartbeat';
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
    expect(computeHeartbeatMetrics([], NOW)).toEqual({
      outboxDepth: 0,
      oldestPendingAgeSec: 0,
      rejectedCount: 0,
    });
  });

  it('counts depth and the oldest age in whole seconds', () => {
    const m = computeHeartbeatMetrics(
      [entry({ createdAt: NOW - 5_000 }), entry({ createdAt: NOW - 40_000 })],
      NOW,
    );
    expect(m.outboxDepth).toBe(2);
    expect(m.oldestPendingAgeSec).toBe(40);
  });

  it(`counts entries stuck at >= ${STUCK_ATTEMPTS} attempts as rejected`, () => {
    const m = computeHeartbeatMetrics(
      [
        entry({ attempts: STUCK_ATTEMPTS }),
        entry({ attempts: 1 }),
        entry({ attempts: STUCK_ATTEMPTS + 2 }),
      ],
      NOW,
    );
    expect(m.rejectedCount).toBe(2);
  });
});
