import { addDays, dayStartUtcIso } from '@myclash/time';
import { eventZone } from '../../common/event-clock';

/** Days after an Event's last day that its photos are kept (design, "Storage and deletion"). */
export const PHOTO_KEEP_DAYS = 30;

/**
 * When every photo of an Event is deleted: 00:00 on the 31st day after its last day, on the
 * Event's own clock. The one owner of that date: the expiry job reads it, and so will the admin
 * label and the download button. It follows the current `end_date`, so moving the Event's dates
 * moves it. Null when the end date cannot be read; an unknown zone reads on the default clock.
 */
export function photoDeletionInstant(event: {
  end_date: string | null;
  timezone: unknown;
}): Date | null {
  const day = addDays(event.end_date, PHOTO_KEEP_DAYS + 1);
  const instant = day ? dayStartUtcIso(day, eventZone(event.timezone).zone) : null;
  return instant ? new Date(instant) : null;
}

/**
 * When a phone may send photos to an Event, on the Event's own clock (design, goal 7): from the
 * start of the day before its first day, so the organiser can test a printed QR code on set-up
 * day, to the end of the day after its last day. Half-open: `closesAt` itself is closed.
 *
 * An unknown zone reads the days on the default Event clock, as `eventOpenWindow` does. Null when
 * a date cannot be read.
 */
export function photoUploadWindow(event: {
  start_date: string | null;
  end_date: string | null;
  timezone: unknown;
}): { opensAt: Date; closesAt: Date } | null {
  const { zone } = eventZone(event.timezone);
  const firstDay = addDays(event.start_date, -1);
  const dayAfterAfter = addDays(event.end_date, 2);
  const opensAt = firstDay ? dayStartUtcIso(firstDay, zone) : null;
  const closesAt = dayAfterAfter ? dayStartUtcIso(dayAfterAfter, zone) : null;
  if (!opensAt || !closesAt) return null;
  return { opensAt: new Date(opensAt), closesAt: new Date(closesAt) };
}
