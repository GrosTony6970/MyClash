import { addDays, dayStartUtcIso, DEFAULT_EVENT_TIMEZONE, isIanaZone } from '@myclash/time';

/**
 * Ruling 154: an Event's last day ends at this hour, local time, on the morning
 * after its `end_date`, so a final that runs past midnight keeps scoring.
 */
export const EVENT_CLOSING_HOUR = 6;

export interface EventOpenWindow {
  /** 00:00 on `start_date`, in the Event's zone. */
  opensAt: Date;
  /** 06:00 on the day after `end_date`, in the Event's zone. */
  closesAt: Date;
  /** The stored zone is not an IANA zone, so the days were read in the default zone. */
  unknownZone: boolean;
}

/**
 * When an Event opens and closes, on its own clock: the one owner of that rule,
 * read by the status ticker and the staff sign-in expiry (rulings 152, 154, 155).
 *
 * A zone that is not an IANA name reads the days in `DEFAULT_EVENT_TIMEZONE`,
 * the fallback every other API reader uses, and says so through `unknownZone`
 * for the caller to log. Null when a date cannot be read: the columns are DATE
 * NOT NULL, so only a lost projection or a hand-made row gets there.
 */
export function eventOpenWindow(event: {
  start_date: string | null;
  end_date: string | null;
  timezone: string | null | undefined;
}): EventOpenWindow | null {
  const zone = isIanaZone(event.timezone) ? (event.timezone as string) : DEFAULT_EVENT_TIMEZONE;
  const unknownZone = zone !== event.timezone;
  const opensAt = event.start_date ? dayStartUtcIso(event.start_date, zone) : null;
  const closingDay = addDays(event.end_date, 1);
  const closesAt = closingDay ? dayStartUtcIso(closingDay, zone, EVENT_CLOSING_HOUR) : null;
  if (!opensAt || !closesAt) return null;
  return { opensAt: new Date(opensAt), closesAt: new Date(closesAt), unknownZone };
}

/** The warning each caller logs for `unknownZone`. The zone is quoted: an organiser typed it. */
export function unknownZoneWarning(eventId: string, timezone: unknown): string {
  return `Event ${eventId}: unknown time zone ${JSON.stringify(timezone)}; days read in ${DEFAULT_EVENT_TIMEZONE}`;
}
