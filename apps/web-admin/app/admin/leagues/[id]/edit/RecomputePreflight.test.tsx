import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import {
  openEventPage,
  type OpenedPage,
} from '../../../../org/[slug]/events/[eventId]/archived-page.fixtures';
import { RecomputePreflight } from './RecomputePreflight';

/**
 * The recompute check listed each fighter with no name as "Unknown fighter": two of them in
 * one Tournament read the same, and the organiser could not tell whom to fix. The bib says.
 */
vi.mock('@/lib/api-url', () => ({ getPublicApiUrl: () => 'http://api.test' }));
vi.mock('@myclash/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiRequest: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({}),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/admin/leagues/L1/edit',
  useSearchParams: () => new URLSearchParams(),
}));

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the recompute check', () => {
  it('names a fighter nobody named by the bib, when there is one', async () => {
    const blocking = [
      {
        tournamentName: 'Longsword',
        fighters: [
          { name: 'Ana Roux', bib: 3 },
          { name: '', bib: 12 },
          { name: ' ', bib: null },
        ],
      },
    ];
    page = await openEventPage(<RecomputePreflight leagueId="L1" refreshToken={0} />, {
      '/api/v1/admin/leagues/L1/recompute-preflight': { blocking, unstableIdentities: [] },
    });
    expect(document.body.textContent).toContain(
      'Longsword Ana Roux, Unknown fighter (bib 12), Unknown fighter',
    );
  });
});
