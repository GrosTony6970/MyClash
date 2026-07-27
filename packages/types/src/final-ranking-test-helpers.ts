/**
 * Shared fixtures for the final-ranking test suites, so `final-ranking.test.ts`
 * (single elim + classical double elim) and
 * `final-ranking-double-elim.test.ts` (podium options + repechage cutoffs)
 * rank the same eight fighters with the same pool scores. The pool scores are
 * what every tiebreak reads, so they must not drift between the two files.
 */

import type { PoolEntry, RankingSlot } from './final-ranking';

let seq = 0;

export function resetSlotIds(from = 0): void {
  seq = from;
}

export function mk(
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

export function poolEntry(reg: string, score: number): PoolEntry {
  return {
    registrationId: reg,
    fighterName: reg.toUpperCase(),
    clubAbbrev: null,
    poolScore: score,
  };
}

/** Pool standings: a > e > g > c > f > h > b > d. */
export const POOL: PoolEntry[] = [
  poolEntry('a', 10),
  poolEntry('e', 9),
  poolEntry('g', 8),
  poolEntry('c', 7),
  poolEntry('f', 3.0),
  poolEntry('h', 2.5),
  poolEntry('b', 2.0),
  poolEntry('d', 1.0),
];
