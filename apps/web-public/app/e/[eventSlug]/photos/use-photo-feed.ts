'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import type { PublicPhotoPage } from '@myclash/types';
import { SCHEDULE_READ_LIMIT_MS, watchSchedule } from '@/components/me/watch-schedule';
import { getPublicApiUrl } from '@/lib/api-url';
import {
  feedAfterFirstPage,
  feedAfterMore,
  feedCursor,
  PHOTO_REREAD_MS,
  photoPagePath,
  readPhotoPage,
  type PhotoFeed,
} from '@/lib/photos/photo-feed';
import { reportAfter, sendReport, type ReportState } from '@/lib/photos/photo-report';

/** What the list shows: photos (`shown`), its first read, a first read that failed, no Event. */
export type FeedStatus = 'loading' | 'shown' | 'failed' | 'notFound';

/**
 * The Event's public photos, newest first (design, "The public"): the newest page every 30 s
 * while the tab is visible (`watchSchedule`), and Load more. The rules are `photo-feed.ts`.
 *
 * The races, named. The 30 s read and Load more both write the list: each answer goes through
 * `feedAfterFirstPage` / `feedAfterMore`, in either order. Load more's page is kept only while
 * the list still ends where it was asked from; a 30 s read that stood alone (more than 30 new
 * photos) moved that end, and the page is dropped rather than leave a gap. A filter change
 * re-keys the effect, whose cleanup aborts the 30 s read that is out; a Load more of the old
 * filter is dropped by the generation, and the change reopens the button so a dropped answer
 * never leaves it closed.
 */
export function usePhotoFeed(eventId: string) {
  const [filter, setFilter] = useState('');
  const [feed, setFeed] = useState<PhotoFeed | null>(null);
  const [status, setStatus] = useState<FeedStatus>('loading');
  const [asked, setAsked] = useState(0);
  const generation = useRef(0);
  const { reset: resetMore, view: more } = useLoadMore(eventId, filter, feed, generation, setFeed);

  useEffect(() => {
    const apiUrl = getPublicApiUrl();
    return watchSchedule<PublicPhotoPage>(
      (signal) => readPhotoPage(apiUrl, photoPagePath(eventId, filter), signal),
      (answer) => {
        if (answer.kind === 'data') {
          setFeed((shown) => feedAfterFirstPage(shown, answer.data));
          setStatus('shown');
        } else if (answer.kind === 'notFound') {
          setFeed(null);
          setStatus('notFound');
        } else {
          // A read that fails keeps what is on screen; the next tick tries again.
          setStatus((before) => (before === 'shown' ? before : 'failed'));
        }
      },
      PHOTO_REREAD_MS,
    );
  }, [eventId, filter, asked]);

  const changeFilter = useCallback(
    (next: string) => {
      generation.current += 1;
      resetMore();
      setFilter(next);
      setFeed(null);
      setStatus('loading');
    },
    [resetMore],
  );
  const retry = useCallback(() => {
    setStatus('loading');
    setAsked((n) => n + 1);
  }, []);

  return { filter, changeFilter, photos: feed?.photos ?? [], status, retry, ...more };
}

/** The next page under the list: one at a time, cut after 20 s, a failure said and retryable. */
function useLoadMore(
  eventId: string,
  filter: string,
  feed: PhotoFeed | null,
  generation: { current: number },
  setFeed: (update: (shown: PhotoFeed | null) => PhotoFeed | null) => void,
) {
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const cursor = feed ? feedCursor(feed) : null;

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    const mine = generation.current;
    setLoadingMore(true);
    setMoreFailed(false);
    const limit = new AbortController();
    const timer = setTimeout(() => limit.abort(), SCHEDULE_READ_LIMIT_MS);
    const path = photoPagePath(eventId, filter, cursor);
    const answer = await readPhotoPage(getPublicApiUrl(), path, limit.signal);
    clearTimeout(timer);
    // The filter changed meanwhile: this page belongs to a list that is gone.
    if (mine !== generation.current) return;
    setLoadingMore(false);
    if (answer.kind === 'data') {
      setFeed((shown) => shown && feedAfterMore(shown, answer.data, cursor));
    } else setMoreFailed(true);
  }, [cursor, eventId, filter, generation, setFeed]);

  const reset = useCallback(() => {
    setLoadingMore(false);
    setMoreFailed(false);
  }, []);

  return { reset, view: { hasMore: cursor !== null, loadMore, loadingMore, moreFailed } };
}

const IDLE: ReportState = { kind: 'idle' };

/**
 * Each photo's Report (rulings 452-453): the dialog asks first, for the photo in `asking`; the
 * photo's button is closed while its Report is out, so a second tap sends nothing.
 */
export function usePhotoReports(eventId: string) {
  const { t } = useI18n();
  const [states, setStates] = useState<Record<string, ReportState>>({});
  const [asking, setAsking] = useState<string | null>(null);

  const send = useCallback(
    async (comment: string) => {
      const photoId = asking;
      if (!photoId) return;
      setAsking(null);
      setStates((before) => ({ ...before, [photoId]: { kind: 'sending' } }));
      const result = await sendReport(getPublicApiUrl(), eventId, photoId, comment);
      setStates((before) => ({ ...before, [photoId]: reportAfter(result, t) }));
    },
    [asking, eventId, t],
  );

  return {
    stateOf: (photoId: string) => states[photoId] ?? IDLE,
    asking,
    ask: setAsking,
    cancel: () => setAsking(null),
    send,
  };
}
