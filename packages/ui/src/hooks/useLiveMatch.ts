'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClockSnapshot, DisplayMatch, ExchangeRow, Penalty } from '../types/match-events';
import { deriveFreshness, livePollMs, type Freshness } from './realtime-freshness';
import { readLiveMatch } from './live-match-read';
import { createCoalescer, type Coalescer } from './coalesce';

// The wire shapes live in ../types/match-events (a leaf module the pure
// timeline utils can import without depending on this hook). Re-exported here
// so `@myclash/ui`'s long-standing public surface is unchanged.
export type {
  ClockEvent,
  ClockSnapshot,
  DisplayMatch,
  ExchangeRow,
  MatchStatus,
  Penalty,
  PenaltyCard,
} from '../types/match-events';

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
  /**
   * How fresh this surface's data is, as a state rather than a boolean —
   * `live` / `polling` / `stale` / `disabled`. Prefer this over `connected`:
   * a polling surface reports `connected: false` while being perfectly fresh,
   * which is the ambiguity that let a dead websocket look healthy for weeks.
   *
   * `connected` is kept because existing callers read it and it still answers
   * exactly what it claims — is the channel subscribed.
   */
  freshness: Freshness;
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
 * fallback for when that channel cannot carry the bout — see the parameter docs.
 *
 * Also runs a 50ms `setInterval` ticker while the clock is RUNNING
 * so the displayed timer doesn't visibly stutter.
 *
 * Used by:
 *   - `<MatchScoreboard>` (admin preview)
 *   - `<TVScoreboard>`   (public TV display)
 *   - `BoardRowTimeline` (organiser live board, one expanded row, no poll)
 *
 * The surfaces render different layouts on top of the same state —
 * this hook is the single source of truth for the data flow.
 */
