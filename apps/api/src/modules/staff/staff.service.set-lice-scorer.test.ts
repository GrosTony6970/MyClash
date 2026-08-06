import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { StaffService } from './staff.service';

interface Recorded {
  deletes: Array<Record<string, unknown>>;
  inserts: Array<Record<string, unknown>>;
}

/**
 * Mock focused on the assignment table: it records the delete filters and the
 * inserted row, because the whole point of this endpoint is WHICH rows it
 * removes — a mock that only reports success would pass on an endpoint that
 * wiped the event.
 */
function makeSupabase(opts: {
  assignments?: Array<{ staff_account_id: string }>;
  account?: { id: string; status: string } | null;
  recorded: Recorded;
}) {
  const service = {
    from: vi.fn((table: string) => {
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        select: vi.fn(() => chain),
        eq: vi.fn((col: string, val: unknown) => {
          filters[col] = val;
          return chain;
        }),
        delete: vi.fn(() => {
          opts.recorded.deletes.push(filters);
          return chain;
        }),
        insert: vi.fn((row: Record<string, unknown>) => {
          opts.recorded.inserts.push(row);
          return chain;
        }),
        maybeSingle: vi.fn(() => {
          if (table === 'events') {
            return Promise.resolve({
              data: { id: 'E1', organization_id: 'O1', status: 'running', slug: 'e1' },
              error: null,
            });
          }
          if (table === 'lices') return Promise.resolve({ data: { id: 'L1' }, error: null });
          return Promise.resolve({ data: opts.account ?? null, error: null });
        }),
        then: (resolve: (v: unknown) => void) => {
          if (table === 'event_staff_lice_assignments') {
            resolve({ data: opts.assignments ?? [], error: null });
            return;
          }
          if (table === 'lices') {
            resolve({ data: [{ id: 'L1' }], error: null });
            return;
          }
          resolve({ data: [], error: null });
        },
      };
      return chain;
    }),
  };
  return { service };
}

const req = { cookies: {} } as never;

function build(opts: Parameters<typeof makeSupabase>[0], role: 'ok' | 'deny' = 'ok') {
  const supabase = makeSupabase(opts);
  const orgs = {
    assertOrgRole:
      role === 'ok'
        ? vi.fn().mockResolvedValue(undefined)
        : vi.fn().mockRejectedValue(new ForbiddenException('no role')),
  };
  const svc = new StaffService(supabase as never, orgs as never, {} as never, {} as never);
  vi.spyOn(
    svc as never as { getSupabaseUserId: () => Promise<string> },
    'getSupabaseUserId',
  ).mockResolvedValue('U1');
  vi.spyOn(
    svc as never as { assertLicesBelongToEvent: () => Promise<void> },
    'assertLicesBelongToEvent',
  ).mockResolvedValue(undefined);
  return { svc, orgs };
}

describe('StaffService.setLiceScorer', () => {
  it('requires an org role on the event', async () => {
    const recorded: Recorded = { deletes: [], inserts: [] };
    const { svc } = build({ recorded }, 'deny');
    await expect(
      svc.setLiceScorer(req, 'E1', 'L1', { staffAccountId: 'a1' } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(recorded.deletes).toHaveLength(0);
  });

  it('gates on scorekeeper, not editor', async () => {
    // The board is a scorekeeper surface. Requiring `editor` here would make
    // the control useless to the role it exists for.
    const recorded: Recorded = { deletes: [], inserts: [] };
    const { svc, orgs } = build({ recorded, account: { id: 'a1', status: 'active' } });
    await svc.setLiceScorer(req, 'E1', 'L1', { staffAccountId: 'a1' } as never);
    expect(orgs.assertOrgRole).toHaveBeenCalledWith('O1', 'U1', 'scorekeeper');
  });

  it('replaces the assignments ON THAT LICE ONLY', async () => {
    const recorded: Recorded = { deletes: [], inserts: [] };
    const { svc } = build({ recorded, account: { id: 'a2', status: 'active' } });
    await svc.setLiceScorer(req, 'E1', 'L1', { staffAccountId: 'a2' } as never);
    // Scoped by BOTH event and lice — a delete missing the lice filter would
    // unassign the whole event.
    expect(recorded.deletes[0]).toMatchObject({ event_id: 'E1', lice_id: 'L1' });
    expect(recorded.inserts[0]).toEqual({
      event_id: 'E1',
      staff_account_id: 'a2',
      lice_id: 'L1',
    });
  });

  it('reports the co-scorers it dropped rather than swallowing them', async () => {
    const recorded: Recorded = { deletes: [], inserts: [] };
    const { svc } = build({
      recorded,
      account: { id: 'new', status: 'active' },
      assignments: [{ staff_account_id: 'old1' }, { staff_account_id: 'old2' }],
    });
    const out = await svc.setLiceScorer(req, 'E1', 'L1', { staffAccountId: 'new' } as never);
    expect(out.removedAccountIds.sort()).toEqual(['old1', 'old2']);
    expect(out.staffAccountId).toBe('new');
  });

  it('does not report the incoming account as removed when it was already there', async () => {
    const recorded: Recorded = { deletes: [], inserts: [] };
    const { svc } = build({
      recorded,
      account: { id: 'same', status: 'active' },
      assignments: [{ staff_account_id: 'same' }],
    });
    const out = await svc.setLiceScorer(req, 'E1', 'L1', { staffAccountId: 'same' } as never);
    expect(out.removedAccountIds).toEqual([]);
  });

  it('clears the piste on a null account, inserting nothing', async () => {
    // "This piste has no scorer" is a state the organizer must be able to SET.
    const recorded: Recorded = { deletes: [], inserts: [] };
    const { svc } = build({ recorded, assignments: [{ staff_account_id: 'old' }] });
    const out = await svc.setLiceScorer(req, 'E1', 'L1', { staffAccountId: null } as never);
    expect(recorded.deletes).toHaveLength(1);
    expect(recorded.inserts).toHaveLength(0);
    expect(out.staffAccountId).toBeNull();
    expect(out.removedAccountIds).toEqual(['old']);
  });

  it('refuses a disabled account before touching anything', async () => {
    const recorded: Recorded = { deletes: [], inserts: [] };
    const { svc } = build({ recorded, account: { id: 'a1', status: 'disabled' } });
    await expect(
      svc.setLiceScorer(req, 'E1', 'L1', { staffAccountId: 'a1' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(recorded.deletes).toHaveLength(0);
  });
});
