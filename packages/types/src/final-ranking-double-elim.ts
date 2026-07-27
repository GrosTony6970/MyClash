/**
 * Double-elimination final ordering.
 *
 * Split out of `final-ranking.ts` because the double-elim rules are genuinely
 * different in kind from single-elim, not just in degree — but it shares the
 * same `Ranking` accumulator and the same `winnerLoser` rule, so the two
 * orderings can never disagree about who won a match or how ties break.
 *
 * ── Order ────────────────────────────────────────────────────────────────────
 *
 *   1st / 2nd
 *     GOLD mode   the last PLAYED grand final. The reset slot exists whenever
 *                 the option is on but is only played when the losers-bracket
 *                 entrant wins the first grand final, so an unplayed reset must
 *                 fall back to the grand final rather than reading as an
 *                 undecided bracket.
 *     BRONZE mode the winners-bracket FINAL. There is no grand final at all —
 *                 the WB final decides gold and silver on its own.
 *
 *   3rd / 4th
 *     GOLD mode   fall out of the losers grouping below (LB final loser is
 *                 3rd, LB semi loser is 4th) — no special-casing needed.
 *     BRONZE mode the bronze match's winner and loser. With `bronzeMatch:
 *                 false` the repechage stopped a round early, so it is the two
 *                 surviving winners of the last losers round, separated by pool
 *                 score. Never a shared third place.
 *
 *   then  eliminated by LOSING IN THE LOSERS BRACKET, deepest LB round first.
 *
 *   then  eliminated in a PRE-CUTOFF winners-bracket round, deepest WB round
 *         first. Normally empty: without a repechage cutoff a WB loss
 *         eliminates nobody, because the fighter drops into the LB and may
 *         still finish anywhere from 3rd to last. A cutoff is the one thing
 *         that makes a WB loss final, and only for the rounds before it.
 *
 *   then  play-in (round 0) losers — a single-elim qualifier, out on one loss.
 *
 * Pure: no React, no I/O.
 */

import {
  losersByRound,
  winnerLoser,
  type Ranking,
  type RankingBracketShape,
  type RankingSlot,
  type Side,
} from './final-ranking-core';

/** The derived round numbers this ordering needs, with legacy-safe defaults. */
interface DoubleElimLayout {
  wbRounds: number;
  lbRounds: number;
  isBronze: boolean;
  bronzeMatch: boolean;
  /** Losers of WB rounds 1..(entryRound-1) are out on a single loss. */
  entryRound: number;
  lastLbRound: number;
}

function readLayout(shape: RankingBracketShape): DoubleElimLayout {
  const wbRounds = shape.wbRounds ?? 0;
  const lbRounds = shape.lbRounds ?? 0;
  const isBronze = shape.secondChanceTarget === 'bronze';
  return {
    wbRounds,
    lbRounds,
    isBronze,
    // Only meaningful in bronze mode; defaults to a played bronze match.
    bronzeMatch: isBronze ? shape.bronzeMatch !== false : false,
    // A legacy phase with no cutoff recorded gave everyone a second chance.
    entryRound: shape.repechageEntryRound ?? 1,
    lastLbRound: wbRounds + lbRounds,
  };
}

/**
 * Place 1st and 2nd. Returns false when the deciding match has not been played
 * — the ranking is meaningless mid-bracket, because every later placement
 * would be numbered wrong.
 */
function placeTitle(slots: RankingSlot[], layout: DoubleElimLayout, r: Ranking): boolean {
  const at = (round: number) => slots.find((s) => s.round === round && s.position === 1) ?? null;

  let deciding: RankingSlot | null;
  if (layout.isBronze) {
    deciding = at(layout.wbRounds);
  } else {
    const gfRound = layout.lastLbRound + 1;
    // Reset first, but only if it was actually PLAYED: reading the highest
    // round unconditionally would find an unplayed reset and report the whole
    // tournament as undecided.
    const reset = at(gfRound + 1);
    deciding = reset && winnerLoser(reset) ? reset : at(gfRound);
  }

  const wl = deciding ? winnerLoser(deciding) : null;
  if (!wl) return false;
  r.push(wl.winner, 'champion');
  r.push(wl.loser, 'runnerUp');
  return true;
}

/**
 * Bronze mode's 3rd/4th. In gold mode these fall out of the losers grouping,
 * so this does nothing there.
 */
function placeBronzePodium(slots: RankingSlot[], layout: DoubleElimLayout, r: Ranking): void {
  if (!layout.isBronze) return;
  const lastRound = slots.filter((s) => s.round === layout.lastLbRound);

  if (layout.bronzeMatch) {
    const wl = winnerLoser(lastRound[0] ?? ({} as RankingSlot));
    if (!wl) return;
    r.push(wl.winner, 'third');
    r.push(wl.loser, 'fourth');
    return;
  }

  // No bronze match: the two fighters still unbeaten in the repechage are 3rd
  // and 4th, separated by pool score then name — the same rule single elim
  // uses with its bronze match off. Their LOSERS fall into the normal grouping
  // below and land 5th/6th.
  const survivors: Side[] = [];
  for (const slot of lastRound) {
    const wl = winnerLoser(slot);
    if (wl) survivors.push(wl.winner);
  }
  for (const side of survivors.sort(r.byPoolScore)) {
    r.push(side, r.entries.length === 2 ? 'third' : 'fourth');
  }
}

/** Losers-bracket exits, deepest round first. */
function placeLosersBracket(slots: RankingSlot[], layout: DoubleElimLayout, r: Ranking): void {
  const lbSlots = slots.filter((s) => s.round > layout.wbRounds && s.round <= layout.lastLbRound);
  const byRound = losersByRound(lbSlots, r);
  for (const round of [...byRound.keys()].sort((a, b) => b - a)) {
    r.pushRound(
      byRound.get(round)!,
      { eliminationRound: round - layout.wbRounds, bracketSection: 'LB' },
      // Gold mode's LB final / LB semi losers ARE 3rd and 4th. Bronze mode has
      // already placed its podium, so the flag would be inert there anyway.
      !layout.isBronze,
    );
  }
}

/**
 * Winners-bracket exits before the repechage cutoff — the one case where a
 * single WB loss is final. Ranks below everyone the repechage eliminated: an
 * LB-R1 loser reached the round of K in the winners bracket, deeper than
 * anyone who never got there.
 */
function placePreCutoffWinners(slots: RankingSlot[], layout: DoubleElimLayout, r: Ranking): void {
  if (layout.entryRound <= 1) return;
  const preCutoff = slots.filter((s) => s.round >= 1 && s.round < layout.entryRound);
  const byRound = losersByRound(preCutoff, r);
  for (const round of [...byRound.keys()].sort((a, b) => b - a)) {
    r.pushRound(byRound.get(round)!, { eliminationRound: round, bracketSection: 'WB' });
  }
}

export function orderDoubleElim(
  slots: RankingSlot[],
  shape: RankingBracketShape,
  r: Ranking,
): boolean {
  const layout = readLayout(shape);
  if (!placeTitle(slots, layout, r)) return false;

  placeBronzePodium(slots, layout, r);
  placeLosersBracket(slots, layout, r);
  placePreCutoffWinners(slots, layout, r);

  // Play-in losers went out on a single loss — below everyone who reached the
  // main bracket, above fighters who never made the bracket at all.
  const playIn = losersByRound(
    slots.filter((s) => s.round === 0),
    r,
  );
  for (const side of (playIn.get(0) ?? []).sort(r.byPoolScore)) {
    r.push(side, 'round', { eliminationRound: 0, bracketSection: 'PLAYIN' });
  }
  return true;
}
