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
 * Split in two because the two callers legitimately differ on a single-round
 * match: the clock's reopen KEEPS its winner, so a bare reopen → end round-trip
 * preserves the result, while a recompute that has just watched the score fall
 * back under the cap must clear it.
 */

/**
 * The result a completed bout was holding, cleared.
 *
 * `paused` and not `running`: the bout has been fought and the clock is not
 * moving. It is the status the clock's own reopen lands on, so the two agree.
 * `started_at` is deliberately left alone — `hasBeenFought` reads it, and a
 * bout that was played stays played.
 */
export function reopenedResultColumns(): Record<string, unknown> {
  return {
    status: 'paused',
    winner_registration_id: null,
    end_reason: null,
    ended_at: null,
  };
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
