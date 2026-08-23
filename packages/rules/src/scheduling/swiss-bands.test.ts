import { describe, expect, it } from 'vitest';
import { bandsOf, planSwissRound, type SwissPlayer, type SwissRoundPlan } from './swiss';

/**
 * Score-band grouping — the second pairing axis.
 *
 * Swiss pairs fighters on EQUAL value, so a continuous ruleset score (TF_v1's
 * is a ratio to 2dp) gives everyone a unique value, collapses every group to
 * size 1, and degenerates the pairing to a flat 1v2, 3v4 down the table. Bands
 * are how an organiser gets grouping back out of a continuous score.
 *
 * `bandsOf` also backs the Configure tab's live preview, so these tests pin the
 * one property that makes the preview honest: the bands an organiser is shown
 * are the bands the next round is actually paired from.
 */

/** A field of N fighters ranked 1..N, all on 0 points, having met nobody. */
function field(n: number): SwissPlayer[] {
  return Array.from({ length: n }, (_, i) => ({
    registrationId: `f${i + 1}`,
    points: 0,
    score: null as number | null,
    opponentIds: [] as string[],
    hadBye: false,
    rank: i + 1,
  }));
}

const asPairs = (result: SwissRoundPlan): string[] =>
  result.pairings.map((p) => `${p.aId}-${p.bId}`);

const codes = (result: SwissRoundPlan): string[] => result.warnings.map((w) => w.code);

const plan = (players: SwissPlayer[]): SwissRoundPlan =>
  planSwissRound(players, { pairingMethod: 'fold', grouping: { kind: 'points' } });

describe('bandsOf', () => {
  const scored = (scores: Array<number | null>): SwissPlayer[] =>
    scores.map((score, i) => ({
      registrationId: `f${i + 1}`,
      points: 0,
      score,
      opponentIds: [],
      hadBye: false,
      rank: i + 1,
    }));

  it('returns boundaries.length + 1 bands, highest first', () => {
    const bands = bandsOf(scored([0.9, 0.5, 0.1]), [0.2, 0.4, 0.6, 0.8]);
    expect(bands).toHaveLength(5);
    expect(bands[0]!.map((p) => p.registrationId)).toEqual(['f1']); // >= 0.8
    expect(bands[2]!.map((p) => p.registrationId)).toEqual(['f2']); // [0.4, 0.6)
    expect(bands[4]!.map((p) => p.registrationId)).toEqual(['f3']); // < 0.2
  });

  it('keeps empty bands so the preview can show a boundary nobody falls into', () => {
    const bands = bandsOf(scored([0.9, 0.85]), [0.2, 0.4, 0.6, 0.8]);
    expect(bands.map((b) => b.length)).toEqual([2, 0, 0, 0, 0]);
  });

  it('treats a boundary as the floor of its band, not the ceiling', () => {
    // A score exactly on the edge belongs to the band above it.
    const bands = bandsOf(scored([0.4]), [0.4]);
    expect(bands[0]!.map((p) => p.registrationId)).toEqual(['f1']);
    expect(bands[1]).toEqual([]);
  });

  it('sorts into the lowest band when a fighter has no score', () => {
    const bands = bandsOf(scored([null, 0.9]), [0.5]);
    expect(bands[0]!.map((p) => p.registrationId)).toEqual(['f2']);
    expect(bands[1]!.map((p) => p.registrationId)).toEqual(['f1']);
  });

  it('reads unsorted or duplicated boundaries as the set they are', () => {
    expect(bandsOf(scored([0.9, 0.5, 0.1]), [0.8, 0.2, 0.8]).map((b) => b.length)).toEqual(
      bandsOf(scored([0.9, 0.5, 0.1]), [0.2, 0.8]).map((b) => b.length),
    );
  });

  it('ranks within each band', () => {
    const players = scored([0.9, 0.95]);
    expect(bandsOf(players, [0.5])[0]!.map((p) => p.registrationId)).toEqual(['f1', 'f2']);
  });
});

describe('planSwissRound — score-band grouping', () => {
  const withScores = (scores: number[]): SwissPlayer[] =>
    field(scores.length).map((p, i) => ({ ...p, score: scores[i]! }));

  it('pairs inside bands, so a continuous score still groups', () => {
    // Without bands these four unique scores would be four singleton groups
    // and the pairing would degenerate to a flat 1v2, 3v4.
    const players = withScores([0.91, 0.85, 0.21, 0.11]);
    const result = planSwissRound(players, {
      pairingMethod: 'fold',
      grouping: { kind: 'scoreBands', boundaries: [0.5] },
    });
    expect(asPairs(result)).toEqual(['f1-f2', 'f3-f4']);
  });

  it('downfloats a singleton band and says so', () => {
    const players = withScores([0.91, 0.45, 0.21, 0.11]);
    const result = planSwissRound(players, {
      pairingMethod: 'fold',
      grouping: { kind: 'scoreBands', boundaries: [0.6, 0.3] },
    });
    // f1 alone above 0.6, f2 alone in [0.3, 0.6) — both float down.
    expect(codes(result).filter((c) => c === 'singleton-band')).toHaveLength(2);
    const paired = result.pairings.flatMap((p) => [p.aId, p.bId]);
    expect(new Set(paired).size).toBe(4);
  });

  it('does not warn about singleton POINTS groups, which are ordinary', () => {
    // The same four fighters, all on unique values: four singleton groups
    // either way. Under points that is just an ordinary spread of records;
    // under bands it means the organiser drew an edge that isolates people,
    // which is the only one of the two worth telling them about.
    const players = field(4).map((p, i) => ({ ...p, points: [9, 6, 3, 0][i]! }));
    expect(codes(plan(players))).toEqual([]);
  });

  it('produces the same groups the preview showed', () => {
    // bandsOf backs both the pairing and the Configure tab preview, so an
    // organiser cannot be shown one grouping and get another.
    const players = withScores([0.91, 0.85, 0.55, 0.45, 0.21, 0.11]);
    const boundaries = [0.3, 0.6];
    const preview = bandsOf(players, boundaries).map((b) => b.map((p) => p.registrationId));
    expect(preview).toEqual([
      ['f1', 'f2'],
      ['f3', 'f4'],
      ['f5', 'f6'],
    ]);

    const result = planSwissRound(players, {
      pairingMethod: 'adjacent',
      grouping: { kind: 'scoreBands', boundaries },
    });
    expect(asPairs(result)).toEqual(['f1-f2', 'f3-f4', 'f5-f6']);
  });
});
