import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { EVENT_ID, EVENTS_READ, openEventPage, type OpenedPage } from '../archived-page.fixtures';
import TournamentsPage from './page';

/**
 * The Tournaments list and team Tournaments (Team Tournaments, 1b-1): a team one wears a "Team"
 * badge, and a delete reads the club's Event list again, which the menu's Teams entry follows.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/club/events/ev1/tournaments',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));
vi.mock('./_components/AttachToLeaguePanel', () => ({ AttachToLeaguePanel: () => null }));

let page: OpenedPage;
afterEach(() => page.unmount());

const READS = {
  [`/api/v1/events/${EVENT_ID}`]: { id: EVENT_ID, name: 'Open 2026', status: 'running' },
  [`/api/v1/events/${EVENT_ID}/tournaments`]: [
    { id: 't-1', slug: 'longsword', name: 'Longsword', status: 'draft' },
    { id: 't-2', slug: 'team', name: 'Team Longsword', status: 'draft', entrant_kind: 'team' },
  ],
};

/** How many times the page read the club's Event list. */
const eventListReads = () =>
  vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith(EVENTS_READ)).length;

async function press(label: string, within: ParentNode = document.body) {
  const button = [...within.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!button) throw new Error(`no button "${label}"`);
  await act(async () => button.click());
  await page.settle();
}

describe('the Tournaments list', () => {
  it('badges a team Tournament "Team", and only it', async () => {
    page = await openEventPage(<TournamentsPage />, READS);
    const badged = [...document.body.querySelectorAll('[data-testid="team-badge"]')].map(
      (badge) => [badge.closest('tr')?.querySelector('td')?.textContent, badge.textContent],
    );
    expect(badged).toEqual([['Team LongswordTeam', 'Team']]);
  });

  it('reads the Event list again after a delete, so the menu drops a Teams entry gone', async () => {
    page = await openEventPage(<TournamentsPage />, READS, {
      'DELETE /api/v1/tournaments/t-2': {},
    });
    const before = eventListReads();
    const row = [...document.body.querySelectorAll('tr')].find((tr) =>
      tr.textContent?.includes('Team Longsword'),
    )!;
    await press('Delete', row);
    await press('Delete permanently', document.body.querySelector('[role="dialog"]')!);
    expect(page.writes()).toEqual(['DELETE /api/v1/tournaments/t-2']);
    expect(eventListReads()).toBe(before + 1);
  });
});
