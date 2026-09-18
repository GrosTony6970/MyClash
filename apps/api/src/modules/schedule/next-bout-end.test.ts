import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { resolveNextBoutEnds } from './next-bout-end';

/**
 * One Saturday in Paris (UTC+2 in June). Each bout is placed so that the right
 * end differs from the one every likely mistake gives, noted per bout:
 *
 *   lice-1  A 09:00 · voided 09:10 · B 09:20 · C 12:20 · D 14:00 · (Sunday) F 09:00
 *   lice-2  E 09:10
 *   none    P 12:30
 *   bars    workshop 09:15 · competition 09:30 · admin 09:40 · break 13:00
 *           · (Sunday) break 08:00 · (another Event) break 12:40
 */

const EVENT = 'event-a';
const OTHER = 'event-b';

const bout = (id: string, liceId: string | null, scheduledAt: string, status = 'scheduled') => ({
  id,
  lice_id: liceId,
  scheduled_at: scheduledAt,
  status,
});

const bar = (eventId: string, dayIndex: number, startTime: string, blockType: string) => ({
  event_id: eventId,
  day_index: dayIndex,
  start_time: startTime,
  block_type: blockType,
});

const SATURDAY = [
  bout('A', 'lice-1', '2027-06-05T09:00:00+02:00'),
  bout('voided', 'lice-1', '2027-06-05T09:10:00+02:00', 'voided'),
  bout('B', 'lice-1', '2027-06-05T09:20:00+02:00'),
  bout('C', 'lice-1', '2027-06-05T12:20:00+02:00'),
  bout('D', 'lice-1', '2027-06-05T14:00:00+02:00'),
  bout('F', 'lice-1', '2027-06-06T09:00:00+02:00'),
  bout('E', 'lice-2', '2027-06-05T09:10:00+02:00'),
  bout('P', null, '2027-06-05T12:30:00+02:00'),
];

const BARS = [
  bar(EVENT, 0, '09:15:00', 'workshop'),
  bar(EVENT, 0, '09:30:00', 'competition'),
  bar(EVENT, 0, '09:40:00', 'admin'),
  bar(EVENT, 0, '13:00:00', 'break'),
  bar(EVENT, 1, '08:00:00', 'break'),
  bar(OTHER, 0, '12:40:00', 'break'),
];

function db(
  over: {
    event?: Record<string, unknown>;
    matches?: unknown[];
    bars?: unknown;
  } = {},
) {
  const supabase = mockSupabase({
    events: {
      rows: [
        { id: EVENT, start_date: '2027-06-05', timezone: 'Europe/Paris', ...over.event },
        { id: OTHER, start_date: '2027-06-05', timezone: 'Europe/Paris' },
      ],
    },
    event_programme_blocks: (over.bars ?? { rows: BARS }) as Parameters<
      typeof mockSupabase
    >[0][string],
    matches: { rows: (over.matches ?? SATURDAY) as Array<Record<string, unknown>> },
  });
  return { client: supabase.service as unknown as SupabaseClient, supabase };
}

const logger = () => ({ warn: vi.fn() });

/** Ask about bouts as a caller holds them. */
const asked = (...ids: string[]) =>
  ids.map((id) => {
    const row = SATURDAY.find((b) => b.id === id)!;
    return { id, liceId: row.lice_id, scheduledAt: row.scheduled_at };
  });

