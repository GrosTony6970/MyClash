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

// ── Multi-item (pool) drop ────────────────────────────────────────

export interface PlaceMultiWithShiftInput {
  /** Current items on the target lice, EXCLUDING any of the
   *  dropped items if they were previously on this same lice. */
  items: readonly PlaceableItem[];
  /** Pool matches in render order. Placed sequentially starting
   *  at dropSlot with no gap between them. */
  dropped: readonly PlaceableItem[];
  /** First slot the pool's first match takes. */
  dropSlot: number;
  /** Exclusive end-of-grid slot — same semantics as
   *  PlaceWithShiftInput. */
  gridEndSlot: number;
}

export interface PlaceMultiWithShiftOutput {
  /** New items array, sorted by slot. Both pool matches and
   *  existing occupants are in here. */
  items: PlaceableItem[];
  /** Items whose slot ended up different from the input (existing
   *  occupants OR pool matches that didn't already sit at their
   *  computed position). Caller fires PATCH per row. */
  shifted: PlaceableItem[];
  /** True when downward shift overflowed the grid end and we fell
   *  back to upward shift. */
  upwardFallback: boolean;
}

/**
 * Drop a contiguous run of items (a pool's matches) at `dropSlot`
 * on a single lice, pushing any existing occupants that overlap
 * the run past its tail.
 *
 * Same downward-then-upward fallback as `placeWithShift`. The
 * pool always lands at its requested start slot — what moves is
 * everything else.
 */
export function placeMultiWithShift(input: PlaceMultiWithShiftInput): PlaceMultiWithShiftOutput {
  const { items, dropped, dropSlot, gridEndSlot } = input;

  if (dropped.length === 0) {
    return {
      items: [...items].sort((a, b) => a.slot - b.slot),
      shifted: [],
      upwardFallback: false,
    };
  }

  // 1. Place every pool match sequentially starting at dropSlot.
  //    The dropped array's order IS the pool's render order; we
  //    just lay them out contiguously.
  const poolPlaced: PlaceableItem[] = [];
  let cursor = dropSlot;
  for (const m of dropped) {
    poolPlaced.push({ ...m, slot: cursor });
    cursor += m.span;
  }
  const poolStart = dropSlot;
  const poolEnd = cursor; // exclusive

  // 2. Walk existing occupants by slot ascending. Anything ending
  //    at-or-before poolStart is fine; anything that overlaps the
  //    pool's range gets pushed past poolEnd, with cascading.
  const sorted = [...items].sort((a, b) => a.slot - b.slot);
  const downward = applyDownwardShiftMulti(sorted, poolStart, poolEnd, gridEndSlot);

  if (downward) {
    const final = [...poolPlaced, ...downward.placed].sort((a, b) => a.slot - b.slot);
    return {
      items: final,
      shifted: collectShifted(items, poolPlaced, downward.placed),
      upwardFallback: false,
    };
  }

  // 3. Downward overflowed — try upward instead. Items above the
  //    pool's start that would collide get pushed up.
  const upward = applyUpwardShiftMulti(sorted, poolStart, poolEnd);
  const final = [...poolPlaced, ...upward.placed].sort((a, b) => a.slot - b.slot);
  return {
    items: final,
    shifted: collectShifted(items, poolPlaced, upward.placed),
    upwardFallback: true,
  };
}

function applyDownwardShiftMulti(
  sorted: PlaceableItem[],
  poolStart: number,
  poolEnd: number,
  gridEndSlot: number,
): { placed: PlaceableItem[] } | null {
  const placed: PlaceableItem[] = [];
  let tail = poolEnd; // running floor for the next pushed item

  for (const item of sorted) {
    // Entirely above the pool — untouched.
    if (item.slot + item.span <= poolStart) {
      placed.push(item);
      continue;
    }
    // Already past the pool's tail and past any earlier push? Keep.
    if (item.slot >= tail) {
      placed.push(item);
      // Earlier pushed items may have advanced `tail`; this item
      // sits even later, so the next push must start past it.
      tail = Math.max(tail, item.slot + item.span);
      continue;
    }
    // Push to `tail`.
    const newSlot = tail;
    if (newSlot + item.span > gridEndSlot) return null;
    placed.push({ ...item, slot: newSlot });
    tail = newSlot + item.span;
  }

  return { placed };
}

function applyUpwardShiftMulti(
  sorted: PlaceableItem[],
  poolStart: number,
  poolEnd: number,
): { placed: PlaceableItem[] } {
  const placed: PlaceableItem[] = [];
  // Walk bottom-up so we can stack pushed items upward without
  // re-colliding with already-pushed neighbours.
  let ceiling = poolStart; // running upper bound for the next pushed item

  // First pass: items entirely below the pool stay put.
  const above: PlaceableItem[] = [];
  for (const item of sorted) {
    if (item.slot >= poolEnd) {
      placed.push(item);
    } else {
      above.push(item);
    }
  }

  // Walk above-pool items in reverse so each push targets the
  // next-lowest free spot above `ceiling`.
  for (let i = above.length - 1; i >= 0; i--) {
    const item = above[i]!;
    // Already above the ceiling — keep.
    if (item.slot + item.span <= ceiling) {
      placed.push(item);
      ceiling = Math.min(ceiling, item.slot);
      continue;
    }
    const newSlot = Math.max(0, ceiling - item.span);
    placed.push({ ...item, slot: newSlot });
    ceiling = newSlot;
  }

  return { placed };
}

/** Diff: which items in the final placement differ from the input
 *  (existing occupants OR pool matches that didn't already sit at
 *  their assigned position). */
function collectShifted(
  originalItems: readonly PlaceableItem[],
  poolPlaced: PlaceableItem[],
  occupantsPlaced: PlaceableItem[],
): PlaceableItem[] {
  const originalSlot = new Map<string, number>();
  for (const it of originalItems) originalSlot.set(it.id, it.slot);
  // Pool matches were never in `originalItems` (caller filters),
  // so they all count as "shifted to" their new slot.
  const out: PlaceableItem[] = [];
  for (const it of poolPlaced) out.push(it);
  for (const it of occupantsPlaced) {
    if (originalSlot.get(it.id) !== it.slot) out.push(it);
  }
  return out;
}
