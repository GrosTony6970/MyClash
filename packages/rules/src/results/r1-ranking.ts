/**
 * Bracket Round-1 ranking strategies.
 *
 * Every seeding strategy reduces to the same job: turn a set of registrations
 * into a `RankedEntrant[]` (rank 1..N). `buildR1SeedingPlan` then maps
 * rank K onto the bracket side labelled "seed K" — the canonical standard
 * distribution is already baked into `bracket_slots.source_a_ref` by the
 * generator, so the strategies differ ONLY in how they order fighters, never
 * in how those fighters are placed.
 *
 * Pure functions — no DB, no I/O. The service resolves the data each strategy
 * needs (ratings, pool standings) and delegates here.
 *
 * `by-pool-rank` has no function here on purpose: pool standings are already a
 * ranked list, produced by PoolStandingsService and flattened by
 * `buildCrossPoolSnakeRanking` in bracket-r1-seeding.ts.
 */
import { mulberry32 } from '../scheduling/local-search';
import type { RankedEntrant } from './bracket-r1-seeding';
import { byCodepoint } from './by-codepoint';

export interface SeedableEntrant {
  id: string;
  seed: number | null;
  bibNumber: number | null;
  /**
   * HEMA Ratings id of the fighter behind this registration: the roster row's,
   * else the linked global profile's (the API's `eventHemaRatingsId`). Only
   * `rankByRating` reads it; the other strategies ignore it.
   */
  hemaRatingsId?: string | null;
}

/** Ascending, with a missing value last. */
function ascNullLast(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

/**
 * Registration-seed order (ruling 991): a Fighter's seed sets the ORDER only,
 * like a team's (ruling 982, `rankTeamsBySeed`).
 *
 * The seeded Fighters come first, lowest seed first, then the unseeded. A bib
 * number only breaks a tie, a missing bib last, and the id breaks the rest, so
 * the same Fighters always give the same order. The Fighters are ranked 1..N in
 * that order. Seeds 1, 2, 5, 8 mean "the 4 best", not bracket spots 1, 2, 5, 8.
 *
 * The stored seed is never the rank: a seed may repeat or skip numbers, and the
 * seeding plan keeps one entrant per rank, so a repeated seed would drop a
 * Fighter and a seed (or bib) above the bracket size would place none.
 */
export function rankBySeed(regs: SeedableEntrant[]): RankedEntrant[] {
  const ordered = [...regs].sort(
    (a, b) =>
      ascNullLast(a.seed, b.seed) ||
      ascNullLast(a.bibNumber, b.bibNumber) ||
      byCodepoint(a.id, b.id),
  );
  return ordered.map((reg, idx) => ({ rank: idx + 1, entrantId: reg.id }));
}

/**
 * HEMA weighted-rating order, strongest first.
 *
 * Unrated fighters sort LAST — a missing rating means "we don't know", not
 * "weak", but putting them first would hand them the protected top seeds.
 * Ties break on seed then id so the same inputs always produce the same draw
 * (two fighters on an identical rating is common at the low end, and a bracket
 * that reshuffles on every re-run is not defensible).
 */
export function rankByRating(
  regs: SeedableEntrant[],
  ratings: Map<string, number>,
): RankedEntrant[] {
  const ratingOf = (reg: SeedableEntrant): number | null =>
    reg.hemaRatingsId ? (ratings.get(reg.hemaRatingsId) ?? null) : null;

  const ordered = [...regs].sort((a, b) => {
    const ra = ratingOf(a);
    const rb = ratingOf(b);
    if (ra !== rb) {
      if (ra == null) return 1;
      if (rb == null) return -1;
      return rb - ra;
    }
    const sa = a.seed ?? a.bibNumber;
    const sb = b.seed ?? b.bibNumber;
    if (sa !== sb) {
      if (sa == null) return 1;
      if (sb == null) return -1;
      return sa - sb;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return ordered.map((reg, idx) => ({ rank: idx + 1, entrantId: reg.id }));
}

/**
 * Shuffled order from a stored PRNG seed.
 *
 * The input is sorted by id before shuffling so the result depends only on the
 * seed, never on the order Postgres happened to return rows in — that is what
 * makes a draw replayable months later when someone contests it.
 */
export function rankRandom(regs: SeedableEntrant[], prngSeed: number): RankedEntrant[] {
  const pool = [...regs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rng = mulberry32(prngSeed);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = pool[i] as SeedableEntrant;
    const b = pool[j] as SeedableEntrant;
    pool[i] = b;
    pool[j] = a;
  }
  return pool.map((reg, idx) => ({ rank: idx + 1, entrantId: reg.id }));
}
