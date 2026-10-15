import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openEventPage, type OpenedPage } from '../archived-page.fixtures';
import OrganizerArchivePage from './page';

/**
 * The Archive page's four CSV downloads ask which file (operator, 2026-10-15): Excel in French,
 * `?csv=excel-fr`, or the others, `?csv=standard`. The file is the server's: a pick opens its
 * address, as the link it replaced did.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/archive',
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
  '/api/v1/events/ev1': { id: 'ev1', name: 'Open 2025', status: 'completed' },
  '/api/v1/events/ev1/tournaments': [{ id: 't-1', name: 'Longsword' }],
};

let page: OpenedPage;
let opened: string[];

beforeEach(() => {
  opened = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    opened.push(this.href);
  });
});

afterEach(() => {
  page?.unmount();
  vi.restoreAllMocks();
});

const buttonNamed = (start: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.startsWith(start));

async function pick(menu: string, file: string) {
  await act(async () => buttonNamed(menu)?.click());
  await act(async () => buttonNamed(file)?.click());
}

describe('the CSV downloads of the Archive page', () => {
  it('opens the French Excel file of a Tournament, or the standard one', async () => {
    page = await openEventPage(<OrganizerArchivePage />, READS);
    await pick('Matches CSV', 'Excel (French)');
    await pick('Rankings CSV', 'Excel (English)');
    await pick('Exchanges CSV', 'Excel (French)');
    expect(opened).toEqual([
      'http://api.test/api/v1/tournaments/t-1/exports/matches.csv?csv=excel-fr',
      'http://api.test/api/v1/tournaments/t-1/exports/rankings.csv?csv=standard',
      'http://api.test/api/v1/tournaments/t-1/exports/exchanges.csv?csv=excel-fr',
    ]);
  });

  it("opens the whole Event's file in the format picked", async () => {
    page = await openEventPage(<OrganizerArchivePage />, READS);
    await pick('Full event', 'Excel (French)');
    expect(opened).toEqual(['http://api.test/api/v1/events/ev1/exports/full.csv?csv=excel-fr']);
  });
});
