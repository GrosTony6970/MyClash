'use client';

/* eslint-disable myclash/no-literal-string */

/**
 * WorkshopScheduleBoard — the `#schedule` tab.
 *
 * Day-tabbed planner: an unscheduled drawer + add-block + grid-window config
 * on the LEFT, the calendar grid on the RIGHT, a toolbar (zoom / CSV / print).
 * Drag-to-(re)schedule with a 15-min snap + a drop-shadow ghost showing the
 * live target time; conflicts cascade DOWN past other workshops AND the day's
 * break bars (fixed obstacles). Workshop cards resize from top or bottom;
 * break bars (Lunch/pause) are full-width, draggable, top/bottom-resizable and
 * deletable. A red "now" line marks the current time; still-overlapping cards
 * are outlined red. The visible window (start/end hour) is configurable.
 */

import { useEffect, useRef, useState } from 'react';
import {
  GRID_START_HOUR,
  SLOT_HEIGHT_MAX,
  SLOT_HEIGHT_MIN,
  SLOT_MINUTES,
  hhmmToSlot,
  nowSlotForDay,
  resizeStartSlot,
  slotToHHMM,
  slotToTime,
  snapSlot,
  zoomToSlotHeight,
} from '../schedule/schedule-grid-geometry';
import { minutesIntoDayInZone } from '@myclash/time';
import { tintBgClassFor, tintBorderClassFor, tintTextClassFor } from '@myclash/ui';
import { formatDayLabel } from '../schedule/event-days';
import { workshopScheduleToCsv } from './workshop-schedule-csv';
import {
  breakTimesFromSlots,
  findWorkshopOverlaps,
  placeWorkshopBlock,
  type Interval,
} from './workshop-placement';
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
  color?: string | null;
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
  /** Event IANA timezone — the board axis + placement are resolved in it. */
  timezone: string;
  breaks?: WorkshopBreak[];
  onPlace: (workshopId: string, sessionId: string | null, placement: BoardPlacement) => void;
  onBlockClick?: (workshopId: string) => void;
  onUnschedule?: (sessionId: string) => void;
  onAddBreak?: (dayIndex: number) => void;
  onEditBreak?: (b: WorkshopBreak) => void;
  onUpdateBreak?: (b: WorkshopBreak, times: { startTime: string; endTime: string }) => void;
  onDeleteBreak?: (id: string) => void;
}

// Minimum area-column width. Columns grow to fill the viewport (like the main
// schedule grid's `minmax(MIN, 1fr)` lices); below this they keep their width
// and the board scrolls horizontally instead.
const COL_MIN_WIDTH_PX = 240;
// Fallback width before the viewport has been measured (avoids a first-paint
// flash of mis-sized columns).
const COL_WIDTH_PX = 280;
const GUTTER_PX = 56;
const DEFAULT_ZOOM = 28;
const ZOOM_KEY = 'myclash.workshops.zoom';
const GRID_KEY = 'myclash.workshops.grid';
const SLOTS_PER_HOUR = 60 / SLOT_MINUTES;

function readGridWindow(): { startHour: number; endHour: number } {
  if (typeof window === 'undefined') return { startHour: GRID_START_HOUR, endHour: 20 };
  try {
    const raw = window.localStorage.getItem(GRID_KEY);
    if (raw) {
      const v = JSON.parse(raw) as { startHour?: number; endHour?: number };
      const startHour = Number.isInteger(v.startHour) ? v.startHour! : GRID_START_HOUR;
      const endHour = Number.isInteger(v.endHour) && v.endHour! > startHour ? v.endHour! : 20;
      return { startHour, endHour };
    }
  } catch {
    /* fall through to defaults */
  }
  return { startHour: GRID_START_HOUR, endHour: 20 };
}

