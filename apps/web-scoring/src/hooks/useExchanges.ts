'use client';

import { useCallback, useEffect, useState } from 'react';

export interface ExchangeRow {
  id: string;
  sequence: number;
  type: 'clean' | 'afterblow' | 'double' | 'no_exchange';
  voided: boolean;
  occurredAt: string;
  /** Match-clock position (accumulated active ms) when recorded — drives
   *  the timeline's match-clock time. Null for legacy rows. */
  clockTimeMs?: number | null;
  /** Registration id of the fighter who scored, if applicable. */
  scoringRegistrationId?: string | null;
  /** Side of the scoring fighter — derived BE-side. */
  scoringSide?: 'red' | 'blue' | null;
  /** Numeric score delta for this exchange (positive for the scorer). */
  scoreDelta?: number | null;
  /** Defender delta (only for afterblow_full mode). */
  defenderDelta?: number | null;
}

interface UseExchangesResult {
  exchanges: ExchangeRow[];
  /** Non-voided exchanges only — what the operator typically wants. */
  active: ExchangeRow[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Centralised exchanges fetch. Used by:
 *   - the centre column's events list + "clear last exchange" button
 *   - the corrections drawer's exchange-selector
 *   - the X/Y double-count chip above the Double button
 *
 * One hook = one fetch per matchId = one source of truth. Re-fetches
 * when `refreshKey` is bumped by the caller (after scoring an
 * exchange, after a clock action, etc).
 */
export function useExchanges(
  apiUrl: string,
  matchId: string | null | undefined,
  refreshKey: number,
): UseExchangesResult {
  const [exchanges, setExchanges] = useState<ExchangeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!matchId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`${apiUrl}/api/v1/matches/${matchId}/exchanges`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load exchanges (HTTP ${res.status})`);
        }
        const rows = (await res.json()) as ExchangeRow[];
        setExchanges(rows);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
    return () => controller.abort();
  }, [apiUrl, matchId]);

  useEffect(() => {
    const cleanup = refresh();
    return cleanup;
  }, [refresh, refreshKey]);

  const active = exchanges.filter((row) => !row.voided);

  return { exchanges, active, loading, error, refresh };
}
