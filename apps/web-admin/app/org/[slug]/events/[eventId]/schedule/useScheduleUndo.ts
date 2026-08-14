'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProgrammeBlockRow } from './schedule-types';

/**
 * ONE undo history for the schedule board.
 *
 * There were two, and they ignored each other. `undoStack`/`redoStack` backed
 * the toolbar buttons and Ctrl+Z and knew about exactly two things: a drag
 * placement and an unschedule-by-drop. `lastUndo` backed the 6-second toast and
 * knew about the other two: a deleted bar and a run unscheduled by its inline ×.
 * So Ctrl+Z could not undo a bar delete, the toast could not undo a drag, and
 * once the toast expired the bar delete was gone for good — the toast WAS the
 * history for those two actions.
 *
 * Now there is one past/future pair. The toolbar, the keyboard and the toast are
 * three surfaces onto it, and the toast expiring only hides a button.
 *
 * Deliberately still out: twelve other mutations (clear day, clear run, group
 * drop, bulk shift, block move/resize, break create/edit, lice-span change) push
 * nothing. Each needs its own captured inverse — a resize's prior span, a
 * re-fan's prior layout — and several are server-side cascades whose inverse is
 * not the request that caused them. That is feature work, not unification.
 */

/** Where a fight sits. Both null means unscheduled. */
export interface MatchPosition {
  liceId: string | null;
  scheduledAt: string | null;
}

/** Enough to POST a deleted bar back. Never carries the old id — the re-created
 *  row gets a new one, which is why this entry cannot be redone. */
export interface DeletedBlock {
  dayIndex: number;
  blockType: ProgrammeBlockRow['blockType'];
  label: string;
  startTime: string;
  endTime: string;
}

export type ScheduleUndoEntry =
  | { kind: 'move'; matchId: string; from: MatchPosition; to: MatchPosition }
  | { kind: 'unschedule'; label: string; matches: Array<{ id: string } & MatchPosition> }
  | { kind: 'delete-block'; label: string; block: DeletedBlock };

/** The kinds the toast offers. A drag placement is not one: the board already
 *  shows the result, and a toast per drop would be constant noise. */
export type ToastEntry = Extract<ScheduleUndoEntry, { kind: 'unschedule' | 'delete-block' }>;

export interface ScheduleUndo {
  canUndo: boolean;
  canRedo: boolean;
  /** The entry the toast is currently offering to reverse, or null. */
  toast: ToastEntry | null;
  push: (entry: ScheduleUndoEntry) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  dismissToast: () => void;
}

const TOAST_MS = 6000;
/** Bounded so a long session cannot grow the history without limit. */
const MAX_DEPTH = 20;

export function useScheduleUndo(args: {
  /** History resets when the operator switches day — an undo that moved a fight
   *  on a day they are not looking at is more confusing than useful. */
  activeDay: string;
  /** Write a set of fights to these positions, optimistically then for real.
   *  Returns false when the server refused (the board has re-read by then). */
  applyPositions: (positions: Array<{ id: string } & MatchPosition>) => Promise<boolean>;
  /** POST a deleted bar back and re-read the board. */
  recreateBlock: (block: DeletedBlock) => Promise<boolean>;
}): ScheduleUndo {
  const { activeDay, applyPositions, recreateBlock } = args;
  const [past, setPast] = useState<ScheduleUndoEntry[]>([]);
  const [future, setFuture] = useState<ScheduleUndoEntry[]>([]);
  const [toast, setToast] = useState<ToastEntry | null>(null);

  // The keyboard shortcuts are bound once, so the handler holds this hook's
  // first closure. The stacks are read through refs to keep that handler honest.
  const pastRef = useRef(past);
  // eslint-disable-next-line react-hooks/refs -- intentional render-time mirror of the latest history for the once-bound keyboard handler
  pastRef.current = past;
  const futureRef = useRef(future);
  // eslint-disable-next-line react-hooks/refs -- intentional render-time mirror of the latest history for the once-bound keyboard handler
  futureRef.current = future;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset of the whole history on day change
    setPast([]);
    setFuture([]);
    setToast(null);
  }, [activeDay]);

  // The toast is a convenience, not the history. Hiding it — by timeout or by
  // the ✕ — leaves the entry in `past`, so Ctrl+Z still reaches it afterwards.
  // That is the whole point of merging the two systems.
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const push = useCallback((entry: ScheduleUndoEntry) => {
    setPast((prev) => [...prev, entry].slice(-MAX_DEPTH));
    setFuture([]);
    if (entry.kind !== 'move') setToast(entry);
  }, []);

  const undo = useCallback(async (): Promise<void> => {
    const entry = pastRef.current[pastRef.current.length - 1];
    if (!entry) return;
    setPast((prev) => prev.slice(0, -1));
    setToast(null);
    switch (entry.kind) {
      case 'move':
        setFuture((prev) => [...prev, entry].slice(-MAX_DEPTH));
        await applyPositions([{ id: entry.matchId, ...entry.from }]);
        return;
      case 'unschedule':
        setFuture((prev) => [...prev, entry].slice(-MAX_DEPTH));
        await applyPositions(entry.matches);
        return;
      case 'delete-block':
        // Not pushed to `future`: redoing it would need the id of the bar the
        // re-create just minted, and nothing captures that. Undo-only, on
        // purpose — a redo that deleted a DIFFERENT bar would be worse than no
        // redo at all.
        await recreateBlock(entry.block);
        return;
    }
  }, [applyPositions, recreateBlock]);

  const redo = useCallback(async (): Promise<void> => {
    const entry = futureRef.current[futureRef.current.length - 1];
    if (!entry) return;
    setFuture((prev) => prev.slice(0, -1));
    setPast((prev) => [...prev, entry].slice(-MAX_DEPTH));
    setToast(null);
    if (entry.kind === 'move') {
      await applyPositions([{ id: entry.matchId, ...entry.to }]);
      return;
    }
    if (entry.kind === 'unschedule') {
      await applyPositions(
        entry.matches.map((m) => ({ id: m.id, liceId: null, scheduledAt: null })),
      );
    }
  }, [applyPositions]);

  const dismissToast = useCallback(() => setToast(null), []);

  return useMemo(
    () => ({
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      toast,
      push,
      undo,
      redo,
      dismissToast,
    }),
    [past.length, future.length, toast, push, undo, redo, dismissToast],
  );
}
