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
  if (!moved || deltaMin === 0) return [];
  const oldStartMin = moved.startMin;

  const shifted: CascadeBlock[] = [];
  for (const b of blocks) {
    if (b.startMin < oldStartMin) continue; // earlier blocks stay put
    const duration = b.endMin - b.startMin;
    const start = Math.max(dayStartMin, b.startMin + deltaMin);
    shifted.push({ id: b.id, startMin: start, endMin: start + duration });
  }
  return shifted;
}
