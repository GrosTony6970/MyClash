/**
 * Pure placement helpers for tick-to-schedule. `chooseAutoPlacement` finds the
 * least-loaded lice and the next free start slot (floored at the day start).
 * `distributeGroups` spreads several groups (pools / rounds) across lices,
 * stacking when lices run out — overlap-free by construction (each group lands
 * after the running per-lice load).
 *
 * Pure: no React, no I/O.
 */

export interface LiceLoad {
  liceId: string;
  /** Slot at which this lice is next free (= day start when empty). */
  lastEndSlot: number;
}

export interface GroupToPlace {
  key: string;
  /** How many slots the group occupies on its lice. */
  spanSlots: number;
}

export function chooseAutoPlacement(
  loads: LiceLoad[],
  dayStartSlot: number,
): { liceId: string; startSlot: number } | null {
  if (loads.length === 0) return null;
  let best = loads[0]!;
  for (const l of loads) if (l.lastEndSlot < best.lastEndSlot) best = l;
  return { liceId: best.liceId, startSlot: Math.max(dayStartSlot, best.lastEndSlot) };
}

export function distributeGroups(input: {
  groups: GroupToPlace[];
  loads: LiceLoad[];
  dayStartSlot: number;
}): Array<{ key: string; liceId: string; startSlot: number }> {
  const work = input.loads.map((l) => ({ ...l }));
  const out: Array<{ key: string; liceId: string; startSlot: number }> = [];
  for (const g of input.groups) {
    const choice = chooseAutoPlacement(work, input.dayStartSlot);
    if (!choice) break;
    out.push({ key: g.key, liceId: choice.liceId, startSlot: choice.startSlot });
    const w = work.find((l) => l.liceId === choice.liceId)!;
    w.lastEndSlot = choice.startSlot + g.spanSlots;
  }
  return out;
}
