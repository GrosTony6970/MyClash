import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClient from '@myclash/api-client';
import * as ApiClientModule from '@myclash/api-client';
import {
  openEventPage,
  type,
  type OpenedPage,
} from '../../org/[slug]/events/[eventId]/archived-page.fixtures';
import AdminBackupsPage from './page';

/**
 * The super admin's backups screen and the nights uploaded to it (rulings 209-218): an upload
 * restores the files it holds and says which, has its own Delete, and "Delete all" names it.
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
  BACKUPS,
  BOTH,
  IMAGES,
  READS,
  artifact,
  makePress,
  rows,
  text,
} from './backups-page.fixtures';

let page: OpenedPage;
afterEach(() => page.unmount());
const press = makePress(() => page);

describe('the backups screen and an uploaded night', () => {
  it('says what the restore of each upload replaces', async () => {
    page = await openEventPage(<AdminBackupsPage />, READS);
    expect(rows()).toHaveLength(3);

    await press('Restore from upload', rows()[0]!);
    expect(text()).toContain('Drop and recreate the database');
    expect(text()).toContain('Replace all uploaded files');
    await press('Cancel');

    await press('Restore from upload', rows()[1]!);
    expect(text()).toContain('Drop and recreate the database');
    expect(text()).toContain('this upload has no images file');
    expect(text()).toContain(
      'This upload has no images file: the uploaded files stay as they are.',
    );
    expect(text()).not.toContain('Replace all uploaded files');
    await press('Cancel');

    await press('Restore from upload', rows()[2]!);
    expect(text()).toContain('The database is not touched.');
    expect(text()).toContain('Leave the database as it is.');
    expect(text()).toContain('same night as the database in use');
    expect(text()).not.toContain('Drop and recreate the database');
  });

  // A server set restores the database and its images, as restore.sh does: no scope is sent.
  it('words a local restore as database + images, and sends no scope', async () => {
    const LOCAL = {
      id: '20261027T030000Z',
      timestamp: '20261027T030000Z',
      displayName: '20261027T030000Z',
      local: {
        available: true,
        artifacts: [artifact('db', '20261027T030000Z'), artifact('storage', '20261027T030000Z')],
      },
      cloud: { available: false, artifacts: [] },
    };
    page = await openEventPage(
      <AdminBackupsPage />,
      { ...READS, [BACKUPS]: { generatedAt: '2026-10-30T12:00:00.000Z', backups: [LOCAL] } },
      {
        [`POST ${BACKUPS}/restore`]: {
          operation: { id: 'op', kind: 'restore', status: 'success', startedAt: '', logTail: [] },
        },
      },
    );
    await press('Restore from local server', rows()[0]!);
    expect(text()).toContain('Drop and recreate the database');
    expect(text()).toContain('Replace all uploaded files');
    expect(text()).not.toContain('The database is not touched.');
    await press('Continue restore');
    const sent = vi
      .mocked(ApiClientModule.apiRequest)
      .mock.calls.find(
        ([, path, init]) => path === `${BACKUPS}/restore` && init?.method === 'POST',
      );
    expect(sent?.[2]?.body).toEqual({
      location: 'local',
      backupId: LOCAL.id,
      includeStorage: true,
      confirmed: true,
    });
  });

  // Another tab added the database to an images-only night after this dialog opened.
  it('says in the reader’s language that the night changed since the page read it', async () => {
    page = await openEventPage(<AdminBackupsPage />, READS, {}, { locale: 'fr' });
    const stand = vi.mocked(ApiClientModule.apiRequest).getMockImplementation()!;
    vi.mocked(ApiClientModule.apiRequest).mockImplementation(async (base, path, init) =>
      path === `${BACKUPS}/restore`
        ? {
            ok: false,
            kind: 'http',
            status: 400,
            detail: 'This upload changed since the page read it. Reload, then restore again.',
            validationErrors: null,
            code: 'upload_changed',
            details: null,
          }
        : stand(base, path, init),
    );
    await press('Restaurer depuis fichier envoyé', rows()[2]!);
    await press('Continuer la restauration');
    expect(text()).toContain('Cet envoi a changé depuis l');
    expect(text()).not.toContain('This upload changed');
  });

  it('sends what the dialog said, so a night changed since is refused', async () => {
    page = await openEventPage(<AdminBackupsPage />, READS, {
      [`POST ${BACKUPS}/restore`]: {
        operation: { id: 'op', kind: 'restore', status: 'success', startedAt: '', logTail: [] },
      },
    });
    await press('Restore from upload', rows()[2]!);
    await press('Continue restore');
    const sent = vi
      .mocked(ApiClientModule.apiRequest)
      .mock.calls.find(
        ([, path, init]) => path === `${BACKUPS}/restore` && init?.method === 'POST',
      );
    expect(sent?.[2]?.body).toEqual({
      location: 'upload',
      backupId: IMAGES.id,
      includeStorage: true,
      confirmed: true,
      scope: 'images',
    });
  });

  it('words a missed night in the reader’s language (ruling 217)', async () => {
    const status = READS[`${BACKUPS}/status`];
    page = await openEventPage(
      <AdminBackupsPage />,
      {
        ...READS,
        [`${BACKUPS}/status`]: {
          ...status,
          lastBackup: {
            timestamp: '2026-10-30T04:00:00.000Z',
            status: 'failed',
            error: 'The scheduled backup did not run: another operation was running.',
            code: 'scheduled_backup_missed',
            localAvailable: false,
            cloudAvailable: false,
          },
        },
      },
      {},
      { locale: 'fr' },
    );
    expect(text()).toContain("la sauvegarde planifiée n'a pas eu lieu");
    expect(text()).not.toContain('The scheduled backup did not run');
  });

  it('deletes an uploaded night from its own button (ruling 218)', async () => {
    const remove = `DELETE ${BACKUPS}/${BOTH.id}?location=upload`;
    page = await openEventPage(<AdminBackupsPage />, READS, {
      [remove]: { deleted: true, backupId: BOTH.id, location: 'upload', deletedArtifacts: [] },
    });
    await press('Delete from upload', rows()[0]!);
    await press('Delete backup');
    expect(page.writes()).toEqual([remove]);
    expect(text()).toContain('upload backup deleted.');
  });

  it('says how many uploads "Delete all" removed', async () => {
    page = await openEventPage(<AdminBackupsPage />, READS, {
      [`DELETE ${BACKUPS}`]: {
        deleted: true,
        deletedLocalSets: 1,
        deletedCloudSets: 0,
        deletedUploadSets: 3,
        deletedFiles: [],
        failedFiles: [],
      },
    });
    await press('Delete all backups');
    expect(text()).toContain('Every local, Scaleway S3 and uploaded backup');
    const token = document.querySelector<HTMLInputElement>(
      'input[placeholder="DELETE ALL MYCLASH BACKUPS"]',
    )!;
    await act(async () => type(token, 'DELETE ALL MYCLASH BACKUPS'));
    await press('Delete all backups');
    expect(text()).toContain('Deleted 1 local + 0 cloud sets and 3 uploaded.');
  });

  it('a failed run that met the held lock is worded, not the runner’s English', async () => {
    const status = READS[`${BACKUPS}/status`];
    page = await openEventPage(<AdminBackupsPage />, {
      ...READS,
      [`${BACKUPS}/status`]: {
        ...status,
        runningOperation: {
          id: 'op',
          kind: 'backup',
          status: 'failed',
          startedAt: '2026-10-30T03:00:00.000Z',
          logTail: [],
          error: 'Another backup operation is already running.',
          code: 'ops_busy',
        },
      },
    });
    expect(text()).toContain('Another backup operation is running (a backup, a restore');
    expect(text()).not.toContain('already running');
  });

  it('words the held lock on a delete, not the runner’s English', async () => {
    page = await openEventPage(<AdminBackupsPage />, READS);
    const stand = vi.mocked(ApiClientModule.apiRequest).getMockImplementation()!;
    vi.mocked(ApiClientModule.apiRequest).mockImplementation(async (base, path, init) =>
      init?.method === 'DELETE'
        ? {
            ok: false,
            kind: 'http',
            status: 409,
            detail: 'Another backup operation is already running.',
            validationErrors: null,
            code: 'ops_busy',
            details: null,
          }
        : stand(base, path, init),
    );
    await press('Delete from upload', rows()[0]!);
    await press('Delete backup');
    expect(text()).toContain('Another backup operation is running (a backup, a restore');
    expect(text()).not.toContain('already running');
  });
});
