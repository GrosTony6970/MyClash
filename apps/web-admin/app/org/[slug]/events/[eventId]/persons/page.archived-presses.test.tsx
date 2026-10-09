import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openArchivedPage, type, type OpenedPage } from '../archived-page.fixtures';
import PersonsPage from './page';

/**
 * The roster of an archived Event, with everything pressed (rulings 222b, 377).
 * The one save the server takes there is a row's own fields. A bulk Assign and
 * the waiting list's promote, removal and new order are refused: the page
 * offered all four.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/persons',
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

const person = (id: string, givenName: string) => ({
  id,
  givenName,
  familyName: 'Roux',
  email: null,
  hemaRatingsId: null,
  clubId: null,
  clubLabel: null,
  claimStatus: 'unclaimed',
  globalPersonId: `g${id}`,
  claimedByUserId: null,
});

const READS = {
  '/api/v1/events/ev1/persons': [person('p-1', 'Ana'), person('p-2', 'Bo')],
  '/api/v1/events/ev1/registrations': [
    {
      id: 'r-2',
      personId: 'p-2',
      tournamentId: 't-1',
      tournamentName: 'Longsword',
      status: 'waitlisted',
      seed: null,
      waitlistPosition: 1,
    },
  ],
  '/api/v1/events/ev1/tournaments': [
    { id: 't-1', name: 'Longsword', color: null },
    { id: 't-2', name: 'Sabre', color: null },
  ],
  '/api/v1/events/ev1/referees': [],
  '/api/v1/events/ev1/instructors': [],
};

/** The server takes a row's own fields on an archived Event (ruling 222b). */
const TAKEN = {
  'PATCH /api/v1/persons/p-1': person('p-1', 'Ana'),
  'PATCH /api/v1/persons/p-2': person('p-2', 'Bo'),
};
const ROW_EDITS = Object.keys(TAKEN);

const button = (label: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent === label);

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the roster of an archived Event, with everything pressed', () => {
  it('sends a row’s own fields and nothing else', async () => {
    page = await openArchivedPage(<PersonsPage />, READS, TAKEN);

    await page.pressEverything();

    // The row's own Save is driven in `page.archived.test.tsx`.
    const sent = [...new Set(page.writes())];
    expect(sent.filter((save) => !ROW_EDITS.includes(save))).toEqual([]);
  });

  it('offers no bulk Assign to a Tournament', async () => {
    page = await openArchivedPage(<PersonsPage />, READS, TAKEN);
    const rowBoxes = document.body.querySelectorAll<HTMLInputElement>('tbody input[type=checkbox]');
    await act(async () => rowBoxes.forEach((box) => box.click()));
    const pick = [...document.body.querySelectorAll('select')].find(
      (select) => select.options[0]?.textContent === 'Assign to tournament…',
    );
    await act(async () => type(pick!, 't-2'));

    expect(button('Assign')?.disabled).toBe(true);
  });

  it('offers no bulk Assign to another Tournament, from a Tournament’s own tab', async () => {
    page = await openArchivedPage(<PersonsPage />, READS, TAKEN);
    const tab = [...document.body.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Longsword'),
    );
    await act(async () => tab!.click());
    const rowBoxes = document.body.querySelectorAll<HTMLInputElement>('tbody input[type=checkbox]');
    expect(rowBoxes.length).toBeGreaterThan(0);
    await act(async () => rowBoxes.forEach((box) => box.click()));
    const pick = [...document.body.querySelectorAll('select')].find(
      (select) => select.options.length === 2 && select.options[1]?.value === 't-2',
    );
    await act(async () => type(pick!, 't-2'));

    expect(button('Assign')?.disabled).toBe(true);
  });

  it('offers no promote, no removal and no new order on the waiting list', async () => {
    page = await openArchivedPage(<PersonsPage />, READS, TAKEN);
    await act(async () => button('Waiting list')!.click());
    await page.settle();

    expect(button('Promote')?.disabled).toBe(true);
    expect(button('Remove')?.disabled).toBe(true);
    expect(document.body.querySelectorAll('[draggable="true"]')).toHaveLength(0);
  });
});
