import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  selectsFor,
  writesTo,
  type SupabaseRow,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { ProgrammeService } from './programme.service';

/**
 * Generate, move a bar, delay the day and delete a bar read a bar's "HH:MM" on the EVENT's clock
 * (ruling 411), never the server's. The Events are in zones no test run uses (New York, Tokyo),
 * so a server-clock read goes red under every run zone (`reference_paris_timezone_blind_spot`).
 * On the seeded double: routed by table, so the reads may come in any order.
 */
const EVENT = 'event-1';
const CALLER = 'user-1';

type Rows = SupabaseRow[];

function bar(over: Record<string, unknown>): SupabaseRow {
  return {
    id: 'bar',
    event_id: EVENT,
    day_index: 0,
    sort_order: 1,
    block_type: 'competition',
    label: 'Pools',
    competition_id: 'tournament-1',
    competition_phase: 'pool',
    workshop_id: null,
    lice_count: 1,
    start_time: '09:00',
    end_time: '09:30',
    generated_at: null,
    ...over,
  };
}

/** The one bout of the one Pool, not yet placed. */
const POOL_BOUT: SupabaseRow = {
  id: 'm1',
  red_registration_id: 'r1',
  blue_registration_id: 'b1',
  pool_id: 'pool-1',
  phase_id: 'phase-1',
  match_number_label: 'M1',
  status: 'scheduled',
  scheduled_at: null,
};

/** The two bout writes answer with the number of rows they were sent. */
const rowCount = (args: Record<string, unknown>) => ({
  data: (args['p_rows'] as unknown[]).length,
  error: null,
});

/** One Event with one Pool on one piste, and the given bars and bouts. */
function seed(opts: { event?: TableSeed; bars: Rows; matches?: Rows }) {
  return mockSupabase(
    {
      events: opts.event ?? { rows: [] },
      event_programme_configs: { rows: [] },
      event_programme_blocks: { rows: opts.bars },
      lices: {
        rows: [{ id: 'lice-1', event_id: EVENT, name: 'Lice 1', sort_order: 1, venue_id: null }],
      },
      tournament_phase_venues: { rows: [] },
      tournaments: { rows: [{ id: 'tournament-1', event_id: EVENT }] },
      phases: { rows: [{ id: 'phase-1', type: 'pool', tournament_id: 'tournament-1' }] },
      pools: { rows: [{ id: 'pool-1', sort_order: 1, phase_id: 'phase-1' }] },
      matches: { rows: opts.matches ?? [POOL_BOUT] },
    },
    { programme_place_bouts: rowCount, programme_retime_bouts: rowCount },
  );
}

/** The service over `seed(opts)`, with authorization stubbed and its logger watched. */
function harness(opts: { event?: TableSeed; bars: Rows; matches?: Rows }) {
  const supabase = seed(opts);
  const service = new ProgrammeService(
    supabase as never,
    { assertOrgRole: vi.fn() } as never,
    { placeMatches: vi.fn() } as never,
  );
  vi.spyOn(
    service as never as { assertWriter: () => Promise<void> },
    'assertWriter',
  ).mockResolvedValue(undefined);
  const warn = vi.spyOn(
    (service as never as { logger: { warn: (message: unknown) => void } }).logger,
    'warn',
  );
  return { supabase, service, warn };
}

const eventIn = (timezone: string, startDate = '2026-05-21'): TableSeed => ({
  rows: [{ id: EVENT, start_date: startDate, timezone }],
});

/** The rows the first call to `fn` sent. */
function sentTo(supabase: ReturnType<typeof mockSupabase>, fn: string) {
  const call = supabase.rpc.mock.calls.find(([name]) => name === fn);
  return (call?.[1] as { p_rows: Array<Record<string, unknown>> } | undefined)?.p_rows;
}

