import { describe, expect, it } from 'vitest';
import {
  planSwissRound,
  recommendedRoundCount,
  type SwissGrouping,
  type SwissPairingMethod,
  type SwissPlayer,
  type SwissRoundPlan,
} from './swiss';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * A field of N fighters, ranked 1..N, all on 0 points and having met nobody.
 * Ids are `f1`..`fN` so a failing assertion names the rank directly.
 */
function field(n: number, overrides: Partial<SwissPlayer>[] = []): SwissPlayer[] {
  return Array.from({ length: n }, (_, i) => ({
    registrationId: `f${i + 1}`,
    points: 0,
    score: null,
    opponentIds: [],
    hadBye: false,
    rank: i + 1,
    ...overrides[i],
  }));
}

const plan = (
  players: SwissPlayer[],
  pairingMethod: SwissPairingMethod = 'fold',
  grouping: SwissGrouping = { kind: 'points' },
): SwissRoundPlan => planSwissRound(players, { pairingMethod, grouping });

/** Pairings as readable "a-vs-b" strings, in board order. */
const asPairs = (result: SwissRoundPlan): string[] =>
  result.pairings.map((p) => `${p.aId}-${p.bId}`);

const codes = (result: SwissRoundPlan): string[] => result.warnings.map((w) => w.code);

// ── recommendedRoundCount ────────────────────────────────────────────────────

describe('recommendedRoundCount', () => {
  it('is ceil(log2 N), exact at every power of two', () => {
    expect(recommendedRoundCount(8)).toBe(3);
    expect(recommendedRoundCount(16)).toBe(4);
    expect(recommendedRoundCount(32)).toBe(5);
    expect(recommendedRoundCount(64)).toBe(6);
    // One over a power of two needs one more round, not the same one.
    expect(recommendedRoundCount(17)).toBe(5);
    expect(recommendedRoundCount(40)).toBe(6);
    expect(recommendedRoundCount(120)).toBe(7);
  });

  it('clamps to 3..9 — under 3 rounds the standings have separated nobody', () => {
    expect(recommendedRoundCount(2)).toBe(3);
    expect(recommendedRoundCount(4)).toBe(3);
    expect(recommendedRoundCount(0)).toBe(3);
    expect(recommendedRoundCount(1)).toBe(3);
    expect(recommendedRoundCount(5000)).toBe(9);
  });
});

// ── Pairing methods ──────────────────────────────────────────────────────────

describe('planSwissRound — pairing methods', () => {
  it('fold pairs the top half against the bottom half', () => {
    // 8 fighters, one group: 1v5, 2v6, 3v7, 4v8.
    expect(asPairs(plan(field(8), 'fold'))).toEqual(['f1-f5', 'f2-f6', 'f3-f7', 'f4-f8']);
  });

  it('adjacent pairs straight down the table', () => {
    expect(asPairs(plan(field(8), 'adjacent'))).toEqual(['f1-f2', 'f3-f4', 'f5-f6', 'f7-f8']);
  });

  it('numbers boards 1..N in group order', () => {
    expect(plan(field(8), 'fold').pairings.map((p) => p.board)).toEqual([1, 2, 3, 4]);
  });

  it('names the higher-ranked fighter first — a pairing order, not a side', () => {
    for (const p of plan(field(8), 'fold').pairings) {
      expect(Number(p.aId.slice(1))).toBeLessThan(Number(p.bId.slice(1)));
    }
  });

  it('folds within each score group, not across the whole table', () => {
    // Four on 3 points, four on 0. Fold applies inside each group:
    // 1v3, 2v4 among the leaders; 5v7, 6v8 among the rest.
    const players = field(8, [
      { points: 3 },
      { points: 3 },
      { points: 3 },
      { points: 3 },
      { points: 0 },
      { points: 0 },
      { points: 0 },
      { points: 0 },
    ]);
    expect(asPairs(plan(players, 'fold'))).toEqual(['f1-f3', 'f2-f4', 'f5-f7', 'f6-f8']);
  });

  it('orders groups by points descending regardless of input order', () => {
    const players = [
      { registrationId: 'low', points: 0, score: null, opponentIds: [], hadBye: false, rank: 3 },
      { registrationId: 'top', points: 6, score: null, opponentIds: [], hadBye: false, rank: 1 },
      { registrationId: 'mid', points: 3, score: null, opponentIds: [], hadBye: false, rank: 2 },
      { registrationId: 'low2', points: 0, score: null, opponentIds: [], hadBye: false, rank: 4 },
    ];
    // 6-point group is a singleton and downfloats into the 3-point group.
    expect(asPairs(plan(players, 'adjacent'))).toEqual(['top-mid', 'low-low2']);
  });
});

// ── Byes ─────────────────────────────────────────────────────────────────────

