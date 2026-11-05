import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openArchivedPage, type OpenedPage } from '../archived-page.fixtures';
import EventPhotosPage from './page';
import { photoReads } from './photos-page.fixtures';

/**
 * The Photos page of an archived Event (ruling 377): approve, the mode and New link are refused
 * by the server, so the page offers none of them. Delete stays open: a person in a photo may ask
 * for it to go after the Event (design, "Constraints").
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'club', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/club/events/ev1/photos',
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

describe('the Photos page of an archived Event', () => {
  it('sends deletes, and nothing else', async () => {
    const deletes = {
      'DELETE /api/v1/events/ev1/photos/p1': null,
      'DELETE /api/v1/events/ev1/photos/p2': null,
    };
    // Print poster opens a window: jsdom has none to give, so the page says it was blocked.
    vi.stubGlobal('open', () => null);
    page = await openArchivedPage(<EventPhotosPage />, photoReads(), deletes);

    await page.pressEverything();

    const sent = page.writes();
    expect(new Set(sent)).toEqual(new Set(Object.keys(deletes)));
  });
});
