import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { PROGRAMME_CONFIG_DEFAULTS } from '../programme/dto/programme.dto';
import { readDutyStart, resolveDutyWindows, resolvePoolSpans } from './duty-windows';

/**
 * The seeded double, which applies `.in()`, and decoys: another Pool with an
 * earlier Match, and a Match of the duty's Pool nobody has placed. A read that
 * lost its `.in()` is caught by the `filtersFor` checks — the helper filters
 * again per duty, so the decoy alone would not show it. The decoys and the
 * several-Pools case below hold that per-duty filter. The real `match-lengths`
 * runs underneath, so the lengths are the sheet's. No Match here has a piste and
 * no bar is set, so where a sheet cannot be read, no next bout ends a Match
 * either — `duty-windows.fallback.test.ts` holds that fallback.
 */

const EVENT_A = 'event-a';
const EVENT_B = 'event-b';
const MATCH_COLUMNS =
  'id, pool_id, lice_id, phase_id, scheduled_at, planned_duration_override_minutes';

function match(
  id: string,
  poolId: string | null,
  scheduledAt: string | null,
  over: { phaseId?: string; override?: number | null } = {},
) {
  return {
    id,
    pool_id: poolId,
    lice_id: null,
    phase_id: over.phaseId ?? 'phase-a',
    scheduled_at: scheduledAt,
    planned_duration_override_minutes: over.override ?? null,
  };
}

const MATCHES = [
  match('a1', 'pool-a', '2026-06-01T10:05:00+00:00'),
  match('a2', 'pool-a', '2026-06-01T10:00:00+00:00'),
  match('a3', 'pool-a', '2026-06-01T14:00:00+00:00'),
  match('a-unplaced', 'pool-a', null),
  match('decoy', 'pool-decoy', '2026-06-01T08:00:00+00:00'),
  match('b1', 'pool-b', '2026-06-02T09:00:00+00:00', { phaseId: 'phase-b' }),
];

function db(over: { sheets?: unknown[]; matches?: unknown } = {}) {
  const supabase = mockSupabase({
    event_programme_configs: {
      rows: (over.sheets ?? [
        { event_id: EVENT_A, config_json: PROGRAMME_CONFIG_DEFAULTS },
        {
          event_id: EVENT_B,
          config_json: { ...PROGRAMME_CONFIG_DEFAULTS, poolMatchDurationMinutes: 11 },
        },
      ]) as Array<Record<string, unknown>>,
    },
    phases: {
      rows: [
        { id: 'phase-a', type: 'pool', tournament_id: 't-a' },
        { id: 'phase-b', type: 'pool', tournament_id: 't-b' },
      ],
    },
    matches: (over.matches ?? { rows: MATCHES }) as Parameters<typeof mockSupabase>[0][string],
    events: {
      rows: [
        { id: EVENT_A, start_date: '2026-06-01', timezone: 'UTC' },
        { id: EVENT_B, start_date: '2026-06-01', timezone: 'UTC' },
      ],
    },
    event_programme_blocks: { rows: [] },
  });
  return { client: supabase.service as unknown as SupabaseClient, supabase };
}

const logger = () => ({ warn: vi.fn() });

