/**
 * packages/rulesets/src/scheduling/double-elim.ts
 *
 * Double-elimination bracket generator.
 *
 * Pure function — no DB, no I/O.
 *
 * Structure:
 *   Winners Bracket (WB): log2(N) rounds
 *   Losers Bracket (LB):  2 * (log2(N) - 1) rounds
 *   Grand Final (GF):     1 slot
 *   Reset (optional):     1 slot
 *
 * Round numbering (absolute):
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
 */

export type SlotSourceType = 'seed' | 'winner_of' | 'loser_of' | 'bye';

export interface DoubleElimSlot {
  /** Absolute round number */
  round: number;
  /** 1-indexed position within round */
  position: number;
  /** Bracket section */
  section: 'WB' | 'LB' | 'GF' | 'RESET';
  /** Source description for home/top slot */
  homeSource: string;
  /** Source description for away/bottom slot */
  awaySource: string;
  /** Source type for home slot */
  sourceAType: SlotSourceType;
  /** Source type for away slot */
  sourceBType: SlotSourceType;
  /** True if one side is a bye (WB-R1 only) */
  isBye: boolean;
  /** Seed number for home slot (WB-R1 seed slots only) */
  homeSeed: number | null;
  /** Seed number for away slot (WB-R1 seed slots only) */
  awaySeed: number | null;
}

export interface DoubleElimBracket {
  bracketSize: number;
  fighterCount: number;
  byeCount: number;
  wbRounds: number;
  lbRounds: number;
  slots: DoubleElimSlot[];
}

export interface DoubleElimOptions {
  /** Must be a power of 2 and >= fighterCount. Defaults to nextPowerOf2(fighterCount). */
  bracketSize?: number;
  /** Whether to include a grand final reset slot. Default: false. */
  grandFinalReset?: boolean;
}

export const MAX_DOUBLE_ELIM_BRACKET_SIZE = 128;

// ── Helpers ───────────────────────────────────────────────────────────────────

