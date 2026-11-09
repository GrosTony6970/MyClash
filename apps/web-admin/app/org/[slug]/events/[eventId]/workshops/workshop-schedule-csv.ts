/**
 * RFC-4180 CSV of the scheduled workshops, mirroring the pool schedule's
 * Export CSV. Pure: times resolve to 24h `HH:MM` in the event timezone. The
 * page hands in the column titles, in the reader's language (O20).
 */
import { minutesIntoDayInZone, zonedDay } from '@myclash/time';
import { csvFile, type CsvFormat } from '@myclash/types';

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
    /** Its title is marked with the word handed in (ruling 526). */
    cancelled?: boolean;
  }>;
}

/** Day, Venue, Area, Start, End, Workshop, Instructor, Category, Level, Booked, Capacity. */
export type WorkshopCsvHeaders = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

/** The words for a venue or an area deleted since the session was placed in it, and the word that
 *  marks a cancelled session ("Cancelled"). */
export interface WorkshopCsvRemoved {
  venue: string;
  area: string;
  cancelled: string;
}

function hhmm(iso: string, tz: string): string {
  const min = minutesIntoDayInZone(iso, tz);
  if (min === null) return '';
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** One scheduled workshop's line, with the keys it sorts on. */
function rowOf(
  w: CsvWorkshop,
  s: CsvWorkshop['sessions'][number],
  tz: string,
  venue: string,
  area: string,
  cancelledWord: string,
) {
  const day = zonedDay(s.startsAt!, tz) ?? '';
  const start = hhmm(s.startsAt!, tz);
  const end = s.endsAt ? hhmm(s.endsAt, tz) : '';
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
      s.cancelled ? `${w.title} (${cancelledWord})` : w.title,
      w.instructorNames.join('; '),
      w.category ?? '',
      w.level ?? '',
      // Two plain numbers: "8/20" in one cell read as a date in French Excel.
      String(s.confirmedCount ?? 0),
      w.capacity != null ? String(w.capacity) : '',
    ],
  };
}

export function workshopScheduleToCsv(
  workshops: ReadonlyArray<CsvWorkshop>,
  venues: ReadonlyArray<CsvVenue>,
  tz: string,
  headers: WorkshopCsvHeaders,
  removed: WorkshopCsvRemoved,
  format: CsvFormat,
): string {
  const venueName = new Map(venues.map((v) => [v.id, v.name]));
  const areaName = new Map<string, string>();
  for (const v of venues) for (const a of v.venue_areas ?? []) areaName.set(a.id, a.name);

  // One row per placed session: a Workshop may run several (ruling 515).
  const rows = workshops
    .flatMap((w) => w.sessions.map((s) => ({ w, s })))
    .filter((r) => r.s.startsAt && r.s.venueId)
    .map(({ w, s }) => {
      // A venue or an area deleted since is said in words, never by its id (ruled 2026-10-15).
      const venue = venueName.get(s!.venueId!) ?? removed.venue;
      const area = s!.areaId ? (areaName.get(s!.areaId) ?? removed.area) : '';
      return rowOf(w, s!, tz, venue, area, removed.cancelled);
    })
    .sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        a.venue.localeCompare(b.venue) ||
        a.start.localeCompare(b.start),
    );

  // Formula-safe through `csvFile`: workshop titles and instructor names are organiser input.
  return csvFile([headers, ...rows.map((r) => r.cells)], format);
}
