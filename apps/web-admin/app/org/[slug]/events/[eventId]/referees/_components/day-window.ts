/**
 * A ticked day's from–to on the roster, between the two time boxes and the minutes the API
 * stores (ruling 146: one window per day, minutes into the day on the Event's clock).
 *
 * An empty "from" is the day's start and an empty "until" its end, so both empty is the whole
 * day and "until 16:00" needs one box. A window covering the whole day is none.
 *
 * Pure: no I/O, no React.
 */

const DAY_MINUTES = 1440;

/** Both minutes, or both null for the whole day. */
export type DayWindow =
  { fromMinute: null; toMinute: null } | { fromMinute: number; toMinute: number };

export const WHOLE_DAY: DayWindow = { fromMinute: null, toMinute: null };

/** One ticked day and its window, as the roster reads it. */
export type DayTick = { date: string } & DayWindow;

/** The availability write's `days`: a whole day sends no minutes, a window sends both. */
export function daysBody(
  days: readonly DayTick[],
): Array<{ date: string; fromMinute?: number; toMinute?: number }> {
  return days.map((d) =>
    d.fromMinute === null
      ? { date: d.date }
      : { date: d.date, fromMinute: d.fromMinute, toMinute: d.toMinute },
  );
}

const hhmm = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

const minutesOf = (text: string) => {
  const [h, m] = text.split(':').map(Number);
  return h! * 60 + m!;
};

/** The two boxes' text (canonical `HH:MM`, or '' for the day's edge) for a stored window. */
export function windowText(window: DayWindow): { from: string; until: string } {
  if (window.fromMinute === null) return { from: '', until: '' };
  return {
    from: window.fromMinute === 0 ? '' : hhmm(window.fromMinute),
    until: window.toMinute === DAY_MINUTES ? '' : hhmm(window.toMinute),
  };
}

/** The window two boxes say, or null when it does not run forward. */
export function windowOfText(from: string, until: string): DayWindow | null {
  const fromMinute = from === '' ? 0 : minutesOf(from);
  const toMinute = until === '' ? DAY_MINUTES : minutesOf(until);
  if (fromMinute >= toMinute) return null;
  if (fromMinute === 0 && toMinute === DAY_MINUTES) return WHOLE_DAY;
  return { fromMinute, toMinute };
}
