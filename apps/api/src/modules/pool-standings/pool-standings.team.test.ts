import { describe, expect, it } from 'vitest';
import { mockSupabase, selectsFor, type SupabaseRow } from '../../common/testing/supabase-chain';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';
import type { TeamEmbed } from '../matches/side-label';
import { PoolStandingsService } from './pool-standings.service';

/**
 * Pool 1 of Team Longsword: Lyon Blades (green, with a logo), Paris Fers and Nantes Lames. Lyon
 * beat Paris 5-3; Nantes forfeited against Lyon. Standings rank the teams by their side key and
 * carry each team's name, colour and logo for the chip (T7). A team has no club.
 */

const registry = createRulesetRegistry();
const resolver = {
  resolve: async (code: string, version: string) =>
    registry.has(code, version) ? registry.get(code, version) : null,
};

const LYON = { id: 'team-lyon', name: 'Lyon Blades', color: 'green', logo_url: 'https://x/l.png' };
const PARIS = { id: 'team-paris', name: 'Paris Fers', color: null, logo_url: null };
const NANTES = { id: 'team-nantes', name: 'Nantes Lames', color: 'blue', logo_url: null };
const seat = (team: TeamEmbed): SupabaseRow => ({
  registration_id: null,
  team_id: team.id,
  registrations: null,
  teams: team,
});
const bout = (id: string, red: string, blue: string, over: SupabaseRow): SupabaseRow => ({
  id,
  pool_id: 'pool-1',
  phase_id: 'phase-1',
  status: 'completed',
  red_registration_id: null,
  blue_registration_id: null,
  red_team_id: red,
  blue_team_id: blue,
  winner_registration_id: null,
  end_reason: null,
  ...over,
});

function makeService() {
  const supabase = mockSupabase({
    tournaments: {
      rows: [{ id: 't-team', ruleset_code: 'TF_v1', ruleset_version: '1.0.0', ruleset_config: {} }],
    },
    phases: { rows: [{ id: 'phase-1', tournament_id: 't-team', type: 'pool' }] },
    pools: {
      rows: [
        {
          id: 'pool-1',
          name: 'Pool 1',
          phase_id: 'phase-1',
          sort_order: 0,
          pool_members: [seat(LYON), seat(PARIS), seat(NANTES)],
        },
      ],
    },
    matches: {
      rows: [
        bout('m-1', 'team-lyon', 'team-paris', {
          red_score: 5,
          blue_score: 3,
          winner_team_id: 'team-lyon',
        }),
        bout('m-2', 'team-nantes', 'team-lyon', {
          red_score: 0,
          blue_score: 0,
          winner_team_id: 'team-lyon',
          end_reason: 'forfeit',
        }),
      ],
    },
    exchanges: { rows: [] },
    match_forfeits: {
      rows: [
        {
          match_id: 'm-2',
          forfeiting_registration_id: null,
          forfeiting_team_id: 'team-nantes',
          reason: 'injury',
          voided_at: null,
        },
      ],
    },
  });
  return { service: new PoolStandingsService(supabase as never, resolver as never), supabase };
}

describe('getPoolStandings — a Pool of teams', () => {
  it('ranks each team by its side key, with its name, colour and logo, and no club', async () => {
    const { service } = makeService();

    const result = await service.getPoolStandings('t-team', 'overall');
    const rows = 'rows' in result ? result.rows : [];

    expect(
      rows.map(({ rank, entrantId, displayName, club, kind, colour, logoUrl }) => ({
        rank,
        entrantId,
        displayName,
        club,
        kind,
        colour,
        logoUrl,
      })),
    ).toEqual([
      {
        rank: 1,
        entrantId: 'team-lyon',
        displayName: 'Lyon Blades',
        club: null,
        kind: 'team',
        colour: 'green',
        logoUrl: 'https://x/l.png',
      },
      expect.objectContaining({ entrantId: rows[1]?.entrantId, kind: 'team', club: null }),
      expect.objectContaining({ entrantId: rows[2]?.entrantId, kind: 'team', club: null }),
    ]);
    const byTeam = new Map(rows.map((row) => [row.entrantId, row]));
    expect(byTeam.get('team-lyon')?.stats).toMatchObject({ W: 2, L: 0 });
    expect(byTeam.get('team-paris')?.stats).toMatchObject({ W: 0, L: 1, F: 0 });
    expect(byTeam.get('team-nantes')?.stats).toMatchObject({ W: 0, L: 1, F: 1 });
    expect(byTeam.get('team-nantes')).toMatchObject({ colour: 'blue', logoUrl: null });
  });

  it('carries the team fields in each Pool too', async () => {
    const { service } = makeService();

    const result = await service.getPoolStandings('t-team', 'by-pool');
    const pool = 'pools' in result ? result.pools[0] : undefined;

    expect(pool?.rows.find((row) => row.entrantId === 'team-paris')).toMatchObject({
      displayName: 'Paris Fers',
      kind: 'team',
      colour: null,
      logoUrl: null,
    });
  });

  it('reads the team twins of every side link, whole', async () => {
    const { service, supabase } = makeService();

    await service.getPoolStandings('t-team', 'overall');

    expect(selectsFor(supabase.from, 'pools')).toEqual([
      'id, name, pool_members(registration_id, team_id, registrations(id, persons(id, given_name, family_name, clubs(id, name, abbreviation))), teams(id, name, color, logo_url))',
    ]);
    expect(selectsFor(supabase.from, 'matches')).toEqual([
      'id, pool_id, status, red_registration_id, blue_registration_id, red_team_id, blue_team_id, red_score, blue_score, winner_registration_id, winner_team_id, end_reason',
    ]);
    expect(selectsFor(supabase.from, 'match_forfeits')).toEqual([
      'forfeiting_registration_id, forfeiting_team_id',
    ]);
  });
});
