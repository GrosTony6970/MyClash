import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { endWithBlock, resolvePoolBlocks } from './pool-block-ends';

/**
 * A two-day Event in Paris (UTC+2 in May). The Longsword Pool bar runs 09:00–12:00 on
 * Saturday and 09:00–10:00 on Sunday; a bracket bar and another Tournament's Pool bar sit
 * beside them and must not be read.
 */

const EVENT = 'event-a';

const bar = (over: Record<string, unknown>) => ({
  event_id: EVENT,
  block_type: 'competition',
  competition_phase: 'pool',
  competition_id: 't-long',
  day_index: 0,
  start_time: '09:00:00',
  end_time: '12:00:00',
  ...over,
});

const BARS = [
  bar({}),
  bar({ day_index: 1, end_time: '10:00:00' }),
  bar({ competition_phase: 'bracket', start_time: '14:00:00', end_time: '18:00:00' }),
  bar({ competition_id: 't-sabre', end_time: '17:00:00' }),
  bar({ block_type: 'break', competition_id: null, start_time: '12:00:00', end_time: '13:00:00' }),
];

function db(barsSeed: Parameters<typeof mockSupabase>[0][string] = { rows: BARS }) {
  const supabase = mockSupabase({
    events: { rows: [{ id: EVENT, start_date: '2027-05-22', timezone: 'Europe/Paris' }] },
    event_programme_blocks: barsSeed,
  });
  return { client: supabase.service as unknown as SupabaseClient, supabase };
}

const at = (iso: string) => Date.parse(iso);

describe('resolvePoolBlocks', () => {
  it("reads only the Tournament's Pool bars, as instants on the Event's clock", async () => {
    const { client, supabase } = db();
    const log = { warn: vi.fn() };

    const blocks = await resolvePoolBlocks(client, log, EVENT, ['t-long']);

    expect(blocks).toEqual(
      new Map([
        [
          't-long',
          [
            { startMs: at('2027-05-22T07:00:00Z'), endMs: at('2027-05-22T10:00:00Z') },
            { startMs: at('2027-05-23T07:00:00Z'), endMs: at('2027-05-23T08:00:00Z') },
          ],
        ],
      ]),
    );
    expect(log.warn).not.toHaveBeenCalled();
    expect(selectsFor(supabase.from, 'event_programme_blocks')).toEqual([
      'competition_id, day_index, start_time, end_time',
    ]);
    expect(filtersFor(supabase.from, 'event_programme_blocks', 'eq')).toEqual([
      ['event_id', EVENT],
      ['block_type', 'competition'],
      ['competition_phase', 'pool'],
    ]);
    expect(filtersFor(supabase.from, 'event_programme_blocks', 'in')).toEqual([
      ['competition_id', ['t-long']],
    ]);
  });

  it('reads nothing for no Tournament', async () => {
    const { client, supabase } = db();
    expect(await resolvePoolBlocks(client, { warn: vi.fn() }, EVENT, [])).toEqual(new Map());
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('logs a failed read with the Event and answers no bar', async () => {
    const { client } = db({ data: null, error: { message: 'blocks exploded' } });
    const log = { warn: vi.fn() };

    expect(await resolvePoolBlocks(client, log, EVENT, ['t-long'])).toEqual(new Map());
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0]?.[0])).toContain(EVENT);
    expect(String(log.warn.mock.calls[0]?.[0])).toContain('blocks exploded');
  });
});

describe('endWithBlock', () => {
  const saturday = { startMs: at('2027-05-22T07:00:00Z'), endMs: at('2027-05-22T10:00:00Z') };
  const sunday = { startMs: at('2027-05-23T07:00:00Z'), endMs: at('2027-05-23T08:00:00Z') };
  const pool = { startsAt: '2027-05-22T07:00:00.000Z', endsAt: '2027-05-22T09:33:00.000Z' };

  it("stretches a Pool that ends before its bar to the bar's end", () => {
    expect(endWithBlock(pool, [saturday])).toBe('2027-05-22T10:00:00.000Z');
  });

  it('keeps the end of a bout that runs past its bar', () => {
    const late = { ...pool, endsAt: '2027-05-22T10:20:00.000Z' };
    expect(endWithBlock(late, [saturday])).toBe('2027-05-22T10:20:00.000Z');
  });

  it('ignores a bar the Pool does not overlap: Saturday is not stretched to Sunday', () => {
    expect(endWithBlock(pool, [sunday])).toBe(pool.endsAt);
    expect(endWithBlock(pool, [saturday, sunday])).toBe('2027-05-22T10:00:00.000Z');
  });

  it('returns a span with no start or no end as it came', () => {
    expect(endWithBlock({ startsAt: null, endsAt: pool.endsAt }, [saturday])).toBe(pool.endsAt);
    expect(endWithBlock({ startsAt: pool.startsAt, endsAt: null }, [saturday])).toBeNull();
  });
});
