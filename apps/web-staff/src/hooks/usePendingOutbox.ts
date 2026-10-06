'use client';

import { useEffect, useState } from 'react';
import { getPendingForMatch } from '../offline/outbox';
import type { OutboxEntry } from '../offline/db';

const NONE: OutboxEntry[] = [];

/**
 * The rows this match still has queued on the tablet.
 *
 * `getPendingForMatch` has existed since the outbox was written and never had a
 * caller — the pad only ever asked for a COUNT. The count lights the sync bar;
 * the rows are what let the timeline show the referee the hit they just scored.
 *
 * Re-reads on two triggers, and both are needed:
 *
 *   `refreshKey` bumps when the server is read again: at the end of a send
 *   and after an undo or a correction. A press does not bump it (ruling 316).
 *
 *   `pendingCount` comes from the SyncEngine, which says it at each press and
 *   at each answer: it is what shows a hit just scored. Without it a drain —
 *   reconnecting, or the engine retrying on its own — empties the queue with no
 *   mutation to notice it, and the provisional rows would sit on screen after
 *   the server had already accepted them.
 */
export function usePendingOutbox(
  matchId: string | null | undefined,
  refreshKey: number,
  pendingCount: number,
): OutboxEntry[] {
  const [entries, setEntries] = useState<OutboxEntry[]>(NONE);

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    void getPendingForMatch(matchId).then((rows) => {
      if (!cancelled) setEntries(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [matchId, refreshKey, pendingCount]);

  // Derived rather than stored. Clearing the state inside the effect would be a
  // synchronous setState in an effect, which is an ERROR in this app — and it
  // is not needed: "no match" has one answer and it does not depend on what the
  // last match had queued.
  return matchId ? entries : NONE;
}
