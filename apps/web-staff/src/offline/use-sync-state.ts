'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isDrillActive } from './drill';
import { retriesAfterError, retryDelayMs, triesAfter } from './retry-after-error';
import type { SyncState } from './sync';

/**
 * Subscribe to a SyncEngine and return its current SyncState.
 *
 * Lives beside the engine rather than beside a component: this is the only
 * surviving export of the old SyncStatus.tsx, whose component was never
 * rendered anywhere while `app/matches/[matchId]/page.tsx` reimplemented the
 * same four-state indicator inline. One state machine, one presentation.
 */
export function useSyncState(
  engine: { subscribe: (l: (s: SyncState) => void) => () => void } | null,
): SyncState | null {
  const [state, setState] = useState<SyncState | null>(null);

  const stableSetState = useCallback((s: SyncState) => setState(s), []);

  useEffect(() => {
    if (!engine) return;
    const unsub = engine.subscribe(stableSetState);
    return unsub;
  }, [engine, stableSetState]);

  return state;
}

/**
 * Call `ended` after each send of the engine (ruling 316). A send can end with
 * no press waiting on it, and the screen then holds what the server had before.
 */
export function useSendEnded(
  engine: { onSendEnded: (ended: () => void) => () => void } | null | undefined,
  ended: () => void,
): void {
  useEffect(() => engine?.onSendEnded(ended), [engine, ended]);
}

/** How often the queue is tried again while it waits for a network. */
export const SEND_WHILE_OFFLINE_MS = 5_000;

/**
 * Try the queue again while the engine says `offline` and entries wait
 * (operator, 2026-10-12). Nothing else did: the engine leaves `offline` on a
 * tap, on a bout screen that opens, and on the browser's `online` event, and a
 * tablet that kept its access point while the uplink dropped gets no event.
 * A browser that says it is offline is left to that event. So is the offline
 * drill: its end sends the queue (`OfflineDrillBanner`), and a try that can
 * only meet the drill would count against each row, which the heartbeat
 * reports to the organiser's board as a tablet that is stuck.
 *
 * One interval at a time, and a try asked for while a send runs is one more
 * pass of that send. Each try that had a row to send ends as every send does:
 * the bout screen reads the bout again (`useSendEnded`).
 */
export function useSendWhileOffline(
  engine: { sendBehind: () => void },
  state: SyncState | null,
): void {
  const waits = state?.status === 'offline' && state.pendingCount > 0;
  useEffect(() => {
    if (!waits) return;
    const timer = window.setInterval(() => {
      if (navigator.onLine && !isDrillActive()) engine.sendBehind();
    }, SEND_WHILE_OFFLINE_MS);
    return () => window.clearInterval(timer);
  }, [waits, engine]);
}

/**
 * Try the queue again while the bar says SYNC ERROR over rows a send can try
 * (ruling 954). Nothing did: a hit the server answered with a 500 waited for
 * the referee's Retry, another hit or another bout, and for ever on a tablet
 * nobody touched. The waits grow from 5 s to a minute (`retryDelayMs`); the bar
 * says what it said, and its Retry still sends at once. Rows held in Review
 * wait for that Retry (ruling 291).
 *
 * The race: each try is a send, so the state goes `syncing` and back to `error`
 * between two tries, and this effect ends and starts again. The count of tries
 * lives in a ref across that, and goes back to 0 only when the error is over
 * (`triesAfter`), or the waits would never grow.
 */
export function useRetryAfterError(
  engine: { sendBehind: () => void },
  state: SyncState | null,
): void {
  const tries = useRef(0);
  const waits = retriesAfterError(state);
  useEffect(() => {
    tries.current = triesAfter(tries.current, state);
  }, [state]);
  useEffect(() => {
    if (!waits) return;
    let timer = 0;
    const next = () => {
      timer = window.setTimeout(() => {
        tries.current += 1;
        if (navigator.onLine && !isDrillActive()) engine.sendBehind();
        next();
      }, retryDelayMs(tries.current));
    };
    next();
    return () => window.clearTimeout(timer);
  }, [waits, engine]);
}
