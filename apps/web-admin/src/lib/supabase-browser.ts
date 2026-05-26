'use client';

import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useRef } from 'react';
import { getRuntimeFlagsCached, useRuntimeFlags } from '@myclash/ui';

let client: SupabaseClient | null = null;

/**
 * Singleton anon Supabase browser client. Reused across all realtime
 * subscriptions in web-admin so we don't churn websocket connections
 * across tab switches. Anon-only — web-admin's session auth is handled
 * server-side via cookies + the REST API, not via Supabase JWTs.
 */
export function getSupabaseBrowser(): SupabaseClient {
  if (!client) {
    const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
    const anon = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
    if (!url || !anon) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set');
    }
    client = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return client;
}

export interface UseRealtimeOptions {
  /** Unique channel name per page/tab. */
  channelName: string;
  /** Table to subscribe to (e.g. 'matches'). */
  table: string;
  /** PostgREST-style filter expression, e.g. `phase_id=eq.UUID`. */
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
}

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? '';

/**
 * Subscribes to a Supabase realtime channel and falls back to a setInterval
 * poll whenever the websocket is not in the SUBSCRIBED state.
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

  // Subscribe to the shared runtime-flags snapshot so that toggling
  // `disable_realtime` from the admin UI triggers this effect.
  const flags = useRuntimeFlags(API_URL);
  const realtimeDisabled = (flags ?? getRuntimeFlagsCached(API_URL)).realtimeDisabled === true;

  useEffect(() => {
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
      // eslint-disable-next-line no-console
      console.info(`[realtime] disabled by flag, polling only: ${opts.channelName}`);
      startPolling();
      return () => {
        stopPolling();
      };
    }

    const supabase = getSupabaseBrowser();

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
            // eslint-disable-next-line no-console
            console.info(`[realtime] reconnected: ${opts.channelName}`);
          } else {
            // eslint-disable-next-line no-console
            console.info(`[realtime] connected: ${opts.channelName}`);
            wasConnectedRef.current = true;
          }
          stopPolling();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          // eslint-disable-next-line no-console
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
  }, [opts.channelName, opts.table, opts.filter, opts.event, realtimeDisabled]);
}
