import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
  writesTo,
  type SupabaseRow,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { PhasesService } from './phases.service';
import { withStampedRules } from './match-rules.fixtures';
import { orderTeams } from './team-pool-draw';

/**
 * Team Longsword (t-team) has four teams; Team Rapier (t-other), next door, has one. The organiser
 * draws Team Longsword's Pools by seed or at random (ruling 971), then moves and removes teams by
 * hand. A team sits in a Pool's `team_id` and fights in a bout's `red_team_id` / `blue_team_id`
 * (0282); a Registration column is never written.
 */

const TEAM_T = 't-team';
const TF = { ruleset_code: 'TF_v1', ruleset_version: '1.1.0' };
const team = (id: string, seed: number | null, tournamentId = TEAM_T): SupabaseRow => ({
  id,
  seed,
  created_at: '2026-11-01T10:00:00.000Z',
  tournament_id: tournamentId,
});
/** Written in no particular order: the draw reads them by id. */
const TEAMS = [
  team('team-d', 4),
  team('team-b', 2),
  team('team-other', 1, 't-other'),
  team('team-a', 1),
  team('team-c', 3),
];
const orgs = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };

function makeService(seed: Record<string, TableSeed>) {
  const supabase = mockSupabase(...withStampedRules(seed));
  const placement = { placeMatches: vi.fn(() => Promise.resolve()) };
  const service = new PhasesService(
    supabase as never,
    placement as never,
    undefined,
    orgs as never,
  );
  return { service, supabase };
}

const generateSeed = (kind: 'team' | 'individual'): Record<string, TableSeed> => ({
  phases: { rows: [], returning: { id: 'phase-new' } },
  tournaments: {
    rows: [{ id: TEAM_T, weapon: null, event_id: null, entrant_kind: kind, ...TF }],
  },
  teams: { rows: TEAMS },
  pools: { rows: [], returning: { id: 'pool-new' } },
  pool_members: { rows: [] },
  matches: { rows: [] },
});

const membersWritten = (supabase: ReturnType<typeof mockSupabase>) =>
  writesTo(supabase, 'pool_members').flatMap((w) => [w.row].flat()) as SupabaseRow[];
const boutsWritten = (supabase: ReturnType<typeof mockSupabase>) =>
  writesTo(supabase, 'matches')
    .filter((w) => w.op === 'insert')
    .flatMap((w) => [w.row].flat()) as SupabaseRow[];
const configWritten = (supabase: ReturnType<typeof mockSupabase>) =>
  (writesTo(supabase, 'phases').find((w) => w.op === 'insert')?.row as SupabaseRow)[
    'config_json'
  ] as SupabaseRow;

