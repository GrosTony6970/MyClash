import { initialDay } from '@myclash/schedule-core';

/**
 * The day the schedule board opens on. The page draws the board again after each Generate and
 * each Save of the planner: it then opens on the day it showed, while the Event still has that
 * day. Else today when the Event runs today (O6), else day 1.
 */
export function boardOpeningDay(
  days: string[],
  timezone: string,
  nowIso: string,
  kept: string | null | undefined,
): string | undefined {
  if (kept && days.includes(kept)) return kept;
  return initialDay(days, timezone, nowIso) ?? days[0];
}
