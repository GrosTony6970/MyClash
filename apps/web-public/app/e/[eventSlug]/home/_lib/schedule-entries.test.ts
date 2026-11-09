import { describe, expect, it } from 'vitest';
import { buildWorkshopEntries } from './schedule-entries';
import type { PublicWorkshop } from './public-event-data';

/**
 * The public Workshop agenda (slice 2.1, ruling 515). "Longsword basics" runs Saturday and Sunday:
 * the agenda listed only its earliest session, so Sunday's was missing from the day it runs.
 */
const session = (id: string, startsAt: string | null) => ({
  id,
  startsAt,
  endsAt: null,
  venueId: null,
  areaId: null,
  capacity: 12,
  confirmedCount: 0,
});

const longsword: PublicWorkshop = {
  id: 'w-longsword',
  slug: 'longsword',
  title: 'Longsword basics',
  category: null,
  level: null,
  capacity: 12,
  color: null,
  coverImageUrl: null,
  durationMinutes: 60,
  instructors: [],
  sessions: [
    session('s-sunday', '2027-06-06T12:00:00.000Z'),
    session('s-saturday', '2027-06-05T08:00:00.000Z'),
    session('s-untimed', null),
  ],
};

describe('buildWorkshopEntries', () => {
  it('gives one entry per dated session, each its own id', () => {
    expect(buildWorkshopEntries([longsword], 'fal').map((e) => [e.id, e.startsAt])).toEqual([
      ['w-s-sunday', '2027-06-06T12:00:00.000Z'],
      ['w-s-saturday', '2027-06-05T08:00:00.000Z'],
    ]);
  });
});
