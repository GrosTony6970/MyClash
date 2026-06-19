/**
 * Estimate how long a tournament's pool phase actually takes on the grid.
 *
 * The match scheduler uses STRICT pool affinity: each whole pool runs on a
 * single lice (`match-scheduler.ts`), with pools assigned round-robin to lices
 * (pool i → lice `i % liceCount`). So the wall-clock for the phase is driven by
 * the BUSIEST lice — the one carrying the most pool matches — not by the naive
 * `ceil(totalMatches / lices)` (which assumes matches fan freely across lices).
 *
 * `perPoolCounts` must be in the same order the scheduler assigns pools (pool
 * sort order). Pure: no I/O.
 */
export interface PoolBottleneck {
  /** Minutes the busiest lice needs (its match count × per-match time). */
  minutes: number;
  /** Lices actually occupied = min(pools, parallelLice). */
  licesUsed: number;
}

export function poolBottleneckMinutes(
  perPoolCounts: number[],
  parallelLice: number,
  matchDurationMin: number,
  gapSec: number,
): PoolBottleneck {
  const pools = perPoolCounts.filter((c) => c > 0);
  if (pools.length === 0 || parallelLice <= 0) return { minutes: 0, licesUsed: 0 };

  const licesUsed = Math.min(pools.length, parallelLice);
  // Round-robin pools onto lices exactly as the scheduler does (pool i → lice
  // i % licesUsed), then take the busiest lice's total match count.
  const perLice = new Array<number>(licesUsed).fill(0);
  pools.forEach((count, i) => {
    perLice[i % licesUsed]! += count;
  });
  const busiest = Math.max(...perLice);
  const perMatchMin = matchDurationMin + gapSec / 60;
  return { minutes: busiest * perMatchMin, licesUsed };
}
