import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { PROGRAMME_CONFIG_DEFAULTS } from '../programme/dto/programme.dto';
import { resolveDutyWindows, resolvePoolSpans } from './duty-windows';

/**
 * Duty and Pool ends when the Event's sheet cannot be read: each Match ends at
 * the next bout on its piste (`next-bout-end.ts`, whose own test holds the rule;
 * operator, 2026-09-18). The real helper runs underneath.
 *
 * Pool X runs on two pistes. Its ends: x1 at x3 (10:20), x3 at Pool Y's y1
 * (10:40), x2 at Pool Z's z1 (10:50). So the Pool's latest END belongs to x2, a
 * middle row that STARTED earliest — neither its last row nor its last start.
 */

const EVENT = 'event-a';
const MATCH_COLUMNS =
  'id, pool_id, lice_id, phase_id, scheduled_at, planned_duration_override_minutes';
const BROKEN_SHEET = { poolMatchDurationMinutes: 0 };

const match = (id: string, poolId: string, liceId: string | null, hhmm: string | null) => ({
  id,
  pool_id: poolId,
  lice_id: liceId,
  phase_id: 'phase-a',
  scheduled_at: hhmm === null ? null : `2026-06-01T${hhmm}:00+00:00`,
  planned_duration_override_minutes: null,
  status: 'scheduled',
});

const MATCHES = [
  match('x1', 'pool-x', 'lice-1', '10:00'),
  match('x2', 'pool-x', 'lice-2', '10:00'),
  match('x3', 'pool-x', 'lice-1', '10:20'),
  match('x-unplaced', 'pool-x', 'lice-1', null),
  match('y1', 'pool-y', 'lice-1', '10:40'),
  match('z1', 'pool-z', 'lice-2', '10:50'),
];

function db(over: { sheet?: unknown; matches?: unknown[] } = {}) {
  const supabase = mockSupabase({
    event_programme_configs: {
      rows: [{ event_id: EVENT, config_json: over.sheet ?? BROKEN_SHEET }],
    },
    phases: { rows: [{ id: 'phase-a', type: 'pool', tournament_id: 't-a' }] },
    matches: { rows: (over.matches ?? MATCHES) as Array<Record<string, unknown>> },
    events: { rows: [{ id: EVENT, start_date: '2026-06-01', timezone: 'UTC' }] },
    event_programme_blocks: { rows: [] },
  });
  return { client: supabase.service as unknown as SupabaseClient, supabase };
}

const logger = () => ({ warn: vi.fn() });

describe('duty and Pool ends when the sheet cannot be read', () => {
  it('ends a Match duty at the next bout on its piste, and says the lengths were lost', async () => {
    const { client, supabase } = db();
    const log = logger();

    const windows = await resolveDutyWindows(client, log, [
      { id: 'd-x3', eventId: EVENT, matchId: 'x3', poolId: null },
    ]);

    expect(windows.get('d-x3')).toEqual({
      startsAt: '2026-06-01T10:20:00.000Z',
      endsAt: '2026-06-01T10:40:00.000Z',
    });
    // One warning: the sheet. The fallback's own reads succeeded.
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0]?.[0])).toContain(EVENT);
    // The duty's Match read carries the piste; then the piste's own read.
    expect(selectsFor(supabase.from, 'matches')).toEqual([
      MATCH_COLUMNS,
      'id, lice_id, scheduled_at',
    ]);
    expect(filtersFor(supabase.from, 'matches', 'in')).toEqual([
      ['id', ['x3']],
      ['lice_id', ['lice-1']],
    ]);
  });

  it("spans a Pool to the latest next-bout end of its bouts, not its last bout's", async () => {
    const { client } = db();

    const [spans, duties] = await Promise.all([
      resolvePoolSpans(client, logger(), EVENT, [{ poolId: 'pool-x' }]),
      resolveDutyWindows(client, logger(), [
        { id: 'd-pool', eventId: EVENT, matchId: null, poolId: 'pool-x' },
      ]),
    ]);

    const window = { startsAt: '2026-06-01T10:00:00.000Z', endsAt: '2026-06-01T10:50:00.000Z' };
    expect(spans).toEqual([{ poolId: 'pool-x', ...window }]);
    expect(duties.get('d-pool')).toEqual(window);
  });

  it('gives a Pool no end while any of its placed bouts has none', async () => {
    // Without z1, x2 is the last bout on lice-2 that day, with no bar after it:
    // its end is unknown, and it may be the bout that runs last.
    const { client } = db({ matches: MATCHES.filter((m) => m.id !== 'z1') });

    const spans = await resolvePoolSpans(client, logger(), EVENT, [{ poolId: 'pool-x' }]);

    expect(spans).toEqual([
      { poolId: 'pool-x', startsAt: '2026-06-01T10:00:00.000Z', endsAt: null },
    ]);
  });

  it("uses a readable sheet's lengths, and reads nothing for the fallback", async () => {
    const { client, supabase } = db({ sheet: PROGRAMME_CONFIG_DEFAULTS });
    const log = logger();

    const windows = await resolveDutyWindows(client, log, [
      { id: 'd-x1', eventId: EVENT, matchId: 'x1', poolId: null },
    ]);

    // Five minutes from the sheet — not 10:20, where x3 starts.
    expect(windows.get('d-x1')).toEqual({
      startsAt: '2026-06-01T10:00:00.000Z',
      endsAt: '2026-06-01T10:05:00.000Z',
    });
    expect(log.warn).not.toHaveBeenCalled();
    expect(selectsFor(supabase.from, 'events')).toEqual([]);
    expect(selectsFor(supabase.from, 'event_programme_blocks')).toEqual([]);
  });
});
