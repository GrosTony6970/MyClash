/**
 * The piste page's bout card shows a team's colour chip beside its name (call 6: name and chip,
 * no logo, on a tight list).
 *
 * Lyon Blades (green) fight Paris Rapiers (purple) next on Piste 2. The scorekeeper's list of
 * bouts shows each team's chip; a Fighters' bout shows none.
 *
 * web-staff has no React test setup: the card is drawn once on the server renderer, with the
 * page's context (router link, words, theme) stood in.
 */
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { accentClassFor } from '@myclash/ui';
import { describe, expect, it, vi } from 'vitest';
import { LiceMatchCard } from '../../app/lices/[liceId]/_components/LiceMatchCard';
import type { LiceMatch } from './lice-match-types';

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

const BOUT: LiceMatch = {
  id: 'm1',
  status: 'scheduled',
  poolId: 'pool-1',
  scheduledAt: null,
  matchNumberLabel: 'M1',
  roundCode: 'L1-P1-M1',
  redFighterName: 'Lyon Blades',
  blueFighterName: 'Paris Rapiers',
  redColour: 'green',
  blueColour: 'purple',
  redScore: 0,
  blueScore: 0,
  tournamentId: 't1',
  tournamentName: 'Team Longsword',
  weapon: 'longsword',
  phaseType: 'pool',
  scoringConfig: null,
  referees: [],
};

const drawn = (match: LiceMatch) => renderToStaticMarkup(createElement(LiceMatchCard, { match }));

/** The chip of a colour token: its fill class, then the name the chip sits before. */
const chipBefore = (colour: string, name: string) =>
  new RegExp(`${accentClassFor(colour)}[^>]*></span>${name}`);

describe('LiceMatchCard', () => {
  it('shows each team’s colour chip beside its name', () => {
    const card = drawn(BOUT);
    expect(card).toMatch(chipBefore('green', 'Lyon Blades'));
    expect(card).toMatch(chipBefore('purple', 'Paris Rapiers'));
  });

  it('shows no chip on a Fighters’ bout', () => {
    const card = drawn({ ...BOUT, redColour: null, blueColour: null });
    expect(card).not.toContain(accentClassFor('green'));
    expect(card).not.toContain(accentClassFor('purple'));
  });
});
