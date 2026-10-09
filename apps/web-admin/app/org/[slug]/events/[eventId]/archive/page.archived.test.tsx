import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

/** Reads the archive, types the confirmation sentence, presses everything. */
async function previewConfirmAndPress(page: OpenedPage) {
  await page.pressEverything(1);
  const sentence = document.body.querySelector<HTMLInputElement>(
    'input[placeholder="RESTORE MYCLASH ARCHIVE"]',
  );
  expect(sentence, 'the preview did not open').not.toBeNull();
  await act(async () => type(sentence!, 'RESTORE MYCLASH ARCHIVE'));
  await page.pressEverything(1);
}

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

  it('still restores a whole Event, as a new one', async () => {
    page = await openArchivedPage(<OrganizerArchivePage />, READS, previewOf('event'));

    await previewConfirmAndPress(page);

    expect(restores(page)).toEqual([
      'POST /api/v1/archive/restore?confirmation=RESTORE+MYCLASH+ARCHIVE&targetOrganizationId=org-1',
    ]);
  });
});
