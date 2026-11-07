'use client';

import type { PhotoMode } from '@myclash/types';
import { usePhotoQueue } from '@/components/photos/usePhotoQueue';
import { useEventStatus } from '../_hooks/useEventStatus';

/**
 * Every read and write of the club's Photos page: the shared queue (`usePhotoQueue`, also the
 * platform's page) with the QR link, and the two writes that stay the club's (ruling 492): the
 * mode and a new link. Each ends in the queue's reload, which reads the link again with the rest.
 */
export function usePhotoModeration(eventId: string) {
  const queue = usePhotoQueue(eventId, { withLink: true });
  // The server refuses mode and new link on an archived Event; approve (443) and delete stay open.
  const { isReadOnly } = useEventStatus(eventId);
  return {
    ...queue,
    isReadOnly,
    setMode: (mode: PhotoMode) =>
      queue.send(queue.base, { method: 'PATCH', body: { photoMode: mode } }),
    rotateLink: () => queue.send(`${queue.base}/photos/link/rotate`, { method: 'POST' }),
  };
}
