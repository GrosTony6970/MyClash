import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openArchivedPage, type OpenedPage } from '../../archived-page.fixtures';
import CsvImportPage from './page';

/**
 * The roster import of an archived Event (ruling 377): the server refuses the
 * dry run, so a picked file is not sent. The import itself is offered only after
 * a dry run the server took.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/persons/import',
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

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the roster import of an archived Event', () => {
  it('sends no file for a dry run', async () => {
    page = await openArchivedPage(<CsvImportPage />, {});

    await page.pressEverything();

    expect(page.writes()).toEqual([]);
  });
});
