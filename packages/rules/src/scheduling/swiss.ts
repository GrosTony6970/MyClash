/**
 * packages/rules/src/scheduling/swiss.ts
 *
 * Swiss-system pairing. Given the current standings, produce the next round.
 *
 * Unlike `single-elim.ts` / `double-elim.ts` there is no tree here: a Swiss
 * phase has no slot graph, no `winner of R1P2` chaining and nobody is
 * eliminated. Every fighter plays the same number of rounds, each one against
 * somebody on a similar record, and the ranking falls out of the standings.
 *
 * Pure and deterministic — no DB, no I/O, and deliberately **no RNG**. The
 * round-1 random draw happens upstream in `rankRandom(regs, prngSeed)`, which
 * sorts by id before a seeded `mulberry32` shuffle precisely so a contested
 * draw can be replayed months later. Everything here is a function of the
 * ranked input.
 *
 * The round is built in four steps:
 *   1. Bye      — odd field loses its lowest-ranked bye-less fighter first, so
 *                 at most one bye per round holds by construction.
 *   2. Group    — fighters on equal points, or inside the same score band.
 *   3. Downfloat— a group that cannot close sends its lowest-ranked members to
 *                 the next one: one for parity, more if it cannot be paired.
 *   4. Pair     — fold (top half vs bottom half) or adjacent (1v2, 3v4), with
 *                 backtracking to avoid rematches.
 *
 * Steps 3 and 4 are decided together, in `closeBracket`. Choosing the downfloat
 * before searching is what makes an engine force rematches that did not need to
 * happen — see its docstring.
 *
 * Pairing value vs ranking value: Swiss groups fighters on EQUAL value, so it
 * is paired on discrete Swiss points (or organiser-defined score bands) rather
 * than on a continuous ruleset score. A ratio-to-2dp score gives every fighter
 * a unique value, every group collapses to size 1, and the pairing degenerates
 * to a flat 1v2, 3v4 down the table — Swiss-shaped, but not Swiss.
 */

import {
  haveMetLookup,
  idealPairs,
  newBudget,
  searchMatching,
  type IndexPair,
  type SearchBudget,
} from './swiss-matching';

export type SwissGrouping = { kind: 'points' } | { kind: 'scoreBands'; boundaries: number[] };

export type SwissPairingMethod = 'fold' | 'adjacent';

export interface SwissPlayer {
  registrationId: string;
  /** Swiss points so far (win/draw/loss/bye per the phase config). */
  points: number;
  /** The ruleset's own score, when one exists. Only score-band grouping reads it. */
  score: number | null;
  /** Registration ids this fighter has already faced, in any round. */
  opponentIds: string[];
  hadBye: boolean;
  /** Standings rank, 1 = leader. Drives every ordering decision below. */
  rank: number;
}

export interface SwissPairing {
  /** 1-indexed across the whole round, best group first. */
  board: number;
  /**
   * `a` is the higher-ranked fighter of the pair. This is a pairing order, NOT
   * a side assignment — red/blue is decided downstream, and swapping sides must
   * not change who is paired with whom.
   */
  aId: string;
  bId: string;
  /** These two have met before; only ever true when no alternative existed. */
  rematch: boolean;
}

export type SwissWarningCode = 'forced-rematch' | 'no-perfect-matching' | 'singleton-band';

export interface SwissWarning {
  code: SwissWarningCode;
  registrationIds: string[];
}

export interface SwissRoundPlan {
  pairings: SwissPairing[];
  byeRegistrationId: string | null;
  warnings: SwissWarning[];
}

/**
 * Rounds for a field of N: ceil(log2 N), clamped to 3..9.
 *
 * Below 3 the format is meaningless — the standings have not separated anyone.
 * Computed by doubling rather than `Math.log2` so it is exact for every N and
 * never one off at a power of two.
 */
