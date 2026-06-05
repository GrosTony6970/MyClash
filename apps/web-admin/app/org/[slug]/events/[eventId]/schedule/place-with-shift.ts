/**
 * Drop-with-auto-shift placement helper.
 *
 * Pure: takes the current set of items occupying one lice column +
 * the dropped item + the slot the operator released at, returns the
 * updated set with the dropped item placed at `dropSlot` and any
 * downstream items pushed past the collision boundary. Falls back to
 * an upward push when the downward shift would run past
 * `gridEndSlot`.
 *
 * Touching-but-not-overlapping items aren't moved (a match ending
 * at slot 24 and another starting at slot 24 are fine).
 *
 * Co-located with grid.tsx because it operates on the grid's slot
 * vocabulary. Lives in its own file so it can be unit-tested without
 * the React tree.
 */

export interface PlaceableItem {
  id: string;
  /** First slot the item occupies (inclusive). */
  slot: number;
  /** Number of slots the item spans (≥ 1). */
  span: number;
}

export interface PlaceWithShiftInput {
  /** All items currently on the target lice (excluding the dropped
   *  one if it was already there — caller filters its prior position). */
  items: readonly PlaceableItem[];
  /** The dropped item and the slot the operator released at. */
  dropped: PlaceableItem;
  dropSlot: number;
  /** Exclusive end-of-grid slot (e.g. 20:00 = slot 144 if start=08:00
   *  and slot=5 min). Pushes that would land past this trigger the
   *  upward-shift fallback. */
  gridEndSlot: number;
}

export interface PlaceWithShiftOutput {
  /** New items array. `dropped` is somewhere in it; other items may
   *  have moved. */
  items: PlaceableItem[];
  /** Items whose slot changed (excluding the dropped one). Caller
   *  uses this to fire PATCH requests for the moved rows only. */
  shifted: PlaceableItem[];
  /** True when downward shift overflowed and we fell back to
   *  upward shift. Indicates that items above the drop point moved. */
  upwardFallback: boolean;
}

export function placeWithShift(input: PlaceWithShiftInput): PlaceWithShiftOutput {
  const { items, dropped, dropSlot, gridEndSlot } = input;

  // Drop slot is free? Just place and return.
  const dropEnd = dropSlot + dropped.span;
  const collides = items.some((it) => slotsOverlap(it.slot, it.span, dropSlot, dropped.span));
  if (!collides) {
    return {
      items: [...items, { ...dropped, slot: dropSlot }].sort((a, b) => a.slot - b.slot),
      shifted: [],
      upwardFallback: false,
    };
  }

  // Try downward shift first.
  const downward = applyDownwardShift(items, dropped, dropSlot, gridEndSlot);
  if (downward) return downward;

  // Downward overflowed — apply upward shift instead.
  return applyUpwardShift(items, dropped, dropSlot);
}

function slotsOverlap(aSlot: number, aSpan: number, bSlot: number, bSpan: number): boolean {
  return aSlot < bSlot + bSpan && bSlot < aSlot + aSpan;
}

/** Place `dropped` at `dropSlot` and push every item starting after
 *  `dropSlot` down past the dropped item's tail. Cascading: if
 *  pushing item A makes it overlap item B, B also gets pushed. Returns
 *  null when any push would run past `gridEndSlot`. */
function applyDownwardShift(
  items: readonly PlaceableItem[],
  dropped: PlaceableItem,
  dropSlot: number,
  gridEndSlot: number,
): PlaceWithShiftOutput | null {
  const sorted = [...items].sort((a, b) => a.slot - b.slot);
  const placed: PlaceableItem[] = [{ ...dropped, slot: dropSlot }];
  const shifted: PlaceableItem[] = [];

  for (const item of sorted) {
    // Items entirely above the drop point (end at-or-before dropSlot)
    // are untouched.
    if (item.slot + item.span <= dropSlot) {
      placed.push(item);
      continue;
    }
    // Items that start at-or-after dropSlot — push past the dropped
    // item's tail (plus any earlier cascading pushes).
    const lastEnd = lastTailAtOrBefore(placed, item.slot);
    if (item.slot >= lastEnd) {
      placed.push(item);
      continue;
    }
    const newSlot = lastEnd;
    if (newSlot + item.span > gridEndSlot) return null;
    const moved = { ...item, slot: newSlot };
    placed.push(moved);
    shifted.push(moved);
  }

  return {
    items: placed.sort((a, b) => a.slot - b.slot),
    shifted,
    upwardFallback: false,
  };
}

/** Largest tail position (slot+span) among items already placed that
 *  end at-or-before `slot`. Used to find where the next item must
 *  start during cascade. Defaults to 0. */
function lastTailAtOrBefore(placed: PlaceableItem[], slot: number): number {
  let best = 0;
  for (const it of placed) {
    const end = it.slot + it.span;
    if (end > best && it.slot <= slot + 1e9) best = end;
  }
  return best;
}

/** Walk the items above the drop point in reverse, pushing them
 *  upward by the overlap amount so the dropped item fits. Cascades
 *  upward if a push makes an earlier item overlap. Items that would
 *  go past slot 0 stop at 0 (rarely; the operator would notice and
 *  pick a different drop point). */
function applyUpwardShift(
  items: readonly PlaceableItem[],
  dropped: PlaceableItem,
  dropSlot: number,
): PlaceWithShiftOutput {
  const sorted = [...items].sort((a, b) => a.slot - b.slot);
  const placed: PlaceableItem[] = [{ ...dropped, slot: dropSlot }];
  const shifted: PlaceableItem[] = [];

  // Walk from bottom to top so the cascading push targets stay
  // monotonically decreasing.
  for (let i = sorted.length - 1; i >= 0; i--) {
    const item = sorted[i]!;
    // Items entirely below the drop point are untouched.
    if (item.slot >= dropSlot + dropped.span) {
      placed.push(item);
      continue;
    }
    // Items entirely above the drop point may still need to move up
    // if a previous upward push made them collide.
    const minTopAbove = nextOccupiedTop(placed, item.slot);
    let newSlot = item.slot;
    // If item collides with the drop window, push it up so its tail
    // sits at the drop's start.
    if (item.slot + item.span > dropSlot) {
      newSlot = Math.max(0, dropSlot - item.span);
    }
    // If our chosen top still collides with something above, push
    // further up.
    if (newSlot + item.span > minTopAbove) {
      newSlot = Math.max(0, minTopAbove - item.span);
    }
    if (newSlot !== item.slot) {
      const moved = { ...item, slot: newSlot };
      placed.push(moved);
      shifted.push(moved);
    } else {
      placed.push(item);
    }
  }

  return {
    items: placed.sort((a, b) => a.slot - b.slot),
    shifted,
    upwardFallback: true,
  };
}

/** Bottom edge of the item that's immediately above the given slot,
 *  among the items already placed. Defaults to Infinity (no item
 *  above). */
function nextOccupiedTop(placed: PlaceableItem[], slot: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const it of placed) {
    if (it.slot + it.span <= slot) continue;
    if (it.slot < slot && it.slot < best) best = it.slot;
  }
  return best;
}
