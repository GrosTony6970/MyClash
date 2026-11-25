// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accentClassFor } from '@myclash/ui';
import type { PoolStandingsRow } from '@myclash/types/pool-standings';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../../../src/i18n/I18nProvider';
import { PoolMatchesView } from './PoolMatchesView';
import { PoolsCompositionView, type PoolMember } from './PoolsCompositionView';
import { StandingsTable } from './StandingsTable';
import { StandingsView } from './StandingsView';
import { poolEntrants, toStandingRow } from './tournament-data';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
// The live refetch needs a websocket; these pages are drawn from one read.
vi.mock('../../../../../src/lib/supabase-browser', () => ({ useRealtimeWithFallback: () => {} }));

/**
 * A team Tournament's Pool: Lyon Blades (teal) against Paris Rapiers (amber). Lyon leads 5 to 2
 * when it forfeits, so the record names Paris the winner. A team side has no Registration: the
 * public Pool read sends its team's key, colour and logo beside a null Registration id.
 */
const TEAM_BOUT = {
  matchId: 'm-1',
  roundCode: 'LSW-P1-M1',
  status: 'completed',
  scheduledAt: null,
  redFighterName: 'Lyon Blades',
  redClubAbbrev: null,
  redRegistrationId: null,
  redSideId: 'team-lyon',
  redColour: 'teal',
  redLogoUrl: 'https://cdn.example/lyon.png',
  redScore: 5,
  blueFighterName: 'Paris Rapiers',
  blueClubAbbrev: null,
  blueRegistrationId: null,
  blueSideId: 'team-paris',
  blueColour: 'amber',
  blueLogoUrl: null,
  blueScore: 2,
  winnerRegistrationId: null,
  winnerSideId: 'team-paris',
  liceName: null,
  liceColorHex: null,
};

/** Ada (the reader) against Mary, in an individual Tournament: sides by Registration. */
const FIGHTER_BOUT = {
  ...TEAM_BOUT,
  matchId: 'm-2',
  roundCode: 'LSW-P1-M2',
  redFighterName: 'Ada Lovelace',
  redRegistrationId: 'reg-ada',
  redSideId: 'reg-ada',
  redColour: null,
  redLogoUrl: null,
  blueFighterName: 'Mary Somerville',
  blueRegistrationId: 'reg-mary',
  blueSideId: 'reg-mary',
  blueColour: null,
  winnerSideId: 'reg-ada',
};

const teamSeat = (sideId: string, name: string, colour: string): PoolMember => ({
  sideId,
  kind: 'team',
  registrationId: null,
  fighterName: name,
  clubName: null,
  clubAbbreviation: null,
  colour,
  logoUrl: null,
  seed: null,
});

const teamStanding = (entrantId: string, name: string, colour: string): PoolStandingsRow => ({
  rank: 1,
  entrantId,
  displayName: name,
  club: null,
  status: 'completed',
  stats: { W: 1, L: 0, D: 0, ptsScored: 5, ptsConceded: 2, doubles: 0, score: 1 },
  kind: 'team',
  colour,
  logoUrl: null,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Answer every read with `body`, then draw `node` and let its read land. */
async function drawWithRead(node: React.ReactNode, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })),
  );
  await act(async () => {
    root.render(<I18nProvider locale="en">{node}</I18nProvider>);
  });
  await act(async () => {});
}

/** The cell of a side's name: the chip, then the name, then the reader's mark. */
const nameCell = (name: string) =>
  [...container.querySelectorAll('td')].find((td) => td.textContent?.includes(name))!;

