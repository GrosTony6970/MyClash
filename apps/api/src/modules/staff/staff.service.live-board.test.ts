import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { StaffService } from './staff.service';

// Table-keyed mock: from(table).select().eq()... resolves to the array for that
// table. `.maybeSingle()` returns the first row; awaiting the chain resolves to
// `{ data: rows, error: null }` via the `then` shim.
function makeSupabase(tables: Record<string, unknown[]>) {
  const service = {
    from: vi.fn((table: string) => {
      const rows = tables[table] ?? [];
      const chain: Record<string, unknown> = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        in: vi.fn(() => chain),
        order: vi.fn(() => chain),
        maybeSingle: vi.fn().mockResolvedValue({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
          resolve({ data: rows, error: null }),
      };
      return chain;
    }),
  };
  return { service };
}

const req = { cookies: {} } as never;

describe('StaffService.getLiveBoard', () => {
  it('throws 403 when the caller lacks an org role on the event', async () => {
    const supabase = makeSupabase({
      events: [{ id: 'E1', organization_id: 'O1', status: 'running' }],
    });
    const orgs = { assertOrgRole: vi.fn().mockRejectedValue(new ForbiddenException('no role')) };
    const svc = new StaffService(supabase as never, orgs as never, {} as never);
    // Force the Supabase-user branch:
    vi.spyOn(
      svc as never as { getSupabaseUserId: () => Promise<string> },
      'getSupabaseUserId',
    ).mockResolvedValue('U1');
    await expect(svc.getLiveBoard(req, 'E1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('assembles one row per lice for an authorized organizer', async () => {
    const supabase = makeSupabase({
      events: [{ id: 'E1', organization_id: 'O1', status: 'running' }],
      lices: [{ id: 'L1', name: 'Piste 1', sort_order: 0 }],
      matches: [
        {
          id: 'm1',
          lice_id: 'L1',
          status: 'running',
          red_score: 1,
          blue_score: 0,
          match_number_label: '#1',
          bracket_slots: null,
          red: null,
          blue: null,
        },
      ],
      event_staff_accounts: [],
      event_staff_lice_assignments: [],
    });
    const orgs = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
    const svc = new StaffService(supabase as never, orgs as never, {} as never);
    vi.spyOn(
      svc as never as { getSupabaseUserId: () => Promise<string> },
      'getSupabaseUserId',
    ).mockResolvedValue('U1');

    const out = await svc.getLiveBoard(req, 'E1');
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.currentMatch?.id).toBe('m1');
    expect(out.rows[0]!.currentMatch?.redScore).toBe(1);
  });
});

describe('StaffService.acknowledgeAttention', () => {
  it('clears the attention flag for an authorized organizer', async () => {
    const updated: Record<string, unknown>[] = [];
    const service = {
      from: vi.fn((table: string) => {
        if (table === 'events') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: 'E1', organization_id: 'O1', status: 'running' },
                    error: null,
                  }),
              }),
            }),
          };
        }
        const chain: Record<string, unknown> = {
          update: vi.fn((patch: Record<string, unknown>) => {
            updated.push(patch);
            return chain;
          }),
          eq: vi.fn(() => chain),
          then: (r: (v: { data: null; error: null }) => void) => r({ data: null, error: null }),
        };
        return chain;
      }),
    };
    const orgs = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
    const svc = new StaffService({ service } as never, orgs as never, {} as never);
    vi.spyOn(
      svc as never as { getSupabaseUserId: () => Promise<string> },
      'getSupabaseUserId',
    ).mockResolvedValue('U1');

    await expect(svc.acknowledgeAttention(req, 'E1', 'a1')).resolves.toEqual({ ok: true });
    expect(updated[0]).toMatchObject({ needs_attention: false, needs_attention_reason: null });
  });
});
