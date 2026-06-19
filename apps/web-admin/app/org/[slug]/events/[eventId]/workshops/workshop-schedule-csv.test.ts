import { describe, expect, it } from 'vitest';
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
  const lines = workshopScheduleToCsv(workshops, venues, TZ).split('\n');

  it('starts with the header and excludes unscheduled workshops', () => {
    expect(lines[0]).toBe('Day,Venue,Area,Start,End,Workshop,Instructor,Category,Level,Slots');
    expect(lines).toHaveLength(3); // header + 2 scheduled
  });

  it('sorts by day, then venue, then start (Annex before Main Hall)', () => {
    expect(lines[1]).toBe('2027-06-01,Annex,,08:00,,"Jeux, de mains",,,,3');
  });

  it('formats 24h times in the event tz and shows slots/capacity', () => {
    expect(lines[2]).toBe(
      '2027-06-01,Main Hall,Mat B,09:00,10:30,Longsword Basics,Rémi Arbache,Longsword,beginner,8/20',
    );
  });
});
