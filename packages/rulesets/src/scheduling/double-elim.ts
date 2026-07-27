/**
 * packages/rulesets/src/scheduling/double-elim.ts
 *
 * Double-elimination bracket generator.
 *
 * Pure function — no DB, no I/O.
 *
 * Structure:
 *   Play-in (R0):         optional, trims the field to a power of two
 *   Winners Bracket (WB): log2(bracketSize) rounds
 *   Losers Bracket (LB):  2 * (log2(bracketSize) - 1) rounds
 *   Grand Final (GF):     1 slot
 *   Reset (optional):     1 slot
 *
 * Round numbering (absolute):
 *   Play-in:     0
 *   WB rounds:   1 .. wbRounds
 *   LB rounds:   (wbRounds+1) .. (wbRounds+lbRounds)
 *   GF:          wbRounds+lbRounds+1
 *   Reset:       wbRounds+lbRounds+2  (only if grandFinalReset=true)
 *
 * LB round pattern:
 *   LB-R1 (drop):   losers from WB-R1 face each other
 *   LB-R2 (mixed):  LB survivors vs WB-R2 losers
 *   LB-R3 (consol): LB survivors consolidate
 *   LB-R4 (mixed):  LB survivors vs WB-R3 losers
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

import {
  buildFinalsSlots,
  buildLosersSlots,
  buildPlayInSlots,
  buildWinnersSlots,
} from './double-elim-slots';
import type { DoubleElimSlot } from './double-elim-slots';

export type { SlotSourceType, DoubleElimSlot } from './double-elim-slots';

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
  lbRounds: number;
  slots: DoubleElimSlot[];
}

export interface DoubleElimOptions {
  /**
   * Override the main bracket size. Must be a power of 2.
   *
   * Unlike single-elim, it may NOT exceed `fighterCount`: a bracket larger
   * than the field can only be filled with byes, which deadlocks the losers
   * bracket. Cutting DOWN to a smaller bracket is allowed (the surplus
   * fighters play a round-0 play-in), bounded by
   * `fighterCount <= 2 * bracketSize` so the play-in fits in one round.
   */
  bracketSize?: number;
  /** Whether to include a grand final reset slot. Default: false. */
  grandFinalReset?: boolean;
}

export const MAX_DOUBLE_ELIM_BRACKET_SIZE = 128;

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPowerOf2(n: number): boolean {
  return n >= 1 && (n & (n - 1)) === 0;
}

/** Highest power of 2 strictly below n. */
function highestPowerOf2Below(n: number): number {
  let p = 1;
  while (p * 2 < n) p <<= 1;
  return p;
}

/** Resolve the main bracket size, validating any explicit override. */
function resolveBracketSize(fighterCount: number, options: DoubleElimOptions): number {
  if (options.bracketSize === undefined) {
    return isPowerOf2(fighterCount) ? fighterCount : highestPowerOf2Below(fighterCount);
  }

  const bracketSize = options.bracketSize;
  if (bracketSize < 2 || !isPowerOf2(bracketSize)) {
    throw new Error(`bracketSize must be a power of 2 (got ${bracketSize})`);
  }
  if (bracketSize > fighterCount) {
    throw new Error(
      `bracketSize (${bracketSize}) must be <= fighterCount (${fighterCount}) — ` +
        'double elimination requires a full bracket, because byes in the winners ' +
        'bracket leave the losers bracket unfillable',
    );
  }
  if (fighterCount > bracketSize * 2) {
    throw new Error(
      `fighterCount (${fighterCount}) must be <= 2 x bracketSize (${bracketSize}) — ` +
        'the play-in round cannot absorb more than one extra fighter per seat',
    );
  }
  return bracketSize;
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Generate a double-elimination bracket for N fighters.
 *
 * @param fighterCount  Number of qualified fighters
 * @param options       Optional overrides
 * @returns             Complete bracket structure
 */
export function doubleElimBracket(
  fighterCount: number,
  options: DoubleElimOptions = {},
): DoubleElimBracket {
  if (fighterCount < 2) throw new Error('Need at least 2 fighters for a bracket');

  const bracketSize = resolveBracketSize(fighterCount, options);

  if (bracketSize > MAX_DOUBLE_ELIM_BRACKET_SIZE) {
    throw new Error(`bracketSize must be <= ${MAX_DOUBLE_ELIM_BRACKET_SIZE} (got ${bracketSize})`);
  }

  const playInMatchCount = fighterCount - bracketSize;
  const hasPlayInRound = playInMatchCount > 0;
  // Top seeds that skip the play-in and enter WB-R1 directly.
  const byeSeedCount = hasPlayInRound ? bracketSize - playInMatchCount : 0;
  const wbRounds = Math.log2(bracketSize);
  const lbRounds = 2 * (wbRounds - 1);

  const slots: DoubleElimSlot[] = [
    ...buildPlayInSlots(fighterCount, byeSeedCount, playInMatchCount),
    ...buildWinnersSlots(bracketSize, byeSeedCount, hasPlayInRound, wbRounds),
    ...buildLosersSlots(bracketSize, wbRounds, lbRounds),
    ...buildFinalsSlots(wbRounds, lbRounds, options.grandFinalReset === true),
  ];

  return {
    bracketSize,
    mainBracketSize: bracketSize,
    fighterCount,
    byeCount: 0,
    byeSeedCount,
    playInMatchCount,
    hasPlayInRound,
    wbRounds,
    lbRounds,
    slots,
  };
}

/**
 * Total matches in a double-elimination bracket.
 *
 * The main bracket is 2*bracketSize - 2 (every fighter but the champion is
 * eliminated by a second loss, and the champion may concede one). Play-in
 * matches are additive: their losers go out after a single loss, so they do
 * NOT follow the 2N-2 rule that applies to the main bracket.
 */
export function totalDoubleElimMatches(
  fighterCount: number,
  options: DoubleElimOptions = {},
): number {
  const bracketSize = resolveBracketSize(fighterCount, options);
  const playInMatchCount = fighterCount - bracketSize;
  return playInMatchCount + (2 * bracketSize - 2) + (options.grandFinalReset === true ? 1 : 0);
}
