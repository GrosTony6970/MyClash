/**
 * packages/rules/src/scheduling/snake-seeding.ts
 *
 * Snake-seeding pool distribution algorithm.
 * ARCHITECTURE.md §11quater.1: "Snake-distribute to pools: pool 1 gets seed 1,
 * pool 2 seed 2, ..., pool N seed N, then pool N seed N+1, pool N-1 seed N+2..."
 *
 * Pure function — no DB, no I/O.
 */

export interface Fighter {
  registrationId: string;
  clubId: string | null;
  /** Skill rating: higher = better. null = unrated (placed last). */
  skillRating: number | null;
  seed: number | null;
}

export interface PoolAssignment {
  poolIndex: number; // 0-indexed
  registrationId: string;
}

/**
 * Sort fighters by skill for snake seeding.
 * Priority: skillRating desc → seed asc → registration order (stable).
 */
export function sortBySkill(fighters: Fighter[]): Fighter[] {
  return [...fighters].sort((a, b) => {
    // Unrated fighters go last
    if (a.skillRating === null && b.skillRating !== null) return 1;
    if (a.skillRating !== null && b.skillRating === null) return -1;
    if (a.skillRating !== null && b.skillRating !== null) {
      if (b.skillRating !== a.skillRating) return b.skillRating - a.skillRating;
    }
    // Tiebreak by seed
    const seedA = a.seed ?? Infinity;
    const seedB = b.seed ?? Infinity;
    return seedA - seedB;
  });
}

/**
 * Distribute fighters into pools using snake seeding.
 * Returns pool assignments (0-indexed pool indices).
 *
 * Example with 8 fighters, 2 pools:
 *   Round 1 (→): pool 0, pool 1
 *   Round 2 (←): pool 1, pool 0
 *   Round 3 (→): pool 0, pool 1
 *   Round 4 (←): pool 1, pool 0
 */
export function snakeSeed(fighters: Fighter[], poolCount: number): PoolAssignment[] {
  if (poolCount <= 0) throw new Error('poolCount must be positive');
  if (fighters.length === 0) return [];

  const sorted = sortBySkill(fighters);
  const assignments: PoolAssignment[] = [];

  let direction = 1; // 1 = left-to-right, -1 = right-to-left
  let poolIndex = 0;

  for (const fighter of sorted) {
    assignments.push({ poolIndex, registrationId: fighter.registrationId });

    poolIndex += direction;

    // Reverse direction at boundaries
    if (poolIndex >= poolCount) {
      poolIndex = poolCount - 1;
      direction = -1;
    } else if (poolIndex < 0) {
      poolIndex = 0;
      direction = 1;
    }
  }

  return assignments;
}

/**
 * Compute pool sizes for N fighters into K pools.
 * Balanced within ±1 (hard constraint from ARCHITECTURE.md §11quater.1).
 */
export function computePoolSizes(fighterCount: number, poolCount: number): number[] {
  const base = Math.floor(fighterCount / poolCount);
  const remainder = fighterCount % poolCount;
  return Array.from({ length: poolCount }, (_, i) => base + (i < remainder ? 1 : 0));
}
