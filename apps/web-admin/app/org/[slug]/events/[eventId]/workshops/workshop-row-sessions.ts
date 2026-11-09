/**
 * What the Workshops list says of each session (slice 2.1, ruling 515): its time and its room. A
 * Workshop may run several sessions; the list read only the first.
 */
import { formatInZone } from '@myclash/time';

export interface RowSession {
  startsAt: string | null;
  endsAt: string | null;
  venue: { name: string } | null;
  area: { name: string } | null;
}

/** "Sat 5 Jun, 10:00 – 11:30", in the Event's zone; '—' with no start. */
export function sessionTimeRange(s: RowSession, tz: string, bcp47: string): string {
  if (!s.startsAt) return '—';
  const start = formatInZone(
    s.startsAt,
    tz,
    { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' },
    bcp47,
  );
  if (!s.endsAt) return start;
  return `${start} – ${formatInZone(s.endsAt, tz, { hour: '2-digit', minute: '2-digit' }, bcp47)}`;
}

/** "Main hall · Room A", the session's venue or else the Workshop's; '—' with neither. */
export function sessionPlaceLabel(s: RowSession | null, workshopVenue: string | null): string {
  const venue = s?.venue?.name ?? workshopVenue;
  if (!venue) return '—';
  return s?.area?.name ? `${venue} · ${s.area.name}` : venue;
}
