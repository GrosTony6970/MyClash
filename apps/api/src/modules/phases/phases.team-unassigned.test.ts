import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, type TableSeed } from '../../common/testing/supabase-chain';
import { PhasesService } from './phases.service';
import { withStampedRules } from './match-rules.fixtures';

/**
 * The Pools page's "not yet in a Pool" panel. Team Longsword (t-team) offers its teams not seated
 * yet, never a team of Team Rapier (t-other); an individual Tournament offers its Fighters as
 * before. Each through the same seat shape (`poolSeatOf`).
 */

const TEAM_T = 't-team';

function makeService(seed: Record<string, TableSeed>) {
  const supabase = mockSupabase(...withStampedRules(seed));
  const placement = { placeMatches: vi.fn(() => Promise.resolve()) };
  const service = new PhasesService(supabase as never, placement as never);
  return { service, supabase };
}

describe('listUnassignedEntrants', () => {
  it("lists a team Tournament's teams not yet in a Pool, by side key, name and colour", async () => {
    const { service, supabase } = makeService({
      tournaments: { rows: [{ id: TEAM_T, entrant_kind: 'team' }] },
      teams: {
        rows: [
          {
            id: 'team-a',
            name: 'Lyon Blades',
            color: 'green',
            logo_url: null,
            tournament_id: TEAM_T,
          },
          { id: 'team-b', name: 'Paris Fers', color: null, logo_url: null, tournament_id: TEAM_T },
          {
            id: 'team-x',
            name: 'Elsewhere',
            color: null,
            logo_url: null,
            tournament_id: 't-other',
          },
        ],
      },
      pool_members: {
        rows: [
          {
            team_id: 'team-a',
            pools: { phase_id: 'phase-1', phases: { tournament_id: TEAM_T } },
            'pools.phases.tournament_id': TEAM_T,
          },
        ],
      },
    });

    const result = await service.listUnassignedEntrants(TEAM_T);

    expect(result).toEqual([
      {
        sideId: 'team-b',
        kind: 'team',
        registrationId: null,
        name: 'Paris Fers',
        personName: null,
        clubLabel: null,
        colour: null,
        logoUrl: null,
        hemaWeightedRating: null,
      },
    ]);
    expect(selectsFor(supabase.from, 'tournaments')).toEqual(['entrant_kind']);
    expect(selectsFor(supabase.from, 'teams')).toEqual(['id, name, color, logo_url']);
    expect(selectsFor(supabase.from, 'pool_members')).toEqual([
      'team_id, pools!inner(phase_id, phases!inner(tournament_id))',
    ]);
  });

  it("lists an individual Tournament's Fighters, as before", async () => {
    const { service } = makeService({
      tournaments: { rows: [{ id: TEAM_T, entrant_kind: 'individual', weapon: null }] },
      registrations: {
        rows: [
          {
            id: 'reg-1',
            status: 'registered',
            tournament_id: TEAM_T,
            persons: { given_name: 'Anna', family_name: 'Martin', clubs: null },
          },
        ],
      },
      pool_members: { rows: [] },
    });

    const result = await service.listUnassignedEntrants(TEAM_T);

    expect(result).toMatchObject([
      { sideId: 'reg-1', kind: 'individual', registrationId: 'reg-1', personName: 'Anna Martin' },
    ]);
  });
});
