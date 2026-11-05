'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  PHOTO_NOT_FOUND,
  type ModerationPhoto,
  type PhotoLink,
  type PhotoMode,
  type PhotoQueueFilter,
  type PhotoQueuePage,
  type PhotoSummary,
} from '@myclash/types';
import { apiRequest, failureMessage, type ApiResult } from '@myclash/api-client';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';
import { errorOutcome, type Outcome } from '@/components/PageAlert';
import { useEventStatus } from '../_hooks/useEventStatus';

interface Snapshot {
  summary: PhotoSummary;
  link: PhotoLink | null;
  page: PhotoQueuePage;
}

/** A signed link lives 10 to 15 minutes from the read: older than this, a broken image may be one. */
export const STALE_LINKS_MS = 10 * 60_000;

function request<T>(
  path: string,
  init: Omit<RequestInit, 'body'> & { body?: unknown } = {},
): Promise<ApiResult<T>> {
  return apiRequest<T>(getPublicApiUrl(), path, init);
}

const pagePath = (base: string, filter: PhotoQueueFilter, before?: string) =>
  `${base}/photos?filter=${filter}${before ? `&before=${encodeURIComponent(before)}` : ''}`;

/**
 * Pure I/O, at module scope so the mount effect calls it without a synchronous state write
 * (`react-hooks/set-state-in-effect`). The head and the queue decide whether there is a page; the
 * QR link is best-effort, its panel says so.
 */
async function fetchSnapshot(base: string, filter: PhotoQueueFilter): Promise<Snapshot> {
  const [summary, link, page] = await Promise.all([
    request<PhotoSummary>(`${base}/photos/summary`),
    request<PhotoLink>(`${base}/photos/link`),
    request<PhotoQueuePage>(pagePath(base, filter)),
  ]);
  if (!summary.ok || !page.ok) throw new Error('photos read failed');
  return { summary: summary.data, link: link.ok ? link.data : null, page: page.data };
}

/**
 * Every read and write of the Event's Photos page. Each write ends in a reload, so the counts,
 * the mode and the queue show what the server holds. Two organisers on one queue: the second
 * delete of a photo answers `photo_not_found`, said in the reader's language, then the reload
 * shows the photo gone.
 */
export function usePhotoModeration(eventId: string) {
  const base = `/api/v1/events/${eventId}`;
  const data = usePhotoData(base);
  const writes = usePhotoWrites(base, data.reload);
  // The server refuses mode and new link on an archived Event; approve (443) and delete stay open.
  const { isReadOnly } = useEventStatus(eventId);
  // A write's refusal outlives the reload that follows it; a read's error goes with the next read.
  return { ...data, ...writes, outcome: writes.outcome ?? data.loadOutcome, isReadOnly };
}

/**
 * The page's reads. The race: a Load more in flight when the tab changes, or when a write's
 * reload starts. Each read of page 1 starts a new generation; a Load more that answers in an
 * older generation is dropped, so it never adds the Waiting page 2 under All, nor a page read
 * before a reload under the fresh page 1. A second Load more waits for the first.
 */
function usePhotoData(base: string) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [photos, setPhotos] = useState<ModerationPhoto[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [filter, setFilter] = useState<PhotoQueueFilter>('waiting');
  const onRead = useCallback((read: Snapshot) => {
    setSnapshot(read);
    setPhotos(read.page.photos);
    setNext(read.page.next);
  }, []);
  const first = useFirstPage(base, filter, onRead);
  const appendPage = useCallback((more: PhotoQueuePage) => {
    setPhotos((shown) => [...shown, ...more.photos]);
    setNext(more.next);
  }, []);
  const { loadMore, loadingMore } = useLoadMore(
    pagePath(base, filter, next ?? undefined),
    first.generation,
    appendPage,
    first.setLoadOutcome,
  );

  return {
    summary: snapshot?.summary ?? null,
    link: snapshot?.link ?? null,
    photos,
    next,
    filter,
    setFilter,
    loadMore,
    loadingMore,
    reload: first.reload,
    onImageError: first.onImageError,
    loadOutcome: first.loadOutcome,
  };
}

/**
 * The head and page 1, read again on a tab change and on every reload. Each read starts a new
 * generation and notes its time (the age of its signed links); a stale answer is dropped.
 */
function useFirstPage(base: string, filter: PhotoQueueFilter, onRead: (read: Snapshot) => void) {
  const { t } = useI18n();
  const [reloadKey, setReloadKey] = useState(0);
  const [loadOutcome, setLoadOutcome] = useState<Outcome | null>(null);
  const loadedAt = useRef(0);
  const generation = useRef(0);
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  /**
   * A broken image on an old read: its link has likely expired, so read fresh links. It cannot
   * loop: the new read is fresh, and a broken image on a fresh read reloads nothing. Several
   * images failing at once ask for one reload (the state updates batch).
   */
  const onImageError = useCallback(() => {
    if (Date.now() - loadedAt.current > STALE_LINKS_MS) reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    generation.current += 1;
    fetchSnapshot(base, filter)
      .then((read) => {
        if (cancelled) return;
        loadedAt.current = Date.now();
        setLoadOutcome(null);
        onRead(read);
      })
      .catch(() => {
        if (!cancelled) setLoadOutcome(errorOutcome(t('organizer.photos.loadError')));
      });
    return () => {
      cancelled = true;
    };
  }, [base, filter, reloadKey, onRead, t]);

  return { reload, onImageError, generation, loadOutcome, setLoadOutcome };
}

/**
 * The next page, dropped if page 1 was read again meanwhile. Its button shows only while there is
 * a next page, and is closed while one is read, so one is read at a time.
 */
function useLoadMore(
  path: string,
  generation: RefObject<number>,
  onPage: (page: PhotoQueuePage) => void,
  onError: (outcome: Outcome) => void,
) {
  const { t } = useI18n();
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMore = useCallback(async () => {
    const mine = generation.current;
    setLoadingMore(true);
    const res = await request<PhotoQueuePage>(path);
    setLoadingMore(false);
    if (mine !== generation.current) return;
    if (res.ok) onPage(res.data);
    else onError(errorOutcome(failureMessage(res, t, t('common.error')) ?? ''));
  }, [path, generation, onPage, onError, t]);
  return { loadMore, loadingMore };
}

function usePhotoWrites(base: string, reload: () => void) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const send = useCallback(
    async <T>(path: string, init: Omit<RequestInit, 'body'> & { body?: unknown }) => {
      setBusy(true);
      setOutcome(null);
      const res = await request<T>(path, init);
      setBusy(false);
      // Checked first: `failureMessage` would show the server's English sentence.
      if (!res.ok && res.kind === 'http' && res.code === PHOTO_NOT_FOUND)
        setOutcome(errorOutcome(t('organizer.photos.queue.alreadyDeleted')));
      else if (!res.ok) setOutcome(errorOutcome(failureMessage(res, t, t('common.error')) ?? ''));
      reload();
      return res;
    },
    [reload, t],
  );

  return {
    outcome,
    busy,
    approve: (photo: ModerationPhoto) =>
      send(`${base}/photos/${photo.id}/approve`, { method: 'POST' }),
    remove: (photo: ModerationPhoto) => send(`${base}/photos/${photo.id}`, { method: 'DELETE' }),
    setMode: (mode: PhotoMode) => send(base, { method: 'PATCH', body: { photoMode: mode } }),
    // The reload that follows reads the new link.
    rotateLink: () => send(`${base}/photos/link/rotate`, { method: 'POST' }),
  };
}