describe('generate on the Event clock', () => {
  it('lays a 09:00 bar of a New York Event at 09:00 New York', async () => {
    const { supabase, service } = harness({ event: eventIn('America/New_York'), bars: [bar({})] });

    const result = await service.generate(EVENT, {}, CALLER);

    // 2026-05-21 is summer time in New York: UTC-4.
    expect(sentTo(supabase, 'programme_place_bouts')?.[0]?.['scheduled_at']).toBe(
      '2026-05-21T13:00:00.000Z',
    );
    // One five-minute bout fits its 09:00-09:30 bar: the bar's end is read on the same clock.
    expect(result.warnings).toEqual([]);
    expect(selectsFor(supabase.from, 'events')).toEqual(['start_date, timezone']);
  });

  it('lays the same bar of a Paris Event at 09:00 Paris', async () => {
    const { supabase, service } = harness({ event: eventIn('Europe/Paris'), bars: [bar({})] });

    await service.generate(EVENT, {}, CALLER);

    expect(sentTo(supabase, 'programme_place_bouts')?.[0]?.['scheduled_at']).toBe(
      '2026-05-21T07:00:00.000Z',
    );
  });

  it("puts a run pushed past midnight on the next day's New York clock", async () => {
    // Day 1 (05-22): a bar 00:00-23:59 then a 61-minute one push the cursor to 1500 = 25:00.
    const { supabase, service } = harness({
      event: eventIn('America/New_York'),
      bars: [
        bar({
          id: 'all-day',
          block_type: 'admin',
          competition_id: null,
          day_index: 1,
          sort_order: 1,
          start_time: '00:00',
          end_time: '23:59',
        }),
        bar({
          id: 'late',
          block_type: 'admin',
          competition_id: null,
          day_index: 1,
          sort_order: 2,
          start_time: '00:00',
          end_time: '01:01',
        }),
        bar({ id: 'pools', day_index: 1, sort_order: 3, start_time: '00:00', end_time: '00:30' }),
      ],
    });

    await service.generate(EVENT, {}, CALLER);

    // 01:00 New York on 05-23.
    expect(sentTo(supabase, 'programme_place_bouts')?.[0]?.['scheduled_at']).toBe(
      '2026-05-23T05:00:00.000Z',
    );
  });

  it('reads an unknown zone as Paris, and warns once naming the Event and the zone', async () => {
    const { supabase, service, warn } = harness({
      event: eventIn('Mars/Olympus'),
      bars: [bar({})],
    });

    await service.generate(EVENT, {}, CALLER);

    expect(sentTo(supabase, 'programme_place_bouts')?.[0]?.['scheduled_at']).toBe(
      '2026-05-21T07:00:00.000Z',
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(EVENT);
    expect(String(warn.mock.calls[0]?.[0])).toContain('"Mars/Olympus"');
  });

  it('logs no warning for a known zone', async () => {
    const { service, warn } = harness({ event: eventIn('America/New_York'), bars: [bar({})] });

    await service.generate(EVENT, {}, CALLER);

    expect(warn).not.toHaveBeenCalled();
  });

  it('is a 400 when the Event read fails, not the 404 it fell into before', async () => {
    const { service } = harness({
      event: { data: null, error: { message: 'events exploded' } },
      bars: [bar({})],
    });

    await expect(service.generate(EVENT, {}, CALLER)).rejects.toBeInstanceOf(BadRequestException);
  });

  // CONTROL: green on HEAD too; held by the falsifier (no row -> 400).
  it('is a 404 when the Event is gone', async () => {
    const { service } = harness({ bars: [bar({})] });

    await expect(service.generate(EVENT, {}, CALLER)).rejects.toBeInstanceOf(NotFoundException);
  });
});

/** A New York Event on 2026-11-07 (EST, UTC-5): bar "Lunch" 12:00-13:00, two bouts. */
function lunchDay(timezone = 'America/New_York') {
  const bout = (id: string, at: string): SupabaseRow => ({
    id,
    phase_id: 'phase-1',
    status: 'scheduled',
    scheduled_at: at,
    match_number_label: id,
  });
  return harness({
    event: eventIn(timezone, '2026-11-07'),
    bars: [
      bar({
        id: 'lunch',
        block_type: 'break',
        competition_id: null,
        label: 'Lunch',
        start_time: '12:00',
        end_time: '13:00',
      }),
    ],
    matches: [
      bout('before', '2026-11-07T16:00:00.000Z'), // 11:00 New York
      bout('after', '2026-11-07T17:30:00.000Z'), // 12:30 New York
    ],
  });
}

describe('moveBlock on the Event clock', () => {
  it('moves the 12:30 New York bout with the bar, and leaves the 11:00 one', async () => {
    const { supabase, service } = lunchDay();

    await service.moveBlock(EVENT, 'lunch', { newStartTime: '14:00' }, CALLER);

    expect(sentTo(supabase, 'programme_retime_bouts')).toEqual([
      { id: 'after', scheduled_at: '2026-11-07T19:30:00.000Z' }, // 14:30 New York
    ]);
    expect(selectsFor(supabase.from, 'events')).toEqual(['start_date, timezone']);
  });
});

describe('delayDay on the Event clock', () => {
  it('pushes an 08:30 Tokyo bout back when the day runs late from 08:00', async () => {
    const { supabase, service } = harness({
      event: eventIn('Asia/Tokyo', '2026-11-07'),
      bars: [],
      matches: [
        // 08:30 Tokyo (UTC+9) on 11-07.
        {
          id: 'morning',
          phase_id: 'phase-1',
          status: 'scheduled',
          scheduled_at: '2026-11-06T23:30:00.000Z',
          match_number_label: 'M1',
        },
      ],
    });

    await service.delayDay(EVENT, { dayIndex: 0, fromTime: '08:00', deltaMinutes: 30 }, CALLER);

    expect(sentTo(supabase, 'programme_retime_bouts')).toEqual([
      { id: 'morning', scheduled_at: '2026-11-07T00:00:00.000Z' },
    ]);
    expect(selectsFor(supabase.from, 'events')).toEqual(['start_date, timezone']);
  });
});

describe('deleteBlock on the Event clock', () => {
  it("clears the bouts of a 09:00-12:00 bar on day 1, read on New York's clock", async () => {
    const { supabase, service } = harness({
      event: eventIn('America/New_York'),
      bars: [bar({ id: 'pools', day_index: 1, start_time: '09:00', end_time: '12:00' })],
    });

    await service.deleteBlock(EVENT, 'pools', CALLER);

    const [clear] = writesTo(supabase, 'matches');
    // Day 1 is 05-22; 09:00 and 12:00 New York (UTC-4).
    expect(clear?.filters.find((f) => f.method === 'gte')?.args).toEqual([
      'scheduled_at',
      '2026-05-22T13:00:00.000Z',
    ]);
    expect(clear?.filters.find((f) => f.method === 'lt')?.args).toEqual([
      'scheduled_at',
      '2026-05-22T16:00:00.000Z',
    ]);
    expect(selectsFor(supabase.from, 'events')).toEqual(['start_date, timezone']);
  });

  // CONTROL: green on HEAD too; held by the falsifier (read error ignored).
  it('is a 400 when the Event read fails', async () => {
    const { service } = harness({
      event: { data: null, error: { message: 'events exploded' } },
      bars: [bar({ id: 'pools' })],
    });

    await expect(service.deleteBlock(EVENT, 'pools', CALLER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
