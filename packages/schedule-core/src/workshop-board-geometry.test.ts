import { describe, expect, it } from 'vitest';
import {
  buildAreaColumns,
  buildColumnBands,
  buildWorkshopSessionBlocks,
  columnKey,
  unplacedSessions,
  type BoardVenue,
  type BoardWorkshop,
} from './workshop-board-geometry';

const venues: BoardVenue[] = [
  {
    id: 'v1',
    name: 'Main Hall',
    venue_areas: [
      { id: 'a1', name: 'Mat A' },
      { id: 'a2', name: 'Mat B' },
    ],
  },
  { id: 'v2', name: 'Annex', venue_areas: [] },
];

describe('buildAreaColumns', () => {
  it('emits one column per area, and a venue-level column when a venue has no areas', () => {
    const cols = buildAreaColumns(venues);
    expect(cols.map((c) => c.key)).toEqual([
      columnKey('v1', 'a1'),
      columnKey('v1', 'a2'),
      columnKey('v2', null),
    ]);
    expect(cols[2]).toMatchObject({ venueId: 'v2', areaId: null, areaName: null });
  });
});

describe('buildColumnBands', () => {
  it('groups consecutive same-venue columns into bands', () => {
    const bands = buildColumnBands(buildAreaColumns(venues));
    expect(bands).toEqual([
      { venueId: 'v1', venueName: 'Main Hall', startIndex: 0, span: 2 },
      { venueId: 'v2', venueName: 'Annex', startIndex: 2, span: 1 },
    ]);
  });
});

const columns = buildAreaColumns(venues);

function workshop(over: Partial<BoardWorkshop> & { id: string }): BoardWorkshop {
  return {
    title: over.id,
    durationMinutes: null,
    sessions: [],
    ...over,
  };
}

// Paris is CEST (UTC+2) on these June dates: 09:00 local = 07:00Z, 08:00 = 06:00Z.
const TZ = 'Europe/Paris';

describe('buildWorkshopSessionBlocks', () => {
  it('places a session on its area column at the right slot/span (in event tz)', () => {
    const ws: BoardWorkshop[] = [
      workshop({
        id: 'w1',
        durationMinutes: 90,
        sessions: [
          {
            id: 's1',
            startsAt: '2027-06-01T07:00:00.000Z',
            endsAt: '2027-06-01T08:30:00.000Z',
            venueId: 'v1',
            areaId: 'a2',
          },
        ],
      }),
    ];
    const blocks = buildWorkshopSessionBlocks(ws, columns, '2027-06-01', TZ);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      workshopId: 'w1',
      columnKey: columnKey('v1', 'a2'),
      // 09:00 Paris is 60 min after the 08:00 axis start → 12 slots of 5 min.
      startSlot: 12,
      span: 18, // 90 min / 5
    });
  });

  it('uses the venue-level column when a session has no area', () => {
    const ws: BoardWorkshop[] = [
      workshop({
        id: 'w2',
        sessions: [
          {
            id: 's2',
            startsAt: '2027-06-01T06:00:00.000Z',
            endsAt: null,
            venueId: 'v2',
            areaId: null,
          },
        ],
      }),
    ];
    const blocks = buildWorkshopSessionBlocks(ws, columns, '2027-06-01', TZ);
    expect(blocks[0]).toMatchObject({ columnKey: columnKey('v2', null), startSlot: 0, span: 12 });
  });

  it('carries card fields (category/level/instructors/capacity/confirmed) and endSlot', () => {
    const ws: BoardWorkshop[] = [
      workshop({
        id: 'w1',
        category: 'Longsword',
        level: 'beginner',
        capacity: 20,
        instructorNames: ['Rémi Arbache'],
        sessions: [
          {
            id: 's1',
            startsAt: '2027-06-01T07:00:00.000Z',
            endsAt: '2027-06-01T08:30:00.000Z',
            venueId: 'v1',
            areaId: 'a2',
            confirmedCount: 8,
          },
        ],
      }),
    ];
    const [b] = buildWorkshopSessionBlocks(ws, columns, '2027-06-01', TZ);
    expect(b).toMatchObject({
      startSlot: 12,
      endSlot: 30,
      span: 18,
      category: 'Longsword',
      level: 'beginner',
      capacity: 20,
      instructorNames: ['Rémi Arbache'],
      confirmedCount: 8,
    });
  });

  it('shifts startSlot when the grid start hour changes', () => {
    const ws: BoardWorkshop[] = [
      workshop({
        id: 'w1',
        sessions: [
          {
            id: 's1',
            startsAt: '2027-06-01T07:00:00.000Z', // 09:00 Paris
            endsAt: '2027-06-01T08:00:00.000Z',
            venueId: 'v1',
            areaId: 'a1',
          },
        ],
      }),
    ];
    // Default 08:00 axis → 09:00 is slot 12; a 09:00 axis → slot 0.
    expect(buildWorkshopSessionBlocks(ws, columns, '2027-06-01', TZ)[0]?.startSlot).toBe(12);
    expect(buildWorkshopSessionBlocks(ws, columns, '2027-06-01', TZ, 9)[0]?.startSlot).toBe(0);
  });

  it('excludes sessions on other days (in event tz)', () => {
    const ws: BoardWorkshop[] = [
      workshop({
        id: 'w3',
        sessions: [
          {
            id: 's3',
            startsAt: '2027-06-02T07:00:00.000Z',
            endsAt: null,
            venueId: 'v1',
            areaId: 'a1',
          },
        ],
      }),
    ];
    expect(buildWorkshopSessionBlocks(ws, columns, '2027-06-01', TZ)).toHaveLength(0);
  });
});

