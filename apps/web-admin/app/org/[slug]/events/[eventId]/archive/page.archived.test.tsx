import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@myclash/api-client';
import type * as ApiClient from '@myclash/api-client';
import { openArchivedPage, type, type OpenedPage } from '../archived-page.fixtures';
import OrganizerArchivePage from './page';

/**
 * The archive page of an archived Event (ruling 377). A restore of a whole
 * Event makes a NEW Event in the club, so it stays open. A restore of one
 * Tournament writes into THIS Event, and the server refuses it on an archived
 * one: that restore is not offered.
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
  '/api/v1/events/ev1': {
    id: 'ev1',
    name: 'Open 2025',
    status: 'archived',
    organization_id: 'org-1',
  },
  '/api/v1/events/ev1/tournaments': [{ id: 't-1', name: 'Longsword' }],
};

const previewOf = (scope: 'event' | 'tournament') => ({
  'POST /api/v1/archive/restore-preview': {
    scope,
    include: 'scoring',
    source: { eventName: 'Open 2024', tournamentName: 'Sabre' },
    counts: {},
    warnings: [],
    canRestore: true,
  },
});

/**
 * Reads the archive, types the confirmation sentence, presses Restore. Not a second
 * round of pressing everything: that picks the file again, and another file clears its
 * preview (quick win O23).
 */
async function previewConfirmAndPress(page: OpenedPage) {
  await page.pressEverything(1);
  const sentence = document.body.querySelector<HTMLInputElement>(
    'input[placeholder="RESTORE MYCLASH ARCHIVE"]',
  );
  expect(sentence, 'the preview did not open').not.toBeNull();
  await act(async () => type(sentence!, 'RESTORE MYCLASH ARCHIVE'));
  await act(async () => restoreButton()?.click());
  await page.settle();
}

const restoreButton = () =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Restore copy');
const fileField = () => document.body.querySelector<HTMLInputElement>('input[type="file"]')!;
/** Picks a file the way the browser does: its `files`, then a change event. */
async function pick(name: string) {
  const file = new File(['x'], name, { type: 'application/zip' });
  Object.defineProperty(fileField(), 'files', { value: [file], configurable: true });
  await act(async () => fileField().dispatchEvent(new Event('change', { bubbles: true })));
}
const press = async (page: OpenedPage, label: string) => {
  const button = [...document.body.querySelectorAll('button')].find((b) => b.textContent === label);
  await act(async () => button?.click());
  await page.settle();
};

const restores = (page: OpenedPage) =>
  page.writes().filter((save) => save.startsWith('POST /api/v1/archive/restore?'));

let page: OpenedPage;
afterEach(() => page.unmount());

describe('the archive page of an archived Event', () => {
  it('does not restore one Tournament into the Event', async () => {
    page = await openArchivedPage(<OrganizerArchivePage />, READS, previewOf('tournament'));

    await previewConfirmAndPress(page);

    expect(restores(page)).toEqual([]);
  });

  it('forgets the preview of file A when file B is picked: B is never restored unseen (O23)', async () => {
    page = await openArchivedPage(<OrganizerArchivePage />, READS, previewOf('event'));
    await pick('open-2025.zip');
    await press(page, 'Preview restore');
    expect(restoreButton(), 'the preview of A did not open').toBeDefined();
    await pick('open-2024.zip');
    expect(restoreButton()).toBeUndefined();
    expect(document.body.textContent).not.toContain('Open 2024');
  });

  it('forgets the old preview when the preview of the new file is refused (O23)', async () => {
    page = await openArchivedPage(<OrganizerArchivePage />, READS, previewOf('event'));
    await pick('open-2025.zip');
    await press(page, 'Preview restore');
    expect(restoreButton()).toBeDefined();
    // The server cannot read the next file.
    vi.mocked(apiRequest).mockResolvedValueOnce({
      ok: false,
      kind: 'http',
      status: 400,
      detail: 'Unknown archive version',
      validationErrors: null,
      code: null,
      details: null,
    } as never);
    await press(page, 'Preview restore');
    expect(document.body.textContent).toContain('Unknown archive version');
    expect(restoreButton()).toBeUndefined();
  });

  it('takes the phrase in small letters and with stray spaces, and sends it exact', async () => {
    page = await openArchivedPage(<OrganizerArchivePage />, READS, previewOf('event'));
    await pick('open-2025.zip');
    await press(page, 'Preview restore');
    const sentence = document.body.querySelector<HTMLInputElement>(
      'input[placeholder="RESTORE MYCLASH ARCHIVE"]',
    )!;
    await act(async () => type(sentence, '  restore  myclash archive '));
    expect(restoreButton()?.disabled).toBe(false);
    await act(async () => restoreButton()?.click());
    await page.settle();
    expect(restores(page)).toEqual([
      'POST /api/v1/archive/restore?confirmation=RESTORE+MYCLASH+ARCHIVE&targetOrganizationId=org-1',
    ]);
  });

  it('still restores a whole Event, as a new one', async () => {
    page = await openArchivedPage(<OrganizerArchivePage />, READS, previewOf('event'));

    await previewConfirmAndPress(page);

    expect(restores(page)).toEqual([
      'POST /api/v1/archive/restore?confirmation=RESTORE+MYCLASH+ARCHIVE&targetOrganizationId=org-1',
    ]);
  });
});
