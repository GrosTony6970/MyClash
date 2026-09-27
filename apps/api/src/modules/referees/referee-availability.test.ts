/**
 * A referee's declared availability: the one reader and writer of its two tables (ADR-019,
 * rulings 145-147, 149). The board and the roster both read through `loadDeclaredAvailability`;
 * the checker and the capacity warning judge what `availabilityOf` builds.
 */
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  mockSupabase,
  selectsFor,
  filtersFor,
  scopedTo,
  writesTo,
} from '../../common/testing/supabase-chain';
import {
  API_ROW_CAP,
  applyAvailability,
  availabilityOf,
  loadDeclaredAvailability,
  planAvailability,
  type AvailabilityPatch,
} from './referee-availability';

const FAILED = { data: null, error: { message: 'connection reset' } };

const day = (
  person_id: string,
  date: string,
  from: number | null = null,
  to: number | null = null,
) => ({
  event_id: 'event-1',
  person_id,
  day: date,
  from_minute: from,
  to_minute: to,
});

describe('loadDeclaredAvailability', () => {
  const tables = () =>
    mockSupabase({
      event_referee_tournaments: {
        rows: [
          { event_id: 'event-1', person_id: 'lea', tournament_id: 't-ls' },
          { event_id: 'event-2', person_id: 'lea', tournament_id: 't-other' },
        ],
      },
      event_referee_days: {
        rows: [
          day('lea', '2026-09-13'),
          day('lea', '2026-09-12', 540, 960),
          { ...day('lea', '2026-09-12'), event_id: 'event-2' },
          day('marc', '2026-09-12'),
        ],
      },
    });

  it("reads the Event's rows as stored, each person's days in date order", async () => {
    const supabase = tables();
    const declared = await loadDeclaredAvailability(supabase.service as never, 'event-1');
    expect(Object.fromEntries(declared)).toEqual({
      lea: {
        tournamentIds: ['t-ls'],
        days: [
          { date: '2026-09-12', fromMinute: 540, toMinute: 960 },
          { date: '2026-09-13', fromMinute: null, toMinute: null },
        ],
      },
      marc: { tournamentIds: [], days: [{ date: '2026-09-12', fromMinute: null, toMinute: null }] },
    });
    expect(selectsFor(supabase.from, 'event_referee_tournaments')).toEqual([
      'person_id, tournament_id',
    ]);
    expect(selectsFor(supabase.from, 'event_referee_days')).toEqual([
      'person_id, day, from_minute, to_minute',
    ]);
    expect(filtersFor(supabase.from, 'event_referee_days', 'eq')).toEqual([
      ['event_id', 'event-1'],
    ]);
  });

  it.each(['event_referee_tournaments', 'event_referee_days'] as const)(
    "a read of %s that reaches the API's row cap is a plain Error, never a cut list",
    async (table) => {
      const rows = Array.from({ length: API_ROW_CAP }, (_, i) =>
        table === 'event_referee_days'
          ? day(`p-${i}`, '2026-09-12')
          : { event_id: 'event-1', person_id: `p-${i}`, tournament_id: 't-ls' },
      );
      const supabase = mockSupabase({
        event_referee_tournaments: { rows: table === 'event_referee_tournaments' ? rows : [] },
        event_referee_days: { rows: table === 'event_referee_days' ? rows : [] },
      });
      const failure = loadDeclaredAvailability(supabase.service as never, 'event-1');
      await expect(failure).rejects.toThrow(/1000 rows reach the API's row cap$/);
      await expect(failure).rejects.not.toHaveProperty('status');
    },
  );

  it.each(['event_referee_tournaments', 'event_referee_days'] as const)(
    'a failed read of %s is a plain Error (a 5xx), never "no restriction"',
    async (table) => {
      const supabase = mockSupabase({
        event_referee_tournaments: table === 'event_referee_tournaments' ? FAILED : { rows: [] },
        event_referee_days: table === 'event_referee_days' ? FAILED : { rows: [] },
      });
      const failure = loadDeclaredAvailability(supabase.service as never, 'event-1');
      await expect(failure).rejects.toThrow(/^Could not read referee .*: connection reset$/);
      await expect(failure).rejects.not.toHaveProperty('status');
    },
  );
});

describe('availabilityOf', () => {
  it('a person with no row, or no row on an axis, has no restriction on it', () => {
    const of = availabilityOf(
      new Map([['lea', { tournamentIds: ['t-ls'], days: [] }]]),
      'Europe/Paris',
    );
    expect(of('lea')).toEqual({ tournamentIds: ['t-ls'], days: null });
    expect(of('ghost')).toEqual({ tournamentIds: null, days: null });
  });

  it("places a window's minutes on the Event's clock, across a clock change", () => {
    // 29 March 2026: Paris goes from UTC+1 to UTC+2 at 02:00, a 23-hour day.
    const of = availabilityOf(
      new Map([
        [
          'lea',
          {
            tournamentIds: [],
            days: [
              { date: '2026-03-29', fromMinute: 60, toMinute: 1440 },
              { date: '2026-03-30', fromMinute: null, toMinute: null },
            ],
          },
        ],
      ]),
      'Europe/Paris',
    );
    expect(of('lea')).toEqual({
      tournamentIds: null,
      days: [
        {
          date: '2026-03-29',
          window: {
            startMs: Date.parse('2026-03-29T00:00:00Z'), // 01:00 at UTC+1
            endMs: Date.parse('2026-03-29T22:00:00Z'), // the next midnight, at UTC+2
          },
        },
        {
          // A whole day is midnight to the next midnight on the Event's clock (UTC+2 by now).
          date: '2026-03-30',
          window: {
            startMs: Date.parse('2026-03-29T22:00:00Z'),
            endMs: Date.parse('2026-03-30T22:00:00Z'),
          },
        },
      ],
    });
  });

  it('a clock it cannot read is a plain Error, never a window in the wrong place', () => {
    expect(() =>
      availabilityOf(
        new Map([
          [
            'lea',
            { tournamentIds: [], days: [{ date: '2026-09-12', fromMinute: 0, toMinute: 60 }] },
          ],
        ]),
        'Nope/Nowhere',
      ),
    ).toThrow(/^Could not place 2026-09-12 00:00/);
  });
});

describe('planAvailability', () => {
  /** A two-day Event (Sat 12 – Sun 13) with two Tournaments. */
  const event = () =>
    mockSupabase({
      events: { rows: [{ id: 'event-1', start_date: '2026-09-12', end_date: '2026-09-13' }] },
      tournaments: {
        rows: [
          { id: 't-ls', event_id: 'event-1' },
          { id: 't-sabre', event_id: 'event-1' },
          { id: 't-elsewhere', event_id: 'event-2' },
        ],
      },
    });
  const plan = (patch: Parameters<typeof planAvailability>[2], supabase = event()) =>
    planAvailability(supabase.service as never, 'event-1', patch);

  it('leaves an axis the body does not name alone', async () => {
    await expect(plan({})).resolves.toEqual({ tournamentIds: null, days: null });
  });

  it('keeps a subset of Tournaments, and stores every one ticked as no rows (ruling 145)', async () => {
    await expect(plan({ tournamentIds: ['t-ls'] })).resolves.toEqual({
      tournamentIds: ['t-ls'],
      days: null,
    });
    await expect(plan({ tournamentIds: ['t-sabre', 't-ls'] })).resolves.toEqual({
      tournamentIds: [],
      days: null,
    });
    await expect(plan({ tournamentIds: [] })).resolves.toEqual({ tournamentIds: [], days: null });
  });

  it('refuses a Tournament of another Event, in words, before anything is written', async () => {
    const supabase = event();
    await expect(plan({ tournamentIds: ['t-ls', 't-elsewhere'] }, supabase)).rejects.toThrow(
      new BadRequestException('Tournament t-elsewhere is not part of this Event.'),
    );
    expect(supabase.writes).toEqual([]);
  });

  it('keeps a subset of days, and stores every day ticked with no window as no rows', async () => {
    await expect(plan({ days: [{ date: '2026-09-13' }] })).resolves.toEqual({
      tournamentIds: null,
      days: [{ date: '2026-09-13', fromMinute: null, toMinute: null }],
    });
    await expect(plan({ days: [{ date: '2026-09-13' }, { date: '2026-09-12' }] })).resolves.toEqual(
      { tournamentIds: null, days: [] },
    );
  });

  it('keeps every day when one holds a window: a window is a restriction', async () => {
    await expect(
      plan({
        days: [{ date: '2026-09-12', fromMinute: 540, toMinute: 960 }, { date: '2026-09-13' }],
      }),
    ).resolves.toEqual({
      tournamentIds: null,
      days: [
        { date: '2026-09-12', fromMinute: 540, toMinute: 960 },
        { date: '2026-09-13', fromMinute: null, toMinute: null },
      ],
    });
  });

  it('stores a window of the whole day as none', async () => {
    await expect(
      plan({
        days: [{ date: '2026-09-12', fromMinute: 0, toMinute: 1440 }, { date: '2026-09-13' }],
      }),
    ).resolves.toEqual({ tournamentIds: null, days: [] });
  });

  it("refuses a date outside the Event's dates, in words (ruling 149)", async () => {
    const supabase = event();
    await expect(
      plan({ days: [{ date: '2026-09-12' }, { date: '2026-09-14' }] }, supabase),
    ).rejects.toThrow(
      new BadRequestException(
        "2026-09-14 is outside the Event's dates (2026-09-12 to 2026-09-13).",
      ),
    );
    await expect(plan({ days: [{ date: '2026-09-11' }] }, supabase)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(supabase.writes).toEqual([]);
    expect(selectsFor(supabase.from, 'events')[0]).toBe('start_date, end_date');
  });

  it.each<[string, AvailabilityPatch]>([
    ['events', { days: [{ date: '2026-09-12' }] }],
    ['tournaments', { tournamentIds: ['t-ls'] }],
  ])('a failed read of %s is a plain Error (a 5xx)', async (table, patch) => {
    const supabase = mockSupabase({ [table]: FAILED });
    const failure = plan(patch, supabase);
    await expect(failure).rejects.toThrow(/^Could not read the Event's .*: connection reset$/);
    await expect(failure).rejects.not.toHaveProperty('status');
  });

  it('an Event with no row is a plain Error, never an empty range that refuses every date', async () => {
    const supabase = mockSupabase({ events: { rows: [] } });
    await expect(plan({ days: [{ date: '2026-09-12' }] }, supabase)).rejects.toThrow(
      'Event event-1 has no row to read its dates from',
    );
  });
});

describe('applyAvailability', () => {
  const store = () =>
    mockSupabase({ event_referee_tournaments: { rows: [] }, event_referee_days: { rows: [] } });

  it("replaces one referee's rows on each axis the plan names, with the rows it holds", async () => {
    const supabase = store();
    await applyAvailability(supabase.service as never, 'event-1', 'lea', {
      tournamentIds: ['t-ls'],
      days: [
        { date: '2026-09-12', fromMinute: 540, toMinute: 960 },
        { date: '2026-09-13', fromMinute: null, toMinute: null },
      ],
    });
    expect(supabase.writes.map((w) => [w.table, w.op])).toEqual([
      ['event_referee_tournaments', 'delete'],
      ['event_referee_tournaments', 'insert'],
      ['event_referee_days', 'delete'],
      ['event_referee_days', 'insert'],
    ]);
    for (const table of ['event_referee_tournaments', 'event_referee_days']) {
      const [cleared] = writesTo(supabase, table);
      expect([scopedTo(cleared, 'event_id'), scopedTo(cleared, 'person_id')]).toEqual([
        'event-1',
        'lea',
      ]);
    }
    expect(writesTo(supabase, 'event_referee_tournaments')[1]!.row).toEqual([
      { event_id: 'event-1', person_id: 'lea', tournament_id: 't-ls' },
    ]);
    expect(writesTo(supabase, 'event_referee_days')[1]!.row).toEqual([
      {
        event_id: 'event-1',
        person_id: 'lea',
        day: '2026-09-12',
        from_minute: 540,
        to_minute: 960,
      },
      {
        event_id: 'event-1',
        person_id: 'lea',
        day: '2026-09-13',
        from_minute: null,
        to_minute: null,
      },
    ]);
  });

  it('clears an axis planned as no rows, and leaves an unnamed axis alone', async () => {
    const supabase = store();
    await applyAvailability(supabase.service as never, 'event-1', 'lea', {
      tournamentIds: null,
      days: [],
    });
    expect(supabase.writes.map((w) => [w.table, w.op])).toEqual([['event_referee_days', 'delete']]);
  });

  it('a failed delete is a plain Error, and nothing is inserted over the old rows', async () => {
    const supabase = mockSupabase({ event_referee_days: FAILED });
    const failure = applyAvailability(supabase.service as never, 'event-1', 'lea', {
      tournamentIds: null,
      days: [{ date: '2026-09-12', fromMinute: null, toMinute: null }],
    });
    await expect(failure).rejects.toThrow('Could not clear event_referee_days: connection reset');
    await expect(failure).rejects.not.toHaveProperty('status');
    expect(supabase.writes.map((w) => w.op)).toEqual(['delete']);
  });

  it('a failed insert is a plain Error (a 5xx)', async () => {
    const supabase = mockSupabase({
      event_referee_tournaments: [{ data: null, error: null }, FAILED],
    });
    const failure = applyAvailability(supabase.service as never, 'event-1', 'lea', {
      tournamentIds: ['t-ls'],
      days: null,
    });
    await expect(failure).rejects.toThrow(
      'Could not write event_referee_tournaments: connection reset',
    );
    await expect(failure).rejects.not.toHaveProperty('status');
  });
});
