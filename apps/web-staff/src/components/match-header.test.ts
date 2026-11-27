/**
 * The pad's header shows a team's colour chip beside its name (call 6): on the bout's own line and
 * on the tiles of the bouts before and after it. It is the one chip, `TeamChip`.
 *
 * Lyon Blades (green) fight Paris Rapiers (purple) on Piste 2. Before them, Marseille Sabres
 * (orange) fought Nice Dagues (teal); after them, Lille Lames (yellow) fight Metz Fers (amber). A
 * Fighters' bout shows no chip anywhere.
 *
 * web-staff has no React test setup: the header is drawn once on the server renderer, with the
 * page's context (router link, words, theme, the two buttons and the gear read) stood in.
 */
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { accentClassFor, type NextMatchInfo } from '@myclash/ui';
import { DEFAULT_SCORING_CONFIG } from '@myclash/types';
import { describe, expect, it, vi } from 'vitest';
import { MatchHeader } from './MatchHeader';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => createElement('a', { href, className }, children),
}));
vi.mock('@myclash/next-i18n/client', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../theme/ThemeProvider', () => ({
  useScoringTheme: () => ({ chromeScope: 'light', padScope: 'dark' }),
}));
vi.mock('../theme/ThemeSwitcher', () => ({ ThemeSwitcher: () => null }));
vi.mock('./CallButton', () => ({ CallButton: () => null }));
vi.mock('../lib/useMatchGear', () => ({ useMatchGear: () => null }));

const PREVIOUS: NextMatchInfo = {
  id: 'm0',
  matchNumberLabel: 'M0',
  roundCode: null,
  redName: 'Marseille Sabres',
  blueName: 'Nice Dagues',
  redColour: 'orange',
  blueColour: 'teal',
};
const NEXT: NextMatchInfo = {
  id: 'm2',
  matchNumberLabel: 'M2',
  roundCode: null,
  redName: 'Lille Lames',
  blueName: 'Metz Fers',
  redColour: 'yellow',
  blueColour: 'amber',
};
const COLOURS = ['green', 'purple', 'orange', 'teal', 'yellow', 'amber'];

type Bout = {
  redColour: string | null;
  blueColour: string | null;
  previous: NextMatchInfo;
  next: NextMatchInfo;
};

const TEAMS: Bout = { redColour: 'green', blueColour: 'purple', previous: PREVIOUS, next: NEXT };
const FIGHTERS: Bout = {
  redColour: null,
  blueColour: null,
  previous: { ...PREVIOUS, redColour: null, blueColour: undefined },
  next: { ...NEXT, redColour: null, blueColour: undefined },
};

const drawn = (bout: Bout) =>
  renderToStaticMarkup(
    createElement(MatchHeader, {
      matchId: 'm1',
      matchCode: 'M1',
      redName: 'Lyon Blades',
      blueName: 'Paris Rapiers',
      config: DEFAULT_SCORING_CONFIG,
      liceId: 'lice-2',
      onOpenCorrections: () => {},
      ...bout,
    }),
  );

/** `TeamChip`'s own shape: its wrapper, then the dot of a colour token. */
const chipOf = (colour: string) =>
  `<span class="inline-flex"><span aria-hidden="true" class="[^"]*${accentClassFor(colour)}"></span></span>`;

describe('MatchHeader', () => {
  it('shows each team’s chip beside its name on the bout’s own line', () => {
    const header = drawn(TEAMS);
    expect(header).toMatch(new RegExp(`${chipOf('green')} ?<span>Lyon Blades</span>`));
    expect(header).toMatch(new RegExp(`<span>Paris Rapiers</span>${chipOf('purple')}`));
  });

  it('shows each team’s chip before its name on the previous and next tiles', () => {
    const header = drawn(TEAMS);
    expect(header).toMatch(new RegExp(`${chipOf('orange')} Marseille Sabres`));
    expect(header).toMatch(new RegExp(`${chipOf('teal')} Nice Dagues`));
    expect(header).toMatch(new RegExp(`${chipOf('yellow')} Lille Lames`));
    expect(header).toMatch(new RegExp(`${chipOf('amber')} Metz Fers`));
  });

  it('shows no chip on a Fighters’ bout', () => {
    const header = drawn(FIGHTERS);
    for (const colour of COLOURS) expect(header).not.toContain(accentClassFor(colour));
    expect(header).not.toContain('<span class="inline-flex">');
  });
});
