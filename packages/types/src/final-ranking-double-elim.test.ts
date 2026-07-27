import { describe, it, expect } from 'vitest';
import { computeFinalRanking, type RankingSlot } from './final-ranking';
import { POOL, mk, resetSlotIds } from './final-ranking-test-helpers';

/**
 * Double-elimination podium options and repechage cutoffs — the Slice 2
 * ranking surface. Classical gold-mode brackets are covered by
 * `final-ranking.test.ts`; these tests only assert what the options change.
 *
 * Pool standings throughout: a > e > g > c > f > h > b > d.
 */

// ── Bronze mode ──────────────────────────────────────────────────────────────

/**
 * 8 fighters, secondChanceTarget 'bronze'. wbRounds=3, lbRounds=3.
 * There is NO grand final: the WB final decides gold and silver, and the WB
 * final's loser never drops. Only WB rounds 1-2 feed the repechage.
 *
 *   WB R1 (1): a>b, c>d, e>f, g>h    WB R2 (2): a>c, e>g    WB F (3): a>e
 *   LB R1 (4): b>d, f>h              LB R2 (5): c>b, g>f
 *   LB R3 (6): c>g  ← the bronze match
 */
function buildBronze(withBronzeMatch = true): RankingSlot[] {
  resetSlotIds(200);
  const slots = [
    mk(1, 1, 'a', 5, 'b', 2),
    mk(1, 2, 'c', 5, 'd', 1),
    mk(1, 3, 'e', 5, 'f', 3),
    mk(1, 4, 'g', 5, 'h', 2),
    mk(2, 1, 'a', 5, 'c', 3),
    mk(2, 2, 'e', 5, 'g', 4),
    mk(3, 1, 'a', 5, 'e', 4),
    mk(4, 1, 'b', 5, 'd', 2),
    mk(4, 2, 'f', 5, 'h', 1),
    mk(5, 1, 'c', 5, 'b', 3),
    mk(5, 2, 'g', 5, 'f', 2),
  ];
  return withBronzeMatch ? [...slots, mk(6, 1, 'c', 5, 'g', 4)] : slots;
}

const BRONZE_SHAPE = {
  phaseType: 'double_elim' as const,
  wbRounds: 3,
  lbRounds: 3,
  secondChanceTarget: 'bronze' as const,
  bronzeMatch: true,
  repechageEntryRound: 1,
};

const NO_BRONZE_SHAPE = { ...BRONZE_SHAPE, lbRounds: 2, bronzeMatch: false };

describe('bronze mode', () => {
  it('reads gold and silver off the WINNERS-BRACKET final, not a grand final', () => {
    const ranking = computeFinalRanking(buildBronze(), POOL, null, BRONZE_SHAPE);
    expect(ranking[0]?.registrationId).toBe('a');
    expect(ranking[0]?.resultKind).toBe('champion');
    expect(ranking[1]?.registrationId).toBe('e');
    expect(ranking[1]?.resultKind).toBe('runnerUp');
  });

  it('awards 3rd to the bronze match WINNER and 4th to its loser', () => {
    const ranking = computeFinalRanking(buildBronze(), POOL, null, BRONZE_SHAPE);
    expect(ranking.map((e) => e.registrationId)).toEqual([
      'a', // won the WB final
      'e', // lost the WB final — silver outright, never drops
      'c', // won the bronze match
      'g', // lost the bronze match
      'f', // LB R2 losers by pool score (f 3.0 > b 2.0)
      'b',
      'h', // LB R1 losers (h 2.5 > d 1.0)
      'd',
    ]);
    expect(ranking[2]?.resultKind).toBe('third');
    expect(ranking[3]?.resultKind).toBe('fourth');
  });

  it('never leaves the silver medallist waiting on a repechage match', () => {
    // The WB-final loser takes silver directly, so `e` must be placed even
    // though they appear in no losers-bracket slot at all.
    const ranking = computeFinalRanking(buildBronze(), POOL, null, BRONZE_SHAPE);
    const e = ranking.find((x) => x.registrationId === 'e');
    expect(e?.place).toBe(2);
    expect(e?.bracketSection).toBeUndefined();
  });

  it('returns empty while the winners-bracket final is undecided', () => {
    const slots = buildBronze().filter((s) => s.round !== 3);
    expect(computeFinalRanking(slots, POOL, null, BRONZE_SHAPE)).toEqual([]);
  });

  it('still ranks 1st/2nd when the bronze match has not been played yet', () => {
    const slots = buildBronze(false);
    const ranking = computeFinalRanking(slots, POOL, null, BRONZE_SHAPE);
    expect(ranking[0]?.registrationId).toBe('a');
    expect(ranking[1]?.registrationId).toBe('e');
  });
});

describe('bronze mode with bronzeMatch: false', () => {
  /**
   * The repechage stops one round early and the two survivors are separated by
   * pool score — the same rule single elim already uses with its bronze match
   * off. g (pool 8) outranks c (pool 7), which is the OPPOSITE of the played
   * bronze match above, where c beat g. That contrast is the whole point of
   * the option.
   */
  it('ranks the two surviving repechage fighters 3rd/4th by pool score', () => {
    const ranking = computeFinalRanking(buildBronze(false), POOL, null, NO_BRONZE_SHAPE);
    expect(ranking.map((e) => e.registrationId)).toEqual([
      'a',
      'e',
      'g', // survived the repechage, pool 8
      'c', // survived the repechage, pool 7
      'f', // LB R2 losers
      'b',
      'h', // LB R1 losers
      'd',
    ]);
    expect(ranking[2]?.resultKind).toBe('third');
    expect(ranking[3]?.resultKind).toBe('fourth');
  });

  it('gives every fighter a unique place — never a shared bronze', () => {
    const ranking = computeFinalRanking(buildBronze(false), POOL, null, NO_BRONZE_SHAPE);
    expect(ranking.map((e) => e.place)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(ranking.map((e) => e.place)).size).toBe(ranking.length);
  });

  it('does not confuse the survivors with the fighters they beat', () => {
    // b and f LOST the last repechage round; they must land 5th/6th, below
    // the survivors, not be mistaken for them.
    const ranking = computeFinalRanking(buildBronze(false), POOL, null, NO_BRONZE_SHAPE);
    expect(ranking.find((e) => e.registrationId === 'f')?.place).toBe(5);
    expect(ranking.find((e) => e.registrationId === 'b')?.place).toBe(6);
  });
});

