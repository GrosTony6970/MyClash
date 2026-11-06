'use client';

import { useI18n } from '@myclash/next-i18n/client';
import type { MyEvent } from '@/components/me/types';
import { getPublicApiUrl } from '@/lib/api-url';
import {
  ClosedPanel,
  PhotoForm,
  type PhotoQueueView,
} from '../../../../e/[eventSlug]/photos/_components/PhotoForm';
import type { PhotoTags } from '../../../../e/[eventSlug]/photos/_components/TagOptions';
import { PhotoQueue } from '../../../../e/[eventSlug]/photos/send/PhotoQueue';
import { usePhotoQueue } from '../../../../e/[eventSlug]/photos/send/use-photo-queue';
import { MyPhotoList } from './MyPhotoList';
import { useMyPhotos } from './use-my-photos';

type MyPhotosView = ReturnType<typeof useMyPhotos>;

/**
 * The Photos tab's body (design Goal 11; slice 6b): the form while she can send, else why not,
 * then the photos she sent from here. The form needs her photo list's answer (whether sending is
 * open, ruling 463, and her name), so it waits for it.
 */
export function MyPhotosPanel({ myEvent, tags }: { myEvent: MyEvent; tags: PhotoTags }) {
  const { t } = useI18n();
  const { event } = myEvent;
  const mine = useMyPhotos(event.id, t);
  const queue = usePhotoQueue({
    apiUrl: getPublicApiUrl(),
    target: { kind: 'account', eventId: event.id },
    t,
    onSent: mine.refresh,
  });
  return (
    <div className="flex flex-col gap-6">
      {mine.status === 'shown' && (
        <SendArea mine={mine} queue={queue} tags={tags} photosOff={event.photoMode === 'off'} />
      )}
      <MyPhotoList mine={mine} timeZone={event.timezone ?? 'Europe/Paris'} />
    </div>
  );
}

/**
 * The form, or why it is not there: photos Off or outside the upload days (said by the server,
 * ruling 463), a refusal of a send, or no name yet. The photos already picked stay listed.
 */
function SendArea(props: {
  mine: MyPhotosView;
  queue: PhotoQueueView;
  tags: PhotoTags;
  photosOff: boolean;
}) {
  const { t } = useI18n();
  const { mine, queue } = props;
  const notOpen = props.photosOff
    ? t('publicApp.photoSend.refusal.off')
    : t('publicApp.photoSend.refusal.windowClosed');
  const closed = mine.sendOpen ? queue.closedBy : notOpen;
  if (!closed && mine.posterName !== null) {
    return <PhotoForm queue={queue} ready tags={props.tags} poster={mine.posterName} />;
  }
  // No name, known before a send or refused by one (`photo_no_name`): the way to add one.
  const noName = t('publicApp.photoSend.refusal.noName');
  const message = closed ?? noName;
  const toProfile = { href: '/me/profile', label: t('publicApp.myPhotos.toProfile') };
  return (
    <div>
      <ClosedPanel message={message} link={message === noName ? toProfile : null} />
      <PhotoQueue items={queue.items} onRemove={queue.remove} />
    </div>
  );
}
