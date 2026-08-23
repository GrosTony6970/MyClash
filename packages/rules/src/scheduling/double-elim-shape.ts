/**
 * packages/rules/src/scheduling/double-elim-shape.ts
 *
 * Sizing and validation for the double-elimination generator: turns a fighter
 * count plus operator options into the derived round counts every other piece
 * reads. Split out of `double-elim.ts` so slot assembly stays separate from the
 * arithmetic, and so `totalDoubleElimMatches` can share the exact same
 * derivation instead of keeping a parallel copy that can drift.
 *
 * Pure — no DB, no I/O.
 *
 * ── The structural idea ──────────────────────────────────────────────────────
 *
 * A repechage with cutoff K is EXACTLY the losers bracket of a K-sized double
 * elimination. "Only the last K get a second chance" means winners-bracket
 * rounds `repechageEntryRound ..` drop into the LB, and the entrants number
 * K/2 + K/4 + ... + 1 = K - 1 — precisely a K-bracket's LB intake. So the LB
 * generator is RE-INDEXED, never rewritten: match counts key off K instead of
 * bracketSize, and the mixed rounds pull from a WB round offset by the entry
 * depth. Absolute LB rounds still start at `wbRounds + 1`, so the advancement
 * ref strings (`LBR{k}P{p}`) are unchanged.
 *
 * ── Bronze mode ──────────────────────────────────────────────────────────────
 *
 * `secondChanceTarget: 'bronze'` is that same losers bracket truncated. The
 * final LB round in gold mode is always the mixed round fed by
 * `loser of WBR{wbRounds}` — the winners-bracket final's loser. In bronze mode
 * that fighter takes silver outright and never drops, so the round disappears
 * and the preceding consolidation round (always exactly 1 match) becomes the
 * bronze match. There is no grand final at all: the WB final decides gold and
 * silver by itself.
 *
 * `bronzeMatch: false` truncates one round further, which again lands on a
 * 1-match round, leaving two LB survivors who are ranked 3rd/4th by pool score.
 * That mirrors how single elimination already behaves with its bronze match
 * off — it separates the two semi-final losers by pool score rather than
 * awarding a shared bronze. No place number is ever shared.
 *
 *   K=8   gold 2,2,1,1   bronze+match 2,2,1   bronze no-match 2,2
 *   K=16  gold 4,4,2,2,1,1   bronze+match 4,4,2,2,1   bronze no-match 4,4,2,2
 */

export type SecondChanceTarget = 'gold' | 'bronze';

export interface DoubleElimOptions {
  /**
   * Override the main bracket size. Must be a power of 2.
   *
   * Unlike single-elim, it may NOT exceed `fighterCount`: a bracket larger
   * than the field can only be filled with byes, which deadlocks the losers
   * bracket. Cutting DOWN to a smaller bracket is allowed (the surplus
   * fighters play a round-0 play-in), bounded by
   * `fighterCount <= 2 * bracketSize` so the play-in always fits in one round.
   */
  bracketSize?: number;
  /**
   * Whether to include a grand final reset slot. Default: false.
   * Gold mode only — in bronze mode there is no grand final to reset.
   */
  grandFinalReset?: boolean;
  /**
   * Can the losers-bracket winner take gold ('gold', the classical esports
   * model), or does the winners-bracket final decide gold/silver on its own
   * and the repechage play for bronze ('bronze', the common HEMA/fencing
   * model)? Default: 'gold'.
   */
  secondChanceTarget?: SecondChanceTarget;
  /**
   * Bronze mode only: play a bronze match, or stop one round earlier and
   * separate the two survivors by pool score. Default: true.
   *
   * Not applicable in gold mode — there, 3rd place is already uniquely the
   * losers-bracket final's loser, so passing it is rejected rather than
   * silently ignored.
   */
  bronzeMatch?: boolean;
  /**
   * Second-chance cutoff by winners-bracket DEPTH. `null`/omitted = everyone
   * who loses in the WB drops to the losers bracket. Otherwise only fighters
   * knocked out at the round of K or later get a second chance; anyone
   * eliminated before that depth is out on a single loss.
   *
   * Must be a power of two and no larger than the bracket.
   */
  repechageEntrySize?: number | null;
}

/** Every derived number the slot builders and the API layer need. */
export interface DoubleElimShape {
  bracketSize: number;
  fighterCount: number;
  playInMatchCount: number;
  hasPlayInRound: boolean;
  /** Top seeds entering WB-R1 directly (0 when there is no play-in). */
  byeSeedCount: number;
  wbRounds: number;
  /** Losers-bracket rounds AFTER any bronze-mode truncation. */
  lbRounds: number;
  secondChanceTarget: SecondChanceTarget;
  bronzeMatch: boolean;
  /** The effective cutoff: `bracketSize` when no cutoff was requested. */
  repechageEntrySize: number;
  /** First WB round whose losers drop into the LB. 1 when there is no cutoff. */
  repechageEntryRound: number;
  grandFinalReset: boolean;
}

