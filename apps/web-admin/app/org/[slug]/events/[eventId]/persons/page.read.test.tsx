import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { FAILED_READ, openEventPage, type OpenedPage } from '../archived-page.fixtures';
import PersonsPage from './page';

/**
 * A roster the server failed to read said so only inside the Add window: the page looked
 * like an Event with nobody registered, and the reason showed when the organiser opened
 * Add, as if her new participant had been refused.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/club/events/ev1/persons',
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
  '/api/v1/events/ev1': { id: 'ev1', name: 'Open 2026', status: 'running' },
  '/api/v1/events/ev1/persons': FAILED_READ,
  '/api/v1/events/ev1/registrations': [],
  '/api/v1/events/ev1/tournaments': [],
  '/api/v1/events/ev1/referees': [],
  '/api/v1/events/ev1/instructors': [],
};

const alerts = () =>
  [...document.body.querySelectorAll('[role="alert"]')].map((alert) => alert.textContent);

let page: OpenedPage;
afterEach(() => page.unmount());

describe('a roster the server failed to read', () => {
  it('says so on the page, with no window opened', async () => {
    page = await openEventPage(<PersonsPage />, READS);
    expect(alerts()).toContain('Could not load the roster.');
  });

  it('leaves the Add window clean', async () => {
    page = await openEventPage(<PersonsPage />, READS);
    const add = document.body.querySelector<HTMLButtonElement>('[data-testid="persons-add"]')!;
    await act(async () => add.click());
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).not.toContain('Could not load the roster.');
  });
});
