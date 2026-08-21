'use client';

import { useCallback, useEffect, useState } from 'react';
import { failureFromError, type ApiFailure } from '@myclash/api-client';
import { api } from './api';

export interface RosterEntry {
  personId: string;
  givenName: string;
  familyName: string;
  clubName: string | null;
  clubLogoUrl: string | null;
  photoUrl: string | null;
  arrived: boolean;
  arrivedAt: string | null;
  via: string | null;
  /** The soonest bout this fighter is due on. Null when they have none. */
  next: NextMatch | null;
}

export interface NextMatch {
  scheduledAt: string | null;
  liceName: string | null;
  poolName: string | null;
  tournamentName: string | null;
}

/** The roster, and whether the event outgrew what one screen can hold. */
export interface RosterList {
  entries: RosterEntry[];
  truncated: boolean;
}

/**
 * Pure I/O — no state.
 *
 * At module scope so the mount effects can call it directly:
 * `react-hooks/set-state-in-effect` is an ERROR here (max-warnings 0) and it
 * flags any setState-containing function invoked synchronously in an effect
 * body. Keeping the fetch state-free means the effect is honest rather than
 * written around the rule.
 */
function fetchRoster(): Promise<RosterList> {
  return api.get<RosterList>('/api/v1/staff/checkin/roster');
}

/**
 * The check-in desk's data.
 *
 * Every write is followed by a refetch of the affected list rather than an
 * optimistic local edit. The desk is the one screen where two volunteers work
 * the same roster at once, so the server's answer — not this tablet's guess —
 * is what must appear: "already marked by someone else" has to be visible, and
 * an optimistic UI would hide exactly that.
 */
export function useDesk() {
  const reads = useDeskReads();
  const writes = useDeskWrites(reads.reload);
  return { ...reads, ...writes, error: reads.error ?? writes.error };
}

/**
 * The whole roster, held locally, plus the search box over it.
 *
 * ── Fetched once, not per keystroke ─────────────────────────────────────────
 * This used to send the search term to the server on a 250ms debounce and take
 * back at most 40 rows. It no longer does, and the reason is not speed: the
 * screen now groups the roster into tabs with a count on each, and a count is
 * only true of the list it was counted from. Search and filter run over the
 * same fetched array, so a tab reading "Not arrived (63)" has 63 rows behind
 * it. As a side effect the search stops touching the network at all, which is
 * the right behaviour on venue wifi.
 */
function useDeskReads() {
  const [query, setQuery] = useState('');
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiFailure | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRoster()
      .then((page) => {
        if (cancelled) return;
        setRoster(page.entries);
        setTruncated(page.truncated);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(failureFromError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async () => {
    const page = await fetchRoster();
    setRoster(page.entries);
    setTruncated(page.truncated);
  }, []);

  return { query, setQuery, roster, truncated, loading, error, reload };
}

/**
 * Mark present and undo.
 *
 * Both refetch rather than editing local state optimistically. The desk is the
 * one screen where two volunteers work the same roster at once, so the server's
 * answer — not this tablet's guess — is what must appear: "already marked by
 * someone else" has to be visible, and an optimistic UI would hide exactly
 * that.
 */
function useDeskWrites(reload: () => Promise<void>) {
  const [error, setError] = useState<ApiFailure | null>(null);

  // Void-returning on purpose: these are wired straight to onClick, and a
  // Promise-returning handler there is an eslint error (no-misused-promises)
  // because React neither awaits nor catches it. The catch below is what makes
  // a failed write visible instead of an unhandled rejection.
  const markArrived = useCallback(
    (personId: string, via: 'search' | 'qr' = 'search'): void => {
      setError(null);
      void api
        .post(`/api/v1/staff/checkin/${personId}/arrive`, { via })
        .then(() => reload())
        .catch((err: unknown) => setError(failureFromError(err)));
    },
    [reload],
  );

  const undoArrival = useCallback(
    (personId: string): void => {
      setError(null);
      void api
        .post(`/api/v1/staff/checkin/${personId}/undo`, {})
        .then(() => reload())
        .catch((err: unknown) => setError(failureFromError(err)));
    },
    [reload],
  );

  /**
   * The QR lane's write. Unlike the other two this RETURNS its promise rather
   * than swallowing it: the scan overlay needs both the resolved person (to show
   * the face it just admitted) and the failure (to say WHY a pass bounced), and
   * a void-returning handler could give it neither.
   *
   * It deliberately does not `reload()`. A queue of ten scans would be ten
   * roster refetches on venue wifi, and the overlay is not showing the roster —
   * the desk reloads once when the overlay closes.
   */
  const redeemPass = useCallback(
    (token: string): Promise<RosterEntry> =>
      api.post<RosterEntry>('/api/v1/staff/checkin/scan', { token }),
    [],
  );

  return { error, markArrived, undoArrival, redeemPass };
}
