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

/**
 * The restore refusal this screen words itself: the night changed since its dialog said what it
 * restores (the ops runner's `upload_changed`). Null for every other failure.
 */
export function restoreRefusal(code: string | null, t: Translate): string | null {
  return code === 'upload_changed' ? t('admin.backups.uploadChanged') : null;
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
