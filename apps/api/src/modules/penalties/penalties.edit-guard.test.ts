import { describe, expect, it, vi } from 'vitest';
import { PenaltiesService } from './penalties.service';

// Harness whose chains are awaitable (thenable) so a bare `.select().eq()` count
// query — and a bare `.update().eq()` / `.delete().eq()` — resolves. Per-table
// `count` drives the reference guard; `maybeSingle` drives the row reads.
type TableState = Record<string, { maybeSingle?: unknown; count?: number }>;

function fakeSupabase(state: TableState) {
  const updated: Record<string, unknown[]> = {};
  const deleted: string[] = [];
  function chain(table: string) {
    const t = state[table] ?? {};
    const api: Record<string, unknown> = {
      select: vi.fn(() => api),
      eq: vi.fn(() => api),
      is: vi.fn(() => api),
      in: vi.fn(() => api),
      maybeSingle: vi.fn(() => Promise.resolve({ data: t.maybeSingle ?? null, error: null })),
      insert: vi.fn(() => api),
      update: vi.fn((row: unknown) => {
        updated[table] = [...(updated[table] ?? []), row];
        return api;
      }),
      delete: vi.fn(() => {
        deleted.push(table);
        return api;
      }),
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: [], count: t.count ?? 0, error: null }),
    };
    return api;
  }
  return { updated, deleted, service: { from: vi.fn((table: string) => chain(table)) } };
}

function customRow(overrides: Record<string, unknown> = {}) {
  return { id: 'pr-1', built_in: false, owner_organization_id: 'org-1', ...overrides };
}

describe('PenaltiesService — edit/delete immutability guard', () => {
  it('blocks editing a custom ruleset pinned by a tournament', async () => {
    const supabase = fakeSupabase({
      penalty_rulesets: { maybeSingle: customRow() },
      tournaments: { count: 1 },
      events: { count: 0 },
    });
    const service = new PenaltiesService(supabase as never);

    await expect(
      service.updateRuleset('pr-1', { name: 'Renamed' } as never, 'user-1'),
    ).rejects.toThrow(/in use by a tournament or event/i);
    expect(supabase.updated.penalty_rulesets).toBeUndefined();
  });

  it('blocks editing a custom ruleset pinned only as an event default', async () => {
    const supabase = fakeSupabase({
      penalty_rulesets: { maybeSingle: customRow() },
      tournaments: { count: 0 },
      events: { count: 1 },
    });
    const service = new PenaltiesService(supabase as never);

    await expect(
      service.updateRuleset('pr-1', { name: 'Renamed' } as never, 'user-1'),
    ).rejects.toThrow(/in use by a tournament or event/i);
  });

  it('allows editing an unreferenced custom ruleset', async () => {
    const supabase = fakeSupabase({
      penalty_rulesets: { maybeSingle: customRow() },
      tournaments: { count: 0 },
      events: { count: 0 },
    });
    const service = new PenaltiesService(supabase as never);

    await service.updateRuleset('pr-1', { name: 'Renamed' } as never, 'user-1');
    expect(supabase.updated.penalty_rulesets?.[0]).toMatchObject({ name: 'Renamed' });
  });

  it('exempts the built-in ruleset from the guard (super-admin edits in place)', async () => {
    const supabase = fakeSupabase({
      penalty_rulesets: { maybeSingle: customRow({ built_in: true, owner_organization_id: null }) },
      platform_roles: { maybeSingle: { role: 'super_admin' } },
      tournaments: { count: 5 },
      events: { count: 0 },
    });
    const service = new PenaltiesService(supabase as never);

    await service.updateRuleset('pr-1', { name: 'Fixed built-in' } as never, 'super-1');
    expect(supabase.updated.penalty_rulesets?.[0]).toMatchObject({ name: 'Fixed built-in' });
  });

  it('blocks deleting a referenced custom ruleset', async () => {
    const supabase = fakeSupabase({
      penalty_rulesets: { maybeSingle: customRow() },
      tournaments: { count: 1 },
      events: { count: 0 },
    });
    const service = new PenaltiesService(supabase as never);

    await expect(service.deleteRuleset('pr-1', 'user-1')).rejects.toThrow(
      /in use by a tournament or event/i,
    );
    expect(supabase.deleted).not.toContain('penalty_rulesets');
  });

  it('allows deleting an unreferenced custom ruleset', async () => {
    const supabase = fakeSupabase({
      penalty_rulesets: { maybeSingle: customRow() },
      tournaments: { count: 0 },
      events: { count: 0 },
    });
    const service = new PenaltiesService(supabase as never);

    await service.deleteRuleset('pr-1', 'user-1');
    expect(supabase.deleted).toContain('penalty_rulesets');
  });
});
