import { describe, it, expect } from 'vitest';
import { computeFinalRanking, rankingBracketShape, type RankingSlot } from './final-ranking';
import { POOL, mk, poolEntry, resetSlotIds } from './final-ranking-test-helpers';

// 8-fighter single-elim: QF (round 1) → SF (round 2) → Final (round 3, pos 1)
// + Bronze (round 3, pos 2). Winner = higher score.
//   QF: a>b, c>d, e>f, g>h   SF: a>c, e>g   Final: a>e
// Pool scores: G (8) ranks above C (7) — so the no-bronze path puts G 3rd,
// while the bronze match (c>g) puts C 3rd. QF losers: f>h>b>d by pool score.
function buildSlots(): { slots: RankingSlot[]; bronzeId: string } {
  resetSlotIds(0);
  const slots = [
    mk(1, 1, 'a', 5, 'b', 2),
    mk(1, 2, 'c', 5, 'd', 1),
    mk(1, 3, 'e', 5, 'f', 3),
    mk(1, 4, 'g', 5, 'h', 2),
    mk(2, 1, 'a', 5, 'c', 3),
    mk(2, 2, 'e', 5, 'g', 4),
    mk(3, 1, 'a', 5, 'e', 2),
  ];
  const bronze = mk(3, 2, 'c', 5, 'g', 3, 'bronze');
  slots.push(bronze);
  return { slots, bronzeId: bronze.id };
}

