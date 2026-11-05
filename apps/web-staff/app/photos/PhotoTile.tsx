'use client';

import { useState } from 'react';
import type { ModerationPhoto } from '@myclash/types';
import { useI18n } from '@myclash/next-i18n/client';

interface TileProps {
  photo: ModerationPhoto;
  timezone: string;
  busy: boolean;
  onApprove: (photo: ModerationPhoto) => void;
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

/** One photo: the preview, who sent it, and Approve (waiting only) and Delete. */
export function PhotoTile({ photo, timezone, busy, onApprove, onDelete, onImageError }: TileProps) {
  const { t, locale } = useI18n();
  const approved = photo.status === 'approved' ? t('scoring.photos.approved') : null;
  const meta = [photo.tag?.name, arrivalTime(photo.createdAt, locale, timezone), approved];

  return (
    <li className="overflow-hidden rounded-lg border border-border bg-surface">
      <TileImage photo={photo} onImageError={onImageError} />
      <div className="space-y-1 p-3 text-sm">
        <p className="font-semibold text-foreground">
          {photo.uploaderName ?? t('scoring.photos.noName')}
        </p>
        {photo.caption && <p className="text-foreground-secondary">{photo.caption}</p>}
        <p className="text-xs text-muted">{meta.filter(Boolean).join(' · ')}</p>
        <div className="flex gap-2 pt-2">
          {photo.status === 'waiting' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onApprove(photo)}
              className="min-h-[44px] flex-1 rounded-lg border border-border px-4 text-sm font-semibold disabled:opacity-50"
            >
              {t('scoring.photos.approve')}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => onDelete(photo)}
            className="min-h-[44px] flex-1 rounded-lg border border-border px-4 text-sm font-semibold text-danger disabled:opacity-50"
          >
            {t('scoring.photos.delete')}
          </button>
        </div>
      </div>
    </li>
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
