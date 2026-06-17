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
import { tintBgClassFor, tintBorderClassFor, tintTextClassFor } from '@myclash/ui';
import type { ScheduleBlock } from './schedule-blocks';
import type { LiceDrift } from './lice-drift';
import { liceSpanFromDelta } from './lice-span';
import {
  LICE_HEADER_HEIGHT_PX,
  MIN_LICE_COL_PX,
  SLOT_HEIGHT_PX,
  TIME_LABEL_COL_PX,
  VENUE_HEADER_HEIGHT_PX,
  computeVenueGroups,
  formatSlotTime,
  isoToSlot,
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
  onShiftLice: (liceId: string, driftMin: number) => void;
  onEditBlock: (block: ScheduleBlock) => void;
  onEditBreak: (brk: BgvBreak) => void;
  onResizeBlockTime: (block: ScheduleBlock, newEndSlot: number) => void;
  onResizeBreakTime: (brk: BgvBreak, newEndSlot: number) => void;
  onResizeBlockLices: (block: ScheduleBlock, newLiceIds: string[]) => void;
  onBlockDragStart: (block: ScheduleBlock) => void;
  onBlockDragEnd: () => void;
  onDropOnLice: (liceId: string) => void;
  dragOverLiceId: string | null;
  onDragOverLice: (liceId: string | null) => void;
}

function breakBarClasses(kind: string): string {
  if (kind === 'break') return 'border-slate-300 bg-slate-100 text-slate-600';
  if (kind === 'workshop') return 'border-amber-300 bg-amber-50 text-amber-800';
  return 'border-purple-300 bg-purple-50 text-purple-800';
}

type TimeResize = { key: string; startSlot: number; previewEndSlot: number };
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
  onShiftLice,
  onEditBlock,
  onEditBreak,
  onResizeBlockTime,
  onResizeBreakTime,
  onResizeBlockLices,
  onBlockDragStart,
  onBlockDragEnd,
  onDropOnLice,
  dragOverLiceId,
  onDragOverLice,
}: Props) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [timeResize, setTimeResize] = useState<TimeResize | null>(null);
  const [liceResize, setLiceResize] = useState<LiceResize | null>(null);

  if (lices.length === 0) {
    return <p className="text-sm text-gray-400">No lices configured for this event.</p>;
  }

  const liceIndexById = new Map(lices.map((l, i) => [l.id, i]));
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
      const delta = Math.round((e.clientY - startY) / SLOT_HEIGHT_PX);
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
      const final = clampEnd(item.endSlot + Math.round((e.clientY - startY) / SLOT_HEIGHT_PX));
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
          gridAutoRows: `${SLOT_HEIGHT_PX}px`,
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
            className="flex items-center justify-center border-b border-blue-200 bg-blue-50 px-2 text-sm font-semibold text-blue-800 truncate"
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
          return (
            <div
              key={`head-${lice.id}`}
              className="sticky z-20 flex flex-col items-center justify-center border-b border-gray-200 bg-white px-1"
              style={{
                gridColumn: idx + 2,
                gridRow: 2,
                top: VENUE_HEADER_HEIGHT_PX,
                height: LICE_HEADER_HEIGHT_PX,
              }}
            >
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
              }}
              onDragLeave={() => {
                if (isOver) onDragOverLice(null);
              }}
              onDrop={() => {
                onDragOverLice(null);
                onDropOnLice(lice.id);
              }}
              className={[
                'border-l border-gray-100 transition-colors',
                isOver ? 'bg-blue-50 ring-2 ring-inset ring-blue-300' : '',
              ].join(' ')}
              style={{ gridColumn: idx + 2, gridRow: `3 / ${lastRow}`, zIndex: 1 }}
            />
          );
        })}

        {/* Break / admin bars — full width */}
        {breaks.map((brk) => {
          const endSlot =
            timeResize?.key === `brk:${brk.id}`
              ? timeResize.previewEndSlot
              : brk.startSlot + brk.span;
          return (
            <div
              key={`brk-${brk.id}`}
              className={[
                'group relative flex items-center justify-center overflow-hidden border-y px-2 text-[11px] font-semibold uppercase tracking-wide',
                breakBarClasses(brk.kind),
              ].join(' ')}
              style={{
                gridColumn: '2 / -1',
                gridRow: `${rowFor(brk.startSlot)} / ${rowFor(endSlot)}`,
                zIndex: 6,
              }}
            >
              <span className="truncate">
                {brk.label} ({brk.startTime}–{brk.endTime})
              </span>
              <button
                type="button"
                aria-label={`Edit ${brk.label}`}
                onClick={() => onEditBreak(brk)}
                className="absolute right-1 top-0.5 rounded bg-white/70 px-1 text-[11px] leading-none text-gray-600 opacity-0 hover:bg-white group-hover:opacity-100"
              >
                ✎
              </button>
              <div
                role="separator"
                aria-label={`Resize ${brk.label}`}
                onPointerDown={(ev) =>
                  beginTimeResize(
                    ev,
                    {
                      key: `brk:${brk.id}`,
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
          const color = tournamentColorByName.get(block.tournamentName ?? '') ?? null;
          const hasConflict = block.matches.some((m) => conflictMatchIds.has(m.id));
          const hasOverlap = overlapBlockKeys.has(block.key);
          const tone = hasConflict
            ? 'border-red-400 bg-red-100 text-red-800'
            : hasOverlap
              ? 'border-amber-400 bg-amber-100 text-amber-800'
              : `${tintBgClassFor(color)} ${tintBorderClassFor(color)} ${tintTextClassFor(color)}`;
          return (
            <div
              key={block.key}
              draggable
              onDragStart={() => onBlockDragStart(block)}
              onDragEnd={onBlockDragEnd}
              title={`${block.tournamentName ?? ''} · ${block.label} · ${block.matchCount} matches`}
              className={[
                'group relative m-px flex cursor-grab flex-col overflow-hidden rounded-md border px-1.5 py-1 active:cursor-grabbing',
                tone,
              ].join(' ')}
              style={{
                gridColumn: `${colStart} / ${colEnd}`,
                gridRow: `${rowFor(startSlot)} / ${rowFor(Math.max(startSlot + 1, endSlot))}`,
                zIndex: 10,
              }}
            >
              {block.tournamentName ? (
                <span className="truncate text-[9px] font-semibold uppercase tracking-wide opacity-70">
                  {block.tournamentName}
                </span>
              ) : null}
              <span className="truncate text-xs font-bold leading-tight">{block.label}</span>
              <span className="truncate text-[10px] opacity-80">
                {block.matchCount} · {formatSlotTime(startSlot)}–{formatSlotTime(baseEndSlot)}
              </span>
              <button
                type="button"
                aria-label={`Edit ${block.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onEditBlock(block);
                }}
                className="absolute right-0.5 top-0.5 rounded bg-white/70 px-1 text-[11px] leading-none text-gray-600 opacity-0 hover:bg-white group-hover:opacity-100"
              >
                ✎
              </button>
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
