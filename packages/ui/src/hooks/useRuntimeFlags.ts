'use client';

import { useEffect, useState } from 'react';
import type { PublicFeatureFlagsSnapshot } from '@myclash/feature-flags';

const POLL_INTERVAL_MS = 60_000;

/**
 * Module-scoped cache shared across every hook consumer in the same
 * app session. We fetch once on mount, then refresh every 60 s — the
 * banner and the realtime hook both read from this cache so toggling
 * `disable_realtime` and editing the maintenance banner only cost one
 * round-trip per minute per browser tab.
 */
interface Cache {
  apiUrl: string;
  data: PublicFeatureFlagsSnapshot | null;
  fetchedAt: number;
  inflight: Promise<PublicFeatureFlagsSnapshot | null> | null;
  listeners: Set<(snap: PublicFeatureFlagsSnapshot | null) => void>;
  timer: ReturnType<typeof setInterval> | null;
}

const cacheByUrl = new Map<string, Cache>();

const EMPTY: PublicFeatureFlagsSnapshot = {
  maintenanceBanner: { enabled: false, message: null, severity: null },
  realtimeDisabled: false,
};

async function fetchOnce(apiUrl: string): Promise<PublicFeatureFlagsSnapshot | null> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/public/feature-flags`, {
      // Public endpoint — no credentials so we don't carry cookies on
      // a hot, public-cacheable call.
      credentials: 'omit',
    });
    if (!res.ok) return null;
    return (await res.json()) as PublicFeatureFlagsSnapshot;
  } catch {
    return null;
  }
}

function getCache(apiUrl: string): Cache {
  let cache = cacheByUrl.get(apiUrl);
  if (!cache) {
    cache = {
      apiUrl,
      data: null,
      fetchedAt: 0,
      inflight: null,
      listeners: new Set(),
      timer: null,
    };
    cacheByUrl.set(apiUrl, cache);
  }
  return cache;
}

function refresh(cache: Cache): Promise<PublicFeatureFlagsSnapshot | null> {
  if (cache.inflight) return cache.inflight;
  cache.inflight = fetchOnce(cache.apiUrl).then((snap) => {
    cache.data = snap;
    cache.fetchedAt = Date.now();
    cache.inflight = null;
    for (const listener of cache.listeners) listener(snap);
    return snap;
  });
  return cache.inflight;
}

/**
 * Subscribe to the public runtime flags snapshot. Returns the latest
 * snapshot (or `null` while loading / on a fetch failure). Multiple
 * components in the same app share one timer and one cached payload.
 */
export function useRuntimeFlags(apiUrl: string): PublicFeatureFlagsSnapshot | null {
  const [snap, setSnap] = useState<PublicFeatureFlagsSnapshot | null>(() => {
    return cacheByUrl.get(apiUrl)?.data ?? null;
  });

  useEffect(() => {
    const cache = getCache(apiUrl);
    cache.listeners.add(setSnap);

    // First subscriber starts the polling loop. Subsequent
    // subscribers just attach; they get the cached value immediately
    // via the next refresh fanout.
    if (cache.listeners.size === 1) {
      void refresh(cache);
      cache.timer = setInterval(() => void refresh(cache), POLL_INTERVAL_MS);
    } else if (cache.data) {
      setSnap(cache.data);
    }

    return () => {
      cache.listeners.delete(setSnap);
      if (cache.listeners.size === 0 && cache.timer) {
        clearInterval(cache.timer);
        cache.timer = null;
      }
    };
  }, [apiUrl]);

  return snap;
}

/**
 * Synchronous accessor for cases that can't use a hook (e.g. inside
 * the realtime client setup). Returns the most recently cached
 * snapshot or a safe "everything off" default.
 */
export function getRuntimeFlagsCached(apiUrl: string): PublicFeatureFlagsSnapshot {
  return cacheByUrl.get(apiUrl)?.data ?? EMPTY;
}
