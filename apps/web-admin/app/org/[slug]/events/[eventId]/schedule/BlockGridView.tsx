'use client';

/* eslint-disable myclash/no-literal-string */

/**
 * BlockGridView — the unified, editable schedule board. Pool / bracket-round
 * blocks are placed by start time on a lice-column time grid; a run fanned
 * across several lices is ONE block spanning those columns. Admin/break blocks
 * are full-width bars. A time ruler runs down the left to the day's end.
 *
 * Each block carries an edit affordance (✎), a bottom edge to resize TIME, and
 * a right edge to resize LICE span (pool relocates, bracket re-fans). Drag a
 * block / an Unscheduled item onto a lice column to (re)place it.
 *
 * Presentational + drag/resize wiring only — the data model comes from
 * `buildScheduleBlocks` and all persistence is the parent's via callbacks.
 */

import { useRef, useState } from 'react';
import { accentClassFor, tintBgClassFor, tintBorderClassFor, tintTextClassFor } from '@myclash/ui';
import type { ScheduleBlock } from './schedule-blocks';
import type { LiceDrift } from './lice-drift';
import { liceSpanFromDelta } from './lice-span';
import { blockTint } from './block-tint';
import { liceUtilizationPct } from './lice-utilization';
import { wouldOverlap, type SlotPlacement } from './detect-overlaps';
import {
  LICE_HEADER_HEIGHT_PX,
  MIN_LICE_COL_PX,
  SNAP_SLOTS,
  TIME_LABEL_COL_PX,
  VENUE_HEADER_HEIGHT_PX,
  computeVenueGroups,
  formatSlotTime,
  isoToSlot,
  resizeStartSlot,
  snapSlot,
} from './schedule-grid-geometry';

export interface ViewLice {
  id: string;
  name: string;
  venues?: { id: string; name: string } | null;
}

export interface BgvBreak {
  id: string;
  startSlot: number;
  span: number;
  label: string;
  startTime: string;
  endTime: string;
  /** 'break' | 'admin' | 'workshop' — drives the bar tint. */
  kind: string;
  /** Optional "#rrggbb" override; falls back to the per-kind tint when null. */
  colorHex?: string | null;
}

interface Props {
  lices: ViewLice[];
  blocks: ScheduleBlock[];
  breaks: BgvBreak[];
  tournamentColorByName: Map<string, string | null>;
  baseDate: string;
  /** Event IANA timezone — the time axis is resolved in it. */
  timezone: string;
  gridEndSlot: number;
  drift: Map<string, LiceDrift>;
  nowSlot: number | null;
  /** Match ids in a fighter conflict — tint their block red. */
  conflictMatchIds: Set<string>;
  /** Block keys overlapping another block on a shared lice — tint amber. */
  overlapBlockKeys: Set<string>;
  /** Rendered slot height in px (vertical zoom). Slot math stays 5-min. */
  slotHeightPx: number;
  /** When set, dim every block from another tournament (legend focus). */
  focusedTournament: string | null;
  onShiftLice: (liceId: string, driftMin: number) => void;
  onEditBlock: (block: ScheduleBlock) => void;
  onEditBreak: (brk: BgvBreak) => void;
  /** × on a pool/bracket/other run → unschedule its matches. */
  onDeleteBlock: (block: ScheduleBlock) => void;
  /** × on an admin/break bar → delete the programme block. */
  onDeleteBreak: (brk: BgvBreak) => void;
  onResizeBlockTime: (block: ScheduleBlock, newEndSlot: number) => void;
  onResizeBreakTime: (brk: BgvBreak, newEndSlot: number) => void;
  /** Top-edge drag of a run → re-time it to start at the new slot. */
  onResizeBlockStart: (block: ScheduleBlock, newStartSlot: number) => void;
  /** Top-edge drag of an admin/break bar → move its start, end fixed. */
  onResizeBreakStart: (brk: BgvBreak, newStartSlot: number) => void;
  onResizeBlockLices: (block: ScheduleBlock, newLiceIds: string[]) => void;
  onBlockDragStart: (block: ScheduleBlock) => void;
  onBlockDragEnd: () => void;
  /** Drag a full-width admin/break bar to re-time it (cascades later blocks). */
  onBreakDragStart: (brk: BgvBreak) => void;
  onBreakDragEnd: () => void;
  /** Drop on a lice column at a 15-min-snapped slot (vertical position). */
  onDropOnLice: (liceId: string, slot: number) => void;
  /** Double-click an empty cell → start a new break at that 15-min slot. */
  onCreateAtCell: (slot: number) => void;
  dragOverLiceId: string | null;
  onDragOverLice: (liceId: string | null) => void;
}

