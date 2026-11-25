import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { accentClassFor, type Penalty } from '@myclash/ui';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../../../src/i18n/I18nProvider';
import { MatchLiveView } from './match-live-view';
import { mapMatchRow, type MatchSummary } from './match-row';

// The live channel and the realtime switch need a browser; this page is drawn once, on the server.
vi.mock('./use-match-live-channel', () => ({ useMatchLiveChannel: () => undefined }));
vi.mock('../../../../../src/lib/supabase-browser', () => ({ useRealtimeDisabled: () => false }));

/**
 * Lyon Blades (red) against Paris Rapiers (blue), a team Pool bout. Lyon leads 5 to 2 when it
 * forfeits, so the record names Paris the winner. A team side names no Registration: its side is
 * its team.
 */
const TEAM_BOUT = {
  id: 'm-1',
  status: 'completed',
  red_score: 5,
  blue_score: 2,
  red_registration_id: null,
  blue_registration_id: null,
  winner_registration_id: null,
  red_team_id: 'team-lyon',
  blue_team_id: 'team-paris',
  winner_team_id: 'team-paris',
};

const FIGHTER_BOUT = {
  id: 'm-2',
  status: 'completed',
  red_score: 5,
  blue_score: 2,
  red_registration_id: 'reg-ada',
  blue_registration_id: 'reg-mary',
  winner_registration_id: 'reg-ada',
  red_team_id: null,
  blue_team_id: null,
  winner_team_id: null,
};

const SUMMARY: MatchSummary = {
  roundCode: 'LSW-P1-M1',
  redName: 'Lyon Blades',
  blueName: 'Paris Rapiers',
  redClub: null,
  blueClub: null,
  eventTimezone: 'Europe/Paris',
  referees: [],
  bestOf: 1,
  phaseType: 'pool',
  matchFormat: null,
  scoringConfig: null,
  redColour: 'teal',
  blueColour: 'amber',
  redLogoUrl: 'https://cdn.example/lyon.png',
  blueLogoUrl: null,
};

const FIGHTER_SUMMARY: MatchSummary = {
  ...SUMMARY,
  redName: 'Ada Lovelace',
  blueName: 'Mary Somerville',
  redColour: null,
  blueColour: null,
  redLogoUrl: null,
  blueLogoUrl: null,
};

/** A yellow card on Paris Rapiers: it names the team, no Registration. */
const TEAM_CARD: Penalty = {
  id: 'p-1',
  sequence: 1,
  registration_id: null,
  team_id: 'team-paris',
  card: 'yellow',
  source: 'direct',
  short_name: null,
  reason: 'leaves the piste',
  score_delta: 0,
  causes_match_forfeit: false,
  voided: false,
  occurred_at: '2027-06-21T10:01:00.000Z',
};

function render(row: Record<string, unknown>, summary: MatchSummary, penalties: Penalty[] = []) {
  return renderToStaticMarkup(
    <I18nProvider locale="en">
      <MatchLiveView
        matchId={row['id'] as string}
        initialMatch={mapMatchRow(row)}
        initialSummary={summary}
        initialExchanges={[]}
        initialPenalties={penalties}
        initialProtests={[]}
        backHref="/e/test-event/home"
        backLabelKey="publicApp.tournament.backToEventHome"
        sharePath="/e/test-event/match/m-1"
      />
    </I18nProvider>,
  );
}

/** The verdict line: the trophy, then the winner. */
const verdict = (html: string) =>
  html.slice(html.indexOf('🏆'), html.indexOf('</p>', html.indexOf('🏆')));

describe('mapMatchRow', () => {
  it("keys a team bout's sides and winner by their teams, with no ''", () => {
    const row = mapMatchRow(TEAM_BOUT);

    expect(row).toMatchObject({
      redSideId: 'team-lyon',
      blueSideId: 'team-paris',
      winnerSideId: 'team-paris',
    });
    expect(Object.values(row)).not.toContain('');
  });

  it("keys a Fighter's bout by its Registrations", () => {
    expect(mapMatchRow(FIGHTER_BOUT)).toMatchObject({
      redSideId: 'reg-ada',
      blueSideId: 'reg-mary',
      winnerSideId: 'reg-ada',
    });
  });

  it('keys a side not known yet as null, never an empty string', () => {
    expect(mapMatchRow({ id: 'm-3' })).toMatchObject({
      redSideId: null,
      blueSideId: null,
      winnerSideId: null,
    });
  });
});

describe('the public bout page of a team bout', () => {
  it('crowns the team that won by forfeit on the lower score, with its chip', () => {
    const line = verdict(render(TEAM_BOUT, SUMMARY));

    expect(line).toContain('Paris Rapiers');
    expect(line).toContain(accentClassFor('amber'));
    expect(line).not.toContain('Lyon Blades');
  });

  it("shows each team's chip by its name, and a team's logo above it", () => {
    const html = render(TEAM_BOUT, SUMMARY);

    expect(html).toContain(accentClassFor('teal'));
    expect(html).toContain(accentClassFor('amber'));
    // Decorative: the team's name is the text under it (WAI H2).
    expect(html).toMatch(/<img src="https:\/\/cdn\.example\/lyon\.png" alt=""/);
    // Paris Rapiers has no logo: its name alone, as a Fighter with no photo.
    expect(html.match(/<img /g)).toHaveLength(1);
  });

  it("places a team's card on its own team in the bout's history", () => {
    const html = render(TEAM_BOUT, SUMMARY, [TEAM_CARD]);
    const rows = html.split('<li').filter((li) => li.includes('data-event-number="1"'));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('Paris Rapiers');
    expect(rows[0]).not.toContain('Lyon Blades');
  });

  it("puts the team's chip before its name on the history row", () => {
    const html = render(TEAM_BOUT, SUMMARY, [TEAM_CARD]);
    const row = html.split('<li').find((li) => li.includes('data-event-number="1"'));

    expect(row).toMatch(new RegExp(`${accentClassFor('amber')}[^>]*></span></span> Paris Rapiers`));
  });
});

describe('the public bout page of a Fighter bout', () => {
  it('shows no chip and no logo, and crowns the Fighter by Registration', () => {
    const html = render(FIGHTER_BOUT, FIGHTER_SUMMARY);

    expect(html).not.toContain('<img');
    expect(html).toContain('text-sm font-semibold text-foreground">Ada Lovelace</span>');
    expect(verdict(html)).toContain('🏆 Ada Lovelace');
  });
});
