import { describe, expect, it } from 'vitest';
import {
  CLOCK_SKEW_REPORT_MS,
  DEFAULT_THRESHOLDS,
  DOT,
  deriveHealthState,
  isClockSkewed,
  isHealthy,
  partitionByHealth,
  sortBoardRows,
  type HealthState,
} from './live-board-state';
import { NOW, agoIso, mkMatch, mkRow } from './live-board.fixtures';
import type { BoardRow } from './types';

const DURATION = 5;
const stateAt = (row: BoardRow, nowMs = NOW): HealthState =>
  deriveHealthState({ row, nowMs, matchDurationMinutes: DURATION });
const stateOf = (row: BoardRow) => stateAt(row);

describe('deriveHealthState', () => {
  it('is UNKNOWN, never synced, when the tablet has reported no health', () => {
    expect(stateAt(mkRow({ health: null }))).toBe('unknown');
  });

  it('reports an unmanned piste before anything else it cannot measure', () => {
    // no_scorer stays ahead of the sync and timing states: an unmanned piste is
    // the CAUSE of the missing signals, so leading with `unknown` would report
    // the symptom.
    expect(stateAt(mkRow({ scorer: null, health: null }))).toBe('no_scorer');
  });

  it('lets an explicit attention flag outrank everything', () => {
    expect(stateAt(mkRow({ attention: { reason: 'medic' }, scorer: null }))).toBe('attention');
  });

  it('is idle with no current bout', () => {
    expect(stateAt(mkRow({ currentMatch: null }))).toBe('idle');
  });

  it('is stuck on a rejected exchange', () => {
    const health = { outboxDepth: 1, oldestPendingAgeSec: 5, rejectedCount: 1, clockSkewMs: null };
    expect(stateAt(mkRow({ health }))).toBe('stuck');
  });

  it('is stale on a queue that is not draining', () => {
    const health = {
      outboxDepth: 2,
      oldestPendingAgeSec: 120,
      rejectedCount: 0,
      clockSkewMs: null,
    };
    expect(stateAt(mkRow({ health }))).toBe('stale');
  });

  it('is synced on an empty outbox', () => {
    expect(stateAt(mkRow())).toBe('synced');
  });

  // ── timing lens ────────────────────────────────────────────────────────────

  it('is late when a scheduled bout is overdue to start', () => {
    const row = mkRow({
      currentMatch: mkMatch({ status: 'scheduled', startedAt: null, scheduledAt: agoIso(900) }),
    });
    expect(stateAt(row)).toBe('late');
  });

  it('is not late while a scheduled bout is only just due', () => {
    const row = mkRow({
      currentMatch: mkMatch({ status: 'scheduled', startedAt: null, scheduledAt: agoIso(60) }),
    });
    expect(stateAt(row)).toBe('synced');
  });

  it('is late when a running bout overruns its slot past the grace', () => {
    // 5 min slot + 5 min grace = late only beyond 10 minutes.
    expect(stateAt(mkRow({ currentMatch: mkMatch({ startedAt: agoIso(700) }) }))).toBe('late');
    expect(stateAt(mkRow({ currentMatch: mkMatch({ startedAt: agoIso(500) }) }))).toBe('synced');
  });

  it('is idle_stalled when a free piste still has bouts waiting', () => {
    const row = mkRow({
      currentMatch: null,
      queue: [{ matchId: 'm2', label: '#2', scheduledAt: null }],
      lastCompleted: { matchId: 'm0', label: '#0', endedAt: agoIso(600) },
    });
    expect(stateAt(row)).toBe('idle_stalled');
  });

  it('is plain idle when a free piste has nothing left to run', () => {
    const row = mkRow({
      currentMatch: null,
      queue: [],
      lastCompleted: { matchId: 'm0', label: '#0', endedAt: agoIso(600) },
    });
    expect(stateAt(row)).toBe('idle');
  });

  it('is plain idle when the piste has a queue but only just freed up', () => {
    const row = mkRow({
      currentMatch: null,
      queue: [{ matchId: 'm2', label: '#2', scheduledAt: null }],
      lastCompleted: { matchId: 'm0', label: '#0', endedAt: agoIso(60) },
    });
    expect(stateAt(row)).toBe('idle');
  });

  it('is plain idle when the piste has never run a bout', () => {
    // Nothing to be idle *since* — reporting a stall before the day starts
    // would flag every piste red at registration.
    const row = mkRow({
      currentMatch: null,
      queue: [{ matchId: 'm2', label: '#2', scheduledAt: null }],
      lastCompleted: null,
    });
    expect(stateAt(row)).toBe('idle');
  });

  it('lets attention outrank a stalled piste', () => {
    const row = mkRow({
      attention: { reason: 'dispute' },
      currentMatch: null,
      queue: [{ matchId: 'm2', label: '#2', scheduledAt: null }],
      lastCompleted: { matchId: 'm0', label: '#0', endedAt: agoIso(900) },
    });
    expect(stateAt(row)).toBe('attention');
  });

  it('honours a threshold override', () => {
    const row = mkRow({ currentMatch: mkMatch({ startedAt: agoIso(400) }) });
    expect(stateAt(row)).toBe('synced');
    expect(
      deriveHealthState({
        row,
        nowMs: NOW,
        matchDurationMinutes: DURATION,
        thresholds: { ...DEFAULT_THRESHOLDS, overrunGraceSec: 0 },
      }),
    ).toBe('late');
  });
});

