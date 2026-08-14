'use client';

import { Fragment } from 'react';
import { formatSlotTime } from '@myclash/schedule-core';
import type { Lice } from './schedule-types';

/**
 * The Detailed view's time axis and its drop targets: one label per slot in
 * column 1, then one cell per lice across the row.
 *
 * `data-lice-id` and `data-slot` EXIST FOR tests/drag/schedule-grid.spec.ts and
 * must not be removed. The cells are unlabelled siblings of the match cards,
 * positioned only by inline grid coordinates, so without them a test can only
 * name "the 14:00 cell on piste 2" by reproducing `rowFor` — which is exactly
 * how an earlier version of that spec computed slot 36 from an assumed 09:00
 * origin, dropped on an empty cell, and passed while asserting the opposite of
 * what it claimed.
 *
 * `rowFor` is passed in rather than derived here for the same reason: the spec
 * resolves a card's slot by matching the card's computed `gridRowStart` against
 * these cells'. Two copies of that mapping would not fail an assertion, they
 * would make the lookup find nothing.
 */

interface Props {
  visibleLices: Lice[];
  /** Number of slots on the axis; the axis end is derived per day. */
  gridEndSlot: number;
  gridStartHour: number;
  rowFor: (slot: number) => number;
  dragOverCell: { liceId: string; slot: number } | null;
  onDragOverCell: (cell: { liceId: string; slot: number } | null) => void;
  onDrop: (liceId: string, slot: number) => void;
}

export function DetailedSlotCells({
  visibleLices,
  gridEndSlot,
  gridStartHour,
  rowFor,
  dragOverCell,
  onDragOverCell,
  onDrop,
}: Props) {
  return (
    <>
      {Array.from({ length: gridEndSlot }, (_, slot) => (
        <Fragment key={slot}>
          {/* Time label — sticky left, explicit (col 1, row slot+2) */}
          <div
            className="sticky left-0 z-10 bg-surface text-xs text-muted pr-1 flex items-center justify-end select-none"
            style={{
              gridColumn: 1,
              gridRow: rowFor(slot),
              borderTop: slot % 12 === 0 ? '1px solid #d1d5db' : '1px solid transparent',
            }}
          >
            {slot % 12 === 0 ? formatSlotTime(slot, gridStartHour) : ''}
          </div>

          {visibleLices.map((lice, liceIndex) => {
            const isHover = dragOverCell?.liceId === lice.id && dragOverCell?.slot === slot;
            return (
              <div
                key={lice.id}
                data-lice-id={lice.id}
                data-slot={slot}
                className={[
                  'border-l border-l-border transition-colors relative',
                  isHover ? 'bg-blue-100 ring-2 ring-inset ring-blue-400' : 'bg-background',
                ].join(' ')}
                style={{
                  gridColumn: liceIndex + 2,
                  gridRow: rowFor(slot),
                  borderTop: slot % 12 === 0 ? '1px solid #d1d5db' : '1px solid transparent',
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOverCell?.liceId !== lice.id || dragOverCell?.slot !== slot) {
                    onDragOverCell({ liceId: lice.id, slot });
                  }
                }}
                onDragLeave={() => {
                  if (dragOverCell?.liceId === lice.id && dragOverCell?.slot === slot) {
                    onDragOverCell(null);
                  }
                }}
                onDrop={() => {
                  onDragOverCell(null);
                  onDrop(lice.id, slot);
                }}
              >
                {isHover && (
                  <span className="pointer-events-none absolute left-1 top-1 z-20 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow">
                    {formatSlotTime(slot, gridStartHour)} · {lice.name}
                  </span>
                )}
              </div>
            );
          })}
        </Fragment>
      ))}
    </>
  );
}