describe('computeFinalRanking', () => {
  it('ranks champion, runner-up, bronze 3rd/4th, then earlier rounds by pool score', () => {
    const { slots, bronzeId } = buildSlots();
    const ranking = computeFinalRanking(slots, POOL, bronzeId);
    expect(ranking.map((r) => r.registrationId)).toEqual(['a', 'e', 'c', 'g', 'f', 'h', 'b', 'd']);
    expect(ranking.map((r) => r.place)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(ranking[0]?.resultKind).toBe('champion');
    expect(ranking[1]?.resultKind).toBe('runnerUp');
    expect(ranking[2]?.resultKind).toBe('third');
    expect(ranking[3]?.resultKind).toBe('fourth');
    expect(ranking[4]?.resultKind).toBe('round');
    expect(ranking[4]?.eliminationRound).toBe(1);
  });

  it('without a bronze match, separates the semi-final losers by pool score', () => {
    const { slots, bronzeId } = buildSlots();
    const noBronze = slots.filter((s) => s.id !== bronzeId);
    const ranking = computeFinalRanking(noBronze, POOL);
    expect(ranking.map((r) => r.registrationId)).toEqual(['a', 'e', 'g', 'c', 'f', 'h', 'b', 'd']);
    expect(ranking[2]?.eliminationRound).toBe(2);
    expect(ranking[3]?.eliminationRound).toBe(2);
  });

  it('appends pool fighters who never reached the bracket, ranked by pool score, below everyone', () => {
    const { slots, bronzeId } = buildSlots();
    // i + j competed in pools but didn't qualify. i has a HIGHER pool score than
    // several bracket fighters, yet must still rank below all of them.
    const pool = [...POOL, poolEntry('i', 4.0), poolEntry('j', 3.5)];
    const ranking = computeFinalRanking(slots, pool, bronzeId);
    expect(ranking.map((r) => r.registrationId)).toEqual([
      'a',
      'e',
      'c',
      'g',
      'f',
      'h',
      'b',
      'd',
      'i',
      'j',
    ]);
    expect(ranking[8]?.resultKind).toBe('pool');
    expect(ranking[8]?.registrationId).toBe('i');
    expect(ranking[9]?.resultKind).toBe('pool');
    expect(ranking.map((r) => r.place)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('returns an empty ranking when nothing is decided and no pool fighters', () => {
    expect(computeFinalRanking([], [])).toEqual([]);
    const undecided = buildSlots().slots.map((s) => ({ ...s, status: 'scheduled' }));
    // a–h are all bracket entrants → not appended; no completed matches → empty.
    expect(computeFinalRanking(undecided, POOL)).toEqual([]);
  });

  it('crowns the recorded winner over the higher score (keep-current forfeit)', () => {
    // Injury forfeit in the Final: A led 5-2 when they forfeited — the score
    // stays (keep_current policy) but winner_registration_id is E. The old
    // score-derived winner ranked the injured forfeiter champion.
    const { slots, bronzeId } = buildSlots();
    const forfeitFinal = slots.map((s) =>
      s.round === 3 && s.position === 1 ? { ...s, winnerRegistrationId: 'e' } : s,
    );
    const ranking = computeFinalRanking(forfeitFinal, POOL, bronzeId);
    expect(ranking[0]?.registrationId).toBe('e');
    expect(ranking[0]?.resultKind).toBe('champion');
    expect(ranking[1]?.registrationId).toBe('a');
    expect(ranking[1]?.resultKind).toBe('runnerUp');
  });

  it('resolves a 0-0 forfeit final via the recorded winner instead of returning empty', () => {
    // Forfeit before the first exchange: 0-0 score, winner recorded. The old
    // equal-score guard returned null → the whole ranking rendered empty.
    const { slots, bronzeId } = buildSlots();
    const zeroFinal = slots.map((s) =>
      s.round === 3 && s.position === 1
        ? { ...s, redScore: 0, blueScore: 0, winnerRegistrationId: 'e' }
        : s,
    );
    const ranking = computeFinalRanking(zeroFinal, POOL, bronzeId);
    expect(ranking[0]?.registrationId).toBe('e');
    expect(ranking[1]?.registrationId).toBe('a');
  });
});

// ── Double elimination ───────────────────────────────────────────────────────

// 8-fighter double elim. wbRounds=3, lbRounds=4 → WB 1-3, LB 4-7, GF 8, reset 9.
//   WB R1 (1): a>b, c>d, e>f, g>h      WB R2 (2): a>c, e>g      WB F (3): a>e
//   LB R1 (4): b>d, f>h                LB R2 (5): c>b, g>f
//   LB R3 (6): c>g                     LB F  (7): e>c
// Every WB loser drops to the LB, so nobody is eliminated by a WB loss.
const DE_SHAPE = { phaseType: 'double_elim' as const, wbRounds: 3, lbRounds: 4 };

function buildDoubleElim(gfWinnerIsWb = true): RankingSlot[] {
  resetSlotIds(100);
  return [
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
    mk(6, 1, 'c', 5, 'g', 4),
    mk(7, 1, 'e', 5, 'c', 3),
    gfWinnerIsWb ? mk(8, 1, 'a', 5, 'e', 3) : mk(8, 1, 'e', 5, 'a', 3),
  ];
}

describe('computeFinalRanking — double elimination', () => {
  it('places fighters by their LOSERS-bracket exit, not their winners-bracket loss', () => {
    const ranking = computeFinalRanking(buildDoubleElim(), POOL, null, DE_SHAPE);
    expect(ranking.map((e) => e.registrationId)).toEqual([
      'a', // champion — won the grand final
      'e', // runner-up — lost the WB final, won the LB, lost the GF
      'c', // 3rd — lost the LB final
      'g', // 4th — lost LB R3
      'f', // LB R2 losers, separated by pool score (f 3.0 > b 2.0)
      'b',
      'h', // LB R1 losers (h 2.5 > d 1.0)
      'd',
    ]);
  });

  it('does not eliminate anyone at a winners-bracket loss', () => {
    // b lost in WB round 1 — under the single-elim ordering that put them
    // last. In double elim they get a second life and finish 6th.
    const ranking = computeFinalRanking(buildDoubleElim(), POOL, null, DE_SHAPE);
    const b = ranking.find((e) => e.registrationId === 'b');
    expect(b?.place).toBe(6);
    expect(b?.bracketSection).toBe('LB');
    // LB-relative round, not the absolute round 5.
    expect(b?.eliminationRound).toBe(2);
  });

  it('labels the LB-final and LB-semi losers as the podium places', () => {
    const ranking = computeFinalRanking(buildDoubleElim(), POOL, null, DE_SHAPE);
    expect(ranking[2]?.resultKind).toBe('third');
    expect(ranking[3]?.resultKind).toBe('fourth');
  });

  /**
   * The regression this fix exists for. The reset slot is generated whenever
   * the option is on, but is only PLAYED when the losers-bracket entrant wins
   * the grand final. Reading the highest round found an unplayed reset, so
   * winnerLoser() returned null and the ENTIRE ranking came back empty —
   * taking the podium, league standings and career placements with it.
   */
  it('ranks normally when an enabled reset was never played', () => {
    const slots = [...buildDoubleElim(), { ...mk(9, 1, 'e', 0, 'a', 0), status: 'scheduled' }];
    const ranking = computeFinalRanking(slots, POOL, null, DE_SHAPE);
    expect(ranking.length).toBe(8);
    expect(ranking[0]?.registrationId).toBe('a');
    expect(ranking[1]?.registrationId).toBe('e');
  });

  it('crowns the reset winner when the reset WAS played', () => {
    // LB entrant e wins the GF, forcing a reset; a wins the reset.
    const slots = [...buildDoubleElim(false), mk(9, 1, 'a', 5, 'e', 4)];
    const ranking = computeFinalRanking(slots, POOL, null, DE_SHAPE);
    expect(ranking[0]?.registrationId).toBe('a');
    expect(ranking[1]?.registrationId).toBe('e');
  });

  it('returns empty while the grand final is undecided', () => {
    const slots = buildDoubleElim().filter((s) => s.round !== 8);
    expect(computeFinalRanking(slots, POOL, null, DE_SHAPE)).toEqual([]);
  });

  it('places play-in losers below every main-bracket fighter', () => {
    // Two extra fighters knocked out in a round-0 qualifier.
    const slots = [...buildDoubleElim(), mk(0, 1, 'a', 5, 'x', 1), mk(0, 2, 'b', 5, 'y', 2)];
    const pool = [...POOL, poolEntry('x', 0.5), poolEntry('y', 0.4)];
    const ranking = computeFinalRanking(slots, pool, null, DE_SHAPE);
    const tail = ranking.slice(-2);
    expect(tail.map((e) => e.registrationId).sort()).toEqual(['x', 'y']);
    expect(tail.every((e) => e.bracketSection === 'PLAYIN')).toBe(true);
  });
});

describe('computeFinalRanking — Swiss', () => {
  const SWISS = { phaseType: 'swiss' as const };

  /** Swiss standings arrive already ranked by the configured tiebreak chain. */
  const standings = [poolEntry('a', 0), poolEntry('b', 0), poolEntry('c', 0), poolEntry('d', 0)];

  it('takes the standings order as given — no slots to read', () => {
    const ranking = computeFinalRanking([], standings, null, SWISS);
    expect(ranking.map((e) => e.registrationId)).toEqual(['a', 'b', 'c', 'd']);
    expect(ranking.map((e) => e.place)).toEqual([1, 2, 3, 4]);
  });

  it('awards the podium kinds, then `swiss` below fourth', () => {
    const ranking = computeFinalRanking(
      [],
      [...standings, poolEntry('e', 0), poolEntry('f', 0)],
      null,
      SWISS,
    );
    expect(ranking.map((e) => e.resultKind)).toEqual([
      'champion',
      'runnerUp',
      'third',
      'fourth',
      'swiss',
      'swiss',
    ]);
  });

  it('does NOT use the `pool` kind, which would sink every fighter to the tail', () => {
    // `pool` means "never reached the bracket" and sorts below all bracket
    // entrants. A Swiss champion is not that.
    const ranking = computeFinalRanking([], standings, null, SWISS);
    expect(ranking.some((e) => e.resultKind === 'pool')).toBe(false);
  });

  it('ranks a Swiss phase even though it has no slots at all', () => {
    // The single-elim path returns [] when it cannot decide; Swiss must not.
    expect(computeFinalRanking([], standings, null, SWISS)).toHaveLength(4);
  });

  it('returns nothing for an empty field rather than throwing', () => {
    expect(computeFinalRanking([], [], null, SWISS)).toEqual([]);
  });

  it('is not reachable by accident — an unknown phase type still reads single-elim', () => {
    resetSlotIds();
    const slots: RankingSlot[] = [mk(1, 1, 'a', 5, 'b', 3)];
    const ranking = computeFinalRanking(slots, POOL, null, { phaseType: 'single_elim' });
    expect(ranking[0]?.resultKind).toBe('champion');
    expect(ranking.some((e) => e.resultKind === 'swiss')).toBe(false);
  });
});

describe('rankingBracketShape', () => {
  it('carries swiss through instead of coercing it to single_elim', () => {
    // The coercion this replaces meant a Swiss phase was ranked as if a loss
    // eliminated the fighter — from a bracket it does not have.
    expect(rankingBracketShape({ phaseType: 'swiss' }).phaseType).toBe('swiss');
  });

  it('still defaults an unknown or missing phase type to single_elim', () => {
    // Legacy phases with no recorded shape must keep reading as single-elim.
    expect(rankingBracketShape({ phaseType: null }).phaseType).toBe('single_elim');
    expect(rankingBracketShape({}).phaseType).toBe('single_elim');
    expect(rankingBracketShape({ phaseType: 'something_else' }).phaseType).toBe('single_elim');
  });

  it('still recognises double_elim', () => {
    expect(rankingBracketShape({ phaseType: 'double_elim' }).phaseType).toBe('double_elim');
  });
});
