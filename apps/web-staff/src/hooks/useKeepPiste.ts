'use client';

import { useEffect } from 'react';
import { keepPisteOf } from '../lib/keep-piste';

/**
 * How often a tablet reads its whole piste again, to keep it.
 *
 * A bout's copy matters only when the network is gone, and a bout not started
 * changes little: five minutes keeps a new bracket round and a changed pairing
 * on the tablet at the cost of one request and a few small ones.
 */
export const KEEP_PISTE_EVERY_MS = 5 * 60_000;

/**
 * Keeps the piste on the tablet while a screen of that piste is open: the piste
 * list, and every bout screen (a table can go from bout to bout for an hour and
 * never see the list).
 *
 * It reads at the opening, when the network or the tab comes back, and every
 * five minutes while the tab is on screen. With no network it asks nothing. One
 * read at a time. A failure costs the next "Next match" with no network only,
 * so it says nothing: the screens that open a copy say what they hold.
 */
export function useKeepPiste(apiUrl: string, liceId: string | null | undefined): void {
  useEffect(() => {
    if (!liceId) return;
    let busy = false;
    const keep = () => {
      if (busy || document.hidden || !navigator.onLine) return;
      busy = true;
      void keepPisteOf(apiUrl, liceId)
        .catch(() => undefined)
        .finally(() => {
          busy = false;
        });
    };
    keep();
    const timer = window.setInterval(keep, KEEP_PISTE_EVERY_MS);
    window.addEventListener('online', keep);
    document.addEventListener('visibilitychange', keep);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', keep);
      document.removeEventListener('visibilitychange', keep);
    };
  }, [apiUrl, liceId]);
}