/**
 * A Workshop runs several sessions (operator ruling 515): "Longsword basics" on Saturday in Mat A
 * and on Sunday in the Annex. The board read only the first session, so the second was never
 * drawn.
 */
describe('several sessions of one Workshop', () => {
  const longsword = workshop({
    id: 'w-longsword',
    sessions: [
      {
        id: 's-saturday',
        startsAt: '2027-06-01T07:00:00.000Z',
        endsAt: '2027-06-01T08:00:00.000Z',
        venueId: 'v1',
        areaId: 'a1',
      },
      {
        id: 's-saturday-pm',
        startsAt: '2027-06-01T12:00:00.000Z',
        endsAt: '2027-06-01T13:00:00.000Z',
        venueId: 'v2',
        areaId: null,
      },
      {
        id: 's-sunday',
        startsAt: '2027-06-02T07:00:00.000Z',
        endsAt: '2027-06-02T08:00:00.000Z',
        venueId: 'v1',
        areaId: 'a1',
      },
    ],
  });

  it('draws each session of the day as its own block', () => {
    const blocks = buildWorkshopSessionBlocks([longsword], columns, '2027-06-01', TZ);
    expect(blocks.map((b) => [b.workshopId, b.sessionId, b.columnKey])).toEqual([
      ['w-longsword', 's-saturday', columnKey('v1', 'a1')],
      ['w-longsword', 's-saturday-pm', columnKey('v2', null)],
    ]);
    expect(
      buildWorkshopSessionBlocks([longsword], columns, '2027-06-02', TZ).map((b) => b.sessionId),
    ).toEqual(['s-sunday']);
  });
});

describe('unplacedSessions', () => {
  it('lists each session with no time or no column, beside its Workshop', () => {
    const ws: BoardWorkshop[] = [
      workshop({ id: 'none' }),
      workshop({
        id: 'mixed',
        sessions: [
          {
            id: 's-placed',
            startsAt: '2027-06-01T09:00:00',
            endsAt: null,
            venueId: 'v1',
            areaId: 'a1',
          },
          { id: 's-timeless', startsAt: null, endsAt: null, venueId: 'v1', areaId: 'a1' },
          {
            id: 's-no-venue',
            startsAt: '2027-06-01T09:00:00',
            endsAt: null,
            venueId: null,
            areaId: null,
          },
          {
            id: 's-gone-venue',
            startsAt: '2027-06-01T09:00:00',
            endsAt: null,
            venueId: 'v9',
            areaId: null,
          },
        ],
      }),
    ];
    expect(unplacedSessions(ws, columns).map((u) => [u.workshop.id, u.session.id])).toEqual([
      ['mixed', 's-timeless'],
      ['mixed', 's-no-venue'],
      ['mixed', 's-gone-venue'],
    ]);
  });
});
