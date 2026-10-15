import { describe, expect, it } from 'vitest';
import { CSV_EXCEL_FR, CSV_STANDARD } from '@myclash/types';
import { workshopScheduleToCsv, type CsvVenue, type CsvWorkshop } from './workshop-schedule-csv';

const venues: CsvVenue[] = [
  { id: 'v1', name: 'Main Hall', venue_areas: [{ id: 'a2', name: 'Mat B' }] },
  { id: 'v2', name: 'Annex', venue_areas: [] },
];
const TZ = 'Europe/Paris'; // June = UTC+2

const workshops: CsvWorkshop[] = [
  {
    title: 'Longsword Basics',
    category: 'Longsword',
    level: 'beginner',
    capacity: 20,
    instructorNames: ['Rémi Arbache'],
    sessions: [
      {
        startsAt: '2027-06-01T07:00:00.000Z', // 09:00 Paris
        endsAt: '2027-06-01T08:30:00.000Z', // 10:30 Paris
        venueId: 'v1',
        areaId: 'a2',
        confirmedCount: 8,
      },
    ],
  },
  {
    title: 'Jeux, de mains', // comma → must be quoted
    category: null,
    level: null,
    capacity: null,
    instructorNames: [],
    sessions: [
      {
        startsAt: '2027-06-01T06:00:00.000Z', // 08:00 Paris
        endsAt: null,
        venueId: 'v2',
        areaId: null,
        confirmedCount: 3,
      },
    ],
  },
  {
    title: 'Unscheduled',
    category: null,
    level: null,
    capacity: null,
    instructorNames: [],
    sessions: [],
  },
];

describe('workshopScheduleToCsv', () => {
  const HEADERS = [
    'Jour',
    'Lieu',
    'Espace',
    'Début',
    'Fin',
    'Atelier',
    'Instructeur',
    'Catégorie',
    'Niveau',
    'Inscrits',
    'Capacité',
  ] as const;
  const REMOVED = { venue: 'Lieu supprimé', area: 'Espace supprimé' };
  const csv = workshopScheduleToCsv(workshops, venues, TZ, HEADERS, REMOVED, CSV_STANDARD);
  const lines = csv.slice(1).replace(/\r\n$/, '').split('\r\n');

  it('starts with the byte-order mark and the given header, and excludes unscheduled workshops', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(lines[0]).toBe(
      'Jour,Lieu,Espace,Début,Fin,Atelier,Instructeur,Catégorie,Niveau,Inscrits,Capacité',
    );
    expect(lines).toHaveLength(3); // header + 2 scheduled
  });

  it('sorts by day, then venue, then start (Annex before Main Hall)', () => {
    expect(lines[1]).toBe('2027-06-01,Annex,,08:00,,"Jeux, de mains",,,,3,');
  });

  // "8/20" in one cell read as a date in French Excel (ruled 2026-10-15: two number columns).
  it('formats 24h times in the event tz, and the places booked and the capacity as two numbers', () => {
    expect(lines[2]).toBe(
      '2027-06-01,Main Hall,Mat B,09:00,10:30,Longsword Basics,Rémi Arbache,Longsword,beginner,8,20',
    );
  });

  it('for French Excel, splits on ; and quotes the instructors cell, whose names it joins with ;', () => {
    const two = [{ ...workshops[0]!, instructorNames: ['Rémi Arbache', 'Ana Roux'] }];
    const french = workshopScheduleToCsv(two, venues, TZ, HEADERS, REMOVED, CSV_EXCEL_FR);
    expect(french.slice(1).split('\r\n')[1]).toBe(
      '2027-06-01;Main Hall;Mat B;09:00;10:30;Longsword Basics;"Rémi Arbache; Ana Roux";Longsword;beginner;8;20',
    );
  });

  // A deleted venue was written as its database id (ruled 2026-10-15: "Venue removed").
  it('writes a venue or an area deleted since in words, never its id', () => {
    const session = { ...workshops[0]!.sessions[0]!, venueId: 'v-gone', areaId: 'a-gone' };
    const gone = [{ ...workshops[0]!, sessions: [session] }];
    const line = workshopScheduleToCsv(gone, venues, TZ, HEADERS, REMOVED, CSV_STANDARD)
      .slice(1)
      .split('\r\n')[1];
    expect(line).toBe(
      '2027-06-01,Lieu supprimé,Espace supprimé,09:00,10:30,Longsword Basics,Rémi Arbache,Longsword,beginner,8,20',
    );
  });
});
