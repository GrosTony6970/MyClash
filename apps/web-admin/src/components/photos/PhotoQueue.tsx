'use client';

import { useState } from 'react';
import type { ModerationPhoto, PhotoQueueFilter } from '@myclash/types';
import { Button, EmptyState, SegmentedTabs, useConfirm } from '@myclash/ui';
import { localeToBcp47 } from '@myclash/time';
import { useI18n } from '@myclash/next-i18n/client';

interface QueueProps {
  photos: ModerationPhoto[];
  filter: PhotoQueueFilter;
  waiting: number;
  reported: number;
  timezone: string;
  hasMore: boolean;
  loadingMore: boolean;
  busy: boolean;
  onFilter: (filter: PhotoQueueFilter) => void;
  onApprove: (photo: ModerationPhoto) => Promise<unknown>;
  onKeep: (photo: ModerationPhoto) => Promise<unknown>;
  onDelete: (photo: ModerationPhoto) => Promise<unknown>;
  onLoadMore: () => Promise<void>;
  onImageError: () => void;
}

/**
 * The queue: Waiting and Reported (each with its count) and All, newest first. A reported photo
 * shows its reports wherever it appears (ruling 456). Approve and Keep are quiet buttons: one
 * accent per page, and a grid of red buttons has none. Delete asks first; Keep does not (454).
 * All three stay open on an archived Event: Delete for privacy, Approve for a photo still waiting
 * when the Event was archived (443), Keep for a report made after it (447).
 */
export function PhotoQueue(props: QueueProps) {
  const { t } = useI18n();
  const { confirm, confirmDialog } = useConfirm();

  async function remove(photo: ModerationPhoto) {
    const sure = await confirm({
      title: t('organizer.photos.queue.deleteTitle'),
      description: t('organizer.photos.queue.deleteDescription'),
      confirmLabel: t('actions.delete'),
      cancelLabel: t('actions.cancel'),
      danger: true,
    });
    if (sure) await props.onDelete(photo);
  }

  return (
    <section className="space-y-4">
      <QueueTabs {...props} />
      {props.photos.length === 0 ? (
        <EmptyState title={t(EMPTY_KEYS[props.filter])} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {props.photos.map((photo) => (
            <PhotoTile key={photo.id} photo={photo} queue={props} onDelete={remove} />
          ))}
        </ul>
      )}
      {props.hasMore && (
        <Button
          variant="secondary"
          disabled={props.loadingMore}
          onClick={() => void props.onLoadMore()}
        >
          {t('organizer.photos.queue.loadMore')}
        </Button>
      )}
      {confirmDialog}
    </section>
  );
}

const EMPTY_KEYS = {
  waiting: 'organizer.photos.queue.emptyWaiting',
  reported: 'organizer.photos.queue.emptyReported',
  all: 'organizer.photos.queue.empty',
} as const satisfies Record<PhotoQueueFilter, string>;

function QueueTabs({
  filter,
  waiting,
  reported,
  onFilter,
}: Pick<QueueProps, 'filter' | 'waiting' | 'reported' | 'onFilter'>) {
  const { t } = useI18n();
  const tabs = [
    {
      value: 'waiting' as const,
      label: t('organizer.photos.queue.waiting', { count: String(waiting) }),
    },
    {
      value: 'reported' as const,
      label: t('organizer.photos.queue.reported', { count: String(reported) }),
    },
    { value: 'all' as const, label: t('organizer.photos.queue.all') },
  ];
  return (
    <SegmentedTabs
      tabs={tabs}
      value={filter}
      onChange={onFilter}
      aria-label={t('organizer.photos.queue.tabsLabel')}
    />
  );
}

/** When a photo arrived, on the Event's clock. */
function arrivalTime(createdAt: string, bcp47: string, timeZone: string): string {
  const format = new Intl.DateTimeFormat(bcp47, {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone,
  });
  return format.format(new Date(createdAt));
}

