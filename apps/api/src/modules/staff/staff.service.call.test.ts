import { describe, expect, it, vi } from 'vitest';
import { StaffService } from './staff.service';
import { mockSupabase, scopedTo, writesTo } from '../../common/testing/supabase-chain';

/**
 * A referee's call from the pad (ruling 952): Medic, Head referee or Dispute.
 *
 * It raises the "Needs attention" flag the live control room shows on the
 * piste, until an organiser acknowledges it. Before, nothing raised it, so the
 * red state and its Acknowledge button could never show.
 *
 * The write lands on the caller's OWN staff account — the event AND the id come
 * from the session, never from the body.
 */

const req = { cookies: {} } as never;
const EVENT = 'E1';
const ACCOUNT = 'a1';

function harness() {
  const supabase = mockSupabase({
    event_staff_accounts: {
      rows: [
        { id: ACCOUNT, event_id: EVENT, needs_attention: false, needs_attention_reason: null },
        { id: 'a2', event_id: EVENT, needs_attention: false, needs_attention_reason: null },
      ],
    },
  });
  const svc = new StaffService(
    { service: { from: supabase.from } } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const gate = vi
    .spyOn(
      svc as never as {
        requireStaffFromRequest: (
          r: unknown,
          roles?: readonly string[],
        ) => Promise<{ id: string; event_id: string }>;
      },
      'requireStaffFromRequest',
    )
    .mockResolvedValue({ id: ACCOUNT, event_id: EVENT });
  return { svc, supabase, gate };
}

describe('StaffService.raiseAttention', () => {
  it("raises the flag with its reason on the caller's own account", async () => {
    const { svc, supabase } = harness();

    await expect(svc.raiseAttention(req, { reason: 'medic' })).resolves.toEqual({ ok: true });

    const writes = writesTo(supabase, 'event_staff_accounts');
    expect(writes).toHaveLength(1);
    expect(writes[0]!.row).toEqual({ needs_attention: true, needs_attention_reason: 'medic' });
    expect(scopedTo(writes[0], 'event_id')).toBe(EVENT);
    expect(scopedTo(writes[0], 'id')).toBe(ACCOUNT);
  });

  it('is a scoring account’s door: the pad of a desk cannot call', async () => {
    const { svc, gate } = harness();

    await svc.raiseAttention(req, { reason: 'dispute' });

    expect(gate).toHaveBeenCalledWith(req, ['scoring']);
  });
});
