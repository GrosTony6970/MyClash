'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { RosterEntry } from './useDesk';

export type GearResult = 'pass' | 'fail' | 'conditional';

export interface WeaponStatus {
  weaponId: string;
  weaponName: string;
  result: GearResult | null;
  reason: string | null;
  checkedAt: string | null;
}

export interface GearEntry {
  person: RosterEntry;
  weapons: WeaponStatus[];
}

const MIN_QUERY = 2;

/** Pure I/O — see the same note in useDesk.ts for why this is not inside the hook. */
function fetchGearRoster(term: string): Promise<GearEntry[]> {
  const trimmed = term.trim();
  const path =
    trimmed.length >= MIN_QUERY
      ? `/api/v1/staff/gear/roster?q=${encodeURIComponent(trimmed)}`
      : '/api/v1/staff/gear/roster';
  return api.get<GearEntry[]>(path);
}

function fetchGearSummary(): Promise<{ checked: number; total: number } | null> {
  return api
    .get<{ checked: number; total: number }>('/api/v1/staff/gear/summary')
    .catch(() => null);
}

/**
 * The gear-check desk's data.
 *
 * Mirrors `useDesk` deliberately — same debounce, same refetch-after-write, and
 * for the same reason: two volunteers can work one roster at once, so the
 * server's answer must appear rather than this tablet's guess.
 */
export function useGear() {
  const reads = useGearReads();
  const writes = useGearWrites(reads.reload);
  return { ...reads, ...writes, error: reads.error ?? writes.error };
}

/** The search box, its per-weapon results, and the checked/total counter. */
function useGearReads() {
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<GearEntry[]>([]);
  const [summary, setSummary] = useState<{ checked: number; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchGearRoster(query)
        .then((rows) => {
          if (!cancelled) setEntries(rows);
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
    void fetchGearSummary().then((next) => {
      if (!cancelled && next) setSummary(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async () => {
    const [rows, next] = await Promise.all([fetchGearRoster(query), fetchGearSummary()]);
    setEntries(rows);
    if (next) setSummary(next);
  }, [query]);

  return { query, setQuery, entries, summary, loading, error, reload };
}

/** Recording a result. Refetches rather than editing local state optimistically. */
function useGearWrites(reload: () => Promise<void>) {
  const [error, setError] = useState<string | null>(null);

  // Void-returning: wired straight to onClick, where a Promise-returning
  // handler is an eslint error because React neither awaits nor catches it.
  const recordCheck = useCallback(
    (personId: string, weaponId: string, result: GearResult, reason?: string): void => {
      setError(null);
      void api
        .post(`/api/v1/staff/gear/${personId}/${weaponId}`, {
          result,
          ...(reason ? { reason } : {}),
        })
        .then(() => reload())
        .catch(() => setError('write'));
    },
    [reload],
  );

  return { error, recordCheck };
}
