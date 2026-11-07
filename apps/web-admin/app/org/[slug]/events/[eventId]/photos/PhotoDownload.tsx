'use client';

import { useState } from 'react';
import type { PhotoSummary } from '@myclash/types';
import { CsvExportMenu } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { deletesOnLabel } from '@/components/photos/PhotoUsage';
import {
  downloadable,
  usePhotoDownload,
  type DownloadChoice,
  type PhotoTagLists,
} from './usePhotoDownload';

/**
 * "Download all" (design Goal 10, rulings 467-471): which photos, the spreadsheet photos.csv is
 * written for (the button's menu, as every CSV download), the deletion date and whose copies the
 * downloads are. Nothing while photo storage is not set up: the usage box already says so.
 */
export function PhotoDownload({
  eventId,
  summary,
  onStale,
}: {
  eventId: string;
  summary: PhotoSummary;
  onStale: () => void;
}) {
  const { t, locale } = useI18n();
  const { tags, failure, busy, now, download } = usePhotoDownload(eventId, onStale);
  const [choice, setChoice] = useState<DownloadChoice>('all');
  if (summary.storage !== 'on') return null;

  return (
    <section
      aria-labelledby="photo-download"
      className="space-y-3 rounded-md border border-border bg-surface p-4 text-sm"
    >
      <h2 id="photo-download" className="text-sm font-bold text-foreground">
        {t('organizer.photos.download.title')}
      </h2>
      {downloadable(summary, now) ? (
        <>
          <TagSelect tags={tags} value={choice} onChange={setChoice} />
          <CsvExportMenu
            t={t}
            locale={locale}
            label={t('organizer.photos.download.button')}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40"
            disabled={busy}
            onExport={(format) => void download(choice, format)}
          />
          <DownloadNote summary={summary} failure={failure} />
        </>
      ) : (
        <p className="text-muted">{t('organizer.photos.download.deleted')}</p>
      )}
    </section>
  );
}

/** What the zip holds, until when, whose the copies are, and why the last click did nothing. */
function DownloadNote({ summary, failure }: { summary: PhotoSummary; failure: string | null }) {
  const { t, locale } = useI18n();
  const date = deletesOnLabel(summary, locale);
  return (
    <>
      <p className="text-muted">
        {date
          ? t('organizer.photos.download.copiesNote', { date })
          : t('organizer.photos.download.copiesNoteUndated')}
      </p>
      {failure && (
        <p role="alert" className="font-semibold text-danger">
          {failure}
        </p>
      )}
    </>
  );
}

function TagSelect({
  tags,
  value,
  onChange,
}: {
  tags: PhotoTagLists | null | 'loading';
  value: DownloadChoice;
  onChange: (choice: DownloadChoice) => void;
}) {
  const { t } = useI18n();
  const lists = tags && tags !== 'loading' ? tags : null;
  return (
    <div className="space-y-1">
      <label className="block font-semibold text-foreground">
        {t('organizer.photos.download.filterLabel')}
        <select
          value={value}
          onChange={(event) => onChange(event.target.value as DownloadChoice)}
          aria-describedby={tags === null ? 'photo-download-lists' : undefined}
          className="mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm font-normal"
        >
          <option value="all">{t('organizer.photos.download.allPhotos')}</option>
          {lists && lists.tournaments.length > 0 && (
            <optgroup label={t('organizer.photos.download.tournaments')}>
              {lists.tournaments.map((tour) => (
                <option key={tour.id} value={`tournament:${tour.id}`}>
                  {tour.name}
                </option>
              ))}
            </optgroup>
          )}
          {lists && lists.workshops.length > 0 && (
            <optgroup label={t('organizer.photos.download.workshops')}>
              {lists.workshops.map((shop) => (
                <option key={shop.id} value={`workshop:${shop.id}`}>
                  {shop.title}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      {tags === null && (
        <p id="photo-download-lists" className="text-muted">
          {t('organizer.photos.download.listFailed')}
        </p>
      )}
    </div>
  );
}
