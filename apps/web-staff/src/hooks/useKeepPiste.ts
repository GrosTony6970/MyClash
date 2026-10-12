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
 * How soon a read that got no answer, or a fault, is asked again. The uplink
 * drops for ten seconds as the pad opens: five minutes later may be after the
 * cut this read is for. No `online` event says the uplink is back when the
 * tablet kept its access point.
 */
export const KEEP_PISTE_RETRY_MS = 30_000;

/** When to ask again after a read that ended as `kind` (or threw: the tablet's store). */
export function nextKeepIn(kind: 'piste' | 'refused' | 'unreachable' | 'failed' | 'threw'): number {
  // A refusal is an answer: this session may not read the piste. Asking every
  // thirty seconds would not change it.
  return kind === 'piste' || kind === 'refused' ? KEEP_PISTE_EVERY_MS : KEEP_PISTE_RETRY_MS;
}

/**
 * Keeps the piste on the tablet while a screen of that piste is open: the piste
 * list, and every bout screen (a table can go from bout to bout for an hour and
 * never see the list).
 *
 * It reads at the opening, when the network or the tab comes back, and then
 * again after `nextKeepIn`. One read at a time, and none while the tab is
 * hidden. It does not ask the browser whether there is a network: a tablet
 * whose `navigator.onLine` is stuck would keep nothing, and the read's own
 * failure says it. A failure costs the next "Next match" with no network only,
 * so the screen says nothing: the screens that open a copy say what they hold.
 */
export function useKeepPiste(apiUrl: string, liceId: string | null | undefined): void {
  useEffect(() => {
    if (!liceId) return;
    let busy = false;
    let stopped = false;
    let timer: number | undefined;
    const keep = () => {
      if (busy || stopped || document.hidden) return;
      busy = true;
      window.clearTimeout(timer);
      void keepPisteOf(apiUrl, liceId)
        .catch(() => 'threw' as const)
        .then((kind) => {
          busy = false;
          if (!stopped) timer = window.setTimeout(keep, nextKeepIn(kind));
        });
    };
    keep();
    window.addEventListener('online', keep);
    document.addEventListener('visibilitychange', keep);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener('online', keep);
      document.removeEventListener('visibilitychange', keep);
    };
  }, [apiUrl, liceId]);
}
