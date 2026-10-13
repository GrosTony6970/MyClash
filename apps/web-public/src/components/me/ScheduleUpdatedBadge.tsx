'use client';

import { formatInZone, localeToBcp47 } from '@myclash/time';
import { useI18n } from '@myclash/next-i18n/client';

/**
 * "Updated 14:02", on the Event's clock: how old the schedule on screen is.
 * With `offline` it is the copy the phone kept, and the last read failed:
 * "Updated 14:02 · offline". ONE badge, for the guest page and the personal
 * space.
 */
export function ScheduleUpdatedBadge({
  updatedAt,
  offline,
  tz,
}: {
  updatedAt: number;
  offline: boolean;
  tz: string;
}) {
  const { t, locale } = useI18n();
  const time = formatInZone(
    new Date(updatedAt).toISOString(),
    tz,
    { hour: '2-digit', minute: '2-digit' },
    localeToBcp47(locale),
  );
  return (
    <div
      role="status"
      className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-[11px] font-semibold text-muted"
    >
      <span
        aria-hidden="true"
        className={['h-1.5 w-1.5 rounded-full', offline ? 'bg-warning' : 'bg-success'].join(' ')}
      />
      {t(offline ? 'publicApp.me.schedule.offlineUpdated' : 'publicApp.me.schedule.updated', {
        time,
      })}
    </div>
  );
}
