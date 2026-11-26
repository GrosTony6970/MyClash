import { addDays, zonedToUtcIso } from '@myclash/time';

/**
 * Where a programme block sits in time: its Event day (`YYYY-MM-DD`) and the
 * UTC instant of its start.
 *
 * A block stores a `dayIndex` off the Event's first day and a wall-clock
 * "HH:MM". That time is read on the EVENT's clock (`tz`), so the instant lands
 * on the same epoch as a Pool's `scheduledStart` and the two sort together.
 * This used to read "08:00" as 08:00 UTC: in Paris in May that is 10:00, so a
 * registration bar sorted after the 09:00 Pools.
 *
 * Null when the start date, the time or the zone cannot be read.
 *
 * Pure: no React, no I/O.
 */
export function programmeBlockStart(
  block: { dayIndex: number; startTime: string },
  eventStartDateIso: string,
  tz: string,
): { day: string; startIso: string } | null {
  const day = addDays(eventStartDateIso, block.dayIndex);
  const startIso = zonedToUtcIso(day, block.startTime, tz);
  if (!day || !startIso) return null;
  return { day, startIso };
}
