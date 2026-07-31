/**
 * Final-ranking computation for an elimination bracket — shared by the admin
 * Final ranking page, the public tournament page, and the API (fighter career
 * placements, league standings) so every surface renders the exact same order.
 * Adds a pool-score tiebreak, and a tail of everyone who competed in the pools
 * but didn't reach the bracket.
 *
 * SINGLE ELIMINATION order:
 *   1. Champion  = winner of the Final
 *   2. Runner-up = loser of the Final
 *   3rd / 4th    = winner / loser of the Bronze (3rd-place) match, when one
 *                  exists; otherwise the two Semi-final losers, ranked by pool
 *                  score (so the rule "separate same-phase fighters by pool
 *                  score" still applies when there's no playoff).
 *   then         = the losers of each earlier round, grouped by the round they
 *                  were eliminated in (deepest first), and WITHIN a round
 *                  ordered by pool score (descending), name as a stable
 *                  fallback.
 *
 * DOUBLE ELIMINATION order lives in `final-ranking-double-elim.ts` — it varies
 * with the podium model and the repechage cutoff, so it needs the room. Both
 * orderings share `Ranking` and `winnerLoser` from `final-ranking-core.ts`, so
 * they cannot disagree about who won a match or how ties break.
 *
 * Winner of a match is the recorded `winnerRegistrationId` when present —
 * forfeits and black cards can complete a match with the LOWER score winning
 * (e.g. an injury forfeit keeps the current 5-3 but awards the opponent).
 * Score comparison is only the fallback for slots without a recorded winner.
 * Pure: no React, no I/O.
 */

import {
  Ranking,
  losersByRound,
  winnerLoser,
  type FinalRankingEntry,
  type FinalRankingResultKind,
  type PoolEntry,
  type RankingBracketShape,
  type RankingSlot,
} from './final-ranking-core';
import { orderDoubleElim } from './final-ranking-double-elim';

export type {
  FinalRankingBracketSection,
  FinalRankingEntry,
  FinalRankingResultKind,
  PoolEntry,
  RankingBracketShape,
  RankingSlot,
  SecondChanceTarget,
} from './final-ranking-core';

function orderSingleElim(slots: RankingSlot[], bronzeSlotId: string | null, r: Ranking): boolean {
  const maxRound = slots.reduce((m, s) => Math.max(m, s.round), 0);
  const bronzeSlot = bronzeSlotId
    ? (slots.find((s) => s.id === bronzeSlotId) ?? null)
    : (slots.find((s) => s.round === maxRound && s.position === 2) ?? null);

  // Main bracket = everything but the bronze/consolation slot, so each fighter
  // loses at most once and the Final is the only match at maxRound.
  const mainSlots = bronzeSlot ? slots.filter((s) => s.id !== bronzeSlot.id) : slots;
  const finalSlot =
    mainSlots.find((s) => s.round === maxRound && s.position === 1) ??
    mainSlots.find((s) => s.round === maxRound) ??
    null;

  // The ranking is only meaningful once the Final is decided — until then the
  // bracket is mid-play and earlier-round placements (and the non-bracket tail)
  // would be numbered wrong. 1st / 2nd come from the Final.
  const finalWl = finalSlot ? winnerLoser(finalSlot) : null;
  if (!finalWl) return false;
  r.push(finalWl.winner, 'champion');
  r.push(finalWl.loser, 'runnerUp');

  // 3rd / 4th — the Bronze match decides when present.
  if (bronzeSlot) {
    const wl = winnerLoser(bronzeSlot);
    if (wl) {
      r.push(wl.winner, 'third');
      r.push(wl.loser, 'fourth');
    }
  }

  // Everyone else in the bracket: grouped by the round they lost in (the Final
  // is already handled). With a bronze match the Semi-final losers are already
  // placed (3rd/4th) and skipped here; without one they fall into the
  // maxRound-1 group and get separated by pool score.
  const byRound = losersByRound(
    mainSlots.filter((s) => s.round !== maxRound),
    r,
  );
  for (const round of [...byRound.keys()].sort((a, b) => b - a)) {
    r.pushRound(byRound.get(round)!, { eliminationRound: round });
  }
  return true;
}