describe('readDutyStart', () => {
  it("starts a Pool duty at its own Pool's earliest placed Match", async () => {
    const { client, supabase } = db();

    const start = await readDutyStart(client, { id: 'd1', matchId: null, poolId: 'pool-a' });

    expect(start).toBe('2026-06-01T10:00:00.000Z');
    expect(selectsFor(supabase.from, 'matches')).toEqual([MATCH_COLUMNS]);
    expect(filtersFor(supabase.from, 'matches', 'in')).toEqual([['pool_id', ['pool-a']]]);
  });

  it('starts a Match duty at its own Match, even when a Pool is named too', async () => {
    const { client, supabase } = db();

    const start = await readDutyStart(client, { id: 'd1', matchId: 'a3', poolId: 'pool-a' });

    expect(start).toBe('2026-06-01T14:00:00.000Z');
    expect(filtersFor(supabase.from, 'matches', 'in')).toEqual([['id', ['a3']]]);
  });

  it('has no start when nothing it covers is placed', async () => {
    const { client } = db();

    expect(
      await readDutyStart(client, { id: 'd1', matchId: 'a-unplaced', poolId: null }),
    ).toBeNull();
  });

  it('reads nothing for a duty that names neither a Match nor a Pool', async () => {
    const { client, supabase } = db();

    expect(await readDutyStart(client, { id: 'd1', matchId: null, poolId: null })).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('throws when the Matches cannot be read', async () => {
    const { client } = db({ matches: { data: null, error: { message: 'matches exploded' } } });

    await expect(
      readDutyStart(client, { id: 'd1', matchId: null, poolId: 'pool-a' }),
    ).rejects.toThrow('matches exploded');
  });
});

describe('resolveDutyWindows', () => {
  it('reads nothing for no duties', async () => {
    const { client, supabase } = db();

    expect(await resolveDutyWindows(client, logger(), [])).toEqual(new Map());
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("gives a Match duty its Match's window, with the Match's own length beating the sheet", async () => {
    const { client } = db({
      matches: {
        rows: [
          match('plain', 'pool-a', '2026-06-01T10:00:00+00:00'),
          match('long', 'pool-a', '2026-06-01T11:00:00+00:00', { override: 17 }),
        ],
      },
    });

    const windows = await resolveDutyWindows(client, logger(), [
      { id: 'd-plain', eventId: EVENT_A, matchId: 'plain', poolId: null },
      { id: 'd-long', eventId: EVENT_A, matchId: 'long', poolId: null },
    ]);

    expect(windows.get('d-plain')).toEqual({
      startsAt: '2026-06-01T10:00:00.000Z',
      endsAt: '2026-06-01T10:05:00.000Z',
    });
    expect(windows.get('d-long')).toEqual({
      startsAt: '2026-06-01T11:00:00.000Z',
      endsAt: '2026-06-01T11:17:00.000Z',
    });
  });

  it("spans a Pool duty over its own Pool's placed Matches, straggler included", async () => {
    const { client, supabase } = db();

    const windows = await resolveDutyWindows(client, logger(), [
      { id: 'd-pool', eventId: EVENT_A, matchId: null, poolId: 'pool-a' },
    ]);

    // Earliest start 10:00; the 14:00 straggler ends at 14:05. The decoy Pool's
    // 08:00 Match and the unplaced Match add nothing.
    expect(windows.get('d-pool')).toEqual({
      startsAt: '2026-06-01T10:00:00.000Z',
      endsAt: '2026-06-01T14:05:00.000Z',
    });
    expect(selectsFor(supabase.from, 'matches')).toEqual([MATCH_COLUMNS]);
  });

  it('gives each of several Pool duties, read together, its own Pool only', async () => {
    const { client } = db();

    const windows = await resolveDutyWindows(client, logger(), [
      { id: 'd-a', eventId: EVENT_A, matchId: null, poolId: 'pool-a' },
      { id: 'd-decoy', eventId: EVENT_A, matchId: null, poolId: 'pool-decoy' },
      { id: 'd-b', eventId: EVENT_B, matchId: null, poolId: 'pool-b' },
    ]);

    expect(windows.get('d-a')).toEqual({
      startsAt: '2026-06-01T10:00:00.000Z',
      endsAt: '2026-06-01T14:05:00.000Z',
    });
    expect(windows.get('d-decoy')).toEqual({
      startsAt: '2026-06-01T08:00:00.000Z',
      endsAt: '2026-06-01T08:05:00.000Z',
    });
    expect(windows.get('d-b')).toEqual({
      startsAt: '2026-06-02T09:00:00.000Z',
      endsAt: '2026-06-02T09:11:00.000Z',
    });
  });

  it('splits a long list of Matches into reads of 200', async () => {
    const { client, supabase } = db();
    const duties = Array.from({ length: 201 }, (_, i) => ({
      id: `d-${i}`,
      eventId: EVENT_A,
      matchId: `m-${i}`,
      poolId: null,
    }));

    await resolveDutyWindows(client, logger(), duties);

    const reads = filtersFor(supabase.from, 'matches', 'in') as Array<[string, string[]]>;
    expect(reads.map(([column, ids]) => [column, ids.length])).toEqual([
      ['id', 200],
      ['id', 1],
    ]);
  });

  it('gives a duty with nothing placed, or no Match and no Pool, no times and reads no sheet', async () => {
    const { client, supabase } = db();

    const windows = await resolveDutyWindows(client, logger(), [
      { id: 'd-unplaced', eventId: EVENT_A, matchId: 'a-unplaced', poolId: null },
      { id: 'd-lice', eventId: EVENT_A, matchId: null, poolId: null },
    ]);

    expect(windows.get('d-unplaced')).toEqual({ startsAt: null, endsAt: null });
    expect(windows.get('d-lice')).toEqual({ startsAt: null, endsAt: null });
    expect(selectsFor(supabase.from, 'event_programme_configs')).toEqual([]);
  });

  it("reads each Event's lengths from that Event's own sheet", async () => {
    const { client, supabase } = db();
    const log = logger();

    const windows = await resolveDutyWindows(client, log, [
      { id: 'd-a', eventId: EVENT_A, matchId: 'a2', poolId: null },
      { id: 'd-b', eventId: EVENT_B, matchId: 'b1', poolId: null },
    ]);

    expect(windows.get('d-a')?.endsAt).toBe('2026-06-01T10:05:00.000Z');
    expect(windows.get('d-b')?.endsAt).toBe('2026-06-02T09:11:00.000Z');
    expect(log.warn).not.toHaveBeenCalled();
    expect(filtersFor(supabase.from, 'event_programme_configs', 'eq')).toEqual(
      expect.arrayContaining([
        ['event_id', EVENT_A],
        ['event_id', EVENT_B],
      ]),
    );
  });

  it("keeps one Event's times when another Event's sheet cannot be read, and says which", async () => {
    const { client } = db({
      sheets: [
        // A stored value the schema refuses: the sheet read throws, by design.
        { event_id: EVENT_A, config_json: { poolMatchDurationMinutes: 0 } },
        { event_id: EVENT_B, config_json: PROGRAMME_CONFIG_DEFAULTS },
      ],
    });
    const log = logger();

    const windows = await resolveDutyWindows(client, log, [
      { id: 'd-a', eventId: EVENT_A, matchId: null, poolId: 'pool-a' },
      { id: 'd-b', eventId: EVENT_B, matchId: 'b1', poolId: null },
    ]);

    // A's duty keeps its start (no length needed) and loses only its end.
    expect(windows.get('d-a')).toEqual({ startsAt: '2026-06-01T10:00:00.000Z', endsAt: null });
    expect(windows.get('d-b')).toEqual({
      startsAt: '2026-06-02T09:00:00.000Z',
      endsAt: '2026-06-02T09:05:00.000Z',
    });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0]?.[0])).toContain(EVENT_A);
    expect(String(log.warn.mock.calls[0]?.[0])).not.toContain(EVENT_B);
  });

  it('answers every duty untimed, and says so, when the Matches cannot be read', async () => {
    const { client } = db({ matches: { data: null, error: { message: 'matches exploded' } } });
    const log = logger();

    const windows = await resolveDutyWindows(client, log, [
      { id: 'd1', eventId: EVENT_A, matchId: 'a1', poolId: null },
      { id: 'd2', eventId: EVENT_B, matchId: null, poolId: 'pool-b' },
    ]);

    expect([...windows.entries()]).toEqual([
      ['d1', { startsAt: null, endsAt: null }],
      ['d2', { startsAt: null, endsAt: null }],
    ]);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0]?.[0])).toContain('matches exploded');
    expect(String(log.warn.mock.calls[0]?.[0])).toContain(EVENT_A);
  });
});

