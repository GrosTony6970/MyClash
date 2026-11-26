import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { rankRandom } from '@myclash/rules/results';
import {
  mockSupabase,
  queriedTables,
  scopedTo,
  selectsFor,
  writesTo,
  type SupabaseRow,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { PhasesService } from './phases.service';
import { withStampedRules } from './match-rules.fixtures';

/**
 * Team Longsword (t-team) goes to a bracket of four. A side of a slot and of a bout holds a
 * Registration or a team (0282): every bracket writer puts a team into the team columns and
 * clears the Registration columns. With no Pools, the teams' seeds set the order only (ruling
 * 982): the bracket ranks them 1..N in that order, so no team drops out on a repeated seed or a
 * seed above the bracket size.
 */

const TEAM_T = 't-team';
const TF = { ruleset_code: 'TF_v1', ruleset_version: '1.1.0' };
const TEAM_TOURNAMENT = {
  ...TF,
  entrant_kind: 'team',
  event_id: 'event-1',
  events: { organization_id: 'org-1' },
};
const BRACKET: SupabaseRow = {
  id: 'bracket-1',
  type: 'single_elim',
  config_json: {},
  tournament_id: TEAM_T,
  tournaments: TEAM_TOURNAMENT,
};
const POOL_PHASE: SupabaseRow = {
  id: 'pool-phase-1',
  type: 'pool',
  config_json: {},
  tournament_id: TEAM_T,
};
/** A bracket of four: seed 1 meets seed 4, seed 3 meets seed 2. */
const R1_SLOTS: SupabaseRow[] = [
  {
    id: 'slot-1',
    phase_id: 'bracket-1',
    round: 1,
    position: 1,
    source_a_ref: 'seed 1',
    source_b_ref: 'seed 4',
  },
  {
    id: 'slot-2',
    phase_id: 'bracket-1',
    round: 1,
    position: 2,
    source_a_ref: 'seed 3',
    source_b_ref: 'seed 2',
  },
];
/** The placeholder bout of slot 1; slot 2 has none, so its bout is inserted. */
const SLOT_1_BOUT: SupabaseRow = { id: 'm-1', bracket_slot_id: 'slot-1', status: 'scheduled' };

const team = (id: string, seed: number | null, hour: string, tournamentId = TEAM_T) => ({
  id,
  seed,
  created_at: `2026-11-01T${hour}:00:00.000Z`,
  tournament_id: tournamentId,
});
/** Team Rapier's team, next door: a read that drops the Tournament filter places it. */
const OTHER_TEAM = team('team-other', 1, '06', 't-other');

const orgs = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };

function makeService(seed: Record<string, TableSeed>, poolStandings?: unknown) {
  const supabase = mockSupabase(
    ...withStampedRules({
      tournaments: { rows: [{ id: TEAM_T, ...TEAM_TOURNAMENT }] },
      audit_log: { rows: [] },
      ...seed,
    }),
  );
  const service = new PhasesService(
    supabase as never,
    { placeMatches: vi.fn(() => Promise.resolve()) } as never,
    undefined,
    orgs as never,
    undefined,
    poolStandings as never,
  );
  return { service, supabase };
}

/** Each slot's written sides, by slot id. */
function slotWrites(supabase: ReturnType<typeof mockSupabase>): Record<string, unknown> {
  return Object.fromEntries(
    writesTo(supabase, 'bracket_slots').map((write) => [scopedTo(write, 'id'), write.row]),
  );
}

/** The slot sides a team pairing writes: the team columns, the Registration columns cleared. */
const teamSlot = (a: string | null, b: string | null) => ({
  registration_a_id: null,
  team_a_id: a,
  registration_b_id: null,
  team_b_id: b,
});
const teamBout = (red: string | null, blue: string | null) => ({
  red_registration_id: null,
  red_team_id: red,
  blue_registration_id: null,
  blue_team_id: blue,
});

const POPULATE_PHASE_SELECT =
  'id, type, config_json, tournament_id, tournaments!inner(event_id, entrant_kind, events!inner(organization_id))';

