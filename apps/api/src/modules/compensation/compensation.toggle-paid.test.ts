import { describe, expect, it, vi } from 'vitest';
import { CompensationService } from './compensation.service';

/**
 * `togglePaid` writes the ONE row an organiser flips by hand, and it has to be
 * flippable more than once.
 *
 * The upsert used to omit `onConflict`, which makes PostgREST resolve the
 * conflict against the PRIMARY KEY — a surrogate `id` this call never supplies.
 * So every toggle INSERTED: the first succeeded and every one after it failed
 * on `UNIQUE (event_id, person_id)`. Marking a referee paid worked once;
 * un-marking them never did.
 *
 * A mock cannot tell whether a row was written, so this asserts the ARGUMENTS —
 * the conflict target is the whole fix, and it is invisible in the return value.
 */
function makeSupabase(upsert: ReturnType<typeof vi.fn>) {
  const eventChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { organization_id: 'org-1' }, error: null }),
  };
  const memberChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'owner' }, error: null }),
  };
  return {
    service: {
      from: vi.fn((table: string) => {
        if (table === 'events') return eventChain;
        if (table === 'organization_members') return memberChain;
        return { upsert };
      }),
    },
  };
}

describe('CompensationService.togglePaid', () => {
  it('upserts on the natural key so a referee can be un-marked as paid', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const service = new CompensationService(makeSupabase(upsert) as never);

    await service.togglePaid('event-1', 'person-1', true, 'actor-1');

    expect(upsert).toHaveBeenCalledTimes(1);
    const [row, options] = upsert.mock.calls[0]!;
    expect(row).toMatchObject({ event_id: 'event-1', person_id: 'person-1', paid: true });
    expect(row.paid_at).not.toBeNull();
    // Without this the write targets the surrogate primary key and always
    // inserts, which is a duplicate-key 400 on the second toggle.
    expect(options).toEqual({ onConflict: 'event_id,person_id' });
  });

  it('clears paid_at when un-marking', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const service = new CompensationService(makeSupabase(upsert) as never);

    await service.togglePaid('event-1', 'person-1', false, 'actor-1');

    const [row] = upsert.mock.calls[0]!;
    expect(row).toMatchObject({ paid: false, paid_at: null });
  });
});
