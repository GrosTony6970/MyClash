/**
 * The rows and drafts the draft-name tests share (call U, MCP slice 4b): the Longsword Open's
 * Tournament, Match, piste, Pool, phase, referee and role, and a row of another Event for each
 * read the Event scopes. Test-only: `apps/api/tsconfig.build.json` lists it by path.
 */
import { mockSupabase, type TableSeed } from '../../common/testing/supabase-chain';

export const EVENT = '0e000000-0000-4000-8000-000000000001';
export const OTHER_EVENT = '0e000000-0000-4000-8000-000000000002';
export const LONGSWORD = '11111111-1111-4111-8111-111111111111';
export const FOREIGN_TOURNAMENT = '22222222-2222-4222-8222-222222222222';
export const MATCH = '33333333-3333-4333-8333-333333333331';
export const FOREIGN_MATCH = '33333333-3333-4333-8333-333333333332';
export const LICE = '44444444-4444-4444-8444-444444444441';
export const POOL = '55555555-5555-4555-8555-555555555551';
export const PHASE = '66666666-6666-4666-8666-666666666661';
export const PERSON = '77777777-7777-4777-8777-777777777771';
export const SKILL = '88888888-8888-4888-8888-888888888881';
export const FOREIGN_SKILL = '88888888-8888-4888-8888-888888888882';
/** Ids no row holds: a Match, piste, Pool, phase, person and role deleted since. */
export const GONE = '99999999-9999-4999-8999-999999999999';

const own = { name: 'Longsword Open', event_id: EVENT };

/** Pool bout 4 of the Longsword Open's second Pool, and a bout of another Event. */
const MATCH_ROWS = [
  {
    id: MATCH,
    match_number_label: '4',
    phases: { config_json: null, tournaments: { weapon: 'longsword', ...own } },
    pools: { sort_order: 1 },
    bracket_slots: null,
    swiss_rounds: null,
  },
  {
    id: FOREIGN_MATCH,
    match_number_label: '1',
    phases: {
      config_json: null,
      tournaments: { weapon: 'sabre', name: 'Sabre Cup', event_id: OTHER_EVENT },
    },
    pools: { sort_order: 0 },
  },
];

/** The Event's rows, and one Tournament, Match and role of another Event. */
export function seeded(overrides: Record<string, TableSeed> = {}) {
  return mockSupabase({
    events: { rows: [{ id: EVENT, timezone: 'Europe/Paris' }] },
    tournaments: {
      rows: [
        { id: LONGSWORD, ...own },
        { id: FOREIGN_TOURNAMENT, name: 'Sabre Cup', event_id: OTHER_EVENT },
      ],
    },
    matches: { rows: MATCH_ROWS },
    lices: { rows: [{ id: LICE, event_id: EVENT, name: 'Piste 2' }] },
    pools: { rows: [{ id: POOL, sort_order: 1, phases: { tournaments: own } }] },
    phases: { rows: [{ id: PHASE, type: 'pool', tournaments: own }] },
    event_referees: {
      rows: [
        {
          event_id: EVENT,
          person_id: PERSON,
          global_persons: { given_name: 'Paul', family_name: 'Martin', display_name: 'Paulo' },
        },
      ],
    },
    referee_skills: {
      rows: [
        { id: SKILL, name: 'Déclarant', event_id: null },
        { id: FOREIGN_SKILL, name: 'Juge', event_id: OTHER_EVENT },
      ],
    },
    ...overrides,
  });
}

export const TOURNAMENT_DRAFT = [
  { kind: 'create_tournament', name: 'Sabre Open', slug: 'sabre-open', weapon: 'sabre' },
];
export const POOLS_DRAFT = [
  {
    kind: 'generate_pools',
    tournamentId: LONGSWORD,
    poolCount: 4,
    enforceSchoolSeparation: true,
    enforceSkillBalance: false,
  },
];
export const BRACKET_DRAFT = [
  {
    kind: 'generate_bracket',
    tournamentId: LONGSWORD,
    phaseType: 'single_elim',
    qualifyCount: 16,
    poolPhaseId: PHASE,
  },
];
export const SCHEDULE_DRAFT = [
  { kind: 'schedule_match', matchId: MATCH, liceId: LICE, scheduledAt: '2026-12-05T13:30:00Z' },
];
export const REFEREE_DRAFT = [
  { kind: 'assign_referee', userId: PERSON, role: SKILL, poolId: POOL },
  { kind: 'assign_referee', userId: PERSON, role: SKILL, matchId: MATCH },
];

export const LSW_P2_M4 = { code: 'LSW-P2-M4', tournament: 'Longsword Open' };
export const MISSING = { missing: true };
