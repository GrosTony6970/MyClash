/**
 * Conflict-aware placement for the workshop schedule board.
 *
 * Pure: no React/DOM. Workshops are placed on a single venue/area column;
 * overlapping workshops cascade DOWN, sliding past other workshops AND the
 * day's break bars (which are immovable obstacles). Co-located with the board
 * so it speaks the grid's 5-min slot vocabulary; lives apart so it's testable.
 */
import { slotToHHMM } from '@myclash/schedule-core';

export interface SlottedItem {
  id: string;
  slot: number;
  span: number;
}

export interface Interval {
  slot: number;
  span: number;
}

export interface PlaceInput {
  /** Other workshop blocks in the target column (movable). */
  occupants: ReadonlyArray<SlottedItem>;
  /** The day's break bars — fixed, never moved. */
  obstacles: ReadonlyArray<Interval>;
  dropped: { span: number };
  dropSlot: number;
  /** Exclusive end-of-grid slot; pushes clamp to here. */
  gridEndSlot: number;
}

export interface PlaceResult {
  /** Where the dropped block lands. */
  slot: number;
  /** Occupants whose slot changed (caller PATCHes these). */
  shifted: Array<{ id: string; slot: number }>;
}

function overlaps(aSlot: number, aSpan: number, bSlot: number, bSpan: number): boolean {
  return aSlot < bSlot + bSpan && bSlot < aSlot + aSpan;
}

/** Lowest slot ≥ `from` where [slot, slot+span) clears every blocker; clamped to the grid end. */
function firstFree(
  from: number,
  span: number,
  blockers: ReadonlyArray<Interval>,
  gridEndSlot: number,
): number {
  let slot = Math.max(0, from);
  for (let guard = 0; guard < 1000; guard++) {
    let pushTo = -1;
    for (const b of blockers) {
      if (overlaps(slot, span, b.slot, b.span)) pushTo = Math.max(pushTo, b.slot + b.span);
    }
    if (pushTo < 0) break; // no overlap
    slot = pushTo;
  }
  if (slot + span > gridEndSlot) slot = Math.max(0, gridEndSlot - span);
  return slot;
}

/**
 * Place `dropped` at `dropSlot` (pushed past any break it lands on), then
 * cascade overlapping occupants downward, each clearing the dropped block,
 * the breaks, and earlier-pushed occupants.
 */
export function placeWorkshopBlock(input: PlaceInput): PlaceResult {
  const { occupants, obstacles, dropped, dropSlot, gridEndSlot } = input;

  const placedSlot = firstFree(dropSlot, dropped.span, obstacles, gridEndSlot);

  const blockers: Interval[] = [...obstacles, { slot: placedSlot, span: dropped.span }];
  const shifted: Array<{ id: string; slot: number }> = [];

  for (const occ of [...occupants].sort((a, b) => a.slot - b.slot)) {
    let slot = occ.slot;
    const collides = blockers.some((b) => overlaps(slot, occ.span, b.slot, b.span));
    if (collides) slot = firstFree(occ.slot, occ.span, blockers, gridEndSlot);
    if (slot !== occ.slot) shifted.push({ id: occ.id, slot });
    blockers.push({ slot, span: occ.span });
  }

  return { slot: placedSlot, shifted };
}

export interface OverlapBlock {
  sessionId: string;
  columnKey: string;
  startSlot: number;
  endSlot: number;
}

/** Session ids that overlap another block in the SAME column (drives the red highlight). */
export function findWorkshopOverlaps(blocks: ReadonlyArray<OverlapBlock>): Set<string> {
  const conflicting = new Set<string>();
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i]!;
      const b = blocks[j]!;
      if (a.columnKey !== b.columnKey) continue;
      if (a.startSlot < b.endSlot && b.startSlot < a.endSlot) {
        conflicting.add(a.sessionId);
        conflicting.add(b.sessionId);
      }
    }
  }
  return conflicting;
}

/** Slot range → HH:MM start/end on the axis (for committing a break move/resize). */
export function breakTimesFromSlots(
  startSlot: number,
  endSlot: number,
  startHour: number,
): { startTime: string; endTime: string } {
  return { startTime: slotToHHMM(startSlot, startHour), endTime: slotToHHMM(endSlot, startHour) };
}
