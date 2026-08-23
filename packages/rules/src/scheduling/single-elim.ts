/**
 * packages/rules/src/scheduling/single-elim.ts
 *
 * Single-elimination bracket generator.
 * ARCHITECTURE.md §11quater: "Generate a single-elimination bracket from
 * N qualified fighters with bye handling."
 *
 * Pure function — no DB, no I/O.
 *
 * Seeding convention (standard tournament seeding):
 *   - Bracket size rounds DOWN to the largest power of 2 below N, and the
 *     surplus fighters meet in a play-in round (round 0). Nobody sits out.
 *   - The top seeds skip the play-in; the rest are paired highest against
 *     lowest, so seed 4 meets seed N, seed 5 meets seed N-1, and so on.
 *   - Inside the main bracket, seed 1 meets seed (size), seed 2 meets
 *     seed (size-1), etc.
 *
 * Example: 13 fighters → bracket size 8 → 5 play-in matches, 3 seeds skip them
 *   Round 0: 4 vs 13, 5 vs 12, 6 vs 11, 7 vs 10, 8 vs 9
 *   Round 1: 1 vs W(R0P5), W(R0P1) vs W(R0P2), 2 vs W(R0P4), 3 vs W(R0P3)
 *
 * An explicit `bracketSize` opts out of all of that and takes the older path:
 * the bracket is the size you asked for, the shortfall becomes real byes in
 * round 1, and byes are placed to protect the top seeds.
 */

export interface BracketSlot {
  /** Round number (1 = first round, log2(size) = final) */
  round: number;
  /** Position within the round (1-indexed) */
  position: number;
  /** Seed of the home/top player (null = bye) */
  homeSeed: number | null;
  /** Seed of the away/bottom player (null = bye) */
  awaySeed: number | null;
  /** True if one side is a bye (auto-advance) */
  isBye: boolean;
  /** Source description for bracket display */
  homeSource: string;
  awaySource: string;
  /** Source type for the home/top slot */
  sourceAType: 'seed' | 'winner_of' | 'loser_of' | 'bye';
  /** Source type for the away/bottom slot */
  sourceBType: 'seed' | 'winner_of' | 'loser_of' | 'bye';
}

export interface SingleElimBracket {
  /** Main bracket size. Explicit bracketSize mode includes legacy bye slots. */
  bracketSize: number;
  /** Main bracket size, exposed explicitly for play-in brackets. */
  mainBracketSize: number;
  /** Number of actual fighters */
  fighterCount: number;
  /** Default mode: high seeds entering directly; explicit mode: synthetic bye slots. */
  byeCount: number;
  /** Number of high seeds entering the main bracket directly. */
  byeSeedCount: number;
  /** Number of play-in matches before the main bracket. */
  playInMatchCount: number;
  /** True when round 0 play-in slots are present. */
  hasPlayInRound: boolean;
  /** Number of rounds */
  rounds: number;
  /** All bracket slots, ordered by round then position */
  slots: BracketSlot[];
}

export interface SingleElimOptions {
  /**
   * Override the bracket size (must be a power of 2 and ≥ fighterCount).
   *
   * Use cases:
   *   - Cut to top N: bracketSize=16 with fighterCount=20 → only top 16 qualify
   *   - Larger bracket: bracketSize=32 with fighterCount=24 → 8 byes
   *
   * If not provided, the bracket rounds DOWN to the largest power of two below
   * fighterCount and the surplus fighters meet in a play-in round.
   */
  bracketSize?: number;
}

export const MAX_SINGLE_ELIM_BRACKET_SIZE = 128;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Highest power of 2 strictly below n. */
function highestPowerOf2Below(n: number): number {
  let p = 1;
  while (p * 2 < n) p <<= 1;
  return p;
}

function isPowerOf2(n: number): boolean {
  return n >= 1 && (n & (n - 1)) === 0;
}

