/**
 * A referee's declared availability, and the one answer to "is this person available for
 * this?" (ADR-016, ADR-019, rulings 145-147).
 *
 * The organiser ticks Tournaments and days on the roster. No tick on an axis = no restriction
 * on it, including a Tournament or a day added later. A ticked day is a calendar date on the
 * Event's clock with one window — the whole day unless the organiser set a from–to — and the
 * whole of what is refereed must fit inside it, half-open: a duty ending exactly when the window
 * ends fits, one starting then does not.
 *
 * The one checker (`@myclash/rulesets/scheduling/referee-checker`) and the capacity warning
 * (`referee-capacity.ts`) both ask `isAvailableFor`. The API turns the stored minutes into
 * instants on the Event's clock before it builds this; a whole day is midnight to the next
 * midnight there.
 *
 * Pure: no I/O.
 */

export interface AvailabilityWindowMs {
  startMs: number;
  endMs: number;
}

/** One ticked day: its date (`YYYY-MM-DD`, Event clock) and its window on that clock. */
export interface AvailableDay {
  date: string;
  window: AvailabilityWindowMs;
}

/** Declared availability; null = no restriction on that axis. */
export interface RefereeAvailability {
  tournamentIds: readonly string[] | null;
  days: readonly AvailableDay[] | null;
}

export const ANY_AVAILABILITY: RefereeAvailability = { tournamentIds: null, days: null };

/** What would be refereed: its Tournament, its date on the Event's clock, its time; null = untimed. */
export interface AvailabilityAsk {
  tournamentId: string;
  date: string | null;
  window: AvailabilityWindowMs | null;
}

/**
 * True when `availability` allows `ask`. Something untimed is never refused on its day or time.
 * Something that crosses midnight is judged on its start date, so it fails a window that ends first.
 */
export function isAvailableFor(availability: RefereeAvailability, ask: AvailabilityAsk): boolean {
  const { tournamentIds, days } = availability;
  if (tournamentIds !== null && !tournamentIds.includes(ask.tournamentId)) return false;
  if (days === null || ask.date === null) return true;
  const day = days.find((d) => d.date === ask.date);
  if (!day) return false;
  if (ask.window === null) return true;
  return ask.window.startMs >= day.window.startMs && ask.window.endMs <= day.window.endMs;
}
