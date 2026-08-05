'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { supabase } from '@/lib/supabase';
import { fallbackPollMs, shouldStartFallbackPoll } from './realtime-fallback';
import {
  mapMatchRow,
  type ExchangeRow,
  type ExchangeType,
  type MatchPenaltyRow,
  type MatchRow,
} from './match-row';

// Supabase Realtime postgres_changes payloads use raw DB column names (snake_case).
interface ExchangeChangeRaw {
  id: string;
  match_id: string;
  sequence: number;
  type: ExchangeType;
  first_striker_color: 'red' | 'blue' | null;
  afterblow_value: number | null;
  no_exchange_reason: string | null;
  red_score_delta: number;
  blue_score_delta: number;
  clock_time_ms: number | null;
  round_number: number | null;
  occurred_at: string;
  voided: boolean;
}

interface MatchPenaltyChangeRaw extends MatchPenaltyRow {
  match_id: string;
}

/**
 * Derive the API's exchange aliases from a raw realtime row, so realtime and
 * server-fetched rows share one shape.
 */
function toExchangeRow(raw: ExchangeChangeRaw): ExchangeRow {
  const scoringSide =
    raw.type === 'clean' || raw.type === 'afterblow' ? raw.first_striker_color : null;
  const scoreDelta =
    scoringSide === 'red'
      ? raw.red_score_delta
      : scoringSide === 'blue'
        ? raw.blue_score_delta
        : null;
  // Defender's NETTED afterblow points (the opposite side's delta) — 0 in
  // deductive mode, the raw afterblow in full. Mirrors the API's listExchanges.
  const defenderDelta =
    raw.type === 'afterblow'
      ? scoringSide === 'red'
        ? raw.blue_score_delta
        : scoringSide === 'blue'
          ? raw.red_score_delta
          : null
      : null;
  return {
    id: raw.id,
    sequence: raw.sequence,
    type: raw.type,
    voided: raw.voided,
    // REQUIRED by the shared timeline: `orderedWithNumbers` sorts on it, so a
    // live-inserted row missing it would sort to the front of the ascending
    // pass and get numbered #1 until the next refresh repaired it.
    occurredAt: raw.occurred_at,
    no_exchange_reason: raw.no_exchange_reason,
    scoringSide,
    scoreDelta,
    defenderDelta,
    clockTimeMs: raw.clock_time_ms,
    // Carried so a live-inserted row can be filtered to the open round like a
    // fetched one; without it a best-of bout's flow would fold every round in.
    round_number: raw.round_number,
  };
}

/** Visibility as an external store, so the interval is DERIVED in render rather
 *  than pushed through an effect (`react-hooks/set-state-in-effect` is an error
 *  here, and a subscription is what useSyncExternalStore is for). */
function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === 'visible',
    // Server render: assume visible, so the first client paint agrees with the
    // markup and the interval only ever narrows after hydration.
    () => true,
  );
}

export interface MatchLiveChannelOptions {
  matchId: string;
  /** A completed / voided match is static — no channel, no poll, no banner. */
  isFinal: boolean;
  /**
   * Current `matches.status`. Drives the fallback cadence only — a running bout
   * is refetched every few seconds, anything else slowly. Deliberately NOT a
   * dependency of the channel effect: a status change must not tear down and
   * rejoin the websocket.
   */
  matchStatus: string;
  /** `disable_realtime` kill-switch: skip the websocket, poll only. */
  realtimeDisabled: boolean;
  /**
   * Full refetch INCLUDING `/summary`. Used for the reconnect backfill, where a
   * referee or config change made during the outage has to land too.
   */
  refresh: () => Promise<void>;
  /** Volatile-state refetch, no `/summary`. Used by the fallback poll. */
  refreshLive: () => Promise<void>;
  setMatch: Dispatch<SetStateAction<MatchRow>>;
  setExchanges: Dispatch<SetStateAction<ExchangeRow[]>>;
  setPenalties: Dispatch<SetStateAction<MatchPenaltyRow[]>>;
}

