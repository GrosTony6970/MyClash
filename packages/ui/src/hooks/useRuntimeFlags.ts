'use client';

import { useEffect, useState } from 'react';
import type { PublicFeatureFlagsSnapshot } from '@myclash/feature-flags';
import { serverSkewMs } from './time-simulation';

const POLL_INTERVAL_MS = 60_000;

/**
 * The public snapshot as a browser holds it: the server's clock reading is
 * replaced by this browser's distance from it, measured when it arrived.
 */
export interface RuntimeFlags extends Omit<PublicFeatureFlagsSnapshot, 'serverNowIso'> {
  /** Server clock minus this browser's clock, in ms (see `serverSkewMs`). */
  serverSkewMs: number;
}

/**
 * Module-scoped cache shared across every hook consumer in the same
 * app session. We fetch once on mount, then refresh every 60 s — the
 * banner and the realtime hook both read from this cache so toggling
 * `disable_realtime` and editing the maintenance banner only cost one
 * round-trip per minute per browser tab.
 */
interface Cache {
  apiUrl: string;
  data: RuntimeFlags | null;
  fetchedAt: number;
  inflight: Promise<RuntimeFlags | null> | null;
  listeners: Set<(snap: RuntimeFlags | null) => void>;
  timer: ReturnType<typeof setInterval> | null;
}

const cacheByUrl = new Map<string, Cache>();

const EMPTY: RuntimeFlags = {
  maintenanceBanner: { enabled: false, message: null, severity: null },
  realtimeDisabled: false,
  timeSimulation: { enabled: false, simulatedNowIso: null, anchorRealIso: null, mode: null },
  serverSkewMs: 0,
};

async function fetchOnce(apiUrl: string): Promise<RuntimeFlags | null> {
  try {
    const sentAtMs = Date.now();
    const res = await fetch(`${apiUrl}/api/v1/public/feature-flags`, {
      // Public endpoint — no credentials so we don't carry cookies on
      // a hot, public-cacheable call.
      credentials: 'omit',
    });
    const receivedAtMs = Date.now();
    if (!res.ok) return null;
    return toRuntimeFlags((await res.json()) as PublicFeatureFlagsSnapshot, sentAtMs, receivedAtMs);
  } catch {
    return null;
  }
}

/** The API's answer → what the browser keeps, given when the request left and its answer came. */
export function toRuntimeFlags(
  { serverNowIso, ...snap }: PublicFeatureFlagsSnapshot,
  sentAtMs: number,
  receivedAtMs: number,
): RuntimeFlags {
  return { ...snap, serverSkewMs: serverSkewMs(serverNowIso, sentAtMs, receivedAtMs) };
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

function refresh(cache: Cache): Promise<RuntimeFlags | null> {
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
export function useRuntimeFlags(apiUrl: string): RuntimeFlags | null {
  const [snap, setSnap] = useState<RuntimeFlags | null>(() => {
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
 * Re-read the snapshot now instead of at the next 60 s poll, for the screen
 * that just changed a flag and must show its effect. Every subscriber gets
 * the new snapshot.
 *
 * The race: a poll already in flight may have left before the change was
 * saved, and `refresh` would hand that stale answer back. So this waits for
 * it to land, then reads again; any read it joins after that started after
 * the save.
 */
export function refreshRuntimeFlags(apiUrl: string): Promise<RuntimeFlags | null> {
  const cache = getCache(apiUrl);
  const leftBefore = cache.inflight;
  return leftBefore ? leftBefore.then(() => refresh(cache)) : refresh(cache);
}

/**
 * Synchronous accessor for cases that can't use a hook (e.g. inside
 * the realtime client setup). Returns the most recently cached
 * snapshot or a safe "everything off" default.
 */
export function getRuntimeFlagsCached(apiUrl: string): RuntimeFlags {
  return cacheByUrl.get(apiUrl)?.data ?? EMPTY;
}