describe('populateBracket — a team Tournament', () => {
  it('places the teams of the Pool standings in the team columns of slots and bouts', async () => {
    const standings = {
      getPoolStandings: vi.fn((_id: string, mode: 'by-pool' | 'overall') =>
        Promise.resolve(
          mode === 'overall'
            ? {
                rows: ['team-a', 'team-b', 'team-c', 'team-d'].map((entrantId, i) => ({
                  rank: i + 1,
                  entrantId,
                })),
              }
            : { pools: [{ poolId: 'p1', poolName: 'Pool 1', status: 'completed', rows: [] }] },
        ),
      ),
    };
    const { service, supabase } = makeService(
      {
        phases: { rows: [POOL_PHASE, BRACKET] },
        bracket_slots: { rows: R1_SLOTS },
        matches: { rows: [SLOT_1_BOUT] },
      },
      standings,
    );

    const result = await service.populateBracket(TEAM_T, {}, 'system');

    expect(result).toMatchObject({ source: 'pool-standings', slotsSeeded: 2 });
    expect(slotWrites(supabase)).toEqual({
      'slot-1': teamSlot('team-a', 'team-d'),
      'slot-2': teamSlot('team-c', 'team-b'),
    });
    const bouts = writesTo(supabase, 'matches');
    expect(bouts.map((write) => write.op)).toEqual(['update', 'insert']);
    expect(bouts[0]?.row).toEqual(teamBout('team-a', 'team-d'));
    expect(scopedTo(bouts[0], 'id')).toBe('m-1');
    expect(bouts[1]?.row).toMatchObject({
      bracket_slot_id: 'slot-2',
      ...teamBout('team-c', 'team-b'),
    });
    expect(selectsFor(supabase.from, 'phases')).toContain(POPULATE_PHASE_SELECT);
  });

  it.each([
    {
      seeds: '{3, 3, –, –}',
      teams: [
        team('team-a', null, '08'),
        team('team-b', 3, '10'),
        team('team-c', 3, '09'),
        team('team-d', null, '07'),
      ],
      // c and b share seed 3: the first made first. Then d and a, unseeded, by creation.
      placed: { 'slot-1': teamSlot('team-c', 'team-a'), 'slot-2': teamSlot('team-d', 'team-b') },
    },
    {
      seeds: '{5, 8, –, –}',
      teams: [
        team('team-a', 8, '07'),
        team('team-b', null, '09'),
        team('team-c', 5, '10'),
        team('team-d', null, '08'),
      ],
      // Seeds 5 and 8 are above a bracket of four: they rank 1 and 2, not 5 and 8.
      placed: { 'slot-1': teamSlot('team-c', 'team-b'), 'slot-2': teamSlot('team-d', 'team-a') },
    },
  ])(
    'with no Pools, places all four teams seeded $seeds in seed order',
    async ({ teams, placed }) => {
      const { service, supabase } = makeService({
        phases: { rows: [BRACKET] },
        bracket_slots: { rows: R1_SLOTS },
        matches: { rows: [SLOT_1_BOUT] },
        teams: { rows: [OTHER_TEAM, ...teams] },
      });

      const result = await service.populateBracket(TEAM_T, {}, 'system');

      expect(result).toMatchObject({ source: 'registration-seed', slotsSeeded: 2 });
      expect(slotWrites(supabase)).toEqual(placed);
      expect(selectsFor(supabase.from, 'teams')).toEqual(['id, seed, created_at']);
      expect(queriedTables(supabase.from)).not.toContain('registrations');
    },
  );

  it('draws a random bracket that its stored seed replays', async () => {
    const teams = [
      team('team-a', 1, '07'),
      team('team-b', 2, '08'),
      team('team-c', 3, '09'),
      team('team-d', 4, '10'),
    ];
    const draw = () =>
      makeService({
        phases: {
          rows: [
            { ...BRACKET, config_json: { seedingStrategy: 'random', seedingRandomSeed: 4242 } },
          ],
        },
        bracket_slots: { rows: R1_SLOTS },
        matches: { rows: [SLOT_1_BOUT] },
        teams: { rows: [OTHER_TEAM, ...teams] },
      });

    const first = draw();
    const second = draw();
    await first.service.populateBracket(TEAM_T, {}, 'system');
    await second.service.populateBracket(TEAM_T, {}, 'system');

    // The draw `rankRandom` makes from the seed: rank K to the side of seed K.
    const byRank = new Map(
      rankRandom(
        teams.map((t) => ({ id: t.id, seed: null, bibNumber: null })),
        4242,
      ).map((r) => [r.rank, r.entrantId]),
    );
    const at = (rank: number) => byRank.get(rank)!;
    expect(slotWrites(first.supabase)).toEqual({
      'slot-1': teamSlot(at(1), at(4)),
      'slot-2': teamSlot(at(3), at(2)),
    });
    expect(slotWrites(second.supabase)).toEqual(slotWrites(first.supabase));
    const config = writesTo(first.supabase, 'phases').at(-1)?.row as SupabaseRow;
    expect(config['config_json']).toMatchObject({ seedingRandomSeed: 4242 });
  });

  it('refuses a seeding by rating with the named 409, and writes nothing', async () => {
    const { service, supabase } = makeService({
      phases: { rows: [{ ...BRACKET, config_json: { seedingStrategy: 'by-rating' } }] },
      bracket_slots: { rows: R1_SLOTS },
      matches: { rows: [SLOT_1_BOUT] },
      teams: { rows: [OTHER_TEAM] },
    });

    const refusal = await service.populateBracket(TEAM_T, {}, 'system').catch((e: unknown) => e);

    expect(refusal).toBeInstanceOf(ConflictException);
    expect((refusal as ConflictException).getResponse()).toMatchObject({
      reason: 'rating_needs_named_members',
    });
    expect(supabase.writes).toEqual([]);
    expect(queriedTables(supabase.from)).not.toContain('teams');
  });
});

