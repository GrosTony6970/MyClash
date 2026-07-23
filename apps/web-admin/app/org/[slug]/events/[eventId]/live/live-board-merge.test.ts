import { describe, expect, it } from 'vitest';
import { mergeRealtimePatch } from './live-board-merge';
import type { BoardRow } from './types';

function row(matchId: string | null): BoardRow {
  return {
    lice: { id: 'L1', name: 'P1', sortOrder: 0 },
    currentMatch: matchId
      ? {
          id: matchId,
          redFighterName: 'A',
          blueFighterName: 'B',
          redScore: 0,
          blueScore: 0,
          status: 'running',
          round: 1,
        }
      : null,
    scorer: null,
    health: null,
    attention: null,
    nextUp: null,
  };
}

describe('mergeRealtimePatch', () => {
  it('patches the score on the matching row only', () => {
    const rows = [row('m1'), row('m2')];
    const { rows: out, shouldRefetch } = mergeRealtimePatch(rows, {
      id: 'm1',
      redScore: 3,
      blueScore: 2,
      status: 'running',
    });
    expect(out[0]!.currentMatch).toMatchObject({ redScore: 3, blueScore: 2 });
    expect(out[1]!.currentMatch?.redScore).toBe(0);
    expect(shouldRefetch).toBe(false);
  });

  it('returns the same array reference and no refetch when nothing matches', () => {
    const rows = [row('m1')];
    const res = mergeRealtimePatch(rows, { id: 'zzz', redScore: 9 });
    expect(res.rows).toBe(rows);
    expect(res.shouldRefetch).toBe(false);
  });

  it('flags shouldRefetch when the current match completes (rollover)', () => {
    const res = mergeRealtimePatch([row('m1')], { id: 'm1', status: 'completed' });
    expect(res.shouldRefetch).toBe(true);
  });
});
