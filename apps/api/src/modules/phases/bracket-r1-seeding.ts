export interface RankedRegistration {
  rank: number;
  registrationId: string;
}

export interface BracketR1Slot {
  id: string;
  position: number;
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
 * Map a global ranking onto bracket R1 slots using the (2P-1, 2P)
 * pairing the existing reseedBracketRoundOne uses
 * (phases.service.ts:818-819). Slot at position P pairs rank 2P-1
 * (home) with rank 2P (away). Missing ranks → null, which leaves
 * the slot as a bye for advanceByeSlots to handle.
 */
export function buildR1SeedingPlan(
  rankings: RankedRegistration[],
  slots: BracketR1Slot[],
): SlotSeedUpdate[] {
  const byRank = new Map<number, string>();
  for (const r of rankings) byRank.set(r.rank, r.registrationId);
  return slots.map((slot) => ({
    slotId: slot.id,
    registrationAId: byRank.get(slot.position * 2 - 1) ?? null,
    registrationBId: byRank.get(slot.position * 2) ?? null,
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
