import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openEventPage, type OpenedPage } from '../archived-page.fixtures';
import PersonsPage from './page';

/**
 * A team Tournament takes no Registration (Team Tournaments, design decision 14): the Persons page
 * offers it nowhere, neither in the Add window's Tournaments nor as a roster tab.
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
  '/api/v1/events/ev1/persons': [],
  '/api/v1/events/ev1/registrations': [],
  '/api/v1/events/ev1/tournaments': [
    { id: 't1', name: 'Longsword', entrant_kind: 'individual' },
    { id: 'tt1', name: 'Team Sabre', entrant_kind: 'team' },
  ],
  '/api/v1/events/ev1/referees': [],
  '/api/v1/events/ev1/instructors': [],
};

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the Persons page beside a team Tournament', () => {
  it('offers only the individual Tournament to register into, and as a tab', async () => {
    page = await openEventPage(<PersonsPage />, READS);
    expect(document.body.textContent).toContain('Longsword');
    expect(document.body.textContent).not.toContain('Team Sabre');

    const add = document.body.querySelector<HTMLButtonElement>('[data-testid="persons-add"]')!;
    await act(async () => add.click());
    const boxes = [...document.body.querySelectorAll('[role="dialog"] label')]
      .filter((label) => label.querySelector('input[type="checkbox"]'))
      .map((label) => label.textContent?.trim());
    expect(boxes).toContain('Longsword');
    expect(boxes).not.toContain('Team Sabre');
  });
});
