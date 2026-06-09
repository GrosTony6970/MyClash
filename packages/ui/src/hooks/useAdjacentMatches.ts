'use client';

import { useCallback, useEffect, useState } from 'react';
import type { NextMatchInfo } from './useNextMatch';

interface UseAdjacentMatchesResult {
  previous: NextMatchInfo | null;
  next: NextMatchInfo | null;
  loading: boolean;
  error: string | null;
}

interface NeighborTile {
  id?: string;
  matchNumberLabel?: string | null;
  roundCode?: string | null;
  redFighterName?: string | null;
  blueFighterName?: string | null;
  redClub?: string | null;
  blueClub?: string | null;
}

function toInfo(tile: NeighborTile | null | undefined): NextMatchInfo | null {
  if (!tile?.id) return null;
  return {
    id: tile.id,
    matchNumberLabel: tile.matchNumberLabel ?? null,
    roundCode: tile.roundCode ?? null,
    redName: tile.redFighterName ?? '',
    blueName: tile.blueFighterName ?? '',
    redClub: tile.redClub ?? null,
    blueClub: tile.blueClub ?? null,
  };
}

/**
 * Fetch the previous + next match on the same lice for the scoring
 * pad's header tiles. Backed by the PUBLIC
 * `GET /api/v1/matches/:id/neighbors` (so an organizer session works —
 * unlike `useNextMatch`, which reads the staff-only lice-queue endpoint
 * and 401s for admins). Re-fetches when `refreshKey` bumps.
 */
export function useAdjacentMatches(
  apiUrl: string,
  matchId: string | null | undefined,
  refreshKey: number,
): UseAdjacentMatchesResult {
  const [previous, setPrevious] = useState<NextMatchInfo | null>(null);
  const [next, setNext] = useState<NextMatchInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!matchId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`${apiUrl}/api/v1/matches/${matchId}/neighbors`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load adjacent matches (HTTP ${res.status})`);
        const body = (await res.json()) as {
          previous?: NeighborTile | null;
          next?: NeighborTile | null;
        };
        setPrevious(toInfo(body.previous));
        setNext(toInfo(body.next));
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setPrevious(null);
        setNext(null);
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

  return { previous, next, loading, error };
}
