'use client';
import { useEffect } from 'react';
import { getApiUrl } from '../lib/api-url';
import { getAllPending, getRejected } from '../offline/outbox';
import { computeHeartbeatMetrics } from '../offline/heartbeat';
import { getDeviceId } from '../offline/device-id';
import { summariseQuarantine } from '../offline/quarantine-report';
import { shouldKeepBeating } from './heartbeat-continuation';

const HEARTBEAT_MS = 20_000;

/**
 * Snapshot everything one beat reports.
 *
 * `metrics.rejectedCount` and `quarantinedCount` are DIFFERENT numbers and the
 * names have collided in this codebase before: the first counts outbox entries
 * stuck retrying, the second counts exchanges the server refused outright and
 * the device is still holding.
 *
 * The quarantine block is sent on every beat, including when it is empty, so a
 * device nobody heard from is distinguishable from a device with nothing to
 * report. It is omitted only when storage denied us a device id.
 */
async function collectHeartbeatPayload(): Promise<Record<string, unknown>> {
  const [entries, held] = await Promise.all([getAllPending(), getRejected()]);
  const metrics = computeHeartbeatMetrics(entries, Date.now());
  const deviceId = getDeviceId();
  return {
    ...metrics,
    // Stamped LAST, not with the metrics above: the reads are async and
    // stamping before them would fold that wait into the measured clock skew.
    clientNowMs: Date.now(),
    ...(deviceId ? { deviceId, ...summariseQuarantine(held) } : {}),
  };
}

/**
 * Best-effort tablet heartbeat: every 20s, while online, snapshot the outbox
 * and POST sync-health to the API, which stamps it on the staff account for the
 * organizer Live board. A thrown error is swallowed — an offline network or a
 * server hiccup must never disrupt scoring. No React state is set here, so it
 * is exempt from set-state-in-effect.
 *
 * IT STOPS ON A SIGNED-OUT ANSWER. `HeartbeatRunner` lives in the root layout,
 * so this runs on `/login` too, and it used to beat there forever — one 401
 * every 20s per open tab. See `shouldKeepBeating` for what that cost. The
 * verdict lives in that module rather than here because this app has no way to
 * test a hook; nothing else about the loop moved.
 */
export function useHeartbeat(): void {
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let initial = 0;
    let repeating = 0;

    // Both timers, so a stop during the very first send cannot leave the
    // deferred one queued behind it.
    const stop = (): void => {
      window.clearTimeout(initial);
      window.clearInterval(repeating);
    };

    async function send(): Promise<void> {
      // Skip if the previous send is still in flight (a slow fetch must not
      // stack a second POST on the next tick) or if we're offline.
      if (inFlight || !navigator.onLine) return;
      inFlight = true;
      try {
        const payload = await collectHeartbeatPayload();
        if (cancelled) return;
        const res = await fetch(`${getApiUrl()}/api/v1/staff/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        if (!shouldKeepBeating(res.status)) stop();
      } catch {
        // best-effort telemetry; never surface
      } finally {
        inFlight = false;
      }
    }

    // Defer the first send off the effect body (consistency with the repo's
    // effect rules; also lets the outbox settle after mount).
    initial = window.setTimeout(() => void send(), 0);
    repeating = window.setInterval(() => void send(), HEARTBEAT_MS);

    return () => {
      cancelled = true;
      stop();
    };
  }, []);
}