export function WorkshopScheduleBoard({
  workshops,
  venues,
  days,
  timezone,
  breaks = [],
  onPlace,
  onBlockClick,
  onUnschedule,
  onAddBreak,
  onEditBreak,
  onUpdateBreak,
  onDeleteBreak,
}: Props) {
  const [activeDay, setActiveDay] = useState<string>(days[0] ?? '');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep activeDay valid when the days list changes; behaviour-preserving
    if (days.length > 0 && !days.includes(activeDay)) setActiveDay(days[0]!);
  }, [days, activeDay]);

  // Zoom (row height) — persisted on toggle, no setState-in-effect.
  const [slotHeightPx, setSlotHeightPx] = useState<number>(() => {
    if (typeof window === 'undefined') return DEFAULT_ZOOM;
    const stored = Number(window.localStorage.getItem(ZOOM_KEY));
    return Number.isFinite(stored) && stored > 0 ? zoomToSlotHeight(stored) : DEFAULT_ZOOM;
  });
  function zoom(delta: number) {
    setSlotHeightPx((h) => {
      const next = zoomToSlotHeight(h + delta);
      if (typeof window !== 'undefined') window.localStorage.setItem(ZOOM_KEY, String(next));
      return next;
    });
  }

  // Grid window (start/end hour) — persisted, board-local.
  const [grid, setGrid] = useState(readGridWindow);
  const { startHour, endHour } = grid;
  function setWindow(next: { startHour: number; endHour: number }) {
    setGrid(next);
    if (typeof window !== 'undefined') window.localStorage.setItem(GRID_KEY, JSON.stringify(next));
  }

  // "Now" line — tick each minute (setState from a timer callback is fine).
  const [nowIso, setNowIso] = useState<string | null>(null);
  useEffect(() => {
    // First tick deferred (setTimeout) so we never setState synchronously in
    // the effect body; then refresh each minute.
    const tick = () => setNowIso(new Date().toISOString());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  const columns = buildAreaColumns(venues);
  const bands = buildColumnBands(columns);

  // Size the area columns to fill the grid viewport so the board uses the whole
  // screen (matching the main schedule grid). Measured live so it tracks window
  // resizes and the sidebar collapse; falls back to a fixed width pre-measure
  // and never goes below COL_MIN_WIDTH_PX (so many columns scroll instead of
  // squashing).
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const [gridViewportWidth, setGridViewportWidth] = useState(0);
  useEffect(() => {
    const el = gridScrollRef.current;
    if (!el) return;
    const measure = () => setGridViewportWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const colWidth =
    columns.length > 0 && gridViewportWidth > 0
      ? Math.max(COL_MIN_WIDTH_PX, Math.floor((gridViewportWidth - GUTTER_PX) / columns.length))
      : COL_WIDTH_PX;
  const dayIndex = Math.max(0, days.indexOf(activeDay));
  const blocks = buildWorkshopSessionBlocks(workshops, columns, activeDay, timezone, startHour);
  const drawer = unscheduledWorkshops(workshops, columns);
  const dayBreaks = breaks.filter((b) => b.dayIndex === dayIndex);
  const conflictIds = findWorkshopOverlaps(
    blocks.map((b) => ({
      sessionId: b.sessionId,
      columnKey: b.columnKey,
      startSlot: b.startSlot,
      endSlot: b.endSlot,
    })),
  );

  // Grid runs to the window end, floored by the latest session/break.
  const windowSlots = (endHour - startHour) * SLOTS_PER_HOUR;
  let totalSlots = windowSlots;
  for (const w of workshops) {
    const end = w.sessions[0]?.endsAt;
    if (!end) continue;
    const min = minutesIntoDayInZone(end, timezone);
    if (min === null) continue;
    const slot = (min - startHour * 60) / SLOT_MINUTES;
    if (slot > totalSlots) totalSlots = Math.ceil(slot);
  }
  for (const b of dayBreaks) totalSlots = Math.max(totalSlots, hhmmToSlot(b.endTime, startHour));
  const gridHeight = totalSlots * slotHeightPx;

  /** Day-break bars as immovable obstacle intervals (excluding one being edited). */
  function obstaclesExcept(skipId?: string): Interval[] {
    return dayBreaks
      .filter((b) => b.id !== skipId)
      .map((b) => ({
        slot: hhmmToSlot(b.startTime, startHour),
        span: Math.max(1, hhmmToSlot(b.endTime, startHour) - hhmmToSlot(b.startTime, startHour)),
      }));
  }

  const dragSpanRef = useRef<number>(12);
  const [ghost, setGhost] = useState<{ columnKey: string; slot: number; span: number } | null>(
    null,
  );

  // Commit a workshop placement at (startSlot, span) on a column, cascading
  // overlapping siblings past it + the day's breaks.
  function commitWorkshop(
    workshopId: string,
    sessionId: string | null,
    column: AreaColumn,
    startSlot: number,
    span: number,
  ) {
    const occupants = blocks
      .filter((bl) => bl.columnKey === column.key && bl.sessionId !== sessionId)
      .map((bl) => ({ id: bl.sessionId, slot: bl.startSlot, span: bl.span }));
    const result = placeWorkshopBlock({
      occupants,
      obstacles: obstaclesExcept(),
      dropped: { span: Math.max(1, span) },
      dropSlot: startSlot,
      gridEndSlot: totalSlots,
    });
    const toIso = (slot: number, length: number) => ({
      startTime: slotToTime(slot, activeDay, timezone, startHour),
      endTime: slotToTime(slot + length, activeDay, timezone, startHour),
    });
    onPlace(workshopId, sessionId, {
      venueId: column.venueId,
      areaId: column.areaId,
      ...toIso(result.slot, Math.max(1, span)),
    });
    for (const s of result.shifted) {
      const moved = blocks.find((bl) => bl.sessionId === s.id);
      if (!moved) continue;
      onPlace(moved.workshopId, moved.sessionId, {
        venueId: column.venueId,
        areaId: column.areaId,
        ...toIso(s.slot, moved.span),
      });
    }
  }

  function slotFromEvent(rect: DOMRect, clientY: number, span: number): number {
    const raw = snapSlot(Math.max(0, Math.round((clientY - rect.top) / slotHeightPx)));
    return Math.min(raw, Math.max(0, totalSlots - span));
  }

  function handleDragOver(c: AreaColumn, e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const span = dragSpanRef.current;
    setGhost({ columnKey: c.key, slot: slotFromEvent(rect, e.clientY, span), span });
  }

  function handleDrop(column: AreaColumn, e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setGhost(null);
    const workshopId = e.dataTransfer.getData('workshopId');
    if (!workshopId) return;
    const sessionId = e.dataTransfer.getData('sessionId') || null;
    const span = Number(e.dataTransfer.getData('span')) || 12;
    const rect = e.currentTarget.getBoundingClientRect();
    commitWorkshop(workshopId, sessionId, column, slotFromEvent(rect, e.clientY, span), span);
  }

  // ── Workshop resize (top or bottom grip) ──────────────────────────────────────
  const [resizing, setResizing] = useState<{
    workshopId: string;
    sessionId: string;
    column: AreaColumn;
    edge: 'top' | 'bottom';
    baseStart: number;
    baseEnd: number;
    curStart: number;
    curEnd: number;
  } | null>(null);
  const resizingRef = useRef(resizing);
  useEffect(() => {
    resizingRef.current = resizing;
  }, [resizing]);
  useEffect(() => {
    if (!resizing) return;
    const startY = { v: 0, set: false };
    function onMove(ev: PointerEvent) {
      const r = resizingRef.current;
      if (!r) return;
      if (!startY.set) {
        startY.v = ev.clientY;
        startY.set = true;
      }
      const delta = Math.round((ev.clientY - startY.v) / slotHeightPx);
      setResizing((cur) => {
        if (!cur) return cur;
        if (cur.edge === 'bottom') {
          const curEnd = Math.min(
            totalSlots,
            Math.max(cur.baseStart + 1, snapSlot(cur.baseEnd + delta)),
          );
          return { ...cur, curStart: cur.baseStart, curEnd };
        }
        const curStart = resizeStartSlot(cur.baseStart + delta, cur.baseEnd);
        return { ...cur, curStart, curEnd: cur.baseEnd };
      });
    }
    function onUp() {
      const r = resizingRef.current;
      if (r) commitWorkshop(r.workshopId, r.sessionId, r.column, r.curStart, r.curEnd - r.curStart);
      setResizing(null);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizing?.sessionId, resizing?.edge]);

  // ── Break move / resize (pointer) ─────────────────────────────────────────────
  const [breakDrag, setBreakDrag] = useState<{
    id: string;
    mode: 'move' | 'top' | 'bottom';
    baseStart: number;
    baseEnd: number;
    curStart: number;
    curEnd: number;
  } | null>(null);
  const breakDragRef = useRef(breakDrag);
  useEffect(() => {
    breakDragRef.current = breakDrag;
  }, [breakDrag]);
  useEffect(() => {
    if (!breakDrag) return;
    const startY = { v: 0, set: false };
    function onMove(ev: PointerEvent) {
      const d = breakDragRef.current;
      if (!d) return;
      if (!startY.set) {
        startY.v = ev.clientY;
        startY.set = true;
      }
      const delta = Math.round((ev.clientY - startY.v) / slotHeightPx);
      setBreakDrag((cur) => {
        if (!cur) return cur;
        const dur = cur.baseEnd - cur.baseStart;
        if (cur.mode === 'move') {
          const curStart = Math.min(Math.max(0, snapSlot(cur.baseStart + delta)), totalSlots - dur);
          return { ...cur, curStart, curEnd: curStart + dur };
        }
        if (cur.mode === 'bottom') {
          const curEnd = Math.min(
            totalSlots,
            Math.max(cur.baseStart + 1, snapSlot(cur.baseEnd + delta)),
          );
          return { ...cur, curStart: cur.baseStart, curEnd };
        }
        return {
          ...cur,
          curStart: resizeStartSlot(cur.baseStart + delta, cur.baseEnd),
          curEnd: cur.baseEnd,
        };
      });
    }
    function onUp() {
      const d = breakDragRef.current;
      const b = dayBreaks.find((x) => x.id === d?.id);
      if (d && b && onUpdateBreak) {
        onUpdateBreak(b, breakTimesFromSlots(d.curStart, d.curEnd, startHour));
      }
      setBreakDrag(null);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakDrag?.id, breakDrag?.mode]);

  const hourLines: number[] = [];
  for (let s = 0; s <= totalSlots; s += SLOTS_PER_HOUR) hourLines.push(s);
  const nowSlot = nowIso ? nowSlotForDay(nowIso, activeDay, timezone, startHour) : null;

  function exportCsv() {
    const csv = workshopScheduleToCsv(
      workshops.map((w) => ({
        title: w.title,
        category: w.category ?? null,
        level: w.level ?? null,
        capacity: w.capacity ?? null,
        instructorNames: w.instructorNames ?? [],
        sessions: w.sessions,
      })),
      venues,
      timezone,
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'workshops.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function printDay() {
    const colName = (key: string) => {
      const c = columns.find((x) => x.key === key);
      return c ? `${c.venueName}${c.areaName ? ` · ${c.areaName}` : ''}` : '';
    };
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rows = [...blocks]
      .sort((a, b) => a.startSlot - b.startSlot)
      .map(
        (bl) =>
          `<tr><td>${slotToHHMM(bl.startSlot, startHour)}–${slotToHHMM(bl.endSlot, startHour)}</td><td>${esc(
            colName(bl.columnKey),
          )}</td><td>${esc(bl.title)}</td><td>${esc(bl.instructorNames.join(', '))}</td><td>${esc(
            [bl.category, bl.level].filter(Boolean).join(' · '),
          )}</td><td>${bl.confirmedCount}/${bl.capacity ?? '∞'}</td></tr>`,
      )
      .join('');
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(
      `<!doctype html><html><head><title>Workshops — ${esc(formatDayLabel(activeDay))}</title>` +
        `<style>body{font-family:system-ui,sans-serif;padding:24px;color:#111}h1{font-size:18px}` +
        `table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}th{background:#f3f4f6}</style></head>` +
        `<body><h1>Workshops — ${esc(formatDayLabel(activeDay))}</h1><table><thead><tr>` +
        `<th>Time</th><th>Venue</th><th>Workshop</th><th>Instructor</th><th>Category · Level</th><th>Slots</th>` +
        `</tr></thead><tbody>${rows}</tbody></table></body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  }

  const hourOptions = (lo: number, hi: number) => {
    const out: number[] = [];
    for (let h = lo; h <= hi; h++) out.push(h);
    return out;
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Day tabs + toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {days.length > 1 &&
          days.map((d, i) => (
            <button
              key={d}
              type="button"
              onClick={() => setActiveDay(d)}
              className={[
                'rounded-lg px-3 py-1 text-sm font-medium',
                d === activeDay
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-border text-foreground-secondary hover:bg-border',
              ].join(' ')}
            >
              {`Jour ${i + 1} · ${formatDayLabel(d)}`}
            </button>
          ))}
        <div className="ml-auto flex items-center gap-1 text-muted">
          <span className="text-[11px] font-medium">Zoom</span>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => zoom(-4)}
            disabled={slotHeightPx <= SLOT_HEIGHT_MIN}
            className="rounded border border-border px-1.5 leading-none hover:bg-background disabled:opacity-40"
          >
            −
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => zoom(4)}
            disabled={slotHeightPx >= SLOT_HEIGHT_MAX}
            className="rounded border border-border px-1.5 leading-none hover:bg-background disabled:opacity-40"
          >
            +
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="ml-2 rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground-secondary hover:bg-background"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={printDay}
            className="rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground-secondary hover:bg-background"
          >
            Print
          </button>
        </div>
      </div>

      <div className="flex gap-4">
        {/* Unscheduled drawer + add-block + grid window (LEFT) */}
        <aside
          className="w-60 shrink-0"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const sessionId = e.dataTransfer.getData('sessionId');
            if (sessionId && onUnschedule) onUnschedule(sessionId);
            setGhost(null);
          }}
        >
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            Unscheduled
          </h3>
          <div className="flex flex-col gap-2">
            {drawer.length === 0 ? (
              <p className="text-xs text-muted">All workshops are scheduled.</p>
            ) : (
              drawer.map((w) => (
                <div
                  key={w.id}
                  draggable
                  onDragStart={(e) => {
                    const span = w.durationMinutes
                      ? Math.round(w.durationMinutes / SLOT_MINUTES)
                      : 12;
                    dragSpanRef.current = span;
                    e.dataTransfer.setData('workshopId', w.id);
                    e.dataTransfer.setData('sessionId', w.sessions[0]?.id ?? '');
                    e.dataTransfer.setData('span', String(span));
                  }}
                  onDragEnd={() => setGhost(null)}
                  className="cursor-grab rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm hover:border-accent"
                  title={w.title}
                >
                  <span className="block truncate font-medium text-foreground">{w.title}</span>
                  <span className="text-xs text-muted">
                    {[w.category, w.level].filter(Boolean).join(' · ') ||
                      (w.durationMinutes != null ? `${w.durationMinutes} min` : '—')}
                  </span>
                </div>
              ))
            )}
          </div>
          {onAddBreak && (
            <button
              type="button"
              onClick={() => onAddBreak(dayIndex)}
              className="mt-3 w-full rounded-lg border border-dashed border-border px-3 py-2 text-xs font-semibold text-foreground-secondary hover:border-border hover:text-foreground"
            >
              + Add block
            </button>
          )}

          {/* Grid window config */}
          <div className="mt-4 rounded-lg border border-border p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              Grid window
            </p>
            <div className="flex items-center gap-2 text-xs">
              <label className="flex items-center gap-1">
                Start
                <select
                  value={startHour}
                  onChange={(e) => setWindow({ startHour: Number(e.target.value), endHour })}
                  className="rounded border border-border px-1.5 py-1"
                >
                  {hourOptions(0, endHour - 1).map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1">
                End
                <select
                  value={endHour}
                  onChange={(e) => setWindow({ startHour, endHour: Number(e.target.value) })}
                  className="rounded border border-border px-1.5 py-1"
                >
                  {hourOptions(startHour + 1, 24).map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </aside>

        {/* Grid (RIGHT) */}
        <div ref={gridScrollRef} className="flex-1 overflow-x-auto">
          {columns.length === 0 ? (
            <p className="text-sm text-warning">
              No workshop-capable venues for this event yet. Add one from the Venues tab.
            </p>
          ) : (
            <div className="inline-flex flex-col">
              {/* Venue band row */}
              <div className="flex" style={{ marginLeft: GUTTER_PX }}>
                {bands.map((band) => (
                  <div
                    key={band.venueId}
                    className="border-b border-r border-border bg-background px-2 py-2 text-center text-lg font-bold text-foreground truncate"
                    style={{ width: band.span * colWidth }}
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
                    className="border-b border-r border-border px-2 py-1 text-center text-[11px] text-muted truncate"
                    style={{ width: colWidth }}
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
                      className="absolute right-1 -translate-y-1/2 font-mono text-[10px] text-muted"
                      style={{ top: s * slotHeightPx }}
                    >
                      {slotToHHMM(s, startHour)}
                    </div>
                  ))}
                </div>

                {/* Columns + full-width overlays (breaks, now-line) */}
                <div
                  className="relative flex"
                  style={{ width: columns.length * colWidth, height: gridHeight }}
                >
                  {columns.map((c) => (
                    <div
                      key={c.key}
                      onDragOver={(e) => handleDragOver(c, e)}
                      onDrop={(e) => handleDrop(c, e)}
                      className="relative border-r border-border"
                      style={{ width: colWidth, height: gridHeight }}
                    >
                      {hourLines.map((s) => (
                        <div
                          key={s}
                          className="absolute left-0 right-0 border-t border-border"
                          style={{ top: s * slotHeightPx }}
                        />
                      ))}

                      {/* Drop-shadow ghost with live time */}
                      {ghost && ghost.columnKey === c.key && (
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute left-0.5 right-0.5 z-20 flex items-start justify-center rounded-md border-2 border-dashed border-accent bg-accent/20 text-xs font-mono font-semibold text-accent shadow-lg"
                          style={{
                            top: ghost.slot * slotHeightPx,
                            height: ghost.span * slotHeightPx,
                          }}
                        >
                          <span className="mt-0.5">
                            {slotToHHMM(ghost.slot, startHour)}–
                            {slotToHHMM(ghost.slot + ghost.span, startHour)}
                          </span>
                        </div>
                      )}

                      {/* Workshop cards */}
                      {blocks
                        .filter((bl) => bl.columnKey === c.key)
                        .map((bl) => {
                          const r = resizing?.sessionId === bl.sessionId ? resizing : null;
                          const startSlot = r ? r.curStart : bl.startSlot;
                          const endSlot = r ? r.curEnd : bl.endSlot;
                          const span = endSlot - startSlot;
                          const conflict = conflictIds.has(bl.sessionId);
                          const color = bl.color;
                          return (
                            <div
                              key={bl.sessionId}
                              draggable
                              onDragStart={(e) => {
                                dragSpanRef.current = bl.span;
                                e.dataTransfer.setData('workshopId', bl.workshopId);
                                e.dataTransfer.setData('sessionId', bl.sessionId);
                                e.dataTransfer.setData('span', String(bl.span));
                              }}
                              onDragEnd={() => setGhost(null)}
                              role="button"
                              tabIndex={0}
                              onClick={() => onBlockClick?.(bl.workshopId)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  onBlockClick?.(bl.workshopId);
                                }
                              }}
                              title={
                                conflict ? `${bl.title} — overlaps another workshop` : bl.title
                              }
                              className={[
                                'group absolute left-0.5 right-0.5 cursor-grab overflow-hidden rounded-md border px-1.5 py-1 shadow-sm hover:brightness-95',
                                conflict
                                  ? 'border-danger bg-danger/10 text-danger ring-2 ring-danger'
                                  : `${tintBgClassFor(color)} ${tintBorderClassFor(color)} ${tintTextClassFor(color)}`,
                              ].join(' ')}
                              style={{ top: startSlot * slotHeightPx, height: span * slotHeightPx }}
                            >
                              {onUnschedule && (
                                <button
                                  type="button"
                                  aria-label="Unschedule"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onUnschedule(bl.sessionId);
                                  }}
                                  className="absolute right-0.5 top-0.5 z-10 rounded px-1 text-sm leading-none opacity-0 hover:bg-black/10 group-hover:opacity-100"
                                >
                                  ×
                                </button>
                              )}
                              {/* Top resize grip */}
                              <span
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  setResizing({
                                    workshopId: bl.workshopId,
                                    sessionId: bl.sessionId,
                                    column: c,
                                    edge: 'top',
                                    baseStart: bl.startSlot,
                                    baseEnd: bl.endSlot,
                                    curStart: bl.startSlot,
                                    curEnd: bl.endSlot,
                                  });
                                }}
                                className="absolute left-0 right-0 top-0 h-1.5 cursor-ns-resize bg-black/15"
                              />
                              <span className="block truncate pr-3 text-base font-bold">
                                {bl.title}
                              </span>
                              <span className="block font-mono text-sm opacity-80">
                                {slotToHHMM(startSlot, startHour)}–{slotToHHMM(endSlot, startHour)}
                              </span>
                              {bl.instructorNames.length > 0 && (
                                <span className="block truncate text-sm opacity-90">
                                  {bl.instructorNames.join(', ')}
                                </span>
                              )}
                              {(bl.category || bl.level) && (
                                <span className="block truncate text-xs opacity-70">
                                  {[bl.category, bl.level].filter(Boolean).join(' · ')}
                                </span>
                              )}
                              <span className="block text-xs opacity-70">
                                {bl.confirmedCount}/{bl.capacity ?? '∞'}
                              </span>
                              {/* Bottom resize grip */}
                              <span
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  setResizing({
                                    workshopId: bl.workshopId,
                                    sessionId: bl.sessionId,
                                    column: c,
                                    edge: 'bottom',
                                    baseStart: bl.startSlot,
                                    baseEnd: bl.endSlot,
                                    curStart: bl.startSlot,
                                    curEnd: bl.endSlot,
                                  });
                                }}
                                className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize bg-black/15"
                              />
                            </div>
                          );
                        })}
                    </div>
                  ))}

                  {/* Full-width break bars (draggable, resizable, deletable) */}
                  {dayBreaks.map((b) => {
                    const d = breakDrag?.id === b.id ? breakDrag : null;
                    const startSlot = d ? d.curStart : hhmmToSlot(b.startTime, startHour);
                    const endSlot = d ? d.curEnd : hhmmToSlot(b.endTime, startHour);
                    const h = Math.max(slotHeightPx, (endSlot - startSlot) * slotHeightPx);
                    const tint = b.color
                      ? { backgroundColor: `${b.color}33`, borderColor: b.color }
                      : undefined;
                    return (
                      <div
                        key={b.id}
                        onPointerDown={(e) => {
                          setBreakDrag({
                            id: b.id,
                            mode: 'move',
                            baseStart: startSlot,
                            baseEnd: endSlot,
                            curStart: startSlot,
                            curEnd: endSlot,
                          });
                          e.preventDefault();
                        }}
                        className="group absolute left-0 right-0 z-10 cursor-grab select-none overflow-hidden border-y border-border bg-border/70 px-2 py-0.5 text-foreground-secondary"
                        style={{ top: startSlot * slotHeightPx, height: h, ...tint }}
                      >
                        {/* Top resize grip */}
                        <span
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            setBreakDrag({
                              id: b.id,
                              mode: 'top',
                              baseStart: startSlot,
                              baseEnd: endSlot,
                              curStart: startSlot,
                              curEnd: endSlot,
                            });
                          }}
                          className="absolute left-0 right-0 top-0 h-1.5 cursor-ns-resize bg-muted/50"
                        />
                        <span className="text-sm font-semibold">{b.label ?? 'Break'}</span>
                        <span className="ml-2 font-mono text-xs">
                          {slotToHHMM(startSlot, startHour)}–{slotToHHMM(endSlot, startHour)}
                        </span>
                        {onDeleteBreak && (
                          <button
                            type="button"
                            aria-label="Delete block"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteBreak(b.id);
                            }}
                            className="absolute right-1 top-0.5 rounded px-1 text-sm leading-none text-muted opacity-0 hover:bg-border hover:text-foreground group-hover:opacity-100"
                          >
                            ×
                          </button>
                        )}
                        {onEditBreak && (
                          <button
                            type="button"
                            aria-label="Edit block"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditBreak(b);
                            }}
                            className="absolute bottom-0.5 right-1 rounded px-1 text-[11px] leading-none text-muted opacity-0 hover:text-foreground group-hover:opacity-100"
                          >
                            edit
                          </button>
                        )}
                        {/* Bottom resize grip */}
                        <span
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            setBreakDrag({
                              id: b.id,
                              mode: 'bottom',
                              baseStart: startSlot,
                              baseEnd: endSlot,
                              curStart: startSlot,
                              curEnd: endSlot,
                            });
                          }}
                          className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize bg-muted/50"
                        />
                      </div>
                    );
                  })}

                  {/* "Now" line */}
                  {nowSlot !== null && nowSlot <= totalSlots && (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute left-0 right-0 z-30 border-t-2 border-danger"
                      style={{ top: nowSlot * slotHeightPx }}
                    >
                      <span className="absolute -top-2 left-0 rounded bg-danger px-1 text-[9px] font-bold text-danger-foreground">
                        {slotToHHMM(nowSlot, startHour)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
