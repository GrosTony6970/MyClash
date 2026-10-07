/**
 * "This bout stopped being completed", as column sets.
 *
 * Sibling of `unplayedMatchColumns`, and here for the same reason: the answer
 * was about to be written a second time. Two paths take a bout back out of
 * `completed` without resetting it — the clock's `reopen` action, and a
 * recompute that finds the end condition no longer holds because the penalty
 * that ended the bout was voided. They must agree on which columns move.
 *
 * `MatchCompletionService.onMatchUncompleted` does NOT do this: it owns the
 * SIDE EFFECTS of an un-completion (clearing fed bracket sides, reverting
 * dependents that were already fought, voiding forfeits, re-opening the Swiss
 * round) and deliberately leaves the row to its caller — which is why it must be
 * called BEFORE the write, so a refusal leaves nothing half-done.
 *
 * They agree since ruling 331: no bout back in play keeps a winner. The
 * clock's reopen kept it once, for a bare reopen → end round-trip, and a later
 * End then named that winner whatever the board said (`winnerColorFrom` reads a
 * recorded winner first).
 */

/**
 * The result columns of a bout put back in play, running or paused (ruling
 * 331). A voided bout keeps its own. `started_at` is deliberately left alone —
 * `hasBeenFought` reads it, and a bout that was played stays played.
 */
export function noResultColumns(): Record<string, unknown> {
  return { winner_registration_id: null, end_reason: null, ended_at: null };
}

/**
 * The result a completed bout was holding, cleared.
 *
 * `paused` and not `running`: the bout has been fought and the clock is not
 * moving. It is the status the clock's own reopen lands on, so the two agree.
 */
export function reopenedResultColumns(): Record<string, unknown> {
  return { status: 'paused', ...noResultColumns() };
}

/**
 * Pop the last closed round of a best-of match so it reopens for correction,
 * and clear the series result the closure may have set.
 *
 * Returns `null` when there is no closed round to pop, which is how a
 * single-round match falls through to its caller's own handling.
 *
 * `current_round` goes back to the popped round's own number rather than
 * `currentRound - 1`: the closed round IS the one being reopened, and the two
 * only coincide while nothing has advanced past it.
 */
export function popLastClosedRoundColumns(
  roundsJson: unknown,
  fallbackCurrentRound: number,
): Record<string, unknown> | null {
  if (!Array.isArray(roundsJson) || roundsJson.length === 0) return null;
  const rounds = [...(roundsJson as Record<string, unknown>[])];
  const popped = rounds.pop() as { round?: number } | undefined;
  return {
    rounds_json: rounds.length ? rounds : null,
    red_round_wins: rounds.filter((r) => (r as { winnerColor?: string }).winnerColor === 'red')
      .length,
    blue_round_wins: rounds.filter((r) => (r as { winnerColor?: string }).winnerColor === 'blue')
      .length,
    current_round: typeof popped?.round === 'number' ? popped.round : fallbackCurrentRound,
    awaiting_round_advance: false,
    winner_registration_id: null,
    end_reason: null,
  };
}

/**
 * The clock's Reopen of a best-of series: pop the round whose close ended the
 * series, and no other.
 *
 * A forfeit, a black card or an override before the end completes a series and
 * closes no round. The last closed round is then one the series had already
 * moved past, or one it still waits to advance from. Popped, a round ended on
 * time is lost: its sheet cannot give it back.
 */
export function popClinchingRoundColumns(
  row: Record<string, unknown>,
): Record<string, unknown> | null {
  const current = row['current_round'] as number;
  const closed = Array.isArray(row['rounds_json']) ? row['rounds_json'] : [];
  const last = closed[closed.length - 1] as { round?: number } | undefined;
  if (row['awaiting_round_advance'] || last?.round !== current) return null;
  return popLastClosedRoundColumns(closed, current);
}
