'use client';

import { useParams } from 'next/navigation';
import { AdminPageHeader, Button } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { BackLink } from '@/components/BackLink';
import { PageAlert } from '@/components/PageAlert';
import { PhotoQueue } from '@/components/photos/PhotoQueue';
import { PhotoUsage } from '@/components/photos/PhotoUsage';
import { photoModeLabel } from '@/components/photos/photo-mode-label';
import { usePhotoQueue } from '@/components/photos/usePhotoQueue';

/**
 * One Event's photos, moderated by a platform super admin (rulings 491-494): the club's own queue
 * and caps, through the club's routes, whose gate records each write in the audit log. No QR
 * link, no mode switch, no download: those stay the club's (492).
 */
export default function PlatformEventPhotosPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { t } = useI18n();
  const photos = usePhotoQueue(eventId, { withLink: false });
  const summary = photos.summary;

  return (
    <main className="mx-auto max-w-[110rem] px-6 py-8 lg:px-8">
      <BackLink href="/admin/photos" label={t('admin.photos.backToList')} />
      <div className="mt-4">
        <AdminPageHeader
          title={summary?.eventName ?? t('admin.photos.title')}
          subtitle={t('admin.photos.eventDescription')}
          actions={
            <Button variant="secondary" size="sm" onClick={photos.reload}>
              {t('actions.refresh')}
            </Button>
          }
        />
      </div>
      <PageAlert outcome={photos.outcome} className="mb-6" />
      {summary && (
        <div className="space-y-6">
          <p className="text-sm font-medium text-foreground">
            {t('admin.photos.modeLine', { mode: photoModeLabel(summary.mode, t) })}
          </p>
          <PhotoUsage summary={summary} />
          <PhotoQueue
            photos={photos.photos}
            filter={photos.filter}
            waiting={summary.waiting}
            reported={summary.reported}
            timezone={summary.timezone}
            hasMore={photos.next !== null}
            loadingMore={photos.loadingMore}
            busy={photos.busy}
            onFilter={photos.setFilter}
            onApprove={photos.approve}
            onKeep={photos.keep}
            onDelete={photos.remove}
            onLoadMore={photos.loadMore}
            onImageError={photos.onImageError}
          />
        </div>
      )}
    </main>
  );
}