function breakBarClasses(kind: string): string {
  if (kind === 'break') return 'border-slate-300 bg-slate-100 text-slate-600';
  if (kind === 'workshop') return 'border-amber-300 bg-amber-50 text-amber-800';
  return 'border-purple-300 bg-purple-50 text-purple-800';
}

type TimeResize = { key: string; startSlot: number; previewEndSlot: number };
type StartResize = { key: string; previewStartSlot: number; endSlot: number };
type LiceResize = { key: string; previewIndices: number[] };

export function BlockGridView({
  lices,
  blocks,
  breaks,
  tournamentColorByName,
  baseDate,
  timezone,
  gridEndSlot,
  drift,
  nowSlot,
  conflictMatchIds,
  overlapBlockKeys,
  slotHeightPx,
  focusedTournament,
  onShiftLice,
  onEditBlock,
  onEditBreak,
  onDeleteBlock,
  onDeleteBreak,
  onResizeBlockTime,
  onResizeBreakTime,
  onResizeBlockStart,
  onResizeBreakStart,
  onResizeBlockLices,
  onBlockDragStart,
  onBlockDragEnd,
  onBreakDragStart,
  onBreakDragEnd,
  onDropOnLice,
  onCreateAtCell,
  dragOverLiceId,
  onDragOverLice,
}: Props) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [timeResize, setTimeResize] = useState<TimeResize | null>(null);
  const [startResize, setStartResize] = useState<StartResize | null>(null);
  const [liceResize, setLiceResize] = useState<LiceResize | null>(null);
  // Live drag preview ("ghost"): where the dragged block would land + whether
  // it would clash. Span comes from the dragged block (or a 15-min default for
  // sidebar drags); dragKeyRef excludes the moving block from the clash check.
  const [ghost, setGhost] = useState<{
    liceId: string;
    slot: number;
    span: number;
    conflict: boolean;
    /** Full-width (admin/break bar) vs single-lice (pool/bracket) preview. */
    full: boolean;
  } | null>(null);
  const dragSpanRef = useRef<number | null>(null);
  const dragKeyRef = useRef<string | null>(null);

  if (lices.length === 0) {
    return <p className="text-sm text-gray-400">No lices configured for this event.</p>;
  }

  const liceIndexById = new Map(lices.map((l, i) => [l.id, i]));

  // Slot under a pointer Y, relative to the grid's first body row (after the
  // venue + lice header rows). Used to give block-view drops time precision.
  function slotFromClientY(clientY: number): number {
    const grid = gridRef.current;
    if (!grid) return 0;
    const top = grid.getBoundingClientRect().top + VENUE_HEADER_HEIGHT_PX + LICE_HEADER_HEIGHT_PX;
    return Math.max(0, Math.floor((clientY - top) / slotHeightPx));
  }

  // Slot ranges already occupied (other runs + every full-width break bar),
  // excluding the block currently being dragged, for the live clash tint.
  function occupantsExcept(excludeKey: string | null): SlotPlacement[] {
    const out: SlotPlacement[] = [];
    for (const b of blocks) {
      if (b.key === excludeKey) continue;
      out.push({
        liceIds: b.liceIds,
        startSlot: isoToSlot(b.startIso, baseDate, timezone),
        endSlot: isoToSlot(b.endIso, baseDate, timezone),
      });
    }
    const allLice = lices.map((l) => l.id);
    for (const brk of breaks) {
      if (`brk:${brk.id}` === excludeKey) continue; // the bar being dragged
      out.push({ liceIds: allLice, startSlot: brk.startSlot, endSlot: brk.startSlot + brk.span });
    }
    return out;
  }
  // Per-lice load (match runs only, not breaks) for the column-header chip.
  const blockOccupancy = blocks.map((b) => ({
    liceIds: b.liceIds,
    startSlot: isoToSlot(b.startIso, baseDate, timezone),
    endSlot: isoToSlot(b.endIso, baseDate, timezone),
  }));

  const venueGroups = computeVenueGroups(lices);
  // Body row for a slot: row 1 = venue band, row 2 = lice header, slot 0 → row 3.
  const rowFor = (slot: number): number => slot + 3;
  const lastRow = gridEndSlot + 3;

  // ── Vertical (time) resize: drag a block/break's bottom edge ──────────────
  function beginTimeResize(
    ev: React.PointerEvent<HTMLDivElement>,
    item: { key: string; startSlot: number; endSlot: number },
    commit: (newEndSlot: number) => void,
  ): void {
    ev.preventDefault();
    ev.stopPropagation();
    const handle = ev.currentTarget;
    handle.setPointerCapture(ev.pointerId);
    const startY = ev.clientY;
    setTimeResize({ key: item.key, startSlot: item.startSlot, previewEndSlot: item.endSlot });

    const clampEnd = (raw: number) => Math.max(item.startSlot + 1, Math.min(gridEndSlot, raw));
    function onMove(e: PointerEvent) {
      const delta = Math.round((e.clientY - startY) / slotHeightPx);
      const next = clampEnd(item.endSlot + delta);
      setTimeResize((prev) =>
        prev && prev.key === item.key ? { ...prev, previewEndSlot: next } : prev,
      );
    }
    function cleanup(e: PointerEvent) {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
    }
    function onUp(e: PointerEvent) {
      cleanup(e);
      const final = clampEnd(item.endSlot + Math.round((e.clientY - startY) / slotHeightPx));
      setTimeResize(null);
      if (final !== item.endSlot) commit(final);
    }
    function onCancel(e: PointerEvent) {
      cleanup(e);
      setTimeResize(null);
    }
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
  }

  // ── Top-edge (start) resize: drag a block/break's top edge, end fixed ─────
  function beginStartResize(
    ev: React.PointerEvent<HTMLDivElement>,
    item: { key: string; startSlot: number; endSlot: number },
    commit: (newStartSlot: number) => void,
  ): void {
    ev.preventDefault();
    ev.stopPropagation();
    const handle = ev.currentTarget;
    handle.setPointerCapture(ev.pointerId);
    const startY = ev.clientY;
    setStartResize({ key: item.key, previewStartSlot: item.startSlot, endSlot: item.endSlot });

    // resizeStartSlot snaps to 15 min and clamps into [0, end − 1].
    const clampStart = (raw: number) => resizeStartSlot(raw, item.endSlot);
    function onMove(e: PointerEvent) {
      const delta = Math.round((e.clientY - startY) / slotHeightPx);
      const next = clampStart(item.startSlot + delta);
      setStartResize((prev) =>
        prev && prev.key === item.key ? { ...prev, previewStartSlot: next } : prev,
      );
    }
    function cleanup(e: PointerEvent) {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
    }
    function onUp(e: PointerEvent) {
      cleanup(e);
      const final = clampStart(item.startSlot + Math.round((e.clientY - startY) / slotHeightPx));
      setStartResize(null);
      if (final !== item.startSlot) commit(final);
    }
    function onCancel(e: PointerEvent) {
      cleanup(e);
      setStartResize(null);
    }
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
  }

  // ── Horizontal (lice) resize: drag a block's right edge ───────────────────
  function beginLiceResize(ev: React.PointerEvent<HTMLDivElement>, block: ScheduleBlock): void {
    ev.preventDefault();
    ev.stopPropagation();
    const handle = ev.currentTarget;
    handle.setPointerCapture(ev.pointerId);
    const startX = ev.clientX;
    const startIndices = block.liceIds
      .map((id) => liceIndexById.get(id))
      .filter((i): i is number => i != null)
      .sort((a, b) => a - b);
    const colW = Math.max(
      MIN_LICE_COL_PX,
      gridRef.current
        ? (gridRef.current.clientWidth - TIME_LABEL_COL_PX) / lices.length
        : MIN_LICE_COL_PX,
    );
    const spanFor = (dx: number) =>
      liceSpanFromDelta({
        kind: block.kind,
        liceIndices: startIndices,
        deltaCols: Math.round(dx / colW),
        liceCount: lices.length,
      });
    setLiceResize({ key: block.key, previewIndices: startIndices });

    function onMove(e: PointerEvent) {
      const next = spanFor(e.clientX - startX);
      setLiceResize((prev) =>
        prev && prev.key === block.key ? { ...prev, previewIndices: next } : prev,
      );
    }
    function cleanup(e: PointerEvent) {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
    }
    function onUp(e: PointerEvent) {
      cleanup(e);
      const next = spanFor(e.clientX - startX);
      setLiceResize(null);
      const sameSpan =
        next.length === startIndices.length && next.every((v, i) => v === startIndices[i]);
      if (!sameSpan)
        onResizeBlockLices(
          block,
          next.map((i) => lices[i]!.id),
        );
    }
    function onCancel(e: PointerEvent) {
      cleanup(e);
      setLiceResize(null);
    }
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div
        ref={gridRef}
        className="relative grid w-full"
        style={{
          gridTemplateColumns: `${TIME_LABEL_COL_PX}px repeat(${lices.length}, minmax(${MIN_LICE_COL_PX}px, 1fr))`,
          gridAutoRows: `${slotHeightPx}px`,
        }}
      >
        {/* Row 1 corner + venue band */}
        <div
          className="sticky left-0 z-30 bg-white"
          style={{ gridColumn: 1, gridRow: 1, height: VENUE_HEADER_HEIGHT_PX }}
        />
        {venueGroups.map((g, i) => (
          <div
            key={`venue-${i}`}
            className="sticky top-0 z-20 flex items-center justify-center border-b border-blue-200 bg-blue-50 px-2 text-sm font-semibold text-blue-800 truncate"
            style={{
              gridColumn: `${g.startIndex + 2} / span ${g.span}`,
              gridRow: 1,
              height: VENUE_HEADER_HEIGHT_PX,
            }}
          >
            {g.venueName ?? 'No venue'}
          </div>
        ))}

        {/* Row 2: time-axis corner + per-lice header (name + drift) */}
        <div
          className="sticky left-0 z-30 bg-white text-[10px] font-semibold uppercase tracking-wide text-gray-400 flex items-end justify-end pr-1 pb-0.5"
          style={{
            gridColumn: 1,
            gridRow: 2,
            top: VENUE_HEADER_HEIGHT_PX,
            height: LICE_HEADER_HEIGHT_PX,
          }}
        >
          Time
        </div>
        {lices.map((lice, idx) => {
          const d = drift.get(lice.id);
          const late = d ? d.driftMin > 0 : false;
          const util = liceUtilizationPct(blockOccupancy, lice.id, gridEndSlot);
          return (
            <div
              key={`head-${lice.id}`}
              className="sticky z-20 flex flex-col items-center justify-center border-b border-gray-200 bg-white px-1 relative"
              style={{
                gridColumn: idx + 2,
                gridRow: 2,
                top: VENUE_HEADER_HEIGHT_PX,
                height: LICE_HEADER_HEIGHT_PX,
              }}
            >
              {util > 0 ? (
                <span
                  className="absolute right-1 top-0.5 text-[9px] font-medium text-gray-400"
                  title={`${util}% of the day's grid scheduled on this lice`}
                >
                  {util}%
                </span>
              ) : null}
              <span className="text-xs font-bold uppercase tracking-wider text-gray-600 truncate">
                {lice.name}
              </span>
              {d && Math.abs(d.driftMin) >= 2 ? (
                <span className="flex items-center gap-1">
                  <span
                    className={`text-[10px] font-semibold ${late ? 'text-red-600' : 'text-emerald-600'}`}
                    title={`Based on ${d.basisLabel}`}
                  >
                    {late ? `▲ ${d.driftMin}m late` : `▼ ${-d.driftMin}m ahead`}
                  </span>
                  {late ? (
                    <button
                      type="button"
                      onClick={() => onShiftLice(lice.id, d.driftMin)}
                      className="rounded border border-red-300 px-1 text-[10px] font-medium text-red-700 hover:bg-red-50"
                      title="Push this lice's upcoming matches by the delay"
                    >
                      +{d.driftMin}
                    </button>
                  ) : null}
                </span>
              ) : d ? (
                <span className="text-[10px] font-medium text-emerald-600">on time</span>
              ) : null}
            </div>
          );
        })}

        {/* Faint 15-min gridlines (skip the hour rows, which draw a darker
            line below) so the snap target reads clearly behind the columns. */}
        {Array.from({ length: gridEndSlot }, (_, slot) =>
          slot % SNAP_SLOTS === 0 && slot % 12 !== 0 ? (
            <div
              key={`q-${slot}`}
              aria-hidden="true"
              className="pointer-events-none"
              style={{
                gridColumn: '2 / -1',
                gridRow: rowFor(slot),
                borderTop: '1px solid #f8fafc',
              }}
            />
          ) : null,
        )}

        {/* Left ruler: hour labels + faint full-width hour lines */}
        {Array.from({ length: gridEndSlot }, (_, slot) =>
          slot % 12 === 0 ? (
            <div key={`ruler-${slot}`} className="contents">
              <div
                className="sticky left-0 z-10 flex items-start justify-end bg-white pr-1 text-[10px] text-gray-400 select-none"
                style={{ gridColumn: 1, gridRow: rowFor(slot), borderTop: '1px solid #e5e7eb' }}
              >
                {formatSlotTime(slot)}
              </div>
              <div
                aria-hidden="true"
                className="pointer-events-none"
                style={{
                  gridColumn: '2 / -1',
                  gridRow: rowFor(slot),
                  borderTop: '1px solid #f1f5f9',
                }}
              />
            </div>
          ) : null,
        )}

        {/* Per-lice drop columns (behind blocks) */}
        {lices.map((lice, idx) => {
          const isOver = dragOverLiceId === lice.id;
          return (
            <div
              key={`drop-${lice.id}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (!isOver) onDragOverLice(lice.id);
                const slot = snapSlot(slotFromClientY(e.clientY));
                const span = dragSpanRef.current ?? SNAP_SLOTS;
                const full = dragKeyRef.current?.startsWith('brk:') ?? false;
                // A full-width bar clashes against every lice; a pool/bracket
                // block only against its own target column.
                const conflict = wouldOverlap(
                  {
                    liceIds: full ? lices.map((l) => l.id) : [lice.id],
                    startSlot: slot,
                    endSlot: slot + span,
                  },
                  occupantsExcept(dragKeyRef.current),
                );
                setGhost({ liceId: lice.id, slot, span, conflict, full });
              }}
              onDragLeave={() => {
                if (isOver) onDragOverLice(null);
                // Clear the ghost when leaving a column; re-set on entering the
                // next one. Leaving the grid entirely thus clears it cleanly.
                setGhost((g) => (g?.liceId === lice.id ? null : g));
              }}
              onDrop={(e) => {
                const slot = snapSlot(slotFromClientY(e.clientY));
                onDragOverLice(null);
                setGhost(null);
                dragSpanRef.current = null;
                dragKeyRef.current = null;
                onDropOnLice(lice.id, slot);
              }}
              onDoubleClick={(e) => onCreateAtCell(snapSlot(slotFromClientY(e.clientY)))}
              className={[
                'border-l border-gray-100 transition-colors',
                isOver
                  ? 'bg-blue-50 ring-2 ring-inset ring-blue-300'
                  : idx % 2 === 1
                    ? 'bg-gray-50/40'
                    : '',
              ].join(' ')}
              style={{ gridColumn: idx + 2, gridRow: `3 / ${lastRow}`, zIndex: 1 }}
            />
          );
        })}

        {/* Break / admin bars — full width */}
        {breaks.map((brk) => {
          const brkKey = `brk:${brk.id}`;
          const startSlot =
            startResize?.key === brkKey ? startResize.previewStartSlot : brk.startSlot;
          const endSlot =
            timeResize?.key === brkKey ? timeResize.previewEndSlot : brk.startSlot + brk.span;
          const tint = blockTint(brk.colorHex);
          return (
            <div
              key={`brk-${brk.id}`}
              draggable
              onDragStart={() => {
                dragSpanRef.current = Math.max(1, brk.span);
                dragKeyRef.current = brkKey;
                onBreakDragStart(brk);
              }}
              onDragEnd={() => {
                dragSpanRef.current = null;
                dragKeyRef.current = null;
                setGhost(null);
                onBreakDragEnd();
              }}
              className={[
                'group relative flex cursor-grab items-center justify-center overflow-hidden border-y px-2 text-[11px] font-semibold uppercase tracking-wide active:cursor-grabbing',
                tint ? 'text-gray-700' : breakBarClasses(brk.kind),
              ].join(' ')}
              style={{
                gridColumn: '2 / -1',
                gridRow: `${rowFor(startSlot)} / ${rowFor(Math.max(startSlot + 1, endSlot))}`,
                zIndex: 6,
                ...(tint ?? {}),
              }}
            >
              <span className="truncate">
                {brk.label} ({brk.startTime}–{brk.endTime})
              </span>
              <div className="absolute right-1 top-0.5 flex gap-0.5 opacity-0 group-hover:opacity-100">
                <button
                  type="button"
                  aria-label={`Edit ${brk.label}`}
                  onClick={() => onEditBreak(brk)}
                  className="rounded bg-white/70 px-1 text-[11px] leading-none text-gray-600 hover:bg-white"
                >
                  ✎
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${brk.label}`}
                  title="Delete this block"
                  onClick={() => onDeleteBreak(brk)}
                  className="rounded bg-white/70 px-1 text-[11px] leading-none text-red-600 hover:bg-red-50"
                >
                  ✕
                </button>
              </div>
              <div
                role="separator"
                aria-label={`Resize start of ${brk.label}`}
                onPointerDown={(ev) =>
                  beginStartResize(
                    ev,
                    { key: brkKey, startSlot: brk.startSlot, endSlot: brk.startSlot + brk.span },
                    (newStart) => onResizeBreakStart(brk, newStart),
                  )
                }
                className="absolute inset-x-0 top-0 z-30 h-1.5 cursor-row-resize bg-transparent hover:bg-slate-500/40"
              />
              <div
                role="separator"
                aria-label={`Resize ${brk.label}`}
                onPointerDown={(ev) =>
                  beginTimeResize(
                    ev,
                    {
                      key: brkKey,
                      startSlot: brk.startSlot,
                      endSlot: brk.startSlot + brk.span,
                    },
                    (newEnd) => onResizeBreakTime(brk, newEnd),
                  )
                }
                className="absolute inset-x-0 bottom-0 z-30 h-1.5 cursor-row-resize bg-transparent hover:bg-slate-500/40"
              />
            </div>
          );
        })}

        {/* Pool / bracket blocks — span their lice column(s) */}
        {blocks.map((block) => {
          const indices = block.liceIds
            .map((id) => liceIndexById.get(id))
            .filter((i): i is number => i != null);
          if (indices.length === 0) return null;
          const previewIdx = liceResize?.key === block.key ? liceResize.previewIndices : indices;
          const colStart = Math.min(...previewIdx) + 2;
          const colEnd = Math.max(...previewIdx) + 3;
          const startSlot = isoToSlot(block.startIso, baseDate, timezone);
          const baseEndSlot = isoToSlot(block.endIso, baseDate, timezone);
          const endSlot = timeResize?.key === block.key ? timeResize.previewEndSlot : baseEndSlot;
          const effStartSlot =
            startResize?.key === block.key ? startResize.previewStartSlot : startSlot;
          const color = tournamentColorByName.get(block.tournamentName ?? '') ?? null;
          const hasConflict = block.matches.some((m) => conflictMatchIds.has(m.id));
          const hasOverlap = overlapBlockKeys.has(block.key);
          const tone = hasConflict
            ? 'border-red-400 bg-red-100 text-red-800'
            : hasOverlap
              ? 'border-amber-400 bg-amber-100 text-amber-800'
              : `${tintBgClassFor(color)} ${tintBorderClassFor(color)} ${tintTextClassFor(color)}`;
          // Status accent (from the run's matches) + legend-focus dimming.
          const allDone =
            block.matches.length > 0 && block.matches.every((m) => m.status === 'completed');
          const anyRunning = block.matches.some((m) => m.status === 'running');
          const dimmed = focusedTournament !== null && block.tournamentName !== focusedTournament;
          const opacityClass = dimmed ? 'opacity-30' : allDone ? 'opacity-60' : '';
          return (
            <div
              key={block.key}
              draggable
              onDragStart={() => {
                dragSpanRef.current = Math.max(1, baseEndSlot - startSlot);
                dragKeyRef.current = block.key;
                onBlockDragStart(block);
              }}
              onDragEnd={() => {
                dragSpanRef.current = null;
                dragKeyRef.current = null;
                setGhost(null);
                onBlockDragEnd();
              }}
              title={`${block.tournamentName ?? ''} · ${block.label} · ${block.matchCount} matches`}
              className={[
                'group relative m-px flex cursor-grab flex-col overflow-hidden rounded-md border pl-2.5 pr-1.5 py-1 transition-opacity active:cursor-grabbing',
                tone,
                anyRunning ? 'ring-1 ring-emerald-400' : '',
                opacityClass,
              ].join(' ')}
              style={{
                gridColumn: `${colStart} / ${colEnd}`,
                gridRow: `${rowFor(effStartSlot)} / ${rowFor(Math.max(effStartSlot + 1, endSlot))}`,
                zIndex: 10,
              }}
            >
              {/* Left color stripe — the tournament's identity accent. */}
              <span
                aria-hidden="true"
                className={`absolute inset-y-0 left-0 w-1 ${accentClassFor(color)}`}
              />
              {block.tournamentName ? (
                <span className="flex items-center gap-1 truncate text-[11px] font-semibold uppercase tracking-wide opacity-70">
                  {anyRunning ? <span className="text-emerald-500">●</span> : null}
                  <span className="truncate">{block.tournamentName}</span>
                </span>
              ) : null}
              <span className="truncate text-sm font-bold leading-tight">{block.label}</span>
              <span className="truncate text-xs font-medium opacity-80">
                {block.matchCount} fights · {formatSlotTime(startSlot)}–
                {formatSlotTime(baseEndSlot)}
              </span>
              <div className="absolute right-0.5 top-0.5 flex gap-0.5 opacity-0 group-hover:opacity-100">
                <button
                  type="button"
                  aria-label={`Edit ${block.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditBlock(block);
                  }}
                  className="rounded bg-white/70 px-1 text-[11px] leading-none text-gray-600 hover:bg-white"
                >
                  ✎
                </button>
                <button
                  type="button"
                  aria-label={`Unschedule ${block.label}`}
                  title="Unschedule — return these matches to the Unscheduled list"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteBlock(block);
                  }}
                  className="rounded bg-white/70 px-1 text-[11px] leading-none text-red-600 hover:bg-red-50"
                >
                  ✕
                </button>
              </div>
              {/* top edge — resize START (re-time the run) */}
              <div
                role="separator"
                aria-label={`Resize start of ${block.label}`}
                onPointerDown={(ev) =>
                  beginStartResize(
                    ev,
                    { key: block.key, startSlot, endSlot: baseEndSlot },
                    (newStart) => onResizeBlockStart(block, newStart),
                  )
                }
                className="absolute inset-x-0 top-0 z-20 h-1.5 cursor-row-resize bg-transparent hover:bg-black/20"
              />
              {/* bottom edge — resize TIME */}
              <div
                role="separator"
                aria-label={`Resize time of ${block.label}`}
                onPointerDown={(ev) =>
                  beginTimeResize(
                    ev,
                    { key: block.key, startSlot, endSlot: baseEndSlot },
                    (newEnd) => onResizeBlockTime(block, newEnd),
                  )
                }
                className="absolute inset-x-0 bottom-0 z-20 h-1.5 cursor-row-resize bg-transparent hover:bg-black/20"
              />
              {/* right edge — resize LICE span */}
              <div
                role="separator"
                aria-label={`Resize lices of ${block.label}`}
                onPointerDown={(ev) => beginLiceResize(ev, block)}
                className="absolute inset-y-0 right-0 z-20 w-1.5 cursor-col-resize bg-transparent hover:bg-black/20"
              />
            </div>
          );
        })}

        {/* Drag ghost — where the block/bar would land, with a live time
            readout. Full-width for admin/break bars, single-lice otherwise;
            red when it would clash. */}
        {ghost &&
          (() => {
            const idx = liceIndexById.get(ghost.liceId);
            if (!ghost.full && idx == null) return null;
            return (
              <div
                aria-hidden="true"
                className={[
                  'pointer-events-none m-px flex items-center justify-center rounded-md border-2 border-dashed text-[11px] font-semibold',
                  ghost.conflict
                    ? 'border-red-500 bg-red-300/40 text-red-700'
                    : 'border-blue-500 bg-blue-300/40 text-blue-700',
                ].join(' ')}
                style={{
                  gridColumn: ghost.full ? '2 / -1' : (idx ?? 0) + 2,
                  gridRow: `${rowFor(ghost.slot)} / ${rowFor(ghost.slot + Math.max(1, ghost.span))}`,
                  zIndex: 13,
                }}
              >
                {formatSlotTime(ghost.slot)}–{formatSlotTime(ghost.slot + Math.max(1, ghost.span))}
              </div>
            );
          })()}

        {/* "Now" marker — full-width line on the active day */}
        {nowSlot !== null && nowSlot < gridEndSlot ? (
          <div
            aria-hidden="true"
            className="pointer-events-none"
            style={{
              gridColumn: '2 / -1',
              gridRow: rowFor(nowSlot),
              borderTop: '2px solid #ef4444',
              zIndex: 15,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
