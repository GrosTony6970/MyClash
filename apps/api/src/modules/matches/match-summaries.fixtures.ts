import type { TableSeed } from '../../common/testing/supabase-chain';

/**
 * Four bouts of one Event, one of each kind a summary must name: a Pool bout on
 * a piste with a referee, a double-elimination bout of another Tournament with
 * no piste, a Swiss bout, and a bout with no phase and a piste that is gone.
 * Each bout holds its copy of its rules, as every bout does.
 */
const view = (id: string, over: Record<string, unknown>) => ({
  match_id: id,
  match_number_label: 'L1-P1-M3',
  status: 'scheduled',
  pool_id: null,
  pool_name: null,
  bracket_round: null,
  swiss_round: null,
  red_name: `Red ${id}`,
  blue_name: `Blue ${id}`,
  red_club: 'AAA',
  blue_club: null,
  tournament_id: 't1',
  event_id: 'event-1',
  phase_id: 'phase-pool',
  phase_type: 'pool',
  ...over,
});

export const SUMMARY_BOUTS = ['pool', 'bracket', 'swiss', 'bare'];

/** The copy of its rules a bout of the Open Longsword holds: its format is the bout's. */
const OPEN_LONGSWORD = {
  ruleset_config: { matchFormat: { bestOf: { pool: 3, bracket: 5, finals: 5 } } },
};

const SEED: Record<string, TableSeed> = {
  vw_tournament_query_matches: {
    rows: [
      view('pool', { pool_id: 'p2', pool_name: 'Pool B' }),
      view('bracket', {
        match_number_label: '2',
        bracket_round: 2,
        phase_id: 'phase-de',
        phase_type: 'double_elim',
        tournament_id: 't2',
      }),
      view('swiss', { swiss_round: 3, phase_id: 'phase-sw', phase_type: 'swiss', red_name: null }),
      view('bare', { phase_id: null, phase_type: null, match_number_label: null }),
    ],
  },
  tournaments: {
    rows: [
      {
        id: 't1',
        weapon: 'longsword',
        name: 'Open Longsword',
        scoring_config_json: { sides: { a: 'gold' } },
      },
      { id: 't2', weapon: 'sabre', name: 'Sabre', scoring_config_json: null },
    ],
  },
  phases: {
    rows: [
      { id: 'phase-de', config_json: { mainBracketSize: 8, wbRounds: 3, lbRounds: 4 } },
      // A Pool phase is never read: a size here would turn up in a Pool bout's code.
      { id: 'phase-pool', config_json: { bracketSize: 4 } },
    ],
  },
  pools: { rows: [{ id: 'p2', sort_order: 1 }] },
  events: { rows: [{ id: 'event-1', timezone: 'Europe/Lisbon' }] },
  matches: {
    rows: [
      {
        id: 'pool',
        lice_id: 'lice-1',
        current_round: 2,
        red_round_wins: 1,
        blue_round_wins: 0,
        rounds_json: [{ round: 1 }],
        awaiting_round_advance: true,
        match_rules: OPEN_LONGSWORD,
      },
      { id: 'bracket', lice_id: null, match_rules: { ruleset_config: null } },
      { id: 'swiss', lice_id: 'lice-1', rounds_json: 'not-a-list', match_rules: OPEN_LONGSWORD },
      { id: 'bare', lice_id: 'lice-gone', match_rules: OPEN_LONGSWORD },
    ],
  },
  lices: { rows: [{ id: 'lice-1', name: 'Lice 4' }] },
  referee_assignments: {
    rows: [
      {
        scope_type: 'lice',
        match_id: null,
        pool_id: null,
        lice_id: 'lice-1',
        person_id: 'gp-1',
        role: 'main',
        status: 'confirmed',
        event_id: 'event-1',
        global_persons: { given_name: 'Rita', family_name: 'Ref' },
      },
    ],
  },
  referee_skills: { rows: [{ id: 'main', name: 'Main', color: 'orange' }] },
};

/** A copy per test: a test may take a table out of it. */
export const summarySeed = (): Record<string, TableSeed> => ({ ...SEED });