export function useLiveMatch(
  apiBaseUrl: string,
  matchId: string,
  supabaseClient: SupabaseClient,
  /**
   * Fallback poll interval (ms), used ONLY while the channel cannot be trusted
   * to announce a change (`livePollMs`): it is down, the bout is hidden from
   * the public, or the last read failed. The poll fires once immediately and
   * stops when none of those holds. Any
   * unattended surface should set it: a channel that fails to join never
   * retries, and without a fallback the board freezes mid-bout showing stale
   * scores — which is exactly what happened to the public projector.
   *
   * It used to run unconditionally, IN ADDITION to realtime. That made a dead
   * websocket invisible: the public display polled four endpoints every 2s for
   * weeks while its socket 403'd, and looked perfectly healthy doing it.
   * web-admin's `useRealtimeWithFallback` does poll unconditionally, by ruling
   * (110a): its anonymous channel never carries a draft Event's rows. There only
   * its `[realtime] connected/dropped` console lines tell a dead socket apart.
   */
  pollMs?: number,
  /**
   * `disable_realtime`, from the public flags snapshot.
   *
   * This hook never used to know about the kill-switch, so the TV board and the
   * live-control-room timeline kept opening a websocket and showing a green LIVE
   * cue while an operator believed realtime was off. Passing the flag in — the
   * caller already has it via `useRuntimeFlags` — is what makes the chip honest
   * during an incident. Optional so existing callers keep working; they simply
   * keep the old blind spot until they pass it.
   */
  realtimeDisabled = false,
): UseLiveMatchResult {
  const [match, setMatch] = useState<DisplayMatch | null>(null);
  const [penalties, setPenalties] = useState<Penalty[]>([]);
  const [exchanges, setExchanges] = useState<ExchangeRow[]>([]);
  const [clock, setClock] = useState<ClockSnapshot | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [connected, setConnected] = useState(false);
  // The channel's own last word, kept separately from `connected` because
  // `deriveFreshness` distinguishes "never joined yet" (null) from "joined and
  // then dropped" — the first must not flash an alarm on page load.
  const [channelStatus, setChannelStatus] = useState<string | null>(null);
  // When a payload last landed. This, not the socket state, is what makes
  // "stale" answerable: a poll that stops landing is invisible to the channel.
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  // Tracks whether we were dropped, so a re-SUBSCRIBE backfills missed changes
  // (and the first SUBSCRIBE doesn't double-fetch over the initial load).
  const wasDisconnected = useRef(false);

  const refresh = useCallback(async () => {
    const read = await readLiveMatch(apiBaseUrl, matchId);
    if (!read.ok) {
      setLoadError(read.error);
      return;
    }
    setLoadError(null);
    // Stamped only on a SUCCESSFUL payload. Stamping on every attempt would
    // make a poll that fires and fails look exactly like one that works,
    // which is the whole condition `stale` exists to catch.
    setLastUpdateAt(Date.now());
    setMatch(read.match);
    if (read.penalties) setPenalties(read.penalties);
    if (read.exchanges) setExchanges(read.exchanges);
    if (read.clock) {
      setClock(read.clock);
      setElapsedMs(computeElapsedMs(read.clock));
    }
  }, [apiBaseUrl, matchId]);

  // Initial fetch
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async refresh updates state after server responses
    void refresh();
  }, [refresh]);

  /**
   * Realtime signals go through a coalescer; nothing else does.
   *
   * The channel binds four tables with `event: '*'`, and each handler used to
   * call `refresh` — four HTTP requests — directly. A bulk write like resetting
   * a 16-exchange match therefore fired ~64 requests at EVERY subscribed
   * display. See `coalesce.ts` for why the leading edge is kept.
   *
   * TWO REFS, and both are load-bearing. The coalescer's identity has to be
   * stable because it feeds the subscription effect below, and an identity that
   * churned would tear down and re-subscribe the channel on every render. But
   * `refresh` is `useCallback([apiBaseUrl, matchId])`, so it changes when the
   * match does — a coalescer built once around the FIRST `refresh` would go on
   * refetching the OLD match after a navigation. So the stable coalescer calls
   * through a ref that is kept current.
   */
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  const coalescerRef = useRef<Coalescer | null>(null);
  // Lazy: `useRef(createCoalescer(...))` would construct a throwaway coalescer
  // on every render, since the argument is evaluated before the ref is read.
  coalescerRef.current ??= createCoalescer(() => refreshRef.current(), 200);
  const scheduleRefresh = coalescerRef.current.schedule;

  // Supabase realtime subscription. Its status feeds the poll below.
  useEffect(() => {
    const channel = supabaseClient
      .channel(`match:${matchId}:display`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
        () => scheduleRefresh(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'exchanges', filter: `match_id=eq.${matchId}` },
        () => scheduleRefresh(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'match_penalties',
          filter: `match_id=eq.${matchId}`,
        },
        () => scheduleRefresh(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_events', filter: `match_id=eq.${matchId}` },
        () => scheduleRefresh(),
      )
      .subscribe((status) => {
        setChannelStatus(status);
        if (status === 'SUBSCRIBED') {
          setConnected(true);
          // Re-fetch to catch changes missed while the channel was down.
          if (wasDisconnected.current) {
            wasDisconnected.current = false;
            void refresh();
          }
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setConnected(false);
          wasDisconnected.current = true;
        }
      });
    return () => {
      // Drops a pending trailing refresh. Also what stops a debounce armed for
      // the OLD match firing after `matchId` changes.
      coalescerRef.current?.cancel();
      void supabaseClient.removeChannel(channel);
    };
  }, [matchId, supabaseClient, refresh, scheduleRefresh]);

  // A slow tick, running ONLY while degraded.
  //
  // `stale` is the one state that becomes true with no event to announce it —
  // nothing arriving is precisely the condition — so something has to re-render
  // for it to be noticed. Calling Date.now() during render would do it, but
  // that is an impure render (the React Compiler rejects it) and it would make
  // freshness a value that changes without anything re-rendering.
  //
  // Not started when live: a healthy page must not re-render once a second
  // forever, least of all a projector left running all weekend. `now` stays 0
  // until the first tick, which `deriveFreshness` clamps to an age of 0 — i.e.
  // "just degraded", which is exactly right for the first second.
  const degraded = channelStatus !== null && channelStatus !== 'SUBSCRIBED';
  useEffect(() => {
    if (!degraded) return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [degraded]);

  // The poll: while the channel is down, the bout is hidden from the public,
  // or the last read failed (`livePollMs`, ruling 92). One effect owns it, so a
  // channel drop and a hidden bout never run two timers at once.
  const pollEvery = livePollMs({ pollMs, channelStatus, connected, match, loadError });
  useEffect(() => {
    if (pollEvery === null) return;
    void refresh();
    const timer = setInterval(() => void refresh(), pollEvery);
    return () => clearInterval(timer);
  }, [pollEvery, refresh]);

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

  // Re-derived on every render rather than stored: `stale` is a function of how
  // long ago the last payload landed, so a stored value would only ever change
  // when something else re-rendered — i.e. it would go stale about staleness.
  // The clock ticker above already re-renders a running bout every 50ms, and an
  // idle one has nothing to report.
  const freshness = deriveFreshness({
    realtimeDisabled,
    channelStatus,
    pollMs,
    lastUpdateAt,
    now,
  });

  return {
    match,
    penalties,
    exchanges,
    clock,
    elapsedMs,
    loadError,
    connected,
    freshness,
    refresh,
  };
}
