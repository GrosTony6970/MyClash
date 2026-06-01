export interface PoolMembershipInput {
  id: string;
  members: Array<{ personId: string }>;
}

/**
 * Build a poolId → Set<personId> index of who fights in each pool.
 * Used as the chokepoint for the "fighter cannot referee their own
 * pool" rule: anything we're about to persist as a referee assignment
 * gets cross-checked against this map.
 */
export function buildFightersByPool(pools: PoolMembershipInput[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const pool of pools) {
    const set = new Set<string>();
    for (const member of pool.members) set.add(member.personId);
    out.set(pool.id, set);
  }
  return out;
}
