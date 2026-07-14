/**
 * Block overlap detection for the schedule board: two blocks that genuinely
 * collide on a lice — i.e. their matches ON THAT LICE intersect in time.
 * Touching ranges (one ends as the other begins) do NOT count.
 *
 * We work from each block's PER-LICE match intervals, not one global
 * [start, end] applied to every lice it spans. A wide run that pipelines into
 * the next (R16 then QF, each sequential on a shared lice) therefore reads as
 * touching, not overlapping — no false warning. Used to warn the operator +
 * tint the offending blocks amber after any assignment.
 *
 * Pure: no React, no I/O.
 */
import { SLOT_MINUTES } from '@myclash/schedule-core';

export interface OverlapMatch {
  liceId: string;
  startIso: string;
  /** Match length in minutes; falls back to one slot when absent. */
  durationMinutes?: number;
}

export interface OverlapInput {
  key: string;
  matches: OverlapMatch[];
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
  // Per lice → per block → its local [start, end) folded from that lice's matches.
  const byLice = new Map<string, Map<string, { start: number; end: number }>>();
  for (const b of blocks) {
    for (const m of b.matches) {
      const start = new Date(m.startIso).getTime();
      const end = start + (m.durationMinutes ?? SLOT_MINUTES) * 60_000;
      const blockMap = byLice.get(m.liceId) ?? new Map<string, { start: number; end: number }>();
      const cur = blockMap.get(b.key);
      blockMap.set(
        b.key,
        cur ? { start: Math.min(cur.start, start), end: Math.max(cur.end, end) } : { start, end },
      );
      byLice.set(m.liceId, blockMap);
    }
  }

  const out: Overlap[] = [];
  for (const [liceId, blockMap] of byLice) {
    const sorted = [...blockMap.entries()]
      .map(([key, iv]) => ({ key, ...iv }))
      .sort((a, b) => a.start - b.start);
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
