import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
} from '../../common/testing/supabase-chain';
import { assertMatchesBelongToEvent } from './in-event';

/** A Match row as the read embeds it: its Event, through its Phase's Tournament. */
const match = (id: string, eventId: string) => ({
  id,
  phases: { tournaments: { event_id: eventId } },
});

/**
 * Four of this Event's Matches around one of another Event's. The seeded double
 * applies `.in('id')`, so the read sees only the rows it names; the Event is then
 * compared per row. The foreign row sits in the MIDDLE of every request, so a
 * check that looks at the first or the last row alone passes nothing it should
 * refuse.
 */
const seeded = () =>
  mockSupabase({
    matches: {
      rows: [
        match('own-1', 'event-1'),
        match('own-2', 'event-1'),
        match('elsewhere', 'event-2'),
        match('own-3', 'event-1'),
        match('own-4', 'event-1'),
      ],
    },
  });

describe('assertMatchesBelongToEvent', () => {
  it("accepts several of the Event's own in one read, a repeated one counted once", async () => {
    const supabase = seeded();

    await expect(
      assertMatchesBelongToEvent(supabase.service as never, 'event-1', [
        'own-1',
        'own-2',
        'own-3',
        'own-2',
      ]),
    ).resolves.toBeUndefined();
    expect(queriedTables(supabase.from)).toEqual(['matches']);
    // The double answers whatever the projection names; the Event is reached only
    // through this embed, so the string is the proof of the read.
    expect(selectsFor(supabase.from, 'matches')).toEqual([
      'id, phases!inner(tournaments!inner(event_id))',
    ]);
    expect(filtersFor(supabase.from, 'matches', 'in')).toEqual([
      ['id', ['own-1', 'own-2', 'own-3']],
    ]);
  });

  it("refuses another Event's Match read among the Event's own", async () => {
    const supabase = seeded();

    await expect(
      assertMatchesBelongToEvent(supabase.service as never, 'event-1', [
        'own-1',
        'elsewhere',
        'own-3',
      ]),
    ).rejects.toThrow('Every Match must belong to this event');
  });

  it('refuses a Match that does not exist, with the same sentence', async () => {
    const supabase = seeded();

    const refusal = assertMatchesBelongToEvent(supabase.service as never, 'event-1', [
      'own-1',
      'missing',
      'own-3',
    ]);

    await expect(refusal).rejects.toBeInstanceOf(BadRequestException);
    await expect(refusal).rejects.toThrow('Every Match must belong to this event');
  });

  it('reads 200 ids at a time, and judges every piece', async () => {
    // A day cleared from the board names every bout of it. One `.in()` of them
    // all would outgrow the URL; a read of the first piece alone would miss a
    // foreign bout named after it.
    const own = Array.from({ length: 201 }, (_, n) => `own-${n}`);
    const supabase = mockSupabase({
      matches: { rows: [...own.map((id) => match(id, 'event-1')), match('elsewhere', 'event-2')] },
    });

    await expect(
      assertMatchesBelongToEvent(supabase.service as never, 'event-1', own),
    ).resolves.toBeUndefined();
    expect(filtersFor(supabase.from, 'matches', 'in')).toEqual([
      ['id', own.slice(0, 200)],
      ['id', own.slice(200)],
    ]);

    await expect(
      assertMatchesBelongToEvent(supabase.service as never, 'event-1', [
        ...own.slice(0, 200),
        'elsewhere',
      ]),
    ).rejects.toThrow('Every Match must belong to this event');
  });

  it('reads nothing when no Match is named', async () => {
    const supabase = seeded();

    await assertMatchesBelongToEvent(supabase.service as never, 'event-1', []);

    expect(queriedTables(supabase.from)).toEqual([]);
  });

  it('surfaces a failed read instead of letting the write through', async () => {
    const supabase = mockSupabase({
      matches: { data: null, error: { message: 'statement timeout' } },
    });

    await expect(
      assertMatchesBelongToEvent(supabase.service as never, 'event-1', ['own-1']),
    ).rejects.toThrow('statement timeout');
  });
});
