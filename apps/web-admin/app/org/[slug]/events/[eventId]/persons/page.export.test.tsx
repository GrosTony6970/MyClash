import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openEventPage, type OpenedPage } from '../archived-page.fixtures';
import PersonsPage from './page';

/**
 * O19 (ruled 2026-10-14): the roster's filters live in the address, so a refresh keeps
 * them, and "Export CSV" writes exactly the rows on screen. Before, the filters were lost
 * on a refresh and the roster had no export at all.
 */
const NAVIGATION = vi.hoisted(() => ({
  search: new URLSearchParams(),
  router: { replace: () => undefined, push: () => undefined },
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => NAVIGATION.router,
  usePathname: () => '/org/club/events/ev1/persons',
  useSearchParams: () => NAVIGATION.search,
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

const person = (id: string, givenName: string, familyName: string, clubId: string | null) => ({
  id,
  givenName,
  familyName,
  email: `${givenName.toLowerCase()}@example.test`,
  hemaRatingsId: null,
  clubId,
  clubLabel: clubId ? 'Lyon Escrime' : null,
  claimStatus: 'unclaimed',
  globalPersonId: `g-${id}`,
  claimedByUserId: null,
});
const registration = (id: string, personId: string) => ({
  id,
  personId,
  tournamentId: 't-1',
  tournamentName: 'Longsword',
  status: 'registered',
  seed: null,
  waitlistPosition: null,
});

const READS = {
  '/api/v1/events/ev1': { id: 'ev1', name: 'Open 2026', status: 'running' },
  '/api/v1/events/ev1/persons': [
    person('p-1', 'Ana', 'Roux', 'c-lyon'),
    person('p-2', 'Ben', 'Morel', null),
    person('p-3', 'Ana', 'Vidal', null),
  ],
  '/api/v1/events/ev1/registrations': [
    registration('r-1', 'p-1'),
    registration('r-2', 'p-2'),
    registration('r-3', 'p-3'),
  ],
  '/api/v1/events/ev1/tournaments': [{ id: 't-1', name: 'Longsword', color: null }],
  '/api/v1/events/ev1/referees': [],
  '/api/v1/events/ev1/instructors': [],
};

/** The texts of the files the page handed to the browser to save. */
let saved: Blob[];
beforeEach(() => {
  saved = [];
  URL.createObjectURL = (blob: Blob | MediaSource) => {
    saved.push(blob as Blob);
    return 'blob:csv';
  };
  URL.revokeObjectURL = () => undefined;
  HTMLAnchorElement.prototype.click = () => undefined;
});

let page: OpenedPage;
afterEach(() => {
  page.unmount();
  NAVIGATION.search = new URLSearchParams();
});

async function exportCsv(): Promise<string> {
  const button = [...document.body.querySelectorAll('button')].find(
    (b) => b.textContent === 'Export CSV',
  );
  await act(async () => button!.click());
  expect(saved).toHaveLength(1);
  return saved[0]!.text();
}

describe('the roster’s filters and its export', () => {
  it('reads its name search and its club from the address, and exports what they leave', async () => {
    NAVIGATION.search = new URLSearchParams('q=ana&club=c-lyon');
    page = await openEventPage(<PersonsPage />, READS);
    expect(document.body.textContent).toContain('ROUX');
    expect(document.body.textContent).not.toContain('VIDAL');
    expect(document.body.textContent).not.toContain('MOREL');

    const csv = await exportCsv();

    expect(csv.split('\r\n').slice(0, 3)).toEqual([
      'Name,Club,Tournaments,Referee,Instructor',
      'ROUX Ana,Lyon Escrime,Longsword (Registered),No,No',
      '',
    ]);
  });

  it('closes Export over the waiting list, which is not the rows it writes', async () => {
    page = await openEventPage(<PersonsPage />, READS);
    const waitingList = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent === 'Waiting list',
    );
    await act(async () => waitingList!.click());
    const button = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent === 'Export CSV',
    );
    expect(button?.disabled).toBe(true);
  });

  it('exports every row on screen when no filter is set, and never an email', async () => {
    page = await openEventPage(<PersonsPage />, READS);
    const csv = await exportCsv();
    // The byte-order mark, which a spreadsheet needs to read "Hélène" (decoded text drops it).
    expect([...new Uint8Array(await saved[0]!.arrayBuffer()).slice(0, 3)]).toEqual([
      0xef, 0xbb, 0xbf,
    ]);
    expect(csv.trim().split('\r\n')).toHaveLength(4);
    expect(csv).not.toContain('@example.test');
  });
});
