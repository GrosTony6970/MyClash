/**
 * Which entry of a bout is the newest: the last line of its list on the pad.
 *
 * The list is ordered by `ascendingWithNumbers` of `@myclash/ui`: the time an
 * entry was scored, then its sequence, an unreadable time last. This is that
 * order again, for the undo, which must take back the line the scorekeeper
 * sees last. It is a second statement of one rule ON PURPOSE: the queue's
 * store cannot load the UI package, and `newest-entry.test.ts` holds the two
 * together over the same rows.
 */
export interface Scored {
  occurredAt: string;
  sequence: number;
}

function instant(occurredAt: string): number {
  const ms = Date.parse(occurredAt);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/** The row that sits last in the bout's list, or undefined for no row. */
export function newestOf<T>(rows: readonly T[], scored: (row: T) => Scored): T | undefined {
  let newest: T | undefined;
  for (const row of rows) {
    if (newest === undefined || !isBefore(scored(row), scored(newest))) newest = row;
  }
  return newest;
}

function isBefore(a: Scored, b: Scored): boolean {
  const byTime = instant(a.occurredAt) - instant(b.occurredAt);
  // Two unreadable times are Infinity minus Infinity: the sequence decides.
  return Number.isNaN(byTime) || byTime === 0 ? a.sequence < b.sequence : byTime < 0;
}
