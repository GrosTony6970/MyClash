// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accentClassFor } from '@myclash/ui';
import type { BracketSideWire } from '@myclash/types/bracket-side';
// Relative: this app's tsconfig leaves test files out, and Vite applies its `@/` to the files it holds.
import { I18nProvider } from '../../../../../src/i18n/I18nProvider';
import { BracketLive } from './BracketLive';
import { FinalRankingTab } from './FinalRankingTab';
import { derivePodium, type BracketSlot } from './tournament-data';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
// The live refetch needs a websocket; the bracket is drawn from one read.
vi.mock('../../../../../src/lib/supabase-browser', () => ({ useRealtimeWithFallback: () => {} }));

/**
 * A team final: Lyon Blades (teal, red) leads 5 to 2, then forfeits, so the record names Paris
 * Rapiers (amber, blue) the winner. A team side has no Registration.
 */
const team = (teamId: string, name: string, colour: string): BracketSideWire => ({
  sideId: teamId,
  kind: 'team',
  registrationId: null,
  teamId,
  name,
  clubAbbrev: null,
  colour,
});

const FINAL: BracketSlot = {
  id: 'slot-final',
  round: 1,
  position: 1,
  redFighterName: 'Lyon Blades',
  blueFighterName: 'Paris Rapiers',
  redClubAbbrev: null,
  blueClubAbbrev: null,
  redScore: 5,
  blueScore: 2,
  winnerRegistrationId: null,
  redSideId: 'team-lyon',
  blueSideId: 'team-paris',
  winnerSideId: 'team-paris',
  red: team('team-lyon', 'Lyon Blades', 'teal'),
  blue: team('team-paris', 'Paris Rapiers', 'amber'),
  status: 'completed',
  matchId: 'match-final',
  redRegistrationId: null,
  blueRegistrationId: null,
  source_a_ref: null,
  source_b_ref: null,
  liceName: null,
  referees: [],
};

describe('the podium of a team bracket', () => {
  it('crowns the forfeit winner by side and carries each team colour', () => {
    const podium = derivePodium([FINAL]);

    expect(podium?.gold).toEqual({ fighterName: 'Paris Rapiers', colour: 'amber' });
    expect(podium?.silver).toEqual({ fighterName: 'Lyon Blades', colour: 'teal' });
  });
});

describe('the final ranking tab of a team Tournament', () => {
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
  });

  async function draw(slots: BracketSlot[]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ rows: [] }) })),
    );
    await act(async () => {
      root.render(
        <I18nProvider locale="en">
          <FinalRankingTab isTournamentCompleted tournamentId="t-1" bracketSlots={slots} />
        </I18nProvider>,
      );
    });
    await act(async () => {});
  }

  it('heads the name column Team, draws each team chip and no club pill, and ranks the forfeit winner first', async () => {
    await draw([FINAL]);

    expect([...container.querySelectorAll('th')].map((th) => th.textContent)).toContain('Team');
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows[0]!.textContent).toContain('Paris Rapiers');
    expect(rows[0]!.innerHTML).toContain(accentClassFor('amber'));
    expect(rows[1]!.textContent).toContain('Lyon Blades');
    expect(rows[1]!.innerHTML).toContain(accentClassFor('teal'));
    expect(container.querySelector('.bg-border')).toBeNull();
  });

  it('keeps Fighter on the column of an individual Tournament', async () => {
    const person = (id: string, name: string): BracketSideWire => ({
      sideId: id,
      kind: 'individual',
      registrationId: id,
      teamId: null,
      name,
      clubAbbrev: null,
      colour: null,
    });
    await draw([
      {
        ...FINAL,
        redSideId: 'reg-anna',
        blueSideId: 'reg-bea',
        winnerSideId: 'reg-bea',
        red: person('reg-anna', 'Anna'),
        blue: person('reg-bea', 'Bea'),
        redRegistrationId: 'reg-anna',
        blueRegistrationId: 'reg-bea',
      },
    ]);

    expect([...container.querySelectorAll('th')].map((th) => th.textContent)).toContain('Fighter');
  });
});

describe('the live bracket of a team Tournament', () => {
  const summary = (teams: boolean, locale: 'en' | 'fr') =>
    renderToStaticMarkup(
      <I18nProvider locale={locale}>
        <BracketLive
          eventSlug="e"
          tournamentSlug="t"
          initialSlots={[FINAL]}
          bracketSize={2}
          rounds={1}
          weapon={null}
          teams={teams}
        />
      </I18nProvider>,
    );

  it('sizes the bracket in teams, in English and French', () => {
    expect(summary(true, 'en')).toContain('2-team bracket');
    expect(summary(true, 'fr')).toContain('Tableau à 2 équipes');
    expect(summary(false, 'en')).toContain('2-fighter bracket');
  });
});
