import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openArchivedPage, type OpenedPage } from '../archived-page.fixtures';
import EventNotificationsPage from './page';

/**
 * The broadcast page of an archived Event (ruling 377): the server refuses a
 * broadcast there, so the page offers no Send.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/notifications',
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

const READS = {
  '/api/v1/events/ev1/persons': [
    { id: 'p-1', givenName: 'Ana', familyName: 'Roux', email: 'ana@example.org', clubLabel: null },
  ],
  '/api/v1/events/ev1/notifications/broadcasts': [],
};

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the broadcast page of an archived Event', () => {
  it('sends no broadcast, whatever is typed and pressed', async () => {
    page = await openArchivedPage(<EventNotificationsPage />, READS);

    await page.pressEverything();

    expect(page.writes()).toEqual([]);
  });
});
