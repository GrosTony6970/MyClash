import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The public Workshop grid shows every session (slice 2.1, ruling 515). "Longsword basics" runs
 * Saturday in the Main hall and Sunday in a room the grid does not show. The grid read only the
 * first session: Sunday was neither drawn nor listed, and a Sunday-only day had no tab.
 */
vi.mock('../../../_lib/event-or-not-found', () => ({
  eventOrNotFound: vi.fn(async () => ({
    timezone: 'Europe/Paris',
    startDate: '2027-06-05',
    endDate: '2027-06-05',
  })),
}));
const workshops = vi.fn();
vi.mock('../../../home/_lib/public-event-data', () => ({
  fetchWorkshops: () => workshops(),
  fetchVenues: async () => [
    { id: 'v-hall', name: 'Main hall', hosts_workshop: true, venue_areas: [] },
  ],
  fetchWorkshopBreaks: async () => [],
}));

const { loadWorkshopSchedule } = await import('./workshop-grid-data');

const session = (
  id: string,
  startsAt: string | null,
  venueId: string | null,
  status = 'scheduled',
) => ({
  id,
  startsAt,
  endsAt: null,
  venueId,
  areaId: null,
  status,
  capacity: 12,
  confirmedCount: 0,
});
const workshop = (id: string, sessions: ReturnType<typeof session>[]) => ({
  id,
  slug: id,
  title: id,
  category: null,
  level: null,
  capacity: 12,
  color: null,
  coverImageUrl: null,
  durationMinutes: 60,
  instructors: [],
  sessions,
});

beforeEach(() => workshops.mockReset());

describe('the public Workshop grid, a Workshop with several sessions', () => {
  it('draws each placed session, gives its day a tab, and lists each it cannot place', async () => {
    workshops.mockResolvedValue([
      workshop('longsword', [
        session('s-saturday', '2027-06-05T08:00:00.000Z', 'v-hall'),
        // Sunday is outside the Event's dates: its day is added at the end.
        session('s-sunday', '2027-06-06T08:00:00.000Z', 'v-hall'),
        session('s-elsewhere', '2027-06-06T12:00:00.000Z', 'v-gone'),
        session('s-untimed', null, 'v-hall'),
      ]),
      workshop('dagger', []),
    ]);

    const data = await loadWorkshopSchedule('fal', 'https://api.test');

    expect(data.days.map((d) => d.dayKey)).toEqual(['2027-06-05', '2027-06-06']);
    expect(data.blocks.map((b) => [b.sessionId, b.dayIndex])).toEqual([
      ['s-saturday', 0],
      ['s-sunday', 1],
    ]);
    expect(data.unplaced.map((u) => u.key)).toEqual(['s-elsewhere']);
    expect(data.undated.map((u) => u.key)).toEqual(['dagger', 's-untimed']);
  });

  it('keeps a cancelled session on the grid and in its lists, marked (ruling 526)', async () => {
    workshops.mockResolvedValue([
      workshop('longsword', [
        session('s-saturday', '2027-06-05T08:00:00.000Z', 'v-hall', 'cancelled'),
        session('s-elsewhere', '2027-06-05T12:00:00.000Z', 'v-gone', 'cancelled'),
        session('s-sunday', '2027-06-05T14:00:00.000Z', 'v-hall'),
      ]),
    ]);

    const data = await loadWorkshopSchedule('fal', 'https://api.test');

    expect(data.blocks.map((b) => [b.sessionId, b.cancelled])).toEqual([
      ['s-saturday', true],
      ['s-sunday', false],
    ]);
    expect(data.unplaced.map((u) => [u.key, u.cancelled])).toEqual([['s-elsewhere', true]]);
  });
});
