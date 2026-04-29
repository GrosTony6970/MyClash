/**
 * packages/rulesets/src/scheduling/single-elim.ts
 *
 * Single-elimination bracket generator.
 * ARCHITECTURE.md §11quater: "Generate a single-elimination bracket from
 * N qualified fighters with bye handling."
 *
 * Pure function — no DB, no I/O.
 *
 * Seeding convention (standard tournament seeding):
 *   - Bracket size = next power of 2 ≥ N
 *   - Byes fill the bracket to the next power of 2
 *   - Seed 1 vs seed (size), seed 2 vs seed (size-1), etc.
 *   - Byes are placed to protect top seeds (1 and 2 get byes if any)
 *
 * Example: 13 fighters → bracket size 16 → 3 byes
 *   Round 1 matchups (seed vs seed):
 *     1 vs bye, 8 vs 9, 5 vs 12, 4 vs 13, 3 vs bye, 6 vs 11, 7 vs 10, 2 vs bye
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
}

export interface SingleElimBracket {
  /** Total number of fighters (including byes) */
  bracketSize: number;
  /** Number of actual fighters */
  fighterCount: number;
  /** Number of byes in round 1 */
  byeCount: number;
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
   * If not provided, defaults to nextPowerOf2(fighterCount).
   */
  bracketSize?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Next power of 2 ≥ n */
function nextPowerOf2(n: number): number {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p <<= 1;
  return p;
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
 * @param options       Optional: override bracket size
 * @returns             Complete bracket structure
 */
export function singleElimBracket(
  fighterCount: number,
  options: SingleElimOptions = {},
): SingleElimBracket {
  if (fighterCount < 2) throw new Error('Need at least 2 fighters for a bracket');

  // Resolve bracket size
  let bracketSize: number;
  if (options.bracketSize !== undefined) {
    bracketSize = options.bracketSize;
    // Validate: must be a power of 2
    if (bracketSize < 2 || (bracketSize & (bracketSize - 1)) !== 0) {
      throw new Error(`bracketSize must be a power of 2 (got ${bracketSize})`);
    }
    // Validate: must be ≥ fighterCount
    if (bracketSize < fighterCount) {
      throw new Error(
        `bracketSize (${bracketSize}) must be ≥ fighterCount (${fighterCount})`,
      );
    }
  } else {
    bracketSize = nextPowerOf2(fighterCount);
  }

  const byeCount = bracketSize - fighterCount;
  const rounds = Math.log2(bracketSize);

  const slots: BracketSlot[] = [];

  // ── Round 1: seed matchups with byes ────────────────────────────────────
  const seedPairs = buildSeedingOrder(bracketSize);

  for (let pos = 0; pos < seedPairs.length; pos++) {
    const [homeSeed, awaySeed] = seedPairs[pos]!;

    // A seed > fighterCount means it's a bye slot
    const homeIsBye = homeSeed > fighterCount;
    const awayIsBye = awaySeed > fighterCount;
    const isBye = homeIsBye || awayIsBye;

    slots.push({
      round: 1,
      position: pos + 1,
      homeSeed: homeIsBye ? null : homeSeed,
      awaySeed: awayIsBye ? null : awaySeed,
      isBye,
      homeSource: homeIsBye ? 'bye' : `seed ${homeSeed}`,
      awaySource: awayIsBye ? 'bye' : `seed ${awaySeed}`,
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
      });
    }
  }

  return { bracketSize, fighterCount, byeCount, rounds, slots };
}

/**
 * Total matches in a single-elimination bracket of N fighters.
 * Always N-1 (every match eliminates one fighter).
 */
export function totalBracketMatches(fighterCount: number): number {
  return fighterCount - 1;
}
