import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, type TableSeed } from '../../common/testing/supabase-chain';
import { AssignmentBoardService } from './assignment-board.service';
import { HARD_CODED_DEFAULT_SLOTS } from './staffing.service';

// The length helper has reads of its own and its own test: every bout is five minutes here.
vi.mock('../schedule/match-lengths', () => ({
  resolveMatchLengths: vi.fn((_db: unknown, _eventId: string, inputs: Array<{ id: string }>) =>
    Promise.resolve(new Map(inputs.map((input) => [input.id, 5]))),
  ),
}));

/**
 * The referee board of an Event with Team Longsword (Pool 1: Lyon Blades v Paris Fers) and Open
 * Longsword (Pool A: Anna). A team's slots have no names in 1b-1, so rule 8 cannot check its
 * Fighters: the board marks the team Pool for the notice (T7), and lists each seat by its side
 * key, never a team id under `registrationId`.
 */

const TEAM_SEAT = (id: string, name: string) => ({
  registration_id: null,
  team_id: id,
  registrations: null,
  teams: { id, name, color: 'green', logo_url: null },
});

function makeService(seed: Record<string, TableSeed>) {
  const supabase = mockSupabase(seed);
  const settings = { getSettings: vi.fn().mockResolvedValue({}) };
  const staffing = {
    getResolvedConfigForAssignmentBoard: vi.fn().mockResolvedValue({
      pool: [...HARD_CODED_DEFAULT_SLOTS],
      bracket: [...HARD_CODED_DEFAULT_SLOTS],
      finals: [...HARD_CODED_DEFAULT_SLOTS],
      inheritsEventDefault: true,
      isHardCodedFloor: true,
    }),
  };
  const service = new AssignmentBoardService(
    supabase as never,
    settings as never,
    staffing as never,
  );
  return { service, supabase };
}

type BoardRows = {
  pools: Array<{
    id: string;
    uncheckedFighters?: true;
    members: Array<{ sideId: string; registrationId: string | null; personName: string }>;
  }>;
  fighterRegistrationIdsByPerson: Map<string, string[]>;
};

const SEED: Record<string, TableSeed> = {
  events: { rows: [{ id: 'event-1', timezone: 'Europe/Paris' }] },
  tournaments: {
    rows: [
      { id: 't-team', event_id: 'event-1', name: 'Team Longsword', weapon: null, sort_order: 0 },
      { id: 't-open', event_id: 'event-1', name: 'Open Longsword', weapon: null, sort_order: 1 },
    ],
  },
  phases: {
    rows: [
      { id: 'ph-team', tournament_id: 't-team', type: 'pool' },
      { id: 'ph-open', tournament_id: 't-open', type: 'pool' },
    ],
  },
  pools: {
    rows: [
      {
        id: 'pool-team',
        phase_id: 'ph-team',
        name: 'Pool 1',
        sort_order: 0,
        pool_members: [
          TEAM_SEAT('team-lyon', 'Lyon Blades'),
          TEAM_SEAT('team-paris', 'Paris Fers'),
        ],
        matches: [],
      },
      {
        id: 'pool-open',
        phase_id: 'ph-open',
        name: 'Pool A',
        sort_order: 0,
        pool_members: [
          {
            registration_id: 'reg-anna',
            team_id: null,
            registrations: {
              id: 'reg-anna',
              person_id: 'p-anna',
              persons: {
                id: 'p-anna',
                global_person_id: 'g-anna',
                given_name: 'Anna',
                family_name: 'Martin',
                club_id: null,
                clubs: null,
              },
            },
            teams: null,
          },
        ],
        matches: [],
      },
    ],
  },
  event_referees: { rows: [] },
  referee_availability: { rows: [] },
  event_referee_tournaments: { rows: [] },
  event_referee_days: { rows: [] },
  registrations: { rows: [] },
  referee_assignments: { rows: [] },
};

describe('the referee board — a team Pool', () => {
  it('lists the teams by side key with no Registration, and marks the team Pool only', async () => {
    const { service, supabase } = makeService(SEED);

    const rows = (await (
      service as unknown as { loadBoardRows: (id: string) => Promise<BoardRows> }
    ).loadBoardRows('event-1')) as BoardRows;

    const team = rows.pools.find((p) => p.id === 'pool-team');
    const open = rows.pools.find((p) => p.id === 'pool-open');
    expect(team?.uncheckedFighters).toBe(true);
    expect(open).not.toHaveProperty('uncheckedFighters');
    expect(team?.members).toEqual([
      expect.objectContaining({
        sideId: 'team-lyon',
        registrationId: null,
        personId: '',
        personName: 'Lyon Blades',
      }),
      expect.objectContaining({ sideId: 'team-paris', registrationId: null }),
    ]);
    expect(open?.members).toEqual([
      expect.objectContaining({
        sideId: 'reg-anna',
        registrationId: 'reg-anna',
        personId: 'g-anna',
      }),
    ]);
    // A team's seat names no Person: the rule-8 map holds Anna only.
    expect([...rows.fighterRegistrationIdsByPerson]).toEqual([['g-anna', ['reg-anna']]]);
    expect(selectsFor(supabase.from, 'pools')).toEqual([
      'id, phase_id, name, sort_order, pool_members(registration_id, team_id, registrations(id, person_id, persons(id, global_person_id, given_name, family_name, club_id, clubs(name))), teams(id, name, color, logo_url)), matches(id, phase_id, planned_duration_override_minutes, scheduled_at, lice_id, red_registration_id, blue_registration_id)',
    ]);
  });
});
