import { dayStartUtcIso } from '@myclash/time';

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * "We sparred" and its undo stay open this long after the spar day ends (rulings 680, 681). Its
 * SQL twin is `interval '48 hours'` in `fightbook_review` (0267), the database's own check that a
 * review opens; `spar-windows.test.ts` holds the two equal.
 */
export const MARK_GRACE_MS = 2 * DAY_MS;

/** What a spar request's own columns say about when each after-the-spar action is open. */
export interface SparWindows {
  /** 00:00 of the spar day on the spar's own clock: "We sparred" opens. */
  markFrom: Date;
  /** Two days after the day ends: "We sparred" and its undo close; a review opens. */
  markUntil: Date;
  /** The day's end: a cancel closes. */
  cancelUntil: Date;
}

/**
 * The windows, from the row alone, on the row's own `zone` (a free-date spar keeps its place's
 * clock). A day start that cannot be computed (a zone the clock cannot read) throws: no window is
 * guessed.
 */
export function sparWindows(row: {
  spar_day: string;
  zone: string;
  expires_at: string;
}): SparWindows {
  const ends = new Date(row.expires_at);
  const from = dayStartUtcIso(row.spar_day, row.zone, 0);
  if (from === null) throw new Error(`spar windows: no day start in zone ${row.zone}`);
  return {
    markFrom: new Date(from),
    markUntil: new Date(ends.getTime() + MARK_GRACE_MS),
    cancelUntil: ends,
  };
}
