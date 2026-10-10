'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ExchangeRow } from '@myclash/ui';
import { listAfterRead, readBoutList, type ShownList } from '../lib/bout-list-read';

// The wire shape is declared once in @myclash/ui (packages/ui/src/types/
// match-events.ts) because the shared timeline builder and the TV display need
// it too. Re-exported here so this hook stays the import site every consumer
// already uses. `export type` is required — isolatedModules is on.
export type { ExchangeRow };

const NO_ROWS: ExchangeRow[] = [];

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
  const [list, setList] = useState<ShownList<ExchangeRow> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!matchId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    // With no network the read gives the rows the tablet kept (`bout-list-read.ts`).
    void readBoutList<ExchangeRow>(apiUrl, matchId, 'exchanges', controller.signal).then((read) => {
      setLoading(false);
      if (controller.signal.aborted) return;
      setList((now) => listAfterRead(now, matchId, read));
      // The status alone: no screen shows this, and a sentence would need a key.
      if (read.kind === 'failed') setError(String(read.status));
    });
    return () => controller.abort();
  }, [apiUrl, matchId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh() kicks off the fetch (sets loading); intentional on mount/refresh.
    const cleanup = refresh();
    return cleanup;
  }, [refresh, refreshKey]);

  const exchanges = list?.rows ?? NO_ROWS;
  const active = exchanges.filter((row) => !row.voided);

  return { exchanges, active, loading, error, refresh };
}
