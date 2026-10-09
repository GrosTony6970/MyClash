import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openArchivedPage, type OpenedPage } from '../../archived-page.fixtures';
import { BOUT, FORFEIT_RECORD, boutReads } from './page.fixtures';
import MatchDetailPage from './page';

/**
 * The bout page of an archived Event (rulings 222a, 377). A correction is still
 * taken there, as on a completed Event: a hit is voided or restored, a forfeit
 * record is voided. The bout is not unlocked, not reopened, and no new forfeit
 * is recorded: the server refuses those three.
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

const sentOnce = (page: OpenedPage) => [...new Set(page.writes())].sort();

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the bout page of an archived Event', () => {
  it('voids and restores a hit, and sends nothing the server refuses', async () => {
    page = await openArchivedPage(<MatchDetailPage />, boutReads(BOUT, null));

    await page.pressEverything();

    expect(sentOnce(page)).toEqual([
      'PATCH /api/v1/exchanges/ex-1/void',
      'PATCH /api/v1/exchanges/ex-2/revert-void',
    ]);
  });

  it('voids a forfeit record', async () => {
    page = await openArchivedPage(<MatchDetailPage />, boutReads(BOUT, FORFEIT_RECORD));

    await page.pressEverything();

    expect(sentOnce(page)).toContain('PATCH /api/v1/match-forfeits/f-1/void');
    expect(sentOnce(page).filter((save) => save.startsWith('POST'))).toEqual([]);
  });
});
