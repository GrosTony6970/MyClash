import { renderToStaticMarkup } from 'react-dom/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { DisplayMatch, Penalty } from '../types/match-events';
import { MatchScoreboard } from './MatchScoreboard';

/**
 * The admin preview scoreboard places each card under its side. A team bout's sides are its
 * teams: a team card names its team and no Registration. The live read is stubbed, so a static
 * render shows the board itself.
 */
const live = vi.hoisted(() => ({ match: null as unknown, penalties: [] as unknown[] }));
vi.mock('../hooks/useLiveMatch', () => ({
  useLiveMatch: () => ({
    match: live.match,
    penalties: live.penalties,
    protests: [],
    exchanges: [],
    clock: null,
    elapsedMs: 0,
    loadError: null,
    connected: true,
    freshness: { kind: 'live' },
    refresh: async () => {},
  }),
}));

const t = (key: string) => key;

const teamBout: DisplayMatch = {
  id: 'm1',
  status: 'running',
  matchNumberLabel: 'M1',
  redScore: 0,
  blueScore: 0,
  redSideId: 'team-red',
  blueSideId: 'team-blue',
  winnerSideId: null,
  redFighterName: 'Lyon Blades',
  blueFighterName: 'Paris Rapiers',
  redColour: 'green',
  blueColour: 'gold',
  redLogoUrl: null,
  blueLogoUrl: null,
  startedAt: null,
  endedAt: null,
};

function teamCard(id: string, teamId: string): Penalty {
  return {
    id,
    sequence: 1,
    registration_id: null,
    team_id: teamId,
    card: 'yellow',
    source: 'direct',
    short_name: null,
    reason: 'leaves the piste',
    score_delta: -1,
    causes_match_forfeit: false,
    voided: false,
  };
}

/** The cards row of each panel, red's then blue's: the `title` of each card in it. */
function cardRows(html: string): string[][] {
  const rows = html.split('aria-label="scoring.liveMatch.penaltyCards"').slice(1);
  return rows.map((row) =>
    [...row.split('</div>')[0]!.matchAll(/title="([^"]+)"/g)].map((m) => m[1]!),
  );
}

describe('MatchScoreboard on a team bout', () => {
  it('shows a team card under its own team only', () => {
    live.match = teamBout;
    live.penalties = [teamCard('p1', 'team-blue')];
    const html = renderToStaticMarkup(
      <MatchScoreboard
        matchId="m1"
        apiBaseUrl="http://api.test"
        supabaseClient={{} as SupabaseClient}
        t={t}
      />,
    );
    // Red has no card, so its row is not drawn: blue's is the only one.
    expect(cardRows(html)).toEqual([['yellow']]);
    expect(html.indexOf('Paris Rapiers')).toBeLessThan(
      html.indexOf('aria-label="scoring.liveMatch.penaltyCards"'),
    );
    expect(html.indexOf('Lyon Blades')).toBeLessThan(html.indexOf('Paris Rapiers'));
  });
});
