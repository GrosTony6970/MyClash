'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MatchFormatConfig, PhaseType, TournamentScoringConfig } from '@myclash/types';
import type { ClockEvent, ExchangeRow, MatchStatus, Penalty } from '../types/match-events';

// The wire shapes live in ../types/match-events (a leaf module the pure
// timeline utils can import without depending on this hook). Re-exported here
// so `@myclash/ui`'s long-standing public surface is unchanged.
export type {
  ClockEvent,
  ExchangeRow,
  MatchStatus,
  Penalty,
  PenaltyCard,
} from '../types/match-events';

export interface DisplayMatch {
  id: string;
  status: MatchStatus;
  /**
   * `phases.type` for this match. Selects which `timeLimitsSeconds` entry the
   * clock counts against — without it a pool bout is billed at the bracket
   * limit, which is what the projector did for every match until now. Optional
   * because a payload predating the projection resolves to the bracket limit,
   * the same default the engine uses for an unknown phase.
   */
  phaseType?: PhaseType | null;
  matchNumberLabel: string | null;
  /** Round code computed server-side: e.g. `LSW-QF-M1`, `RAP-P2-M5`. */
  roundCode?: string | null;
  redScore: number;
  blueScore: number;
  redFighterName: string | null;
  blueFighterName: string | null;
  /** Fighter photos for the scoreboard avatar — resolved server-side from
   *  the global identity (global_persons.photo_url). Null when the fighter
   *  has no photo or isn't linked to a global person. */
  redFighterPhotoUrl?: string | null;
  blueFighterPhotoUrl?: string | null;
  rulesetCode: string;
  startedAt: string | null;
  endedAt: string | null;
  /** Why the match ended: 'first_to_points' | 'time_limit' | 'max_doubles'.
   *  'max_doubles' = double-cap reached → DOUBLE LOSS (both scores 0, no
   *  winner). Null on manual clock-end / forfeit / legacy rows. */
  endReason?: string | null;
  /** Winner's registration id when the ruleset declared one (point cap).
   *  Null for a double loss / tie / not-yet-decided. */
  winnerRegistrationId?: string | null;
  lice?: { name?: string } | null;
  event?: { name?: string } | null;
  tournament?: { name?: string; weapon?: string } | null;
  scoringConfig?: TournamentScoringConfig | null;
  matchFormat?: MatchFormatConfig | null;
  // Best-of-N round state. `bestOf` is the EFFECTIVE number for this match's
  // phase, resolved server-side (1 = single round → the round UI stays hidden).
  bestOf?: number;
  currentRound?: number;
  redRoundWins?: number;
  blueRoundWins?: number;
  awaitingRoundAdvance?: boolean;
  sideOrder?: 'red_left' | 'blue_left';
  poolName?: string | null;
  /** Round token naming this match's phase — `SF`, `R16`, `PI`, `GF`, `LB2`,
   *  `S3` for Swiss. Null for pool matches (which carry poolName instead).
   *  Expand with `roundTokenLabel()` from `@myclash/types`; never render the
   *  raw token at an audience. Drives the TV header context line. */
  roundToken?: string | null;
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

export interface ClockSnapshot {
  status: 'idle' | 'running' | 'halted' | 'ended';
  activeMs: number;
  runningFrom: string | null;
  /**
   * The transitions `activeMs` was folded from. The endpoint has always
   * returned these; this type simply dropped them. The bout-flow chart replays
   * them to position its stoppage markers — `activeMs` alone cannot say WHERE
   * the clock stopped, only how much ran in total.
   */
  events?: ClockEvent[];
}

export interface UseLiveMatchResult {
  match: DisplayMatch | null;
  penalties: Penalty[];
  /** Scoring exchanges, oldest-first. Includes voided rows — the unified
   *  timeline filters them so numbering stays consistent across surfaces. */
  exchanges: ExchangeRow[];
  clock: ClockSnapshot | null;
  /** Elapsed ms including the in-flight running interval, ticked
   *  every 50ms while the clock is running. */
  elapsedMs: number;
  loadError: { status: number; message: string } | null;
  /**
   * Realtime channel connection: `true` once the Supabase channel reports
   * SUBSCRIBED, `false` on CLOSED / CHANNEL_ERROR / TIMED_OUT. Lets a display
   * surface a "live vs reconnecting" cue. NOTE: surfaces using `pollMs` stay
   * fresh via the poll even when this is `false`, so they should treat a live
   * poll as connected (see TVScoreboard).
   */
  connected: boolean;
  refresh: () => Promise<void>;
}

function computeElapsedMs(state: ClockSnapshot): number {
  if (state.status !== 'running' || !state.runningFrom) return state.activeMs;
  return state.activeMs + Date.now() - new Date(state.runningFrom).getTime();
}

/**
 * Subscribe to a match's display state and keep it live.
 *
 * Resolves four endpoints in parallel:
 *   - `GET /api/v1/matches/:id/display`   (canonical scoreboard payload)
 *   - `GET /api/v1/matches/:id/penalties` (per-side card list)
 *   - `GET /api/v1/matches/:id/exchanges` (scoring timeline rows)
 *   - `GET /api/v1/matches/:id/clock`     (state machine + activeMs)
 * All four are `@Public()` — `/clock` was not, and resolved for an anonymous
 * projector only because the global AuthGuard runs in shadow mode; enforcing
 * the guard would have 401'd it into the `clockRes.ok` guard below, which
 * swallows the failure and leaves a frozen clock with no error. The @Public()
 * set is pinned in apps/api/src/common/auth/public-routes.test.ts.
 *
 * Subscribes to Supabase realtime postgres_changes on the `matches`,
 * `exchanges`, `match_penalties`, and `match_events` tables filtered
 * to this matchId. Any change triggers a refetch. `pollMs` is the
 * fallback for while that channel is down — see the parameter docs.
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
  /**
   * Fallback poll interval (ms), used ONLY while the realtime channel is down.
   * The poll starts on CLOSED / CHANNEL_ERROR / TIMED_OUT (firing once
   * immediately) and stops the moment the channel reports SUBSCRIBED. Any
   * unattended surface should set it: a channel that fails to join never
   * retries, and without a fallback the board freezes mid-bout showing stale
   * scores — which is exactly what happened to the public projector.
   *
   * It used to run unconditionally, IN ADDITION to realtime. That made a dead
   * websocket invisible: the public display polled four endpoints every 2s for
   * weeks while its socket 403'd, and looked perfectly healthy doing it. Same
   * contract as `useRealtimeWithFallback` in the apps now.
   */
  pollMs?: number,
): UseLiveMatchResult {
  const [match, setMatch] = useState<DisplayMatch | null>(null);
  const [penalties, setPenalties] = useState<Penalty[]>([]);
  const [exchanges, setExchanges] = useState<ExchangeRow[]>([]);
  const [clock, setClock] = useState<ClockSnapshot | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [connected, setConnected] = useState(false);
  // Tracks whether we were dropped, so a re-SUBSCRIBE backfills missed changes
  // (and the first SUBSCRIBE doesn't double-fetch over the initial load).
  const wasDisconnected = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [matchRes, penaltyRes, exchangeRes, clockRes] = await Promise.all([
        fetch(`${apiBaseUrl}/api/v1/matches/${matchId}/display`, {
          cache: 'no-store',
          credentials: 'include',
        }),
        fetch(`${apiBaseUrl}/api/v1/matches/${matchId}/penalties`, {
          cache: 'no-store',
          credentials: 'include',
        }),
        fetch(`${apiBaseUrl}/api/v1/matches/${matchId}/exchanges`, {
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
      if (exchangeRes.ok) setExchanges((await exchangeRes.json()) as ExchangeRow[]);
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

  // Supabase realtime subscription, with `pollMs` as its fallback. Both live
  // in one effect because the channel's status IS what starts and stops the
  // poll — splitting them is what let the two run at once.
  useEffect(() => {
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (pollTimer !== null || !pollMs || pollMs <= 0) return;
      // Fire once immediately: the caller is degraded from this instant, not
      // one interval from now.
      void refresh();
      pollTimer = setInterval(() => void refresh(), pollMs);
    };
    const stopPolling = () => {
      if (pollTimer === null) return;
      clearInterval(pollTimer);
      pollTimer = null;
    };

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
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnected(true);
          stopPolling();
          // Re-fetch to catch changes missed while the channel was down.
          if (wasDisconnected.current) {
            wasDisconnected.current = false;
            void refresh();
          }
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setConnected(false);
          wasDisconnected.current = true;
          startPolling();
        }
      });
    return () => {
      stopPolling();
      void supabaseClient.removeChannel(channel);
    };
  }, [matchId, supabaseClient, refresh, pollMs]);

  // Running-clock ticker
  useEffect(() => {
    if (clock?.status !== 'running') return;
    const timer = setInterval(() => setElapsedMs(computeElapsedMs(clock)), 50);
    return () => clearInterval(timer);
  }, [clock]);

  // Catch up the moment the screen comes back or regains the network. A
  // projector that was asleep, a laptop lid reopened, or a venue wifi blip all
  // land here — and none of them fire a postgres_changes event for what was
  // missed, so without this the board resumes showing stale state. Mirrors the
  // wake-up handling the scoring tablets already use (useLiceMatches).
  useEffect(() => {
    const onWake = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onWake);
    return () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', onWake);
    };
  }, [refresh]);

  return { match, penalties, exchanges, clock, elapsedMs, loadError, connected, refresh };
}
