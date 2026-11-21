'use client';
import { useEffect } from 'react';
import { getApiUrl } from '../lib/api-url';
import { getAllPending, getRejected } from '../offline/outbox';
import { computeHeartbeatMetrics } from '../offline/heartbeat';
import { getDeviceId } from '../offline/device-id';
import { summariseQuarantine } from '../offline/quarantine-report';
import { shouldKeepBeating } from './heartbeat-continuation';
import { noteOtherTablets, onOpenPisteChange, openPisteId } from '../offline/open-piste';

const HEARTBEAT_MS = 20_000;

/**
 * Snapshot everything one beat reports.
 *
 * `metrics.rejectedCount` and `quarantinedCount` are the same number, the hits
 * held in Review, for two readers: the first is the live gauge of the Live
 * board, the second the per-device record of the post-event report.
 *
 * The quarantine block is sent on every beat, including when it is empty, so a
 * device nobody heard from is distinguishable from a device with nothing to
 * report. It is omitted only when storage denied us a device id.
 */
async function collectHeartbeatPayload(liceId: string | null): Promise<Record<string, unknown>> {
  const [entries, held] = await Promise.all([getAllPending(), getRejected()]);
  const metrics = computeHeartbeatMetrics(entries, held.length, Date.now());
  const deviceId = getDeviceId();
  return {
    ...metrics,
    liceId,
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
 *
 * IT ALSO SENDS WHEN THE OPEN PISTE CHANGES (ruling 953): the answer says how
 * many other tablets score that piste, and a referee who opened it should not
 * wait 20 s to be told. The race: the bout screen closes and the next opens
 * (piste → none → piste), each asking for a send while one may be out. A send
 * asked during another is not dropped but sent after it, once.
 */
export function useHeartbeat(): void {
  useEffect(() => {
    let cancelled = false;
    let stopped = false;
    let inFlight = false;
    // A send asked while one was out: sent once that one ends.
    let again = false;
    let initial = 0;
    let repeating = 0;

    // Both timers, so a stop during the very first send cannot leave the
    // deferred one queued behind it.
    const stop = (): void => {
      stopped = true;
      window.clearTimeout(initial);
      window.clearInterval(repeating);
    };

    async function send(): Promise<void> {
      // One send at a time (a slow fetch must not stack POSTs): one asked while
      // another is out goes after it, once. Skipped while we're offline.
      if (inFlight) {
        again = true;
        return;
      }
      if (!navigator.onLine) return;
      inFlight = true;
      try {
        // The piste is read once, before the send: its answer is filed under it
        // (`noteOtherTablets`), even when the referee opened another meanwhile.
        const liceId = openPisteId();
        const payload = await collectHeartbeatPayload(liceId);
        if (cancelled) return;
        const res = await fetch(`${getApiUrl()}/api/v1/staff/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        if (!shouldKeepBeating(res.status)) stop();
        if (res.ok) {
          const answer = (await res.json().catch(() => null)) as { otherTablets?: unknown } | null;
          const others = answer?.otherTablets;
          noteOtherTablets(liceId, typeof others === 'number' ? others : 0);
        }
      } catch {
        // best-effort telemetry; never surface
      } finally {
        inFlight = false;
        if (again && !cancelled && !stopped) {
          again = false;
          void send();
        }
      }
    }

    // Defer the first send off the effect body (consistency with the repo's
    // effect rules; also lets the outbox settle after mount).
    initial = window.setTimeout(() => void send(), 0);
    repeating = window.setInterval(() => void send(), HEARTBEAT_MS);
    const unsubscribe = onOpenPisteChange(() => {
      if (!stopped) void send();
    });

    return () => {
      cancelled = true;
      unsubscribe();
      stop();
    };
  }, []);
}
