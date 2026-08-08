'use client';
import { useEffect } from 'react';
import { getApiUrl } from '../lib/api-url';
import { getAllPending } from '../offline/outbox';
import { computeHeartbeatMetrics } from '../offline/heartbeat';

const HEARTBEAT_MS = 20_000;

/**
 * Best-effort tablet heartbeat: every 20s, while online, snapshot the outbox
 * and POST sync-health to the API, which stamps it on the staff account for the
 * organizer Live board. Swallows every error — a 401 (not logged in), an
 * offline network, or a server hiccup must never disrupt scoring. No React
 * state is set here, so it is exempt from set-state-in-effect.
 */
export function useHeartbeat(): void {
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    async function send(): Promise<void> {
      // Skip if the previous send is still in flight (a slow fetch must not
      // stack a second POST on the next tick) or if we're offline.
      if (inFlight || !navigator.onLine) return;
      inFlight = true;
      try {
        const entries = await getAllPending();
        const metrics = computeHeartbeatMetrics(entries, Date.now());
        if (cancelled) return;
        await fetch(`${getApiUrl()}/api/v1/staff/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          // Read at SEND time, not with the metrics above: the outbox read is
          // async, and stamping before it would fold that wait into the skew.
          body: JSON.stringify({ ...metrics, clientNowMs: Date.now() }),
        });
      } catch {
        // best-effort telemetry; never surface
      } finally {
        inFlight = false;
      }
    }

    // Defer the first send off the effect body (consistency with the repo's
    // effect rules; also lets the outbox settle after mount).
    const initial = window.setTimeout(() => void send(), 0);
    const id = window.setInterval(() => void send(), HEARTBEAT_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      window.clearInterval(id);
    };
  }, []);
}
