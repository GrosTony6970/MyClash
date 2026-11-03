import { addDays, dayStartUtcIso } from '@myclash/time';
import { eventZone } from './event-clock';

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
 * The zone is `eventZone`'s (`event-clock.ts`): an unknown one reads the days in
 * the default zone and says so through `unknownZone` for the caller to log, with
 * `unknownZoneWarning`. Null when a date cannot be read: the columns are DATE
 * NOT NULL, so only a lost projection or a hand-made row gets there.
 */
export function eventOpenWindow(event: {
  start_date: string | null;
  end_date: string | null;
  timezone: string | null | undefined;
}): EventOpenWindow | null {
  const { zone, unknownZone } = eventZone(event.timezone);
  const opensAt = event.start_date ? dayStartUtcIso(event.start_date, zone) : null;
  const closingDay = addDays(event.end_date, 1);
  const closesAt = closingDay ? dayStartUtcIso(closingDay, zone, EVENT_CLOSING_HOUR) : null;
  if (!opensAt || !closesAt) return null;
  return { opensAt: new Date(opensAt), closesAt: new Date(closesAt), unknownZone };
}
