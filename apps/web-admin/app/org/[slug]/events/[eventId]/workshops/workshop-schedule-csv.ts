/**
 * RFC-4180 CSV of the scheduled workshops, mirroring the pool schedule's
 * Export CSV. Pure: times resolve to 24h `HH:MM` in the event timezone.
 */
import { minutesIntoDayInZone, zonedDay } from '@myclash/time';
import { escapeCsvCell } from '@myclash/types';

export interface CsvVenue {
  id: string;
  name: string;
  venue_areas?: Array<{ id: string; name: string }> | null;
}

export interface CsvWorkshop {
  title: string;
  category: string | null;
  level: string | null;
  capacity: number | null;
  instructorNames: string[];
  sessions: Array<{
    startsAt: string | null;
    endsAt: string | null;
    venueId: string | null;
    areaId: string | null;
    confirmedCount?: number;
  }>;
}

const HEADER = 'Day,Venue,Area,Start,End,Workshop,Instructor,Category,Level,Slots';

function hhmm(iso: string, tz: string): string {
  const min = minutesIntoDayInZone(iso, tz);
  if (min === null) return '';
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/**
 * Formula-safe: the workshop schedule is downloaded and opened in a spreadsheet,
 * and workshop titles and instructor names come from organiser input.
 * See @myclash/types/csv.
 */
const esc = escapeCsvCell;

export function workshopScheduleToCsv(
  workshops: ReadonlyArray<CsvWorkshop>,
  venues: ReadonlyArray<CsvVenue>,
  tz: string,
): string {
  const venueName = new Map(venues.map((v) => [v.id, v.name]));
  const areaName = new Map<string, string>();
  for (const v of venues) for (const a of v.venue_areas ?? []) areaName.set(a.id, a.name);

  const rows = workshops
    .map((w) => ({ w, s: w.sessions[0] }))
    .filter((r) => r.s?.startsAt && r.s.venueId)
    .map(({ w, s }) => {
      const day = zonedDay(s!.startsAt!, tz) ?? '';
      const venue = venueName.get(s!.venueId!) ?? s!.venueId!;
      const area = s!.areaId ? (areaName.get(s!.areaId) ?? s!.areaId) : '';
      const start = hhmm(s!.startsAt!, tz);
      const end = s!.endsAt ? hhmm(s!.endsAt, tz) : '';
      const confirmed = s!.confirmedCount ?? 0;
      const slots = w.capacity != null ? `${confirmed}/${w.capacity}` : String(confirmed);
      return {
        day,
        venue,
        start,
        cells: [
          day,
          venue,
          area,
          start,
          end,
          w.title,
          w.instructorNames.join('; '),
          w.category ?? '',
          w.level ?? '',
          slots,
        ],
      };
    })
    .sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        a.venue.localeCompare(b.venue) ||
        a.start.localeCompare(b.start),
    );

  return [HEADER, ...rows.map((r) => r.cells.map((c) => esc(String(c))).join(','))].join('\n');
}