describe('DOT', () => {
  it('has a colour for every state', () => {
    // The Record is what makes widening HealthState a compile error rather than
    // a silent grey dot; this pins that nobody replaced it with a lookup.
    const states: HealthState[] = [
      'attention',
      'no_scorer',
      'idle_stalled',
      'late',
      'stuck',
      'stale',
      'unknown',
      'synced',
      'idle',
    ];
    for (const s of states) expect(DOT[s]).toBeTruthy();
    expect(Object.keys(DOT)).toHaveLength(states.length);
  });
});

describe('isHealthy', () => {
  it('counts only synced and idle as fine', () => {
    expect(isHealthy('synced')).toBe(true);
    expect(isHealthy('idle')).toBe(true);
    expect(isHealthy('late')).toBe(false);
    expect(isHealthy('idle_stalled')).toBe(false);
    expect(isHealthy('no_scorer')).toBe(false);
  });
});

describe('sortBoardRows', () => {
  const good = mkRow({ lice: { ...mkRow().lice, id: 'L2', name: 'B', sortOrder: 1 } });
  const bad = mkRow({
    lice: { ...mkRow().lice, id: 'L1', name: 'A', sortOrder: 0 },
    attention: { reason: 'medic' },
  });

  it('orders by piste', () => {
    expect(sortBoardRows([good, bad], 'piste', stateOf).map((r) => r.lice.id)).toEqual([
      'L1',
      'L2',
    ]);
  });

  it('orders worst first', () => {
    const rows = [good, bad];
    expect(sortBoardRows(rows, 'worst', stateOf).map((r) => r.lice.id)).toEqual(['L1', 'L2']);
  });

  it('sorts a stalled piste above a merely late one', () => {
    const stalled = mkRow({
      lice: { ...mkRow().lice, id: 'stalled', sortOrder: 9 },
      currentMatch: null,
      queue: [{ matchId: 'm2', label: '#2', scheduledAt: null }],
      lastCompleted: { matchId: 'm0', label: '#0', endedAt: agoIso(900) },
    });
    const late = mkRow({
      lice: { ...mkRow().lice, id: 'late', sortOrder: 0 },
      currentMatch: mkMatch({ startedAt: agoIso(900) }),
    });
    expect(sortBoardRows([late, stalled], 'worst', stateOf).map((r) => r.lice.id)).toEqual([
      'stalled',
      'late',
    ]);
  });

  it('sorts an unmanned piste last despite deriving early', () => {
    const unmanned = mkRow({ lice: { ...mkRow().lice, id: 'none', sortOrder: 0 }, scorer: null });
    const late = mkRow({
      lice: { ...mkRow().lice, id: 'late', sortOrder: 9 },
      currentMatch: mkMatch({ startedAt: agoIso(900) }),
    });
    expect(sortBoardRows([unmanned, late], 'worst', stateOf).map((r) => r.lice.id)).toEqual([
      'late',
      'none',
    ]);
  });
});

describe('partitionByHealth', () => {
  it('buckets synced and idle as healthy and everything else as a problem', () => {
    const synced = mkRow({ lice: { ...mkRow().lice, id: 'ok' } });
    const idle = mkRow({ lice: { ...mkRow().lice, id: 'idle' }, currentMatch: null });
    const problem = mkRow({ lice: { ...mkRow().lice, id: 'bad' }, attention: { reason: 'medic' } });
    const { problems, healthy } = partitionByHealth([synced, idle, problem], stateOf);
    expect(healthy.map((r) => r.lice.id)).toEqual(['ok', 'idle']);
    expect(problems.map((r) => r.lice.id)).toEqual(['bad']);
  });

  it('treats a stalled piste as a problem, not as idle', () => {
    const stalled = mkRow({
      currentMatch: null,
      queue: [{ matchId: 'm2', label: '#2', scheduledAt: null }],
      lastCompleted: { matchId: 'm0', label: '#0', endedAt: agoIso(900) },
    });
    expect(partitionByHealth([stalled], stateOf).problems).toHaveLength(1);
  });
});

describe('isClockSkewed', () => {
  it('is false for an unmeasured clock, not true and not "fine"', () => {
    // null means the tablet never reported one. The caller renders nothing;
    // the danger is treating it as a verified zero.
    expect(isClockSkewed(null)).toBe(false);
  });

  it('ignores drift inside the network-latency noise floor', () => {
    expect(isClockSkewed(0)).toBe(false);
    expect(isClockSkewed(5_000)).toBe(false);
    expect(isClockSkewed(-5_000)).toBe(false);
  });

  it('reports a real skew in either direction', () => {
    expect(isClockSkewed(CLOCK_SKEW_REPORT_MS)).toBe(true);
    expect(isClockSkewed(-CLOCK_SKEW_REPORT_MS)).toBe(true);
    expect(isClockSkewed(3_600_000)).toBe(true);
  });
});
