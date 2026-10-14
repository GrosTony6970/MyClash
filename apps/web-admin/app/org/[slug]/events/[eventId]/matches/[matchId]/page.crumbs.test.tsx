import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openEventPage, type OpenedPage } from '../../archived-page.fixtures';
import { BOUT, boutReads } from './page.fixtures';
import MatchDetailPage from './page';

/**
 * O28: the bout page was a dead end. The summary it reads names the bout's Tournament and
 * phase; a crumb now leads back to that phase's page, on that Tournament, on its tab.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1', matchId: 'm1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/matches/m1',
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

const RUNNING_EVENT = { '/api/v1/events/ev1': { id: 'ev1', name: 'Open 2025', status: 'running' } };

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the crumbs of a bout page', () => {
  it('lead back to the bouts of its Pool phase, on its Tournament', async () => {
    page = await openEventPage(<MatchDetailPage />, {
      ...RUNNING_EVENT,
      ...boutReads(BOUT, null),
    });
    const back = [...document.body.querySelectorAll('a')].find(
      (a) => a.textContent === 'Pools · Longsword',
    );
    expect(back?.getAttribute('href')).toBe('/org/org/events/ev1/pools?tournamentId=t-1#matches');
  });
});