describe('resolvePoolSpans', () => {
  /**
   * Pool X's earliest start and latest end both sit in MIDDLE rows, so neither
   * "first row" nor "last row" can pass for the span. Pool Y is read in the same
   * call; the decoy Pool, earlier and later than both, is never asked about.
   */
  const POOLS = [
    match('x1', 'pool-x', '2026-06-01T10:30:00+00:00'),
    match('x2', 'pool-x', '2026-06-01T10:00:00+00:00'),
    match('x3', 'pool-x', '2026-06-01T11:10:00+00:00'),
    match('x4', 'pool-x', '2026-06-01T10:45:00+00:00'),
    match('x-unplaced', 'pool-x', null),
    match('y1', 'pool-y', '2026-06-01T15:00:00+00:00'),
    match('decoy', 'pool-decoy', '2026-06-01T08:00:00+00:00'),
    match('decoy-late', 'pool-decoy', '2026-06-01T18:00:00+00:00'),
  ];
  const asked = [
    { poolId: 'pool-x', poolName: 'Pool X' },
    { poolId: 'pool-y', poolName: 'Pool Y' },
  ];

  it('spans each Pool over ALL its placed Matches, whoever fights them, and keeps what it was given', async () => {
    const { client, supabase } = db({ matches: { rows: POOLS } });

    const spans = await resolvePoolSpans(client, logger(), EVENT_A, asked);

    expect(spans).toEqual([
      {
        poolId: 'pool-x',
        poolName: 'Pool X',
        startsAt: '2026-06-01T10:00:00.000Z',
        endsAt: '2026-06-01T11:15:00.000Z',
      },
      {
        poolId: 'pool-y',
        poolName: 'Pool Y',
        startsAt: '2026-06-01T15:00:00.000Z',
        endsAt: '2026-06-01T15:05:00.000Z',
      },
    ]);
    expect(selectsFor(supabase.from, 'matches')).toEqual([MATCH_COLUMNS]);
    expect(filtersFor(supabase.from, 'matches', 'in')).toEqual([['pool_id', ['pool-x', 'pool-y']]]);
  });

  it('reads nothing for a fighter in no Pool', async () => {
    const { client, supabase } = db();

    expect(await resolvePoolSpans(client, logger(), EVENT_A, [])).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('keeps every start and, with no next bout, loses every end, and says so, when the sheet cannot be read', async () => {
    const { client } = db({
      matches: { rows: POOLS },
      sheets: [{ event_id: EVENT_A, config_json: { poolMatchDurationMinutes: 0 } }],
    });
    const log = logger();

    const spans = await resolvePoolSpans(client, log, EVENT_A, asked);

    expect(spans.map((span) => [span.poolId, span.startsAt, span.endsAt])).toEqual([
      ['pool-x', '2026-06-01T10:00:00.000Z', null],
      ['pool-y', '2026-06-01T15:00:00.000Z', null],
    ]);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0]?.[0])).toContain(EVENT_A);
    expect(String(log.warn.mock.calls[0]?.[0])).toContain('Pool spans');
  });

  it('answers every Pool untimed, and says so, when the Matches cannot be read', async () => {
    const { client } = db({ matches: { data: null, error: { message: 'matches exploded' } } });
    const log = logger();

    const spans = await resolvePoolSpans(client, log, EVENT_A, asked);

    expect(spans).toEqual([
      { poolId: 'pool-x', poolName: 'Pool X', startsAt: null, endsAt: null },
      { poolId: 'pool-y', poolName: 'Pool Y', startsAt: null, endsAt: null },
    ]);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0]?.[0])).toContain('matches exploded');
    expect(String(log.warn.mock.calls[0]?.[0])).toContain(EVENT_A);
  });
});
