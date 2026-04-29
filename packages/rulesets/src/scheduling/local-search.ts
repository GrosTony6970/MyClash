/**
 * packages/rulesets/src/scheduling/local-search.ts
 *
 * Local search optimizer for pool assignments.
 * ARCHITECTURE.md §11quater.1: "Iterate K = max(50, fighters * 2) times:
 * pick a random pair of fighters in different pools; if swapping reduces
 * total cost, accept."
 *
 * Pure function — no DB, no I/O. Uses a seeded PRNG for determinism.
 */
import type { Fighter, PoolAssignment } from './snake-seeding';

export interface PoolAssignmentSettings {
  enforceSchoolSeparation: boolean;
  schoolSeparationStrictness: 'soft' | 'strict';
  enforceSkillBalance: boolean;
}

export interface CostReport {
  totalCost: number;
  sameClubPairsPerPool: Array<{ poolIndex: number; count: number; pairs: string[][] }>;
  skillVariance: number;
  schoolSeparationSatisfied: boolean;
  skillBalanceSatisfied: boolean;
}

// ── Cost function ─────────────────────────────────────────────────────────────

/**
 * Compute the total cost of a pool assignment.
 * Lower is better.
 *
 * Cost = (school_weight × same_club_pairs) + (skill_weight × skill_variance)
 */
export function computeCost(
  assignments: PoolAssignment[],
  fighters: Fighter[],
  poolCount: number,
  settings: PoolAssignmentSettings,
): number {
  const fighterMap = new Map(fighters.map((f) => [f.registrationId, f]));
  const pools: Fighter[][] = Array.from({ length: poolCount }, () => []);

  for (const a of assignments) {
    const f = fighterMap.get(a.registrationId);
    if (f) pools[a.poolIndex]?.push(f);
  }

  let cost = 0;

  // School separation cost
  if (settings.enforceSchoolSeparation) {
    for (const pool of pools) {
      const clubCounts = new Map<string, number>();
      for (const f of pool) {
        if (f.clubId) {
          clubCounts.set(f.clubId, (clubCounts.get(f.clubId) ?? 0) + 1);
        }
      }
      for (const count of clubCounts.values()) {
        if (count > 1) {
          // Each same-club pair costs 100
          cost += (count * (count - 1)) / 2 * 100;
        }
      }
    }
  }

  // Skill balance cost
  if (settings.enforceSkillBalance) {
    const poolMeans = pools.map((pool) => {
      const rated = pool.filter((f) => f.skillRating !== null);
      if (rated.length === 0) return 0;
      return rated.reduce((sum, f) => sum + (f.skillRating ?? 0), 0) / rated.length;
    });

    const overallMean = poolMeans.reduce((s, m) => s + m, 0) / poolMeans.length;
    const variance = poolMeans.reduce((s, m) => s + (m - overallMean) ** 2, 0) / poolMeans.length;
    cost += variance;
  }

  return cost;
}

// ── Seeded PRNG (deterministic) ───────────────────────────────────────────────

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Local search ──────────────────────────────────────────────────────────────

/**
 * Improve pool assignments via local search.
 * Deterministic: same inputs always produce same output.
 *
 * @param assignments  Initial assignments (from snake seeding)
 * @param fighters     Fighter list with skill ratings
 * @param poolCount    Number of pools
 * @param settings     Constraint settings
 * @param iterations   Number of swap attempts (default: max(50, fighters.length * 2))
 * @param seed         PRNG seed for determinism (default: 42)
 */
export function localSearch(
  assignments: PoolAssignment[],
  fighters: Fighter[],
  poolCount: number,
  settings: PoolAssignmentSettings,
  iterations?: number,
  seed = 42,
): PoolAssignment[] {
  const K = iterations ?? Math.max(50, fighters.length * 2);
  const rng = mulberry32(seed);

  let current = [...assignments];
  let currentCost = computeCost(current, fighters, poolCount, settings);

  for (let i = 0; i < K; i++) {
    // Pick two random fighters from different pools
    const idxA = Math.floor(rng() * current.length);
    let idxB = Math.floor(rng() * current.length);

    // Ensure different pools
    let attempts = 0;
    while (current[idxA]?.poolIndex === current[idxB]?.poolIndex && attempts < 10) {
      idxB = Math.floor(rng() * current.length);
      attempts++;
    }

    if (current[idxA]?.poolIndex === current[idxB]?.poolIndex) continue;

    // Try swap
    const candidate = [...current];
    const a = { ...candidate[idxA]! };
    const b = { ...candidate[idxB]! };
    candidate[idxA] = { ...a, poolIndex: b.poolIndex };
    candidate[idxB] = { ...b, poolIndex: a.poolIndex };

    const candidateCost = computeCost(candidate, fighters, poolCount, settings);

    if (candidateCost < currentCost) {
      current = candidate;
      currentCost = candidateCost;
    }
  }

  return current;
}

// ── Cost report ───────────────────────────────────────────────────────────────

export function buildCostReport(
  assignments: PoolAssignment[],
  fighters: Fighter[],
  poolCount: number,
  settings: PoolAssignmentSettings,
): CostReport {
  const fighterMap = new Map(fighters.map((f) => [f.registrationId, f]));
  const pools: Fighter[][] = Array.from({ length: poolCount }, () => []);

  for (const a of assignments) {
    const f = fighterMap.get(a.registrationId);
    if (f) pools[a.poolIndex]?.push(f);
  }

  // Same-club pairs per pool
  const sameClubPairsPerPool = pools.map((pool, poolIndex) => {
    const byClub = new Map<string, Fighter[]>();
    for (const f of pool) {
      if (f.clubId) {
        const existing = byClub.get(f.clubId) ?? [];
        existing.push(f);
        byClub.set(f.clubId, existing);
      }
    }

    let count = 0;
    const pairs: string[][] = [];
    for (const clubFighters of byClub.values()) {
      if (clubFighters.length > 1) {
        for (let i = 0; i < clubFighters.length; i++) {
          for (let j = i + 1; j < clubFighters.length; j++) {
            count++;
            pairs.push([clubFighters[i]!.registrationId, clubFighters[j]!.registrationId]);
          }
        }
      }
    }
    return { poolIndex, count, pairs };
  });

  // Skill variance
  const poolMeans = pools.map((pool) => {
    const rated = pool.filter((f) => f.skillRating !== null);
    if (rated.length === 0) return 0;
    return rated.reduce((sum, f) => sum + (f.skillRating ?? 0), 0) / rated.length;
  });
  const overallMean = poolMeans.reduce((s, m) => s + m, 0) / poolMeans.length;
  const skillVariance = poolMeans.reduce((s, m) => s + (m - overallMean) ** 2, 0) / poolMeans.length;

  const totalSameClubPairs = sameClubPairsPerPool.reduce((s, p) => s + p.count, 0);

  return {
    totalCost: computeCost(assignments, fighters, poolCount, settings),
    sameClubPairsPerPool,
    skillVariance,
    schoolSeparationSatisfied: totalSameClubPairs === 0,
    skillBalanceSatisfied: skillVariance < 1.0, // threshold: variance < 1 rating point²
  };
}
