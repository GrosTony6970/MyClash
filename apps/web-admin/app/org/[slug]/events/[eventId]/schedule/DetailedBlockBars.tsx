'use client';

import type { PointerEvent as ReactPointerEvent } from 'react';
import { useI18n } from '@myclash/next-i18n/client';
import { blockTint, resolveBlockAccent } from '@myclash/types';
import type { BlockSlots } from './programme-block-slots';
import type { DragPayload } from './drag-payload';
import type { ProgrammeBlockRow } from './schedule-types';

/**
 * Non-fight programme blocks — registration, gear check, referee meeting,
 * breaks — drawn as full-width bars across every lice column.
 *
 * Dragging one drops it on any cell in the target row and the backend
 * cascade-shifts every later match on the day by the same delta; the bar spans
 * all columns, so which lice the drop landed on is irrelevant.
 *
 * The colour comes from `resolveBlockAccent`, the same resolver the Blocks view
 * and the edit popover use. This used to hardcode slate/purple by kind, so a
 * colour the operator picked in the popover rendered on one view and vanished
 * on the other.
 */

export type DetailedBar = ProgrammeBlockRow & BlockSlots;

interface Props {
  bars: DetailedBar[];
  rowFor: (slot: number) => number;
  /** Live span while the operator drags the bottom edge, before the PATCH. */
  resizingBlock: { id: string; previewSpan: number } | null;
  movingBlockId: string | null;
  deletingBlockId: string | null;
  onDelete: (bar: DetailedBar) => void;
  onBeginResize: (ev: ReactPointerEvent<HTMLDivElement>, bar: DetailedBar) => void;
  onDragStart: (payload: DragPayload) => void;
  onDragEnd: () => void;
}

export function DetailedBlockBars({
  bars,
  rowFor,
  resizingBlock,
  movingBlockId,
  deletingBlockId,
  onDelete,
  onBeginResize,
  onDragStart,
  onDragEnd,
}: Props) {
  const { t } = useI18n();
  return (
    <>
      {bars.map((b) => {
        const optimisticSpan = resizingBlock?.id === b.id ? resizingBlock.previewSpan : b.span;
        return (
          <div
            key={b.id}
            draggable
            onDragStart={() => onDragStart({ kind: 'block', id: b.id, startTime: b.startTime })}
            onDragEnd={onDragEnd}
            aria-label={b.label}
            title={t('organizer.schedulePage.grid.blockBarTitle', {
              start: b.startTime,
              end: b.endTime,
              label: b.label,
            })}
            className={[
              'relative pointer-events-auto flex items-center justify-center overflow-hidden border-y text-[11px] font-semibold uppercase tracking-wide text-foreground-secondary cursor-grab active:cursor-grabbing',
              movingBlockId === b.id || deletingBlockId === b.id ? 'opacity-50' : '',
            ].join(' ')}
            style={{
              gridColumn: '2 / -1',
              // Explicit end row, not a span: any reserved pool-header rows
              // inside the block's range have to be accounted for.
              gridRow: `${rowFor(b.startSlot)} / ${rowFor(b.startSlot + optimisticSpan)}`,
              zIndex: 8,
              ...blockTint(resolveBlockAccent(b.blockType, b.colorHex ?? null)),
            }}
          >
            <span className="truncate px-2">
              {b.label} ({b.startTime} – {b.endTime})
            </span>
            <button
              type="button"
              draggable={false}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(b);
              }}
              aria-label={t('organizer.schedulePage.blockGrid.deleteAria', { label: b.label })}
              title={t('organizer.schedulePage.blockGrid.deleteAria', { label: b.label })}
              className="absolute right-1 top-1/2 -translate-y-1/2 z-30 rounded p-0.5 text-muted hover:bg-surface hover:text-foreground transition-colors"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
            {/* Bottom-edge resize handle. pointerdown captures the pointer,
                pointermove updates the preview span in 5-min increments,
                pointerup commits via PATCH. `draggable={false}` plus the
                stopPropagation above keep the parent's HTML5 drag dormant while
                the operator is resizing. */}
            <div
              role="separator"
              aria-label={t('organizer.schedulePage.blockGrid.resizeAria', { label: b.label })}
              draggable={false}
              onPointerDown={(ev) => onBeginResize(ev, b)}
              className="absolute inset-x-0 bottom-0 z-30 h-1 cursor-row-resize bg-transparent hover:bg-muted/40"
            />
          </div>
        );
      })}
    </>
  );
}
