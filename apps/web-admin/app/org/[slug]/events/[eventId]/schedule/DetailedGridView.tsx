'use client';

import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { MIN_LICE_COL_PX, SLOT_HEIGHT_PX, TIME_LABEL_COL_PX } from '@myclash/schedule-core';
import { DetailedBlockBars, type DetailedBar } from './DetailedBlockBars';
import { DetailedHeaderBands } from './DetailedHeaderBands';
import { DetailedMatchCards } from './DetailedMatchCards';
import { DetailedRunHeaders } from './DetailedRunHeaders';
import { DetailedSlotCells } from './DetailedSlotCells';
import type { DragPayload } from './drag-payload';
import type { HeaderRunGroup, Lice, ScheduleMatch } from './schedule-types';

/**
 * The Detailed view: one CSS grid, lices as columns and 5-minute slots as rows,
 * with everything placed on explicit coordinates.
 *
 * Explicit placement is not a style choice. The match cards and programme bars
 * are children of the same grid as the drop cells, so with auto-flow a fight
 * dropped at 09:10 on lice 2 used to push the 10:00 time label out of column 1.
 *
 * Every layer is its own component, but they all share one `rowFor`: the slot →
 * grid-row mapping shifts to make room for reserved run-header rows, and a
 * second copy of it would silently misalign a layer rather than fail.
 */

interface Props {
  visibleLices: Lice[];
  /** The hall filter control, shared with the Blocks view so switching views
   *  cannot hide a filter that stays applied. */
  hallFilterControl: ReactNode;
  gridEndSlot: number;
  gridStartHour: number;
  rowFor: (slot: number) => number;
  /** ISO instant → slot on the active day's axis. */
  slotOf: (iso: string) => number;

  matches: ScheduleMatch[];
  conflictMatchIds: Set<string>;
  savingMatchId: string | null;
  slug: string;
  eventId: string;

  runGroups: HeaderRunGroup[];
  onClearRun: (group: HeaderRunGroup) => void;

  bars: DetailedBar[];
  resizingBlock: { id: string; previewSpan: number } | null;
  movingBlockId: string | null;
  deletingBlockId: string | null;
  onDeleteBar: (bar: DetailedBar) => void;
  onBeginBarResize: (ev: ReactPointerEvent<HTMLDivElement>, bar: DetailedBar) => void;

  dragOverCell: { liceId: string; slot: number } | null;
  onDragOverCell: (cell: { liceId: string; slot: number } | null) => void;
  onDropOnCell: (liceId: string, slot: number) => void;
  onDragStart: (payload: DragPayload) => void;
  onDragEnd: () => void;

  onPlaceLice: (lice: Lice) => void;
  /** Slot of "now" on the active day, or null when it is not today or the
   *  current time falls outside the axis. */
  nowSlot: number | null;
}

export function DetailedGridView({
  visibleLices,
  hallFilterControl,
  gridEndSlot,
  gridStartHour,
  rowFor,
  slotOf,
  matches,
  conflictMatchIds,
  savingMatchId,
  slug,
  eventId,
  runGroups,
  onClearRun,
  bars,
  resizingBlock,
  movingBlockId,
  deletingBlockId,
  onDeleteBar,
  onBeginBarResize,
  dragOverCell,
  onDragOverCell,
  onDropOnCell,
  onDragStart,
  onDragEnd,
  onPlaceLice,
  nowSlot,
}: Props) {
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">{hallFilterControl}</div>
      <div
        className="relative grid w-full"
        style={{
          gridTemplateColumns: `${TIME_LABEL_COL_PX}px repeat(${visibleLices.length}, minmax(${MIN_LICE_COL_PX}px, 1fr))`,
          gridAutoRows: `${SLOT_HEIGHT_PX}px`,
        }}
      >
        <DetailedHeaderBands visibleLices={visibleLices} slug={slug} onPlaceLice={onPlaceLice} />
        <DetailedSlotCells
          visibleLices={visibleLices}
          gridEndSlot={gridEndSlot}
          gridStartHour={gridStartHour}
          rowFor={rowFor}
          dragOverCell={dragOverCell}
          onDragOverCell={onDragOverCell}
          onDrop={onDropOnCell}
        />
        <DetailedMatchCards
          matches={matches}
          visibleLices={visibleLices}
          slotOf={slotOf}
          rowFor={rowFor}
          conflictMatchIds={conflictMatchIds}
          savingMatchId={savingMatchId}
          slug={slug}
          eventId={eventId}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
        <DetailedRunHeaders
          groups={runGroups}
          rowFor={rowFor}
          onClearRun={onClearRun}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
        <DetailedBlockBars
          bars={bars}
          rowFor={rowFor}
          resizingBlock={resizingBlock}
          movingBlockId={movingBlockId}
          deletingBlockId={deletingBlockId}
          onDelete={onDeleteBar}
          onBeginResize={onBeginBarResize}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />

        {/* "Now" marker — a red line across every lice column at the current
            slot. Only on today; the grid resolves that and passes null. */}
        {nowSlot !== null && (
          <div
            aria-hidden="true"
            className="pointer-events-none flex items-center"
            style={{ gridColumn: '1 / -1', gridRow: rowFor(nowSlot), zIndex: 15 }}
          >
            <div className="h-[2px] w-full bg-red-600 shadow-[0_0_4px_rgba(220,38,38,0.6)]" />
          </div>
        )}
      </div>
    </>
  );
}
