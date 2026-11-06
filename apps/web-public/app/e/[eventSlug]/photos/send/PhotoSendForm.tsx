'use client';

import { useSyncExternalStore } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import type { PhotoMode } from '@myclash/types';
import { getPublicApiUrl } from '@/lib/api-url';
import {
  NO_TOKEN_ON_THE_SERVER,
  readPhotoLinkToken,
  subscribeToHash,
} from '@/lib/photos/photo-link-token';
import { ClosedPanel, PhotoForm } from '../_components/PhotoForm';
import type { PhotoTags } from '../_components/TagOptions';
import { PhotoQueue } from './PhotoQueue';
import { usePhotoQueue } from './use-photo-queue';

/**
 * The phone page of the Event's QR link (design, "The uploader"). The form is live only once the
 * token is read from the address, which the server cannot do.
 */
export function PhotoSendForm(props: {
  eventId: string;
  eventSlug: string;
  photoMode: PhotoMode | null;
  tags: PhotoTags;
}) {
  const { t } = useI18n();
  const token = useSyncExternalStore(subscribeToHash, readPhotoLinkToken, NO_TOKEN_ON_THE_SERVER);
  const queue = usePhotoQueue({
    apiUrl: getPublicApiUrl(),
    target: { kind: 'qr', eventId: props.eventId, token: token ?? '' },
    t,
  });
  const closed =
    props.photoMode === 'off'
      ? t('publicApp.photoSend.refusal.off')
      : token === ''
        ? t('publicApp.photoSend.linkIncomplete')
        : queue.closedBy;
  if (!closed) return <PhotoForm queue={queue} ready={token !== null} tags={props.tags} />;
  const toEvent = { href: `/e/${props.eventSlug}/home`, label: t('publicApp.photoSend.seeEvent') };
  return (
    <>
      <ClosedPanel message={closed} link={toEvent} />
      <PhotoQueue items={queue.items} onRemove={queue.remove} />
    </>
  );
}
