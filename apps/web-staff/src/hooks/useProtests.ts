'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MatchProtest } from '@myclash/ui';
import { listAfterRead, readBoutList, type ShownList } from '../lib/bout-list-read';

const NO_ROWS: MatchProtest[] = [];

/**
 * The bout's protests, as the server lists them. The mirror of `useExchanges`:
 * one read per `refreshKey`, and with no network the rows the tablet kept at
 * its last good read (`bout-list-read.ts`).
 *
 * Its one reader is `useMatchScoringData` (`scoring-data-single-reader.test.ts`):
 * a second caller would add a request to every scored hit.
 */
export function useProtests(
  apiUrl: string,
  matchId: string | null | undefined,
  refreshKey: number,
): { active: MatchProtest[] } {
  const [list, setList] = useState<ShownList<MatchProtest> | null>(null);

  const refresh = useCallback(() => {
    if (!matchId) return;
    const controller = new AbortController();
    void readBoutList<MatchProtest>(apiUrl, matchId, 'protests', controller.signal).then((read) => {
      if (controller.signal.aborted) return;
      setList((now) => listAfterRead(now, matchId, read));
    });
    return () => controller.abort();
  }, [apiUrl, matchId]);

  useEffect(() => {
    const cleanup = refresh();
    return cleanup;
  }, [refresh, refreshKey]);

  const rows = list?.rows ?? NO_ROWS;
  return { active: rows.filter((row) => !row.voided) };
}
