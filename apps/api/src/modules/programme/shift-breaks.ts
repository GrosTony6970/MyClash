/**
 * Push break blocks so they never overlap competition matches (or each
 * other). For each break, if its window overlaps any match on the same
 * day — or an already-shifted earlier break — move its start to the
 * latest overlapping end, keeping its duration, and repeat until clear.
 * Later breaks cascade off the shifted ones.
 *
 * Times are minutes-of-day. Pure: no I/O. Non-break blocks pass through
 * untouched (competition windows are represented by their matches in
 * `matchesByDay`, not by the block itself).
 */
export interface ShiftBlock {
  id: string;
  dayIndex: number;
  blockType: string;
  startMin: number;
  endMin: number;
}

export interface MatchWindow {
  startMin: number;
  endMin: number;
}

export function shiftBreaksAfterOverlap(
  blocks: ShiftBlock[],
  matchesByDay: Record<number, MatchWindow[]>,
): ShiftBlock[] {
  const obstaclesByDay: Record<number, MatchWindow[]> = {};
  for (const [day, windows] of Object.entries(matchesByDay)) {
    obstaclesByDay[Number(day)] = windows.map((w) => ({ startMin: w.startMin, endMin: w.endMin }));
  }

  return blocks.map((block) => {
    if (block.blockType !== 'break') return block;

    const obstacles = (obstaclesByDay[block.dayIndex] ??= []);
    const duration = block.endMin - block.startMin;
    let start = block.startMin;
    let end = start + duration;

    let moved = true;
    while (moved) {
      moved = false;
      for (const o of obstacles) {
        if (start < o.endMin && o.startMin < end) {
          start = o.endMin;
          end = start + duration;
          moved = true;
        }
      }
    }

    // Register the (possibly shifted) break so later breaks cascade off it.
    obstacles.push({ startMin: start, endMin: end });
    return { ...block, startMin: start, endMin: end };
  });
}
