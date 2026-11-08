'use client';

import { Button, useConfirm } from '@myclash/ui';
import { useI18n } from '@myclash/next-i18n/client';
import { formatInZone, localeToBcp47 } from '@myclash/time';
import type { MyPhoto } from '@myclash/types';
import { ReadFailed } from '@/components/me/ReadFailed';
import { TileImage } from '../../../../e/[eventSlug]/photos/PhotoGrid';
import type { useMyPhotos } from './use-my-photos';

type MyPhotosView = ReturnType<typeof useMyPhotos>;

const TIME_FMT = { weekday: 'short', hour: '2-digit', minute: '2-digit' } as const;

/**
 * "My photos": the photos she sent from her personal space, newest first, 30 at a time, each with
 * its status and a Delete that asks first (design Goal 11). Photos sent with the QR code are not
 * here: they stay anonymous.
 */
export function MyPhotoList({ mine, timeZone }: { mine: MyPhotosView; timeZone: string }) {
  const { t } = useI18n();
  const { confirm, confirmDialog } = useConfirm();
  const askToDelete = async (photoId: string) => {
    const sure = await confirm({
      title: t('publicApp.myPhotos.deleteTitle'),
      description: t('publicApp.myPhotos.deleteText'),
      confirmLabel: t('publicApp.myPhotos.deleteConfirm'),
      cancelLabel: t('publicApp.myPhotos.deleteCancel'),
      danger: true,
    });
    if (sure) await mine.remove(photoId);
  };
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg font-bold text-foreground">
        {t('publicApp.myPhotos.title')}
      </h2>
      <ListBody mine={mine}>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {mine.photos.map((photo) => (
            <MyPhotoTile
              key={photo.id}
              photo={photo}
              timeZone={timeZone}
              removing={mine.removing.has(photo.id)}
              failed={mine.failedDelete[photo.id] ?? null}
              onDelete={() => void askToDelete(photo.id)}
            />
          ))}
        </ul>
      </ListBody>
      {confirmDialog}
    </section>
  );
}

/** The list, or what stands for it: nothing while the first read is out, Retry when it failed. */
function ListBody({ mine, children }: { mine: MyPhotosView; children: React.ReactNode }) {
  const { t } = useI18n();
  if (mine.status === 'loading') return null;
  if (mine.status === 'failed') {
    return <ReadFailed title={t('publicApp.myPhotos.loadFailed')} onRetry={mine.retry} />;
  }
  if (mine.photos.length === 0) {
    return <p className="text-sm text-muted">{t('publicApp.myPhotos.empty')}</p>;
  }
  return (
    <>
      {children}
      {mine.hasMore && (
        <Button
          variant="outline"
          className="self-center"
          disabled={mine.loadingMore}
          onClick={() => void mine.loadMore()}
        >
          {t('publicApp.photos.loadMore')}
        </Button>
      )}
      {mine.moreFailed && (
        <p role="status" className="text-center text-sm text-foreground-secondary">
          {t('publicApp.photos.loadMoreFailed')}
        </p>
      )}
    </>
  );
}

function MyPhotoTile(props: {
  photo: MyPhoto;
  timeZone: string;
  removing: boolean;
  failed: string | null;
  onDelete: () => void;
}) {
  const { t, locale } = useI18n();
  const { photo } = props;
  // "Approved", not "Shown": an approved photo is hidden while the Event's photos are Off (498).
  const status =
    photo.status === 'waiting'
      ? t('publicApp.myPhotos.statusWaiting')
      : t('publicApp.myPhotos.statusApproved');
  return (
    <li
      data-testid="my-photo"
      className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface"
    >
      <TileImage photo={photo} />
      <div className="flex flex-1 flex-col gap-1 p-2 text-xs">
        <p className="font-medium text-foreground">{status}</p>
        {[photo.caption, photo.tag?.name].filter(Boolean).map((line, i) => (
          <p key={i} className="text-foreground-secondary">
            {line}
          </p>
        ))}
        <p className="text-muted">
          {formatInZone(photo.createdAt, props.timeZone, TIME_FMT, localeToBcp47(locale))}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-1 self-start"
          disabled={props.removing}
          onClick={props.onDelete}
        >
          {t('publicApp.myPhotos.delete')}
        </Button>
        {props.failed && (
          <p role="alert" className="text-danger">
            {props.failed}
          </p>
        )}
      </div>
    </li>
  );
}
