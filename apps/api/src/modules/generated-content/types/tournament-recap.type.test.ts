import { describe, expect, it, vi } from 'vitest';
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
});