/**
 * Keeps the public match page live: a Supabase realtime channel with five
 * `postgres_changes` bindings, plus a polling fallback for when that channel
 * cannot connect.
 *
 * The fallback is not optional decoration. Two failure modes reach it:
 *
 *   1. The `disable_realtime` kill-switch, flipped during an incident.
 *   2. A websocket that will not open at all. Under `deploy.sh --dev-certs` the
 *      edge serves Let's Encrypt STAGING certificates; a browser lets a visitor
 *      click through the interstitial to LOAD the page but does not extend that
 *      exception to the WebSocket handshake, so supabase-js reports
 *      CHANNEL_ERROR and never rejoins. Before this fallback existed the page
 *      froze on its server-rendered snapshot for the rest of the bout, showing a
 *      "Reconnecting…" banner that never resolved.
 *
 * The poll is a SECOND effect, not part of the channel effect, so that changing
 * its cadence (status, tab visibility) never tears down and rejoins the
 * websocket. The two still cannot run at once: the poll is gated on `degraded`,
 * which the subscribe callback clears the instant the channel reports
 * SUBSCRIBED. That state gate — not shared closure scope — is what keeps them
 * mutually exclusive, which is the property the surfaces that learned this the
 * hard way actually needed (see `useLiveMatch` in `@myclash/ui`).
 *
 * Returns the channel's connection state. The caller still owns the banner
 * decision (`showReconnecting`) — while the poll is carrying the page, realtime
 * genuinely IS down, so reporting it is honest.
 */
export function useMatchLiveChannel({
  matchId,
  isFinal,
  matchStatus,
  realtimeDisabled,
  refresh,
  refreshLive,
  setMatch,
  setExchanges,
  setPenalties,
}: MatchLiveChannelOptions): boolean {
  // Optimistic: the banner must not flash in the moment before the channel
  // reports SUBSCRIBED.
  const [connected, setConnected] = useState(true);
  const wasDisconnected = useRef(false);
  const visible = useDocumentVisible();

  // The kill-switch degrades us before any channel exists, so it is folded in
  // here rather than tracked as state.
  const degraded = realtimeDisabled || !connected;
  const pollMs = fallbackPollMs({ status: matchStatus, visible });

  useEffect(() => {
    if (isFinal || !degraded) return;
    // Fire once immediately: on entering degraded the page is stale from this
    // instant, and on a cadence change the new speed should take effect now.
    void refreshLive();
    const timer = setInterval(() => void refreshLive(), pollMs);
    return () => clearInterval(timer);
  }, [isFinal, degraded, pollMs, refreshLive]);

  useEffect(() => {
    // Finished matches don't stream — no channel at all.
    if (isFinal) return;
    // Kill-switch path: no websocket. `degraded` is already true, so the poll
    // effect above is running; there is nothing to do here.
    if (realtimeDisabled) return;

    const channel = supabase
      .channel(`match:${matchId}:live`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'exchanges', filter: `match_id=eq.${matchId}` },
        (payload) => {
          const raw = payload.new as ExchangeChangeRaw;
          setExchanges((prev) => {
            if (prev.some((e) => e.id === raw.id)) return prev;
            return [...prev, toExchangeRow(raw)];
          });
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'exchanges', filter: `match_id=eq.${matchId}` },
        (payload) => {
          const raw = payload.new as ExchangeChangeRaw;
          setExchanges((prev) => prev.map((e) => (e.id === raw.id ? toExchangeRow(raw) : e)));
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'match_penalties',
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const raw = payload.new as MatchPenaltyChangeRaw;
          setPenalties((prev) => {
            if (prev.some((penalty) => penalty.id === raw.id)) return prev;
            return [...prev, raw];
          });
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'match_penalties',
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const raw = payload.new as MatchPenaltyChangeRaw;
          setPenalties((prev) => prev.map((penalty) => (penalty.id === raw.id ? raw : penalty)));
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
        (payload) => {
          setMatch(mapMatchRow(payload.new as Record<string, unknown>));
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Clears `degraded`, which stops the poll effect.
          setConnected(true);
          // Re-fetch to catch any changes missed during the disconnection window.
          if (wasDisconnected.current) {
            wasDisconnected.current = false;
            void refresh();
          }
        } else if (shouldStartFallbackPoll(status)) {
          // Sets `degraded`, which starts the poll effect.
          setConnected(false);
          wasDisconnected.current = true;
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [matchId, isFinal, realtimeDisabled, refresh, setMatch, setExchanges, setPenalties]);

  return connected;
}
