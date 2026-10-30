import type { ApiFailure } from '@myclash/api-client';
import type { UploadProgress } from './chunked-upload';

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** What a restore replaces: the database and the images, or one of them. */
export type RestoreScope = 'both' | 'database' | 'images';

/**
 * An uploaded night restores the files it holds (rulings 209, 215): the database and the images,
 * the database alone, or the images alone. A server set restores both, as `restore.sh` does.
 */
export function restoreScope(
  location: 'local' | 's3' | 'upload',
  uploaded: ReadonlyArray<{ kind: 'db' | 'storage' }>,
): RestoreScope {
  if (location !== 'upload') return 'both';
  const has = (kind: 'db' | 'storage') => uploaded.some((artifact) => artifact.kind === kind);
  if (!has('db')) return 'images';
  return has('storage') ? 'both' : 'database';
}

/**
 * Why the last backup failed, in the reader's language when the ops runner gave a code (a night
 * the ops lock kept busy, ruling 217); otherwise the runner's own message.
 */
export function lastBackupReason(
  lastBackup: { error?: string | null; code?: string | null },
  t: Translate,
): string | null {
  if (lastBackup.code === 'scheduled_backup_missed')
    return t('admin.backups.scheduledBackupMissed');
  return lastBackup.error ?? null;
}

/** What the screen reads of a refusal: its code, the server's sentence, the numbers it names. */
export interface Refusal {
  code: string | null;
  detail?: string | null;
  details?: Record<string, unknown> | null;
}

/** A failed request, as a refusal; no answer at all (offline, cancelled) has no code. */
export function refusalOf(failure: ApiFailure): Refusal {
  if (failure.kind === 'http' || failure.kind === 'unauthenticated') {
    return { code: failure.code, detail: failure.detail, details: failure.details };
  }
  return { code: null };
}

/**
 * The refusals of the ops runner this screen words itself, by their code: a night that changed
 * since the restore dialog said what it restores, the ops lock held (on a delete, a run, a
 * restore), and the chunked upload's (rulings 216, 219). Null for every other failure: the
 * caller's `failureMessage` (it already words `file_too_large` with the limit).
 */
export function backupRefusal(
  refusal: Refusal,
  t: Translate,
  size: (bytes: number) => string,
): string | null {
  switch (refusal.code) {
    case 'upload_changed':
      return t('admin.backups.uploadChanged');
    case 'ops_busy':
      return t('admin.backups.opsBusy');
    case 'upload_bad_name':
      return t('admin.backups.uploadInvalidType');
    case 'upload_gone':
      return t('admin.backups.uploadGone');
    case 'upload_corrupt':
      return t('admin.backups.uploadCorrupt');
    case 'upload_failed':
      return t('admin.backups.uploadFailed', { reason: refusal.detail ?? '' });
    case 'upload_not_receiving':
      return t('admin.backups.uploadBeingChecked');
    case 'upload_no_space':
      return noSpace(refusal.details, t, size);
    // The loop handles these itself; reaching the screen means it could not: the plain sentence.
    case 'upload_incomplete':
    case 'upload_chunk_size':
    case 'upload_bad_offset':
    case 'upload_out_of_order':
      return t('admin.backups.uploadError');
    default:
      return null;
  }
}

function noSpace(
  details: Record<string, unknown> | null | undefined,
  t: Translate,
  size: (bytes: number) => string,
): string {
  const free = details?.['freeBytes'];
  const needed = details?.['neededBytes'];
  if (typeof free !== 'number' || typeof needed !== 'number') {
    return t('admin.backups.uploadNoSpaceBare');
  }
  return t('admin.backups.uploadNoSpace', { free: size(free), needed: size(needed) });
}

/** The line under the upload's bar. */
export function uploadProgressWords(
  progress: UploadProgress,
  t: Translate,
  size: (bytes: number) => string,
): string {
  if (progress.phase === 'checking') return t('admin.backups.uploadChecking');
  if (progress.phase === 'waiting') return t('admin.backups.uploadWaiting');
  const values = {
    sent: size(progress.sentBytes),
    total: size(progress.totalBytes),
    percent: uploadPercent(progress),
  };
  return progress.phase === 'retrying'
    ? t('admin.backups.uploadRetrying', values)
    : t('admin.backups.uploadSending', values);
}

/** The bar's fill, 0-100; the check and the wait are past the last byte. */
export function uploadPercent(progress: UploadProgress): number {
  if (progress.phase === 'checking' || progress.phase === 'waiting') return 100;
  if (progress.totalBytes === 0) return 0;
  return Math.floor((progress.sentBytes / progress.totalBytes) * 100);
}

/** The restore dialog's sentence and list for each scope. */
export function restoreWords(
  scope: RestoreScope,
  values: { location: string; timestamp: string },
  t: Translate,
): { body: string; bullets: string[] } {
  if (scope === 'images') {
    return {
      body: t('admin.backups.restoreDialogBodyImages', values),
      bullets: [
        t('admin.backups.restoreScopeStorage'),
        t('admin.backups.restoreScopeKeepDb'),
        t('admin.backups.restoreScopeSameNight'),
        t('admin.backups.restoreScopeStorageService'),
      ],
    };
  }
  return {
    body:
      scope === 'both'
        ? t('admin.backups.restoreDialogBody', values)
        : t('admin.backups.restoreDialogBodyDatabase', values),
    bullets: [
      t('admin.backups.restoreScopeDb', { timestamp: values.timestamp }),
      scope === 'both'
        ? t('admin.backups.restoreScopeStorage')
        : t('admin.backups.restoreScopeKeepImages'),
      t('admin.backups.restoreScopeServices'),
    ],
  };
}
