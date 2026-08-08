'use client';

import { useCallback, useEffect, useState } from 'react';

export interface LazyFetchState<T> {
  data: T | null;
  loading: boolean;
  error: boolean;
  reload: () => void;
}

/**
 * Fetch once, when `enabled` first turns true.
 *
 * Deliberately NOT on a timer. The per-piste screen polls its own match list
 * every 20s; pools, standings and brackets are large reference reads the
 * operator opens on purpose, and attaching them to that tick would multiply a
 * tablet's request rate for information that changes on the scale of a pool.
 *
 * Shares `useLiceMatches`' two refusals: a failed fetch keeps the last-good
 * payload, and only 401/403 count as signed out.
 */
export function useLazyFetch<T>(url: string | null, enabled: boolean): LazyFetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!enabled || !url) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect -- entering the in-flight state for a fetch this effect owns; the payload lands after the await */
    setLoading(true);
    setError(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    void (async () => {
      try {
        const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          setError(true);
          return;
        }
        setData((await res.json()) as T);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, enabled, attempt]);

  return { data, loading, error, reload };
}
