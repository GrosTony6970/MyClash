'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MatchFormatConfig, TournamentScoringConfig } from '@myclash/types';

export type MatchStatus = 'scheduled' | 'running' | 'paused' | 'completed' | 'voided';

export interface DisplayMatch {
  id: string;
  status: MatchStatus;
  matchNumberLabel: string | null;
  /** Round code computed server-side: e.g. `LSW-QF-M1`, `RAP-P2-M5`. */
  roundCode?: string | null;
  redScore: number;
  blueScore: number;
  redFighterName: string | null;
  blueFighterName: string | null;
  rulesetCode: string;
  startedAt: string | null;
  endedAt: string | null;
  lice?: { name?: string } | null;
  event?: { name?: string } | null;
  tournament?: { name?: string; weapon?: string } | null;
  scoringConfig?: TournamentScoringConfig | null;
  matchFormat?: MatchFormatConfig | null;
  sideOrder?: 'red_left' | 'blue_left';
  poolName?: string | null;
  fightIndex?: number | null;
  totalFightsInPool?: number | null;
  redClub?: { name: string; logoUrl: string | null } | null;
  blueClub?: { name: string; logoUrl: string | null } | null;
  redRegistrationId?: string | null;
  blueRegistrationId?: string | null;
  /** External-display redesign: next match on this lice (for the
   *  corner NEXT tile + auto-rollover after MATCH ENDED). Public
   *  surfaces can rely on this without a second authenticated
   *  fetch. */
  nextMatchId?: string | null;
  nextMatch?: {
    id: string;
    matchNumberLabel: string | null;
    roundCode: string | null;
    redFighterName: string | null;
    blueFighterName: string | null;
  } | null;
}

export interface Penalty {
  id: string;
  card: 'yellow' | 'red' | 'black';
  registration_id: string;
  short_name: string | null;
  reason: string | null;
  voided: boolean;
}

export interface ClockSnapshot {
  status: 'idle' | 'running' | 'halted' | 'ended';
  activeMs: number;
  runningFrom: string | null;
}

export interface UseLiveMatchResult {
  match: DisplayMatch | null;
  penalties: Penalty[];
  clock: ClockSnapshot | null;
  /** Elapsed ms including the in-flight running interval, ticked
   *  every 50ms while the clock is running. */
  elapsedMs: number;
  loadError: { status: number; message: string } | null;
  refresh: () => Promise<void>;
}

function computeElapsedMs(state: ClockSnapshot): number {
  if (state.status !== 'running' || !state.runningFrom) return state.activeMs;
  return state.activeMs + Date.now() - new Date(state.runningFrom).getTime();
}

/**
 * Subscribe to a match's display state and keep it live.
 *
 * Resolves three endpoints in parallel:
 *   - `GET /api/v1/matches/:id/display`   (canonical scoreboard payload)
 *   - `GET /api/v1/matches/:id/penalties` (per-side card list)
 *   - `GET /api/v1/matches/:id/clock`     (state machine + activeMs)
 *
 * Subscribes to Supabase realtime postgres_changes on the `matches`,
 * `exchanges`, `match_penalties`, and `match_events` tables filtered
 * to this matchId. Any change triggers a refetch.
 *
 * Also runs a 50ms `setInterval` ticker while the clock is RUNNING
 * so the displayed timer doesn't visibly stutter.
 *
 * Used by:
 *   - `<MatchScoreboard>` (admin preview)
 *   - `<TVScoreboard>`   (public TV display)
 *
 * Both surfaces render different layouts on top of the same state —
 * this hook is the single source of truth for the data flow.
 */
export function useLiveMatch(
  apiBaseUrl: string,
  matchId: string,
  supabaseClient: SupabaseClient,
): UseLiveMatchResult {
  const [match, setMatch] = useState<DisplayMatch | null>(null);
  const [penalties, setPenalties] = useState<Penalty[]>([]);
  const [clock, setClock] = useState<ClockSnapshot | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [matchRes, penaltyRes, clockRes] = await Promise.all([
        fetch(`${apiBaseUrl}/api/v1/matches/${matchId}/display`, {
          cache: 'no-store',
          credentials: 'include',
        }),
        fetch(`${apiBaseUrl}/api/v1/matches/${matchId}/penalties`, {
          cache: 'no-store',
          credentials: 'include',
        }),
        fetch(`${apiBaseUrl}/api/v1/matches/${matchId}/clock`, {
          cache: 'no-store',
          credentials: 'include',
        }),
      ]);
      if (!matchRes.ok) {
        const body = (await matchRes.json().catch(() => null)) as { message?: string } | null;
        setLoadError({ status: matchRes.status, message: body?.message ?? matchRes.statusText });
        return;
      }
      setLoadError(null);
      setMatch((await matchRes.json()) as DisplayMatch);
      if (penaltyRes.ok) setPenalties((await penaltyRes.json()) as Penalty[]);
      if (clockRes.ok) {
        const nextClock = (await clockRes.json()) as ClockSnapshot;
        setClock(nextClock);
        setElapsedMs(computeElapsedMs(nextClock));
      }
    } catch (err) {
      setLoadError({
        status: 0,
        message: err instanceof Error ? err.message : 'Network error',
      });
    }
  }, [apiBaseUrl, matchId]);

  // Initial fetch
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async refresh updates state after server responses
    void refresh();
  }, [refresh]);

  // Supabase realtime subscription
  useEffect(() => {
    const channel = supabaseClient
      .channel(`match:${matchId}:display`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
        () => void refresh(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'exchanges', filter: `match_id=eq.${matchId}` },
        () => void refresh(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'match_penalties',
          filter: `match_id=eq.${matchId}`,
        },
        () => void refresh(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_events', filter: `match_id=eq.${matchId}` },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      void supabaseClient.removeChannel(channel);
    };
  }, [matchId, supabaseClient, refresh]);

  // Running-clock ticker
  useEffect(() => {
    if (clock?.status !== 'running') return;
    const timer = setInterval(() => setElapsedMs(computeElapsedMs(clock)), 50);
    return () => clearInterval(timer);
  }, [clock]);

  return { match, penalties, clock, elapsedMs, loadError, refresh };
}
