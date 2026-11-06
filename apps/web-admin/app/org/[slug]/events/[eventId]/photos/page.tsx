'use client';

import { useParams } from 'next/navigation';
import type { PhotoSummary } from '@myclash/types';
import { AdminPageHeader, Button } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { BackLink } from '@/components/BackLink';
import { PageAlert } from '@/components/PageAlert';
import { PhotoDownload } from './PhotoDownload';
import { PhotoLinkPanel } from './PhotoLinkPanel';
import { PhotoModePanel } from './PhotoModePanel';
import { PhotoQueue } from './PhotoQueue';
import { PhotoUsage } from './PhotoUsage';
import { usePhotoModeration } from './usePhotoModeration';

/**
 * The Event's photos (design, "Moderation"): the mode, the QR poster, the caps and the queue.
 * Organisers only: every read answers 403 to anyone who is not an admin of the club.
 */
export default function EventPhotosPage() {
  const { slug, eventId } = useParams<{ slug: string; eventId: string }>();
  const { t } = useI18n();
  const photos = usePhotoModeration(eventId);

  return (
    <main className="mx-auto max-w-[110rem] px-6 py-8 lg:px-8">
      <BackLink href={`/org/${slug}/events/${eventId}`} label={t('organizer.photos.backToEvent')} />
      <div className="mt-4">
        <AdminPageHeader
          title={t('organizer.photos.title')}
          subtitle={t('organizer.photos.description')}
          actions={
            <Button variant="secondary" size="sm" onClick={photos.reload}>
              {t('actions.refresh')}
            </Button>
          }
        />
      </div>
      <PageAlert outcome={photos.outcome} className="mb-6" />
      {photos.summary && (
        <PhotoSections eventId={eventId} summary={photos.summary} photos={photos} />
      )}
    </main>
  );
}

function PhotoSections({
  eventId,
  summary,
  photos,
}: {
  eventId: string;
  summary: PhotoSummary;
  photos: ReturnType<typeof usePhotoModeration>;
}) {
  return (
    <div className="space-y-6">
      <PhotoModePanel
        mode={summary.mode}
        readOnly={photos.isReadOnly}
        busy={photos.busy}
        onChange={(mode) => void photos.setMode(mode)}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <PhotoLinkPanel
          eventSlug={summary.eventSlug}
          eventName={summary.eventName}
          link={photos.link}
          readOnly={photos.isReadOnly}
          onRotate={photos.rotateLink}
        />
        <PhotoUsage summary={summary} />
      </div>
      <PhotoDownload eventId={eventId} summary={summary} onStale={photos.reload} />
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
  );
}
