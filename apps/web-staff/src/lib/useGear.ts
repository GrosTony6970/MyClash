'use client';

import { useCallback, useEffect, useState } from 'react';
import { failureFromError, type ApiFailure } from '@myclash/api-client';
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

/** The roster, and whether the event outgrew what one screen can hold. */
export interface GearList {
  entries: GearEntry[];
  truncated: boolean;
}

/** Pure I/O — see the same note in useDesk.ts for why this is not inside the hook. */
function fetchGearRoster(): Promise<GearList> {
  return api.get<GearList>('/api/v1/staff/gear/roster');
}

/**
 * The gear-check desk's data.
 *
 * Mirrors `useDesk` deliberately — one fetch, same refetch-after-write, and for
 * the same reason: two volunteers can work one roster at once, so the server's
 * answer must appear rather than this tablet's guess.
 */
export function useGear() {
  const reads = useGearReads();
  const writes = useGearWrites(reads.reload);
  return { ...reads, ...writes, error: reads.error ?? writes.error };
}

/**
 * The whole roster with its per-weapon results, held locally.
 *
 * Fetched once rather than per keystroke, for the same reason as the desk: the
 * screen groups fighters into pass / conditional / fail / still-to-check tabs
 * and puts a count on each, and a count is only true of the list it was counted
 * from.
 */
function useGearReads() {
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<GearEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiFailure | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchGearRoster()
      .then((page) => {
        if (cancelled) return;
        setEntries(page.entries);
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
    const page = await fetchGearRoster();
    setEntries(page.entries);
    setTruncated(page.truncated);
  }, []);

  return { query, setQuery, entries, truncated, loading, error, reload };
}

/** Recording a result. Refetches rather than editing local state optimistically. */
function useGearWrites(reload: () => Promise<void>) {
  const [error, setError] = useState<ApiFailure | null>(null);

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
        .catch((err: unknown) => setError(failureFromError(err)));
    },
    [reload],
  );

  return { error, recordCheck };
}
