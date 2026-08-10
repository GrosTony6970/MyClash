import { describe, expect, it, vi } from 'vitest';
import { downstreamSlots, findDownstreamMatchIds } from './bracket-downstream';

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

type TableState = Record<string, { maybeSingle?: unknown; select?: unknown[] }>;

/** Table-keyed rather than call-ordered — an added query must not desync it. */
function fakeClient(state: TableState) {
  return {
    from: vi.fn((table: string) => {
      const tableState = state[table] ?? {};
      const api: Record<string, unknown> = {};
      const chain = () => api;
      Object.assign(api, {
        select: vi.fn(() =>
          Object.assign(Promise.resolve({ data: tableState.select ?? [], error: null }), api),
        ),
        eq: vi.fn(chain),
        in: vi.fn(() =>
          Object.assign(Promise.resolve({ data: tableState.select ?? [], error: null }), api),
        ),
        or: vi.fn(() =>
          Object.assign(Promise.resolve({ data: tableState.select ?? [], error: null }), api),
        ),
        maybeSingle: vi.fn(() =>
          Promise.resolve({ data: tableState.maybeSingle ?? null, error: null }),
        ),
      });
      return api;
    }),
  };
}
