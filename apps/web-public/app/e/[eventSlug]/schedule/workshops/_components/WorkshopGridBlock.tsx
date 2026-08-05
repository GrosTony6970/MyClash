'use client';

/**
 * One workshop card on the public schedule grid.
 *
 * The grid is fixed at the minimum row height so a whole day fits on a screen,
 * which makes a 30-minute workshop only 48px tall — far tighter than the
 * organizer board at its default zoom. So the card reveals its lines
 * progressively by available height, exactly as the public tournament grid does
 * with its own blocks. The `title` attribute always carries the whole thing, so
 * nothing is actually lost at the small sizes.
 */

import Link from 'next/link';
import { SLOT_HEIGHT_MIN, slotToHHMM } from '@myclash/schedule-core';
import { tintBgClassFor, tintBorderClassFor, tintTextClassFor } from '@myclash/ui';
import type { WorkshopGridBlock as BlockModel } from '../_lib/workshop-grid-data';

// Height (px) at which each successive line becomes readable rather than noise.
const SHOW_TIME_PX = 32;
const SHOW_INSTRUCTORS_PX = 48;
const SHOW_TAXONOMY_PX = 64;
const SHOW_SEATS_PX = 80;

interface Props {
  block: BlockModel;
  startHour: number;
  /** Body row for a slot — row 1 is the venue band, row 2 the area header. */
  rowFor: (slot: number) => number;
  gridColumn: number;
}

export function WorkshopGridBlock({ block, startHour, rowFor, gridColumn }: Props) {
  const heightPx = block.span * SLOT_HEIGHT_MIN;
  const timeRange = `${slotToHHMM(block.startSlot, startHour)}–${slotToHHMM(block.endSlot, startHour)}`;
  const taxonomy = [block.category, block.level].filter(Boolean).join(' · ');
  const instructors = block.instructorNames.join(', ');

  return (
    <Link
      href={block.href}
      title={[block.title, timeRange, instructors, taxonomy].filter(Boolean).join(' · ')}
      className={[
        'm-px flex flex-col overflow-hidden rounded-md border px-1.5 py-1 transition-opacity',
        'hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-accent/40',
        tintBgClassFor(block.color),
        tintBorderClassFor(block.color),
        tintTextClassFor(block.color),
      ].join(' ')}
      style={{
        gridColumn,
        gridRow: `${rowFor(block.startSlot)} / ${rowFor(Math.max(block.startSlot + 1, block.endSlot))}`,
        zIndex: 10,
      }}
    >
      <span className="truncate text-sm font-bold leading-tight">{block.title}</span>
      {heightPx >= SHOW_TIME_PX ? (
        <span className="truncate font-mono text-xs opacity-80">{timeRange}</span>
      ) : null}
      {instructors && heightPx >= SHOW_INSTRUCTORS_PX ? (
        <span className="truncate text-xs opacity-90">{instructors}</span>
      ) : null}
      {taxonomy && heightPx >= SHOW_TAXONOMY_PX ? (
        <span className="truncate text-[11px] opacity-70">{taxonomy}</span>
      ) : null}
      {heightPx >= SHOW_SEATS_PX ? (
        <span className="truncate text-[11px] opacity-70">
          {block.confirmedCount}/{block.capacity ?? '∞'}
        </span>
      ) : null}
    </Link>
  );
}
