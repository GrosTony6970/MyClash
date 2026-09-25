'use client';

import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useRef } from 'react';
import { getRuntimeFlagsCached, useRuntimeFlags } from '@myclash/ui';
import { getPublicApiUrl } from './api-url';

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
  /**
   * Called every fallbackPollMs for as long as the page is open, channel up or
   * not, and once straight away when the channel drops.
   */
  onFallbackPoll: () => void;
  /** Polling interval (ms). Default 30s. */
  fallbackPollMs?: number;
}

const API_URL = getPublicApiUrl();

/**
 * Subscribes to a Supabase realtime channel, with a setInterval poll beside it
 * for as long as the page is open.
 *
 * The poll does not stop on SUBSCRIBED (ruling 110a). This client is anonymous,
 * and RLS keeps a draft Event's rows, and an unpublished Tournament's, off its
 * channel: the channel says SUBSCRIBED and then never speaks. A poll that
 * stopped there froze the organiser's own screens on exactly those Events.
 *
 * Behavior:
 *   • If the `disable_realtime` feature flag is on, skip the websocket
 *     entirely and run only the polling loop. We re-subscribe to the
 *     runtime-flags cache so flipping the flag mid-session re-runs this
 *     effect and either reattaches or detaches the channel.
 *   • On CHANNEL_ERROR / TIMED_OUT / CLOSED → poll straight away, so a drop
 *     does not wait a full interval. Once per outage: SUBSCRIBED re-arms it.
 *   • On unmount → stop polling AND remove the channel.
 */
export function useRealtimeWithFallback(opts: UseRealtimeOptions): void {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const wasConnectedRef = useRef(false);

  // Subscribe to the shared runtime-flags snapshot so that toggling
  // `disable_realtime` from the admin UI triggers this effect.
  const flags = useRuntimeFlags(API_URL);
  const realtimeDisabled = (flags ?? getRuntimeFlagsCached(API_URL)).realtimeDisabled === true;

  useEffect(() => {
    const pollTimer = window.setInterval(
      () => opts.onFallbackPoll(),
      opts.fallbackPollMs ?? 30_000,
    );
    let caughtUp = false;
    function catchUp() {
      if (caughtUp) return;
      caughtUp = true;
      opts.onFallbackPoll();
    }

    // Kill-switch path: skip the websocket entirely.
    if (realtimeDisabled) {
      console.info(`[realtime] disabled by flag, polling only: ${opts.channelName}`);
      catchUp();
      return () => {
        window.clearInterval(pollTimer);
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
            console.info(`[realtime] reconnected: ${opts.channelName}`);
          } else {
            console.info(`[realtime] connected: ${opts.channelName}`);
            wasConnectedRef.current = true;
          }
          caughtUp = false;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.info(`[realtime] dropped (${status}): ${opts.channelName}`);
          catchUp();
        }
      });

    channelRef.current = channel;

    return () => {
      window.clearInterval(pollTimer);
      // Leaving the channel reports CLOSED to the callback above; the page is
      // gone, so that must not fire a catch-up read.
      caughtUp = true;
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.channelName, opts.table, opts.filter, opts.event, realtimeDisabled]);
}
