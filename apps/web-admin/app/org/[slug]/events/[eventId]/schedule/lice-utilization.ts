/**
 * Rough per-lice load for the column headers: the share of the grid's vertical
 * span a lice's blocks occupy, as a clamped 0–100 percent. Overlaps are
 * double-counted (then clamped) — it's a load-balancing hint, not an exact
 * busy-time. Pure: no React, no I/O.
 */

export interface LiceOccupancy {
  liceIds: string[];
  startSlot: number;
  endSlot: number;
}

export function liceUtilizationPct(
  items: LiceOccupancy[],
  liceId: string,
  gridSlots: number,
): number {
  if (gridSlots <= 0) return 0;
  let used = 0;
  for (const it of items) {
    if (it.liceIds.includes(liceId)) used += Math.max(0, it.endSlot - it.startSlot);
  }
  return Math.min(100, Math.round((used / gridSlots) * 100));
}
