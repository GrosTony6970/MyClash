/**
 * Drop-with-auto-shift placement helper.
 *
 * Pure: takes the current set of items occupying one lice column +
 * the dropped item + the position the operator released at, returns the
 * updated set with the dropped item placed at `dropAt` and any
 * downstream items pushed past the collision boundary. Falls back to
 * an upward push when the downward shift would run past `gridEnd`.
 *
 * Touching-but-not-overlapping items aren't moved (an item ending
 * at 24 and another starting at 24 are fine). An item that started before
 * `dropAt` and is still running there is not moved either: the drop lands
 * where it ends (`landingAfterRunning`).
 *
 * The unit is the caller's: every position and length here is counted in
 * the same one. The board passes MINUTES on its axis, from each bout's exact
 * start and real length. It used to pass 5-minute slots, and a slot floors: an
 * 8-minute bout took one slot, so the bout it pushed started five minutes
 * after it and the server refused the overlap.
 *
 * Co-located with grid.tsx, its only caller besides ./plan-match-drop.
 * Lives in its own file so it can be unit-tested without the React tree.
 */

export interface PlaceableItem {
  id: string;
  /** Where the item starts (inclusive), in the caller's unit. */
  at: number;
  /** How long the item lasts, in the same unit. */
  length: number;
}

export interface PlaceWithShiftInput {
  /** All items currently on the target lice (excluding the dropped
   *  one if it was already there — caller filters its prior position). */
  items: readonly PlaceableItem[];
  /** The dropped item and the position the operator released at. It lands
   *  later when an item that started earlier is still running there. */
  dropped: PlaceableItem;
  dropAt: number;
  /** Exclusive end of the grid. Pushes that would land past this
   *  trigger the upward-shift fallback. */
  gridEnd: number;
}

export interface PlaceWithShiftOutput {
  /** New items array. `dropped` is somewhere in it; other items may
   *  have moved. */
  items: PlaceableItem[];
  /** Items whose position changed (excluding the dropped one). Caller
   *  uses this to save the moved rows only. */
  shifted: PlaceableItem[];
  /** True when downward shift overflowed and we fell back to
   *  upward shift. Indicates that items above the drop point moved. */
  upwardFallback: boolean;
}

/**
 * Where a drop at `dropAt` really lands: at `dropAt`, or where the last item
 * that started BEFORE it and is still running there ends.
 *
 * The board draws a bout in whole 5-minute rows and floors, so an 8-minute bout
 * at 10:08 draws on the 10:05 row only and the 10:15 row looks free while the
 * bout runs to 10:16. A drop on 10:15 starts at 10:16: the bout the operator
 * saw above the drop stays above it (operator ruling, 2026-09-19). The cascade
 * used to push such a bout BELOW the dropped one. Items that start at or after
 * `dropAt` are pushed as before.
 */
function landingAfterRunning(items: readonly PlaceableItem[], dropAt: number): number {
  return items.reduce(
    (landing, it) => (it.at < dropAt && it.at + it.length > landing ? it.at + it.length : landing),
    dropAt,
  );
}

export function placeWithShift(input: PlaceWithShiftInput): PlaceWithShiftOutput {
  const { items, dropped, gridEnd } = input;
  const dropAt = landingAfterRunning(items, input.dropAt);

  // Drop position is free? Just place and return.
  const collides = items.some((it) => overlaps(it.at, it.length, dropAt, dropped.length));
  if (!collides) {
    return {
      items: [...items, { ...dropped, at: dropAt }].sort((a, b) => a.at - b.at),
      shifted: [],
      upwardFallback: false,
    };
  }

  // Try downward shift first.
  const downward = applyDownwardShift(items, dropped, dropAt, gridEnd);
  if (downward) return downward;

  // Downward overflowed — apply upward shift instead.
  return applyUpwardShift(items, dropped, dropAt);
}

function overlaps(aAt: number, aLength: number, bAt: number, bLength: number): boolean {
  return aAt < bAt + bLength && bAt < aAt + aLength;
}

/** Place `dropped` at `dropAt` and push every item starting after
 *  `dropAt` down past the dropped item's tail. Cascading: if
 *  pushing item A makes it overlap item B, B also gets pushed. Returns
 *  null when any push would run past `gridEnd`. */
