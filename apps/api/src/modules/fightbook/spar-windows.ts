import { dayStartUtcIso } from '@myclash/time';

const DAY_MS = 24 * 60 * 60 * 1000;
/** "We sparred" and its undo stay open this long after the spar day ends (rulings 680, 681). */
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

/** The windows, from the row alone, on the row's own `zone` (a free-date spar keeps its place's clock). */
export function sparWindows(row: {
  spar_day: string;
  zone: string;
  expires_at: string;
}): SparWindows {
  const ends = new Date(row.expires_at);
  const from = dayStartUtcIso(row.spar_day, row.zone, 0);
  return {
    markFrom: from ? new Date(from) : ends,
    markUntil: new Date(ends.getTime() + MARK_GRACE_MS),
    cancelUntil: ends,
  };
}
