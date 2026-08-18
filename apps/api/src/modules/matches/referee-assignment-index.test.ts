import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import {
  fetchRefereeAssignmentIndex,
  fetchRefereeSkillIndex,
  toAssignmentRow,
} from './referee-assignment-index';
import { resolveMatchReferees } from './resolve-match-referees';

const raw = (over: Record<string, unknown> = {}) => ({
  event_id: 'ev1',
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
 * The two tables the index reads, on the shared double.
 *
 * Seeded rather than canned wherever the filters are what the test is about:
 * `referee_assignments` narrows on event and status, `referee_skills` on the
 * ids the assignments actually named, and none of those decide anything against
 * a fixture that holds only rows which pass them.
 */
function supabaseFor(tables: Readonly<Record<string, TableSeed>>) {
  const sb = mockSupabase(tables);
  return { client: sb.service as unknown as SupabaseClient, from: sb.from };
}

describe('fetchRefereeSkillIndex', () => {
  it('does not query at all for an empty id list', async () => {
    const sb = supabaseFor({});
    await expect(fetchRefereeSkillIndex(sb.client, [])).resolves.toEqual(new Map());
    expect(queriedTables(sb.from)).toEqual([]);
  });

  it('dedupes the ids it asks for', async () => {
    const sb = supabaseFor({ referee_skills: { rows: [] } });
    await fetchRefereeSkillIndex(sb.client, ['a', 'a', 'b']);
    // Argument, not outcome: asking twice for one id returns the same rows, so
    // no fixture can tell a deduped list from a repeated one.
    expect(filtersFor(sb.from, 'referee_skills', 'in')).toEqual([['id', ['a', 'b']]]);
  });

  it('defaults a null colour to slate and skips nameless rows', async () => {
    const sb = supabaseFor({
      referee_skills: {
        rows: [
          { id: 'a', name: 'Table', color: null },
          { id: 'b', name: null },
        ],
      },
    });
    const index = await fetchRefereeSkillIndex(sb.client, ['a', 'b']);
    expect(index.get('a')).toEqual({ name: 'Table', color: 'slate' });
    expect(index.has('b')).toBe(false);
  });

  it('reads only the ids the assignments named', async () => {
    // Skills are global (`is_system`) or event-scoped, so this table holds every
    // other event's roles as well. An unscoped read resolves a role id this
    // event never assigned, and the chip renders a stranger's label.
    const sb = supabaseFor({
      referee_skills: {
        rows: [
          { id: 'a', name: 'Table', color: 'orange' },
          { id: 'z', name: 'Chronométreur', color: 'green' },
        ],
      },
    });
    const index = await fetchRefereeSkillIndex(sb.client, ['a']);
    expect([...index.keys()]).toEqual(['a']);
  });
});

describe('fetchRefereeAssignmentIndex', () => {
  it('reads the event in one assignments query plus one skills query', async () => {
    const sb = supabaseFor({
      referee_assignments: { rows: [raw()] },
      referee_skills: { rows: [] },
    });
    await fetchRefereeAssignmentIndex(sb.client, 'ev1');

    // Two tables, two calls — fixed cost however many assignments the event has.
    expect(queriedTables(sb.from)).toEqual(['referee_assignments', 'referee_skills']);
    const [projection] = selectsFor(sb.from, 'referee_assignments');
    expect(projection).toContain('global_persons(given_name, family_name)');
    expect(projection).toContain('role');
  });

  it('counts assigned, confirmed and pending as officiating, and nothing else', async () => {
    // `pending` is in because an unconfirmed referee is still the one standing
    // on the piste. `declined` and `cancelled` are the rows that must not be.
    const sb = supabaseFor({
      referee_assignments: {
        rows: [
          raw({ status: 'assigned', global_persons: { given_name: 'Ana', family_name: 'Ruiz' } }),
          raw({ status: 'confirmed' }),
          raw({ status: 'pending', global_persons: { given_name: 'Inès', family_name: 'Moreau' } }),
          raw({
            status: 'declined',
            global_persons: { given_name: 'Paul', family_name: 'Dubois' },
          }),
          raw({
            status: 'cancelled',
            global_persons: { given_name: 'Luc', family_name: 'Bernard' },
          }),
        ],
      },
      referee_skills: { rows: [] },
    });
    const index = await fetchRefereeAssignmentIndex(sb.client, 'ev1');
    expect(index.map((row) => row.name)).toEqual(['Ana Ruiz', 'Marc Lefevre', 'Inès Moreau']);
  });

  it('reads this event only, not a neighbouring one', async () => {
    // The event is the ONLY thing narrowing this read, and three services hand
    // the result straight to an in-memory filter. Unscoped it loads every
    // referee assignment in the database and calls it "this event's crew".
    const sb = supabaseFor({
      referee_assignments: {
        rows: [
          raw(),
          raw({
            event_id: 'ev2',
            person_id: 'gp-elsewhere',
            global_persons: { given_name: 'Inès', family_name: 'Moreau' },
          }),
        ],
      },
      referee_skills: { rows: [] },
    });
    const index = await fetchRefereeAssignmentIndex(sb.client, 'ev1');
    expect(index.map((row) => row.name)).toEqual(['Marc Lefevre']);
  });

  it('skips the skills query when no assignment carries a role', async () => {
    // `referee_skills` is deliberately not configured: the shared double throws
    // on a table nobody declared, so a query that should not run fails loudly
    // rather than reading as a passing empty result.
    const sb = supabaseFor({ referee_assignments: { rows: [raw({ role: null })] } });
    await fetchRefereeAssignmentIndex(sb.client, 'ev1');
    expect(queriedTables(sb.from)).toEqual(['referee_assignments']);
  });

  it('joins role → name + colour onto every row', async () => {
    const sb = supabaseFor({
      referee_assignments: { rows: [raw()] },
      referee_skills: { rows: [{ id: 'arbitre_declarant', name: 'Déclarant', color: 'orange' }] },
    });
    const index = await fetchRefereeAssignmentIndex(sb.client, 'ev1');
    expect(index[0]).toMatchObject({ roleLabel: 'Déclarant', roleColor: 'orange' });
  });

  it('drops rows whose person did not resolve, so they cannot shadow a lower tier', async () => {
    // An unresolvable match-scope row would otherwise win precedence over the
    // pool referee and blank out the referee line.
    const sb = supabaseFor({
      referee_assignments: {
        rows: [
          raw({ global_persons: null }),
          raw({ scope_type: 'pool', match_id: null, pool_id: 'p1' }),
        ],
      },
      referee_skills: { rows: [] },
    });
    const index = await fetchRefereeAssignmentIndex(sb.client, 'ev1');

    expect(index).toHaveLength(1);
    expect(
      resolveMatchReferees(index, { matchId: 'm1', poolId: 'p1', liceId: 'l1' }).map((r) => r.name),
    ).toEqual(['Marc Lefevre']);
  });

  it('degrades to no referees rather than throwing when the query fails', async () => {
    // Canned: an error is not a row set, and the filters are not what this
    // asserts.
    const sb = supabaseFor({
      referee_assignments: { data: null, error: { message: 'boom' } },
    });
    await expect(fetchRefereeAssignmentIndex(sb.client, 'ev1')).resolves.toEqual([]);
  });
});
