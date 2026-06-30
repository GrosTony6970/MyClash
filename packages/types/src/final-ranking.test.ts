import { describe, it, expect } from 'vitest';
import { computeFinalRanking, type PoolEntry, type RankingSlot } from './final-ranking';

let seq = 0;
function mk(
  round: number,
  position: number,
  red: string,
  redScore: number,
  blue: string,
  blueScore: number,
  id?: string,
): RankingSlot {
  return {
    id: id ?? `slot-${seq++}`,
    round,
    position,
    status: 'completed',
    redRegistrationId: red,
    blueRegistrationId: blue,
    redFighterName: red.toUpperCase(),
    blueFighterName: blue.toUpperCase(),
    redClubAbbrev: null,
    blueClubAbbrev: null,
    redScore,
    blueScore,
  };
}

// 8-fighter single-elim: QF (round 1) → SF (round 2) → Final (round 3, pos 1)
// + Bronze (round 3, pos 2). Winner = higher score.
//   QF: a>b, c>d, e>f, g>h   SF: a>c, e>g   Final: a>e
// Pool scores: G (8) ranks above C (7) — so the no-bronze path puts G 3rd,
// while the bronze match (c>g) puts C 3rd. QF losers: f>h>b>d by pool score.
function buildSlots(): { slots: RankingSlot[]; bronzeId: string } {
  seq = 0;
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

function poolEntry(reg: string, score: number): PoolEntry {
  return {
    registrationId: reg,
    fighterName: reg.toUpperCase(),
    clubAbbrev: null,
    poolScore: score,
  };
}

const POOL: PoolEntry[] = [
  poolEntry('a', 10),
  poolEntry('e', 9),
  poolEntry('g', 8),
  poolEntry('c', 7),
  poolEntry('f', 3.0),
  poolEntry('h', 2.5),
  poolEntry('b', 2.0),
  poolEntry('d', 1.0),
];

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
});