function PhotoTile({
  photo,
  queue,
  onDelete,
}: {
  photo: ModerationPhoto;
  queue: QueueProps;
  onDelete: (photo: ModerationPhoto) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const when = arrivalTime(photo.createdAt, localeToBcp47(locale), queue.timezone);
  const approved = photo.status === 'approved' ? t('organizer.photos.queue.approved') : null;

  return (
    <li className="overflow-hidden rounded-md border border-border bg-surface">
      <TileImage photo={photo} onImageError={queue.onImageError} />
      <div className="space-y-1 p-3 text-sm">
        <p className="font-semibold text-foreground">
          {photo.uploaderName ?? t('organizer.photos.queue.noName')}
        </p>
        {photo.caption && <p className="text-foreground-secondary">{photo.caption}</p>}
        <p className="text-xs text-muted">
          {[photo.tag?.name, when, approved].filter(Boolean).join(' · ')}
        </p>
        <ReportLines photo={photo} />
        <TileActions photo={photo} queue={queue} onDelete={onDelete} />
      </div>
    </li>
  );
}

/** How many phones reported the photo and what they wrote, newest first; nothing with no report. */
function ReportLines({ photo }: { photo: ModerationPhoto }) {
  const { t } = useI18n();
  if (photo.reportCount === 0) return null;
  return (
    <div className="space-y-1 pt-1">
      <p className="text-xs font-semibold text-danger">
        {t('organizer.photos.queue.reportCount', { count: String(photo.reportCount) })}
      </p>
      {photo.reportComments.length > 0 && (
        <ul
          aria-label={t('organizer.photos.queue.reportComments')}
          className="space-y-1 text-xs text-foreground-secondary"
        >
          {photo.reportComments.map((comment, index) => (
            <li key={index} className="break-words border-l-2 border-border pl-2">
              {comment}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Approve (waiting only), Keep (reported only, at once: 454) and Delete (asks first). */
function TileActions({
  photo,
  queue,
  onDelete,
}: {
  photo: ModerationPhoto;
  queue: QueueProps;
  onDelete: (photo: ModerationPhoto) => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <div className="flex gap-2 pt-1">
      {photo.status === 'waiting' && (
        <Button
          size="sm"
          variant="secondary"
          disabled={queue.busy}
          onClick={() => void queue.onApprove(photo)}
        >
          {t('organizer.photos.queue.approve')}
        </Button>
      )}
      {photo.reportCount > 0 && (
        <Button
          size="sm"
          variant="secondary"
          disabled={queue.busy}
          onClick={() => void queue.onKeep(photo)}
        >
          {t('organizer.photos.queue.keep')}
        </Button>
      )}
      <Button size="sm" variant="ghost" disabled={queue.busy} onClick={() => void onDelete(photo)}>
        {t('actions.delete')}
      </Button>
    </div>
  );
}

/**
 * The preview, opening the original in a new tab, or a plain tile when there is no image to
 * show. The server signs both links or neither. A broken image is remembered by its link, so a
 * reload that brings a fresh link tries again.
 */
function TileImage({ photo, onImageError }: { photo: ModerationPhoto; onImageError: () => void }) {
  const { t } = useI18n();
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const { previewUrl, originalUrl } = photo;
  if (!previewUrl || !originalUrl || brokenUrl === previewUrl) {
    return (
      <div className="flex aspect-square items-center justify-center bg-background text-xs text-muted">
        {t('organizer.photos.queue.imageUnavailable')}
      </div>
    );
  }
  return (
    <a href={originalUrl} target="_blank" rel="noopener noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element -- a signed bucket link, not a next/image source */}
      <img
        src={previewUrl}
        alt={photo.caption ?? t('organizer.photos.queue.photoAlt')}
        loading="lazy"
        className="aspect-square w-full object-cover"
        onError={() => {
          setBrokenUrl(previewUrl);
          onImageError();
        }}
      />
    </a>
  );
}
