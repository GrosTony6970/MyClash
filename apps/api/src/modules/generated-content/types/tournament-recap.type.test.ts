import { describe, expect, it, vi } from 'vitest';
import type { BracketSideWire, BracketSlotWire } from '@myclash/types/bracket-side';
import { mockSupabase } from '../../../common/testing/supabase-chain';
import { TournamentRecapType } from './tournament-recap.type';

describe('TournamentRecapType.buildContext', () => {
  it('reads the standings as the organiser it was asked by, so a draft Tournament answers them', async () => {
    // A recap is written before publishing: an outsider's reader would 404 the draft (ruling 127a).
    const supabase = mockSupabase({
      tournaments: {
        rows: [
          {
            id: 't-1',
            name: 'Longsword',
            weapon: 'longsword',
            ruleset_code: 'TF_v1',
            event_id: 'e-1',
            slug: 'longsword',
            events: { slug: 'open', organization_id: 'org-a' },
          },
        ],
      },
    });
    const events = {
      getPublicTournamentStandings: vi.fn(async () => ({
        tournament: { participantCount: 4, completedMatchCount: 3, poolCount: 1 },
        bracketSlots: [],
      })),
    };
    const recap = new TournamentRecapType(supabase as never, events as never, {} as never);

    const context = await recap.buildContext('t-1', 'en', 'u-admin');

    expect(events.getPublicTournamentStandings).toHaveBeenCalledWith('open', 'longsword', {
      userId: 'u-admin',
      staff: null,
    });
    expect(context).toMatchObject({ tournament: 'Longsword', participantCount: 4 });
  });

  it("names a team bracket's podium by team, the final won on a forfeit with the lower score", async () => {
    // Lyon Blades led the final 5-3 and forfeited: Rome Guard is the recorded winner. A team side
    // has no Registration, so only the side keys of the public bracket read can rank it.
    const supabase = mockSupabase({
      tournaments: {
        rows: [
          {
            id: 't-1',
            name: 'Teams',
            weapon: 'longsword',
            ruleset_code: 'TF_v1',
            event_id: 'e-1',
            slug: 'teams',
            events: { slug: 'open', organization_id: 'org-a' },
          },
        ],
      },
    });
    const team = (sideId: string, name: string): BracketSideWire => ({
      sideId,
      kind: 'team',
      registrationId: null,
      teamId: sideId,
      name,
      clubAbbrev: null,
      colour: 'green',
    });
    const final: BracketSlotWire = {
      id: 's-final',
      round: 1,
      position: 1,
      status: 'completed',
      matchId: 'm-final',
      redFighterName: 'Lyon Blades',
      blueFighterName: 'Rome Guard',
      redClubAbbrev: null,
      blueClubAbbrev: null,
      redScore: 5,
      blueScore: 3,
      redRegistrationId: null,
      blueRegistrationId: null,
      winnerRegistrationId: null,
      redSideId: 'team-lyon',
      blueSideId: 'team-rome',
      winnerSideId: 'team-rome',
      red: team('team-lyon', 'Lyon Blades'),
      blue: team('team-rome', 'Rome Guard'),
      source_a_ref: 'seed 1',
      source_b_ref: 'seed 2',
      liceName: null,
      referees: [],
    };
    const events = {
      getPublicTournamentStandings: vi.fn(async () => ({
        tournament: { participantCount: 2, completedMatchCount: 1, poolCount: 0 },
        bracketSlots: [final],
        phaseType: 'single_elim',
      })),
    };
    const recap = new TournamentRecapType(supabase as never, events as never, {} as never);

    const context = await recap.buildContext('t-1', 'en', 'u-admin');

    expect(context['podium']).toEqual([
      { place: 1, fighter: 'Rome Guard', club: null },
      { place: 2, fighter: 'Lyon Blades', club: null },
    ]);
  });
});
