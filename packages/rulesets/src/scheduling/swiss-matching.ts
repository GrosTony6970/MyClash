/**
 * packages/rulesets/src/scheduling/swiss-matching.ts
 *
 * The pairing search underneath `swiss.ts`.
 *
 * Split out for the same reason `double-elim-slots.ts` is: `swiss.ts` decides
 * WHO belongs in a bracket (bye, score groups, downfloat), and this module
 * decides how the fighters in one bracket get paired off. Keeping them apart
 * means the round-construction rules can be read without the graph search, and
 * the search can be reasoned about without the tournament vocabulary.
 *
 * Pure and deterministic — same input, same pairs, every time.
 */

import type { SwissPairingMethod, SwissPlayer } from './swiss';

/** A pair of indices into the bracket array. */
export type IndexPair = [number, number];

/**
 * Node-visit ceiling for the rematch-avoidance search, shared across a whole
 * round rather than per bracket.
 *
 * Rematch avoidance is a perfect-matching problem, so a pathological bracket
 * can blow up. An unconstrained bracket costs only size/2 visits, so the
 * ceiling is approached only by a genuinely tangled field — and when it is hit,
 * the round is emitted WITH a rematch and a warning rather than throwing. An
 * event in progress cannot be allowed to stall on a pairing search, and
 * La Ronde Suisse already permits rematches "in very rare cases where this is
 * unavoidable".
 */
export const SEARCH_BUDGET = 10_000;

export interface SearchBudget {
  left: number;
}

export const newBudget = (): SearchBudget => ({ left: SEARCH_BUDGET });

/** Symmetric "these two have already played" test over bracket indices. */
export function haveMetLookup(bracket: SwissPlayer[]): (i: number, j: number) => boolean {
  const indexById = new Map(bracket.map((p, i) => [p.registrationId, i]));
  const met = bracket.map(() => new Set<number>());
  bracket.forEach((player, i) => {
    for (const opponentId of player.opponentIds) {
      // Opponents outside this bracket — withdrawn, or simply in another score
      // group — cannot constrain it and are skipped rather than looked up.
      const j = indexById.get(opponentId);
      if (j !== undefined) {
        met[i]!.add(j);
        met[j]!.add(i);
      }
    }
  });
  return (i, j) => met[i]!.has(j);
}

/**
 * Where the pairing method WANTS each index to be paired.
 *
 * fold     — rank i against i + size/2, i.e. top half vs bottom half (FIDE).
 * adjacent — 1v2, 3v4 straight down the table (score7).
 *
 * Used as the search's preference order, so with no rematches in the way the
 * backtracking reproduces the method's pairing exactly.
 */
function idealPartnerIndex(size: number, method: SwissPairingMethod): (index: number) => number {
  if (method === 'fold') {
    const half = size / 2;
    return (index) => (index < half ? index + half : index - half);
  }
  return (index) => (index % 2 === 0 ? index + 1 : index - 1);
}

/** The method's pairing with no rematch avoidance at all — the fallback. */
export function idealPairs(size: number, method: SwissPairingMethod): IndexPair[] {
  const pairs: IndexPair[] = [];
  if (method === 'fold') {
    const half = size / 2;
    for (let i = 0; i < half; i += 1) pairs.push([i, i + half]);
  } else {
    for (let i = 0; i < size; i += 2) pairs.push([i, i + 1]);
  }
  return pairs;
}

/**
 * Depth-first search for a rematch-free perfect matching over the top `size`
 * fighters of the bracket.
 *
 * Always pairs the highest-ranked unpaired fighter next, trying candidates in
 * order of distance from the method's ideal partner — so the first solution
 * found is the one closest to what the organiser asked for, and an
 * unconstrained bracket returns the ideal pairing on the first probe.
 *
 * Returns null when the fighters cannot be paired without a rematch OR the
 * budget ran out. The caller cannot tell those apart and treats both the same
 * way, which is deliberate: both mean "not from here".
 */
export function searchMatching(
  bracket: SwissPlayer[],
  met: (i: number, j: number) => boolean,
  method: SwissPairingMethod,
  size: number,
  budget: SearchBudget,
): IndexPair[] | null {
  const idealPartner = idealPartnerIndex(size, method);

  const solve = (available: number[]): IndexPair[] | null => {
    if (available.length === 0) return [];
    if (budget.left <= 0) return null;
    budget.left -= 1;

    const a = available[0]!;
    const ideal = idealPartner(a);
    const candidates = available
      .slice(1)
      .sort((x, y) => Math.abs(x - ideal) - Math.abs(y - ideal) || x - y);

    for (const b of candidates) {
      if (met(a, b)) continue;
      const rest = available.filter((idx) => idx !== a && idx !== b);
      const sub = solve(rest);
      if (sub) return [[a, b], ...sub];
    }
    return null;
  };

  return solve(Array.from({ length: size }, (_, i) => i));
}
