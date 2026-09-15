import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
} from '../../common/testing/supabase-chain';
import { assertLicesBelongToEvent } from './lices-in-event';

/** Two Lices of this Event and one of another, which only `.eq('event_id')` keeps out. */
const LICES = {
  lices: {
    rows: [
      { id: 'lice-1', event_id: 'event-1' },
      { id: 'lice-2', event_id: 'event-1' },
      { id: 'lice-elsewhere', event_id: 'event-2' },
    ],
  },
};

describe('assertLicesBelongToEvent', () => {
  it("accepts the Event's own Lices, a repeated one and a cleared one included", async () => {
    const supabase = mockSupabase(LICES);

    await expect(
      assertLicesBelongToEvent(supabase.service as never, 'event-1', [
        'lice-1',
        'lice-2',
        'lice-1',
        null,
      ]),
    ).resolves.toBeUndefined();
    // The double answers whatever the projection names; the read is proved by
    // the string and the filters it sends.
    expect(selectsFor(supabase.from, 'lices')).toEqual(['id']);
    expect(filtersFor(supabase.from, 'lices', 'eq')).toEqual([['event_id', 'event-1']]);
  });

  it("refuses another Event's Lice among the Event's own", async () => {
    const supabase = mockSupabase(LICES);

    await expect(
      assertLicesBelongToEvent(supabase.service as never, 'event-1', ['lice-1', 'lice-elsewhere']),
    ).rejects.toThrow('Every Lice must belong to this event');
  });

  it('refuses a Lice that does not exist', async () => {
    const supabase = mockSupabase(LICES);

    await expect(
      assertLicesBelongToEvent(supabase.service as never, 'event-1', ['lice-404']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reads nothing when no Lice is named', async () => {
    const supabase = mockSupabase(LICES);

    await assertLicesBelongToEvent(supabase.service as never, 'event-1', [null, undefined]);

    expect(queriedTables(supabase.from)).toEqual([]);
  });

  it('surfaces a failed read instead of letting the write through', async () => {
    const supabase = mockSupabase({
      lices: { data: null, error: { message: 'statement timeout' } },
    });

    await expect(
      assertLicesBelongToEvent(supabase.service as never, 'event-1', ['lice-1']),
    ).rejects.toThrow('statement timeout');
  });
});