describe('planSwissRound — byes', () => {
  it('gives an odd field exactly one bye, to the lowest-ranked fighter', () => {
    const result = plan(field(7), 'fold');
    expect(result.byeRegistrationId).toBe('f7');
    expect(result.pairings).toHaveLength(3);
  });

  it('gives an even field no bye at all', () => {
    expect(plan(field(8), 'fold').byeRegistrationId).toBeNull();
  });

  it('never gives a second bye while anyone is still without one', () => {
    // f7 and f6 already sat out; f5 is the lowest-ranked fighter who has not.
    const players = field(7, [{}, {}, {}, {}, {}, { hadBye: true }, { hadBye: true }]);
    expect(plan(players, 'fold').byeRegistrationId).toBe('f5');
  });

  it('falls back to the lowest-ranked overall once everybody has had one', () => {
    const players = field(
      5,
      Array.from({ length: 5 }, () => ({ hadBye: true })),
    );
    expect(plan(players, 'fold').byeRegistrationId).toBe('f5');
  });

  it('excludes the bye holder from every pairing', () => {
    const result = plan(field(9), 'fold');
    const paired = result.pairings.flatMap((p) => [p.aId, p.bId]);
    expect(paired).not.toContain(result.byeRegistrationId);
    expect(new Set(paired).size).toBe(8);
  });

  it('handles a field of one — a bye and nothing else', () => {
    const result = plan(field(1), 'fold');
    expect(result.byeRegistrationId).toBe('f1');
    expect(result.pairings).toEqual([]);
  });

  it('returns an empty plan for an empty field rather than throwing', () => {
    expect(plan([], 'fold')).toEqual({ pairings: [], byeRegistrationId: null, warnings: [] });
  });
});

// ── Downfloating ─────────────────────────────────────────────────────────────

describe('planSwissRound — downfloating', () => {
  it('floats an odd group’s lowest-ranked member into the next group', () => {
    // Three on 3 points, three on 0. f3 floats down and meets f4.
    const players = field(6, [
      { points: 3 },
      { points: 3 },
      { points: 3 },
      { points: 0 },
      { points: 0 },
      { points: 0 },
    ]);
    expect(asPairs(plan(players, 'adjacent'))).toEqual(['f1-f2', 'f3-f4', 'f5-f6']);
  });

  it('pairs everyone exactly once even when several groups are odd', () => {
    const players = field(10, [
      { points: 9 },
      { points: 6 },
      { points: 6 },
      { points: 6 },
      { points: 3 },
      { points: 3 },
      { points: 3 },
      { points: 0 },
      { points: 0 },
      { points: 0 },
    ]);
    const result = plan(players, 'fold');
    const paired = result.pairings.flatMap((p) => [p.aId, p.bId]);
    expect(paired).toHaveLength(10);
    expect(new Set(paired).size).toBe(10);
    expect(result.byeRegistrationId).toBeNull();
  });

  it('absorbs a float into the last group rather than leaving it unpaired', () => {
    // Every fighter on a unique score → six singleton groups, all cascading.
    const players = field(6, [
      { points: 15 },
      { points: 12 },
      { points: 9 },
      { points: 6 },
      { points: 3 },
      { points: 0 },
    ]);
    const paired = plan(players, 'fold').pairings.flatMap((p) => [p.aId, p.bId]);
    expect(new Set(paired).size).toBe(6);
  });
});

// ── Rematch avoidance ────────────────────────────────────────────────────────

