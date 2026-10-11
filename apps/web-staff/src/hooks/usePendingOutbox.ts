'use client';

import { useEffect, useState } from 'react';
import { getPendingForMatch } from '../offline/outbox';
import { db, type OutboxEntry } from '../offline/db';
import { heldRowsOf } from '../offline/press-queue';

/** What the tablet holds of one bout: the rows that wait, and whether the server refused one. */
export interface PendingOutbox {
  entries: OutboxEntry[];
  /** A row of this bout is held in the inbox. */
  held: boolean;
}

const NONE: PendingOutbox = { entries: [], held: false };

/**
 * The rows this match still has queued on the tablet, and whether the inbox
 * holds a refused row of it.
 *
 * `getPendingForMatch` has existed since the outbox was written and never had a
 * caller — the pad only ever asked for a COUNT. The count lights the sync bar;
 * the rows are what let the timeline show the referee the hit they just scored.
 *
 * The two are ONE read and ONE state. The rounds of the bout are computed from
 * both (`padSeries`: the tablet goes ahead of the server while it holds rows
 * and none is refused). Read by two hooks, "none is refused" could reach a
 * draw before "the rows are gone": after "Discard all of this match" the
 * screen then closed a round on rows the tablet no longer held, and remembered
 * it.
 *
 * Re-reads on three triggers:
 *
 *   `refreshKey` bumps when the server is read again: at the end of a send
 *   and after an undo or a correction. A press does not bump it (ruling 316).
 *
 *   `pendingCount` comes from the SyncEngine, which says it at each press and
 *   at each answer: it is what shows a hit just scored. Without it a drain —
 *   reconnecting, or the engine retrying on its own — empties the queue with no
 *   mutation to notice it, and the provisional rows would sit on screen after
 *   the server had already accepted them.
 *
 *   `rejectedCount`, the engine's too: a Discard of a held row with nothing
 *   behind it moves no other count.
 */
export function usePendingOutbox(
  matchId: string | null | undefined,
  refreshKey: number,
  pendingCount: number,
  rejectedCount: number,
): PendingOutbox {
  const [holds, setHolds] = useState<PendingOutbox>(NONE);

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    // One read transaction: a Discard or a refusal lands wholly before it or wholly after.
    const read = db.transaction('r', db.outbox, db.rejected, () =>
      Promise.all([getPendingForMatch(matchId), heldRowsOf(matchId)]),
    );
    void read.then(([entries, refused]) => {
      if (!cancelled) setHolds({ entries, held: refused.length > 0 });
    });
    return () => {
      cancelled = true;
    };
  }, [matchId, refreshKey, pendingCount, rejectedCount]);

  // Derived rather than stored. Clearing the state inside the effect would be a
  // synchronous setState in an effect, which is an ERROR in this app — and it
  // is not needed: "no match" has one answer and it does not depend on what the
  // last match had queued.
  return matchId ? holds : NONE;
}
