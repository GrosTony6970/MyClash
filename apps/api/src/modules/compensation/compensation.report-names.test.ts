import { describe, expect, it } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { CompensationService } from './compensation.service';

/**
 * The pay report's referee names (X2, operator ruling 2026-10-15): a referee with no name
 * known is sent blank, and the page words it. Never their id.
 */
const duty = (id: string, personId: string) => ({
  id,
  person_id: personId,
  scope_type: 'match',
  role: 'arbitre_declarant',
  match_id: 'm-1',
});

const TABLES = {
  referee_compensation_event_settings: {
    data: { event_id: 'event-1', plan_id: 'plan-1', referee_compensation_plans: { name: 'P' } },
    error: null,
  },
  referee_compensation_plans: {
    data: {
      id: 'plan-1',
      name: 'P',
      referee_compensation_role_rates: [
        {
          id: 'rr-1',
          referee_role: 'arbitre_declarant',
          compensation_phase: 'pool',
          tokens_per_match: 1,
        },
      ],
      referee_compensation_tiers: [],
    },
    error: null,
  },
  referee_assignments: {
    data: [duty('a-1', 'gp-named'), duty('a-2', 'gp-blank'), duty('a-3', 'gp-gone')],
    error: null,
  },
  matches: {
    data: [
      { id: 'm-1', match_number_label: 'L1-P1-M1', status: 'completed', phases: { type: 'pool' } },
    ],
    error: null,
  },
  referee_compensation_payments: { data: [], error: null },
};

function reportFor(globalPersons: Array<Record<string, unknown>>) {
  const supabase = mockSupabase({
    ...TABLES,
    global_persons: { data: globalPersons, error: null },
  });
  return new CompensationService(supabase as never).computeReport('event-1');
}

describe('CompensationService.computeReport — names', () => {
  it('sends a blank name for a referee nobody named or no profile names, never the id', async () => {
    const report = await reportFor([
      { id: 'gp-named', given_name: 'Léa', family_name: 'Martin' },
      { id: 'gp-blank', given_name: null, family_name: ' ' },
    ]);

    expect(
      report.referees.map((referee) => [referee.personId, referee.displayName]).sort(),
    ).toEqual([
      ['gp-blank', ''],
      ['gp-gone', ''],
      ['gp-named', 'Léa Martin'],
    ]);
  });
});
