'use client';

/**
 * The restore half of the archive page: pick a file, preview what it holds, type the
 * phrase, restore a copy. The preview belongs to ONE file (quick win O23): after
 * previewing file A, picking file B kept A's preview, and Restore sent B's bytes with
 * A's scope. Picking another file, or a preview that fails, now clears the preview and
 * the phrase, so what is on screen is what is sent.
 */

import { useI18n } from '@myclash/next-i18n/client';
import { PageAlert } from '@/components/PageAlert';
import { RestorePreviewCard } from './RestorePreviewCard';
import { useArchiveRestore } from './use-archive-restore';

export function RestoreArchiveForm({
  eventId,
  organizationId,
  isArchived,
}: {
  eventId: string;
  /** The Event's club: a whole-Event archive is restored into it. */
  organizationId: string | undefined;
  isArchived: boolean;
}) {
  const { t } = useI18n();
  const { preview, confirmation, busy, outcome, setConfirmation, pickFile, ...actions } =
    useArchiveRestore(eventId, organizationId);

  return (
    <form onSubmit={actions.previewRestore} className="rounded-lg border border-border p-4">
      <h2 className="font-display font-semibold text-lg sm:text-xl text-foreground">
        {t('organizer.archive.restoreTitle')}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('organizer.archive.restoreDescription')}</p>
      <PageAlert outcome={outcome} className="mt-4" />
      <FileRow busy={busy} onPick={pickFile} />
      {preview && (
        <RestorePreviewCard
          preview={preview}
          confirmation={confirmation}
          onConfirmation={setConfirmation}
          // One Tournament is restored INTO this Event: refused on an archived one.
          restoreClosed={busy || (preview.scope === 'tournament' && isArchived)}
          onRestore={actions.restoreArchive}
        />
      )}
    </form>
  );
}

/** The archive file to read, and the button that previews it. */
function FileRow({ busy, onPick }: { busy: boolean; onPick: (file: File | null) => void }) {
  const { t } = useI18n();
  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row">
      <input
        type="file"
        name="file"
        accept=".json,.zip"
        aria-label={t('organizer.archive.archiveFile')}
        onChange={(changeEvent) => onPick(changeEvent.target.files?.[0] ?? null)}
        className="block w-full text-sm text-foreground-secondary"
      />
      <button
        type="submit"
        disabled={busy}
        className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-50"
      >
        {t('organizer.archive.preview')}
      </button>
    </div>
  );
}
