import { renderToStaticMarkup } from 'react-dom/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DisplayMatch, MatchProtest, Penalty } from '../types/match-events';
import { TVScoreboard } from './TVScoreboard';

/**
 * The TV on a team bout. Each side is a team: its key is the team's id, it has no Registration,
 * it shows its name with its colour chip, and its logo where a Fighter's photo is (call 6). The
 * live read is stubbed, so a static render draws the whole board.
 */
const live = vi.hoisted(() => ({
  match: null as unknown,
  penalties: [] as unknown[],
  protests: [] as unknown[],
  clock: null as unknown,
}));
vi.mock('../hooks/useLiveMatch', () => ({
  useLiveMatch: () => ({
    match: live.match,
    penalties: live.penalties,
    protests: live.protests,
    exchanges: [],
    clock: live.clock,
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
  blueColour: 'violet',
  redLogoUrl: null,
  blueLogoUrl: 'https://cdn.test/paris.png',
  startedAt: null,
  endedAt: null,
  // A team side has no Registration: the payload's Registration ids are null.
  redRegistrationId: null,
  blueRegistrationId: null,
  winnerRegistrationId: null,
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
    score_delta: 0,
    causes_match_forfeit: false,
    voided: false,
  };
}

function teamProtest(id: string, teamId: string): MatchProtest {
  return {
    id,
    client_uuid: id,
    match_id: 'm1',
    registration_id: null,
    team_id: teamId,
    sequence: 1,
    round_number: 1,
    clock_time_ms: 1000,
    occurred_at: '2027-06-21T10:00:00.000Z',
    voided: false,
  };
}

function render(): string {
  return renderToStaticMarkup(
    <TVScoreboard
      matchId="m1"
      apiBaseUrl="http://api.test"
      supabaseClient={{} as SupabaseClient}
      onBoutOver={() => {}}
      t={t}
    />,
  );
}

/** The board split at the centre column: the red column before it, the blue one after. */
function columns(html: string): { red: string; blue: string } {
  const centre = html.indexOf('scoring.lice.eventsHeader');
  const header = html.indexOf('</header>');
  return { red: html.slice(header, centre), blue: html.slice(centre) };
}

/** The yellow card chip's count in a column. */
const yellowCount = (column: string) =>
  /bg-yellow-400 text-yellow-950[^"]*">\s*<span[^>]*><\/span>(\d+)<\/span>/.exec(column)?.[1];

beforeEach(() => {
  live.match = teamBout;
  live.penalties = [];
  live.protests = [];
  live.clock = { status: 'running', activeMs: 0, runningFrom: null };
});

describe('TVScoreboard on a team bout', () => {
  // `null === null`: the team card has no Registration and neither side has one, so the card was
  // counted under both teams.
  it('shows a team card under its own team only', () => {
    live.penalties = [teamCard('p1', 'team-blue')];
    const { red, blue } = columns(render());
    expect(yellowCount(red)).toBe('0');
    expect(yellowCount(blue)).toBe('1');
  });

  it('counts each team protests on its own chip', () => {
    live.protests = [
      teamProtest('a', 'team-red'),
      teamProtest('b', 'team-red'),
      teamProtest('c', 'team-blue'),
    ];
    const { red, blue } = columns(render());
    const chip = (column: string) =>
      /protestsChipTooltip[^>]*>.*?<\/svg>(\d+)<\/span>/s.exec(column)?.[1];
    expect(chip(red)).toBe('2');
    expect(chip(blue)).toBe('1');
  });

  it('shows each team name with its colour chip, and its logo where a photo is', () => {
    const html = render();
    const { red, blue } = columns(html);
    expect(red).toMatch(/bg-green-700[^>]*><\/span> Lyon Blades/);
    expect(blue).toMatch(/bg-violet-700[^>]*><\/span> Paris Rapiers/);
    // The logo is named by the team name; a team with no logo shows the initials, as a Fighter
    // with no photo does.
    expect(blue).toContain('src="https://cdn.test/paris.png" alt="Paris Rapiers"');
    expect(red).not.toContain('<img');
    expect(red).toContain('>LB</div>');
    // The header's "X vs Y" line carries the chips too.
    const header = html.slice(0, html.indexOf('</header>'));
    expect(header).toMatch(/bg-green-700[^>]*><\/span> Lyon Blades/);
    expect(header).toMatch(/bg-violet-700[^>]*><\/span> Paris Rapiers/);
  });

  it('shows a chip beside each team of the next bout', () => {
    live.match = {
      ...teamBout,
      nextMatchId: 'm2',
      nextMatch: {
        id: 'm2',
        matchNumberLabel: 'M2',
        roundCode: null,
        redFighterName: 'Nice Sabres',
        blueFighterName: 'Lille Foils',
        redColour: 'gold',
        blueColour: 'teal',
      },
    };
    const header = render().split('</header>')[0]!;
    expect(header).toMatch(/bg-amber-400[^>]*><\/span> Nice Sabres/);
    expect(header).toMatch(/bg-teal-700[^>]*><\/span> Lille Foils/);
  });

  // The recorded winner is a side key. A team can win by forfeit on the lower score: the score
  // fallback would crown the other team.
  it('crowns the team the bout records as its winner, on the lower score', () => {
    live.match = {
      ...teamBout,
      status: 'completed',
      redScore: 5,
      blueScore: 0,
      winnerSideId: 'team-blue',
    };
    live.clock = { status: 'ended', activeMs: 0, runningFrom: null };
    const html = render();
    expect(html).toMatch(/🏆 <span><span[^>]*bg-violet-700[^>]*><\/span> Paris Rapiers<\/span>/);
    expect(html.match(/🏆/g)).toHaveLength(1);
  });

  // The stage is near-black and sets no scope: the dot's edge is the scope's ink, so each stage
  // line that carries a dot takes the dark scope, or a black team's dot vanishes.
  it('sets the dark scope on the column names and on the winner line', () => {
    live.match = { ...teamBout, status: 'completed', winnerSideId: 'team-blue' };
    live.clock = { status: 'ended', activeMs: 0, runningFrom: null };
    const html = render();
    const { red, blue } = columns(html);
    const nameLine =
      /<p data-theme="dark" class="text-stage-name text-center[^"]*">(?:(?!<\/p>).)*/s;
    expect(nameLine.exec(red)?.[0]).toContain('Lyon Blades');
    expect(nameLine.exec(blue)?.[0]).toContain('Paris Rapiers');
    expect(html).toMatch(/<p data-theme="dark" class="text-stage-name font-bold">🏆/);
  });
});

describe('TVScoreboard on a Fighter bout', () => {
  // A Fighter's side has no colour: the name stands alone, with no dot and no space before it.
  it('shows no colour dot anywhere', () => {
    live.match = {
      ...teamBout,
      redSideId: 'reg-red',
      blueSideId: 'reg-blue',
      redFighterName: 'Ada Lovelace',
      blueFighterName: 'Mary Somerville',
      redColour: null,
      blueColour: null,
      redLogoUrl: null,
      blueLogoUrl: null,
      redRegistrationId: 'reg-red',
      blueRegistrationId: 'reg-blue',
      status: 'completed',
      redScore: 5,
      winnerSideId: 'reg-red',
    };
    live.clock = { status: 'ended', activeMs: 0, runningFrom: null };
    const html = render();
    expect(html).not.toContain('rounded-full ring-1 ring-inset');
    expect(html).toContain('<span>Ada Lovelace</span>');
    expect(html).toMatch(/🏆 <span>Ada Lovelace<\/span>/);
  });
});
