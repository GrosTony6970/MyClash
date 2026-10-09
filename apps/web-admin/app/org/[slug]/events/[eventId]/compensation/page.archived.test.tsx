import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openArchivedPage, type OpenedPage } from '../archived-page.fixtures';
import CompensationPage from './page';

/**
 * The compensation page of an archived Event (ruling 377): the plan of the
 * Event and a referee's "paid" mark are not saved there. The report stays.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/compensation',
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

const SETTINGS = {
  planId: 'plan-1',
  planName: 'Club rates',
  maxCompensationAmount: null,
  minCompensationAmount: null,
};

const READS = {
  '/api/v1/compensation-plans': [
    { id: 'plan-1', name: 'Club rates' },
    { id: 'plan-2', name: 'League rates' },
  ],
  '/api/v1/events/ev1/compensation/settings': SETTINGS,
  '/api/v1/events/ev1/referee-skills': [],
  '/api/v1/events/ev1/compensation/report': {
    planId: 'plan-1',
    planName: 'Club rates',
    maxCap: null,
    minFloor: null,
    grandTotal: 12,
    referees: [
      {
        personId: 'gp-1',
        displayName: 'Ana Roux',
        totalTokens: 4,
        amountOwed: 12,
        paid: false,
        paidAt: null,
        breakdown: [],
      },
    ],
  },
};

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the compensation page of an archived Event', () => {
  it('shows the report and saves neither the plan nor a paid mark', async () => {
    page = await openArchivedPage(<CompensationPage />, READS);
    expect(document.body.textContent).toContain('Ana Roux');

    await page.pressEverything();

    expect(page.writes()).toEqual([]);
  });
});
