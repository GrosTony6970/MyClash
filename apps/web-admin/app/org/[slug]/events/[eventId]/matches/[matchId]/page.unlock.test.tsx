import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openEventPage, type OpenedPage } from '../../archived-page.fixtures';
import { BOUT, boutReads } from './page.fixtures';
import MatchDetailPage from './page';

/**
 * The bout page's lock button (ruling 378). The API hands the bout's row with
 * `locked_at`, and it has no route that locks a bout by hand: the auto-lock sets
 * it. The page read `lockedAt`, which no answer carries, so it offered "Lock
 * match" on every bout and sent it to a route that does not exist. A locked
 * bout could not be unlocked from here.
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
const lockSaves = (page: OpenedPage) =>
  [...new Set(page.writes())].filter((save) => /\/(un)?lock$/.test(save));

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the lock button of the bout page', () => {
  it('unlocks a locked bout', async () => {
    page = await openEventPage(<MatchDetailPage />, {
      ...RUNNING_EVENT,
      ...boutReads(BOUT, null),
    });
    expect(document.body.textContent).toContain('Locked for staff scoring');

    await page.pressEverything();

    expect(lockSaves(page)).toEqual(['POST /api/v1/matches/m1/unlock']);
  });

  it('offers nothing on a bout that is not locked', async () => {
    page = await openEventPage(<MatchDetailPage />, {
      ...RUNNING_EVENT,
      ...boutReads({ ...BOUT, locked_at: null }, null),
    });

    await page.pressEverything();

    expect(lockSaves(page)).toEqual([]);
    expect(document.body.textContent).not.toContain('Unlock match');
  });
});
