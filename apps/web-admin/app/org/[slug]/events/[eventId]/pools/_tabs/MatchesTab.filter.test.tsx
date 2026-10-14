import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openEventPage, type OpenedPage } from '../../archived-page.fixtures';
import { MatchesTab } from './MatchesTab';

/**
 * O29 (ruled 2026-10-14): the bouts tab finds a bout by fighter, referee or club, accents
 * ignored, and can hide the completed and voided ones. Both stay in the address, with the
 * Tournament and the tab, so a refresh keeps them.
 */

// One router for every render, as Next gives.
const NAVIGATION = vi.hoisted(() => {
  const replaced: string[] = [];
  return {
    search: new URLSearchParams(),
    replaced,
    router: { replace: (to: string) => replaced.push(to), push: () => undefined },
  };
});
vi.mock('next/navigation', () => ({
  useRouter: () => NAVIGATION.router,
  useSearchParams: () => NAVIGATION.search,
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@/lib/supabase-browser', () => ({ useRealtimeWithFallback: () => undefined }));
vi.mock('./build-scoring-href', () => ({
  buildMatchScoringHref: () => '#scoring',
  STAFF_APP_PREFIX: '',
}));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));

const bout = (id: string, red: string, blue: string, status: string, referee?: string) => ({
  id,
  pool_id: 'pool-1',
  round_number: 1,
  red_registration_id: `reg-${red}`,
  blue_registration_id: `reg-${blue}`,
  red_name: red,
  red_club_abbrev: red === 'Hélène Martin' ? 'Lyon Escrime' : null,
  blue_name: blue,
  blue_club_abbrev: null,
  red_score: null,
  blue_score: null,
  winner_registration_id: null,
  status,
  lice_id: null,
  match_number_label: id,
  roundCode: `LSW-P1-${id}`,
  referees: referee ? [{ role: 'arbitre_declarant', refereeId: 'gp-r', refereeName: referee }] : [],
});

const READS = {
  '/api/v1/tournaments/t-1/pools-with-matches': [
    {
      poolId: 'pool-1',
      poolName: 'Pool A',
      matches: [
        bout('M1', 'Hélène Martin', 'Bo Lund', 'completed'),
        bout('M2', 'Cy Morel', 'Hélène Martin', 'scheduled'),
        bout('M3', 'Di Vidal', 'Bo Lund', 'voided'),
        bout('M4', 'Cy Morel', 'Di Vidal', 'running', 'Paul Durand'),
      ],
    },
  ],
  '/api/v1/tournaments/t-1': {},
  '/api/v1/events/ev1/lices': [],
  '/api/v1/events/ev1/referees': [],
  '/api/v1/tournaments/t-1/pool-match-role-config': { roles: [] },
};

const tab = (
  <MatchesTab
    tournamentId="t-1"
    poolPhaseId="phase-1"
    slug="org"
    eventId="ev1"
    isReadOnly={false}
  />
);

/** The round codes of the bouts the table shows. */
const rows = () =>
  [...document.body.querySelectorAll('tbody tr')]
    .map((row) => /LSW-P1-(M\d)/.exec(row.textContent ?? '')?.[1])
    .filter(Boolean);

let page: OpenedPage;
afterEach(() => {
  page.unmount();
  NAVIGATION.search = new URLSearchParams();
  NAVIGATION.replaced.length = 0;
});

describe('the filter of the bouts tab', () => {
  it('finds a fighter by her name without its accent', async () => {
    NAVIGATION.search = new URLSearchParams('q=helene');
    page = await openEventPage(tab, READS);
    expect(rows()).toEqual(['M1', 'M2']);
  });

  it('finds a referee, and a club', async () => {
    NAVIGATION.search = new URLSearchParams('q=durand');
    page = await openEventPage(tab, READS);
    expect(rows()).toEqual(['M4']);
    page.unmount();
    NAVIGATION.search = new URLSearchParams('q=lyon');
    page = await openEventPage(tab, READS);
    expect(rows()).toEqual(['M1']);
  });

  it('hides the completed and the voided bouts', async () => {
    NAVIGATION.search = new URLSearchParams('hide=done');
    page = await openEventPage(tab, READS);
    expect(rows()).toEqual(['M2', 'M4']);
    // The Pool's own count still counts every bout.
    expect(document.body.textContent).toContain('1 of 4 matches done');
  });

  it('says so when nothing of the Pool fits', async () => {
    NAVIGATION.search = new URLSearchParams('q=nobody');
    page = await openEventPage(tab, READS);
    expect(rows()).toEqual([]);
    expect(document.body.textContent).toContain('No match of this pool fits the filter.');
  });

  it('keeps every letter typed before the address has moved (slow wifi)', async () => {
    // This router never commits: the address stays where it was, as during a slow round trip.
    page = await openEventPage(tab, READS);
    const field = document.body.querySelector<HTMLInputElement>('input[type="search"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    for (const key of ['l', 'u', 'n', 'd']) {
      await act(async () => {
        // A key adds to what the box shows NOW, as a keyboard does.
        setValue.call(field, field.value + key);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    expect(field.value).toBe('lund');
    expect(NAVIGATION.replaced.at(-1)).toContain('q=lund');
    expect(rows()).toEqual(['M1', 'M3']);
  });

  it('writes the filter into the address, its Tournament and its tab kept', async () => {
    window.history.replaceState(null, '', '/org/org/events/ev1/pools?tournamentId=t-1#matches');
    page = await openEventPage(tab, READS);
    const field = document.body.querySelector<HTMLInputElement>('input[type="search"]')!;
    const hide = document.body.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setValue.call(field, 'lund');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => hide.click());
    // The second write keeps the search: it is not lost though the address has not moved yet.
    expect(NAVIGATION.replaced).toEqual([
      '/org/org/events/ev1/pools?tournamentId=t-1&q=lund#matches',
      '/org/org/events/ev1/pools?tournamentId=t-1&q=lund&hide=done#matches',
    ]);
  });
});
