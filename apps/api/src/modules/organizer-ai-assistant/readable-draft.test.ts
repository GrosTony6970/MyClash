import { beforeEach, describe, expect, it } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { expectNoRawIds } from '../mcp/tools/no-raw-ids.test-helper';
import { mockSupabaseFrom, resetHarness, service } from './organizer-ai-assistant.harness';
import { readableDraftActions } from './readable-draft';

/**
 * Call U (MCP slice 4b). Marie opens a draft and reads it in names: "Longsword Open",
 * "LSW-P2-M4", "Piste 2", "Paul Martin", "Déclarant". An id the Event no longer has reads as
 * missing, and another Event's row never lends its name.
 */

const EVENT = '0e000000-0000-4000-8000-000000000001';
const OTHER_EVENT = '0e000000-0000-4000-8000-000000000002';
const LONGSWORD = '11111111-1111-4111-8111-111111111111';
const FOREIGN_TOURNAMENT = '22222222-2222-4222-8222-222222222222';
const MATCH = '33333333-3333-4333-8333-333333333331';
const FOREIGN_MATCH = '33333333-3333-4333-8333-333333333332';
const LICE = '44444444-4444-4444-8444-444444444441';
const POOL = '55555555-5555-4555-8555-555555555551';
const PHASE = '66666666-6666-4666-8666-666666666661';
const PERSON = '77777777-7777-4777-8777-777777777771';
const SKILL = '88888888-8888-4888-8888-888888888881';
const FOREIGN_SKILL = '88888888-8888-4888-8888-888888888882';
/** Ids no row holds: a Match, piste, Pool, phase, person and role deleted since. */
const GONE = '99999999-9999-4999-8999-999999999999';

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
function seeded(overrides: Record<string, TableSeed> = {}) {
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

const TOURNAMENT_DRAFT = [
  { kind: 'create_tournament', name: 'Sabre Open', slug: 'sabre-open', weapon: 'sabre' },
];
const POOLS_DRAFT = [
  {
    kind: 'generate_pools',
    tournamentId: LONGSWORD,
    poolCount: 4,
    enforceSchoolSeparation: true,
    enforceSkillBalance: false,
  },
];
const BRACKET_DRAFT = [
  {
    kind: 'generate_bracket',
    tournamentId: LONGSWORD,
    phaseType: 'single_elim',
    qualifyCount: 16,
    poolPhaseId: PHASE,
  },
];
const SCHEDULE_DRAFT = [
  { kind: 'schedule_match', matchId: MATCH, liceId: LICE, scheduledAt: '2026-12-05T13:30:00Z' },
];
const REFEREE_DRAFT = [
  { kind: 'assign_referee', userId: PERSON, role: SKILL, poolId: POOL },
  { kind: 'assign_referee', userId: PERSON, role: SKILL, matchId: MATCH },
];

const LSW_P2_M4 = { code: 'LSW-P2-M4', tournament: 'Longsword Open' };
const MISSING = { missing: true };

describe('readableDraftActions', () => {
  it('names each kind of action, with one read per kind of id across the drafts', async () => {
    const db = seeded();

    const readable = await readableDraftActions(db.service as never, EVENT, [
      TOURNAMENT_DRAFT,
      POOLS_DRAFT,
      BRACKET_DRAFT,
      SCHEDULE_DRAFT,
      REFEREE_DRAFT,
    ]);

    expect(readable).toEqual([
      [{ kind: 'create_tournament', name: 'Sabre Open', slug: 'sabre-open', weapon: 'sabre' }],
      [
        {
          kind: 'generate_pools',
          tournament: { name: 'Longsword Open' },
          poolCount: 4,
          schoolSeparation: true,
          skillBalance: false,
        },
      ],
      [
        {
          kind: 'generate_bracket',
          tournament: { name: 'Longsword Open' },
          phaseType: 'single_elim',
          qualifyCount: 16,
          poolPhase: { type: 'pool', tournament: 'Longsword Open' },
        },
      ],
      [
        {
          kind: 'schedule_match',
          match: LSW_P2_M4,
          piste: { name: 'Piste 2' },
          startsAt: '2026-12-05T13:30:00.000Z',
          timezone: 'Europe/Paris',
        },
      ],
      [
        {
          kind: 'assign_referee',
          referee: { name: 'Paul Martin' },
          role: { name: 'Déclarant' },
          pool: { number: 2, tournament: 'Longsword Open' },
        },
        {
          kind: 'assign_referee',
          referee: { name: 'Paul Martin' },
          role: { name: 'Déclarant' },
          match: LSW_P2_M4,
        },
      ],
    ]);
    expectNoRawIds(readable);
    expect([...queriedTables(db.from)].sort()).toEqual([
      'event_referees',
      'events',
      'lices',
      'matches',
      'phases',
      'pools',
      'referee_skills',
      'tournaments',
    ]);
  });

  it('asks each read for its columns, scoped to the Event', async () => {
    const db = seeded();

    await readableDraftActions(db.service as never, EVENT, [
      POOLS_DRAFT,
      BRACKET_DRAFT,
      SCHEDULE_DRAFT,
      REFEREE_DRAFT,
    ]);

    const select = (table: string) => selectsFor(db.from, table);
    const filters = (table: string, method: 'eq' | 'in' | 'or') =>
      filtersFor(db.from, table, method);
    expect(select('tournaments')).toEqual(['id, name']);
    expect(filters('tournaments', 'eq')).toEqual([['event_id', EVENT]]);
    expect(filters('tournaments', 'in')).toEqual([['id', [LONGSWORD]]]);
    expect(select('matches')).toEqual([
      'id, match_number_label, phases(config_json,tournaments(weapon,name,event_id)),pools(sort_order),bracket_slots(round),swiss_rounds(round_number)',
    ]);
    expect(filters('matches', 'in')).toEqual([['id', [MATCH]]]);
    expect(select('lices')).toEqual(['id, name']);
    expect(filters('lices', 'eq')).toEqual([['event_id', EVENT]]);
    expect(filters('lices', 'in')).toEqual([['id', [LICE]]]);
    expect(select('pools')).toEqual(['id, sort_order, phases(tournaments(name, event_id))']);
    expect(filters('pools', 'in')).toEqual([['id', [POOL]]]);
    expect(select('phases')).toEqual(['id, type, tournaments(name, event_id)']);
    expect(filters('phases', 'in')).toEqual([['id', [PHASE]]]);
    expect(select('event_referees')).toEqual([
      'person_id, global_persons(given_name, family_name, display_name)',
    ]);
    expect(filters('event_referees', 'eq')).toEqual([['event_id', EVENT]]);
    expect(filters('event_referees', 'in')).toEqual([['person_id', [PERSON]]]);
    expect(select('referee_skills')).toEqual(['id, name, event_id']);
    expect(filters('referee_skills', 'or')).toEqual([[`event_id.is.null,event_id.eq.${EVENT}`]]);
    expect(select('events')).toEqual(['timezone']);
    expect(filters('events', 'eq')).toEqual([['id', EVENT]]);
  });

  it("reads another Event's Tournament and Match as missing, never by their names", async () => {
    const readable = await readableDraftActions(seeded().service as never, EVENT, [
      [{ kind: 'generate_pools', tournamentId: FOREIGN_TOURNAMENT, poolCount: 2 }],
      [{ kind: 'schedule_match', matchId: FOREIGN_MATCH, liceId: LICE, scheduledAt: 'x' }],
      [{ kind: 'assign_referee', userId: PERSON, role: FOREIGN_SKILL, matchId: FOREIGN_MATCH }],
    ]);

    expect(readable).toEqual([
      [{ kind: 'generate_pools', tournament: MISSING, poolCount: 2 }],
      [
        {
          kind: 'schedule_match',
          match: MISSING,
          piste: { name: 'Piste 2' },
          startsAt: null,
          timezone: 'Europe/Paris',
        },
      ],
      [
        {
          kind: 'assign_referee',
          referee: { name: 'Paul Martin' },
          role: MISSING,
          match: MISSING,
        },
      ],
    ]);
  });

  it('reads a Match, piste, Pool, phase, referee and role deleted since as missing', async () => {
    const readable = await readableDraftActions(seeded().service as never, EVENT, [
      [{ kind: 'generate_bracket', tournamentId: LONGSWORD, poolPhaseId: GONE }],
      [{ kind: 'schedule_match', matchId: GONE, liceId: GONE, scheduledAt: '2026-12-05T13:30Z' }],
      [{ kind: 'assign_referee', userId: GONE, role: GONE, poolId: GONE }],
    ]);

    expect(readable).toEqual([
      [{ kind: 'generate_bracket', tournament: { name: 'Longsword Open' }, poolPhase: MISSING }],
      [
        {
          kind: 'schedule_match',
          match: MISSING,
          piste: MISSING,
          startsAt: '2026-12-05T13:30:00.000Z',
          timezone: 'Europe/Paris',
        },
      ],
      [{ kind: 'assign_referee', referee: MISSING, role: MISSING, pool: MISSING }],
    ]);
    expectNoRawIds(readable);
  });

  it('answers an action of no known kind as unsupported, without echoing it', async () => {
    const db = seeded();

    const readable = await readableDraftActions(db.service as never, EVENT, [
      [{ kind: 'constructor' }, { kind: GONE, tournamentId: LONGSWORD }, null, 'set_pools'],
      'not a list',
    ]);

    expect(readable).toEqual([
      [
        { kind: 'unsupported' },
        { kind: 'unsupported' },
        { kind: 'unsupported' },
        { kind: 'unsupported' },
      ],
      [],
    ]);
    expect(queriedTables(db.from)).toEqual([]);
  });

  it('throws on a failed read rather than read the name as missing', async () => {
    const db = seeded({ tournaments: { data: null, error: { message: 'connection reset' } } });

    await expect(readableDraftActions(db.service as never, EVENT, [POOLS_DRAFT])).rejects.toThrow(
      'draft Tournaments read failed: connection reset',
    );
  });
});

/** The drafts at the Event, as the assistant's list reads them. */
function withDrafts(...drafts: unknown[][]) {
  const db = seeded({
    events: { rows: [{ id: EVENT, organization_id: 'org-1', timezone: 'Europe/Paris' }] },
    organizer_ai_assistant_drafts: {
      rows: drafts.map((actions, index) => ({
        id: `draft-${index + 1}`,
        event_id: EVENT,
        draft_type: 'schedule_grid',
        status: 'ready',
        proposed_actions_json: actions,
        created_at: `2026-11-27T10:0${index}:00.000Z`,
        events: { organization_id: 'org-1' },
      })),
    },
  });
  mockSupabaseFrom.mockImplementation((table: string) => db.from(table));
  return db;
}

describe('the assistant answers each draft with its names', () => {
  beforeEach(resetHarness);

  it('lists three drafts with one read per table, not one per draft', async () => {
    const db = withDrafts(SCHEDULE_DRAFT, SCHEDULE_DRAFT, POOLS_DRAFT);

    const drafts = await service().listDrafts(EVENT, 'user-1');

    expect(drafts.map((draft) => draft.readable.map((action) => action.kind))).toEqual([
      ['generate_pools'],
      ['schedule_match'],
      ['schedule_match'],
    ]);
    expect(queriedTables(db.from)).toEqual([
      'events',
      'organizer_ai_assistant_drafts',
      'tournaments',
      'matches',
      'lices',
      'events',
    ]);
    expect(filtersFor(db.from, 'matches', 'in')).toEqual([['id', [MATCH]]]);
  });

  it('answers one draft with its names', async () => {
    withDrafts(SCHEDULE_DRAFT);

    const draft = await service().getDraft(EVENT, 'draft-1', 'user-1');

    expect(draft.readable).toEqual([
      {
        kind: 'schedule_match',
        match: LSW_P2_M4,
        piste: { name: 'Piste 2' },
        startsAt: '2026-12-05T13:30:00.000Z',
        timezone: 'Europe/Paris',
      },
    ]);
    expect(draft.proposedActions).toEqual(SCHEDULE_DRAFT);
  });
});
