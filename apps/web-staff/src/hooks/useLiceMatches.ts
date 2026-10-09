'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LiceMatchesPayload } from '../components/lice-match-types';
import { classifySyncFailure, type FailureBody } from '../offline/failure-kind';

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
  /** True when the last read found no network. With `data` null: nothing to show yet. */
  unreachable: boolean;
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
  const [unreachable, setUnreachable] = useState(false);

  const refresh = useCallback(async () => {
    if (!liceId) return;
    const online = typeof navigator === 'undefined' || navigator.onLine;
    const read = await readLiceMatches(`${apiUrl}/api/v1/staff/lices/${liceId}/matches`, online);
    if (read.kind === 'signedOut') setSessionExpired(true);
    // Any other answer deliberately keeps the previous payload.
    if (read.kind === 'data') setData(read.data);
    setUnreachable(read.kind === 'unreachable');
    // After EVERY read. It sat in a `finally` whose `try` the offline return
    // never entered, so a piste opened with no network said "Loading" for ever.
    setLoading(false);
  }, [apiUrl, liceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch on mount; state is set after the await, not synchronously
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!liceId) return;
    return startPolling(refresh);
  }, [liceId, refresh]);

  return { data, loading, sessionExpired, unreachable, refresh };
}

export type LiceRead =
  | { kind: 'data'; data: LiceMatchesPayload }
  | { kind: 'signedOut' }
  /** No network: the browser says so, the service worker says so, or nothing answered. */
  | { kind: 'unreachable' }
  /** The server answered, and not with the list. */
  | { kind: 'failed' };

/**
 * One read of the lice's matches, and what it means for the screen.
 *
 * With no network the request is not sent: it would fail anyway. The service
 * worker answers a synthetic 503 for a dead network instead of throwing, so
 * "no network" is asked of `classifySyncFailure`, its one owner.
 */
export async function readLiceMatches(
  url: string,
  online: boolean,
  fetchFn: typeof fetch = fetch,
): Promise<LiceRead> {
  if (!online) return { kind: 'unreachable' };
  let res: Response;
  try {
    res = await fetchFn(url, { credentials: 'include', cache: 'no-store' });
  } catch {
    return { kind: 'unreachable' };
  }
  if (res.status === 401 || res.status === 403) return { kind: 'signedOut' };
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as FailureBody | null;
    const offline = classifySyncFailure(res.status, body) === 'offline';
    return { kind: offline ? 'unreachable' : 'failed' };
  }
  try {
    return { kind: 'data', data: (await res.json()) as LiceMatchesPayload };
  } catch {
    return { kind: 'failed' };
  }
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
