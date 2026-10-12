'use client';

import { useEffect } from 'react';

/**
 * Keeps the screen awake for as long as a page is shown (quick win P7).
 *
 * A tablet at a piste went to sleep during a bout: the official had to unlock
 * it while two fighters waited. The browser's screen wake lock stops that.
 *
 * The browser takes the lock back whenever the page is hidden (another tab,
 * the home screen), so it is asked for again each time the page is shown.
 * Without that it works once, then stops in silence.
 *
 * Best effort, by design: an old browser has no wake lock, and a tablet on
 * low battery refuses it. Neither is a fault of the bout, so neither says
 * anything, and the next time the page is shown the lock is asked for again.
 */
interface Sentinel {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockHost {
  wakeLock?: { request(type: 'screen'): Promise<Sentinel> };
}

interface ShownPage {
  visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/** Starts keeping the screen awake. Returns the stop, which gives the lock back. */
export function startWakeLock(
  host: WakeLockHost = navigator as WakeLockHost,
  page: ShownPage = document,
): () => void {
  let held: Sentinel | null = null;
  let asking = false;
  let stopped = false;

  const ask = () => {
    if (stopped || asking || held || page.visibilityState !== 'visible' || !host.wakeLock) return;
    asking = true;
    host.wakeLock.request('screen').then(
      (sentinel) => {
        asking = false;
        // The page was left while the browser answered: the lock is not kept.
        if (stopped) {
          sentinel.release().catch(() => undefined);
          return;
        }
        held = sentinel;
        // The browser took it back (the page was hidden): ask again when shown.
        sentinel.addEventListener('release', () => {
          if (held === sentinel) held = null;
        });
      },
      () => {
        asking = false;
      },
    );
  };

  ask();
  page.addEventListener('visibilitychange', ask);
  return () => {
    stopped = true;
    page.removeEventListener('visibilitychange', ask);
    held?.release().catch(() => undefined);
    held = null;
  };
}

/** Mount on a screen that must not sleep: see `startWakeLock`. */
export function useWakeLock(): void {
  useEffect(() => startWakeLock(), []);
}
