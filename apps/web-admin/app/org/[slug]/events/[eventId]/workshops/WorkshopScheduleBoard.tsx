'use client';

/* eslint-disable myclash/no-literal-string */

/**
 * WorkshopScheduleBoard — the `#schedule` tab.
 *
 * Mirrors the event schedule canvas, scoped to workshops: day tabs, a time
 * gutter on the left, venue bands → area columns across the top, one block
 * per workshop's single session, an unscheduled-workshops drawer on the
 * right, drag-to-(re)schedule and a bottom grip to resize the end time.
 * Custom workshop-only break bars (Phase E) render as full-width rows.
 */

import { useEffect, useRef, useState } from 'react';
import {
  GRID_START_HOUR,
  SLOT_HEIGHT_PX,
  SLOT_MINUTES,
  slotToHHMM,
  slotToTime,
} from '../schedule/schedule-grid-geometry';
import { formatDayLabel } from '../schedule/event-days';
import {
  buildAreaColumns,
  buildColumnBands,
  buildWorkshopSessionBlocks,
  unscheduledWorkshops,
  type AreaColumn,
  type BoardVenue,
  type BoardWorkshop,
} from './workshop-board-geometry';

export interface WorkshopBreak {
  id: string;
  dayIndex: number;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  label: string | null;
}

export interface BoardPlacement {
  venueId: string;
  areaId: string | null;
  startTime: string; // ISO
  endTime: string; // ISO
}

interface Props {
  workshops: BoardWorkshop[];
  venues: BoardVenue[];
  days: string[];
  breaks?: WorkshopBreak[];
  onPlace: (workshopId: string, sessionId: string | null, placement: BoardPlacement) => void;
  onBlockClick?: (workshopId: string) => void;
  onAddBreak?: (dayIndex: number) => void;
  onEditBreak?: (b: WorkshopBreak) => void;
}

const COL_WIDTH_PX = 150;
const GUTTER_PX = 56;
const END_HOUR_FLOOR = 20;

function endSlotFor(workshops: BoardWorkshop[]): number {
  // Grid runs to the later of END_HOUR_FLOOR or the latest session end.
  let maxSlot = (END_HOUR_FLOOR - GRID_START_HOUR) * (60 / SLOT_MINUTES);
  for (const w of workshops) {
    const end = w.sessions[0]?.endsAt;
    if (!end) continue;
    const d = new Date(end);
    const slot = ((d.getHours() - GRID_START_HOUR) * 60 + d.getMinutes()) / SLOT_MINUTES;
    if (slot > maxSlot) maxSlot = Math.ceil(slot);
  }
  return maxSlot;
}

