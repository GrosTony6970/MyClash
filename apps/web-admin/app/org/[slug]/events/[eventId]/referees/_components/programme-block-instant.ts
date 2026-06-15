/**
 * Absolute start instant (ISO) of a programme block, from its `dayIndex`
 * + `startTime` ("HH:MM") relative to the event's start date. Block times
 * are treated as UTC so they line up, on one epoch, with the pool match
 * times the referee board already plots — letting breaks be ordered
 * against pool rows. The block's own "HH:MM" strings are shown verbatim
 * for the label, so display never depends on this conversion.
 *
 * Pure: no React, no I/O.
 */
export function programmeBlockStartIso(
  block: { dayIndex: number; startTime: string },
  eventStartDateIso: string,
): string {
  const base = new Date(`${eventStartDateIso}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + block.dayIndex);
  const date = base.toISOString().slice(0, 10);
  return `${date}T${block.startTime}:00.000Z`;
}
