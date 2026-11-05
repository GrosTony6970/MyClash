'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';
import type {
  ModerationPhoto,
  PhotoQueueFilter,
  PhotoQueuePage,
  PhotoSummary,
} from '@myclash/types';
import { apiRequest, failureMessage, type ApiResult } from '@myclash/api-client';
import { useI18n } from '@myclash/next-i18n/client';
import { getApiUrl } from './api-url';
import {
  EMPTY_QUEUE,
  photoFailureKey,
  photoPagePath,
  photoQueueReducer,
  shouldReloadOnImageError,
} from './photo-queue';

type Translate = ReturnType<typeof useI18n>['t'];

/**
 * `apiRequest`, not `api.*`: it answers the refusal's code instead of throwing, and sends no JSON
 * content type on a DELETE with no body.
 */
function request<T>(
  path: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<ApiResult<T>> {
  return apiRequest<T>(getApiUrl(), path, body === undefined ? { method } : { method, body });
}

/** Pure I/O at module scope, so the read effect writes no state synchronously. */
function fetchFirstPage(filter: PhotoQueueFilter) {
  return Promise.all([
    request<PhotoSummary>('/api/v1/staff/photos/summary'),
    request<PhotoQueuePage>(photoPagePath(filter)),
  ]);
}

/** The screen's words for a refusal: its own two first, then the shared ones. */
function refusalText(
  res: Extract<ApiResult<unknown>, { ok: false }>,
  t: Translate,
  fallback: string,
): string {
  const key = photoFailureKey(res);
  return key ? t(key) : (failureMessage(res, t, fallback) ?? fallback);
}

/**
 * The photo queue of a staff login with the `photos` job. Each write ends in a read of page 1, so
 * two moderators on one queue see what the server holds: the second delete of a photo answers
 * `photo_not_found`, said in the reader's language, and the read shows the photo gone.
 */
export function usePhotoQueue() {
  const reads = useQueueReads();
  const writes = useQueueWrites(reads.reload);
  const { reload, setFilter: showTab } = reads;
  const { clearError } = writes;
  // A write's refusal outlives the read that follows it, and goes when the reader asks for a
  // read (Refresh, a tab). A read's error goes with the next good read.
  const refresh = useCallback(() => {
    clearError();
    reload();
  }, [clearError, reload]);
  const setFilter = useCallback(
    (filter: PhotoQueueFilter) => {
      clearError();
      showTab(filter);
    },
    [clearError, showTab],
  );
  return { ...reads, ...writes, refresh, setFilter, error: writes.error ?? reads.error };
}

function useQueueReads() {
  const { t } = useI18n();
  const [filter, setFilterState] = useState<PhotoQueueFilter>('waiting');
  const [summary, setSummary] = useState<PhotoSummary | null>(null);
  const [queue, dispatch] = useReducer(photoQueueReducer, EMPTY_QUEUE);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Each read of page 1 is announced when it is asked for: Load more closes until it lands.
  const reload = useCallback(() => {
    dispatch({ type: 'reading' });
    setReloadKey((key) => key + 1);
  }, []);
  const setFilter = useCallback((next: PhotoQueueFilter) => {
    dispatch({ type: 'reading' });
    setFilterState(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchFirstPage(filter).then(([head, page]) => {
      if (cancelled) return;
      if (!head.ok) return setError(refusalText(head, t, t('scoring.photos.loadError')));
      if (!page.ok) return setError(refusalText(page, t, t('scoring.photos.loadError')));
      setError(null);
      setSummary(head.data);
      dispatch({ type: 'read', page: page.data, at: Date.now() });
    });
    return () => {
      cancelled = true;
    };
  }, [filter, reloadKey, t]);

  const more = useLoadMore(filter, queue.next, queue.generation, dispatch, setError);
  const onImageError = useCallback(() => {
    if (shouldReloadOnImageError(queue.loadedAt, Date.now())) reload();
  }, [queue.loadedAt, reload]);

  return {
    filter,
    setFilter,
    summary,
    photos: queue.photos,
    next: queue.next,
    error,
    reload,
    onImageError,
    ...more,
  };
}

/** The next page, dropped by the reducer if page 1 was read again meanwhile. One at a time. */
function useLoadMore(
  filter: PhotoQueueFilter,
  next: string | null,
  generation: number,
  dispatch: (action: { type: 'more'; page: PhotoQueuePage; generation: number }) => void,
  setError: (message: string) => void,
) {
  const { t } = useI18n();
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMore = useCallback(async () => {
    if (!next) return;
    setLoadingMore(true);
    const res = await request<PhotoQueuePage>(photoPagePath(filter, next));
    setLoadingMore(false);
    if (res.ok) dispatch({ type: 'more', page: res.data, generation });
    else setError(refusalText(res, t, t('scoring.photos.loadError')));
  }, [filter, next, generation, dispatch, setError, t]);
  return { loadMore, loadingMore };
}

function useQueueWrites(reload: () => void) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clearError = useCallback(() => setError(null), []);

  const send = useCallback(
    async (path: string, method: 'POST' | 'DELETE', body?: unknown) => {
      setBusy(true);
      setError(null);
      const res = await request<unknown>(path, method, body);
      setBusy(false);
      if (!res.ok) setError(refusalText(res, t, t('scoring.photos.actionError')));
      reload();
    },
    [reload, t],
  );

  return {
    busy,
    error,
    clearError,
    approve: (photo: ModerationPhoto) => send(`/api/v1/staff/photos/${photo.id}/approve`, 'POST'),
    // The newest report shown: a later one stays for the next read (ruling 457). Keep shows on a
    // reported photo only, whose time is never null.
    keep: (photo: ModerationPhoto) =>
      send(`/api/v1/staff/photos/${photo.id}/keep`, 'POST', { reportsUpTo: photo.lastReportAt }),
    remove: (photo: ModerationPhoto) => send(`/api/v1/staff/photos/${photo.id}`, 'DELETE'),
  };
}