describe('generatePools — a team Tournament', () => {
  it('seats teams by seed in a snake and pits team against team', async () => {
    const { service, supabase } = makeService(generateSeed('team'));

    const result = await service.generatePools(TEAM_T, { poolCount: 2, teamSpread: 'seed' });

    expect(result.totalMatches).toBe(2);
    expect(membersWritten(supabase)).toEqual([
      { pool_id: 'pool-new', team_id: 'team-a', seed: 1 },
      { pool_id: 'pool-new', team_id: 'team-d', seed: 2 },
      { pool_id: 'pool-new', team_id: 'team-b', seed: 1 },
      { pool_id: 'pool-new', team_id: 'team-c', seed: 2 },
    ]);
    const bouts = boutsWritten(supabase);
    expect(bouts.map((b) => [b['red_team_id'], b['blue_team_id']])).toEqual([
      ['team-a', 'team-d'],
      ['team-b', 'team-c'],
    ]);
    for (const bout of bouts) {
      expect(bout).not.toHaveProperty('red_registration_id');
      expect(bout).not.toHaveProperty('blue_registration_id');
    }
    expect(configWritten(supabase)).toEqual({
      poolCount: 2,
      costReport: null,
      teamSpread: 'seed',
    });
    // The teams of this Tournament only, every one (a team has no status), in id order.
    expect(selectsFor(supabase.from, 'teams')).toEqual(['id, seed, created_at']);
    expect(filtersFor(supabase.from, 'teams', 'eq')).toEqual([['tournament_id', TEAM_T]]);
    expect(selectsFor(supabase.from, 'tournaments')).toContain(
      'weapon, event_id, entrant_kind, events(organization_id)',
    );
    expect(queriedTables(supabase.from)).not.toContain('registrations');
  });

  it('draws one order for one seed, from the teams in id order, and stores the seed', async () => {
    const draw = async (drawSeed: number) => {
      const { service, supabase } = makeService(generateSeed('team'));
      await service.generatePools(TEAM_T, { poolCount: 1, teamSpread: 'random', seed: drawSeed });
      expect(configWritten(supabase)).toMatchObject({ teamSpread: 'random', drawSeed });
      return membersWritten(supabase).map((m) => m['team_id']);
    };
    // The draw of the four teams in id order, a then b then c then d.
    const inIdOrder = ['team-a', 'team-b', 'team-c', 'team-d'].map((id) => ({
      id,
      seed: null,
      created_at: '',
    }));
    const expected = (drawSeed: number) =>
      orderTeams(inIdOrder, { teamSpread: 'random', drawSeed }).map((t) => t.id);

    expect(await draw(7)).toEqual(expected(7));
    expect(await draw(7)).toEqual(await draw(7));
    expect(await draw(8)).toEqual(expected(8));
    expect(expected(7)).not.toEqual(expected(8));
    expect(expected(7)).toEqual(['team-c', 'team-b', 'team-d', 'team-a']);
  });

  it('draws its own seed when none is sent, stores it, and the draw replays from it', async () => {
    const { service, supabase } = makeService(generateSeed('team'));

    await service.generatePools(TEAM_T, { poolCount: 1, teamSpread: 'random' });

    const config = configWritten(supabase);
    const drawSeed = config['drawSeed'] as number;
    expect(Number.isInteger(drawSeed)).toBe(true);
    const inIdOrder = ['team-a', 'team-b', 'team-c', 'team-d'].map((id) => ({
      id,
      seed: null,
      created_at: '',
    }));
    expect(membersWritten(supabase).map((m) => m['team_id'])).toEqual(
      orderTeams(inIdOrder, { teamSpread: 'random', drawSeed }).map((t) => t.id),
    );
  });

  it('refuses a team Tournament with no spread, and writes nothing', async () => {
    const { service, supabase } = makeService(generateSeed('team'));

    await expect(service.generatePools(TEAM_T, { poolCount: 2 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(supabase.writes).toEqual([]);
  });

  it('refuses a team spread on an individual Tournament, and writes nothing', async () => {
    const { service, supabase } = makeService(generateSeed('individual'));

    await expect(
      service.generatePools(TEAM_T, { poolCount: 2, teamSpread: 'random' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(supabase.writes).toEqual([]);
  });
});

// ── Members ────────────────────────────────────────────────────────────────

/** `getPoolContext`'s read: the double ignores a projection, so the kind's column is asserted. */
const POOL_CONTEXT =
  'id, name, phase_id, sort_order, phases!inner(id, tournament_id, tournaments!inner(event_id, weapon, entrant_kind, events!inner(organization_id)))';

const pool = (id: string, kind: 'team' | 'individual') => ({
  id,
  name: id === 'pool-0' ? 'Pool 1' : 'Pool 2',
  phase_id: 'phase-1',
  sort_order: id === 'pool-0' ? 0 : 1,
  phases: {
    id: 'phase-1',
    tournament_id: TEAM_T,
    tournaments: {
      event_id: 'event-1',
      weapon: null,
      entrant_kind: kind,
      events: { organization_id: 'org-1' },
    },
  },
});
const seat = (teamId: string, seedNo: number, poolId: string): SupabaseRow => ({
  id: `pm-${teamId}`,
  pool_id: poolId,
  registration_id: null,
  team_id: teamId,
  seed: seedNo,
  pools: { phase_id: 'phase-1', phases: { tournament_id: TEAM_T } },
});

function membersService(kind: 'team' | 'individual', seed: Record<string, TableSeed>) {
  return makeService({
    pools: { rows: [pool('pool-0', kind), pool('pool-1', kind)] },
    phases: { rows: [{ id: 'phase-1', tournament_id: TEAM_T, tournaments: TF }] },
    tournaments: { rows: [{ id: TEAM_T, ...TF }] },
    matches: { rows: [] },
    ...seed,
  });
}

describe('addPoolTeam', () => {
  it('moves a team into a Pool and makes both Pools team bouts again', async () => {
    const { service, supabase } = membersService('team', {
      teams: { rows: TEAMS },
      pool_members: {
        rows: [
          seat('team-a', 1, 'pool-0'),
          seat('team-b', 2, 'pool-0'),
          seat('team-c', 1, 'pool-1'),
          seat('team-d', 2, 'pool-1'),
        ],
      },
    });

    const result = await service.addPoolTeam('pool-1', 'team-a', 'user-1');

    expect(result).toEqual({ poolId: 'pool-1', teamId: 'team-a', moved: true });
    expect(selectsFor(supabase.from, 'teams')).toEqual(['id']);
    // The Pool's context names its Tournament's kind, which picks the column each seat and
    // bout is written in: read by the door, then by each Pool's bouts made again.
    expect(selectsFor(supabase.from, 'pools')).toEqual([POOL_CONTEXT, POOL_CONTEXT, POOL_CONTEXT]);
    expect(filtersFor(supabase.from, 'teams', 'eq')).toEqual([
      ['id', 'team-a'],
      ['tournament_id', TEAM_T],
    ]);
    const writes = writesTo(supabase, 'pool_members');
    expect(writes.find((w) => w.op === 'delete')).toBeDefined();
    expect(writes.find((w) => w.op === 'insert')?.row).toEqual({
      pool_id: 'pool-1',
      team_id: 'team-a',
      seed: 3,
    });
    expect(filtersFor(supabase.from, 'pool_members', 'eq')).toContainEqual(['team_id', 'team-a']);
    expect(selectsFor(supabase.from, 'pool_members')).toContain(
      'id, registration_id, team_id, seed',
    );
    // Both Pools' bouts made again (the double keeps its rows: each Pool reads the seats it
    // was seeded with), team against team, no Registration column.
    expect(boutsWritten(supabase)).toEqual([
      expect.objectContaining({ pool_id: 'pool-1', red_team_id: 'team-c', blue_team_id: 'team-d' }),
      expect.objectContaining({ pool_id: 'pool-0', red_team_id: 'team-a', blue_team_id: 'team-b' }),
    ]);
    for (const bout of boutsWritten(supabase)) {
      expect(bout).not.toHaveProperty('red_registration_id');
      expect(bout).not.toHaveProperty('blue_registration_id');
    }
  });

  it('refuses a team of another Tournament as a missing id, and seats nobody', async () => {
    const { service, supabase } = membersService('team', {
      teams: { rows: TEAMS },
      pool_members: { rows: [] },
    });

    await expect(service.addPoolTeam('pool-1', 'team-other', 'user-1')).rejects.toThrow(
      'Team team-other not found',
    );
    expect(writesTo(supabase, 'pool_members')).toEqual([]);
  });

  it("throws, and seats nobody, when the Pool's context comes back without its kind", async () => {
    const { service, supabase } = makeService({
      pools: {
        rows: [
          {
            ...pool('pool-1', 'team'),
            phases: {
              id: 'phase-1',
              tournament_id: TEAM_T,
              tournaments: {
                event_id: 'event-1',
                weapon: null,
                events: { organization_id: 'org-1' },
              },
            },
          },
        ],
      },
      teams: { rows: TEAMS },
      pool_members: { rows: [] },
      matches: { rows: [] },
    });

    await expect(service.addPoolTeam('pool-1', 'team-a', 'user-1')).rejects.toThrow(
      "The Tournament's kind was not read",
    );
    expect(supabase.writes).toEqual([]);
  });

  it("refuses a team in an individual Tournament's Pool, and a Registration in a team one's", async () => {
    const individual = membersService('individual', { pool_members: { rows: [] } });
    const team = membersService('team', { pool_members: { rows: [] } });

    for (const attempt of [
      individual.service.addPoolTeam('pool-1', 'team-a', 'user-1'),
      team.service.addPoolMember('pool-1', 'reg-1', 'user-1'),
    ]) {
      const error = await attempt.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        reason: 'entrant_kind_mismatch',
      });
    }
    expect([...individual.supabase.writes, ...team.supabase.writes]).toEqual([]);
  });
});

describe('removePoolMember — a team', () => {
  it("takes the team's seat by its team id and makes the Pool's team bouts again", async () => {
    const { service, supabase } = membersService('team', {
      pool_members: {
        rows: [
          seat('team-a', 1, 'pool-0'),
          seat('team-b', 2, 'pool-0'),
          seat('team-c', 3, 'pool-0'),
        ],
      },
    });

    const result = await service.removePoolMember('pool-0', 'team-b', 'user-1');

    expect(result).toEqual({ poolId: 'pool-0', entrantId: 'team-b' });
    expect(selectsFor(supabase.from, 'pools')).toEqual([POOL_CONTEXT, POOL_CONTEXT]);
    const removal = writesTo(supabase, 'pool_members').find((w) => w.op === 'delete');
    expect(removal).toBeDefined();
    expect(filtersFor(supabase.from, 'pool_members', 'eq')).toContainEqual(['team_id', 'team-b']);
    expect(filtersFor(supabase.from, 'pool_members', 'eq')).not.toContainEqual([
      'registration_id',
      'team-b',
    ]);
    // The double keeps its three seats; what is checked is that the bouts are team bouts.
    const bouts = boutsWritten(supabase);
    expect(bouts.map((b) => [b['red_team_id'], b['blue_team_id']])).toEqual([
      ['team-b', 'team-c'],
      ['team-a', 'team-c'],
      ['team-a', 'team-b'],
    ]);
    for (const bout of bouts) expect(bout).not.toHaveProperty('red_registration_id');
  });
});