describe('planSwissRound — rematch avoidance', () => {
  it('avoids the ideal partner when the two have already met', () => {
    // Fold would give f1-f3; they have met, so the search takes the next best.
    const players = field(4, [{ opponentIds: ['f3'] }, {}, { opponentIds: ['f1'] }, {}]);
    const result = plan(players, 'fold');
    expect(asPairs(result)).not.toContain('f1-f3');
    expect(result.pairings.every((p) => !p.rematch)).toBe(true);
    expect(codes(result)).toEqual([]);
  });

  it('keeps the ideal pairing untouched when nothing has met', () => {
    expect(asPairs(plan(field(16), 'fold'))).toEqual(
      Array.from({ length: 8 }, (_, i) => `f${i + 1}-f${i + 9}`),
    );
  });

  it('flags a forced rematch instead of throwing when no alternative exists', () => {
    // Two fighters who have already played each other and nobody else to pair
    // with: an event cannot be allowed to stall on this.
    const players = field(2, [{ opponentIds: ['f2'] }, { opponentIds: ['f1'] }]);
    const result = plan(players, 'fold');

    expect(result.pairings).toHaveLength(1);
    expect(result.pairings[0]!.rematch).toBe(true);
    expect(codes(result)).toContain('no-perfect-matching');
    expect(codes(result)).toContain('forced-rematch');
    expect(result.warnings.find((w) => w.code === 'forced-rematch')!.registrationIds).toEqual([
      'f1',
      'f2',
    ]);
  });

  it('finds a rematch-free matching that the ideal pairing alone would miss', () => {
    // f1 has met f3 and f4, f2 has met f4. Fold's 1v3,2v4 is doubly blocked;
    // 1v2, 3v4 is not — but only backtracking finds it.
    const players = field(4, [
      { opponentIds: ['f3', 'f4'] },
      { opponentIds: ['f4'] },
      { opponentIds: ['f1'] },
      { opponentIds: ['f1', 'f2'] },
    ]);
    const result = plan(players, 'fold');
    expect(asPairs(result)).toEqual(['f1-f2', 'f3-f4']);
    expect(result.pairings.every((p) => !p.rematch)).toBe(true);
  });

  it('marks only the pairs that really are rematches', () => {
    const players = field(2, [{ opponentIds: ['f2'] }, { opponentIds: ['f1'] }]);
    const forced = plan(players, 'fold');
    expect(forced.pairings.map((p) => p.rematch)).toEqual([true]);
    expect(plan(field(8), 'fold').pairings.map((p) => p.rematch)).toEqual(Array(4).fill(false));
  });

  it('floats further down rather than forcing an avoidable rematch', () => {
    // Round 3 of a 4-fighter Swiss, reached by chalk results: f1 on 6, f2 and
    // f3 on 3, f4 on 0. The plain downfloat hands the 3-point bracket [f1, f2]
    // — who met in round 2 — while f1-f4 / f2-f3 is available one group down.
    // Escalating the downfloat is what finds it.
    const players: SwissPlayer[] = [
      {
        registrationId: 'f1',
        points: 6,
        score: null,
        opponentIds: ['f3', 'f2'],
        hadBye: false,
        rank: 1,
      },
      {
        registrationId: 'f2',
        points: 3,
        score: null,
        opponentIds: ['f4', 'f1'],
        hadBye: false,
        rank: 2,
      },
      {
        registrationId: 'f3',
        points: 3,
        score: null,
        opponentIds: ['f1', 'f4'],
        hadBye: false,
        rank: 3,
      },
      {
        registrationId: 'f4',
        points: 0,
        score: null,
        opponentIds: ['f2', 'f3'],
        hadBye: false,
        rank: 4,
      },
    ];
    const result = plan(players, 'fold');

    expect(asPairs(result)).toEqual(['f1-f4', 'f2-f3']);
    expect(result.pairings.every((p) => !p.rematch)).toBe(true);
    expect(codes(result)).toEqual([]);
  });

  it('only warns about no-perfect-matching once the last bracket is stuck', () => {
    // An earlier bracket that cannot be paired is not a failure — it floats.
    // Only the final bracket has nowhere left to send anyone.
    const players: SwissPlayer[] = [
      { registrationId: 'f1', points: 3, score: null, opponentIds: ['f2'], hadBye: false, rank: 1 },
      { registrationId: 'f2', points: 3, score: null, opponentIds: ['f1'], hadBye: false, rank: 2 },
      { registrationId: 'f3', points: 0, score: null, opponentIds: [], hadBye: false, rank: 3 },
      { registrationId: 'f4', points: 0, score: null, opponentIds: [], hadBye: false, rank: 4 },
    ];
    const result = plan(players, 'fold');
    expect(codes(result)).toEqual([]);
    expect(result.pairings.every((p) => !p.rematch)).toBe(true);
  });

  it('ignores recorded opponents who are not in this round’s field', () => {
    // A withdrawn opponent still sits in opponentIds; it must not constrain
    // (or crash) the pairing.
    const players = field(4, [{ opponentIds: ['withdrawn-x'] }, {}, {}, {}]);
    expect(asPairs(plan(players, 'fold'))).toEqual(['f1-f3', 'f2-f4']);
  });
});

// ── Determinism ──────────────────────────────────────────────────────────────

describe('planSwissRound — determinism', () => {
  it('depends on rank, not on the order rows arrive in', () => {
    const players = field(8);
    const shuffled = [
      players[5]!,
      players[0]!,
      players[7]!,
      players[2]!,
      players[4]!,
      players[1]!,
      players[6]!,
      players[3]!,
    ];
    expect(asPairs(plan(shuffled, 'fold'))).toEqual(asPairs(plan(players, 'fold')));
  });

  it('breaks a shared rank on registration id, not on input order', () => {
    const tied = (ids: string[]): SwissPlayer[] =>
      ids.map((registrationId) => ({
        registrationId,
        points: 0,
        score: null,
        opponentIds: [],
        hadBye: false,
        rank: 1,
      }));
    expect(asPairs(plan(tied(['d', 'a', 'c', 'b']), 'adjacent'))).toEqual(['a-b', 'c-d']);
    expect(asPairs(plan(tied(['a', 'b', 'c', 'd']), 'adjacent'))).toEqual(['a-b', 'c-d']);
  });

  it('returns an identical plan when called twice', () => {
    const players = field(13, [
      { opponentIds: ['f7'] },
      {},
      {},
      {},
      {},
      {},
      { opponentIds: ['f1'] },
    ]);
    expect(plan(players, 'fold')).toEqual(plan(players, 'fold'));
  });
});
