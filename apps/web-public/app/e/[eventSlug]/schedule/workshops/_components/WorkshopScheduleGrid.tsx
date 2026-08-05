'use client';

/**
 * Read-only public timeline for an event's workshop schedule — the spectator
 * view of the organizer's workshop board. Venue areas are columns, 5-min slots
 * are rows, workshops are positioned blocks and breaks are full-width bars.
 *
 * The placement maths is the SAME @myclash/schedule-core module the admin board
 * uses, so the two can't drift on where a workshop lands. Stripped of every
 * admin affordance (no drag/resize/edit/unschedule/zoom/CSV/print) and of the
 * conflict ring — a spectator can't act on an overlap, and a red-outlined card
 * reads as "this event is broken" rather than "the organizer has a to-do".
 *
 * Laid out with CSS Grid rather than the board's measured absolute positioning:
 * that measurement exists only to serve zoom and drag, and `minmax()` is the
 * thing it was emulating. "Now" comes from the shared `useClientClock`, so a
 * super-admin time simulation moves both the line and the day tab it opens on.
 */

import { useState } from 'react';
import { zonedDay } from '@myclash/time';
import { useClientClock } from '@myclash/ui';
import {
  LICE_HEADER_HEIGHT_PX,
  SLOT_HEIGHT_MIN,
  SNAP_SLOTS,
  TIME_LABEL_COL_PX,
  VENUE_HEADER_HEIGHT_PX,
  hhmmToSlot,
  nowSlotForDay,
  slotToHHMM,
} from '@myclash/schedule-core';
import { useI18n } from '@/i18n/I18nProvider';
import { getPublicApiUrl } from '@/lib/api-url';
import type { WorkshopScheduleData } from '../_lib/workshop-grid-data';
import { WorkshopGridBlock } from './WorkshopGridBlock';

// Narrower than the board's 240px: three columns at 240 plus the ruler overflow
// 768px, i.e. the very breakpoint at which this grid first appears. The wrapper
// scrolls horizontally, so wider events still work.
const MIN_AREA_COL_PX = 200;
const SLOTS_PER_HOUR = 12;

interface Props {
  data: WorkshopScheduleData;
  emptyLabel: string;
}

