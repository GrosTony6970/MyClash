/**
 * Block overlap detection for the schedule board: two blocks that share a lice
 * and whose [start, end) time ranges intersect. Touching ranges (one ends as
 * the other begins) do NOT count. Used to warn the operator + tint the
 * offending blocks amber after any assignment.
 *
 * Pure: no React, no I/O.
 */

export interface OverlapInput {
  key: string;
  liceIds: string[];
  startIso: string;
  endIso: string;
}

export interface Overlap {
  liceId: string;
  aKey: string;
  bKey: string;
}

/** A prospective placement in slot units — what a drag would land on. */
export interface SlotPlacement {
  liceIds: string[];
  startSlot: number;
  endSlot: number;
}

/**
 * Would dropping `placement` clash with any `occupants`? True when they share a
 * lice AND their [startSlot, endSlot) ranges intersect (touching = no clash).
 * Drives the live red tint on the drag ghost. The caller excludes the block
 * being moved from `occupants` so a same-spot drop doesn't read as a conflict.
 */
export function wouldOverlap(placement: SlotPlacement, occupants: SlotPlacement[]): boolean {
  const lices = new Set(placement.liceIds);
  return occupants.some(
    (o) =>
      o.liceIds.some((l) => lices.has(l)) &&
      placement.startSlot < o.endSlot &&
      o.startSlot < placement.endSlot,
  );
}

export function detectScheduleOverlaps(blocks: OverlapInput[]): Overlap[] {
  const byLice = new Map<string, Array<{ key: string; start: number; end: number }>>();
  for (const b of blocks) {
    const start = new Date(b.startIso).getTime();
    const end = new Date(b.endIso).getTime();
    for (const liceId of b.liceIds) {
      const arr = byLice.get(liceId) ?? [];
      arr.push({ key: b.key, start, end });
      byLice.set(liceId, arr);
    }
  }

  const out: Overlap[] = [];
  for (const [liceId, items] of byLice) {
    const sorted = [...items].sort((a, b) => a.start - b.start);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        // Sorted by start, so once a later block begins at/after this one ends,
        // nothing further can overlap it.
        if (sorted[j]!.start >= sorted[i]!.end) break;
        out.push({ liceId, aKey: sorted[i]!.key, bKey: sorted[j]!.key });
      }
    }
  }
  return out;
}