export function WorkshopScheduleBoard({
  workshops,
  venues,
  days,
  breaks = [],
  onPlace,
  onBlockClick,
  onAddBreak,
  onEditBreak,
}: Props) {
  const [activeDay, setActiveDay] = useState<string>(days[0] ?? '');
  useEffect(() => {
    if (days.length > 0 && !days.includes(activeDay)) setActiveDay(days[0]!);
  }, [days, activeDay]);

  const columns = buildAreaColumns(venues);
  const bands = buildColumnBands(columns);
  const dayIndex = Math.max(0, days.indexOf(activeDay));
  const blocks = buildWorkshopSessionBlocks(workshops, columns, activeDay);
  const drawer = unscheduledWorkshops(workshops, columns);
  const totalSlots = endSlotFor(workshops);
  const gridHeight = totalSlots * SLOT_HEIGHT_PX;

  const colByKey = new Map(columns.map((c) => [c.key, c]));

  // Resize state: which session, its column, fixed start slot, live end slot.
  const [resizing, setResizing] = useState<{
    workshopId: string;
    sessionId: string;
    column: AreaColumn;
    startSlot: number;
    endSlot: number;
  } | null>(null);
  const resizingRef = useRef(resizing);
  resizingRef.current = resizing;

  function place(
    workshopId: string,
    sessionId: string | null,
    column: AreaColumn,
    startSlot: number,
    span: number,
  ) {
    const startTime = slotToTime(startSlot, activeDay);
    const endTime = slotToTime(startSlot + Math.max(1, span), activeDay);
    onPlace(workshopId, sessionId, {
      venueId: column.venueId,
      areaId: column.areaId,
      startTime,
      endTime,
    });
  }

  function handleDrop(column: AreaColumn, e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const workshopId = e.dataTransfer.getData('workshopId');
    if (!workshopId) return;
    const sessionId = e.dataTransfer.getData('sessionId') || null;
    const spanStr = e.dataTransfer.getData('span');
    const span = spanStr ? Number(spanStr) : 12;
    const rect = e.currentTarget.getBoundingClientRect();
    const slot = Math.max(0, Math.round((e.clientY - rect.top) / SLOT_HEIGHT_PX));
    place(workshopId, sessionId, column, slot, span);
  }

  // Resize via pointer: track the grip, commit on release.
  useEffect(() => {
    if (!resizing) return;
    const startY = { current: 0, captured: false };
    function onMove(ev: PointerEvent) {
      const r = resizingRef.current;
      if (!r) return;
      if (!startY.captured) {
        startY.current = ev.clientY;
        startY.captured = true;
      }
      const deltaSlots = Math.round((ev.clientY - startY.current) / SLOT_HEIGHT_PX);
      const nextEnd = Math.max(r.startSlot + 1, r.startSlot + 1 + deltaSlots);
      setResizing((cur) => (cur ? { ...cur, endSlot: nextEnd } : cur));
    }
    function onUp() {
      const r = resizingRef.current;
      if (r) place(r.workshopId, r.sessionId, r.column, r.startSlot, r.endSlot - r.startSlot);
      setResizing(null);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizing?.sessionId]);

  const hourLines: number[] = [];
  for (let s = 0; s <= totalSlots; s += 60 / SLOT_MINUTES) hourLines.push(s);

  const dayBreaks = breaks.filter((b) => b.dayIndex === dayIndex);

  return (
    <div className="flex flex-col gap-3">
      {/* Day tabs */}
      {days.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {days.map((d, i) => (
            <button
              key={d}
              type="button"
              onClick={() => setActiveDay(d)}
              className={[
                'rounded-lg px-3 py-1 text-sm font-medium',
                d === activeDay
                  ? 'bg-red-700 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              ].join(' ')}
            >
              {days.length > 1 ? `Jour ${i + 1} · ${formatDayLabel(d)}` : formatDayLabel(d)}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-4">
        {/* Board */}
        <div className="flex-1 overflow-x-auto">
          {columns.length === 0 ? (
            <p className="text-sm text-amber-600">
              No workshop-capable venues for this event yet. Add one from the Venues tab.
            </p>
          ) : (
            <div className="inline-flex flex-col">
              {/* Venue band row */}
              <div className="flex" style={{ marginLeft: GUTTER_PX }}>
                {bands.map((band) => (
                  <div
                    key={band.venueId}
                    className="border-b border-r border-gray-200 bg-gray-50 px-2 py-1 text-center text-xs font-semibold text-gray-700 truncate"
                    style={{ width: band.span * COL_WIDTH_PX }}
                  >
                    {band.venueName}
                  </div>
                ))}
              </div>
              {/* Area header row */}
              <div className="flex" style={{ marginLeft: GUTTER_PX }}>
                {columns.map((c) => (
                  <div
                    key={c.key}
                    className="border-b border-r border-gray-200 px-2 py-1 text-center text-[11px] text-gray-500 truncate"
                    style={{ width: COL_WIDTH_PX }}
                  >
                    {c.areaName ?? '—'}
                  </div>
                ))}
              </div>

              {/* Grid body */}
              <div className="flex" style={{ height: gridHeight }}>
                {/* Time gutter */}
                <div className="relative" style={{ width: GUTTER_PX, height: gridHeight }}>
                  {hourLines.map((s) => (
                    <div
                      key={s}
                      className="absolute right-1 -translate-y-1/2 font-mono text-[10px] text-gray-400"
                      style={{ top: s * SLOT_HEIGHT_PX }}
                    >
                      {slotToHHMM(s)}
                    </div>
                  ))}
                </div>

                {/* Columns */}
                {columns.map((c) => (
                  <div
                    key={c.key}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDrop(c, e)}
                    className="relative border-r border-gray-100"
                    style={{ width: COL_WIDTH_PX, height: gridHeight }}
                  >
                    {/* Hour gridlines */}
                    {hourLines.map((s) => (
                      <div
                        key={s}
                        className="absolute left-0 right-0 border-t border-gray-100"
                        style={{ top: s * SLOT_HEIGHT_PX }}
                      />
                    ))}

                    {/* Break bars (full width within the column) */}
                    {dayBreaks.map((b) => {
                      const top = hhmmToSlotLocal(b.startTime) * SLOT_HEIGHT_PX;
                      const h =
                        (hhmmToSlotLocal(b.endTime) - hhmmToSlotLocal(b.startTime)) *
                        SLOT_HEIGHT_PX;
                      return (
                        <button
                          type="button"
                          key={`${b.id}-${c.key}`}
                          onClick={() => onEditBreak?.(b)}
                          className="absolute left-0 right-0 bg-slate-200/70 border-y border-slate-300 text-[10px] text-slate-600 overflow-hidden"
                          style={{ top, height: Math.max(SLOT_HEIGHT_PX, h) }}
                        >
                          {b.label ?? 'Break'}
                        </button>
                      );
                    })}

                    {/* Blocks for this column */}
                    {blocks
                      .filter((bl) => bl.columnKey === c.key)
                      .map((bl) => {
                        const isResizing = resizing?.sessionId === bl.sessionId;
                        const span = isResizing ? resizing!.endSlot - resizing!.startSlot : bl.span;
                        return (
                          <div
                            key={bl.sessionId}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData('workshopId', bl.workshopId);
                              e.dataTransfer.setData('sessionId', bl.sessionId);
                              e.dataTransfer.setData('span', String(bl.span));
                            }}
                            onClick={() => onBlockClick?.(bl.workshopId)}
                            className="absolute left-0.5 right-0.5 cursor-grab overflow-hidden rounded-md border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11px] text-red-900 shadow-sm hover:bg-red-100"
                            style={{
                              top: bl.startSlot * SLOT_HEIGHT_PX,
                              height: span * SLOT_HEIGHT_PX,
                            }}
                            title={bl.title}
                          >
                            <span className="block truncate font-medium">{bl.title}</span>
                            <span className="block font-mono text-[9px] text-red-700">
                              {slotToHHMM(bl.startSlot)}
                            </span>
                            {/* Resize grip */}
                            <span
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                setResizing({
                                  workshopId: bl.workshopId,
                                  sessionId: bl.sessionId,
                                  column: c,
                                  startSlot: bl.startSlot,
                                  endSlot: bl.startSlot + bl.span,
                                });
                              }}
                              className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize bg-red-300/60"
                            />
                          </div>
                        );
                      })}
                  </div>
                ))}
              </div>

              {onAddBreak && (
                <button
                  type="button"
                  onClick={() => onAddBreak(dayIndex)}
                  className="mt-2 self-start text-xs font-semibold text-slate-600 hover:text-slate-800"
                >
                  + Break
                </button>
              )}
            </div>
          )}
        </div>

        {/* Unscheduled drawer */}
        <aside className="w-56 shrink-0">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-gray-500">
            Unscheduled
          </h3>
          <div className="flex flex-col gap-2">
            {drawer.length === 0 ? (
              <p className="text-xs text-gray-400">All workshops are scheduled.</p>
            ) : (
              drawer.map((w) => (
                <div
                  key={w.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('workshopId', w.id);
                    e.dataTransfer.setData('sessionId', w.sessions[0]?.id ?? '');
                    e.dataTransfer.setData(
                      'span',
                      String(w.durationMinutes ? Math.round(w.durationMinutes / SLOT_MINUTES) : 12),
                    );
                  }}
                  className="cursor-grab rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm hover:border-red-300"
                  title={w.title}
                >
                  <span className="block truncate font-medium text-gray-800">{w.title}</span>
                  {w.durationMinutes != null && (
                    <span className="text-xs text-gray-400">{w.durationMinutes} min</span>
                  )}
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** HH:MM → slot index on the board axis (08:00 = 0). Local to the board. */
function hhmmToSlotLocal(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((s) => Number(s));
  const min = (h ?? 0) * 60 + (m ?? 0) - GRID_START_HOUR * 60;
  return Math.max(0, Math.floor(min / SLOT_MINUTES));
}
