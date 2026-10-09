import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openArchivedPage, openEventPage, type OpenedPage } from '../archived-page.fixtures';
import EventStaffPage from './page';

/**
 * The staff page of an Event (rulings 377, 378). On an archived Event no
 * account is made, switched off, moved, given a PIN or a piste: the server
 * refuses all five. And a switch the server refuses says why: it used to snap
 * back with no word.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/staff',
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

const event = (status: string) => ({ id: 'ev1', slug: 'open-2025', name: 'Open 2025', status });
const READS = {
  '/api/v1/events/ev1/staff-accounts': [
    {
      id: 'acc-1',
      display_name: 'Léa',
      username: 'lea',
      status: 'active',
      role: 'scoring',
      liceIds: [],
    },
  ],
  '/api/v1/events/ev1/lices': [{ id: 'L1', name: 'Piste 1' }],
};

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the staff page of an archived Event', () => {
  it('makes no account and changes none', async () => {
    page = await openArchivedPage(<EventStaffPage />, {
      '/api/v1/events/ev1': event('archived'),
      ...READS,
    });
    expect(document.body.textContent).toContain('Léa');

    await page.pressEverything();

    expect(page.writes()).toEqual([]);
  });
});

describe('a switch the server refuses', () => {
  it('says the server’s reason', async () => {
    // The Event archived itself while the page was open: the page still reads "running".
    page = await openEventPage(<EventStaffPage />, {
      '/api/v1/events/ev1': event('running'),
      ...READS,
    });
    const disable = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent === 'Disable',
    );

    await act(async () => disable!.click());
    await page.settle();

    expect(page.writes()).toEqual(['PATCH /api/v1/events/ev1/staff-accounts/acc-1']);
    expect(document.body.textContent).toContain('This event is archived');
  });
});
