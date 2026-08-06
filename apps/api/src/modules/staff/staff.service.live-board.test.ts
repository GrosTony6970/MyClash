import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { StaffService } from './staff.service';

/**
 * Table-keyed mock that actually APPLIES its filters.
 *
 * getLiveBoard now hits `matches` three times in one Promise.all — the live
 * bouts, the completed tail, and two head-only counts — so a mock that returns
 * every row of a table to every query against it reports a running bout as the
 * lice's `lastCompleted`. That is a green test for broken behaviour, so eq/neq/
 * in/limit are honoured here and fixture rows carry the columns the real
 * queries filter on.
 */
type Filter = (rows: unknown[]) => unknown[];
const cell = (row: unknown, col: string): unknown => (row as Record<string, unknown>)[col];

function makeSupabase(tables: Record<string, unknown[]>) {
  const service = {
    from: vi.fn((table: string) => {
      const rows = tables[table] ?? [];
      const filters: Filter[] = [];
      let take: number | null = null;
      let headOnly = false;

      const apply = (): unknown[] => {
        const out = filters.reduce((acc, f) => f(acc), rows.slice());
        return take === null ? out : out.slice(0, take);
      };

      const chain: Record<string, unknown> = {
        select: vi.fn((_select?: string, opts?: { head?: boolean }) => {
          if (opts?.head) headOnly = true;
          return chain;
        }),
        eq: vi.fn((col: string, val: unknown) => {
          filters.push((rs) => rs.filter((r) => cell(r, col) === val));
          return chain;
        }),
        neq: vi.fn((col: string, val: unknown) => {
          filters.push((rs) => rs.filter((r) => cell(r, col) !== val));
          return chain;
        }),
        in: vi.fn((col: string, vals: unknown[]) => {
          filters.push((rs) => rs.filter((r) => vals.includes(cell(r, col))));
          return chain;
        }),
        order: vi.fn(() => chain),
        limit: vi.fn((n: number) => {
          take = n;
          return chain;
        }),
        maybeSingle: vi.fn(() => Promise.resolve({ data: apply()[0] ?? null, error: null })),
        then: (resolve: (v: unknown) => void) => {
          const data = apply();
          resolve({ data: headOnly ? null : data, error: null, count: data.length });
        },
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
    const svc = new StaffService(supabase as never, orgs as never, {} as never, {} as never);
    // Force the Supabase-user branch:
    vi.spyOn(
      svc as never as { getSupabaseUserId: () => Promise<string> },
      'getSupabaseUserId',
    ).mockResolvedValue('U1');
    await expect(svc.getLiveBoard(req, 'E1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  function authorizedBoard() {
    const supabase = makeSupabase({
      events: [{ id: 'E1', organization_id: 'O1', status: 'running', start_date: '2026-07-21' }],
      lices: [{ id: 'L1', event_id: 'E1', name: 'Piste 1', sort_order: 0 }],
      matches: [
        {
          id: 'm1',
          lice_id: 'L1',
          status: 'running',
          red_score: 1,
          blue_score: 0,
          match_number_label: '#1',
          scheduled_at: '2026-07-21T10:00:00Z',
          started_at: '2026-07-21T10:01:00Z',
          ended_at: null,
          pool_id: null,
          bracket_slots: null,
          red: null,
          blue: null,
        },
        {
          id: 'm0',
          lice_id: 'L1',
          status: 'completed',
          red_score: 5,
          blue_score: 3,
          match_number_label: '#0',
          scheduled_at: '2026-07-21T09:00:00Z',
          started_at: '2026-07-21T09:00:00Z',
          ended_at: '2026-07-21T09:20:00Z',
          pool_id: null,
          bracket_slots: null,
          red: null,
          blue: null,
        },
      ],
      event_staff_accounts: [],
      event_staff_lice_assignments: [],
      event_programme_blocks: [],
    });
    const orgs = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
    const svc = new StaffService(supabase as never, orgs as never, {} as never, {} as never);
    vi.spyOn(
      svc as never as { getSupabaseUserId: () => Promise<string> },
      'getSupabaseUserId',
    ).mockResolvedValue('U1');
    return svc;
  }

  it('assembles one row per lice for an authorized organizer', async () => {
    const out = await authorizedBoard().getLiveBoard(req, 'E1');
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.currentMatch?.id).toBe('m1');
    expect(out.rows[0]!.currentMatch?.redScore).toBe(1);
  });

  it('keeps the completed bout out of currentMatch and reports it as history', async () => {
    const out = await authorizedBoard().getLiveBoard(req, 'E1');
    expect(out.rows[0]!.currentMatch?.id).toBe('m1');
    expect(out.rows[0]!.queue).toEqual([]);
    expect(out.rows[0]!.lastCompleted?.matchId).toBe('m0');
  });

  it('ships a timing basis even when the event has no programme block', async () => {
    // No block covering "now" is the default case, not an error — most events
    // have no programme at all, and the board still has to date its clock.
    const out = await authorizedBoard().getLiveBoard(req, 'E1');
    expect(out.timing.block).toBeNull();
    expect(out.timing.matchDurationMinutes).toBe(5);
    expect(Number.isNaN(Date.parse(out.timing.nowIso))).toBe(false);
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
    const svc = new StaffService({ service } as never, orgs as never, {} as never, {} as never);
    vi.spyOn(
      svc as never as { getSupabaseUserId: () => Promise<string> },
      'getSupabaseUserId',
    ).mockResolvedValue('U1');

    await expect(svc.acknowledgeAttention(req, 'E1', 'a1')).resolves.toEqual({ ok: true });
    expect(updated[0]).toMatchObject({ needs_attention: false, needs_attention_reason: null });
  });
});
