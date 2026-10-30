'use client';

import { useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { formatBytes } from '@/lib/format-bytes';
import type { UploadProgress } from './chunked-upload';
import { uploadPercent, uploadProgressWords } from './restore-words';
import { useBackupUpload } from './use-backup-upload';

// Mirror of the ops runner's file name rule, so a wrong file is refused before anything is sent.
const BACKUP_FILENAME = /^(db-\d{8}T\d{6}Z\.sql\.gz|storage-\d{8}T\d{6}Z\.tar\.gz)(\.gpg)?$/;

interface Props {
  apiUrl: string;
  /** The night's whole set, once the file is kept (ruling 213: it replaces that night's row). */
  onStaged: (backup: unknown) => void;
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
}

/**
 * The backups screen's upload: a file of up to 2 GB goes in chunks with a progress bar, resumes
 * after a lost connection, and continues where it was when the same file is picked again after a
 * reload (rulings 212, 216, 219). Its logic is `use-backup-upload.ts`.
 */
export function BackupUploadForm({ apiUrl, onStaged, onError, onNotice }: Props) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const { progress, start, cancel } = useBackupUpload(apiUrl, { t, onStaged, onError, onNotice });

  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return onError(t('admin.backups.uploadMissing'));
    if (!BACKUP_FILENAME.test(file.name)) return onError(t('admin.backups.uploadInvalidType'));
    if (!(await start(file))) return;
    setSelectedFilename(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <form
      onSubmit={(event) => void upload(event)}
      className="mb-6 rounded-lg border border-border p-4"
    >
      <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
        {t('admin.backups.uploadTitle')}
      </h2>
      <UploadPicker
        fileRef={fileRef}
        selectedFilename={selectedFilename}
        onPick={setSelectedFilename}
        sending={progress !== null}
      />
      {progress && <UploadProgressLine progress={progress} onCancel={() => void cancel()} />}
    </form>
  );
}

/** The file input, its Browse button, the picked name and the submit. */
function UploadPicker({
  fileRef,
  selectedFilename,
  onPick,
  sending,
}: {
  fileRef: RefObject<HTMLInputElement | null>;
  selectedFilename: string | null;
  onPick: (filename: string | null) => void;
  sending: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-3 flex flex-col gap-3 sm:flex-row">
      <input
        ref={fileRef}
        type="file"
        name="file"
        aria-label={t('admin.backups.uploadFile')}
        accept=".gz,.gpg"
        onChange={(event) => onPick(event.target.files?.[0]?.name ?? null)}
        className="sr-only"
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground-secondary shadow-sm hover:bg-background focus:outline-none focus:ring-2 focus:ring-accent/30"
      >
        {t('admin.backups.browse')}
      </button>
      <p className="min-w-0 flex-1 rounded-md border border-dashed border-border bg-background px-3 py-2 text-sm text-foreground-secondary">
        {selectedFilename
          ? t('admin.backups.selectedFile', { file: selectedFilename })
          : t('admin.backups.noFileSelected')}
      </p>
      <button
        type="submit"
        disabled={sending}
        className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-50"
      >
        {t('admin.backups.stageUpload')}
      </button>
    </div>
  );
}

/**
 * The bar, its line, and Cancel while bytes are still being sent. Once every byte is on the
 * server it checks and keeps the file; a Cancel then would be refused, so none is offered.
 */
function UploadProgressLine({
  progress,
  onCancel,
}: {
  progress: UploadProgress;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const percent = uploadPercent(progress);
  const sending = progress.phase === 'sending' || progress.phase === 'retrying';
  return (
    <div className="mt-3">
      <div
        role="progressbar"
        aria-label={t('admin.backups.uploadProgressLabel')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 w-full overflow-hidden rounded-full bg-border"
      >
        <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-foreground-secondary" aria-live="polite">
          {uploadProgressWords(progress, t, formatBytes)}
        </p>
        {sending && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1 text-xs font-semibold text-foreground hover:bg-background"
          >
            {t('admin.backups.uploadCancel')}
          </button>
        )}
      </div>
    </div>
  );
}
