'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ExchangeRow } from '@myclash/ui';

// The wire shape is declared once in @myclash/ui (packages/ui/src/types/
// match-events.ts) because the shared timeline builder and the TV display need
// it too. Re-exported here so this hook stays the import site every consumer
// already uses. `export type` is required — isolatedModules is on.
export type { ExchangeRow };

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh() kicks off the fetch (sets loading); intentional on mount/refresh.
    const cleanup = refresh();
    return cleanup;
  }, [refresh, refreshKey]);

  const active = exchanges.filter((row) => !row.voided);

  return { exchanges, active, loading, error, refresh };
}