describe('reseedBracketRoundOne — a team Tournament', () => {
  const RESEED_TEAMS = [
    team('team-a', 1, '07'),
    team('team-b', 2, '08'),
    team('team-c', 3, '09'),
    team('team-d', 4, '10'),
  ];
  /** The slots as a first draw left them, teams in the wrong places. */
  const SEATED = [
    { ...R1_SLOTS[0], team_a_id: 'team-b', team_b_id: 'team-c' },
    { ...R1_SLOTS[1], team_a_id: 'team-a', team_b_id: 'team-d' },
  ];
  const reseedService = () =>
    makeService({
      phases: { rows: [BRACKET] },
      bracket_slots: { rows: SEATED },
      matches: { rows: [SLOT_1_BOUT] },
      teams: { rows: [OTHER_TEAM, ...RESEED_TEAMS] },
    });

  it('moves the teams to their seeds, in the team columns of slots and bouts', async () => {
    const { service, supabase } = reseedService();

    await service.reseedBracketRoundOne('bracket-1', 'actor-1', { strategy: 'snake' });

    expect(slotWrites(supabase)).toEqual({
      'slot-1': teamSlot('team-a', 'team-d'),
      'slot-2': teamSlot('team-c', 'team-b'),
    });
    const bouts = writesTo(supabase, 'matches');
    expect(bouts.map((write) => write.op)).toEqual(['update', 'insert']);
    expect(bouts[0]?.row).toEqual(teamBout('team-a', 'team-d'));
    expect(scopedTo(bouts[0], 'id')).toBe('m-1');
    expect(bouts[1]?.row).toMatchObject({
      bracket_slot_id: 'slot-2',
      ...teamBout('team-c', 'team-b'),
    });
    expect(selectsFor(supabase.from, 'phases')).toContain(
      'id, tournament_id, type, tournaments(event_id, entrant_kind, events(organization_id))',
    );
  });

  it.each([
    ['by-rating', 'rating_needs_named_members'],
    ['by-swiss-rank', 'team_tournament_not_supported'],
  ] as const)('refuses %s with the named 409 %s, and writes nothing', async (strategy, reason) => {
    const { service, supabase } = reseedService();

    const refusal = await service
      .reseedBracketRoundOne('bracket-1', 'actor-1', { strategy })
      .catch((e: unknown) => e);

    expect(refusal).toBeInstanceOf(ConflictException);
    expect((refusal as ConflictException).getResponse()).toMatchObject({ reason });
    expect(supabase.writes).toEqual([]);
  });
});

describe('generateBracket — a team Tournament', () => {
  it('sizes the bracket by its teams and names the team columns of slots and bouts', async () => {
    const { service, supabase } = makeService({
      phases: { rows: [], returning: { id: 'phase-new' } },
      // A team Tournament holds no Registration (0281): counted by them, it has no entrant.
      registrations: { rows: [] },
      bracket_slots: { rows: [], returning: (_row, i) => ({ id: `slot-${i}` }) },
      matches: { rows: [] },
      teams: {
        rows: [
          OTHER_TEAM,
          team('team-a', 1, '07'),
          team('team-b', 2, '08'),
          team('team-c', 3, '09'),
        ],
      },
    });

    await service.generateBracket(TEAM_T, {}, false, 'actor-1');

    const phase = writesTo(supabase, 'phases').find((write) => write.op === 'insert');
    expect((phase?.row as SupabaseRow)['config_json']).toMatchObject({ fighterCount: 3 });
    const slots = writesTo(supabase, 'bracket_slots')[0]?.row as SupabaseRow[];
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot).toMatchObject({
        registration_a_id: null,
        registration_b_id: null,
        team_a_id: null,
        team_b_id: null,
      });
    }
    expect(selectsFor(supabase.from, 'bracket_slots')).toEqual([
      'id, phase_id, round, position, source_a_type, source_b_type, registration_a_id, registration_b_id, team_a_id, team_b_id',
    ]);
    const bouts = writesTo(supabase, 'matches')[0]?.row as SupabaseRow[];
    expect(bouts.length).toBeGreaterThan(0);
    for (const bout of bouts) expect(bout).toMatchObject(teamBout(null, null));
    expect(selectsFor(supabase.from, 'teams')).toEqual(['id, seed, created_at']);
    expect(selectsFor(supabase.from, 'tournaments')).toEqual([
      'id, entrant_kind, events!inner(organization_id)',
    ]);
    expect(queriedTables(supabase.from)).not.toContain('registrations');
  });
});