function applyDownwardShift(
  items: readonly PlaceableItem[],
  dropped: PlaceableItem,
  dropAt: number,
  gridEnd: number,
): PlaceWithShiftOutput | null {
  const sorted = [...items].sort((a, b) => a.at - b.at);
  const placed: PlaceableItem[] = [{ ...dropped, at: dropAt }];
  const shifted: PlaceableItem[] = [];

  for (const item of sorted) {
    // Items entirely above the drop point (end at-or-before dropAt)
    // are untouched.
    if (item.at + item.length <= dropAt) {
      placed.push(item);
      continue;
    }
    // Items that start at-or-after dropAt — push past the dropped
    // item's tail (plus any earlier cascading pushes).
    const lastEnd = lastTailAtOrBefore(placed, item.at);
    if (item.at >= lastEnd) {
      placed.push(item);
      continue;
    }
    const newAt = lastEnd;
    if (newAt + item.length > gridEnd) return null;
    const moved = { ...item, at: newAt };
    placed.push(moved);
    shifted.push(moved);
  }

  return {
    items: placed.sort((a, b) => a.at - b.at),
    shifted,
    upwardFallback: false,
  };
}

/** Largest tail position (at+length) among the items already placed —
 *  the `at` bound excludes none of them. Used to find where the next
 *  item must start during cascade. Defaults to 0. */
function lastTailAtOrBefore(placed: PlaceableItem[], at: number): number {
  let best = 0;
  for (const it of placed) {
    const end = it.at + it.length;
    if (end > best && it.at <= at + 1e9) best = end;
  }
  return best;
}

/** Walk the items above the drop point in reverse, pushing them
 *  upward by the overlap amount so the dropped item fits. Cascades
 *  upward if a push makes an earlier item overlap. Items that would
 *  go past 0 stop at 0 (rarely; the operator would notice and
 *  pick a different drop point). */
function applyUpwardShift(
  items: readonly PlaceableItem[],
  dropped: PlaceableItem,
  dropAt: number,
): PlaceWithShiftOutput {
  const sorted = [...items].sort((a, b) => a.at - b.at);
  const placed: PlaceableItem[] = [{ ...dropped, at: dropAt }];
  const shifted: PlaceableItem[] = [];

  // Walk from bottom to top so the cascading push targets stay
  // monotonically decreasing.
  for (let i = sorted.length - 1; i >= 0; i--) {
    const item = sorted[i]!;
    // Items entirely below the drop point are untouched.
    if (item.at >= dropAt + dropped.length) {
      placed.push(item);
      continue;
    }
    // Items entirely above the drop point may still need to move up
    // if a previous upward push made them collide.
    const minTopAbove = nextOccupiedTop(placed, item.at);
    let newAt = item.at;
    // If item collides with the drop window, push it up so its tail
    // sits at the drop's start.
    if (item.at + item.length > dropAt) {
      newAt = Math.max(0, dropAt - item.length);
    }
    // If our chosen top still collides with something above, push
    // further up.
    if (newAt + item.length > minTopAbove) {
      newAt = Math.max(0, minTopAbove - item.length);
    }
    if (newAt !== item.at) {
      const moved = { ...item, at: newAt };
      placed.push(moved);
      shifted.push(moved);
    } else {
      placed.push(item);
    }
  }

  return {
    items: placed.sort((a, b) => a.at - b.at),
    shifted,
    upwardFallback: true,
  };
}

/** Bottom edge of the item that's immediately above the given position,
 *  among the items already placed. Defaults to Infinity (no item
 *  above). */
function nextOccupiedTop(placed: PlaceableItem[], at: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const it of placed) {
    if (it.at + it.length <= at) continue;
    if (it.at < at && it.at < best) best = it.at;
  }
  return best;
}

// ── Multi-item (pool) drop ────────────────────────────────────────

export interface PlaceMultiWithShiftInput {
  /** Current items on the target lice, EXCLUDING any of the
   *  dropped items if they were previously on this same lice. */
  items: readonly PlaceableItem[];
  /** Pool matches in render order. Placed back to back from where
   *  the drop lands (see `dropAt`), with no gap between them. */
  dropped: readonly PlaceableItem[];
  /** Where the pool's first match starts — later when an item that started
   *  earlier is still running there. */
  dropAt: number;
  /** Exclusive end of the grid — same semantics as
   *  PlaceWithShiftInput. */
  gridEnd: number;
}

