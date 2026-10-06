'use client';

import { useCallback, useEffect, useState } from 'react';
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
