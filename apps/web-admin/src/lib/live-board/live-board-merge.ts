import type { BoardRow, MatchChange } from './types';

/**
 * Patch a realtime `matches` change into the current board rows. Pure: touches
 * only the row whose current match matches `change.id`, leaves every other row
 * (and the array reference, when nothing matches) untouched so React can skip
 * re-renders. Signals `shouldRefetch` when the current bout ended so the caller
 * can roll the lice to its next match without waiting for the structural poll.
 */
export function mergeRealtimePatch(
  rows: BoardRow[],
  change: MatchChange,
): { rows: BoardRow[]; shouldRefetch: boolean } {
  let matched = false;
  const next = rows.map((r) => {
    if (r.currentMatch && r.currentMatch.id === change.id) {
      matched = true;
      return {
        ...r,
        currentMatch: {
          ...r.currentMatch,
          redScore: change.redScore ?? r.currentMatch.redScore,
          blueScore: change.blueScore ?? r.currentMatch.blueScore,
          status: change.status ?? r.currentMatch.status,
          round: change.round ?? r.currentMatch.round,
        },
      };
    }
    return r;
  });
  const shouldRefetch = matched && (change.status === 'completed' || change.status === 'void');
  return { rows: matched ? next : rows, shouldRefetch };
}