export function recommendedRoundCount(fighterCount: number): number {
  let rounds = 0;
  while (2 ** rounds < fighterCount) rounds += 1;
  return Math.min(9, Math.max(3, rounds));
}

/**
 * Split players into score bands, highest band first.
 *
 * `boundaries` is an ascending list of band edges: [0.2, 0.4] yields three
 * bands — [0.4, ∞), [0.2, 0.4) and (−∞, 0.2). Empty bands are RETURNED, not
 * dropped, because this same function backs the Configure tab's live preview
 * and "0 fighters land here" is the most useful thing an organiser can see
 * about a badly chosen boundary.
 *
 * Boundaries are sorted and de-duplicated defensively. A set of edges has no
 * meaningful order of its own, and a live preview that throws while someone is
 * typing is worse than one that shows the sorted reading; the DTO is where a
 * malformed list is rejected.
 *
 * A null score sorts into the lowest band — "no score recorded" is not a high
 * score, and the fighter still has to be paired with somebody.
 */
export function bandsOf(players: SwissPlayer[], boundaries: number[]): SwissPlayer[][] {
  const edges = [...new Set(boundaries)].sort((a, b) => a - b);
  const bands: SwissPlayer[][] = Array.from({ length: edges.length + 1 }, () => []);

  for (const player of players) {
    const score = player.score;
    // Count how many edges the score has cleared: that is its band index,
    // 0 = below every edge.
    let index = 0;
    if (score !== null) {
      while (index < edges.length && score >= edges[index]!) index += 1;
    }
    bands[index]!.push(player);
  }

  // Highest band first, and ranked within each band.
  return bands.reverse().map((band) => sortByRank(band));
}

/**
 * Pair one Swiss round from the current standings.
 *
 * `players` is the field still in the tournament — withdrawn fighters are
 * filtered out by the caller, since their played results stand but they take no
 * further part.
 */
export function planSwissRound(
  players: SwissPlayer[],
  opts: { pairingMethod: SwissPairingMethod; grouping: SwissGrouping },
): SwissRoundPlan {
  const warnings: SwissWarning[] = [];
  const field = sortByRank(players);
  if (field.length === 0) return { pairings: [], byeRegistrationId: null, warnings };

  // 1. Bye, taken BEFORE grouping so the remaining field is even and every
  //    group can be closed by downfloating alone.
  const { bye, rest } = takeBye(field);

  // 2. Group.
  const groups =
    opts.grouping.kind === 'scoreBands'
      ? bandsOf(rest, opts.grouping.boundaries)
      : groupByPoints(rest);

  if (opts.grouping.kind === 'scoreBands') {
    // Only warned about for bands: a singleton POINTS group is ordinary (one
    // fighter on a unique record), but a singleton BAND means the organiser
    // picked an edge that isolates somebody, which is worth telling them.
    for (const group of groups) {
      if (group.length === 1) {
        warnings.push({ code: 'singleton-band', registrationIds: [group[0]!.registrationId] });
      }
    }
  }

  // 3 + 4. Downfloat and pair, best group first.
  const pairings: SwissPairing[] = [];
  const budget = newBudget();
  let carried: SwissPlayer[] = [];

  for (let i = 0; i < groups.length; i += 1) {
    const isLast = i === groups.length - 1;
    const bracket = sortByRank([...carried, ...groups[i]!]);

    const closed = closeBracket(bracket, opts.pairingMethod, isLast, budget, warnings);
    carried = closed.floated;
    pairings.push(
      ...closed.indexPairs.map(([x, y], offset) =>
        toPairing(bracket[x]!, bracket[y]!, pairings.length + offset, closed.met(x, y), warnings),
      ),
    );
  }

  return { pairings, byeRegistrationId: bye?.registrationId ?? null, warnings };
}

// ── Internals ────────────────────────────────────────────────────────────────

