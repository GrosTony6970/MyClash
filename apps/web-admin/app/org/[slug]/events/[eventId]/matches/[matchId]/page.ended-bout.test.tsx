import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { FORFEIT_REASONS, OVERRIDE_REASONS } from '@myclash/rulesets';
import { openEventPage, type OpenedPage } from '../../archived-page.fixtures';
import { BOUT, boutReads } from './page.fixtures';
import MatchDetailPage from './page';

/**
 * A finished bout takes an override but no forfeit: the API refuses a forfeit
 * reason on a completed bout ("Match is already closed",
 * match-forfeits.service.ts). The page offered the forfeit reasons anyway,
 * under "Record forfeit", so the shortest path ended in an error.
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
const reasonsOffered = () =>
  [...document.querySelectorAll('select option')]
    .map((option) => (option as HTMLOptionElement).value)
    .filter((value) => value !== 'red' && value !== 'blue');

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the result panel of the bout page', () => {
  it('offers only an override on a finished bout', async () => {
    page = await openEventPage(<MatchDetailPage />, { ...RUNNING_EVENT, ...boutReads(BOUT, null) });

    expect(reasonsOffered()).toEqual([...OVERRIDE_REASONS]);
    expect(document.body.textContent).not.toContain('Record forfeit');
  });

  it('still offers the forfeits on a bout being fought', async () => {
    page = await openEventPage(<MatchDetailPage />, {
      ...RUNNING_EVENT,
      ...boutReads({ ...BOUT, status: 'paused', locked_at: null }, null),
    });

    expect(reasonsOffered()).toEqual([...FORFEIT_REASONS, ...OVERRIDE_REASONS]);
  });
});
