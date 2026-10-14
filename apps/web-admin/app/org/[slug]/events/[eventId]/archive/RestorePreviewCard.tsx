'use client';

import { useI18n } from '@myclash/next-i18n/client';

export interface RestorePreview {
  scope: 'event' | 'tournament';
  include: 'structure' | 'scoring';
  source: {
    eventName: string;
    tournamentName?: string;
  };
  counts: Record<string, number>;
  warnings: string[];
  canRestore: boolean;
}

export const RESTORE_CONFIRMATION = 'RESTORE MYCLASH ARCHIVE';

/** What the previewed file holds, the phrase to type, and the Restore button. */
export function RestorePreviewCard({
  preview,
  confirmation,
  onConfirmation,
  restoreClosed,
  onRestore,
}: {
  preview: RestorePreview;
  confirmation: string;
  onConfirmation: (value: string) => void;
  /** A send is out, or this Event cannot take the restore. */
  restoreClosed: boolean;
  onRestore: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-5 rounded-md border border-border bg-background p-4">
      <PreviewSummary preview={preview} />
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          value={confirmation}
          onChange={(changeEvent) => onConfirmation(changeEvent.target.value)}
          aria-label={t('organizer.archive.confirmation')}
          placeholder={RESTORE_CONFIRMATION}
          className="w-full rounded-md border border-border px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={onRestore}
          disabled={restoreClosed || !preview.canRestore || confirmation !== RESTORE_CONFIRMATION}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
        >
          {t('organizer.archive.restoreCopy')}
        </button>
      </div>
    </div>
  );
}

/** The file's source, what it includes, its counts per table and its warnings. */
function PreviewSummary({ preview }: { preview: RestorePreview }) {
  const { t } = useI18n();
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{preview.source.eventName}</p>
          <p className="text-xs text-muted">
            {preview.scope === 'tournament'
              ? preview.source.tournamentName
              : t('organizer.archive.scopes.event')}
          </p>
        </div>
        <span className="rounded-full bg-surface px-2 py-1 text-xs font-medium text-foreground-secondary">
          {t(`organizer.archive.includes.${preview.include}`)}
        </span>
      </div>
      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
        {Object.entries(preview.counts)
          .filter(([, value]) => value > 0)
          .map(([key, value]) => (
            <div key={key} className="rounded-md bg-surface p-2">
              {/* The API keys these counts by the archive envelope's table
                  names. Rendering them raw showed the organiser
                  `eventProgrammeBlocks` and `poolMembers`. */}
              <dt className="text-xs text-muted">{t(`organizer.archive.tables.${key}`)}</dt>
              <dd className="font-semibold text-foreground">{value}</dd>
            </div>
          ))}
      </dl>
      {preview.warnings.length > 0 && (
        <ul className="mt-4 list-disc pl-5 text-sm text-danger">
          {preview.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </>
  );
}
