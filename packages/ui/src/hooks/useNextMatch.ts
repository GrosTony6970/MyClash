'use client';

import { useCallback, useEffect, useState } from 'react';

export interface NextMatchInfo {
  id: string;
  matchNumberLabel: string | null;
  roundCode: string | null;
  redName: string;
  blueName: string;
  redClub?: string | null;
  blueClub?: string | null;
}

interface UseNextMatchResult {
  next: NextMatchInfo | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetch the queue for a lice and return queue[0] — the match
 * scheduled immediately after the current one. Used to render the
 * "NEXT" tile in the top-right of the scoreboard header so the
 * referee can jump to the next match in one tap.
 *
 * Backed by `GET /api/v1/staff/lices/:liceId/current-match` which
 * returns `{ current, queue: [...] }` ordered by `scheduled_at`
 * ascending. We exclude the current match's id so the tile never
 * displays the same match the operator is on.
 *
 * **Requires staff auth.** Public surfaces (e.g. the TV display)
 * should read the next match from the `/matches/:id/display`
 * payload's `nextMatchId` field instead.
 *
 * Returns `null` for `next` when:
 *   - liceId is missing
 *   - queue is empty (last match of the day on this lice)
 *   - fetch failed (network down, or 401 because the caller
 *     isn't authenticated as staff)
 */
export function useNextMatch(
  apiUrl: string,
  liceId: string | null | undefined,
  currentMatchId: string | null | undefined,
  refreshKey: number,
): UseNextMatchResult {
  const [next, setNext] = useState<NextMatchInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!liceId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`${apiUrl}/api/v1/staff/lices/${liceId}/current-match`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load lice queue (HTTP ${res.status})`);
        const body = (await res.json()) as {
          queue?: Array<{
            id?: string;
            matchNumberLabel?: string | null;
            roundCode?: string | null;
            redFighterName?: string | null;
            blueFighterName?: string | null;
          }>;
        };
        const candidate = (body.queue ?? []).find((m) => m.id && m.id !== currentMatchId);
        if (!candidate) {
          setNext(null);
          return;
        }
        setNext({
          id: candidate.id as string,
          matchNumberLabel: candidate.matchNumberLabel ?? null,
          roundCode: candidate.roundCode ?? null,
          redName: candidate.redFighterName ?? '',
          blueName: candidate.blueFighterName ?? '',
          // Clubs aren't projected by the staff endpoint yet — leave
          // them null. The next-match tile gracefully omits the
          // "· {club}" suffix when null.
          redClub: null,
          blueClub: null,
        });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setNext(null);
      })
      .finally(() => {
        setLoading(false);
      });
    return () => controller.abort();
  }, [apiUrl, liceId, currentMatchId]);

  useEffect(() => {
    const cleanup = refresh();
    return cleanup;
  }, [refresh, refreshKey]);

  return { next, loading, error };
}
