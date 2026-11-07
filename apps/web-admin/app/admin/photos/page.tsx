'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PlatformPhotoEvent } from '@myclash/types';
import {
  AdminPageHeader,
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
} from '@myclash/ui';
import { apiRequest, failureMessage } from '@myclash/api-client';
import { localeToBcp47 } from '@myclash/time';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';
import { errorOutcome, PageAlert, type Outcome } from '@/components/PageAlert';
import { photoModeLabel } from '@/components/photos/photo-mode-label';

const LIST = '/api/v1/admin/photos/events';

type Locale = Parameters<typeof localeToBcp47>[0];

/** A calendar date (`YYYY-MM-DD`) as the reader writes it; the Event's own day, so read in UTC. */
function dayLabel(day: string, locale: Locale): string {
  return new Intl.DateTimeFormat(localeToBcp47(locale), {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

function datesLabel(event: PlatformPhotoEvent, locale: Locale): string {
  const days = [event.startDate, event.endDate].filter((d): d is string => d !== null);
  const unique = [...new Set(days)];
  return unique.map((day) => dayLabel(day, locale)).join(' – ');
}

/**
 * The platform's Photos page (ruling 493): every Event that takes photos or still holds some,
 * newest first, with what waits on a moderator. A platform super admin only; a lower tier reaches
 * it by its address and reads why it is refused.
 */
export default function PlatformPhotosPage() {
  const { t } = useI18n();
  const [events, setEvents] = useState<PlatformPhotoEvent[] | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<PlatformPhotoEvent[]>(getPublicApiUrl(), LIST, {
      signal: controller.signal,
    }).then((r) => {
      if (controller.signal.aborted) return;
      if (r.ok) setEvents(r.data);
      // `apiRequest` reports a 403 as `unauthenticated`: a platform admin or viewer.
      else if (r.kind === 'unauthenticated')
        setOutcome(errorOutcome(t('admin.common.accessDeniedSuperAdmin')));
      else setOutcome(errorOutcome(failureMessage(r, t, t('admin.photos.loadFailed')) ?? ''));
    });
    return () => controller.abort();
  }, [t]);

  return (
    <main className="mx-auto max-w-[110rem] px-6 py-8 lg:px-8">
      <AdminPageHeader title={t('admin.photos.title')} subtitle={t('admin.photos.description')} />
      <PageAlert outcome={outcome} className="mb-6" />
      {events && events.length === 0 && (
        <p className="text-sm text-muted">{t('admin.photos.empty')}</p>
      )}
      {events && events.length > 0 && <PhotoEventsTable events={events} />}
    </main>
  );
}

function PhotoEventsTable({ events }: { events: PlatformPhotoEvent[] }) {
  const { t, locale } = useI18n();
  return (
    <DataTable>
      <DataTableHead>
        <DataTableCell as="th">{t('admin.photos.columns.event')}</DataTableCell>
        <DataTableCell as="th">{t('admin.photos.columns.club')}</DataTableCell>
        <DataTableCell as="th">{t('admin.photos.columns.dates')}</DataTableCell>
        <DataTableCell as="th">{t('admin.photos.columns.mode')}</DataTableCell>
        <DataTableCell as="th">{t('admin.photos.columns.waiting')}</DataTableCell>
        <DataTableCell as="th">{t('admin.photos.columns.reported')}</DataTableCell>
      </DataTableHead>
      <tbody>
        {events.map((event) => (
          <DataTableRow key={event.id}>
            <DataTableCell>
              <Link
                href={`/admin/photos/${event.id}`}
                className="font-medium text-foreground hover:text-accent"
              >
                {event.name}
              </Link>
            </DataTableCell>
            <DataTableCell>{event.clubName ?? '—'}</DataTableCell>
            <DataTableCell>{datesLabel(event, locale)}</DataTableCell>
            <DataTableCell>{photoModeLabel(event.mode, t)}</DataTableCell>
            <DataTableCell>{event.waiting}</DataTableCell>
            <DataTableCell>{event.reported}</DataTableCell>
          </DataTableRow>
        ))}
      </tbody>
    </DataTable>
  );
}
