import { describe, expect, it, vi } from 'vitest';
import {
  downstreamSlots,
  findDownstreamMatchIds,
  retractGrandFinalReset,
} from './bracket-downstream';

/**
 * "What depends on this match?" — the question the override guard and the
 * downstream clear both ask.
 *
 * The regression these pin: the lookup used to require
 * `winner_registration_id`, copied from `onMatchCompleted`, which genuinely
 * needs a winner because it has one to propagate. A caller asking what depends
 * on a match does not. The consequence was an asymmetry with teeth — the guard
 * runs BEFORE the winner is written and saw nothing, while the destructive
 * clear runs AFTER and saw everything, so an override on a bracket match
 * completed with no winner cleared a downstream side with no started-check
 * having run. Completing with no winner is not exotic: it is every bout that
 * ends on the clock or on max-doubles.
 */
describe('downstreamSlots', () => {
  it('resolves the fed slots for a completed match with NO winner', async () => {
    const supabase = fakeClient({
      matches: {
        maybeSingle: {
          id: 'match-1',
          bracket_slot_id: 'slot-1',
          winner_registration_id: null,
          red_registration_id: 'reg-red',
          blue_registration_id: 'reg-blue',
        },
        select: [{ id: 'downstream-1' }],
      },
      bracket_slots: {
        maybeSingle: { id: 'slot-1', round: 1, position: 1, phase_id: 'phase-1' },
        select: [{ id: 'slot-9', source_a_ref: 'winner of R1M1', source_b_ref: null }],
      },
      phases: { maybeSingle: { id: 'phase-1', type: 'single_elim', config_json: {} } },
    });

    const result = await downstreamSlots(supabase as never, 'match-1');

    expect(result).not.toBeNull();
    expect(result?.slots).toHaveLength(1);
    expect(await findDownstreamMatchIds(supabase as never, 'match-1')).toEqual(['downstream-1']);
  });

  it('still returns null for a pool match, which feeds nothing by refs', async () => {
    const supabase = fakeClient({
      matches: {
        maybeSingle: {
          id: 'match-1',
          bracket_slot_id: null,
          winner_registration_id: 'reg-blue',
          red_registration_id: 'reg-red',
          blue_registration_id: 'reg-blue',
        },
      },
    });

    expect(await downstreamSlots(supabase as never, 'match-1')).toBeNull();
    expect(await findDownstreamMatchIds(supabase as never, 'match-1')).toEqual([]);
  });

  it('returns null when the match row is missing', async () => {
    const supabase = fakeClient({ matches: { maybeSingle: null } });

    expect(await downstreamSlots(supabase as never, 'nope')).toBeNull();
  });
});

/**
 * The reset slot is the one slot generated with no placeholder `matches` row,
 * so when the losers-bracket entrant wins the grand final the row is created on
 * demand. Changing that result to a winners-bracket win used to leave it
 * behind: a `scheduled` bout naming both finalists, on the schedule grid and
 * the public schedule, that must never be played.
 */
describe('retractGrandFinalReset', () => {
  /** Grand final at round 8 of a wb3/lb4 double elim — its self-ref is `GF`. */
  function grandFinalState(resetMatches: unknown[]) {
    return {
      matches: {
        maybeSingle: {
          id: 'gf-match',
          bracket_slot_id: 'slot-gf',
          winner_registration_id: 'wb-entrant',
          red_registration_id: 'wb-entrant',
          blue_registration_id: 'lb-entrant',
        },
        select: resetMatches,
      },
      bracket_slots: {
        maybeSingle: { id: 'slot-gf', round: 8, position: 1, phase_id: 'phase-1' },
        select: [{ id: 'slot-reset', source_a_ref: 'loser of GF', source_b_ref: 'winner of GF' }],
      },
      phases: {
        maybeSingle: {
          id: 'phase-1',
          type: 'double_elim',
          config_json: { grandFinalReset: true, wbRounds: 3, lbRounds: 4 },
        },
      },
    };
  }

  it('clears both reset sides and deletes the match created on demand', async () => {
    const supabase = fakeClient(grandFinalState([{ id: 'reset-match' }]));

    await retractGrandFinalReset(supabase as never, 'gf-match');

    // Both sides in one patch: the reset is the only slot taking A and B from
    // the same upstream match.
    expect(supabase.updates).toEqual([
      { table: 'bracket_slots', patch: { registration_a_id: null, registration_b_id: null } },
    ]);
    // Referee assignments FIRST. `referee_assignments.match_id` is ON DELETE
    // SET NULL and `referee_assignments_scope_check` (0091) forbids a null one
    // when scope_type='match' — Postgres validates CHECKs on the SET NULL
    // action, so the reverse order does not orphan a row, it aborts the delete.
    expect(supabase.deletes.map((entry) => entry.table)).toEqual([
      'referee_assignments',
      'matches',
    ]);
    expect(supabase.deletes[1]?.filters).toContainEqual(['id', ['reset-match']]);
  });

  it('leaves a reset match that carries a result alone', async () => {
    // The scheduled + never-started probe finds nothing to remove; the caller's
    // started-dependents guard owns refusing that case, not this function.
    const supabase = fakeClient(grandFinalState([]));

    await retractGrandFinalReset(supabase as never, 'gf-match');

    expect(supabase.deletes).toEqual([]);
    expect(supabase.updates).toHaveLength(1);
  });
});

type TableState = Record<string, { maybeSingle?: unknown; select?: unknown[] }>;

/** Table-keyed rather than call-ordered — an added query must not desync it. */
function fakeClient(state: TableState) {
  const updates: Array<{ table: string; patch: unknown }> = [];
  const deletes: Array<{ table: string; filters: Array<[string, unknown]> }> = [];

  return {
    updates,
    deletes,
    from: vi.fn((table: string) => {
      const tableState = state[table] ?? {};
      const api: Record<string, unknown> = {};
      // Shared by reference with the recorded delete: the filters come AFTER
      // `.delete()` in the fluent chain and have to land on the entry it pushed.
      const filters: Array<[string, unknown]> = [];
      // Every filter is both chainable and thenable, because any of them can be
      // the terminal call — `.delete().in(…)` resolves on the `in`.
      const resolve = () =>
        Object.assign(Promise.resolve({ data: tableState.select ?? [], error: null }), api);
      const filter = (column: string, value: unknown) => {
        filters.push([column, value]);
        return resolve();
      };
      Object.assign(api, {
        select: vi.fn(resolve),
        eq: vi.fn(filter),
        in: vi.fn(filter),
        is: vi.fn(filter),
        not: vi.fn(filter),
        or: vi.fn(resolve),
        maybeSingle: vi.fn(() =>
          Promise.resolve({ data: tableState.maybeSingle ?? null, error: null }),
        ),
        update: vi.fn((patch: unknown) => {
          updates.push({ table, patch });
          return api;
        }),
        delete: vi.fn(() => {
          deletes.push({ table, filters });
          return api;
        }),
      });
      return api;
    }),
  };
}