describe("a team Pool's bout list", () => {
  const read = (matches: unknown[]) => ({
    tournamentId: 't-1',
    sideColors: { red: 'red', blue: 'blue' },
    timezone: 'Europe/Paris',
    pools: [{ poolId: 'p-1', poolName: 'Pool A', matches }],
  });

  it('names each team with its chip, and bolds the team that won by forfeit on the lower score', async () => {
    await drawWithRead(<PoolMatchesView eventSlug="e" tournamentSlug="t" />, read([TEAM_BOUT]));

    const lyon = nameCell('Lyon Blades');
    const paris = nameCell('Paris Rapiers');
    expect(lyon.innerHTML).toContain(accentClassFor('teal'));
    expect(paris.innerHTML).toContain(accentClassFor('amber'));
    expect(paris.querySelector('.font-bold')?.textContent).toBe('Paris Rapiers');
    expect(lyon.querySelector('.font-bold')).toBeNull();
  });

  it("still marks the reader's own bout by Registration, with no chip for a Fighter", async () => {
    await drawWithRead(
      <PoolMatchesView eventSlug="e" tournamentSlug="t" highlightRegistrationId="reg-ada" />,
      read([FIGHTER_BOUT]),
    );

    const ada = nameCell('Ada Lovelace');
    expect(ada.textContent).toContain('You');
    expect(ada.querySelector('.rounded-full')).toBeNull();
    expect(nameCell('Mary Somerville').textContent).not.toContain('You');
  });
});

describe("a team Pool's composition card", () => {
  const pool = (members: PoolMember[]) => ({
    id: 'p-1',
    name: 'Pool A',
    members,
    referees: [],
    liceName: null,
    liceColorHex: null,
    startAt: null,
  });

  it('names each team with its chip, one row per team', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() =>
      root.render(
        <PoolsCompositionView
          pools={[
            pool([
              teamSeat('team-lyon', 'Lyon Blades', 'teal'),
              teamSeat('team-paris', 'Paris Rapiers', 'amber'),
            ]),
          ]}
          accentColor="#64748b"
          locale="en"
        />,
      ),
    );

    const rows = [...container.querySelectorAll('li')];
    expect(rows.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Lyon Blades'),
      expect.stringContaining('Paris Rapiers'),
    ]);
    expect(rows[0]!.innerHTML).toContain(accentClassFor('teal'));
    expect(rows[1]!.innerHTML).toContain(accentClassFor('amber'));
    // Two seats with no Registration: keyed by Registration, React saw one key twice.
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key/);
  });
});

describe("a team Pool's standings", () => {
  it("keep each team's chip data", () => {
    expect(toStandingRow(teamStanding('team-paris', 'Paris Rapiers', 'amber'))).toMatchObject({
      entrantId: 'team-paris',
      fighterName: 'Paris Rapiers',
      kind: 'team',
      colour: 'amber',
      logoUrl: null,
    });
  });

  it("show each team's chip by its name, per Pool", () => {
    const html = renderToStaticMarkup(
      <I18nProvider locale="en">
        <StandingsTable
          poolId="p-1"
          poolName="Pool A"
          tournamentId="t-1"
          initialStandings={[toStandingRow(teamStanding('team-paris', 'Paris Rapiers', 'amber'))]}
        />
      </I18nProvider>,
    );

    expect(html).toMatch(new RegExp(`${accentClassFor('amber')}[^>]*></span>Paris Rapiers`));
  });

  it("show each team's chip by its name, overall", async () => {
    await drawWithRead(<StandingsView tournamentId="t-1" pools={[]} />, {
      rulesetCode: 'tf_v1',
      rulesetVersion: '1.0.0',
      columns: [],
      rows: [teamStanding('team-paris', 'Paris Rapiers', 'amber')],
    });

    const button = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Paris Rapiers'),
    );
    expect(button?.innerHTML).toContain(accentClassFor('amber'));
  });
});

