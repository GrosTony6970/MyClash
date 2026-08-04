'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LiceMatchesPayload } from '../components/lice-match-types';

/**
 * How often a piste tablet re-reads its lice.
 *
 * The screen used to fetch once and never again, so a tablet left open on a
 * piste showed the same queue for the rest of the day. 20s is well inside the
 * gap between bouts and costs one small request per tablet.
 */
export const LICE_MATCHES_POLL_MS = 20_000;

export interface LiceMatchesState {
  data: LiceMatchesPayload | null;
  loading: boolean;
  /** True only after a real auth failure — never after a network blip. */
  sessionExpired: boolean;
  refresh: () => Promise<void>;
}

/**
 * The lice's matches, kept current by a poll plus a refresh whenever the tablet
 * comes back to the foreground or regains the network.
 *
 * Two deliberate refusals to discard data:
 *   - a failed fetch keeps the previous payload on screen. The operator is
 *     probably offline mid-event, and a blank piste screen is worse than a
 *     slightly stale one.
 *   - only 401/403 count as "signed out". The old page redirected to /login on
 *     any non-OK response, so a single 502 from a restarting API bounced the
 *     operator out mid-bout.
 */
export function useLiceMatches(apiUrl: string, liceId: string | null): LiceMatchesState {
  const [data, setData] = useState<LiceMatchesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  const refresh = useCallback(async () => {
    if (!liceId) return;
    // Offline: the request would fail anyway, and skipping it keeps the
    // last-good queue on screen.
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    try {
      const res = await fetch(`${apiUrl}/api/v1/staff/lices/${liceId}/matches`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (res.status === 401 || res.status === 403) {
        setSessionExpired(true);
        return;
      }
      if (!res.ok) return;
      setData((await res.json()) as LiceMatchesPayload);
    } catch {
      // Network failure — deliberately keep the previous payload.
    } finally {
      setLoading(false);
    }
  }, [apiUrl, liceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch on mount; state is set after the await, not synchronously
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!liceId) return;
    return startPolling(refresh);
  }, [liceId, refresh]);

  return { data, loading, sessionExpired, refresh };
}

/**
 * Poll while the tablet is in the foreground, and catch up the moment it comes
 * back or regains the network. Returns the teardown.
 *
 * A backgrounded tablet is deliberately left alone: the operator is not looking
 * at it, and the `visibilitychange` refresh means it is current again before
 * they can read it.
 */
function startPolling(refresh: () => Promise<void>): () => void {
  const tick = () => {
    if (!document.hidden) void refresh();
  };
  const onWake = () => {
    if (document.visibilityState === 'visible') void refresh();
  };
  const timer = window.setInterval(tick, LICE_MATCHES_POLL_MS);
  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('focus', onWake);
  window.addEventListener('online', onWake);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onWake);
    window.removeEventListener('focus', onWake);
    window.removeEventListener('online', onWake);
  };
}
