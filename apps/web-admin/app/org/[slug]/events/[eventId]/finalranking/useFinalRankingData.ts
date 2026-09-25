'use client';

/**
 * The final ranking's data for one Tournament: its bracket and its pool scores
 * (GET /tournaments/:id/bracket + GET /tournaments/:id/pool-standings?mode=overall),
 * kept live by the bracket phase's channel and the 30 s re-read beside it.
 */

import { useEffect, useState } from 'react';
import type { PoolEntry, RankingSlot } from '@myclash/ui';
import { apiRequest } from '@myclash/api-client';
import { useRealtimeWithFallback } from '@/lib/supabase-browser';
import { getPublicApiUrl } from '@/lib/api-url';

export interface BracketResponse {
  phaseId?: string;
  phaseType?: string;
  /** Double-elim round split — needed so the ranking places fighters by their
   *  losers-bracket exit rather than by the round of their first loss. */
  wbRounds?: number | null;
  lbRounds?: number | null;
  bronzeSlotId?: string | null;
  slots: RankingSlot[];
}

interface StandingsRow {
  registrationId: string;
  displayName: string;
  club: { name: string; abbreviation: string | null } | null;
  stats: Record<string, number | string>;
}

const apiUrl = getPublicApiUrl();

/** A Tournament's bracket and pool scores; null when either read failed or was aborted. */
async function readRanking(
  tournamentId: string,
  signal: AbortSignal,
): Promise<{ bracket: BracketResponse | null; poolEntries: PoolEntry[] } | null> {
  const [bracketResult, standingsResult] = await Promise.all([
    apiRequest<unknown>(apiUrl, `/api/v1/tournaments/${tournamentId}/bracket`, { signal }),
    apiRequest<unknown>(apiUrl, `/api/v1/tournaments/${tournamentId}/pool-standings?mode=overall`, {
      signal,
    }),
  ]);
  if (!bracketResult.ok || !standingsResult.ok) return null;
  const bracket = bracketResult.data as BracketResponse | null;
  const rows = (standingsResult.data as { rows?: StandingsRow[] } | null)?.rows ?? [];
  return {
    bracket: bracket && Array.isArray(bracket.slots) ? bracket : null,
    poolEntries: rows.map((row) => {
      const raw = row.stats?.['score'];
      const n = typeof raw === 'number' ? raw : Number(raw);
      return {
        registrationId: row.registrationId,
        fighterName: row.displayName,
        clubAbbrev: row.club?.abbreviation ?? row.club?.name ?? null,
        poolScore: Number.isFinite(n) ? n : null,
      };
    }),
  };
}

/** A filter that matches no bout, for the moment before a bracket is read. */
const NO_PHASE = '00000000-0000-0000-0000-000000000000';

/**
 * A newly chosen Tournament starts empty and "Loading…". A re-read of the same
 * one does neither: the ranking is re-read every 30 s (ruling 110a), and a
 * re-read must not unmount the table, or blank it on a blip.
 */
export function useFinalRankingData(selectedTournament: string): {
  bracket: BracketResponse | null;
  poolEntries: PoolEntry[];
  loading: boolean;
} {
  const [bracket, setBracket] = useState<BracketResponse | null>(null);
  const [poolEntries, setPoolEntries] = useState<PoolEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the panel when the Tournament changes
    setLoading(true);
    setBracket(null);
    setPoolEntries([]);
  }, [selectedTournament]);

  // Fetch bracket + pool standings for the selected tournament.
  useEffect(() => {
    if (!selectedTournament) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear loading flag when no tournament is selected
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    void readRanking(selectedTournament, controller.signal)
      .then((read) => {
        // A failed or aborted read keeps what is on screen.
        if (!read) return;
        setBracket(read.bracket);
        setPoolEntries(read.poolEntries);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [selectedTournament, refreshKey]);

  // Live-refresh on bracket-match changes (a finished match changes the ranking).
  const bracketPhaseId = bracket?.phaseId ?? null;
  useRealtimeWithFallback({
    channelName: bracketPhaseId ? `finalranking-${bracketPhaseId}` : 'finalranking-idle',
    table: 'matches',
    filter: `phase_id=eq.${bracketPhaseId ?? NO_PHASE}`,
    event: '*',
    onEvent: () => setRefreshKey((k) => k + 1),
    onFallbackPoll: () => setRefreshKey((k) => k + 1),
  });

  return { bracket, poolEntries, loading };
}
