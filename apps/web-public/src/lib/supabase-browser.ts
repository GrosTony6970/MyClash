'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useRef } from 'react';
import { getRuntimeFlagsCached, useRuntimeFlags } from '@myclash/ui';
import { getPublicApiUrl } from './api-url';
import { supabase } from './supabase';

export interface UseRealtimeOptions {
  /** Unique channel name per page/tab. */
  channelName: string;
  /** Table to subscribe to (e.g. 'matches'). */
  table: string;
  /** PostgREST-style filter expression, e.g. `pool_id=in.(a,b)`. */
  filter: string;
  /** Postgres event to listen for. Defaults to '*' (all). */
  event?: '*' | 'INSERT' | 'UPDATE' | 'DELETE';
  /** Called once per realtime event while the websocket is healthy. */
  onEvent: (payload: {
    new: Record<string, unknown> | null;
    old: Record<string, unknown> | null;
    eventType: string;
  }) => void;
  /** Called every fallbackPollMs while the websocket is disconnected. */
  onFallbackPoll: () => void;
  /** Polling interval (ms) used while the websocket is unhealthy. Default 30s. */
  fallbackPollMs?: number;
  /** When false, neither subscribes nor polls (e.g. nothing to watch yet). */
  enabled?: boolean;
}

const API_URL = getPublicApiUrl();

/**
 * Hook exposing the `disable_realtime` kill-switch state — for consumers whose
 * realtime handling is too bespoke for {@link useRealtimeWithFallback} (e.g.
 * the match live view's incremental payload appends).
 */
export function useRealtimeDisabled(): boolean {
  const flags = useRuntimeFlags(API_URL);
  return (flags ?? getRuntimeFlagsCached(API_URL)).realtimeDisabled === true;
}

/**
 * Port of web-admin's flag-aware realtime subscription (supabase-browser.ts).
 * web-public's ~10 realtime consumers used the bare client and ignored the
 * `disable_realtime` kill-switch — flipping it during an incident silenced
 * only the admin app while the high-traffic public surface kept hammering
 * websockets.
 *
 * Behavior:
 *   • If the `disable_realtime` feature flag is on, skip the websocket
 *     entirely and run only the polling loop. We re-subscribe to the
 *     runtime-flags cache so flipping the flag mid-session re-runs this
 *     effect and either reattaches or detaches the channel.
 *   • On SUBSCRIBED → stop polling.
 *   • On CHANNEL_ERROR / TIMED_OUT / CLOSED → start polling (or keep polling
 *     if we never connected). Polling resumes the live view as soon as the
 *     channel re-subscribes successfully.
 *   • On unmount → stop polling AND remove the channel.
 */
export function useRealtimeWithFallback(opts: UseRealtimeOptions): void {
  const pollTimerRef = useRef<number | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const wasConnectedRef = useRef(false);

  const realtimeDisabled = useRealtimeDisabled();

  useEffect(() => {
    if (opts.enabled === false) return;
    function startPolling() {
      if (pollTimerRef.current !== null) return;
      // Fire once immediately so the consumer sees fresh data without
      // waiting a full interval — matches the WS connected→data path.
      opts.onFallbackPoll();
      pollTimerRef.current = window.setInterval(
        () => opts.onFallbackPoll(),
        opts.fallbackPollMs ?? 30_000,
      );
    }
    function stopPolling() {
      if (pollTimerRef.current === null) return;
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    // Kill-switch path: skip the websocket entirely.
    if (realtimeDisabled) {
      console.info(`[realtime] disabled by flag, polling only: ${opts.channelName}`);
      startPolling();
      return () => {
        stopPolling();
      };
    }

    const channel = supabase
      .channel(opts.channelName)
      .on(
        'postgres_changes',
        {
          event: opts.event ?? '*',
          schema: 'public',
          table: opts.table,
          filter: opts.filter,
        } as never,
        (payload: {
          new?: Record<string, unknown>;
          old?: Record<string, unknown>;
          eventType: string;
        }) =>
          opts.onEvent({
            new: (payload.new ?? null) as Record<string, unknown> | null,
            old: (payload.old ?? null) as Record<string, unknown> | null,
            eventType: payload.eventType,
          }),
      )
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          if (wasConnectedRef.current) {
            console.info(`[realtime] reconnected: ${opts.channelName}`);
            // Backfill what the socket missed while it was down. Without this
            // the reconnect only stopped the poll, so the last thing to change
            // during the outage was never picked up — on the per-lice display
            // that meant the page could sit on a finished match indefinitely.
            opts.onFallbackPoll();
          } else {
            console.info(`[realtime] connected: ${opts.channelName}`);
            wasConnectedRef.current = true;
          }
          stopPolling();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.info(`[realtime] dropped (${status}): ${opts.channelName}`);
          startPolling();
        }
      });

    channelRef.current = channel;

    return () => {
      stopPolling();
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.channelName, opts.table, opts.filter, opts.event, opts.enabled, realtimeDisabled]);
}