function nextPowerOf2(n: number): number {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Standard seeding order — same algorithm as single-elim.
 * Returns [homeSeed, awaySeed] pairs for WB round 1.
 */
function buildSeedingOrder(size: number): Array<[number, number]> {
  if (size === 2) return [[1, 2]];

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

  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < seeds.length; i += 2) {
    pairs.push([seeds[i]!, seeds[i + 1]!]);
  }
  return pairs;
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

  // Resolve bracket size
  let bracketSize: number;
  if (options.bracketSize !== undefined) {
    bracketSize = options.bracketSize;
    if (bracketSize < 2 || (bracketSize & (bracketSize - 1)) !== 0) {
      throw new Error(`bracketSize must be a power of 2 (got ${bracketSize})`);
    }
    if (bracketSize < fighterCount) {
      throw new Error(`bracketSize (${bracketSize}) must be >= fighterCount (${fighterCount})`);
    }
  } else {
    bracketSize = nextPowerOf2(fighterCount);
  }

  if (bracketSize > MAX_DOUBLE_ELIM_BRACKET_SIZE) {
    throw new Error(`bracketSize must be <= ${MAX_DOUBLE_ELIM_BRACKET_SIZE} (got ${bracketSize})`);
  }

  const byeCount = bracketSize - fighterCount;
  const wbRounds = Math.log2(bracketSize);
  const lbRounds = 2 * (wbRounds - 1);

  const slots: DoubleElimSlot[] = [];

  // ── Winners Bracket ──────────────────────────────────────────────────────

  // WB Round 1: seed matchups with byes
  const seedPairs = buildSeedingOrder(bracketSize);
  for (let pos = 0; pos < seedPairs.length; pos++) {
    const [homeSeed, awaySeed] = seedPairs[pos]!;
    const homeIsBye = homeSeed > fighterCount;
    const awayIsBye = awaySeed > fighterCount;
    const isBye = homeIsBye || awayIsBye;

    slots.push({
      round: 1,
      position: pos + 1,
      section: 'WB',
      homeSeed: homeIsBye ? null : homeSeed,
      awaySeed: awayIsBye ? null : awaySeed,
      isBye,
      homeSource: homeIsBye ? 'bye' : `seed ${homeSeed}`,
      awaySource: awayIsBye ? 'bye' : `seed ${awaySeed}`,
      sourceAType: homeIsBye ? 'bye' : 'seed',
      sourceBType: awayIsBye ? 'bye' : 'seed',
    });
  }

  // WB Rounds 2..wbRounds: winner-of slots
  for (let wbRound = 2; wbRound <= wbRounds; wbRound++) {
    const matchCount = bracketSize / Math.pow(2, wbRound);
    for (let pos = 1; pos <= matchCount; pos++) {
      const prevPos1 = (pos - 1) * 2 + 1;
      const prevPos2 = (pos - 1) * 2 + 2;
      slots.push({
        round: wbRound,
        position: pos,
        section: 'WB',
        homeSeed: null,
        awaySeed: null,
        isBye: false,
        homeSource: `winner of WBR${wbRound - 1}P${prevPos1}`,
        awaySource: `winner of WBR${wbRound - 1}P${prevPos2}`,
        sourceAType: 'winner_of',
        sourceBType: 'winner_of',
      });
    }
  }

  // ── Losers Bracket ───────────────────────────────────────────────────────
  // LB round k (1-indexed within LB), absolute round = wbRounds + k
  // Match count formula: bracketSize / (4 * 2^floor((k-1)/2))

  for (let k = 1; k <= lbRounds; k++) {
    const absoluteRound = wbRounds + k;
    const matchCount = bracketSize / (4 * Math.pow(2, Math.floor((k - 1) / 2)));

    for (let pos = 1; pos <= matchCount; pos++) {
      let homeSource: string;
      let awaySource: string;
      let sourceAType: SlotSourceType;
      let sourceBType: SlotSourceType;

      if (k === 1) {
        // LB-R1 drop round: pairs up WB-R1 losers
        // Position j pairs WB-R1 losers at positions 2j-1 and 2j
        const wbPos1 = 2 * pos - 1;
        const wbPos2 = 2 * pos;
        homeSource = `loser of WBR1P${wbPos1}`;
        awaySource = `loser of WBR1P${wbPos2}`;
        sourceAType = 'loser_of';
        sourceBType = 'loser_of';
      } else if (k % 2 === 0) {
        // Even LB rounds: mixed — LB survivors vs WB losers
        // WB round that drops into this LB round: k/2 + 1
        const wbDropRound = k / 2 + 1;
        homeSource = `winner of LBR${k - 1}P${pos}`;
        awaySource = `loser of WBR${wbDropRound}P${pos}`;
        sourceAType = 'winner_of';
        sourceBType = 'loser_of';
      } else {
        // Odd LB rounds (k >= 3): consolidation
        // Position j takes from LB prev round positions 2j-1 and 2j
        const prevPos1 = 2 * pos - 1;
        const prevPos2 = 2 * pos;
        homeSource = `winner of LBR${k - 1}P${prevPos1}`;
        awaySource = `winner of LBR${k - 1}P${prevPos2}`;
        sourceAType = 'winner_of';
        sourceBType = 'winner_of';
      }

      slots.push({
        round: absoluteRound,
        position: pos,
        section: 'LB',
        homeSeed: null,
        awaySeed: null,
        isBye: false,
        homeSource,
        awaySource,
        sourceAType,
        sourceBType,
      });
    }
  }

  // ── Grand Final ──────────────────────────────────────────────────────────
  const gfRound = wbRounds + lbRounds + 1;
  slots.push({
    round: gfRound,
    position: 1,
    section: 'GF',
    homeSeed: null,
    awaySeed: null,
    isBye: false,
    homeSource: `winner of WBR${wbRounds}P1`,
    awaySource: `winner of LBR${lbRounds}P1`,
    sourceAType: 'winner_of',
    sourceBType: 'winner_of',
  });

  // ── Reset slot (optional) ────────────────────────────────────────────────
  if (options.grandFinalReset === true) {
    slots.push({
      round: gfRound + 1,
      position: 1,
      section: 'RESET',
      homeSeed: null,
      awaySeed: null,
      isBye: false,
      homeSource: 'loser of GF',
      awaySource: 'winner of GF',
      sourceAType: 'loser_of',
      sourceBType: 'winner_of',
    });
  }

  return { bracketSize, fighterCount, byeCount, wbRounds, lbRounds, slots };
}
