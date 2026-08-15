'use client';

import { useCallback, useMemo, useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { SLOT_HEIGHT_PX, slotToHHMM } from '@myclash/schedule-core';
import { clampBlockSpan } from './block-geometry';
import { breakEditSteps } from './break-edit-steps';
import { mutateSchedule } from './schedule-mutations';
import {
  barEditRequest,
  createBarRequest,
  delayDayRequest,
  deleteBarRequest,
  moveBarRequest,
  resizeBarEndRequest,
  resizeBarStartRequest,
  type BarRequest,
  type ProgrammeTarget,
} from './programme-bar-requests';
import type { BlockEditDraft } from './BlockEditPopover';
import type { BgvBreak } from './BlockGridView';
import type { ProgrammeBlockRow } from './schedule-types';
import type { ScheduleUndoEntry } from './useScheduleUndo';

/**
 * Everything the board does to a programme bar: the writes, and the seven bits
 * of state that exist only because those writes take time.
 *
 * A programme bar is a non-fight row — a break, an admin slot, a workshop band.
 * The requests themselves are in ./programme-bar-requests and the popover's step
 * ordering is in ./break-edit-steps; both are pure and tested. This file is the
 * state and the lifecycle around them, the same division ./useScheduleData draws
 * for the read half. Nothing here calls `fetch`.
 *
 * ONE SPINE, NOT SEVEN. Six of these writes did the same five lines by hand:
 * commit, bail on refusal, refetch, tell the Configure planner. `sendBars` is
 * that spine. It matters because the steps are NOT interchangeable — a delete
 * has to stage its undo entry between the commit and the refetch, or the entry
 * would be built from a row the refetch has already removed — so the one place
 * that varies is a parameter rather than a seventh copy.
 *
 * WHERE THIS MAY BE CALLED. `beginBlockResize` clamps against `gridEndSlot`,
 * which the board derives from the day's own programme. A hook call evaluates
 * its arguments during render, so this hook has to sit BELOW that derivation —
 * one line higher and it throws `Cannot access 'gridEndSlot' before
 * initialization` and blanks the board, with `tsc` reporting nothing. That is
 * the load-bearing order `grid.tsx` documents: data, then geometry, then writes.
 *
 * The `try`/`finally` pairs below cost this file the React Compiler's own lint
 * passes for the four functions that carry one — it cannot lower a `try` without
 * a `catch`, and says so under `react-hooks/todo`. Kept anyway: a busy flag has
 * to clear even if a caller's `onProgrammeMutated` throws, and the bailout is
 * confined to the function it sits in rather than blinding the file. Confirmed
 * with a deliberate violation at hook scope, which the rules still report.
 */

/** The bottom-edge drag in progress: what the operator is dragging toward. */
export interface ResizingBar {
  id: string;
  startSlot: number;
  minSpan: number;
  previewSpan: number;
}

export interface ProgrammeBars {
  /** Push the rest of the active day back from `fromTime` (event-zone HH:MM). */
  delayRestOfDay: (fromTime: string, deltaMinutes: number) => Promise<boolean>;
  /** True while that cascade is in flight — drives the dialog's busy state. */
  delayingDay: boolean;
  /** Bar being retimed by a drag — dims it while the cascade lands. */
  movingBlockId: string | null;
  /** Bar being deleted. Also drives the confirm dialog's busy state. */
  deletingBlockId: string | null;
  /** Bar staged for deletion by the inline ×. Carries the whole row so the
   *  confirm dialog can name its type and time window. */
  pendingBlockDelete: ProgrammeBlockRow | null;
  setPendingBlockDelete: (row: ProgrammeBlockRow | null) => void;
  resizingBlock: ResizingBar | null;
  /** Bar whose edit popover is open, or null. */
  editingBreak: BgvBreak | null;
  setEditingBreak: (brk: BgvBreak | null) => void;
  /** Seeded draft for the create-a-bar popover (double-click an empty cell). */
  creatingBreak: BlockEditDraft | null;
  setCreatingBreak: (draft: BlockEditDraft | null) => void;
  /** True while the popover's save is in flight — disables its buttons. */
  blockEditBusy: boolean;
  moveBlockTo: (blockId: string, slot: number) => Promise<void>;
  deleteBlock: (blockId: string) => Promise<void>;
  beginBlockResize: (
    ev: React.PointerEvent<HTMLDivElement>,
    block: ProgrammeBlockRow & { startSlot: number; span: number },
  ) => void;
  saveBreakEdit: (brk: BgvBreak, draft: BlockEditDraft) => Promise<void>;
  resizeBreakTimeTo: (brk: BgvBreak, newEndSlot: number) => Promise<void>;
  resizeBreakStartTo: (brk: BgvBreak, newStartSlot: number) => Promise<void>;
  createBreakBlock: (draft: BlockEditDraft) => Promise<void>;
}

export function useProgrammeBars(args: {
  apiUrl: string;
  eventId: string;
  /** Index of the active day in the event's day list. Negative when there is no
   *  active day, which is what stops a create from landing on day zero. */
  dayIndex: number;
  /** The axis origin, derived per day from the programme itself. */
  gridStartHour: number;
  /** The axis extent — a resize may not drag a bar past it. */
  gridEndSlot: number;
  /** The board's rows, read only to snapshot a bar before its DELETE removes it. */
  programmeBlocks: ProgrammeBlockRow[];
  commit: (run: () => Promise<unknown>) => Promise<boolean>;
  refetch: () => Promise<void>;
  /** Lets the Configure planner re-read a bar this changed server-side. */
  onProgrammeMutated?: () => void;
  /** Stages the undo entry for a deleted bar. */
  pushUndo: (entry: ScheduleUndoEntry) => void;
}): ProgrammeBars {
  const {
    apiUrl,
    eventId,
    dayIndex,
    gridStartHour,
    gridEndSlot,
    programmeBlocks,
    commit,
    refetch,
    onProgrammeMutated,
    pushUndo,
  } = args;
  const { t } = useI18n();
  // Memoized so it can be an honest dependency below rather than a fresh object
  // that would rebuild every callback on every render.
  const target: ProgrammeTarget = useMemo(() => ({ apiUrl, eventId }), [apiUrl, eventId]);

  const [movingBlockId, setMovingBlockId] = useState<string | null>(null);
  const [deletingBlockId, setDeletingBlockId] = useState<string | null>(null);
  const [pendingBlockDelete, setPendingBlockDelete] = useState<ProgrammeBlockRow | null>(null);
  const [resizingBlock, setResizingBlock] = useState<ResizingBar | null>(null);
  const [editingBreak, setEditingBreak] = useState<BgvBreak | null>(null);
  const [creatingBreak, setCreatingBreak] = useState<BlockEditDraft | null>(null);
  const [blockEditBusy, setBlockEditBusy] = useState(false);
  const [delayingDay, setDelayingDay] = useState(false);

  /**
   * Send a bar write and settle the board around it.
   *
   * The requests run in SEQUENCE inside a single `commit`, never as a fan-out:
   * `/move` cascades the rest of the day and `/resize` does not, so running them
   * out of order changes the result, and a refusal has to stop the remaining
   * steps rather than send them against a bar the server did not update.
   *
   * `onCommitted` runs after the server accepted and before the refetch — the
   * one place a caller needs to act on a bar that is about to disappear.
   */
  const sendBars = useCallback(
    async (requests: BarRequest[], onCommitted?: () => void): Promise<boolean> => {
      const ok = await commit(async () => {
        for (const request of requests) {
          await mutateSchedule(request.url, request.init);
        }
      });
      if (!ok) return false;
      onCommitted?.();
      await refetch();
      onProgrammeMutated?.();
      return true;
    },
    [commit, refetch, onProgrammeMutated],
  );

  const moveBlockTo = useCallback(
    async (blockId: string, slot: number): Promise<void> => {
      setMovingBlockId(blockId);
      try {
        // The drop landed on an axis slot; the endpoint takes wall-clock HH:MM.
        // A move cascades over many fights, so the board re-reads from the
        // source of truth rather than mirroring the shift client-side.
        await sendBars([moveBarRequest(target, blockId, slotToHHMM(slot, gridStartHour))]);
      } finally {
        setMovingBlockId(null);
      }
    },
    [target, gridStartHour, sendBars],
  );

  const deleteBlock = useCallback(
    async (blockId: string): Promise<void> => {
      // Snapshot the row BEFORE the DELETE, so undo has something to POST back.
      const row = programmeBlocks.find((b) => b.id === blockId);
      setDeletingBlockId(blockId);
      try {
        await sendBars([deleteBarRequest(target, blockId)], () => {
          if (!row) return;
          pushUndo({
            kind: 'delete-block',
            label: row.label,
            block: {
              dayIndex: row.dayIndex,
              blockType: row.blockType,
              label: row.label,
              startTime: row.startTime,
              endTime: row.endTime,
            },
          });
        });
      } finally {
        setDeletingBlockId(null);
        setPendingBlockDelete(null);
      }
    },
    [target, programmeBlocks, pushUndo, sendBars],
  );

  /**
   * Bottom-edge resize. The handle captures the pointer, tracks vertical travel
   * in slot increments, and commits on pointerup. Escape cancels: the preview
   * reverts and nothing is sent.
   *
   * The commit reuses the preview's OWN span calculation. These were two
   * separate expressions, which is how a preview and its write drift apart.
   */
  const beginBlockResize = useCallback(
    (
      ev: React.PointerEvent<HTMLDivElement>,
      block: ProgrammeBlockRow & { startSlot: number; span: number },
    ): void => {
      ev.preventDefault();
      ev.stopPropagation();
      const handle = ev.currentTarget;
      handle.setPointerCapture(ev.pointerId);
      const startY = ev.clientY;
      const startSpan = block.span;
      setResizingBlock({
        id: block.id,
        startSlot: block.startSlot,
        minSpan: 1,
        previewSpan: startSpan,
      });

      /** Slots the pointer has travelled since the drag began. */
      function dragSpan(e: PointerEvent): number {
        const deltaSlots = Math.round((e.clientY - startY) / SLOT_HEIGHT_PX);
        return clampBlockSpan({ startSpan, deltaSlots, startSlot: block.startSlot, gridEndSlot });
      }
      function detach(e: PointerEvent): void {
        handle.releasePointerCapture(e.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onCancel);
      }
      function onMove(e: PointerEvent): void {
        const nextSpan = dragSpan(e);
        setResizingBlock((prev) =>
          prev && prev.id === block.id ? { ...prev, previewSpan: nextSpan } : prev,
        );
      }
      function onUp(e: PointerEvent): void {
        detach(e);
        const clampedSpan = dragSpan(e);
        setResizingBlock(null);
        if (clampedSpan === startSpan) return;
        const newEndTime = slotToHHMM(block.startSlot + clampedSpan, gridStartHour);
        void sendBars([resizeBarEndRequest(target, block.id, newEndTime)]);
      }
      function onCancel(e: PointerEvent): void {
        detach(e);
        setResizingBlock(null);
      }
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onCancel);
    },
    [target, gridEndSlot, gridStartHour, sendBars],
  );

  const saveBreakEdit = useCallback(
    async (brk: BgvBreak, draft: BlockEditDraft): Promise<void> => {
      setBlockEditBusy(true);
      try {
        const steps = breakEditSteps(
          {
            label: brk.label,
            startTime: brk.startTime,
            endTime: brk.endTime,
            colorHex: brk.colorHex ?? null,
          },
          draft,
        );
        await sendBars(steps.map((step) => barEditRequest(target, brk.id, step)));
      } finally {
        setBlockEditBusy(false);
      }
    },
    [target, sendBars],
  );

  const resizeBreakTimeTo = useCallback(
    async (brk: BgvBreak, newEndSlot: number): Promise<void> => {
      await sendBars([resizeBarEndRequest(target, brk.id, slotToHHMM(newEndSlot, gridStartHour))]);
    },
    [target, gridStartHour, sendBars],
  );

  /** Top-edge drag: the start moves, the end stays put. */
  const resizeBreakStartTo = useCallback(
    async (brk: BgvBreak, newStartSlot: number): Promise<void> => {
      await sendBars([
        resizeBarStartRequest(target, brk.id, slotToHHMM(newStartSlot, gridStartHour)),
      ]);
    },
    [target, gridStartHour, sendBars],
  );

  const createBreakBlock = useCallback(
    async (draft: BlockEditDraft): Promise<void> => {
      // No active day means no day to create on. Deliberately leaves the popover
      // open — closing it would read as "the bar was created".
      if (dayIndex < 0) return;
      setBlockEditBusy(true);
      try {
        await sendBars([
          createBarRequest(target, {
            dayIndex,
            blockType: 'break',
            label: draft.label || t('organizer.schedulePage.grid.breakDefaultLabel'),
            startTime: draft.startHHMM,
            endTime: draft.endHHMM,
            colorHex: draft.colorHex || null,
          }),
        ]);
      } finally {
        setBlockEditBusy(false);
        setCreatingBreak(null);
      }
    },
    [target, dayIndex, t, sendBars],
  );

  /**
   * Push the rest of the active day back, bars and fights together.
   *
   * A bar family write even though most of what it moves is fights, because
   * moving the BARS is the thing it adds over the per-piste "+N" the board
   * already had — and because it needs this hook's refetch: the cascade rewrites
   * hundreds of rows, so the board re-reads from the source of truth rather than
   * mirroring the shift client-side, exactly as a bar drag does.
   */
  const delayRestOfDay = useCallback(
    async (fromTime: string, deltaMinutes: number): Promise<boolean> => {
      if (dayIndex < 0 || deltaMinutes === 0) return false;
      setDelayingDay(true);
      try {
        return await sendBars([delayDayRequest(target, { dayIndex, fromTime, deltaMinutes })]);
      } finally {
        setDelayingDay(false);
      }
    },
    [target, dayIndex, sendBars],
  );

  return {
    delayRestOfDay,
    delayingDay,
    movingBlockId,
    deletingBlockId,
    pendingBlockDelete,
    setPendingBlockDelete,
    resizingBlock,
    editingBreak,
    setEditingBreak,
    creatingBreak,
    setCreatingBreak,
    blockEditBusy,
    moveBlockTo,
    deleteBlock,
    beginBlockResize,
    saveBreakEdit,
    resizeBreakTimeTo,
    resizeBreakStartTo,
    createBreakBlock,
  };
}
