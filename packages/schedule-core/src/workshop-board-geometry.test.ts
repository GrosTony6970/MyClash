import { describe, expect, it } from 'vitest';
import {
  buildAreaColumns,
  buildColumnBands,
  buildWorkshopSessionBlocks,
  columnKey,
  sessionWindowMs,
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

  it('still draws a cancelled session, marked so the board strikes it through (526)', () => {
    const cancelled = {
      ...longsword,
      sessions: longsword.sessions.map((s) =>
        s.id === 's-saturday' ? { ...s, cancelled: true } : s,
      ),
    };
    const blocks = buildWorkshopSessionBlocks([cancelled], columns, '2027-06-01', TZ);
    // Live first (552: Tab reaches the left card first).
    expect(blocks.map((b) => [b.sessionId, b.cancelled])).toEqual([
      ['s-saturday-pm', false],
      ['s-saturday', true],
    ]);
  });

  describe('a live and a cancelled card in one room and hour, side by side (552)', () => {
    const saturday = longsword.sessions[0]!; // 09:00-10:00 Paris, Mat A
    const cancelledLongsword = { ...longsword, sessions: [{ ...saturday, cancelled: true }] };
    const dagger = (over: Partial<typeof saturday> = {}) =>
      workshop({ id: 'w-dagger', sessions: [{ ...saturday, id: 's-dagger', ...over }] });
    const lanes = (ws: BoardWorkshop[], day = '2027-06-01') =>
      buildWorkshopSessionBlocks(ws, columns, day, TZ).map((b) => [b.sessionId, b.lane]);

    it('puts the live card on the left and the cancelled one on the right, live first', () => {
      expect(lanes([cancelledLongsword, dagger({ startsAt: '2027-06-01T07:30:00.000Z' })])).toEqual(
        [
          ['s-dagger', 'start'],
          ['s-saturday', 'end'],
        ],
      );
    });

    it('leaves the whole column to cards that only touch, or sit in another room', () => {
      expect(
        lanes([
          cancelledLongsword,
          dagger({ startsAt: '2027-06-01T08:00:00.000Z', endsAt: '2027-06-01T09:00:00.000Z' }),
        ]),
      ).toEqual([
        ['s-dagger', null],
        ['s-saturday', null],
      ]);
      expect(lanes([cancelledLongsword, dagger({ areaId: 'a2' })])).toEqual([
        ['s-dagger', null],
        ['s-saturday', null],
      ]);
    });

    it('leaves two live cards in one room as they were: the room warning shows them', () => {
      expect(lanes([longsword, dagger()]).filter(([id]) => id !== 's-saturday-pm')).toEqual([
        ['s-saturday', null],
        ['s-dagger', null],
      ]);
    });

    it("never halves a card by another day's card in the same room and hour", () => {
      const sunday = dagger({
        startsAt: '2027-06-02T07:00:00.000Z',
        endsAt: '2027-06-02T08:00:00.000Z',
      });
      expect(lanes([cancelledLongsword, sunday], '2027-06-01')).toEqual([['s-saturday', null]]);
      expect(lanes([cancelledLongsword, sunday], '2027-06-02')).toEqual([['s-dagger', null]]);
    });
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

describe('sessionWindowMs', () => {
  it('runs from the start to the end', () => {
    expect(
      sessionWindowMs({ startsAt: '2026-05-23T10:00:00Z', endsAt: '2026-05-23T11:00:00Z' }),
    ).toEqual({
      startMs: Date.parse('2026-05-23T10:00:00Z'),
      endMs: Date.parse('2026-05-23T11:00:00Z'),
    });
  });

  it('is none while either end is missing: such a session overlaps nothing (ADR-016)', () => {
    expect(sessionWindowMs({ startsAt: '2026-05-23T10:00:00Z', endsAt: null })).toBeNull();
    expect(sessionWindowMs({ startsAt: null, endsAt: '2026-05-23T11:00:00Z' })).toBeNull();
  });
});