// ── Repechage cutoff ─────────────────────────────────────────────────────────

/**
 * 8 fighters with the second chance restricted to the last 4, so WB round 1
 * eliminates outright. wbRounds=3, repechageEntryRound=2, lbRounds=2.
 * (A scaled-down stand-in for the 8/16/32 cutoffs the UI offers — the ranking
 * only ever reads `repechageEntryRound`, so the arithmetic is identical.)
 *
 *   WB R1 (1): a>b, c>d, e>f, g>h   ← b, d, f, h are OUT on one loss
 *   WB R2 (2): a>c, e>g             ← c, g drop into the repechage
 *   WB F  (3): a>e                  ← e drops into the repechage
 *   LB R1 (4): c>g       LB R2 (5): e>c       GF (6): a>e
 */
function buildCutoff(): RankingSlot[] {
  resetSlotIds(300);
  return [
    mk(1, 1, 'a', 5, 'b', 2),
    mk(1, 2, 'c', 5, 'd', 1),
    mk(1, 3, 'e', 5, 'f', 3),
    mk(1, 4, 'g', 5, 'h', 2),
    mk(2, 1, 'a', 5, 'c', 3),
    mk(2, 2, 'e', 5, 'g', 4),
    mk(3, 1, 'a', 5, 'e', 4),
    mk(4, 1, 'c', 5, 'g', 3),
    mk(5, 1, 'e', 5, 'c', 3),
    mk(6, 1, 'a', 5, 'e', 3),
  ];
}

const CUTOFF_SHAPE = {
  phaseType: 'double_elim' as const,
  wbRounds: 3,
  lbRounds: 2,
  secondChanceTarget: 'gold' as const,
  repechageEntryRound: 2,
};

describe('repechage cutoff', () => {
  /**
   * The one case where a single winners-bracket loss IS final. Slice 1's rule
   * "a WB loss eliminates nobody" holds only without a cutoff; here rounds
   * before the cutoff eliminate outright and must be ranked by WB depth.
   */
  it('eliminates pre-cutoff winners-bracket losers on a single loss', () => {
    const ranking = computeFinalRanking(buildCutoff(), POOL, null, CUTOFF_SHAPE);
    expect(ranking.map((e) => e.registrationId)).toEqual([
      'a', // won the grand final
      'e', // lost the WB final, won the repechage, lost the GF
      'c', // lost the repechage final
      'g', // lost the first repechage round
      'f', // WB R1 losers — out on one loss, by pool score
      'h',
      'b',
      'd',
    ]);
  });

  it('marks pre-cutoff exits as winners-bracket, with the absolute WB round', () => {
    const ranking = computeFinalRanking(buildCutoff(), POOL, null, CUTOFF_SHAPE);
    for (const reg of ['f', 'h', 'b', 'd']) {
      const entry = ranking.find((e) => e.registrationId === reg)!;
      expect(entry.bracketSection).toBe('WB');
      expect(entry.eliminationRound).toBe(1);
    }
  });

  it('ranks every repechage exit above every pre-cutoff exit', () => {
    // g lost their FIRST repechage match and still finishes above f, who won
    // nothing after WB R1 — reaching the cutoff depth is worth more than a
    // good pool score.
    const ranking = computeFinalRanking(buildCutoff(), POOL, null, CUTOFF_SHAPE);
    const placeOf = (reg: string) => ranking.find((e) => e.registrationId === reg)!.place;
    const deepest = Math.max(...['c', 'g'].map(placeOf));
    const shallowest = Math.min(...['f', 'h', 'b', 'd'].map(placeOf));
    expect(deepest).toBeLessThan(shallowest);
  });

  it('leaves the no-cutoff ordering untouched', () => {
    // repechageEntryRound 1 (or absent) must reproduce Slice 1 exactly: no WB
    // slot contributes a placement.
    const noCutoff = { ...CUTOFF_SHAPE, repechageEntryRound: 1 };
    const ranking = computeFinalRanking(buildCutoff(), POOL, null, noCutoff);
    expect(ranking.some((e) => e.bracketSection === 'WB')).toBe(false);
    const absent = { ...CUTOFF_SHAPE, repechageEntryRound: null };
    expect(computeFinalRanking(buildCutoff(), POOL, null, absent)).toEqual(ranking);
  });

  it('puts play-in losers below even the pre-cutoff winners-bracket losers', () => {
    const slots = [...buildCutoff(), mk(0, 1, 'a', 5, 'x', 1)];
    const pool = [
      ...POOL,
      { registrationId: 'x', fighterName: 'X', clubAbbrev: null, poolScore: 9.5 },
    ];
    const ranking = computeFinalRanking(slots, pool, null, CUTOFF_SHAPE);
    // x has the second-best pool score in the field and still finishes last.
    expect(ranking[ranking.length - 1]?.registrationId).toBe('x');
    expect(ranking[ranking.length - 1]?.bracketSection).toBe('PLAYIN');
  });
});
