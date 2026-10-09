import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openArchivedPage, type OpenedPage } from '../../archived-page.fixtures';
import { MatchesTab } from './MatchesTab';

/**
 * The bouts tab of the Pools page on an archived Event (ruling 377). A bout's
 * piste and referees, and the Pool strip that sets them for every bout, are
 * four saves the server refuses there. The tab offered all four.
 */
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@/lib/supabase-browser', () => ({ useRealtimeWithFallback: () => undefined }));
// A press on a status help reaches its row, which opens the scoring app. jsdom
// cannot leave the page, so the link is one that stays on it.
vi.mock('./build-scoring-href', () => ({
  buildMatchScoringHref: () => '#scoring',
  STAFF_APP_PREFIX: '',
}));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const MATCH = {
  id: 'm-1',
  pool_id: 'pool-1',
  round_number: 1,
  red_registration_id: 'reg-red',
  blue_registration_id: 'reg-blue',
  red_name: 'Ana',
  red_club_abbrev: null,
  blue_name: 'Ben',
  blue_club_abbrev: null,
  red_score: null,
  blue_score: null,
  winner_registration_id: null,
  status: 'scheduled',
  lice_id: null,
  match_number_label: 'L1-P1-M1',
  roundCode: 'LSW-P1-M1',
  referees: [],
};

const READS = {
  '/api/v1/tournaments/t-1/pools-with-matches': [
    { poolId: 'pool-1', poolName: 'Pool A', matches: [MATCH] },
  ],
  '/api/v1/tournaments/t-1': {},
  '/api/v1/events/ev1/lices': [{ id: 'L1', name: 'Piste 1' }],
  '/api/v1/events/ev1/referees': [
    {
      personId: 'gp-lea',
      displayName: 'Léa',
      clubLabel: null,
      qualifications: [{ skillId: 'arbitre_declarant', rating: null }],
    },
  ],
  '/api/v1/tournaments/t-1/pool-match-role-config': {
    roles: [{ id: 'arbitre_declarant', displayName: 'Déclarant' }],
  },
};

/** The tab's four saves: the Pool strip's piste and referee, then a bout's. */
const SAVES = [
  'PATCH /api/v1/matches/m-1',
  'PUT /api/v1/matches/m-1/referee-role-assignments',
  'PUT /api/v1/pools/pool-1/lice',
  'PUT /api/v1/pools/pool-1/referee-role-assignments',
];

const tab = (isReadOnly: boolean) => (
  <MatchesTab
    tournamentId="t-1"
    poolPhaseId="phase-1"
    slug="org"
    eventId="ev1"
    isReadOnly={isReadOnly}
  />
);
const selects = () => [...document.body.querySelectorAll('select')];

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the bouts tab of the Pools page', () => {
  it('on an archived Event, sets no piste and no referee', async () => {
    page = await openArchivedPage(tab(true), READS);
    // Drawn, each with something to pick: the strip's two and the bout's two.
    expect(selects().map((s) => s.options.length)).toEqual([2, 2, 2, 2]);

    await page.pressEverything();

    expect(page.writes()).toEqual([]);
    expect(selects().map((s) => s.disabled)).toEqual([true, true, true, true]);
  });

  // The contrast: the same presses on a tab not told so DO send the four saves.
  it('on an Event that is not read-only, the same presses send all four', async () => {
    page = await openArchivedPage(tab(false), READS);

    await page.pressEverything(1);

    expect([...new Set(page.writes())].sort()).toEqual(SAVES);
  });
});
