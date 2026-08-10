/**
 * How much of this bracket has actually been fought — the number the
 * regenerate and delete confirmations were missing.
 *
 * Both dialogs used to describe the damage as "the bracket and all its match
 * slots", which is the part an organiser does not mind losing. The bare
 * `DELETE FROM phases` behind them cascades through `matches` to every
 * exchange, penalty card, forfeit-or-override record and referee assignment,
 * and takes each match's piste placement and scheduled time with the row. A
 * bracket with bouts already on record is therefore a destructive delete of
 * results, and the copy said nothing about it.
 *
 * Pure and free of React so the count is pinned by a test rather than derived
 * inline in a modal.
 */

/** The statuses that mean a bout has been on a piste. */
const PLAYED = new Set(['running', 'paused', 'completed']);

/**
 * Slots whose match has been started, paused or finished.
 *
 * Scoped on STATUS, not on the presence of a score: a 0–0 bout that ended in a
 * double-defeat is played, and a forfeit-completed bout carries a score nobody
 * fought for. `voided` and `scheduled` are the two that cost nothing to lose.
 */
export function countPlayedMatches(
  slots: Array<{ status?: string | null; matchId?: string | null }> | null | undefined,
): number {
  if (!slots) return 0;
  return slots.filter((slot) => slot.matchId && PLAYED.has(String(slot.status))).length;
}
