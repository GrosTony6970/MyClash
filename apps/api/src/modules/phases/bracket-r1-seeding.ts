export interface RankedRegistration {
  rank: number;
  registrationId: string;
}

export interface BracketR1Slot {
  id: string;
  position: number;
  /**
   * Intended seed numbers for each side, parsed from
   * bracket_slots.source_a_ref / source_b_ref ("seed N"). `null` for
   * non-seed sources (a "bye", or a play-in feeder like "winner of R0Px").
   */
  seedA: number | null;
  seedB: number | null;
}

export interface SlotSeedUpdate {
  slotId: string;
  registrationAId: string | null;
  registrationBId: string | null;
}

export interface PoolRanking {
  poolId: string;
  rows: Array<{ rank: number; registrationId: string }>;
}

/**
 * Parse the seed integer from a bracket slot source ref. The bracket generator
 * (packages/rulesets single-elim/double-elim) labels seeded R1 sides as
 * "seed N" (single space). Byes and play-in feeders ("winner of R0Px") return
 * null so those sides stay empty.
 */
export function parseSeed(ref: string | null | undefined): number | null {
  if (!ref) return null;
  const m = /^seed (\d+)$/.exec(ref);
  return m ? Number(m[1]) : null;
}

/**
 * Place each ranked fighter into the bracket R1 slot SIDE whose intended seed
 * equals their rank. The bracket_slots already encode the canonical standard
 * seed distribution in their source refs (seed K vs seed size+1−K, with seed 1
 * and seed 2 in opposite halves, top seeds protected from meeting early), so we
 * map rank K → the side labelled "seed K".
 *
 * This replaces the old (2P−1, 2P) adjacent pairing, which ignored the seed
 * labels and filled slots sequentially — collapsing ranks 1 & 2 (e.g. two pool
 * winners) into the same first-round match.
 *
 * A seed with no matching rank (fewer ranked fighters than bracket size) leaves
 * that side null — a bye for advanceByeSlots to handle.
 */
export function buildR1SeedingPlan(
  rankings: RankedRegistration[],
  slots: BracketR1Slot[],
): SlotSeedUpdate[] {
  const byRank = new Map<number, string>();
  for (const r of rankings) byRank.set(r.rank, r.registrationId);
  return slots.map((slot) => ({
    slotId: slot.id,
    registrationAId: slot.seedA == null ? null : (byRank.get(slot.seedA) ?? null),
    registrationBId: slot.seedB == null ? null : (byRank.get(slot.seedB) ?? null),
  }));
}

/**
 * Flatten per-pool rankings into a single rank list using
 * cross-pool snake: round 1 takes #1 from every pool in pool
 * order, round 2 takes #2 in REVERSED pool order, round 3 in
 * pool order, … alternating through topN places. Same-pool
 * fighters land far apart in the flat list, so the bracket
 * pairing places them in opposite halves of the draw. Missing
 * rows (uneven pool sizes) are skipped, leaving the ranking
 * dense — downstream byes are produced when the flat list is
 * shorter than the bracket size.
 */
export function buildCrossPoolSnakeRanking(
  pools: PoolRanking[],
  topN: number,
): RankedRegistration[] {
  const out: RankedRegistration[] = [];
  let nextRank = 1;
  for (let n = 1; n <= topN; n++) {
    const order = n % 2 === 1 ? pools : [...pools].reverse();
    for (const pool of order) {
      const row = pool.rows.find((r) => r.rank === n);
      if (!row) continue;
      out.push({ rank: nextRank++, registrationId: row.registrationId });
    }
  }
  return out;
}
