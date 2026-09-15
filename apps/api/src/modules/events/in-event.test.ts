import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
} from '../../common/testing/supabase-chain';
import { assertTournamentsBelongToEvent, assertWorkshopsBelongToEvent } from './in-event';

/**
 * The two checks a programme bar and a sheet row go through. The Lice check is
 * the same function under a third name, with its own tests in
 * `lices/lices-in-event.test.ts`.
 */
describe.each([
  { table: 'tournaments', noun: 'Tournament', check: assertTournamentsBelongToEvent },
  { table: 'workshops', noun: 'Workshop', check: assertWorkshopsBelongToEvent },
] as const)('the $noun check', ({ table, noun, check }) => {
  /** Two rows of this Event and one of another, which only `.eq('event_id')` keeps out. */
  const seeded = () =>
    mockSupabase({
      [table]: {
        rows: [
          { id: 'own-1', event_id: 'event-1' },
          { id: 'own-2', event_id: 'event-1' },
          { id: 'elsewhere', event_id: 'event-2' },
        ],
      },
    });

  it("accepts the Event's own, a repeated one and a cleared one included", async () => {
    const supabase = seeded();

    await expect(
      check(supabase.service as never, 'event-1', ['own-1', 'own-2', 'own-1', null]),
    ).resolves.toBeUndefined();
    // The double answers whatever the projection names; the read is proved by
    // the string and the filters it sends.
    expect(selectsFor(supabase.from, table)).toEqual(['id']);
    expect(filtersFor(supabase.from, table, 'eq')).toEqual([['event_id', 'event-1']]);
    expect(filtersFor(supabase.from, table, 'in')).toEqual([['id', ['own-1', 'own-2']]]);
  });

  it("refuses another Event's among the Event's own", async () => {
    const supabase = seeded();

    await expect(
      check(supabase.service as never, 'event-1', ['own-1', 'elsewhere']),
    ).rejects.toThrow(`Every ${noun} must belong to this event`);
  });

  it('refuses an id that does not exist', async () => {
    const supabase = seeded();

    await expect(check(supabase.service as never, 'event-1', ['missing'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('reads nothing when none is named', async () => {
    const supabase = seeded();

    await check(supabase.service as never, 'event-1', [null, undefined]);

    expect(queriedTables(supabase.from)).toEqual([]);
  });

  it('surfaces a failed read instead of letting the write through', async () => {
    const supabase = mockSupabase({
      [table]: { data: null, error: { message: 'statement timeout' } },
    });

    await expect(check(supabase.service as never, 'event-1', ['own-1'])).rejects.toThrow(
      'statement timeout',
    );
  });
});