/** A team Pool counts and heads its columns in teams; an individual Pool keeps its words. */
describe("a team Pool's words", () => {
  const fighterSeat = (sideId: string, name: string): PoolMember => ({
    ...teamSeat(sideId, name, 'teal'),
    kind: 'individual',
    registrationId: sideId,
    colour: null,
  });
  const fighterStanding = (entrantId: string, name: string): PoolStandingsRow => ({
    ...teamStanding(entrantId, name, 'teal'),
    kind: 'individual',
    colour: null,
  });
  const headers = () => [...container.querySelectorAll('th')].map((th) => th.textContent);
  const pools = (matches: unknown[]) => ({
    tournamentId: 't-1',
    sideColors: { red: 'red', blue: 'blue' },
    timezone: 'Europe/Paris',
    pools: [{ poolId: 'p-1', poolName: 'Pool A', matches }],
  });
  const card = (members: PoolMember[], locale: 'en' | 'fr' = 'en') => {
    act(() =>
      root.render(
        <PoolsCompositionView
          pools={[
            {
              id: 'p-1',
              name: 'Pool A',
              members,
              referees: [],
              liceName: null,
              liceColorHex: null,
              startAt: null,
            },
          ]}
          accentColor="#64748b"
          locale={locale}
        />,
      ),
    );
    // The card's own header, not the start-time section's.
    return container.querySelector('a header')!.textContent;
  };
  const standingsHeader = (row: PoolStandingsRow) =>
    /<th[^>]*>([^<]*)<\/th>/.exec(
      renderToStaticMarkup(
        <I18nProvider locale="en">
          <StandingsTable
            poolId="p-1"
            poolName="Pool A"
            tournamentId="t-1"
            initialStandings={[toStandingRow(row)]}
          />
        </I18nProvider>,
      ),
    )?.[1];

  it('heads the bout list Team 1 and Team 2', async () => {
    await drawWithRead(<PoolMatchesView eventSlug="e" tournamentSlug="t" />, pools([TEAM_BOUT]));
    expect(headers()).toEqual(expect.arrayContaining(['Team 1', 'Team 2']));
  });

  it('heads a Fighters bout list Fighter 1 and Fighter 2', async () => {
    await drawWithRead(<PoolMatchesView eventSlug="e" tournamentSlug="t" />, pools([FIGHTER_BOUT]));
    expect(headers()).toEqual(expect.arrayContaining(['Fighter 1', 'Fighter 2']));
  });

  it('counts the composition card in teams, in English and French, and in fighters for Fighters', () => {
    const teams = [
      teamSeat('team-lyon', 'Lyon Blades', 'teal'),
      teamSeat('team-paris', 'Paris Rapiers', 'amber'),
    ];
    expect(card(teams)).toContain('2 teams');
    expect(card(teams, 'fr')).toContain('2 équipes');
    expect(card([fighterSeat('reg-ada', 'Ada'), fighterSeat('reg-mary', 'Mary')])).toContain(
      '2 fighters',
    );
  });

  it('heads the standings Team, and Fighter for Fighters', async () => {
    expect(standingsHeader(teamStanding('team-paris', 'Paris Rapiers', 'amber'))).toBe('Team');
    expect(standingsHeader(fighterStanding('reg-ada', 'Ada Lovelace'))).toBe('Fighter');

    await drawWithRead(<StandingsView tournamentId="t-1" pools={[]} />, {
      rulesetCode: 'tf_v1',
      rulesetVersion: '1.0.0',
      columns: [],
      rows: [teamStanding('team-paris', 'Paris Rapiers', 'amber')],
    });
    expect(headers()).toContain('Team');
  });

  it('counts the Tournament header in teams when its Pools seat teams', () => {
    const pool = (members: PoolMember[]) => ({
      id: 'p-1',
      name: 'Pool A',
      members,
      referees: [],
      standings: [],
    });
    expect(poolEntrants([pool([teamSeat('team-lyon', 'Lyon Blades', 'teal')])])).toEqual({
      count: 1,
      teams: true,
    });
    expect(poolEntrants([pool([fighterSeat('reg-ada', 'Ada')])])).toEqual({
      count: 1,
      teams: false,
    });
  });
});
