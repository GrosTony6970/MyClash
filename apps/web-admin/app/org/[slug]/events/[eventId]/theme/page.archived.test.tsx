import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import { openArchivedPage, type OpenedPage } from '../archived-page.fixtures';
import BrandingEditorPage from './page';

/**
 * The branding page of an archived Event (ruling 377): a picked file is an
 * upload at once, with no Save between, so the picker itself is closed.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'org', eventId: 'ev1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/org/org/events/ev1/theme',
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
  '/api/v1/events/ev1/theme': { logoUrl: null, heroImageUrl: null },
};

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the branding page of an archived Event', () => {
  it('uploads neither a logo nor a hero image', async () => {
    page = await openArchivedPage(<BrandingEditorPage />, READS);

    // Each of the page's four buttons opens a file picker, and a picked file is an upload.
    const pickers = [...document.body.querySelectorAll('main button')];
    expect(pickers).toHaveLength(4);
    expect(pickers.filter((picker) => picker.matches(':disabled'))).toHaveLength(4);

    await page.pressEverything();

    expect(page.writes()).toEqual([]);
  });
});
