import { SLOT_MINUTES } from '@myclash/schedule-core';
import { respaceMatchesEvenly } from './lice-span';

/**
 * The slot arithmetic behind the programme-block writes.
 *
 * Pure: no React, no fetch, no timezone. Everything here works in slot indices
 * or axis minutes and hands the same back; turning either into an ISO instant
 * needs the event timezone and stays in the hook.
 *
 * This exists because the same three calculations were written out by hand at
 * eleven call sites inside one 3000-line component, where nothing could test
 * them and two copies had already drifted apart.
 */

/** One match's slot assignment. The caller resolves the slot to a time. */
export interface SlotAssignment {
  id: string;
  liceId: string;
  slot: number;
}

/** One match's new start, in exact minutes on the axis — how the board MOVES a
 *  bout. The caller resolves the minutes to a time. */
export interface MinuteAssignment {
  id: string;
  liceId: string;
  atMinutes: number;
}

/** What the block writers need to know about a match already on the board. */
export interface PlacedBlockMatch {
  id: string;
  liceId: string;
  startIso: string;
}

/**
 * How many 5-minute rows a match is DRAWN over on the board.
 *
 * Drawing only: the Detailed cards and the header strips' rows. Floors, so an
 * 8-minute bout draws one row rather than two, and two back-to-back 8-minute
 * bouts never draw on top of each other (a ceiling would). The batch schedule
 * also reads it, to guess where each piste's day ends before it asks the
 * server, which lays the group after whatever is there.
 *
 * Nothing on the board that MOVES a bout reads it. The drop cascade, the group
 * drop and the top-edge move work in exact minutes from each bout's real length:
 * packed in floored rows, an 8-minute bout's neighbour started five minutes
 * after it, and the server refused the batch as overlapping itself.
 *
 * `barWarningSlotSpan` below is the same question asked for a warning, and
 * rounds instead. The two disagree on real lengths; see its note.
 */
export function matchSlotSpan(durationMinutes: number): number {
  return Math.max(1, Math.floor(durationMinutes / SLOT_MINUTES));
}

/**
 * The span the bar-collision detector measures a match by.
 *
 * NOT the same number as `matchSlotSpan`. `/events/:id/schedule` sends each
 * bout's real planned length (the Match's own, else the planner's sheet), and
 * the sheet's defaults are 5, 8 and 10 minutes. An 8-minute elimination is
 * drawn as one row and warned on as two.
 *
 * It rounds, and is named rather than left inline, for two reasons. Rounding
 * warns at least as often as the drawing's floor, and break-bar drops are
 * warn-only by decision, so warning more is the harmless direction. It is not
 * exact: a bout that spills less than half a slot past a boundary (7 minutes
 * from 10:00, a break at 10:05) measures as one slot and does not warn. And an
 * eighth hand-written span expression beside seven calls to one function is
 * exactly the shape this module exists to end.
 *
 * The pin test asserts the direction (`matchSlotSpan <= barWarningSlotSpan`)
 * rather than the values: if that ever inverts, the board would warn LESS than
 * it draws, which is the dangerous way round.
 */
export function barWarningSlotSpan(durationMinutes: number): number {
  return Math.max(1, Math.round(durationMinutes / SLOT_MINUTES));
}

/**
 * Clamp a bottom-edge resize drag to a legal span.
 *
 * A block may never invert or collapse to nothing (minimum one slot) and may
 * never run past the axis. Both bounds were written twice inside the pointer
 * handler — once for the live preview and once again on pointerup — which is
 * exactly the shape that lets a preview and its commit disagree.
 */
export function clampBlockSpan(args: {
  startSpan: number;
  deltaSlots: number;
  startSlot: number;
  gridEndSlot: number;
}): number {
  const { startSpan, deltaSlots, startSlot, gridEndSlot } = args;
  return Math.max(1, Math.min(gridEndSlot - startSlot, startSpan + deltaSlots));
}

/**
 * Spread a block's matches so the block ends at `endSlot`.
 *
 * Each lice is respaced independently and keeps its own running order, because
 * a block spanning several lices is several parallel queues, not one. Order
 * comes from the current start times, so a lice whose matches were hand-placed
 * out of sequence keeps that sequence.
 */
export function respaceBlockSlots(args: {
  matches: readonly PlacedBlockMatch[];
  startSlot: number;
  endSlot: number;
}): SlotAssignment[] {
  const { matches, startSlot, endSlot } = args;
  const byLice = new Map<string, PlacedBlockMatch[]>();
  for (const m of matches) {
    const arr = byLice.get(m.liceId) ?? [];
    arr.push(m);
    byLice.set(m.liceId, arr);
  }
  const assignments: SlotAssignment[] = [];
  for (const [liceId, ms] of byLice) {
    const sorted = [...ms].sort((a, b) => (a.startIso < b.startIso ? -1 : 1));
    const slots = respaceMatchesEvenly({ startSlot, endSlot, count: sorted.length });
    sorted.forEach((m, i) => assignments.push({ id: m.id, liceId, slot: slots[i]! }));
  }
  return assignments;
}

/**
 * Move a whole block by `deltaMinutes`, preserving its internal layout — every
 * match shifts by the same number of minutes from its EXACT start, on its own
 * lice.
 *
 * It shifted floored slots, which snapped every bout to its 5-minute row: a run
 * of 8-minute bouts at 10:43, 10:51, 10:59, moved to the 11:00 line, landed at
 * 11:00, 11:10, 11:15, and the last two overlapped.
 *
 * Returns an empty list when the block does not move, so the caller issues no
 * writes rather than a no-op batch.
 */
export function retimeBlockMinutes(args: {
  matches: readonly PlacedBlockMatch[];
  deltaMinutes: number;
  minuteOf: (iso: string) => number;
}): MinuteAssignment[] {
  const { matches, deltaMinutes, minuteOf } = args;
  if (deltaMinutes === 0) return [];
  return matches.map((m) => ({
    id: m.id,
    liceId: m.liceId,
    atMinutes: minuteOf(m.startIso) + deltaMinutes,
  }));
}
