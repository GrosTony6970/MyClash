/**
 * Cascade a programme-block move across the same day's blocks. When the
 * operator drags one block to a new start time (Δ minutes from its old start),
 * every block that began at or after the moved block's OLD start shifts by the
 * same Δ — the moved block included — so the day keeps flowing in order and
 * later blocks don't collide with (or detach from) the one that moved.
 *
 * Times are minutes-of-day. Forward Δ pushes blocks later; backward Δ pulls
 * them earlier, clamped at `dayStartMin` (default 0) so nothing wraps before
 * the day. Blocks before the moved block, and blocks on other days, are the
 * caller's responsibility to exclude. Pure: no I/O.
 */
export interface CascadeBlock {
  id: string;
  startMin: number;
  endMin: number;
}

export function cascadeBlockShift(
  blocks: CascadeBlock[],
  movedBlockId: string,
  deltaMin: number,
  dayStartMin = 0,
): CascadeBlock[] {
  const moved = blocks.find((b) => b.id === movedBlockId);
  if (!moved) return [];
  return shiftBlocksFrom(blocks, moved.startMin, deltaMin, dayStartMin);
}

/**
 * The same cascade, cut at a minute of the day rather than at a block.
 *
 * This is what `cascadeBlockShift` has always done underneath; naming it lets
 * the whole-day running-late control reuse it, where there is no dragged block
 * to take the cut from — the operator says "everything from now on".
 */
export function shiftBlocksFrom(
  blocks: CascadeBlock[],
  fromMin: number,
  deltaMin: number,
  dayStartMin = 0,
): CascadeBlock[] {
  if (deltaMin === 0) return [];

  const shifted: CascadeBlock[] = [];
  for (const b of blocks) {
    if (b.startMin < fromMin) continue; // earlier blocks stay put
    const duration = b.endMin - b.startMin;
    const start = Math.max(dayStartMin, b.startMin + deltaMin);
    shifted.push({ id: b.id, startMin: start, endMin: start + duration });
  }
  return shifted;
}
