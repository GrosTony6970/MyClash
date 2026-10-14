import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { EVENT_ID, FAILED_READ, openEventPage, type OpenedPage } from '../archived-page.fixtures';
import PenaltyReviewsPage from './page';

/**
 * A Tournament whose penalty reviews could not be read counted as one with no review
 * (quick win O10): a pending disqualification was missed on a network blip. Each failed
 * read is now named, and the lists that did land are still shown.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/club/events/ev1/penalties',
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

const review = (id: string, tournamentId: string, registrationId: string) => ({
  id,
  tournament_id: tournamentId,
  registration_id: registrationId,
  review_type: 'second_black_card',
  status: 'pending',
  black_card_count: 2,
  created_at: '2026-10-14T09:00:00Z',
  reviewed_at: null,
});
const READS = {
  [`/api/v1/events/${EVENT_ID}`]: { id: EVENT_ID, name: 'Open 2026', status: 'running' },
  [`/api/v1/events/${EVENT_ID}/tournaments`]: [
    { id: 't-1', name: 'Longsword' },
    { id: 't-2', name: 'Sabre' },
  ],
  [`/api/v1/events/${EVENT_ID}/registrations`]: [
    { id: 'r-1', personId: 'p-1', tournamentId: 't-1' },
  ],
  [`/api/v1/events/${EVENT_ID}/persons`]: [{ id: 'p-1', givenName: 'Ana', familyName: 'Roux' }],
  '/api/v1/tournaments/t-1/penalty-reviews': [review('rv-1', 't-1', 'r-1')],
  '/api/v1/tournaments/t-2/penalty-reviews': [],
};

let page: OpenedPage;
afterEach(() => page.unmount());

const alerts = () =>
  [...document.body.querySelectorAll('[role="alert"]')].map((a) => a.textContent);
const pendingNames = () =>
  [...document.body.querySelectorAll('li p.font-semibold')].map((p) => p.textContent);

describe('the penalty reviews read', () => {
  it('names the Tournament whose reviews could not be read, and shows the others', async () => {
    page = await openEventPage(<PenaltyReviewsPage />, {
      ...READS,
      '/api/v1/tournaments/t-2/penalty-reviews': FAILED_READ,
    });
    expect(alerts()).toEqual([
      'Could not read the reviews of Sabre: a review of it may be missing below.',
    ]);
    expect(pendingNames()).toEqual(['Ana Roux']);
  });

  it('says when the names could not be read, instead of an unexplained "Unknown fighter"', async () => {
    page = await openEventPage(<PenaltyReviewsPage />, {
      ...READS,
      [`/api/v1/events/${EVENT_ID}/persons`]: FAILED_READ,
    });
    expect(alerts()).toEqual([
      'Could not read the fighters\' names: they show as "Unknown fighter".',
    ]);
    expect(pendingNames()).toEqual(['Unknown fighter']);
  });

  it('says nothing when every read lands', async () => {
    page = await openEventPage(<PenaltyReviewsPage />, READS);
    expect(alerts()).toEqual([]);
  });

  it('clears the alert once a read lands again', async () => {
    page = await openEventPage(
      <PenaltyReviewsPage />,
      { ...READS, '/api/v1/tournaments/t-2/penalty-reviews': FAILED_READ },
      { 'PATCH /api/v1/tournament-penalty-reviews/rv-1': {} },
    );
    expect(alerts()).toHaveLength(1);
    // The network is back: the Sabre list now lands.
    const served = vi.mocked(apiRequest).getMockImplementation()!;
    vi.mocked(apiRequest).mockImplementation(async (base, path, init) =>
      path === '/api/v1/tournaments/t-2/penalty-reviews'
        ? ({ ok: true, data: [] } as never)
        : served(base, path, init),
    );
    const dismiss = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent === 'Dismiss',
    )!;
    await act(async () => dismiss.click());
    await page.settle();
    expect(alerts()).toEqual([]);
  });
});
