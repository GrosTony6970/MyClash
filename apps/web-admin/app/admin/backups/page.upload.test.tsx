import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import * as ApiClientModule from '@myclash/api-client';
import {
  openEventPage,
  type OpenedPage,
} from '../../org/[slug]/events/[eventId]/archived-page.fixtures';
import AdminBackupsPage from './page';

/**
 * The backups screen uploads a file in chunks (rulings 212, 216, 219): the bar, Cancel, and its
 * refusals in the reader's language.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({}),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => '/admin/backups',
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

import {
  GIB,
  READS,
  SESSION,
  UPLOADS,
  buttonIn,
  makePress,
  pick,
  rows,
  text,
  uploaded,
} from './backups-page.fixtures';

let page: OpenedPage;
afterEach(() => page.unmount());
const press = makePress(() => page);

describe('the backups screen and an uploaded night', () => {
  it('uploads in chunks and puts a second upload of a night in place of its row (213)', async () => {
    const night = uploaded('20261029T030000Z', ['db', 'storage']);
    page = await openEventPage(<AdminBackupsPage />, READS, {
      [`POST ${UPLOADS}`]: SESSION,
      [`PUT ${UPLOADS}/u1/chunks?offset=0`]: { receivedBytes: 1 },
      [`POST ${UPLOADS}/u1/complete`]: {
        ...SESSION,
        receivedBytes: 1,
        state: 'staged',
        backup: night,
      },
    });
    await pick(new File(['x'], 'storage-20261029T030000Z.tar.gz'));
    await press('Stage upload');
    await page.settle();
    expect(page.writes()).toEqual([
      `POST ${UPLOADS}`,
      `PUT ${UPLOADS}/u1/chunks?offset=0`,
      `POST ${UPLOADS}/u1/complete`,
    ]);
    expect(rows()).toHaveLength(3);
    expect(text()).toContain('Backup upload staged.');
  });

  it('shows the bar while it sends, and Cancel removes what the server received', async () => {
    page = await openEventPage(<AdminBackupsPage />, READS, {
      [`POST ${UPLOADS}`]: SESSION,
      [`DELETE ${UPLOADS}/u1`]: { cancelled: true, uploadId: 'u1' },
    });
    const stand = vi.mocked(ApiClientModule.apiRequest).getMockImplementation()!;
    vi.mocked(ApiClientModule.apiRequest).mockImplementation(async (base, path, init) =>
      init?.method === 'PUT' ? new Promise(() => undefined) : stand(base, path, init),
    );
    await pick(new File(['x'], 'storage-20261029T030000Z.tar.gz'));
    await press('Stage upload');
    expect(document.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(text()).toContain('0 B of 1 B sent (0 %)');
    await press('Cancel upload');
    expect(page.writes()).toContain(`DELETE ${UPLOADS}/u1`);
    expect(text()).toContain('Upload cancelled.');
    expect(document.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('offers no Cancel once every byte is sent, while complete is still in flight', async () => {
    page = await openEventPage(<AdminBackupsPage />, READS, {
      [`POST ${UPLOADS}`]: SESSION,
      [`PUT ${UPLOADS}/u1/chunks?offset=0`]: { receivedBytes: 1 },
    });
    const stand = vi.mocked(ApiClientModule.apiRequest).getMockImplementation()!;
    // The server took the last byte; its answer to `complete` has not come back yet.
    vi.mocked(ApiClientModule.apiRequest).mockImplementation(async (base, path, init) =>
      path === `${UPLOADS}/u1/complete` ? new Promise(() => undefined) : stand(base, path, init),
    );
    await pick(new File(['x'], 'storage-20261029T030000Z.tar.gz'));
    await press('Stage upload');
    await page.settle();
    expect(text()).toContain('Checking the file…');
    expect(buttonIn(document.body, 'Cancel upload')).toBeUndefined();
  });

  it('a Cancel the server did not confirm says so', async () => {
    page = await openEventPage(<AdminBackupsPage />, READS, { [`POST ${UPLOADS}`]: SESSION });
    const stand = vi.mocked(ApiClientModule.apiRequest).getMockImplementation()!;
    vi.mocked(ApiClientModule.apiRequest).mockImplementation(async (base, path, init) =>
      init?.method === 'PUT' ? new Promise(() => undefined) : stand(base, path, init),
    );
    await pick(new File(['x'], 'storage-20261029T030000Z.tar.gz'));
    await press('Stage upload');
    await press('Cancel upload');
    expect(page.writes()).toContain(`DELETE ${UPLOADS}/u1`);
    expect(text()).toContain('The server did not confirm removing what it received');
    expect(text()).not.toContain('Upload cancelled.');
  });

  it('a file that cannot be read says so, sends nothing, and frees the form', async () => {
    page = await openEventPage(<AdminBackupsPage />, READS);
    const file = new File(['x'], 'storage-20261029T030000Z.tar.gz');
    // As a file changed on disk since it was picked: reading it fails.
    file.slice = () => ({ arrayBuffer: () => Promise.reject(new Error('NotReadable')) }) as never;
    await pick(file);
    await press('Stage upload');
    expect(text()).toContain('The file could not be read');
    expect(page.writes()).toEqual([]);
    expect(document.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('words a refusal of the upload in the reader’s language, with its sizes', async () => {
    page = await openEventPage(<AdminBackupsPage />, READS, {}, { locale: 'fr' });
    const stand = vi.mocked(ApiClientModule.apiRequest).getMockImplementation()!;
    vi.mocked(ApiClientModule.apiRequest).mockImplementation(async (base, path, init) =>
      path === UPLOADS
        ? {
            ok: false,
            kind: 'http',
            status: 400,
            detail: 'Not enough free disk space for this upload.',
            validationErrors: null,
            code: 'upload_no_space',
            details: { freeBytes: 3 * GIB, neededBytes: 3.5 * GIB },
          }
        : stand(base, path, init),
    );
    await pick(new File(['x'], 'storage-20261029T030000Z.tar.gz'));
    await press('Préparer l');
    expect(text()).toContain('Espace disque insuffisant sur le serveur : 3.0 GB libres');
    expect(text()).toContain('3.5 GB');
    expect(text()).not.toContain('Not enough free disk space');
  });
});
