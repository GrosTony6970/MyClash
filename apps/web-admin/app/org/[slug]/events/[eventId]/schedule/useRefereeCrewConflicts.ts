'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createRefetchGate, type RefetchGate } from './realtime-refetch-gate';
import { loadRefereeCrewConflicts, type RefereeCrewConflictsResult } from './schedule-reads';

/**
 * The LAGGING half of the board's referee check: the pool-scoped crews.
 *
 * The other half (./referee-conflict-rows) is derived on every render from
 * bouts the board already holds, so it is always current. This one cannot be:
 * the answer depends on who is rostered to each pool, which lives on the server
 * and which the board has no copy of. So it is re-read instead, and it carries
 * the time it was read so the banner can say how old it is rather than implying
 * it is live.
 *
 * WHAT TRIGGERS A RE-READ. Moving a card changes a pool's window, which changes
 * the answer — so `matches` changing is the signal. Not a call at every mutation
 * site: there are twelve of them, they update `matches` optimistically without
 * refetching, and adding a thirteenth obligation to each is the exact shape
 * `useScheduleData` was built to retire. Reacting to the data covers every path
 * that exists and every path anybody adds.
 *
 * Through the same gate the realtime path uses, for the same two reasons: a drag
 * across six slots is one re-read, not six, and a re-read never lands in the
 * middle of a write.
 */

/** Long enough to swallow a drag, short enough that the as-of time stays true. */
const CREW_REFETCH_DEBOUNCE_MS = 1500;

export interface RefereeCrewConflictsState {
  /** Null until the first read lands or is refused. */
  result: RefereeCrewConflictsResult | null;
}

export function useRefereeCrewConflicts(args: {
  apiUrl: string;
  eventId: string;
  /** Re-read when this changes — a moved card moves a pool's window. */
  matches: unknown;
  /** True while a local write is in flight. */
  isBusy: () => boolean;
}): RefereeCrewConflictsState {
  const { apiUrl, eventId, matches, isBusy } = args;
  const [result, setResult] = useState<RefereeCrewConflictsResult | null>(null);

  // The read returns its failures as values, so the state cannot be left at
  // null by a rejection — and null is the one thing the banner reads as "still
  // loading" rather than "unavailable". An abort is the exception: it means
  // this board is gone or has moved on, and storing it would leave the next
  // event's banner claiming the referee check is unavailable.
  const read = useCallback(
    (signal?: AbortSignal) =>
      loadRefereeCrewConflicts(apiUrl, eventId, signal).then((r) => {
        if (!r.ok && r.failure?.kind === 'aborted') return;
        setResult(r);
      }),
    [apiUrl, eventId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal);
    return () => controller.abort();
  }, [read]);

  const isBusyRef = useRef(isBusy);
  // eslint-disable-next-line react-hooks/refs -- intentional render-time mirror of latest busy flag for the stable debounced gate
  isBusyRef.current = isBusy;
  const readRef = useRef(read);
  // eslint-disable-next-line react-hooks/refs -- intentional render-time mirror of latest reader, same reason
  readRef.current = read;
  const gateRef = useRef<RefetchGate | null>(null);

  // Skips its own first run: the mount effect above already read. Without this
  // the board would fire two identical requests on every load.
  const armed = useRef(false);
  useEffect(() => {
    if (!armed.current) {
      armed.current = true;
      return;
    }
    // `if` rather than `??=`. The React Compiler cannot lower a `??=` and bails
    // out of the whole function when it meets one — `useScheduleRealtime` next
    // door carries exactly that bailout. A bail-out costs the memoisation and,
    // depending on where it lands, the compiler-backed lint rules with it. Two
    // more lines buys both back.
    if (gateRef.current === null) {
      gateRef.current = createRefetchGate({
        delayMs: CREW_REFETCH_DEBOUNCE_MS,
        isBusy: () => isBusyRef.current(),
        refetch: () => void readRef.current(),
        setTimer: (fn, ms) => window.setTimeout(fn, ms),
        clearTimer: (id) => window.clearTimeout(id),
      });
    }
    gateRef.current.schedule();
  }, [matches]);

  // A pending re-read must not fire into an unmounted tree.
  useEffect(() => () => gateRef.current?.cancel(), []);

  return { result };
}
