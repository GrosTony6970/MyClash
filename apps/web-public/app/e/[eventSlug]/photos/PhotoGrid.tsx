'use client';

import { useState } from 'react';
import { Button, PromptDialog } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { formatInZone, localeToBcp47 } from '@myclash/time';
import { PHOTO_REPORT_COMMENT_MAX, type PublicPhoto } from '@myclash/types';
import type { ReportState } from '@/lib/photos/photo-report';
import { PHOTO_FIELD_CLS } from './_components/photo-field';
import { TagOptions, type PhotoTags } from './_components/TagOptions';
import { usePhotoFeed, usePhotoReports } from './use-photo-feed';

const TIME_FMT = { weekday: 'short', hour: '2-digit', minute: '2-digit' } as const;

interface Props {
  eventId: string;
  /** The Event's clock: a photo's time reads as the Event's pages do. */
  timeZone: string;
  tags: PhotoTags;
}

/**
 * The Event's public photos (design, "The public"; slice 4b): a filter, the grid newest first,
 * Load more, and a Report under each photo that asks first (ruling 452). No upload here: sending
 * is the QR code's page (design Goal 1).
 */
export function PhotoGrid({ eventId, timeZone, tags }: Props) {
  const { t } = useI18n();
  const feed = usePhotoFeed(eventId);
  const reports = usePhotoReports(eventId);
  const tooLong = t('publicApp.photos.report.commentTooLong', {
    max: String(PHOTO_REPORT_COMMENT_MAX),
  });

  return (
    <div className="mt-6 flex flex-col gap-4">
      <PhotoFilter tags={tags} value={feed.filter} onChange={feed.changeFilter} />
      <FeedBody
        feed={feed}
        empty={t(feed.filter ? 'publicApp.photos.emptyFiltered' : 'publicApp.photos.empty')}
      >
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {feed.photos.map((photo) => (
            <PhotoTile
              key={photo.id}
              photo={photo}
              timeZone={timeZone}
              report={reports.stateOf(photo.id)}
              onReport={() => reports.ask(photo.id)}
            />
          ))}
        </ul>
      </FeedBody>
      <PromptDialog
        open={reports.asking !== null}
        title={t('publicApp.photos.report.dialogTitle')}
        description={t('publicApp.photos.report.dialogText')}
        fieldLabel={t('publicApp.photos.report.commentLabel')}
        multiline
        allowEmpty
        validate={(value) =>
          // Counted in characters, as the server counts them: an emoji is one.
          [...value.trim()].length > PHOTO_REPORT_COMMENT_MAX ? tooLong : null
        }
        confirmLabel={t('publicApp.photos.report.send')}
        cancelLabel={t('publicApp.photos.report.cancel')}
        onConfirm={(value) => void reports.send(value)}
        onCancel={reports.cancel}
      />
    </div>
  );
}

function PhotoFilter(props: { tags: PhotoTags; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  if (props.tags.tournaments.length === 0 && props.tags.workshops.length === 0) return null;
  return (
    <div>
      <label htmlFor="photo-filter" className="block text-sm font-medium text-foreground">
        {t('publicApp.photos.filterLabel')}
      </label>
      <select
        id="photo-filter"
        className={PHOTO_FIELD_CLS}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      >
        <option value="">{t('publicApp.photos.filterAll')}</option>
        <TagOptions tags={props.tags} />
      </select>
    </div>
  );
}

/** The list, or what stands for it: nothing while the first read is out, Retry when it failed. */
function FeedBody({
  feed,
  empty,
  children,
}: {
  feed: ReturnType<typeof usePhotoFeed>;
  empty: string;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  if (feed.status === 'loading') return null;
  if (feed.status === 'failed') {
    return (
      <div role="status" className="flex flex-col items-start gap-2">
        <p className="text-sm text-foreground-secondary">{t('publicApp.photos.loadFailed')}</p>
        <Button variant="outline" size="sm" onClick={feed.retry}>
          {t('publicApp.photos.retry')}
        </Button>
      </div>
    );
  }
  if (feed.photos.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <>
      {children}
      {feed.hasMore && (
        <Button
          variant="outline"
          className="self-center"
          disabled={feed.loadingMore}
          onClick={() => void feed.loadMore()}
        >
          {t('publicApp.photos.loadMore')}
        </Button>
      )}
      {feed.moreFailed && (
        <p role="status" className="text-center text-sm text-foreground-secondary">
          {t('publicApp.photos.loadMoreFailed')}
        </p>
      )}
    </>
  );
}

function PhotoTile(props: {
  photo: PublicPhoto;
  timeZone: string;
  report: ReportState;
  onReport: () => void;
}) {
  const { locale } = useI18n();
  const { photo } = props;
  const lines = [photo.uploaderName, photo.caption, photo.tag?.name].filter(Boolean);
  return (
    <li className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <TileImage photo={photo} />
      <div className="flex flex-1 flex-col gap-1 p-2 text-xs">
        {lines.map((line, i) => (
          <p
            key={i}
            className={i === 0 ? 'font-medium text-foreground' : 'text-foreground-secondary'}
          >
            {line}
          </p>
        ))}
        <p className="text-muted">
          {formatInZone(photo.createdAt, props.timeZone, TIME_FMT, localeToBcp47(locale))}
        </p>
        <ReportControl state={props.report} onReport={props.onReport} />
      </div>
    </li>
  );
}

/**
 * The preview, opening the original in a new tab, or a plain tile when there is none to show:
 * the bucket was down when the links were signed, or the picture failed to load (its link is
 * over 10 minutes old: ruling 450, until the page is reloaded). Her own photos in her personal
 * space show the same way (slice 6b).
 */
export function TileImage({
  photo,
}: {
  photo: Pick<PublicPhoto, 'previewUrl' | 'originalUrl' | 'caption'>;
}) {
  const { t } = useI18n();
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const { previewUrl, originalUrl } = photo;
  if (!previewUrl || !originalUrl || brokenUrl === previewUrl) {
    return (
      <div className="flex aspect-square items-center justify-center bg-background text-xs text-muted">
        {t('publicApp.photos.imageUnavailable')}
      </div>
    );
  }
  return (
    <a href={originalUrl} target="_blank" rel="noopener noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element -- a signed bucket link, not a next/image source */}
      <img
        src={previewUrl}
        alt={photo.caption ?? t('publicApp.photos.photoAlt')}
        loading="lazy"
        className="aspect-square w-full object-cover"
        onError={() => setBrokenUrl(previewUrl)}
      />
    </a>
  );
}

/** Report, then Reported; closed while the Report is out, so a second tap sends nothing. */
function ReportControl({ state, onReport }: { state: ReportState; onReport: () => void }) {
  const { t } = useI18n();
  if (state.kind === 'gone')
    return (
      <p role="status" className="text-muted">
        {state.message}
      </p>
    );
  const label =
    state.kind === 'reported'
      ? t('publicApp.photos.report.done')
      : state.kind === 'sending'
        ? t('publicApp.photos.report.sending')
        : t('publicApp.photos.report.button');
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="mt-1 self-start"
        disabled={state.kind === 'sending' || state.kind === 'reported'}
        onClick={onReport}
      >
        {label}
      </Button>
      {state.kind === 'failed' && (
        <p role="status" className="text-foreground-secondary">
          {state.message}
        </p>
      )}
    </>
  );
}
