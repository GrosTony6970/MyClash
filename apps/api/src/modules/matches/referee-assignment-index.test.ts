import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchRefereeAssignmentIndex,
  fetchRefereeSkillIndex,
  toAssignmentRow,
} from './referee-assignment-index';
import { resolveMatchReferees } from './resolve-match-referees';

const raw = (over: Record<string, unknown> = {}) => ({
  scope_type: 'match',
  match_id: 'm1',
  pool_id: null,
  lice_id: null,
  person_id: 'gp1',
  role: 'arbitre_declarant',
  status: 'confirmed',
  global_persons: { given_name: 'Marc', family_name: 'Lefevre' },
  ...over,
});

const SKILLS = new Map([
  ['arbitre_declarant', { name: 'Déclarant', color: 'orange' }],
  ['arbitre_assesseur', { name: 'Assesseur', color: 'blue' }],
]);

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

  it('resolves the role to its skill name and colour token', () => {
    expect(toAssignmentRow(raw(), SKILLS)).toMatchObject({
      role: 'arbitre_declarant',
      roleLabel: 'Déclarant',
      roleColor: 'orange',
    });
  });

  it('falls back to the raw role id and slate for an unknown skill', () => {
    // `referee_assignments.role` has no FK, so a custom or deleted skill id is
    // a legitimate value. A blank chip would read as "no role assigned".
    expect(toAssignmentRow(raw({ role: 'custom-timekeeper' }), SKILLS)).toMatchObject({
      role: 'custom-timekeeper',
      roleLabel: 'custom-timekeeper',
      roleColor: 'slate',
    });
  });

  it('leaves the label null when the assignment carries no role at all', () => {
    expect(toAssignmentRow(raw({ role: null }), SKILLS)).toMatchObject({
      role: null,
      roleLabel: null,
      roleColor: 'slate',
    });
  });

  it('carries the confirmation status, defaulting an unprojected one to assigned', () => {
    // Never 'confirmed' by default: the bracket card colour-codes this dot, and
    // guessing upwards would show an unconfirmed board as a settled one.
    expect(toAssignmentRow(raw()).status).toBe('confirmed');
    expect(toAssignmentRow(raw({ status: undefined })).status).toBe('assigned');
  });
});

/**
 * Table-aware PostgREST double. `referee_assignments` resolves through
 * `.select().eq().in()`; `referee_skills` through `.select().in()`.
 */
function fakeSupabase(opts: {
  assignments?: { data?: unknown; error?: unknown };
  skills?: { data?: unknown; error?: unknown };
}) {
  const calls: { assignmentsSelect?: string; skillsIn?: unknown; statuses?: unknown } = {};
  const assignmentsIn = vi.fn((_column: string, values: unknown) => {
    calls.statuses = values;
    return Promise.resolve({ data: null, error: null, ...opts.assignments });
  });
  const skillsIn = vi.fn((_column: string, values: unknown) => {
    calls.skillsIn = values;
    return Promise.resolve({ data: null, error: null, ...opts.skills });
  });
  const from = vi.fn((table: string) => {
    if (table === 'referee_skills') {
      return { select: vi.fn(() => ({ in: skillsIn })) };
    }
    return {
      select: vi.fn((columns: string) => {
        calls.assignmentsSelect = columns;
        return { eq: vi.fn(() => ({ in: assignmentsIn })) };
      }),
    };
  });
  return { client: { from } as unknown as SupabaseClient, from, calls, skillsIn };
}

describe('fetchRefereeSkillIndex', () => {
  it('does not query at all for an empty id list', async () => {
    const sb = fakeSupabase({});
    await expect(fetchRefereeSkillIndex(sb.client, [])).resolves.toEqual(new Map());
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('dedupes the ids it asks for', async () => {
    const sb = fakeSupabase({ skills: { data: [] } });
    await fetchRefereeSkillIndex(sb.client, ['a', 'a', 'b']);
    expect(sb.calls.skillsIn).toEqual(['a', 'b']);
  });

  it('defaults a null colour to slate and skips nameless rows', async () => {
    const sb = fakeSupabase({
      skills: {
        data: [
          { id: 'a', name: 'Table', color: null },
          { id: 'b', name: null },
        ],
      },
    });
    const index = await fetchRefereeSkillIndex(sb.client, ['a', 'b']);
    expect(index.get('a')).toEqual({ name: 'Table', color: 'slate' });
    expect(index.has('b')).toBe(false);
  });
});

describe('fetchRefereeAssignmentIndex', () => {
  it('reads the event in one assignments query plus one skills query', async () => {
    const sb = fakeSupabase({ assignments: { data: [raw()] }, skills: { data: [] } });
    await fetchRefereeAssignmentIndex(sb.client, 'ev1');

    expect(sb.from).toHaveBeenCalledWith('referee_assignments');
    expect(sb.from).toHaveBeenCalledWith('referee_skills');
    // Two tables, two calls — fixed cost however many assignments the event has.
    expect(sb.from).toHaveBeenCalledTimes(2);
    expect(sb.calls.assignmentsSelect).toContain('global_persons(given_name, family_name)');
    expect(sb.calls.assignmentsSelect).toContain('role');
  });

  it('counts assigned, confirmed and pending as officiating', async () => {
    const sb = fakeSupabase({ assignments: { data: [] } });
    await fetchRefereeAssignmentIndex(sb.client, 'ev1');
    expect(sb.calls.statuses).toEqual(['assigned', 'confirmed', 'pending']);
  });

  it('skips the skills query when no assignment carries a role', async () => {
    const sb = fakeSupabase({ assignments: { data: [raw({ role: null })] } });
    await fetchRefereeAssignmentIndex(sb.client, 'ev1');
    expect(sb.from).toHaveBeenCalledTimes(1);
  });

  it('joins role → name + colour onto every row', async () => {
    const sb = fakeSupabase({
      assignments: { data: [raw()] },
      skills: { data: [{ id: 'arbitre_declarant', name: 'Déclarant', color: 'orange' }] },
    });
    const index = await fetchRefereeAssignmentIndex(sb.client, 'ev1');
    expect(index[0]).toMatchObject({ roleLabel: 'Déclarant', roleColor: 'orange' });
  });

  it('drops rows whose person did not resolve, so they cannot shadow a lower tier', async () => {
    // An unresolvable match-scope row would otherwise win precedence over the
    // pool referee and blank out the referee line.
    const sb = fakeSupabase({
      assignments: {
        data: [
          raw({ global_persons: null }),
          raw({ scope_type: 'pool', match_id: null, pool_id: 'p1' }),
        ],
      },
      skills: { data: [] },
    });
    const index = await fetchRefereeAssignmentIndex(sb.client, 'ev1');

    expect(index).toHaveLength(1);
    expect(
      resolveMatchReferees(index, { matchId: 'm1', poolId: 'p1', liceId: 'l1' }).map((r) => r.name),
    ).toEqual(['Marc Lefevre']);
  });

  it('degrades to no referees rather than throwing when the query fails', async () => {
    const sb = fakeSupabase({ assignments: { data: null, error: { message: 'boom' } } });
    await expect(fetchRefereeAssignmentIndex(sb.client, 'ev1')).resolves.toEqual([]);
  });
});