export function WorkshopScheduleGrid({ data, emptyLabel }: Props) {
  const { t, locale } = useI18n();
  const { tz, startHour, days, columns, bands, blocks, breaks, initialDayIndex } = data;
  // null until the viewer picks a tab themselves — their choice then wins.
  const [pickedDayIndex, setPickedDayIndex] = useState<number | null>(null);
  const { nowMs: clock, simulated } = useClientClock(getPublicApiUrl());

  if (columns.length === 0 || (blocks.length === 0 && breaks.length === 0)) {
    return <p className="text-sm text-muted">{emptyLabel}</p>;
  }

  const nowIso = clock > 0 ? new Date(clock).toISOString() : null;

  // `initialDayIndex` is computed server-side off the real clock, so under a
  // time simulation it opens the wrong tab. Derive the simulated day in render
  // (no effect, so no setState-in-effect) and let it win until the viewer picks.
  const simulatedDay =
    simulated && nowIso ? days.find((d) => d.dayKey === zonedDay(nowIso, tz)) : undefined;
  const activeIndex = pickedDayIndex ?? simulatedDay?.index ?? initialDayIndex;
  const activeDay = days[activeIndex] ?? days[0]!;
  const dayKey = activeDay.dayKey;
  const endSlot = activeDay.endSlot;

  const dayBlocks = blocks.filter((b) => b.dayIndex === activeDay.index);
  const dayBreaks = breaks.filter((b) => b.dayIndex === activeDay.index);
  const columnIndexByKey = new Map(columns.map((c, i) => [c.key, i]));

  // Body row for a slot: row 1 = venue band, row 2 = area header, slot 0 → row 3.
  const rowFor = (slot: number): number => slot + 3;
  const lastRow = rowFor(endSlot);

  const nowSlot =
    nowIso && zonedDay(nowIso, tz) === dayKey ? nowSlotForDay(nowIso, dayKey, tz, startHour) : null;

  return (
    <div className="flex flex-col gap-4">
      {days.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {days.map((day) => {
            const active = day.index === activeDay.index;
            return (
              <button
                key={day.dayKey}
                type="button"
                onClick={() => setPickedDayIndex(day.index)}
                aria-pressed={active}
                className={[
                  'rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors',
                  active
                    ? 'border-accent bg-accent text-accent-foreground'
                    : 'border-border bg-surface text-muted hover:text-foreground',
                ].join(' ')}
              >
                {new Date(`${day.dayKey}T00:00:00Z`).toLocaleDateString(locale, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  timeZone: 'UTC',
                })}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border bg-surface pb-2">
        <div
          className="relative grid w-full"
          style={{
            gridTemplateColumns: `${TIME_LABEL_COL_PX}px repeat(${columns.length}, minmax(${MIN_AREA_COL_PX}px, 1fr))`,
            gridTemplateRows: `${VENUE_HEADER_HEIGHT_PX}px ${LICE_HEADER_HEIGHT_PX}px`,
            gridAutoRows: `${SLOT_HEIGHT_MIN}px`,
          }}
        >
          {/* Row 1: corner + venue bands */}
          <div
            className="sticky left-0 z-30 bg-surface"
            style={{ gridColumn: 1, gridRow: 1, height: VENUE_HEADER_HEIGHT_PX }}
          />
          {bands.map((band) => (
            <div
              key={band.venueId}
              className="flex items-center justify-center truncate border-b border-r border-border px-2 text-lg font-bold text-foreground"
              style={{
                gridColumn: `${band.startIndex + 2} / span ${band.span}`,
                gridRow: 1,
                height: VENUE_HEADER_HEIGHT_PX,
              }}
            >
              {band.venueName}
            </div>
          ))}

          {/* Row 2: ruler corner + area headers */}
          <div
            className="sticky left-0 z-30 bg-surface"
            style={{
              gridColumn: 1,
              gridRow: 2,
              top: VENUE_HEADER_HEIGHT_PX,
              height: LICE_HEADER_HEIGHT_PX,
            }}
          />
          {columns.map((col, idx) => (
            <div
              key={col.key}
              className="flex items-center justify-center truncate border-b border-r border-border px-2 text-[11px] text-muted"
              style={{ gridColumn: idx + 2, gridRow: 2, height: LICE_HEADER_HEIGHT_PX }}
            >
              {col.areaName ?? '—'}
            </div>
          ))}

          {/* Faint 15-min gridlines (skip the hour rows, they get their own) */}
          {Array.from({ length: endSlot }, (_, slot) =>
            slot % SNAP_SLOTS === 0 && slot % SLOTS_PER_HOUR !== 0 ? (
              <div
                key={`q-${slot}`}
                aria-hidden="true"
                className="pointer-events-none border-t border-border/20"
                style={{ gridColumn: '2 / -1', gridRow: rowFor(slot) }}
              />
            ) : null,
          )}

          {/* Left ruler: hour labels + full-width hour lines */}
          {Array.from({ length: endSlot }, (_, slot) =>
            slot % SLOTS_PER_HOUR === 0 ? (
              <div key={`ruler-${slot}`} className="contents">
                <div
                  className="sticky left-0 z-10 flex select-none items-start justify-end border-t border-border/60 bg-surface pr-1 font-mono text-[10px] text-muted"
                  style={{ gridColumn: 1, gridRow: rowFor(slot) }}
                >
                  {slotToHHMM(slot, startHour)}
                </div>
                <div
                  aria-hidden="true"
                  className="pointer-events-none border-t border-border/40"
                  style={{ gridColumn: '2 / -1', gridRow: rowFor(slot) }}
                />
              </div>
            ) : null,
          )}

          {/* Column separators (behind the blocks) */}
          {columns.map((col, idx) => (
            <div
              key={`col-${col.key}`}
              aria-hidden="true"
              className={
                idx % 2 === 1
                  ? 'border-l border-border bg-foreground/[0.015]'
                  : 'border-l border-border'
              }
              style={{ gridColumn: idx + 2, gridRow: `3 / ${lastRow}`, zIndex: 0 }}
            />
          ))}

          {/* Break bars — full width across every column */}
          {dayBreaks.map((brk) => {
            const start = hhmmToSlot(brk.startTime, startHour);
            const end = hhmmToSlot(brk.endTime, startHour);
            // Organizer-picked raw hex from a swatch (not a ColorToken), so it
            // is applied inline — same as the public tournament grid's bars.
            const tint = brk.color
              ? { backgroundColor: `${brk.color}33`, borderColor: brk.color }
              : undefined;
            return (
              <div
                key={`brk-${brk.id}`}
                className="flex items-center gap-2 overflow-hidden border-y border-border bg-border/70 px-2 text-foreground-secondary"
                style={{
                  gridColumn: '2 / -1',
                  gridRow: `${rowFor(start)} / ${rowFor(Math.max(start + 1, end))}`,
                  zIndex: 6,
                  ...(tint ?? {}),
                }}
              >
                <span className="truncate text-sm font-semibold">
                  {brk.label ?? t('publicApp.eventHome.schedule.breakDefaultLabel')}
                </span>
                <span className="shrink-0 font-mono text-xs">
                  {slotToHHMM(start, startHour)}–{slotToHHMM(end, startHour)}
                </span>
              </div>
            );
          })}

          {/* Workshop cards */}
          {dayBlocks.map((block) => {
            const idx = columnIndexByKey.get(block.columnKey);
            if (idx == null) return null;
            return (
              <WorkshopGridBlock
                key={block.sessionId}
                block={block}
                startHour={startHour}
                rowFor={rowFor}
                gridColumn={idx + 2}
              />
            );
          })}

          {/* "Now" marker — only on the day the clock is actually on */}
          {nowSlot !== null && nowSlot < endSlot ? (
            <div
              className="pointer-events-none relative"
              style={{ gridColumn: '2 / -1', gridRow: rowFor(nowSlot), zIndex: 15 }}
            >
              <span className="absolute inset-x-0 top-0 border-t-2 border-accent" />
              <span className="absolute left-1 top-0 -translate-y-1/2 rounded bg-accent px-1 py-0.5 text-[9px] font-bold uppercase leading-none text-accent-foreground">
                {t('publicApp.eventHome.schedule.now')}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
