'use client';

import { useEffect, useMemo } from 'react';
import { getSyncEngine, type SyncEngine, type SyncState } from '../offline/sync';
import { useSendWhileOffline, useSyncState } from '../offline/use-sync-state';

/**
 * The tablet's queue, on the piste list (quick win P16; operator, 2026-10-12).
 *
 * Bout 4 ends with 3 entries not sent. The official goes back to the piste
 * list, which showed no count and sent nothing: the entries waited for the
 * next bout screen. The piste list now does for the queue what the bout screen
 * does: it sends it when the screen opens and when the network is back, and
 * tries again by itself while the queue waits for a network.
 *
 * The engine is the tab's one engine (`getSyncEngine`), so a send the bout
 * screen started goes on here, and the bar of both screens says the same.
 *
 * The send at the opening is also what makes the bar true: an engine tells its
 * state only when it sends, so a screen that only listened would show a green
 * bar over a full queue.
 */
export function usePisteQueue(apiUrl: string): {
  syncEngine: SyncEngine;
  syncState: SyncState | null;
} {
  const syncEngine = useMemo(() => getSyncEngine(apiUrl), [apiUrl]);
  const syncState = useSyncState(syncEngine);
  useSendWhileOffline(syncEngine, syncState);

  useEffect(() => {
    // Not `sendBehind`: a send that left before the network came back would
    // take this one down with it.
    const networkIsBack = () => syncEngine.sendAfterReconnect();
    // The listener first, as on the bout screen: a network that comes back
    // during the first send is not missed.
    window.addEventListener('online', networkIsBack);
    syncEngine.sendBehind();
    return () => window.removeEventListener('online', networkIsBack);
  }, [syncEngine]);

  return { syncEngine, syncState };
}
