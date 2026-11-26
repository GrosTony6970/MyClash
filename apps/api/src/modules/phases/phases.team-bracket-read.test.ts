import { describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  selectsFor,
  type SupabaseRow,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { PhasesService } from './phases.service';

/**
 * The bracket read (`getTournamentBracket`, the organiser's page and the pad) names each side of a
 * slot, typed (call 6 of 1c-1). Team Longsword (t-team) plays a bracket of four: its slots hold
 * teams, so the read sends each team's name, colour and side key, and the key of the team that
 * won. The fields sent before stay, with the same values: on a team side the Registration ids are
 * null, and `redFighterName` / `blueFighterName` carry the team's name (the print pack copies
 * them).
 */

const T = 'tournament-1';
const LYON = { id: 'team-lyon', name: 'Lyon Blades', color: 'teal', logo_url: null };
const NANTES = { id: 'team-nantes', name: 'Nantes Edge', color: 'amber', logo_url: null };
const PARIS = { id: 'team-paris', name: 'Paris Guard', color: 'violet', logo_url: null };
const BREST = { id: 'team-brest', name: 'Brest Wolves', color: null, logo_url: null };

const SLOT_SELECT =
  'id, round, position, source_a_type, source_a_ref, source_b_type, source_b_ref, registration_a_id, registration_b_id, ' +
  'team_a:teams!bracket_slots_team_a_id_fkey(id,name,color,logo_url),' +
  'team_b:teams!bracket_slots_team_b_id_fkey(id,name,color,logo_url)';
const BOUT_SELECT =
  'id, bracket_slot_id, status, red_score, blue_score, winner_registration_id, winner_team_id, lice_id, scheduled_at';

const slot = (id: string, over: SupabaseRow = {}): SupabaseRow => ({
  id,
  phase_id: 'phase-1',
  round: 1,
  position: 1,
  source_a_type: null,
  source_a_ref: null,
  source_b_type: null,
  source_b_ref: null,
  registration_a_id: null,
  registration_b_id: null,
  team_a: null,
  team_b: null,
  ...over,
});

/** Seed 1 meets seed 4, seed 3 meets seed 2; the final waits on both. */
const TEAM_SLOTS: SupabaseRow[] = [
  slot('s-1', {
    source_a_ref: 'seed 1',
    source_b_ref: 'seed 4',
    team_a: LYON,
    team_b: NANTES,
  }),
  slot('s-2', {
    position: 2,
    source_a_ref: 'seed 3',
    source_b_ref: 'seed 2',
    team_a: PARIS,
    team_b: BREST,
  }),
  slot('s-final', { round: 2, source_a_ref: 'winner of R1P1', source_b_ref: 'winner of R1P2' }),
];
/** Nantes won the first bout on a forfeit, with the lower score. */
const TEAM_BOUT: SupabaseRow = {
  id: 'm-1',
  bracket_slot_id: 's-1',
  status: 'completed',
  red_score: 5,
  blue_score: 2,
  winner_registration_id: null,
  winner_team_id: NANTES.id,
  lice_id: null,
  scheduled_at: null,
};

function makeService(seed: Record<string, TableSeed>, kind: 'team' | 'individual') {
  const supabase = mockSupabase({
    phases: {
      rows: [
        { id: 'pool-phase-1', tournament_id: T, type: 'pool', config_json: {} },
        {
          id: 'phase-1',
          tournament_id: T,
          type: 'single_elim',
          config_json: { bracketSize: 4, fighterCount: 4, rounds: 2 },
        },
      ],
    },
    tournaments: { rows: [{ id: T, event_id: null, entrant_kind: kind, weapon: 'longsword' }] },
    matches: { rows: [] },
    ...seed,
  });
  // The four teams finished their Pool in seed order: the slots hold what the standings say.
  const ranked = [LYON, BREST, PARIS, NANTES].map((team, index) => ({
    rank: index + 1,
    entrantId: team.id,
  }));
  const poolStandings = {
    getPoolStandings: vi.fn((_id: string, mode: 'by-pool' | 'overall') =>
      Promise.resolve(
        mode === 'overall'
          ? { rows: ranked }
          : { pools: [{ poolId: 'p1', poolName: 'Pool A', status: 'completed', rows: ranked }] },
      ),
    ),
  };
  const service = new PhasesService(
    supabase as never,
    { placeMatches: vi.fn() } as never,
    undefined,
    { assertOrgRole: vi.fn() } as never,
    undefined,
    poolStandings as never,
  );
  return { service, supabase };
}

describe('getTournamentBracket — a team bracket', () => {
  it('reads both kinds of each slot side, the team winner, and the kind with the Event', async () => {
    const { service, supabase } = makeService(
      { bracket_slots: { rows: TEAM_SLOTS }, matches: { rows: [TEAM_BOUT] } },
      'team',
    );

    await service.getTournamentBracket(T);

    expect(selectsFor(supabase.from, 'bracket_slots')).toEqual([SLOT_SELECT]);
    expect(selectsFor(supabase.from, 'matches')).toEqual([BOUT_SELECT]);
    // One read of the Tournament: the seeding drift takes the kind from it, the bout code the weapon.
    expect(selectsFor(supabase.from, 'tournaments')).toEqual(['event_id, entrant_kind, weapon']);
    // A team side has no Registration to read.
    expect(selectsFor(supabase.from, 'registrations')).toEqual([]);
  });

  it('names both teams with their colours and side keys, and keys the recorded winner', async () => {
    const { service } = makeService(
      { bracket_slots: { rows: TEAM_SLOTS }, matches: { rows: [TEAM_BOUT] } },
      'team',
    );

    const result = await service.getTournamentBracket(T);

    expect(result!.slots[0]).toMatchObject({
      id: 's-1',
      // The print pack copies these two names onto the bout sheet.
      redFighterName: 'Lyon Blades',
      blueFighterName: 'Nantes Edge',
      redClubAbbrev: null,
      blueClubAbbrev: null,
      redRegistrationId: null,
      blueRegistrationId: null,
      winnerRegistrationId: null,
      redSideId: LYON.id,
      blueSideId: NANTES.id,
      winnerSideId: NANTES.id,
      red: {
        sideId: LYON.id,
        kind: 'team',
        registrationId: null,
        teamId: LYON.id,
        name: 'Lyon Blades',
        clubAbbrev: null,
        colour: 'teal',
      },
      blue: {
        sideId: NANTES.id,
        kind: 'team',
        registrationId: null,
        teamId: NANTES.id,
        name: 'Nantes Edge',
        clubAbbrev: null,
        colour: 'amber',
      },
    });
    // The final waits on both winners: no side, no name, no winner.
    expect(result!.slots[2]).toMatchObject({
      redFighterName: null,
      blueFighterName: null,
      redSideId: null,
      blueSideId: null,
      winnerSideId: null,
      red: null,
      blue: null,
    });
  });

  it('diffs the seeding by team: the slots hold what the team standings say', async () => {
    const { service } = makeService({ bracket_slots: { rows: TEAM_SLOTS } }, 'team');

    const result = await service.getTournamentBracket(T);

    expect(result!.seedingDrift).toEqual({
      state: 'fresh',
      source: 'pool-standings',
      changedSlotIds: [],
      blockingMatchIds: [],
    });
  });
});

describe('getTournamentBracket — an individual bracket', () => {
  it("sends today's fields with today's values, and the typed sides beside them", async () => {
    const { service } = makeService(
      {
        bracket_slots: {
          rows: [
            slot('s-1', {
              source_a_type: 'seed',
              source_a_ref: 'seed 1',
              registration_a_id: 'reg-anna',
              registration_b_id: 'reg-bruno',
            }),
          ],
        },
        matches: {
          rows: [
            {
              id: 'm-1',
              bracket_slot_id: 's-1',
              status: 'completed',
              red_score: 3,
              blue_score: 5,
              winner_registration_id: 'reg-bruno',
              winner_team_id: null,
              lice_id: null,
              scheduled_at: '2026-12-05T09:00:00Z',
            },
          ],
        },
        registrations: {
          rows: [
            {
              id: 'reg-anna',
              persons: { given_name: 'Anna', family_name: 'Roux', clubs: { name: 'Lyon AMHE' } },
            },
            {
              id: 'reg-bruno',
              persons: { given_name: 'Bruno', family_name: 'Morel', clubs: { name: 'Nantes' } },
            },
          ],
        },
      },
      'individual',
    );

    const result = await service.getTournamentBracket(T);

    expect(result!.slots).toEqual([
      {
        id: 's-1',
        round: 1,
        position: 1,
        // A semi-final of a bracket of four (bug a: the print pack printed `R1-1`).
        roundCode: 'LSW-B-SF-M1',
        redFighterName: 'Anna Roux',
        blueFighterName: 'Bruno Morel',
        redClubAbbrev: 'Lyon AMHE',
        blueClubAbbrev: 'Nantes',
        redScore: 3,
        blueScore: 5,
        winnerRegistrationId: 'reg-bruno',
        status: 'completed',
        matchId: 'm-1',
        scheduledAt: '2026-12-05T09:00:00Z',
        liceId: null,
        liceName: null,
        referees: [],
        redRegistrationId: 'reg-anna',
        blueRegistrationId: 'reg-bruno',
        source_a_type: 'seed',
        source_a_ref: 'seed 1',
        source_b_type: null,
        source_b_ref: null,
        registration_a_id: 'reg-anna',
        registration_b_id: 'reg-bruno',
        // New beside them (call 6).
        redSideId: 'reg-anna',
        blueSideId: 'reg-bruno',
        winnerSideId: 'reg-bruno',
        red: {
          sideId: 'reg-anna',
          kind: 'individual',
          registrationId: 'reg-anna',
          teamId: null,
          name: 'Anna Roux',
          clubAbbrev: 'Lyon AMHE',
          colour: null,
        },
        blue: {
          sideId: 'reg-bruno',
          kind: 'individual',
          registrationId: 'reg-bruno',
          teamId: null,
          name: 'Bruno Morel',
          clubAbbrev: 'Nantes',
          colour: null,
        },
      },
    ]);
  });

  it('sends null, never an empty name, for a side whose name is not known', async () => {
    // Anna's Registration reads no Person: her side is placed, but has no name to show. An empty
    // string would silence every fallback a screen puts in its place.
    const { service } = makeService(
      {
        bracket_slots: {
          rows: [slot('s-1', { registration_a_id: 'reg-anna', registration_b_id: null })],
        },
        matches: { rows: [] },
        registrations: { rows: [] },
      },
      'individual',
    );

    const result = await service.getTournamentBracket(T);

    expect(result!.slots[0]).toMatchObject({
      redSideId: 'reg-anna',
      redFighterName: null,
      red: { sideId: 'reg-anna', kind: 'individual', name: null },
      blue: null,
    });
  });
});

/**
 * Bug a: the bracket read sent no bout code, so the printed bracket sheet fell back to `R1-2` for
 * every bout. The read now sends the code the bracket screen shows (`BracketView`).
 */
describe('getTournamentBracket — the bout code of each slot', () => {
  it('sends each slot its code, the final with no bout yet included', async () => {
    const { service } = makeService({ bracket_slots: { rows: TEAM_SLOTS } }, 'team');

    const result = await service.getTournamentBracket(T);

    expect(result!.slots.map((s) => s.roundCode)).toEqual([
      'LSW-B-SF-M1',
      'LSW-B-SF-M2',
      'LSW-B-F-M1',
    ]);
  });

  it('names a double-elimination round by its section: the winners final is not the final', async () => {
    // A bracket of four: winners rounds 1-2, losers rounds 3-4, the grand final is round 5.
    const { service } = makeService(
      {
        phases: {
          rows: [
            {
              id: 'phase-1',
              tournament_id: T,
              type: 'double_elim',
              config_json: { bracketSize: 4, fighterCount: 4, wbRounds: 2, lbRounds: 2 },
            },
          ],
        },
        bracket_slots: { rows: [slot('s-wbf', { round: 2 }), slot('s-gf', { round: 5 })] },
      },
      'individual',
    );

    const result = await service.getTournamentBracket(T);

    expect(result!.slots.map((s) => s.roundCode)).toEqual(['LSW-B-WBF-M1', 'LSW-B-GF-M1']);
  });
});
