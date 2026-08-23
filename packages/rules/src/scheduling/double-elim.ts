/**
 * packages/rules/src/scheduling/double-elim.ts
 *
 * Double-elimination bracket generator.
 *
 * Pure function — no DB, no I/O. All sizing, validation and option-conflict
 * rules live in `double-elim-shape.ts`; this file assembles slots from the
 * resolved shape.
 *
 * Structure:
 *   Play-in (R0):         optional, trims the field to a power of two
 *   Winners Bracket (WB): log2(bracketSize) rounds
 *   Losers Bracket (LB):  the repechage — see `double-elim-shape.ts` for how a
 *                         cutoff and bronze mode re-index and truncate it
 *   Grand Final (GF):     1 slot   (gold mode only)
 *   Reset (optional):     1 slot   (gold mode only)
 *
 * Round numbering (absolute):
 *   Play-in:     0
 *   WB rounds:   1 .. wbRounds
 *   LB rounds:   (wbRounds+1) .. (wbRounds+lbRounds)
 *   GF:          wbRounds+lbRounds+1
 *   Reset:       wbRounds+lbRounds+2  (only if grandFinalReset=true)
 *
 * LB round pattern:
 *   LB-R1 (drop):   losers from WB round `repechageEntryRound` face each other
 *   LB-R2 (mixed):  LB survivors vs the next WB round's losers
 *   LB-R3 (consol): LB survivors consolidate
 *   LB-R4 (mixed):  LB survivors vs the next WB round's losers
 *   ... alternating consolidation and mixed rounds
 *
 * NO BYES. A double-elimination bracket cannot carry byes in WB-R1: the LB
 * feeds off `loser of WBR1Px`, and a bye match has no loser, so every LB slot
 * fed by a bye would sit unfilled forever and deadlock the whole losers
 * bracket. Non-power-of-two fields are therefore trimmed by a round-0 play-in
 * (the same model `singleElimBracket` uses) so WB-R1 is always full.
 *
 * The play-in is a single-elimination QUALIFIER: its losers are out after one
 * loss and do not enter the losers bracket. Surfaces that render a play-in
 * round must disclose this.
 */

import { resolveDoubleElimShape } from './double-elim-shape';
import {
  buildFinalsSlots,
  buildLosersSlots,
  buildPlayInSlots,
  buildWinnersSlots,
} from './double-elim-slots';
import type { DoubleElimSlot } from './double-elim-slots';

export {
  MAX_DOUBLE_ELIM_BRACKET_SIZE,
  resolveDoubleElimShape,
  isPowerOf2,
} from './double-elim-shape';
export type { DoubleElimOptions, DoubleElimShape, SecondChanceTarget } from './double-elim-shape';
export type { SlotSourceType, DoubleElimSlot } from './double-elim-slots';

import type { DoubleElimOptions, SecondChanceTarget } from './double-elim-shape';

export interface DoubleElimBracket {
  /** Main bracket size — always a power of two, always full. */
  bracketSize: number;
  /** Alias of `bracketSize`, mirroring `SingleElimBracket` so callers that
   *  read `mainBracketSize` work against either generator. */
  mainBracketSize: number;
  fighterCount: number;
  /** Always 0 — kept because `phases.config_json` and the FE still read it. */
  byeCount: number;
  /** Number of top seeds entering WB-R1 directly (0 when there is no play-in). */
  byeSeedCount: number;
  /** Number of play-in matches before the main bracket. */
  playInMatchCount: number;
  /** True when round-0 play-in slots are present. */
  hasPlayInRound: boolean;
  wbRounds: number;
  /** Losers-bracket rounds actually generated (after any bronze truncation). */
  lbRounds: number;
  /** Whether the losers bracket plays for gold or for bronze. */
  secondChanceTarget: SecondChanceTarget;
  /** Bronze mode only: is the last LB round a played bronze match? */
  bronzeMatch: boolean;
  /** Effective second-chance cutoff — equals `bracketSize` when unrestricted. */
  repechageEntrySize: number;
  /** First WB round whose losers drop into the LB (1 when unrestricted). */
  repechageEntryRound: number;
  /** Whether a conditional grand-final reset slot was emitted. */
  grandFinalReset: boolean;
  slots: DoubleElimSlot[];
}

/**
 * Generate a double-elimination bracket for N fighters.
 *
 * @param fighterCount  Number of qualified fighters
 * @param options       Podium model, repechage cutoff, sizing overrides
 * @returns             Complete bracket structure
 */
export function doubleElimBracket(
  fighterCount: number,
  options: DoubleElimOptions = {},
): DoubleElimBracket {
  const shape = resolveDoubleElimShape(fighterCount, options);
  const { bracketSize, byeSeedCount, hasPlayInRound, wbRounds, lbRounds } = shape;

  const slots: DoubleElimSlot[] = [
    ...buildPlayInSlots(fighterCount, byeSeedCount, shape.playInMatchCount),
    ...buildWinnersSlots(bracketSize, byeSeedCount, hasPlayInRound, wbRounds),
    ...buildLosersSlots(shape.repechageEntrySize, shape.repechageEntryRound, wbRounds, lbRounds),
    ...buildFinalsSlots(wbRounds, lbRounds, shape.grandFinalReset, shape.secondChanceTarget),
  ];

  return {
    bracketSize,
    mainBracketSize: bracketSize,
    fighterCount,
    byeCount: 0,
    byeSeedCount,
    playInMatchCount: shape.playInMatchCount,
    hasPlayInRound,
    wbRounds,
    lbRounds,
    secondChanceTarget: shape.secondChanceTarget,
    bronzeMatch: shape.bronzeMatch,
    repechageEntrySize: shape.repechageEntrySize,
    repechageEntryRound: shape.repechageEntryRound,
    grandFinalReset: shape.grandFinalReset,
    slots,
  };
}

/**
 * Total matches in a double-elimination bracket.
 *
 * Deliberately a CLOSED FORM rather than a slot count, so it independently
 * cross-checks the generator instead of restating it — the simulation test
 * asserts the two agree, which is what catches a mis-shaped ladder.
 *
 *   Play-in   playInMatchCount   (losers go out on one loss — additive, and
 *                                 outside the 2N-2 rule)
 *   WB        bracketSize - 1
 *   LB        K - 2, less 1 per bronze-mode truncation. A full repechage takes
 *             K - 1 entrants down to a single survivor.
 *   Finals    1 grand final (+1 reset), gold mode only.
 */
export function totalDoubleElimMatches(
  fighterCount: number,
  options: DoubleElimOptions = {},
): number {
  const shape = resolveDoubleElimShape(fighterCount, options);
  const truncation = shape.secondChanceTarget === 'bronze' ? (shape.bronzeMatch ? 1 : 2) : 0;
  const lbMatches = shape.repechageEntrySize - 2 - truncation;
  const finals = shape.secondChanceTarget === 'bronze' ? 0 : 1 + (shape.grandFinalReset ? 1 : 0);
  return shape.playInMatchCount + (shape.bracketSize - 1) + lbMatches + finals;
}