/**
 * Standard seeding positions for a bracket of given size.
 * Returns an array of [homeSeed, awaySeed] pairs for round 1,
 * ordered by bracket position.
 *
 * Uses the standard recursive bracket construction:
 * - Size 2: [[1, 2]]
 * - Size 4: [[1,4], [3,2]]  (1 vs 4, 3 vs 2)
 * - Size 8: [[1,8],[5,4],[3,6],[7,2]]
 * - Size 16: [[1,16],[9,8],[5,12],[13,4],[3,14],[11,6],[7,10],[15,2]]
 *
 * This ensures seed 1 and seed 2 are in opposite halves, and top seeds
 * are protected from meeting early.
 */
function buildSeedingOrder(size: number): Array<[number, number]> {
  if (size === 2) return [[1, 2]];

  // Recursively build the bracket
  // Each round doubles the bracket: insert the complement of each seed
  let seeds = [1];

  while (seeds.length < size) {
    const complement = seeds.length * 2 + 1;
    const newSeeds: number[] = [];
    for (const s of seeds) {
      newSeeds.push(s);
      newSeeds.push(complement - s);
    }
    seeds = newSeeds;
  }

  // Pair adjacent seeds for round 1 matchups
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < seeds.length; i += 2) {
    pairs.push([seeds[i]!, seeds[i + 1]!]);
  }
  return pairs;
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Generate a single-elimination bracket for N fighters.
 *
 * @param fighterCount  Number of qualified fighters
 * @param options       Optional: override the bracket size
 * @returns             Complete bracket structure
 */
