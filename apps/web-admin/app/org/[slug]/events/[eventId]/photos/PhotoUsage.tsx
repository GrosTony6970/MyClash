'use client';

import type { PhotoSummary } from '@myclash/types';
import { localeToBcp47 } from '@myclash/time';
import { useI18n } from '@myclash/next-i18n/client';

const GB = 1e9;

/** How much of the Event's caps is used, and when every photo goes (on the Event's clock). */
export function PhotoUsage({ summary }: { summary: PhotoSummary }) {
  const { t, locale } = useI18n();
  const bcp47 = localeToBcp47(locale);
  const gb = (bytes: number) =>
    new Intl.NumberFormat(bcp47, { maximumFractionDigits: 1 }).format(bytes / GB);
  const deletesOn = summary.deletesAt
    ? new Intl.DateTimeFormat(bcp47, {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: summary.timezone,
      }).format(new Date(summary.deletesAt))
    : null;

  return (
    <section className="space-y-1 rounded-md border border-border bg-surface p-4 text-sm">
      {summary.storage === 'off' && (
        <p role="status" className="font-semibold text-foreground">
          {t('organizer.photos.usage.storageOff')}
        </p>
      )}
      <p className="text-foreground">
        {t('organizer.photos.usage.lastHour', {
          count: String(summary.lastHour),
          cap: String(summary.perHourCap),
        })}
      </p>
      <p className="text-foreground">
        {t('organizer.photos.usage.stored', {
          used: gb(summary.bytes),
          cap: gb(summary.bytesCap),
        })}
      </p>
      {deletesOn && (
        <p className="text-muted">{t('organizer.photos.usage.deletesOn', { date: deletesOn })}</p>
      )}
    </section>
  );
}
