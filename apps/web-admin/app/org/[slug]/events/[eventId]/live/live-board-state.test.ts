import { describe, expect, it } from 'vitest';
import { deriveHealthState, sortBoardRows } from './live-board-state';
import type { BoardRow } from './types';

function mk(over: Partial<BoardRow>): BoardRow {
  return {
    lice: { id: 'L', name: 'P', sortOrder: 0 },
    currentMatch: {
      id: 'm',
      redFighterName: null,
      blueFighterName: null,
      redScore: 0,
      blueScore: 0,
      status: 'running',
      round: null,
    },
    scorer: { accountId: 'a', name: 'S', lastSeenAt: '2026-07-21T10:00:00Z', otherCount: 0 },
    health: { outboxDepth: 0, oldestPendingAgeSec: 0, rejectedCount: 0 },
    attention: null,
    nextUp: null,
    ...over,
  };
}

describe('deriveHealthState', () => {
  it('is unknown (never synced) when health is null', () => {
    expect(deriveHealthState(mk({ health: null }))).toBe('unknown');
  });
  it('is no_scorer when no scorer is assigned', () => {
    expect(deriveHealthState(mk({ scorer: null }))).toBe('no_scorer');
  });
  it('is attention when the flag is set (outranks everything)', () => {
    expect(deriveHealthState(mk({ attention: { reason: 'medic' } }))).toBe('attention');
  });
  it('is idle when there is no current match', () => {
    expect(
      deriveHealthState(
        mk({
          currentMatch: null,
          health: { outboxDepth: 0, oldestPendingAgeSec: 0, rejectedCount: 0 },
        }),
      ),
    ).toBe('idle');
  });
  it('is stuck when a rejection exists', () => {
    expect(
      deriveHealthState(
        mk({ health: { outboxDepth: 3, oldestPendingAgeSec: 10, rejectedCount: 1 } }),
      ),
    ).toBe('stuck');
  });
  it('is stale when the queue is old but not rejected', () => {
    expect(
      deriveHealthState(
        mk({ health: { outboxDepth: 3, oldestPendingAgeSec: 120, rejectedCount: 0 } }),
      ),
    ).toBe('stale');
  });
  it('is synced when the queue is empty', () => {
    expect(deriveHealthState(mk({}))).toBe('synced');
  });
});

describe('sortBoardRows', () => {
  const a = mk({ lice: { id: 'A', name: 'P1', sortOrder: 0 } }); // synced
  const b = mk({ lice: { id: 'B', name: 'P2', sortOrder: 1 }, attention: { reason: 'medic' } }); // attention
  it('by piste keeps sortOrder', () => {
    expect(sortBoardRows([b, a], 'piste').map((r) => r.lice.id)).toEqual(['A', 'B']);
  });
  it('worst-first floats problems to the top', () => {
    expect(sortBoardRows([a, b], 'worst').map((r) => r.lice.id)).toEqual(['B', 'A']);
  });
});
