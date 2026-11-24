import { describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  selectsFor,
  type SupabaseRow,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { PhasesService } from './phases.service';
import { withStampedRules } from './match-rules.fixtures';

/**
 * Team Longsword has one Pool: Lyon Blades (green, with a logo) against Paris Fers (no colour).
 * The Pools page, its Matches tab and its 30-second poll read team seats and team bouts. A team
 * has no Registration, so each read takes the team twin of every side link (0282) and the view's
 * team columns (0284).
 */

const TF = { ruleset_code: 'TF_v1', ruleset_version: '1.1.0' };
const LYON = { id: 'team-lyon', name: 'Lyon Blades', color: 'green', logo_url: 'https://x/l.png' };
const PARIS = { id: 'team-paris', name: 'Paris Fers', color: null, logo_url: null };

function makeService(seed: Record<string, TableSeed>) {
  const supabase = mockSupabase(...withStampedRules(seed));
  const placement = { placeMatches: vi.fn(() => Promise.resolve()) };
  const hemaRatings = { resolveWeightedRatings: vi.fn(() => Promise.resolve(new Map())) };
  const service = new PhasesService(supabase as never, placement as never, hemaRatings as never);
  return { service, supabase };
}

const seat = (team: SupabaseRow, seed: number): SupabaseRow => ({
  registration_id: null,
  team_id: team['id'],
  seed,
  registrations: null,
  teams: team,
});

describe('listTournamentPools — a Pool of teams', () => {
  it('lists each team by its side key, name, colour and logo, with no Registration', async () => {
    const { service, supabase } = makeService({
      phases: { rows: [{ id: 'phase-1', tournament_id: 'tournament-1', type: 'pool' }] },
      pools: {
        rows: [
          {
            id: 'pool-1',
            name: 'Pool 1',
            sort_order: 0,
            phase_id: 'phase-1',
            pool_members: [seat(LYON, 1), seat(PARIS, 2)],
          },
        ],
      },
      tournaments: { rows: [{ id: 'tournament-1', weapon: 'longsword', ...TF }] },
      registrations: { rows: [] },
    });

    const result = await service.listTournamentPools('tournament-1');

    expect(result.pools[0]?.members).toEqual([
      {
        sideId: 'team-lyon',
        kind: 'team',
        registrationId: null,
        name: 'Lyon Blades',
        personName: null,
        clubLabel: null,
        colour: 'green',
        logoUrl: 'https://x/l.png',
        hemaWeightedRating: null,
        seed: 1,
      },
      {
        sideId: 'team-paris',
        kind: 'team',
        registrationId: null,
        name: 'Paris Fers',
        personName: null,
        clubLabel: null,
        colour: null,
        logoUrl: null,
        hemaWeightedRating: null,
        seed: 2,
      },
    ]);
    expect(selectsFor(supabase.from, 'pools')).toEqual([
      'id, name, sort_order, pool_members(registration_id, team_id, seed, registrations(id, persons(given_name, family_name, clubs(name), hema_ratings_id, global_persons(hema_ratings_id))), teams(id, name, color, logo_url))',
    ]);
  });

  it('lists a Fighter as before, keyed by the Registration', async () => {
    const { service } = makeService({
      phases: { rows: [{ id: 'phase-1', tournament_id: 'tournament-1', type: 'pool' }] },
      pools: {
        rows: [
          {
            id: 'pool-1',
            name: 'Pool 1',
            sort_order: 0,
            phase_id: 'phase-1',
            pool_members: [
              {
                registration_id: 'reg-anna',
                team_id: null,
                seed: 1,
                registrations: {
                  id: 'reg-anna',
                  persons: { given_name: 'Anna', family_name: 'Martin', clubs: { name: 'Nord' } },
                },
                teams: null,
              },
            ],
          },
        ],
      },
      tournaments: { rows: [{ id: 'tournament-1', weapon: null, ...TF }] },
    });

    const result = await service.listTournamentPools('tournament-1');

    expect(result.pools[0]?.members).toEqual([
      {
        sideId: 'reg-anna',
        kind: 'individual',
        registrationId: 'reg-anna',
        name: 'Anna Martin',
        personName: 'Anna Martin',
        clubLabel: 'Nord',
        colour: null,
        logoUrl: null,
        hemaWeightedRating: null,
        seed: 1,
      },
    ]);
  });
});

describe('listMatchScores — a team bout', () => {
  it('carries the winner team, which a team bout holds instead of a winner Registration', async () => {
    const { service, supabase } = makeService({
      matches: {
        rows: [
          {
            id: 'm-1',
            status: 'completed',
            red_score: 3,
            blue_score: 5,
            winner_registration_id: null,
            winner_team_id: 'team-paris',
            phases: { tournament_id: 'tournament-1' },
            'phases.tournament_id': 'tournament-1',
          },
        ],
      },
    });

    const result = await service.listMatchScores('tournament-1');

    expect(result).toEqual([
      {
        id: 'm-1',
        status: 'completed',
        red_score: 3,
        blue_score: 5,
        winner_registration_id: null,
        winner_team_id: 'team-paris',
      },
    ]);
    expect(selectsFor(supabase.from, 'matches')).toEqual([
      'id, status, red_score, blue_score, winner_registration_id, winner_team_id, phases!inner(tournament_id)',
    ]);
  });
});

describe('listPoolsWithMatches — a team bout', () => {
  it("carries each side's team id and colour, and the winner team, from the view", async () => {
    const { service, supabase } = makeService({
      phases: { rows: [{ id: 'phase-1', tournament_id: 'tournament-1', type: 'pool' }] },
      tournaments: { rows: [{ id: 'tournament-1', event_id: 'event-1', weapon: null, ...TF }] },
      pools: { rows: [{ id: 'pool-1', name: 'Pool 1', sort_order: 0, phase_id: 'phase-1' }] },
      referee_assignments: { rows: [] },
      vw_tournament_query_matches: {
        rows: [
          {
            match_id: 'm-1',
            pool_id: 'pool-1',
            tournament_id: 'tournament-1',
            phase_type: 'pool',
            lice_id: null,
            lice_name: null,
            lice_number: null,
            red_registration_id: null,
            blue_registration_id: null,
            red_name: 'Lyon Blades',
            blue_name: 'Paris Fers',
            red_club: null,
            blue_club: null,
            red_score: 5,
            blue_score: 3,
            winner_registration_id: null,
            status: 'completed',
            match_number_label: 'L1-P1-M1',
            scheduled_at: null,
            red_team_id: 'team-lyon',
            blue_team_id: 'team-paris',
            winner_team_id: 'team-lyon',
            red_team_color: 'green',
            blue_team_color: null,
          },
        ],
      },
    });

    const result = await service.listPoolsWithMatches('tournament-1');

    expect(result[0]?.matches[0]).toMatchObject({
      red_registration_id: null,
      blue_registration_id: null,
      red_name: 'Lyon Blades',
      blue_name: 'Paris Fers',
      winner_registration_id: null,
      red_team_id: 'team-lyon',
      blue_team_id: 'team-paris',
      winner_team_id: 'team-lyon',
      red_team_color: 'green',
      blue_team_color: null,
    });
    expect(selectsFor(supabase.from, 'vw_tournament_query_matches')).toEqual([
      'match_id, pool_id, lice_id, lice_name, lice_number, red_registration_id, blue_registration_id, red_name, blue_name, red_club, blue_club, red_score, blue_score, winner_registration_id, status, match_number_label, scheduled_at, red_team_id, blue_team_id, winner_team_id, red_team_color, blue_team_color',
    ]);
  });
});
