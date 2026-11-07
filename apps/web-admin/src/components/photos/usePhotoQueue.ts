'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  PHOTO_NOT_FOUND,
  type ModerationPhoto,
  type PhotoLink,
  type PhotoQueueFilter,
  type PhotoQueuePage,
  type PhotoSummary,
} from '@myclash/types';
import { apiRequest, failureMessage, type ApiResult } from '@myclash/api-client';
import { useI18n } from '@myclash/next-i18n/client';
import { getPublicApiUrl } from '@/lib/api-url';
import { errorOutcome, type Outcome } from '@/components/PageAlert';

interface Snapshot {
  summary: PhotoSummary;
  link: PhotoLink | null;
  page: PhotoQueuePage;
}

/** The server refused this caller the queue (a 403): the page says why, if it was told how. */
class RefusedRead extends Error {}

/** A signed link lives 10 to 15 minutes from the read: older than this, a broken image may be one. */
export const STALE_LINKS_MS = 10 * 60_000;

type RequestInitWithBody = Omit<RequestInit, 'body'> & { body?: unknown };

function request<T>(path: string, init: RequestInitWithBody = {}): Promise<ApiResult<T>> {
  return apiRequest<T>(getPublicApiUrl(), path, init);
}

const pagePath = (base: string, filter: PhotoQueueFilter, before?: string) =>
  `${base}/photos?filter=${filter}${before ? `&before=${encodeURIComponent(before)}` : ''}`;

/**
 * Pure I/O, at module scope so the mount effect calls it without a synchronous state write
 * (`react-hooks/set-state-in-effect`). The head and the queue decide whether there is a page; the
 * QR link, read only for the club's page, is best-effort, its panel says so. It is read in the
 * same snapshot as the queue, so a reload after a rotation shows the new link: one reader.
 */
async function fetchSnapshot(
  base: string,
  filter: PhotoQueueFilter,
  withLink: boolean,
): Promise<Snapshot> {
  const [summary, link, page] = await Promise.all([
    request<PhotoSummary>(`${base}/photos/summary`),
    withLink ? request<PhotoLink>(`${base}/photos/link`) : Promise.resolve(null),
    request<PhotoQueuePage>(pagePath(base, filter)),
  ]);
  // `apiRequest` reports a 403 as `unauthenticated`: the caller may not moderate this Event.
  if (!summary.ok && summary.kind === 'unauthenticated') throw new RefusedRead();
  if (!summary.ok || !page.ok) throw new Error('photos read failed');
  return { summary: summary.data, link: link?.ok ? link.data : null, page: page.data };
}

/**
 * An Event's moderation queue: the head, the photos, approve, Keep, delete. One owner for the
 * club's Photos page (`withLink`: it also shows the QR link) and the platform's (ruling 493).
 * Each write ends in a reload, so the counts and the queue show what the server holds. Two
 * moderators on one queue: the second delete of a photo answers `photo_not_found`, said in the
 * reader's language, then the reload shows the photo gone.
 */
export function usePhotoQueue(
  eventId: string,
  { withLink, refusedKey }: { withLink: boolean; refusedKey?: string },
) {
  const base = `/api/v1/events/${eventId}`;
  const data = usePhotoData(base, withLink, refusedKey);
  const writes = usePhotoWrites(base, data.reload);
  // A write's refusal outlives the reload that follows it; a read's error goes with the next read.
  return { ...data, ...writes, base, outcome: writes.outcome ?? data.loadOutcome };
}

/**
 * The page's reads. The race: a Load more in flight when the tab changes, or when a write's
 * reload starts. Each read of page 1 starts a new generation; a Load more that answers in an
 * older generation is dropped, so it never adds the Waiting page 2 under All, nor a page read
 * before a reload under the fresh page 1. A second Load more waits for the first.
 */
function usePhotoData(base: string, withLink: boolean, refusedKey: string | undefined) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [photos, setPhotos] = useState<ModerationPhoto[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [filter, setFilter] = useState<PhotoQueueFilter>('waiting');
  const onRead = useCallback((read: Snapshot) => {
    setSnapshot(read);
    setPhotos(read.page.photos);
    setNext(read.page.next);
  }, []);
  const first = useFirstPage({ base, filter, withLink, refusedKey }, onRead);
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
 * generation and notes its time (the age of its signed links); a stale answer is dropped. A
 * refusal (403) reads as `refusedKey` when the page gave one (the platform's page: "super admin
 * required"); otherwise, and for any other failure, as the load error.
 */
function useFirstPage(
  read: { base: string; filter: PhotoQueueFilter; withLink: boolean; refusedKey?: string },
  onRead: (read: Snapshot) => void,
) {
  const { base, filter, withLink, refusedKey } = read;
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
    fetchSnapshot(base, filter, withLink)
      .then((read) => {
        if (cancelled) return;
        loadedAt.current = Date.now();
        setLoadOutcome(null);
        onRead(read);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        const refused = failure instanceof RefusedRead && refusedKey;
        setLoadOutcome(errorOutcome(t(refused ? refusedKey : 'organizer.photos.loadError')));
      });
    return () => {
      cancelled = true;
    };
  }, [base, filter, withLink, refusedKey, reloadKey, onRead, t]);

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
    async <T>(path: string, init: RequestInitWithBody) => {
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
    send,
    approve: (photo: ModerationPhoto) =>
      send(`${base}/photos/${photo.id}/approve`, { method: 'POST' }),
    // The newest report shown: a later one stays for the next read (ruling 457). Keep shows on a
    // reported photo only, whose time is never null.
    keep: (photo: ModerationPhoto) =>
      send(`${base}/photos/${photo.id}/keep`, {
        method: 'POST',
        body: { reportsUpTo: photo.lastReportAt },
      }),
    remove: (photo: ModerationPhoto) => send(`${base}/photos/${photo.id}`, { method: 'DELETE' }),
  };
}