/**
 * Build the shape argument from a `getTournamentBracket()`-style payload, so
 * every call site derives it identically instead of hand-casting `phaseType`.
 * Anything that isn't explicitly `double_elim` reads as single-elim, which is
 * the safe default for legacy phases with no shape recorded.
 */
export function rankingBracketShape(bracket: {
  phaseType?: string | null;
  wbRounds?: number | null;
  lbRounds?: number | null;
  secondChanceTarget?: string | null;
  bronzeMatch?: boolean | null;
  repechageEntryRound?: number | null;
}): RankingBracketShape {
  return {
    phaseType:
      bracket.phaseType === 'double_elim'
        ? 'double_elim'
        : // A Swiss phase has no bracket at all, so it must NOT fall through to
          // the single-elim default the way an unrecorded legacy shape does.
          bracket.phaseType === 'swiss'
          ? 'swiss'
          : 'single_elim',
    wbRounds: bracket.wbRounds ?? null,
    lbRounds: bracket.lbRounds ?? null,
    // Phases generated before the podium options shipped carry neither field;
    // both defaults reproduce the classical bracket they were built as.
    secondChanceTarget: bracket.secondChanceTarget === 'bronze' ? 'bronze' : 'gold',
    bronzeMatch: bracket.bronzeMatch ?? null,
    repechageEntryRound: bracket.repechageEntryRound ?? null,
  };
}

export function computeFinalRanking(
  slots: RankingSlot[],
  poolEntries: PoolEntry[],
  bronzeSlotId?: string | null,
  bracket?: RankingBracketShape | null,
): FinalRankingEntry[] {
  const r = new Ranking(poolEntries);

  // Every registration that appears anywhere in the bracket — used to keep the
  // non-bracket tail (pool-only fighters) strictly below all bracket entrants,
  // even bracket fighters not yet placed (an in-progress bracket).
  const bracketRegIds = new Set<string>();
  for (const s of slots) {
    if (s.redRegistrationId) bracketRegIds.add(s.redRegistrationId);
    if (s.blueRegistrationId) bracketRegIds.add(s.blueRegistrationId);
  }

  // Swiss has no slots to read: the standings ARE the result.
  if (bracket?.phaseType === 'swiss') return orderSwiss(poolEntries, r);

  const decided =
    bracket?.phaseType === 'double_elim'
      ? orderDoubleElim(slots, bracket, r)
      : orderSingleElim(slots, bronzeSlotId ?? null, r);
  if (!decided) return [];

  // Tail: everyone who competed in the pools but never reached the bracket,
  // ranked by pool score. Kept strictly below all bracket entrants.
  const nonBracket = poolEntries
    .filter((e) => !bracketRegIds.has(e.registrationId) && !r.has(e.registrationId))
    .sort(r.byPoolScore);
  for (const e of nonBracket) {
    r.push(
      { registrationId: e.registrationId, fighterName: e.fighterName, clubAbbrev: e.clubAbbrev },
      'pool',
    );
  }

  return r.entries;
}

/**
 * Swiss ordering: the standings order, taken as given.
 *
 * They arrive already ranked by the phase's configured tiebreak chain, so
 * there is nothing left to decide. Deliberately NOT the `pool` tail path — that
 * kind means "never reached the bracket" and sorts every entry beneath any
 * bracket entrant, which would place a Swiss champion below a fighter who lost
 * their first bout.
 */
function orderSwiss(standings: PoolEntry[], r: Ranking): FinalRankingEntry[] {
  for (const entry of standings) {
    r.push(
      {
        registrationId: entry.registrationId,
        fighterName: entry.fighterName,
        clubAbbrev: entry.clubAbbrev,
      },
      swissResultKind(r.entries.length),
    );
  }
  return r.entries;
}

/**
 * The podium kinds still apply to a Swiss phase that decides its own winner —
 * a medal is a medal however it was won — and everyone below fourth is 'swiss'
 * rather than 'round', since nobody was eliminated in a round.
 */
function swissResultKind(placedSoFar: number): FinalRankingResultKind {
  if (placedSoFar === 0) return 'champion';
  if (placedSoFar === 1) return 'runnerUp';
  if (placedSoFar === 2) return 'third';
  if (placedSoFar === 3) return 'fourth';
  return 'swiss';
}
