'use client';

import { useCallback, useEffect, useState } from 'react';
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
}

export interface NextMatch {
  scheduledAt: string | null;
  liceName: string | null;
  poolName: string | null;
  tournamentName: string | null;
}

export interface MissingFighter {
  person: RosterEntry;
  next: NextMatch | null;
}

/** Three letters is where the search becomes useful; below that the API ignores it. */
const MIN_QUERY = 2;

/**
 * Pure I/O — no state.
 *
 * At module scope so the mount effects can call it directly:
 * `react-hooks/set-state-in-effect` is an ERROR here (max-warnings 0) and it
 * flags any setState-containing function invoked synchronously in an effect
 * body. Keeping the fetch state-free means the effect is honest rather than
 * written around the rule.
 */
function fetchSummary(): Promise<{ arrived: number; total: number } | null> {
  return api
    .get<{ arrived: number; total: number }>('/api/v1/staff/checkin/summary')
    .catch(() => null);
}

function fetchRoster(term: string): Promise<RosterEntry[]> {
  const trimmed = term.trim();
  const path =
    trimmed.length >= MIN_QUERY
      ? `/api/v1/staff/checkin/roster?q=${encodeURIComponent(trimmed)}`
      : '/api/v1/staff/checkin/roster';
  return api.get<RosterEntry[]>(path);
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

/** The search box, its results, and the arrived/total counter. */
function useDeskReads() {
  const [query, setQuery] = useState('');
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [summary, setSummary] = useState<{ arrived: number; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounced so a volunteer typing a name does not fire one request per
  // keystroke on venue wifi. 250ms is below the threshold where the list feels
  // like it lags behind the keyboard.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchRoster(query)
        .then((rows) => {
          if (!cancelled) setRoster(rows);
        })
        .catch(() => {
          if (!cancelled) setError('load');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    // fetchSummary swallows its own errors — the counter is informational and
    // must never take the desk down with it.
    void fetchSummary().then((next) => {
      if (!cancelled && next) setSummary(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async () => {
    const [rows, next] = await Promise.all([fetchRoster(query), fetchSummary()]);
    setRoster(rows);
    if (next) setSummary(next);
  }, [query]);

  return { query, setQuery, roster, summary, loading, error, reload };
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
  const [error, setError] = useState<string | null>(null);

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
        .catch(() => setError('write'));
    },
    [reload],
  );

  const undoArrival = useCallback(
    (personId: string): void => {
      setError(null);
      void api
        .post(`/api/v1/staff/checkin/${personId}/undo`, {})
        .then(() => reload())
        .catch(() => setError('write'));
    },
    [reload],
  );

  return { error, markArrived, undoArrival };
}

/** The missing-at-risk list. Fetched on demand — it is a second screen, not the desk. */
export function useMissingAtRisk(enabled: boolean) {
  const [missing, setMissing] = useState<MissingFighter[]>([]);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api
      .get<MissingFighter[]>('/api/v1/staff/checkin/missing')
      .then((rows) => {
        if (!cancelled) setMissing(rows);
      })
      .catch(() => {
        if (!cancelled) setMissing([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { missing, loading };
}
