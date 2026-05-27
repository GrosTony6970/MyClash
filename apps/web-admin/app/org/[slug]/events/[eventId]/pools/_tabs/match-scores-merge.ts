/**
 * Pure score-merge helper used by the pools Matches tab to apply
 * lightweight score updates (from realtime events or the 30s fallback
 * poll) into the existing `pools` state without re-rendering rows
 * whose data didn't actually change.
 *
 * Critical property under test: rows whose updated fields are
 * **identical** to the existing row retain object identity — the same
 * `match` object is returned, so React's reconciler bails out and
 * does not re-render that row (open <select> popups stay open,
 * focused inputs keep focus, the table doesn't flicker).
 */

export interface MatchScoreUpdate {
  id: string;
  status: string;
  red_score: number | null;
  blue_score: number | null;
}

// Minimal shape the helper reads. Callers pass their richer Match
// type and we use a generic parameter to preserve passthrough fields
// (lice_id, referee_id, names, etc.) without forcing an index
// signature on the consumer's type.
export interface MergeableMatch {
  id: string;
  status: string;
  red_score: number | null;
  blue_score: number | null;
}

export interface MergeablePool<M extends MergeableMatch = MergeableMatch> {
  poolId: string;
  poolName: string;
  matches: M[];
}

/**
 * Merge `updates` into `pools` row-by-row. A row is rewritten **only
 * if** at least one of `status / red_score / blue_score` differs from
 * its current value; otherwise the same object reference is returned.
 *
 * `updates.find` is O(n) per row, fine for the small (≤ ~32) match
 * counts the Matches tab handles. If a tournament ever grew well past
 * that, swap to a Map lookup.
 */
export function mergeScores<M extends MergeableMatch>(
  pools: ReadonlyArray<MergeablePool<M>>,
  updates: ReadonlyArray<MatchScoreUpdate>,
): MergeablePool<M>[] {
  if (updates.length === 0) return pools as MergeablePool<M>[];
  return pools.map((pool) => {
    let mutated = false;
    const nextMatches = pool.matches.map((m) => {
      const u = updates.find((row) => row.id === m.id);
      if (!u) return m;
      const changed =
        u.status !== m.status || u.red_score !== m.red_score || u.blue_score !== m.blue_score;
      if (!changed) return m;
      mutated = true;
      return { ...m, status: u.status, red_score: u.red_score, blue_score: u.blue_score };
    });
    return mutated ? { ...pool, matches: nextMatches } : pool;
  });
}
