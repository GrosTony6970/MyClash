import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchRefereeAssignmentIndex, toAssignmentRow } from './referee-assignment-index';
import { resolveMatchReferees } from './resolve-match-referees';

const raw = (over: Record<string, unknown> = {}) => ({
  scope_type: 'match',
  match_id: 'm1',
  pool_id: null,
  lice_id: null,
  person_id: 'gp1',
  global_persons: { given_name: 'Marc', family_name: 'Lefevre' },
  ...over,
});

describe('toAssignmentRow', () => {
  it('composes given + family into the display name', () => {
    expect(toAssignmentRow(raw()).name).toBe('Marc Lefevre');
  });

  it('accepts the embed as an array as well as an object', () => {
    // PostgREST flips many-to-one embeds between the two shapes.
    const asArray = raw({ global_persons: [{ given_name: 'Ana', family_name: 'Ruiz' }] });
    expect(toAssignmentRow(asArray).name).toBe('Ana Ruiz');
  });

  it('yields an empty name when the person cannot be resolved', () => {
    expect(toAssignmentRow(raw({ global_persons: null })).name).toBe('');
    expect(toAssignmentRow(raw({ global_persons: [] })).name).toBe('');
  });

  it('tolerates a half-populated person without leaving stray whitespace', () => {
    expect(toAssignmentRow(raw({ global_persons: { family_name: 'Ruiz' } })).name).toBe('Ruiz');
    expect(toAssignmentRow(raw({ global_persons: { given_name: 'Ana' } })).name).toBe('Ana');
  });

  it('carries the scope fields through untouched', () => {
    const row = toAssignmentRow(
      raw({ scope_type: 'pool', match_id: null, pool_id: 'p1', lice_id: 'l1' }),
    );
    expect(row).toMatchObject({
      scopeType: 'pool',
      matchId: null,
      poolId: 'p1',
      liceId: 'l1',
    });
  });
});

/** Minimal PostgREST chain: `.from().select().eq().in()` resolving to `result`. */
function fakeSupabase(result: { data?: unknown; error?: unknown }) {
  const inFn = vi.fn().mockResolvedValue({ data: null, error: null, ...result });
  const eq = vi.fn(() => ({ in: inFn }));
  const select = vi.fn((_columns: string) => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as unknown as SupabaseClient, from, select, eq, in: inFn };
}

describe('fetchRefereeAssignmentIndex', () => {
  it('reads the whole event in a single query', async () => {
    const sb = fakeSupabase({ data: [raw()] });
    await fetchRefereeAssignmentIndex(sb.client, 'ev1');

    expect(sb.from).toHaveBeenCalledTimes(1);
    expect(sb.from).toHaveBeenCalledWith('referee_assignments');
    expect(sb.eq).toHaveBeenCalledWith('event_id', 'ev1');
    // The name comes from the embed — a second global_persons round trip is
    // exactly what this helper exists to remove.
    expect(sb.select.mock.calls[0]?.[0]).toContain('global_persons(given_name, family_name)');
  });

  it('counts assigned, confirmed and pending as officiating', async () => {
    const sb = fakeSupabase({ data: [] });
    await fetchRefereeAssignmentIndex(sb.client, 'ev1');
    expect(sb.in).toHaveBeenCalledWith('status', ['assigned', 'confirmed', 'pending']);
  });

  it('drops rows whose person did not resolve, so they cannot shadow a lower tier', async () => {
    // An unresolvable match-scope row would otherwise win precedence over the
    // pool referee and blank out the referee line.
    const sb = fakeSupabase({
      data: [
        raw({ global_persons: null }),
        raw({ scope_type: 'pool', match_id: null, pool_id: 'p1' }),
      ],
    });
    const index = await fetchRefereeAssignmentIndex(sb.client, 'ev1');

    expect(index).toHaveLength(1);
    expect(resolveMatchReferees(index, { matchId: 'm1', poolId: 'p1', liceId: 'l1' })).toEqual([
      'Marc Lefevre',
    ]);
  });

  it('degrades to no referees rather than throwing when the query fails', async () => {
    const sb = fakeSupabase({ data: null, error: { message: 'boom' } });
    await expect(fetchRefereeAssignmentIndex(sb.client, 'ev1')).resolves.toEqual([]);
  });
});