export interface PlaceMultiWithShiftOutput {
  /** New items array, sorted by position. Both pool matches and
   *  existing occupants are in here. */
  items: PlaceableItem[];
  /** Items whose position ended up different from the input (existing
   *  occupants OR pool matches that didn't already sit at their
   *  computed position). */
  shifted: PlaceableItem[];
  /** True when downward shift overflowed the grid end and we fell
   *  back to upward shift. */
  upwardFallback: boolean;
}

/**
 * Drop a contiguous run of items (a pool's matches) at `dropAt`
 * on a single lice, pushing any existing occupants that overlap
 * the run past its tail.
 *
 * Same downward-then-upward fallback as `placeWithShift`. The
 * pool lands at its requested start, or where a bout still running
 * there ends (`landingAfterRunning`) — what moves is everything else.
 */
export function placeMultiWithShift(input: PlaceMultiWithShiftInput): PlaceMultiWithShiftOutput {
  const { items, dropped, gridEnd } = input;
  const dropAt = landingAfterRunning(items, input.dropAt);

  if (dropped.length === 0) {
    return {
      items: [...items].sort((a, b) => a.at - b.at),
      shifted: [],
      upwardFallback: false,
    };
  }

  // 1. Place every pool match sequentially starting at dropAt.
  //    The dropped array's order IS the pool's render order; we
  //    just lay them out contiguously.
  const poolPlaced: PlaceableItem[] = [];
  let cursor = dropAt;
  for (const m of dropped) {
    poolPlaced.push({ ...m, at: cursor });
    cursor += m.length;
  }
  const poolStart = dropAt;
  const poolEnd = cursor; // exclusive

  // 2. Walk existing occupants by position ascending. Anything ending
  //    at-or-before poolStart is fine; anything that overlaps the
  //    pool's range gets pushed past poolEnd, with cascading.
  const sorted = [...items].sort((a, b) => a.at - b.at);
  const downward = applyDownwardShiftMulti(sorted, poolStart, poolEnd, gridEnd);

  if (downward) {
    const final = [...poolPlaced, ...downward.placed].sort((a, b) => a.at - b.at);
    return {
      items: final,
      shifted: collectShifted(items, poolPlaced, downward.placed),
      upwardFallback: false,
    };
  }

  // 3. Downward overflowed — try upward instead. Items above the
  //    pool's start that would collide get pushed up.
  const upward = applyUpwardShiftMulti(sorted, poolStart, poolEnd);
  const final = [...poolPlaced, ...upward.placed].sort((a, b) => a.at - b.at);
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
  gridEnd: number,
): { placed: PlaceableItem[] } | null {
  const placed: PlaceableItem[] = [];
  let tail = poolEnd; // running floor for the next pushed item

  for (const item of sorted) {
    // Entirely above the pool — untouched.
    if (item.at + item.length <= poolStart) {
      placed.push(item);
      continue;
    }
    // Already past the pool's tail and past any earlier push? Keep.
    if (item.at >= tail) {
      placed.push(item);
      // Earlier pushed items may have advanced `tail`; this item
      // sits even later, so the next push must start past it.
      tail = Math.max(tail, item.at + item.length);
      continue;
    }
    // Push to `tail`.
    const newAt = tail;
    if (newAt + item.length > gridEnd) return null;
    placed.push({ ...item, at: newAt });
    tail = newAt + item.length;
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
    if (item.at >= poolEnd) {
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
    if (item.at + item.length <= ceiling) {
      placed.push(item);
      ceiling = Math.min(ceiling, item.at);
      continue;
    }
    const newAt = Math.max(0, ceiling - item.length);
    placed.push({ ...item, at: newAt });
    ceiling = newAt;
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
  const originalAt = new Map<string, number>();
  for (const it of originalItems) originalAt.set(it.id, it.at);
  // Pool matches were never in `originalItems` (caller filters),
  // so they all count as "shifted to" their new position.
  const out: PlaceableItem[] = [];
  for (const it of poolPlaced) out.push(it);
  for (const it of occupantsPlaced) {
    if (originalAt.get(it.id) !== it.at) out.push(it);
  }
  return out;
}
