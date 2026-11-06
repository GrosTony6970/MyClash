'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MyPhoto, MyPhotos } from '@myclash/types';
import { SCHEDULE_READ_LIMIT_MS } from '@/components/me/watch-schedule';
import { getPublicApiUrl } from '@/lib/api-url';
import { deleteMyPhoto, myPhotosPath, readMyPhotos, withoutDeleted } from '@/lib/photos/my-photos';
import {
  feedAfterFirstPage,
  feedAfterMore,
  feedCursor,
  type PhotoFeed,
} from '@/lib/photos/photo-feed';

type Translate = (key: string, values?: Record<string, string>) => string;
type Feed = PhotoFeed<MyPhoto>;
type SetFeed = (update: (shown: Feed | null) => Feed | null) => void;

/** What the list shows: its first read out, her photos (`shown`), or a first read that failed. */
export type MyPhotosStatus = 'loading' | 'shown' | 'failed';

/**
 * Her photos of one Event in her personal space (slice 6b), newest first: the first page, read
 * again after each photo she sends (`refresh`), Load more, and her Delete. The rules are
 * `my-photos.ts` and `photo-feed.ts`; this is glue.
 *
 * The races, named. A read of the first page that left before a Delete and answers after it still
 * holds the photo: every answer passes `withoutDeleted`. Two reads of the first page (two photos
 * sent close together): a new one aborts the one before, and an answer that is no longer the
 * latest read is dropped, so an older answer never lands last. A Load more and a refresh both
 * write the list through `feedAfterMore` / `feedAfterFirstPage`, in either order.
 */
export function useMyPhotos(eventId: string, t: Translate) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const deleted = useRef(new Set<string>());
  const first = useFirstPage(eventId, deleted, setFeed);
  const more = useMorePages(eventId, feed, deleted, setFeed);
  const deletes = useDeletes(eventId, t, deleted, setFeed);
  return { photos: feed?.photos ?? [], ...first, ...more, ...deletes };
}

function useFirstPage(eventId: string, deleted: { current: Set<string> }, setFeed: SetFeed) {
  const [status, setStatus] = useState<MyPhotosStatus>('loading');
  const [about, setAbout] = useState<Pick<MyPhotos, 'posterName' | 'sendOpen'> | null>(null);
  const [asked, setAsked] = useState(0);

  // One read per ask: a new ask's cleanup aborts the read before it, and an answer that lands
  // after its read was aborted is dropped, so an older answer never lands last.
  useEffect(() => {
    const read = new AbortController();
    void readMyPhotos(getPublicApiUrl(), myPhotosPath(eventId), read.signal).then((answer) => {
      if (read.signal.aborted || answer.kind === 'aborted') return;
      if (answer.kind === 'failed') {
        // A read that fails keeps what is on screen. After a send, the new photo then waits for
        // the next read; its row in the queue still says it was sent.
        setStatus((before) => (before === 'shown' ? before : 'failed'));
        return;
      }
      const page = withoutDeleted(answer.data, deleted.current);
      setFeed((shown) => feedAfterFirstPage(shown, page));
      setAbout({ posterName: page.posterName, sendOpen: page.sendOpen });
      setStatus('shown');
    });
    return () => read.abort();
  }, [eventId, asked, deleted, setFeed]);

  const refresh = useCallback(() => setAsked((n) => n + 1), []);
  const retry = useCallback(() => {
    setStatus('loading');
    setAsked((n) => n + 1);
  }, []);

  return {
    status,
    posterName: about?.posterName ?? null,
    sendOpen: about?.sendOpen ?? false,
    refresh,
    retry,
  };
}

/** The next page under the list: one at a time, cut after 20 s, a failure said and retryable. */
function useMorePages(
  eventId: string,
  feed: Feed | null,
  deleted: { current: Set<string> },
  setFeed: SetFeed,
) {
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const cursor = feed ? feedCursor(feed) : null;

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    setMoreFailed(false);
    const limit = new AbortController();
    const timer = setTimeout(() => limit.abort(), SCHEDULE_READ_LIMIT_MS);
    const path = myPhotosPath(eventId, cursor);
    const answer = await readMyPhotos(getPublicApiUrl(), path, limit.signal);
    clearTimeout(timer);
    setLoadingMore(false);
    if (answer.kind === 'data') {
      const page = withoutDeleted(answer.data, deleted.current);
      setFeed((shown) => shown && feedAfterMore(shown, page, cursor));
    } else setMoreFailed(true);
  }, [cursor, eventId, deleted, setFeed]);

  return { hasMore: cursor !== null, loadMore, loadingMore, moreFailed };
}

/** Her Delete of one photo: closed while it is out; a failure is said under that photo. */
function useDeletes(
  eventId: string,
  t: Translate,
  deleted: { current: Set<string> },
  setFeed: SetFeed,
) {
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  const [failedDelete, setFailedDelete] = useState<Record<string, string>>({});

  const remove = useCallback(
    async (photoId: string) => {
      setRemoving((before) => new Set(before).add(photoId));
      setFailedDelete(({ [photoId]: _gone, ...rest }) => rest);
      const answer = await deleteMyPhoto(getPublicApiUrl(), eventId, photoId, t);
      setRemoving((before) => {
        const after = new Set(before);
        after.delete(photoId);
        return after;
      });
      if (answer.kind === 'failed') {
        setFailedDelete((before) => ({ ...before, [photoId]: answer.message }));
        return;
      }
      deleted.current.add(photoId);
      setFeed(
        (shown) => shown && { ...shown, photos: shown.photos.filter((p) => p.id !== photoId) },
      );
    },
    [eventId, t, deleted, setFeed],
  );

  return { remove, removing, failedDelete };
}