export const MAX_DOUBLE_ELIM_BRACKET_SIZE = 128;

export function isPowerOf2(n: number): boolean {
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

/** Validate the cutoff and return the effective repechage size. */
function resolveRepechageEntrySize(bracketSize: number, options: DoubleElimOptions): number {
  const requested = options.repechageEntrySize;
  if (requested === undefined || requested === null) return bracketSize;
  if (requested < 2 || !isPowerOf2(requested)) {
    throw new Error(`repechageEntrySize must be a power of 2 (got ${requested})`);
  }
  if (requested > bracketSize) {
    throw new Error(
      `repechageEntrySize (${requested}) must be <= bracketSize (${bracketSize}) — ` +
        'the cutoff names a winners-bracket depth, so it cannot be deeper than the bracket',
    );
  }
  return requested;
}

/**
 * Reject options that do nothing in the selected mode instead of silently
 * dropping them: an organiser who ticks "grand final reset" and gets a bracket
 * with no grand final has been misled, not accommodated.
 */
function rejectInapplicableOptions(target: SecondChanceTarget, options: DoubleElimOptions): void {
  if (target === 'gold' && options.bronzeMatch !== undefined) {
    throw new Error(
      'bronzeMatch does not apply when secondChanceTarget is "gold" — third place is ' +
        'already decided by the losers-bracket final',
    );
  }
  if (target === 'bronze' && options.grandFinalReset === true) {
    throw new Error(
      'grandFinalReset does not apply when secondChanceTarget is "bronze" — the ' +
        'winners-bracket final decides gold and silver, so there is no grand final',
    );
  }
}

/**
 * Losers-bracket round count after mode truncation.
 *
 * Gold: 2*(log2 K - 1), the full alternating drop/consolidation ladder.
 * Bronze: one round shorter (the WB-final loser no longer drops), and one
 * shorter again when the bronze match is off. Both truncations land on a
 * 1-match round, so the ladder stays well-formed.
 */
function resolveLbRounds(
  repechageEntrySize: number,
  target: SecondChanceTarget,
  bronzeMatch: boolean,
): number {
  const full = 2 * (Math.log2(repechageEntrySize) - 1);
  if (target === 'gold') return full;

  const lbRounds = full - (bronzeMatch ? 1 : 2);
  if (lbRounds < 1) {
    throw new Error(
      `secondChanceTarget "bronze"${bronzeMatch ? '' : ' without a bronze match'} needs a ` +
        `second-chance field of at least ${bronzeMatch ? 4 : 8} (got ${repechageEntrySize}) — ` +
        'below that the repechage has no rounds left to play',
    );
  }
  return lbRounds;
}

/**
 * Derive every sizing number for a double-elimination bracket, validating the
 * operator's options along the way. Throws with an operator-readable message
 * on any invalid combination.
 */
export function resolveDoubleElimShape(
  fighterCount: number,
  options: DoubleElimOptions = {},
): DoubleElimShape {
  if (fighterCount < 2) throw new Error('Need at least 2 fighters for a bracket');

  const bracketSize = resolveBracketSize(fighterCount, options);
  if (bracketSize > MAX_DOUBLE_ELIM_BRACKET_SIZE) {
    throw new Error(`bracketSize must be <= ${MAX_DOUBLE_ELIM_BRACKET_SIZE} (got ${bracketSize})`);
  }

  const secondChanceTarget = options.secondChanceTarget ?? 'gold';
  rejectInapplicableOptions(secondChanceTarget, options);

  const repechageEntrySize = resolveRepechageEntrySize(bracketSize, options);
  const bronzeMatch = secondChanceTarget === 'bronze' ? (options.bronzeMatch ?? true) : false;
  const lbRounds = resolveLbRounds(repechageEntrySize, secondChanceTarget, bronzeMatch);

  const wbRounds = Math.log2(bracketSize);
  const playInMatchCount = fighterCount - bracketSize;
  const hasPlayInRound = playInMatchCount > 0;

  return {
    bracketSize,
    fighterCount,
    playInMatchCount,
    hasPlayInRound,
    // Top seeds that skip the play-in and enter WB-R1 directly.
    byeSeedCount: hasPlayInRound ? bracketSize - playInMatchCount : 0,
    wbRounds,
    lbRounds,
    secondChanceTarget,
    bronzeMatch,
    repechageEntrySize,
    // "Last K" = the WB round at which K fighters remain.
    repechageEntryRound: wbRounds + 1 - Math.log2(repechageEntrySize),
    grandFinalReset: secondChanceTarget === 'gold' && options.grandFinalReset === true,
  };
}
