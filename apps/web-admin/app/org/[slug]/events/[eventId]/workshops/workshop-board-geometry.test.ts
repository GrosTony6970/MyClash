import { describe, expect, it } from 'vitest';
import {
  buildAreaColumns,
  buildColumnBands,
  buildWorkshopSessionBlocks,
  columnKey,
  unscheduledWorkshops,
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

describe('unscheduledWorkshops', () => {
  it('collects workshops with no session, no time, or no venue', () => {
    const ws: BoardWorkshop[] = [
      workshop({ id: 'none' }),
      workshop({
        id: 'timeless',
        sessions: [{ id: 's', startsAt: null, endsAt: null, venueId: 'v1', areaId: 'a1' }],
      }),
      workshop({
        id: 'no-venue',
        sessions: [
          { id: 's', startsAt: '2027-06-01T09:00:00', endsAt: null, venueId: null, areaId: null },
        ],
      }),
      workshop({
        id: 'placed',
        sessions: [
          { id: 's', startsAt: '2027-06-01T09:00:00', endsAt: null, venueId: 'v1', areaId: 'a1' },
        ],
      }),
    ];
    expect(unscheduledWorkshops(ws, columns).map((w) => w.id)).toEqual([
      'none',
      'timeless',
      'no-venue',
    ]);
  });
});