function sortByRank(players: SwissPlayer[]): SwissPlayer[] {
  // Id breaks the tie so two fighters sharing a rank cannot make the whole
  // round depend on the order Postgres happened to return rows in.
  return [...players].sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.registrationId < b.registrationId ? -1 : a.registrationId > b.registrationId ? 1 : 0),
  );
}

/**
 * Odd field → the lowest-ranked fighter who has not had a bye yet.
 *
 * Once everybody has had one (a short field over many rounds) it falls back to
 * the lowest-ranked overall, so a round can always be closed. Even fields take
 * no bye at all.
 */
function takeBye(field: SwissPlayer[]): { bye: SwissPlayer | null; rest: SwissPlayer[] } {
  if (field.length % 2 === 0) return { bye: null, rest: field };

  let chosen: SwissPlayer | null = null;
  for (let i = field.length - 1; i >= 0; i -= 1) {
    if (!field[i]!.hadBye) {
      chosen = field[i]!;
      break;
    }
  }
  chosen ??= field[field.length - 1]!;

  return { bye: chosen, rest: field.filter((p) => p.registrationId !== chosen.registrationId) };
}

/** Fighters on equal points, best group first, ranked within each group. */
function groupByPoints(players: SwissPlayer[]): SwissPlayer[][] {
  const byPoints = new Map<number, SwissPlayer[]>();
  for (const player of players) {
    const bucket = byPoints.get(player.points);
    if (bucket) bucket.push(player);
    else byPoints.set(player.points, [player]);
  }
  return [...byPoints.keys()]
    .sort((a, b) => b - a)
    .map((points) => sortByRank(byPoints.get(points)!));
}

/**
 * Close one bracket: pair as much of it as can be paired without a rematch,
 * and float the remainder down.
 *
 * The downfloat is ESCALATING, which is the part that stops the engine forcing
 * avoidable rematches. Fixing bracket membership before searching means a
 * bracket can be handed two fighters who have already met while a perfectly
 * legal pairing existed one group down — a 4-fighter field hits this in round 3.
 * So the largest even prefix that pairs cleanly wins, and everyone below it
 * floats. This is what FIDE does when a bracket cannot be paired, and it only
 * ever triggers where the plain downfloat would have failed.
 *
 * The last bracket cannot float — the field is even, so it has to close. That
 * is the only place a forced rematch can happen, and it is warned about rather
 * than thrown: a running event cannot stall on a pairing search.
 */
function closeBracket(
  bracket: SwissPlayer[],
  method: SwissPairingMethod,
  isLast: boolean,
  budget: SearchBudget,
  warnings: SwissWarning[],
): { indexPairs: IndexPair[]; floated: SwissPlayer[]; met: (i: number, j: number) => boolean } {
  const met = haveMetLookup(bracket);

  if (isLast) {
    if (bracket.length === 0) return { indexPairs: [], floated: [], met };
    const solved = searchMatching(bracket, met, method, bracket.length, budget);
    if (solved) return { indexPairs: solved, floated: [], met };

    warnings.push({
      code: 'no-perfect-matching',
      registrationIds: bracket.map((p) => p.registrationId),
    });
    return { indexPairs: idealPairs(bracket.length, method), floated: [], met };
  }

  // Largest even prefix first, shrinking by two so parity is never broken.
  for (let size = bracket.length - (bracket.length % 2); size >= 2; size -= 2) {
    const solved = searchMatching(bracket, met, method, size, budget);
    if (solved) return { indexPairs: solved, floated: bracket.slice(size), met };
  }
  return { indexPairs: [], floated: bracket, met };
}

function toPairing(
  a: SwissPlayer,
  b: SwissPlayer,
  boardIndex: number,
  rematch: boolean,
  warnings: SwissWarning[],
): SwissPairing {
  if (rematch) {
    warnings.push({
      code: 'forced-rematch',
      registrationIds: [a.registrationId, b.registrationId],
    });
  }
  return { board: boardIndex + 1, aId: a.registrationId, bId: b.registrationId, rematch };
}
