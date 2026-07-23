'use client';
import { useCallback, useEffect, useState } from 'react';
import { mergeRealtimePatch } from './live-board-merge';
import type { BoardRow, MatchChange } from './types';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

/**
 * Two coordinated sources behind one row-state:
 *   • an always-on 7 s structural poll (rollover, health, attention, next-up,
 *     and a score fallback when the socket is down) — the source of truth;
 *   • `applyMatchChange`, fed by the per-lice anon realtime subscriber, patches
 *     a single score cell instantly between polls.
 * `acknowledge` is the only write: optimistic-clear the flag, reconcile on
 * failure. Errors keep the last-known rows on screen — the board never blanks.
 */
export function useLiveBoard(eventId: string) {
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [error, setError] = useState<'refresh' | 'forbidden' | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/events/${eventId}/live-board`, {
        credentials: 'include',
      });
      if (res.status === 403) {
        setError('forbidden');
        return;
      }
      if (!res.ok) {
        setError('refresh');
        return;
      }
      const data = (await res.json()) as { rows: BoardRow[] };
      setRows(data.rows);
      setError(null);
    } catch {
      setError('refresh'); // keep last-known rows, never blank
    }
  }, [eventId]);

  // Always-on structural poll (rollover, health, attention, scores fallback).
  // The initial fetch is deferred to a 0ms timer rather than called inline so
  // the setState it triggers isn't flagged as a synchronous set-state-in-effect.
  useEffect(() => {
    const initial = window.setTimeout(() => void refetch(), 0);
    const id = window.setInterval(() => void refetch(), 7000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(id);
    };
  }, [refetch]);

  // Instant score patch from a per-lice realtime subscriber.
  const applyMatchChange = useCallback(
    (change: MatchChange) => {
      setRows((prev) => {
        if (!prev) return prev;
        const { rows: next, shouldRefetch } = mergeRealtimePatch(prev, change);
        if (shouldRefetch) void refetch();
        return next;
      });
    },
    [refetch],
  );

  const acknowledge = useCallback(
    async (staffAccountId: string) => {
      // optimistic: clear the flag locally, revert on failure
      setRows(
        (prev) =>
          prev?.map((r) =>
            r.scorer?.accountId === staffAccountId ? { ...r, attention: null } : r,
          ) ?? prev,
      );
      try {
        const res = await fetch(
          `${API}/api/v1/events/${eventId}/live/attention/${staffAccountId}/ack`,
          { method: 'POST', credentials: 'include' },
        );
        if (!res.ok) void refetch(); // revert to server truth
      } catch {
        void refetch();
      }
    },
    [eventId, refetch],
  );

  return { rows, error, refetch, acknowledge, applyMatchChange };
}
