import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_FORMAT_CONFIG, DEFAULT_SCORING_CONFIG } from '@myclash/types';

import type { ExchangeRow, Penalty } from '../types/match-events';
import { buildBoutFlow } from '../utils/bout-flow';
import { accentClassFor } from '../utils/color-token';
import { buildUnifiedTimeline } from '../utils/exchange-timeline';
import { BoutFlowChart } from './BoutFlowChart';
import { MatchTimeline } from './MatchTimeline';

/**
 * A team side shows its colour chip wherever its name is (call 6): on each row of the bout's
 * history, and in the bout-flow legend, which names no one, so there the chip carries the team's
 * name. Lyon Blades (red, green) against Paris Rapiers (blue, violet). A Fighter's side has no
 * colour and shows none.
 */

const t = (key: string) => key;
const GREEN = accentClassFor('green');
const VIOLET = accentClassFor('violet');

const exchanges: ExchangeRow[] = [
  {
    id: 'hit-1',
    sequence: 1,
    type: 'clean',
    voided: false,
    occurredAt: '2027-06-21T10:01:00.000Z',
    scoringSide: 'red',
    scoreDelta: 1,
  },
  {
    // A full afterblow: Lyon strikes first, Paris answers, both score on one row.
    id: 'hit-2',
    sequence: 2,
    type: 'afterblow',
    voided: false,
    occurredAt: '2027-06-21T10:02:00.000Z',
    scoringSide: 'red',
    scoreDelta: 2,
    defenderDelta: 1,
  },
];

const card: Penalty = {
  id: 'card-1',
  sequence: 3,
  registration_id: null,
  team_id: 'team-paris',
  card: 'yellow',
  source: 'direct',
  short_name: null,
  reason: 'leaves the piste',
  score_delta: 0,
  causes_match_forfeit: false,
  voided: false,
  occurred_at: '2027-06-21T10:03:00.000Z',
};

const events = buildUnifiedTimeline({
  exchanges,
  penalties: [card],
  protests: [],
  redName: 'Lyon Blades',
  blueName: 'Paris Rapiers',
  redSideId: 'team-lyon',
  blueSideId: 'team-paris',
  t,
  config: DEFAULT_SCORING_CONFIG,
});

type Colours = { red: string | null; blue: string | null };
const TEAMS: Colours = { red: 'green', blue: 'violet' };
const FIGHTERS: Colours = { red: null, blue: null };

/** Each `<li>` of the history, by its number. */
function rows(colours: Colours, scale: 'compact' | 'tv' | 'page' = 'page'): Map<number, string> {
  const html = renderToStaticMarkup(
    <MatchTimeline
      events={events}
      scale={scale}
      redColour={colours.red}
      blueColour={colours.blue}
      t={t}
    />,
  );
  const byNumber = new Map<number, string>();
  for (const li of html.split('<li').slice(1)) {
    const n = /data-event-number="(\d+)"/.exec(li)?.[1];
    if (n) byNumber.set(Number(n), li);
  }
  return byNumber;
}

describe("a team bout's history rows", () => {
  it("put each team's chip before its name", () => {
    const all = rows(TEAMS);

    expect(all.get(1)).toMatch(new RegExp(`${GREEN}[^>]*></span></span> Lyon Blades`));
    expect(all.get(3)).toMatch(new RegExp(`${VIOLET}[^>]*></span></span> Paris Rapiers`));
    expect(all.get(3)).not.toContain(GREEN);
  });

  it("put the defender's chip before the defender's name on an afterblow", () => {
    const row = rows(TEAMS).get(2)!;

    expect(row).toMatch(new RegExp(`${GREEN}[^>]*></span></span> Lyon Blades`));
    expect(row).toMatch(new RegExp(`${VIOLET}[^>]*></span></span> Paris Rapiers`));
  });

  it("give the chip the stage's ink on the projector only", () => {
    expect(rows(TEAMS, 'tv').get(1)).toContain(
      `<span data-theme="dark" class="inline-flex"><span aria-hidden="true"`,
    );
    expect(rows(TEAMS, 'compact').get(1)).not.toContain('data-theme');
  });
});

describe("a Fighter bout's history rows", () => {
  it('show no chip and no space before a name', () => {
    for (const li of rows(FIGHTERS).values()) {
      expect(li).not.toContain('rounded-full ring-1 ring-inset ring-foreground/50 h-[0.6em]');
    }
    expect(rows(FIGHTERS).get(1)).toContain('>Lyon Blades</span>');
  });
});

/** The legend line over the chart: each score beside its side's dot (and a team's chip). */
function legend(
  colours: Colours,
  surface: 'dark' | 'light' = 'light',
  scale: 'compact' | 'tv' = 'compact',
): string {
  const series = buildBoutFlow({
    exchanges,
    penalties: [card],
    redSideId: 'team-lyon',
    blueSideId: 'team-paris',
    matchFormat: DEFAULT_MATCH_FORMAT_CONFIG,
    phaseType: 'pool',
    endReason: null,
    bestOf: 1,
    currentRound: 1,
  });
  const html = renderToStaticMarkup(
    <BoutFlowChart
      series={series}
      config={DEFAULT_SCORING_CONFIG}
      redName="Lyon Blades"
      blueName="Paris Rapiers"
      redColour={colours.red}
      blueColour={colours.blue}
      surface={surface}
      scale={scale}
      t={t}
    />,
  );
  const start = html.indexOf('<p class="inline-flex items-center gap-1');
  return html.slice(start, html.indexOf('</p>', start));
}

describe('the bout-flow legend', () => {
  it("shows each team's chip beside its score, named by the team", () => {
    const line = legend(TEAMS);

    expect(line).toMatch(new RegExp(`role="img" title="Lyon Blades" class="[^"]*${GREEN}`));
    expect(line).toMatch(new RegExp(`role="img" title="Paris Rapiers" class="[^"]*${VIOLET}`));
    expect(line.indexOf(GREEN)).toBeLessThan(line.indexOf(VIOLET));
  });

  it("gives the chip the stage's ink on a dark surface", () => {
    expect(legend(TEAMS, 'dark')).toContain('data-theme="dark"');
    expect(legend(TEAMS, 'light')).not.toContain('data-theme');
  });

  // The projector has no pointer for a tooltip (display-kiosk.md, D20): the chip is decorative.
  it('names no chip on the projector', () => {
    const line = legend(TEAMS, 'dark', 'tv');

    expect(line).toContain(GREEN);
    expect(line).not.toContain('title=');
    expect(line).not.toContain('role="img"');
  });

  it("shows no chip on a Fighter's bout", () => {
    expect(legend(FIGHTERS)).not.toContain('role="img"');
  });
});

/** One owner for "dot and space before a team's name": a second copy drifts (CLAUDE.md). */
describe('TeamChip, the one chip beside a team name', () => {
  it.each(['TVScoreboard.tsx', 'LiceWaitingDisplay.tsx', 'MatchTimeline.tsx', 'BoutFlowChart.tsx'])(
    '%s draws no dot of its own',
    (file) => {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source).toContain('<TeamChip');
      expect(source).not.toContain('TournamentColorDot');
    },
  );
});
