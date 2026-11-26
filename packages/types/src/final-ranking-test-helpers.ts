/**
 * Shared fixtures for the final-ranking test suites, so `final-ranking.test.ts`
 * (single elim + classical double elim) and
 * `final-ranking-double-elim.test.ts` (podium options + repechage cutoffs)
 * rank the same eight fighters with the same pool scores. The pool scores are
 * what every tiebreak reads, so they must not drift between the two files.
 */

import type { BracketSideWire } from './bracket-side';
import type { PoolEntry, RankingSlot } from './final-ranking';

let seq = 0;

export function resetSlotIds(from = 0): void {
  seq = from;
}

/** A Fighter's side of a slot: the side key is the Registration id, named in capitals. */
export function fighterSide(reg: string): BracketSideWire {
  return {
    sideId: reg,
    kind: 'individual',
    registrationId: reg,
    teamId: null,
    name: reg.toUpperCase(),
    clubAbbrev: null,
    colour: null,
  };
}

/** A team's side of a slot: the side key is the team id. */
export function teamSide(team: string, colour: string | null = null): BracketSideWire {
  return {
    sideId: team,
    kind: 'team',
    registrationId: null,
    teamId: team,
    name: team.toUpperCase(),
    clubAbbrev: null,
    colour,
  };
}

/** A completed slot between two sides, each a Fighter unless given as a team's side. */
export function mk(
  round: number,
  position: number,
  red: string | BracketSideWire,
  redScore: number,
  blue: string | BracketSideWire,
  blueScore: number,
  id?: string,
): RankingSlot {
  const redSide = typeof red === 'string' ? fighterSide(red) : red;
  const blueSide = typeof blue === 'string' ? fighterSide(blue) : blue;
  return {
    id: id ?? `slot-${seq++}`,
    round,
    position,
    status: 'completed',
    redSideId: redSide.sideId,
    blueSideId: blueSide.sideId,
    winnerSideId: null,
    red: redSide,
    blue: blueSide,
    redScore,
    blueScore,
  };
}

export function poolEntry(reg: string, score: number): PoolEntry {
  return {
    entrantId: reg,
    kind: 'individual',
    fighterName: reg.toUpperCase(),
    clubAbbrev: null,
    colour: null,
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
