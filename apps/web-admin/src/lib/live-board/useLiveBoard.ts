'use client';
import { useCallback, useEffect, useState } from 'react';
import { mergeRealtimePatch } from './live-board-merge';
import { fallbackTiming } from './live-board-timing';
import type {
  BoardRow,
  LiveBoardAccount,
  LiveBoardPayload,
  LiveBoardProgress,
  LiveBoardTiming,
  MatchChange,
} from './types';
import { getPublicApiUrl } from '@/lib/api-url';

const API = getPublicApiUrl();

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
  const [timing, setTiming] = useState<LiveBoardTiming | null>(null);
  const [progress, setProgress] = useState<LiveBoardProgress | null>(null);
  const [accounts, setAccounts] = useState<LiveBoardAccount[]>([]);
  const [eventSlug, setEventSlug] = useState<string | null>(null);
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
      const data = (await res.json()) as Partial<LiveBoardPayload>;
      setRows(data.rows ?? []);
      // `timing` is defaulted rather than required: a web-admin container can
      // deploy ahead of the API, and a board that renders no clock at all is a
      // worse failure than one measuring against a 5-minute default.
      setTiming(data.timing ?? fallbackTiming(Date.now()));
      setProgress(data.progress ?? null);
      setAccounts(data.accounts ?? []);
      setEventSlug(data.eventSlug ?? null);
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

  return {
    rows,
    timing,
    progress,
    accounts,
    eventSlug,
    error,
    refetch,
    acknowledge,
    applyMatchChange,
  };
}