export function singleElimBracket(
  fighterCount: number,
  options: SingleElimOptions = {},
): SingleElimBracket {
  if (fighterCount < 2) throw new Error('Need at least 2 fighters for a bracket');

  // Resolve bracket size
  let bracketSize: number;
  const useLegacyByeMode = options.bracketSize !== undefined;
  if (options.bracketSize !== undefined) {
    bracketSize = options.bracketSize;
    // Validate: must be a power of 2
    if (bracketSize < 2 || (bracketSize & (bracketSize - 1)) !== 0) {
      throw new Error(`bracketSize must be a power of 2 (got ${bracketSize})`);
    }
    // Validate: must be ≥ fighterCount
    if (bracketSize < fighterCount) {
      throw new Error(`bracketSize (${bracketSize}) must be ≥ fighterCount (${fighterCount})`);
    }
  } else {
    bracketSize = isPowerOf2(fighterCount) ? fighterCount : highestPowerOf2Below(fighterCount);
  }

  if (bracketSize > MAX_SINGLE_ELIM_BRACKET_SIZE) {
    throw new Error(`bracketSize must be <= ${MAX_SINGLE_ELIM_BRACKET_SIZE} (got ${bracketSize})`);
  }

  const playInMatchCount =
    useLegacyByeMode || isPowerOf2(fighterCount) ? 0 : fighterCount - bracketSize;
  const hasPlayInRound = playInMatchCount > 0;
  const byeSeedCount = useLegacyByeMode
    ? bracketSize - fighterCount
    : hasPlayInRound
      ? bracketSize - playInMatchCount
      : 0;
  const byeCount = useLegacyByeMode ? bracketSize - fighterCount : byeSeedCount;
  const rounds = Math.log2(bracketSize);

  const slots: BracketSlot[] = [];

  // Round 0: play-ins for non-power-of-two default brackets.
  if (hasPlayInRound) {
    for (let pos = 1; pos <= playInMatchCount; pos++) {
      const seedSlot = byeSeedCount + pos;
      const opponentSeed = fighterCount - pos + 1;

      slots.push({
        round: 0,
        position: pos,
        homeSeed: seedSlot,
        awaySeed: opponentSeed,
        isBye: false,
        homeSource: `seed ${seedSlot}`,
        awaySource: `seed ${opponentSeed}`,
        sourceAType: 'seed',
        sourceBType: 'seed',
      });
    }
  }

  // ── Round 1: seed matchups with byes ────────────────────────────────────
  const seedPairs = buildSeedingOrder(bracketSize);

  for (let pos = 0; pos < seedPairs.length; pos++) {
    const [homeSeed, awaySeed] = seedPairs[pos]!;

    const homePlayInPos =
      hasPlayInRound && homeSeed > byeSeedCount ? homeSeed - byeSeedCount : null;
    const awayPlayInPos =
      hasPlayInRound && awaySeed > byeSeedCount ? awaySeed - byeSeedCount : null;

    // A seed > fighterCount means it's a legacy explicit-bracket bye slot.
    const homeIsBye = useLegacyByeMode && homeSeed > fighterCount;
    const awayIsBye = useLegacyByeMode && awaySeed > fighterCount;
    const isBye = homeIsBye || awayIsBye;

    const sourceAType: BracketSlot['sourceAType'] = homeIsBye
      ? 'bye'
      : homePlayInPos
        ? 'winner_of'
        : 'seed';
    const sourceBType: BracketSlot['sourceBType'] = awayIsBye
      ? 'bye'
      : awayPlayInPos
        ? 'winner_of'
        : 'seed';

    slots.push({
      round: 1,
      position: pos + 1,
      homeSeed: homeIsBye || homePlayInPos ? null : homeSeed,
      awaySeed: awayIsBye || awayPlayInPos ? null : awaySeed,
      isBye,
      homeSource: homeIsBye
        ? 'bye'
        : homePlayInPos
          ? `winner of R0P${homePlayInPos}`
          : `seed ${homeSeed}`,
      awaySource: awayIsBye
        ? 'bye'
        : awayPlayInPos
          ? `winner of R0P${awayPlayInPos}`
          : `seed ${awaySeed}`,
      sourceAType,
      sourceBType,
    });
  }

  // ── Subsequent rounds: winner-of slots ──────────────────────────────────
  for (let round = 2; round <= rounds; round++) {
    const matchesInRound = bracketSize / Math.pow(2, round);
    for (let pos = 1; pos <= matchesInRound; pos++) {
      const prevPos1 = (pos - 1) * 2 + 1;
      const prevPos2 = (pos - 1) * 2 + 2;
      slots.push({
        round,
        position: pos,
        homeSeed: null,
        awaySeed: null,
        isBye: false,
        homeSource: `winner of R${round - 1}P${prevPos1}`,
        awaySource: `winner of R${round - 1}P${prevPos2}`,
        sourceAType: 'winner_of',
        sourceBType: 'winner_of',
      });
    }
  }

  // ── Bronze match (3rd place) ─────────────────────────────────────────────
  //
  // Unconditional above a semi-final. There used to be an `includeBronze`
  // option here, read as `!== false` and never passed by any caller, so the
  // `false` branch could not fire -- a switch that only ever reads one way is
  // not a switch. Every bracket this repo generates has a bronze match; if one
  // should not, that is a Tournament setting somebody has to ask for.
  //
  // The slot sits at the SAME round number as the Final. Only its position and
  // its `loser_of` sources tell the two apart, and the advance service matches
  // on those, so single-elim.test.ts pins it.
  if (bracketSize >= 4) {
    slots.push({
      round: rounds,
      position: 2,
      homeSeed: null,
      awaySeed: null,
      isBye: false,
      homeSource: `loser of R${rounds - 1}P1`,
      awaySource: `loser of R${rounds - 1}P2`,
      sourceAType: 'loser_of',
      sourceBType: 'loser_of',
    });
  }

  return {
    bracketSize,
    mainBracketSize: bracketSize,
    fighterCount,
    byeCount,
    byeSeedCount,
    playInMatchCount,
    hasPlayInRound,
    rounds,
    slots,
  };
}

/**
 * Total matches in a single-elimination bracket of N fighters.
 * Always N-1 (every match eliminates one fighter).
 */
export function totalBracketMatches(fighterCount: number): number {
  return fighterCount - 1;
}
