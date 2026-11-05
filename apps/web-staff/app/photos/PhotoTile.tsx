'use client';

import { useState } from 'react';
import type { ModerationPhoto } from '@myclash/types';
import { useI18n } from '@myclash/next-i18n/client';

interface TileProps {
  photo: ModerationPhoto;
  timezone: string;
  busy: boolean;
  onApprove: (photo: ModerationPhoto) => void;
  onKeep: (photo: ModerationPhoto) => void;
  onDelete: (photo: ModerationPhoto) => void;
  onImageError: () => void;
}

/**
 * When a photo arrived, on the Event's clock, with its day: the screen stays open the day after
 * the Event (ruling 437), when Saturday's 14:05 and Sunday's would read alike.
 */
function arrivalTime(createdAt: string, locale: string, timeZone: string): string {
  const format = new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone,
  });
  return format.format(new Date(createdAt));
}

/**
 * One photo: the preview, who sent it, its reports when it has some (ruling 456), and Approve
 * (waiting only), Keep (reported only) and Delete.
 */
export function PhotoTile(props: TileProps) {
  const { photo, timezone } = props;
  const { t, locale } = useI18n();
  const approved = photo.status === 'approved' ? t('scoring.photos.approved') : null;
  const meta = [photo.tag?.name, arrivalTime(photo.createdAt, locale, timezone), approved];

  return (
    <li className="overflow-hidden rounded-lg border border-border bg-surface">
      <TileImage photo={photo} onImageError={props.onImageError} />
      <div className="space-y-1 p-3 text-sm">
        <p className="font-semibold text-foreground">
          {photo.uploaderName ?? t('scoring.photos.noName')}
        </p>
        {photo.caption && <p className="text-foreground-secondary">{photo.caption}</p>}
        <p className="text-xs text-muted">{meta.filter(Boolean).join(' · ')}</p>
        <ReportLines photo={photo} />
        <TileActions {...props} />
      </div>
    </li>
  );
}

/** How many phones reported the photo and what they wrote, newest first; nothing with no report. */
function ReportLines({ photo }: Pick<TileProps, 'photo'>) {
  const { t } = useI18n();
  if (photo.reportCount === 0) return null;
  return (
    <div className="space-y-1 pt-1">
      <p className="text-xs font-semibold text-danger">
        {t('scoring.photos.reportCount', { count: String(photo.reportCount) })}
      </p>
      {photo.reportComments.length > 0 && (
        <ul
          aria-label={t('scoring.photos.reportComments')}
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

const ACTION_CLS =
  'min-h-[44px] flex-1 rounded-lg border border-border px-4 text-sm font-semibold disabled:opacity-50';

/** Approve (waiting only), Keep (reported only, at once: ruling 454) and Delete (asks first). */
function TileActions({ photo, busy, onApprove, onKeep, onDelete }: TileProps) {
  const { t } = useI18n();
  return (
    <div className="flex gap-2 pt-2">
      {photo.status === 'waiting' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onApprove(photo)}
          className={ACTION_CLS}
        >
          {t('scoring.photos.approve')}
        </button>
      )}
      {photo.reportCount > 0 && (
        <button type="button" disabled={busy} onClick={() => onKeep(photo)} className={ACTION_CLS}>
          {t('scoring.photos.keep')}
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => onDelete(photo)}
        className={`${ACTION_CLS} text-danger`}
      >
        {t('scoring.photos.delete')}
      </button>
    </div>
  );
}

/**
 * The preview, opening the original in a new tab, or a plain tile when there is no image to
 * show. The server signs both links or neither. A broken image is remembered by its link, so a
 * read that brings a fresh link tries again.
 */
function TileImage({ photo, onImageError }: Pick<TileProps, 'photo' | 'onImageError'>) {
  const { t } = useI18n();
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const { previewUrl, originalUrl } = photo;
  if (!previewUrl || !originalUrl || brokenUrl === previewUrl) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center bg-background text-xs text-muted">
        {t('scoring.photos.imageUnavailable')}
      </div>
    );
  }
  return (
    <a href={originalUrl} target="_blank" rel="noopener noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element -- a signed bucket link, not a next/image source */}
      <img
        src={previewUrl}
        alt={photo.caption ?? t('scoring.photos.photoAlt')}
        loading="lazy"
        className="aspect-[4/3] w-full object-cover"
        onError={() => {
          setBrokenUrl(previewUrl);
          onImageError();
        }}
      />
    </a>
  );
}