describe('resolveNextBoutEnds', () => {
  it("ends a bout at the next bout on its own piste, the same day — not another piste's, not a voided one's", async () => {
    const { client } = db();

    // Asked together, so both pistes' bouts are read and the rule must tell them apart.
    const ends = await resolveNextBoutEnds(client, logger(), EVENT, asked('A', 'E'));

    // E (lice-2, 09:10) and the voided bout (09:10) are earlier, and neither counts.
    expect(ends.get('A')).toBe('2027-06-05T07:20:00.000Z');
  });

  it('ends a bout at an admin bar, or a break bar, that comes before its next bout', async () => {
    const { client } = db();

    const ends = await resolveNextBoutEnds(client, logger(), EVENT, asked('B', 'C'));

    // B: the 09:40 referee meeting, before C at 12:20. C: Lunch at 13:00, before D
    // at 14:00 — and not the other Event's 12:40 break.
    expect(ends.get('B')).toBe('2027-06-05T07:40:00.000Z');
    expect(ends.get('C')).toBe('2027-06-05T11:00:00.000Z');
  });

  it('never stops a bout at a competition or a workshop bar', async () => {
    const { client } = db();

    const ends = await resolveNextBoutEnds(client, logger(), EVENT, asked('E', 'A'));

    // E at 09:10 is alone on lice-2 — B at 09:20 is on lice-1: the workshop bar at
    // 09:15 and the competition bar at 09:30 run beside it; the admin bar at 09:40
    // ends it.
    expect(ends.get('E')).toBe('2027-06-05T07:40:00.000Z');
  });

  it("gives the day's last bout no end, whatever the next day holds", async () => {
    const { client } = db();

    const ends = await resolveNextBoutEnds(client, logger(), EVENT, asked('D', 'F'));

    // D: F follows on lice-1 and a break opens Sunday, both the next day. F: the
    // Sunday break starts before it.
    expect(ends.get('D')).toBeNull();
    expect(ends.get('F')).toBeNull();
  });

  it('ends a bout with no piste at the next bar', async () => {
    const { client } = db();

    const ends = await resolveNextBoutEnds(client, logger(), EVENT, asked('P'));

    expect(ends.get('P')).toBe('2027-06-05T11:00:00.000Z');
  });

  it("reads each day on the Event's clock, across a DST change", async () => {
    // Paris moves from UTC+1 to UTC+2 in the night of 27–28 March 2027. The
    // Sunday 09:00 break is 07:00Z; counted as 24 hours after Saturday midnight,
    // or on Saturday's offset, it would land at 08:00Z. lice-2's two bouts are on
    // the same Paris day (Sunday) but not the same UTC day.
    const { client } = db({
      event: { start_date: '2027-03-27' },
      matches: [
        bout('S', 'lice-1', '2027-03-28T08:30:00+02:00'),
        bout('S-next', 'lice-1', '2027-03-28T10:00:00+02:00'),
        bout('night', 'lice-2', '2027-03-28T00:30:00+01:00'),
        bout('night-next', 'lice-2', '2027-03-28T01:30:00+01:00'),
      ],
      bars: { rows: [bar(EVENT, 1, '09:00:00', 'break')] },
    });

    const ends = await resolveNextBoutEnds(client, logger(), EVENT, [
      { id: 'S', liceId: 'lice-1', scheduledAt: '2027-03-28T08:30:00+02:00' },
      { id: 'night', liceId: 'lice-2', scheduledAt: '2027-03-28T00:30:00+01:00' },
    ]);

    expect(ends.get('S')).toBe('2027-03-28T07:00:00.000Z');
    expect(ends.get('night')).toBe('2027-03-28T00:30:00.000Z');
  });

  it("reads the Event's clock, its break and admin bars, and its pistes' placed bouts", async () => {
    const { client, supabase } = db();

    await resolveNextBoutEnds(client, logger(), EVENT, asked('A', 'E', 'B', 'P'));

    // The double ignores projections: without these, a dropped column would go
    // unseen wherever its value happens to be right.
    expect(selectsFor(supabase.from, 'events')).toEqual(['start_date, timezone']);
    expect(filtersFor(supabase.from, 'events', 'eq')).toEqual([['id', EVENT]]);
    expect(selectsFor(supabase.from, 'event_programme_blocks')).toEqual(['day_index, start_time']);
    expect(filtersFor(supabase.from, 'event_programme_blocks', 'eq')).toEqual([
      ['event_id', EVENT],
    ]);
    expect(filtersFor(supabase.from, 'event_programme_blocks', 'in')).toEqual([
      ['block_type', ['break', 'admin']],
    ]);
    expect(selectsFor(supabase.from, 'matches')).toEqual(['id, lice_id, scheduled_at']);
    // Each piste once; a bout with no piste adds none.
    expect(filtersFor(supabase.from, 'matches', 'in')).toEqual([['lice_id', ['lice-1', 'lice-2']]]);
    expect(filtersFor(supabase.from, 'matches', 'not')).toEqual([
      ['scheduled_at', 'is', null],
      ['status', 'eq', 'voided'],
    ]);
  });

  it('answers every bout it is asked about, and reads nothing when none is placed', async () => {
    const { client, supabase } = db();

    const ends = await resolveNextBoutEnds(client, logger(), EVENT, [
      { id: 'unplaced', liceId: 'lice-1', scheduledAt: null },
    ]);

    expect([...ends.entries()]).toEqual([['unplaced', null]]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('gives every bout no end, and says so, when a read fails', async () => {
    const { client } = db({ bars: { data: null, error: { message: 'blocks exploded' } } });
    const log = logger();

    const ends = await resolveNextBoutEnds(client, log, EVENT, asked('A', 'C'));

    expect([...ends.entries()]).toEqual([
      ['A', null],
      ['C', null],
    ]);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0]?.[0])).toContain(EVENT);
    expect(String(log.warn.mock.calls[0]?.[0])).toContain('blocks exploded');
  });

  it("gives every bout no end, and says so, when the Event's first day cannot be read", async () => {
    // Its bars could not be put on the clock, and a bout would run past Lunch.
    const { client } = db({ event: { start_date: 'next spring' } });
    const log = logger();

    const ends = await resolveNextBoutEnds(client, log, EVENT, asked('A'));

    expect(ends.get('A')).toBeNull();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0]?.[0])).toContain('next spring');
  });
});
